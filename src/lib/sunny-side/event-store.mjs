/**
 * The store's events, kept in D1
 * ===========================================================================
 * One row per event (events.mjs), keyed by its address (kids-christmas-saturdays-2026), with its
 * last date so the ones still ahead can be found. The admin page reads and writes them, the site
 * serves each one's calendar file from here, and the weekly build reads them for the email.
 * Saving checks the version the page loaded, like the week's email.
 */

import { cleanEvent, lastDate, sortedDates } from './events.mjs';

const SCHEMA = `CREATE TABLE IF NOT EXISTS store_events (
  id TEXT PRIMARY KEY, event TEXT NOT NULL, first_date TEXT NOT NULL, last_date TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`;

const _ready = new WeakSet();
export async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  _ready.add(db);
}

/** @typedef {{ event: ReturnType<typeof cleanEvent>, updatedAt: string, updatedBy: string }} EventRecord */

/** @returns {EventRecord} */
const fromRow = (r) => ({ event: cleanEvent(JSON.parse(r.event)), updatedAt: r.updated_at, updatedBy: r.updated_by });

/** One event, or null. @returns {Promise<EventRecord | null>} */
export async function getEvent(db, id) {
  await ensureTable(db);
  const r = await db.prepare('SELECT * FROM store_events WHERE id = ?').bind(id).first();
  return r ? fromRow(r) : null;
}

/** Every event with a date on or after `from`, soonest first. @returns {Promise<EventRecord[]>} */
export async function eventsFrom(db, from) {
  await ensureTable(db);
  const { results } = await db.prepare('SELECT * FROM store_events WHERE last_date >= ? ORDER BY first_date, id').bind(from).all();
  return (results || []).map(fromRow);
}

/**
 * Saves a checked event. `since` is the updatedAt the page loaded, or null for a new event; a new
 * event whose address is taken, or one someone saved in between, changes nothing and comes back
 * with what's there now.
 */
export async function putEvent(db, { event, by, now, since }) {
  await ensureTable(db);
  const dates = sortedDates(event);
  const values = [JSON.stringify(event), dates[0].date, lastDate(event), now, by];
  const result =
    since === null
      ? await db
          .prepare('INSERT INTO store_events (event, first_date, last_date, updated_at, updated_by, id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
          .bind(...values, event.id)
          .run()
      : await db
          .prepare('UPDATE store_events SET event = ?, first_date = ?, last_date = ?, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?')
          .bind(...values, event.id, since)
          .run();
  if (result.meta.changes === 1) return { ok: true, record: { event, updatedAt: now, updatedBy: by } };
  return { ok: false, current: await getEvent(db, event.id) };
}

/** Takes an event away, if it's still the version the page loaded. */
export async function deleteEvent(db, { id, since }) {
  await ensureTable(db);
  const result = await db.prepare('DELETE FROM store_events WHERE id = ? AND updated_at = ?').bind(id, since).run();
  if (result.meta.changes === 1) return { ok: true };
  return { ok: false, current: await getEvent(db, id) };
}
