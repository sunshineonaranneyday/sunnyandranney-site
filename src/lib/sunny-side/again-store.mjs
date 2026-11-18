/**
 * Each week's "send it again", kept in D1
 * ===========================================================================
 * One row per week's email that is set to go again (again.mjs): the subject line and time Staci
 * picked when she scheduled it, and where it stands. The run that sends it (again-run.mjs) moves
 * it along: waiting → scheduled (in Kit) → sent, or skipped (with why) or cancelled. Every move is
 * made only from the state it was read in, so the page turning it off and the run sending it can't
 * both win. The table creates itself on first use.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS email_again (
    send_date TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    send_at TEXT NOT NULL,
    state TEXT NOT NULL,
    kit_id TEXT,
    people INTEGER,
    left_out TEXT,
    want TEXT,
    listed_at TEXT,
    note TEXT,
    detail TEXT,
    set_by TEXT NOT NULL,
    set_at TEXT NOT NULL,
    stopped_by TEXT,
    creating_at TEXT,
    tag_clean INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL)`,
  // One run at a time: the run holds this until it's done or the time runs out, and only it can let go
  'CREATE TABLE IF NOT EXISTS email_again_lock (id INTEGER PRIMARY KEY CHECK (id = 1), until INTEGER NOT NULL, token TEXT NOT NULL)',
];

const _ready = new WeakSet();
export async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  _ready.add(db);
}

/**
 * @typedef {{ send: string, subject: string, sendAt: string, state: 'waiting' | 'scheduled' | 'sent' | 'skipped' | 'cancelled',
 *   kitId: string | null, people: number | null, left: Record<string, number> | null, want: string[] | null, listedAt: string | null,
 *   note: string | null, detail: string | null, by: string, at: string, stoppedBy: string | null, creatingAt: string | null, tagClean: boolean, updatedAt: string }} Again
 */

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** @returns {Again} */
const fromRow = (r) => ({
  send: r.send_date,
  subject: r.subject,
  sendAt: r.send_at,
  state: r.state,
  kitId: r.kit_id ?? null,
  people: r.people ?? null,
  left: parse(r.left_out),
  want: parse(r.want),
  listedAt: r.listed_at ?? null,
  note: r.note ?? null,
  detail: r.detail ?? null,
  by: r.set_by,
  at: r.set_at,
  stoppedBy: r.stopped_by ?? null,
  creatingAt: r.creating_at ?? null,
  tagClean: Boolean(r.tag_clean),
  updatedAt: r.updated_at,
});

/** A week's resend, or null. @returns {Promise<Again | null>} */
export async function getAgain(db, send) {
  await ensureTable(db);
  const r = await db.prepare('SELECT * FROM email_again WHERE send_date = ?').bind(send).first();
  return r ? fromRow(r) : null;
}

/**
 * Sets the week's email to go again, as it's scheduled. Starts over any earlier one for the week
 * (one cancelled with its send): the tag is cleaned by the run either way.
 */
export async function setAgain(db, { send, subject, sendAt, by, now }) {
  await ensureTable(db);
  await db
    .prepare(
      `INSERT INTO email_again (send_date, subject, send_at, state, set_by, set_at, tag_clean, updated_at) VALUES (?, ?, ?, 'waiting', ?, ?, 0, ?)
       ON CONFLICT(send_date) DO UPDATE SET subject = excluded.subject, send_at = excluded.send_at, state = 'waiting', kit_id = NULL, people = NULL,
         left_out = NULL, want = NULL, listed_at = NULL, note = NULL, detail = NULL, set_by = excluded.set_by, set_at = excluded.set_at,
         stopped_by = NULL, creating_at = email_again.creating_at, tag_clean = 0, updated_at = excluded.updated_at`,
    )
    .bind(send, subject, sendAt, by, now, now)
    .run();
}

/**
 * Moves a resend on, but only from the state it was read in (`from`). Returns true if it moved.
 * @param {any} db @param {string} send @param {string | string[]} from @param {Partial<Record<string, unknown>>} fields
 */
