/**
 * The admin's side of special-order requests: the list, marking each one answered,
 * ordered or closed (who and when), the numbers that show how fast the store replies,
 * and where the store's copy is emailed.
 */
import { STORE_TO_KEY } from './special-orders.mjs';

export const STATUSES = ['new', 'replied', 'ordered', 'closed'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Waiting ones first, oldest first (they've waited longest); then the rest, newest first. */
export async function listRequests(db, { limit = 200 } = {}) {
  const { results } = await db.prepare(
    `SELECT * FROM special_order_requests
     ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END,
              CASE status WHEN 'new' THEN created_at END ASC,
              created_at DESC
     LIMIT ?`,
  ).bind(limit).all();
  return results;
}

/** How many are waiting for a reply: the Today page's count. */
export async function waitingCount(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MIN(reply_by) AS due FROM special_order_requests WHERE status = 'new'`).first();
  // due: the soonest answer-by day a shopper was given (YYYY-MM-DD), the same day the Special orders page goes by.
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null, due: row?.due ?? null };
}

/**
 * Moves a request on. Answering stamps replied_at once; ordered or closed also stamps
 * closed_at, and counts as answered if it wasn't already. Moving a finished request back
 * to answered reopens it (a mis-tap on the iPad is one tap to undo).
 * @returns {Promise<boolean>} false when there's no such request
 */
export async function setStatus(db, { id, status, by, now }) {
  if (!STATUSES.includes(status) || status === 'new') throw new Error(`Not a status a request can move to: ${status}`);
  const at = new Date(now).toISOString();
  const done = status === 'ordered' || status === 'closed';
  const result = await db.prepare(
    `UPDATE special_order_requests SET
       status = ?,
       replied_at = COALESCE(replied_at, ?),
       replied_by = COALESCE(replied_by, ?),
       closed_at = CASE WHEN ? THEN ? ELSE NULL END,
       closed_by = CASE WHEN ? THEN ? ELSE NULL END
     WHERE id = ?`,
  ).bind(status, at, by, done ? 1 : 0, at, done ? 1 : 0, by, id).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** After the outbox gave up (say the store address was wrong), try this request's emails again. */
export async function resendEmails(db, id) {
  const result = await db.prepare('UPDATE special_order_requests SET email_attempts = 0, email_error = NULL WHERE id = ?').bind(id).run();
  return (result.meta?.changes ?? 0) > 0;
}

const HOUR = 3_600_000;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The last 30 days: how many came in, how fast they were answered (median hours), how
 * many became orders, and how long the oldest waiting one has waited.
 */
export function replyStats(rows, now) {
  const t = new Date(now).getTime();
  const recent = rows.filter((r) => t - Date.parse(r.created_at) <= 30 * 24 * HOUR);
  const replied = recent.filter((r) => r.replied_at).map((r) => (Date.parse(r.replied_at) - Date.parse(r.created_at)) / HOUR);
  const waiting = rows.filter((r) => r.status === 'new');
  const oldest = waiting.reduce((min, r) => Math.min(min, Date.parse(r.created_at)), Infinity);
  return {
    received: recent.length,
    medianReplyHours: median(replied),
    ordered: recent.filter((r) => r.status === 'ordered').length,
    waiting: waiting.length,
    oldestWaitingHours: Number.isFinite(oldest) ? (t - oldest) / HOUR : null,
  };
}

export async function getStoreAddress(db) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(STORE_TO_KEY).first();
  try {
    return row?.value ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<string | null>} an error to show, or null when saved */
export async function setStoreAddress(db, email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!EMAIL.test(value) || value.length > 120) return 'That email doesn’t look right.';
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(STORE_TO_KEY, JSON.stringify(value)).run();
  return null;
}
