/**
 * Problems in the email's own layout that the admin's preview measured, kept in D1 for the owner
 * ===========================================================================
 * The email's layout (its fixed words, the charity's numbers) is code, held to every phone width
 * by verify.mjs on every pull request. If a problem still shows up in the preview, nothing Staci
 * can type fixes it, so her page never shows it: the page reports it here, and the owner sees it
 * on the email page until it's cleared. One row per word, so a preview redrawing as she types
 * doesn't pile up rows. The table creates itself on first use.
 */

const TABLE = `CREATE TABLE IF NOT EXISTS email_layout_reports (
  word TEXT PRIMARY KEY, over INTEGER NOT NULL, width INTEGER NOT NULL, send_date TEXT NOT NULL,
  seen_by TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, times INTEGER NOT NULL DEFAULT 1)`;

const _ready = new WeakSet();
async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.prepare(TABLE).run();
  _ready.add(db);
}

/** @typedef {{ word: string, over: number, width: number, send: string, seenBy: string, firstSeen: string, lastSeen: string, times: number }} LayoutReport */

/**
 * A report as the page sent it, cleaned, or null if it isn't one: a word (at most 60 characters),
 * how many px too wide (1 or more, noted as at most 600: anything wider is just as broken, and a
 * whole-email overflow was refused for it and never noted) and the phone width it was measured at
 * (320 to 700).
 */
export function cleanReport(body) {
  const word = String(body?.word ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const over = Math.min(600, Math.round(Number(body?.over)));
  const width = Math.round(Number(body?.width));
  const send = String(body?.send ?? '');
  if (!word || !(over >= 1) || !(width >= 320 && width <= 700) || !/^\d{4}-\d{2}-\d{2}$/.test(send)) return null;
  return { word, over, width, send };
}

/** A row as the page shows it. @returns {LayoutReport} */
const reportOf = (r) => ({
  word: r.word,
  over: r.over,
  width: r.width,
  send: r.send_date,
  seenBy: r.seen_by,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  times: r.times,
});

/**
 * Notes a report: a word already reported gets its latest measure and one more time seen. Returns
 * the row as it now stands, so the owner's page shows how often and since when, not a fresh one.
 * @returns {Promise<LayoutReport>}
 */
export async function noteReport(db, { word, over, width, send, by, now }) {
  await ensureTable(db);
  const row = await db
    .prepare(
      `INSERT INTO email_layout_reports (word, over, width, send_date, seen_by, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET over = excluded.over, width = excluded.width, send_date = excluded.send_date,
       seen_by = excluded.seen_by, last_seen = excluded.last_seen, times = times + 1
       RETURNING *`,
    )
    .bind(word, over, width, send, by, now, now)
    .first();
  return reportOf(row);
}

/** Every report not yet cleared, latest first. @returns {Promise<LayoutReport[]>} */
export async function listReports(db) {
  await ensureTable(db);
  const { results } = await db.prepare('SELECT * FROM email_layout_reports ORDER BY last_seen DESC LIMIT 20').all();
  return (results || []).map(reportOf);
}

/** Clears every report, once the layout is fixed. */
export async function clearReports(db) {
  await ensureTable(db);
  await db.prepare('DELETE FROM email_layout_reports').run();
}
