/**
 * Checking Kit's "Shopify: no marketing" tag against Shopify
 * ===========================================================================
 * The weekly email leaves out everyone with NO_MARKETING_TAG (STORE_SEGMENT in kit.mjs). On
 * Nov 25, 2026 a customer Shopify had as subscribed to the store's emails since 2025 turned up with
 * that tag, so the tag isn't always Shopify's answer. A check reads everyone on the tag in Kit, puts
 * each next to Shopify's own answer, and in "fix" mode takes the tag off the ones Shopify says said
 * yes. Everyone it read is kept with what it found and did: who was on the tag, since when, whether
 * they're on the store's list, and what Shopify says.
 *
 * Shopify's answers are a copy in D1 (shopify_email_consent), read from Shopify's admin and loaded
 * by hand: the site's own Shopify access doesn't cover customers. A check is asked for by adding a
 * row to kit_tag_checks; the email-again run (api/email-again.ts, every two minutes, the one place
 * the site works with Kit on its own) takes the oldest unfinished one a step at a time: first the
 * list, then up to BUDGET tags off a run, leaving Kit's 120 calls a minute room for everything else.
 * The tables create themselves on first use.
 */

import { removeTag, storeTags } from './kit.mjs';

/** Tags taken off a run. */
export const BUDGET = 40;

const SCHEMA = [
  // Shopify's answer for each customer's email: SUBSCRIBED, NOT_SUBSCRIBED, UNSUBSCRIBED, PENDING...
  `CREATE TABLE IF NOT EXISTS shopify_email_consent (
    email TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    state_at TEXT,
    read_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kit_tag_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL CHECK (mode IN ('report', 'fix')),
    asked_at TEXT NOT NULL,
    asked_by TEXT NOT NULL,
    tag_id INTEGER,
    listed_at TEXT,
    done_at TEXT,
    error TEXT,
    error_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS kit_tag_check_people (
    check_id INTEGER NOT NULL,
    kit_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    kit_state TEXT,
    kit_created_at TEXT,
    tagged_at TEXT,
    store_tagged_at TEXT,
    shopify_state TEXT,
    shopify_state_at TEXT,
    action TEXT NOT NULL CHECK (action IN ('untag', 'keep')),
    untagged_at TEXT,
    PRIMARY KEY (check_id, kit_id))`,
];

