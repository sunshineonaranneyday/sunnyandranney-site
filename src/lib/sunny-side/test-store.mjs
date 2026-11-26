/**
 * Who checks the weekly email (testers.mjs), and every test sent, kept in D1
 * ===========================================================================
 * The list is the store's (the photographer, the manager, whoever approves), so it lives here and
 * not in the code: the repo is public. Managers add and take people off it on the email page.
 * Each test sent is logged, so the page can say when the last one went and to whom, and so the
 * server can hold tests to a daily limit. Both tables create themselves on first use.
 */

const PEOPLE = `CREATE TABLE IF NOT EXISTS email_test_people (
  email TEXT PRIMARY KEY, name TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL)`;

const SENDS = `CREATE TABLE IF NOT EXISTS email_test_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT, send_date TEXT NOT NULL, sent_at TEXT NOT NULL,
  sent_by TEXT NOT NULL, recipients TEXT NOT NULL, kit_id TEXT)`;

const _ready = new WeakSet();
export async function ensureTables(db) {
  if (_ready.has(db)) return;
  await db.batch([db.prepare(PEOPLE), db.prepare(SENDS)]);
  // A log made before tests went through Kit has no kit_id column yet
  const { results: cols } = await db.prepare('PRAGMA table_info(email_test_sends)').all();
  if (!(cols || []).some((c) => c.name === 'kit_id')) {
    await db.prepare('ALTER TABLE email_test_sends ADD COLUMN kit_id TEXT').run().catch((err) => {
      if (!/duplicate column/i.test(String(err))) throw err;
    });
  }
  _ready.add(db);
}

/** @typedef {{ at: string, by: string, to: string[] }} TestSent */

/** @typedef {{ name: string, email: string }} Person */

/** Everyone on the list, by name. @returns {Promise<Person[]>} */
export async function listPeople(db) {
  await ensureTables(db);
  const { results } = await db.prepare('SELECT name, email FROM email_test_people ORDER BY name, email').all();
  return (results || []).map((r) => ({ name: r.name, email: r.email }));
}

/** Puts a checked person on the list; someone already on it keeps their place and gets the new name. */
export async function addPerson(db, { name, email, by, now }) {
  await ensureTables(db);
  await db
    .prepare('INSERT INTO email_test_people (email, name, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name')
    .bind(email, name, by, now)
    .run();
}

/** Takes someone off the list. True when they were on it. */
export async function removePerson(db, email) {
  await ensureTables(db);
  const r = await db.prepare('DELETE FROM email_test_people WHERE email = ?').bind(email).run();
  return r.meta.changes === 1;
}

export async function logTest(db, { send, at, by, to, kitId }) {
  await ensureTables(db);
  await db
    .prepare('INSERT INTO email_test_sends (send_date, sent_at, sent_by, recipients, kit_id) VALUES (?, ?, ?, ?, ?)')
    .bind(send, at, by, JSON.stringify(to), kitId == null ? null : String(kitId))
    .run();
}

/** The last few tests of one email, newest first. @returns {Promise<TestSent[]>} */
export async function recentTests(db, send, limit = 3) {
  await ensureTables(db);
  const { results } = await db
    .prepare('SELECT sent_at, sent_by, recipients FROM email_test_sends WHERE send_date = ? ORDER BY sent_at DESC, id DESC LIMIT ?')
    .bind(send, limit)
    .all();
  return (results || []).map((r) => ({ at: r.sent_at, by: r.sent_by, to: JSON.parse(r.recipients) }));
}

/** How many tests went out since an ISO time, any email, anyone. */
export async function testsSince(db, since) {
  await ensureTables(db);
  const r = await db.prepare('SELECT COUNT(*) AS n FROM email_test_sends WHERE sent_at >= ?').bind(since).first();
  return Number(r?.n ?? 0);
}