export async function moveAgain(db, send, from, fields, now) {
  await ensureTable(db);
  const cols = {
    state: 'state',
    kitId: 'kit_id',
    people: 'people',
    left: 'left_out',
    want: 'want',
    listedAt: 'listed_at',
    note: 'note',
    detail: 'detail',
    stoppedBy: 'stopped_by',
    creatingAt: 'creating_at',
    tagClean: 'tag_clean',
  };
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!(k in cols)) throw new Error(`moveAgain: unknown field ${k}`);
    sets.push(`${cols[k]} = ?`);
    values.push(k === 'left' || k === 'want' ? (v == null ? null : JSON.stringify(v)) : k === 'tagClean' ? (v ? 1 : 0) : (v ?? null));
  }
  const states = Array.isArray(from) ? from : [from];
  const result = await db
    .prepare(`UPDATE email_again SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE send_date = ? AND state IN (${states.map(() => '?').join(', ')})`)
    .bind(...values, now, send, ...states)
    .run();
  return result.meta.changes === 1;
}

/**
 * A week's resend that never started (nothing listed or tagged yet, nothing being made in Kit) is
 * taken away, as if it had never been set: the email was cancelled, or scheduled again without it.
 * One that started is turned off instead, so the run still clears up after it. True if it was taken away.
 */
export async function dropAgain(db, { send, by, now }) {
  await ensureTable(db);
  const gone = await db.prepare("DELETE FROM email_again WHERE send_date = ? AND state IN ('waiting', 'cancelled') AND want IS NULL AND creating_at IS NULL").bind(send).run();
  if (gone.meta.changes === 1) return true;
  await moveAgain(db, send, 'waiting', { state: 'cancelled', stoppedBy: by }, now);
  return false;
}

/** The resends the run still has work on: waiting, in Kit, with people still on the tag, or one being made in Kit. Soonest first. @returns {Promise<Again[]>} */
export async function liveAgains(db) {
  await ensureTable(db);
  const { results } = await db.prepare("SELECT * FROM email_again WHERE state IN ('waiting', 'scheduled') OR tag_clean = 0 OR creating_at IS NOT NULL ORDER BY send_at").all();
  return (results || []).map(fromRow);
}

/** Kit's ids for the resends that went since `since` (ISO): their people aren't sent another for a while. */
export async function againsSince(db, since) {
  await ensureTable(db);
  const { results } = await db.prepare("SELECT kit_id FROM email_again WHERE state = 'sent' AND kit_id IS NOT NULL AND send_at >= ?").bind(since).all();
  return (results || []).map((r) => Number(r.kit_id)).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Takes the one-run-at-a-time lock until `until` (ms): its token, or null if another run holds it.
 * A run that dies keeps it only until its time runs out.
 */
export async function takeLock(db, now, until) {
  await ensureTable(db);
  const token = crypto.randomUUID();
  const r = await db
    .prepare('INSERT INTO email_again_lock (id, until, token) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET until = excluded.until, token = excluded.token WHERE email_again_lock.until < ?')
    .bind(until, token, now)
    .run();
  return r.meta.changes === 1 ? token : null;
}

/** Lets go of the lock, if this run still holds it: a run that outlived its time can't free the next run's. */
export async function dropLock(db, token) {
  await ensureTable(db);
  await db.prepare('DELETE FROM email_again_lock WHERE id = 1 AND token = ?').bind(token).run();
}

/** The resend of the email Kit knows by `kitId` (the week's own send), or null. @returns {Promise<Again | null>} */
export async function againOfEmail(db, kitId) {
  await ensureTable(db);
  const has = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_weeks'").first();
  if (!has) return null;
  const r = await db.prepare('SELECT a.* FROM email_again a JOIN email_weeks w ON w.send_date = a.send_date WHERE w.kit_id = ?').bind(String(kitId)).first();
  return r ? fromRow(r) : null;
}