const _ready = new WeakSet();
export async function ensureTables(db) {
  if (_ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  _ready.add(db);
}

/** Everyone with a tag, in any state, with when they got it. */
export async function tagPeople(kit, tagId) {
  const people = [];
  const seen = new Set();
  let after = '';
  for (let page = 0; page < 100; page++) {
    const data = await kit.call(`/tags/${tagId}/subscribers?status=all&per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (!Array.isArray(data?.subscribers)) throw new Error('Kit answered a tag’s list without one.');
    for (const s of data.subscribers) {
      people.push({ id: Number(s.id), email: String(s.email_address ?? '').trim().toLowerCase(), state: s.state ?? null, createdAt: s.created_at ?? null, taggedAt: s.tagged_at ?? null });
    }
    const p = data.pagination ?? {};
    if (!p.has_next_page) return people;
    if (!p.end_cursor || seen.has(p.end_cursor)) throw new Error('Kit said a tag’s list had more but gave no next page.');
    seen.add(p.end_cursor);
    after = p.end_cursor;
  }
  throw new Error('A tag’s list went on for 100 pages.');
}

/** Asks for a check. @returns {Promise<number>} its id */
export async function askCheck(db, { mode, by, now = new Date().toISOString() }) {
  await ensureTables(db);
  const row = await db.prepare('INSERT INTO kit_tag_checks (mode, asked_at, asked_by) VALUES (?, ?, ?) RETURNING id').bind(mode, now, by).first();
  return Number(row.id);
}

/**
 * One step of the oldest unfinished check, or null when there's none. Its first step reads the tag
 * and the store's list from Kit and keeps everyone on the tag with Shopify's answer; a report is
 * then done. A fix then takes the tag off, BUDGET a run, everyone Shopify says is subscribed, and
 * is done when none are left. A step that fails is noted on the check and tried again next run.
 */
export async function runTagCheck({ db, kit, now = () => new Date().toISOString(), budget = BUDGET }) {
  await ensureTables(db);
  const check = await db.prepare('SELECT * FROM kit_tag_checks WHERE done_at IS NULL ORDER BY id LIMIT 1').first();
  if (!check) return null;
  const at = now();
  try {
    if (!check.listed_at) return await list(db, kit, check, at);
    return await untag(db, kit, check, at, budget);
  } catch (err) {
    const why = /** @type {Error} */ (err).message || String(err);
    await db.prepare('UPDATE kit_tag_checks SET error = ?, error_at = ? WHERE id = ?').bind(why, at, check.id).run();
    return { check: check.id, did: [`tag check ${check.id}: stopped (${why}), the next run goes on`] };
  }
}

async function list(db, kit, check, at) {
  const { n: answers } = await db.prepare('SELECT COUNT(*) AS n FROM shopify_email_consent').first();
  if (!answers) throw new Error('no answers from Shopify are loaded (shopify_email_consent is empty)');
  const { store, noMarketing } = await storeTags(kit);
  const [tagged, onStore] = await Promise.all([tagPeople(kit, noMarketing), tagPeople(kit, store)]);
  const storeAt = new Map(onStore.map((p) => [p.id, p.taggedAt ?? '']));
  const { results: consent } = await db.prepare('SELECT email, state, state_at FROM shopify_email_consent').all();
  const shopify = new Map(consent.map((r) => [r.email, r]));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO kit_tag_check_people (check_id, kit_id, email, kit_state, kit_created_at, tagged_at, store_tagged_at, shopify_state, shopify_state_at, action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = tagged.map((p) => {
    const s = shopify.get(p.email);
    const action = s?.state === 'SUBSCRIBED' ? 'untag' : 'keep';
    return insert.bind(check.id, p.id, p.email, p.state, p.createdAt, p.taggedAt, storeAt.has(p.id) ? storeAt.get(p.id) || 'yes' : null, s?.state ?? null, s?.state_at ?? null, action);
  });
  for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50));
  const done = check.mode === 'report' ? at : null;
  await db.prepare('UPDATE kit_tag_checks SET tag_id = ?, listed_at = ?, done_at = ?, error = NULL, error_at = NULL WHERE id = ? AND listed_at IS NULL').bind(noMarketing, at, done, check.id).run();
  const toUntag = tagged.filter((p) => shopify.get(p.email)?.state === 'SUBSCRIBED').length;
  return { check: check.id, did: [`tag check ${check.id}: ${tagged.length} on the tag, ${toUntag} of them subscribed in Shopify`] };
}

async function untag(db, kit, check, at, budget) {
  if (check.mode !== 'fix') {
    await db.prepare('UPDATE kit_tag_checks SET done_at = ? WHERE id = ?').bind(at, check.id).run();
    return { check: check.id, did: [] };
  }
  const { results: due } = await db
    .prepare("SELECT kit_id FROM kit_tag_check_people WHERE check_id = ? AND action = 'untag' AND untagged_at IS NULL ORDER BY kit_id LIMIT ?")
    .bind(check.id, budget)
    .all();
  for (const { kit_id: id } of due) {
    await removeTag(kit, check.tag_id, id);
    await db.prepare('UPDATE kit_tag_check_people SET untagged_at = ? WHERE check_id = ? AND kit_id = ?').bind(at, check.id, id).run();
  }
  const { n: left } = await db.prepare("SELECT COUNT(*) AS n FROM kit_tag_check_people WHERE check_id = ? AND action = 'untag' AND untagged_at IS NULL").bind(check.id).first();
  if (!left) await db.prepare('UPDATE kit_tag_checks SET done_at = ?, error = NULL, error_at = NULL WHERE id = ?').bind(at, check.id).run();
  return { check: check.id, did: due.length ? [`tag check ${check.id}: tag taken off ${due.length}, ${left} to go`] : [] };
}
