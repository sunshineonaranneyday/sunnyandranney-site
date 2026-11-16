/**
 * Each week's email as Staci sets it, kept in D1
 * ===========================================================================
 * One row per Tuesday email: the special (special.mjs) and the products (wall.mjs) as she saved
 * them, who saved them and when. Either can be saved before the other is ready. The admin page
 * reads and writes it; the weekly build (scripts/sunny-side/build.mjs) reads it. Saving checks
 * the version the page loaded, so two managers can't overwrite each other without knowing.
 *
 * The table creates itself on first use. The page kept only specials before it had products, in
 * email_specials; the first use moves them here and drops that table in one transaction, so
 * nothing Staci saved there is lost and nothing can come back from it.
 */

import { cleanParts } from './parts.mjs';
import { clean, emailToWorkOn, sendLabel, thisWeeksSend } from './special.mjs';
import { cleanWall } from './wall.mjs';

const SCHEMA = `CREATE TABLE IF NOT EXISTS email_weeks (
  send_date TEXT PRIMARY KEY, special TEXT, wall TEXT, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`;

const _ready = new WeakSet();
export async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  // Columns added since the table was first made: the rest of the email, and its draft in Kit
  const { results: cols } = await db.prepare('PRAGMA table_info(email_weeks)').all();
  const have = new Set((cols || []).map((c) => c.name));
  for (const [name, type] of [['parts', 'TEXT'], ['kit_id', 'TEXT'], ['kit_at', 'TEXT'], ['kit_by', 'TEXT'], ['kit_send_at', 'TEXT']]) {
    if (have.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE email_weeks ADD COLUMN ${name} ${type}`).run();
    } catch (err) {
      // Another request added it first
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
  const old = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_specials'").first();
  if (old) {
    try {
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO email_weeks (send_date, special, wall, updated_at, updated_by) SELECT send_date, special, NULL, updated_at, updated_by FROM email_specials'),
        db.prepare('DROP TABLE email_specials'),
      ]);
    } catch (err) {
      // Another request moved them first
      if (!/no such table/i.test(String(err))) throw err;
    }
  }
  _ready.add(db);
}

/**
 * @typedef {{ send: string, special: ReturnType<typeof clean> | null, wall: ReturnType<typeof cleanWall> | null, parts: ReturnType<typeof cleanParts> | null, kit: { id: string, at: string, by: string, sendAt: string } | null, updatedAt: string, updatedBy: string }} Week
 */

/** @returns {Week} */
const fromRow = (r) => ({
  send: r.send_date,
  special: r.special ? clean(JSON.parse(r.special)) : null,
  wall: r.wall ? cleanWall(JSON.parse(r.wall)) : null,
  parts: r.parts ? cleanParts(JSON.parse(r.parts)) : null,
  kit: r.kit_id ? { id: r.kit_id, at: r.kit_at, by: r.kit_by, sendAt: r.kit_send_at } : null,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

/** One email's week, or null. @returns {Promise<Week | null>} */
export async function getWeek(db, send) {
  await ensureTable(db);
  const r = await db.prepare('SELECT * FROM email_weeks WHERE send_date = ?').bind(send).first();
  return r ? fromRow(r) : null;
}

/** True when a week's email has gone out through Kit: it was scheduled for a time now past. @param {Week | null | undefined} w */
export const wentOut = (w, now = Date.now()) => Boolean(w?.kit) && Date.parse(w.kit.sendAt) <= now;

/**
 * The one email the admin works on, as the database has it: this week's until it has gone out,
 * then next week's (emailToWorkOn). Every other week is read-only: one that went out is checked in
 * Sent emails, and the next one opens once this one goes.
 * @returns {Promise<{ send: string, week: Week | null }>}
 */
export async function weekToWorkOn(db, today, now = Date.now()) {
  const first = thisWeeksSend(today);
  const week = await getWeek(db, first);
  const send = emailToWorkOn(today, () => wentOut(week, now));
  return { send, week: send === first ? week : await getWeek(db, send) };
}

/** Why a change to `send` is refused while `work` is the email being worked on, or null when it's the one. */
export function otherWeek(send, work) {
  if (send === work) return null;
  return send < work
    ? `The ${sendLabel(send)} email has gone out, so it can’t change. Reload to work on the ${sendLabel(work)} email.`
    : `Only the ${sendLabel(work)} email can be worked on until it goes out. Reload to see it.`;
}

/**
 * Why a week can't change while it's scheduled, or null. Kit sends the email it was given, so a change
 * now would leave the page showing one email while another goes out. The page locks itself; this
 * holds for a page opened before it was scheduled, too.
 * @param {Week | null | undefined} w
 */
export const scheduledRefusal = (w) => (w?.kit ? 'This email is scheduled in Kit, so it can’t change. Cancel the send first, then change it and schedule it again.' : null);

/** The most recent weeks with a special before a send date, newest first: the specials Staci can start from. @returns {Promise<Week[]>} */
export async function pastWeeks(db, before, limit = 12) {
  await ensureTable(db);
  const { results } = await db
    .prepare('SELECT * FROM email_weeks WHERE send_date < ? AND special IS NOT NULL ORDER BY send_date DESC LIMIT ?')
    .bind(before, limit)
    .all();
  return (results || []).map(fromRow);
}

/**
 * Saves a week. `special` and `wall` are checked, or null when not set yet. `since` is the
 * updatedAt the page loaded (null for a week with nothing saved yet); if someone saved in
 * between, nothing changes and the newer one comes back.
 */
/** @param {any} db @param {{ send: string, special: any, wall: any, parts?: any, by: string, now: string, since: string | null }} week */
export async function putWeek(db, { send, special, wall, parts = null, by, now, since }) {
  await ensureTable(db);
  const s = special ? JSON.stringify(special) : null;
  const w = wall ? JSON.stringify(wall) : null;
  const p = parts ? JSON.stringify(parts) : null;
  const result =
    since === null
      ? await db
          .prepare('INSERT INTO email_weeks (send_date, special, wall, parts, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(send_date) DO NOTHING')
          .bind(send, s, w, p, now, by)
          .run()
      : await db
          .prepare('UPDATE email_weeks SET special = ?, wall = ?, parts = ?, updated_at = ?, updated_by = ? WHERE send_date = ? AND updated_at = ?')
          .bind(s, w, p, now, by, send, since)
          .run();
  if (result.meta.changes === 1) return { ok: true, record: { send, special, wall, parts, updatedAt: now, updatedBy: by } };
  return { ok: false, current: await getWeek(db, send) };
}

/**
 * Notes the week's send, scheduled in Kit (or clears it when `id` is null, once it's cancelled).
 * Leaves the week's version alone: nothing in the email changed.
 */
/** @param {any} db @param {{ send: string, id: string | number | null, at?: string | null, by?: string | null, sendAt?: string | null }} kit */
export async function setKit(db, { send, id, at = null, by = null, sendAt = null }) {
  await ensureTable(db);
  await db
    .prepare('UPDATE email_weeks SET kit_id = ?, kit_at = ?, kit_by = ?, kit_send_at = ? WHERE send_date = ?')
    .bind(id == null ? null : String(id), at, by, sendAt, send)
    .run();
}

/** Takes a week's special and products away, if it's still the version the page loaded. */
export async function clearWeek(db, { send, since }) {
  await ensureTable(db);
  const result = await db.prepare('DELETE FROM email_weeks WHERE send_date = ? AND updated_at = ?').bind(send, since).run();
  if (result.meta.changes === 1) return { ok: true };
  return { ok: false, current: await getWeek(db, send) };
}
