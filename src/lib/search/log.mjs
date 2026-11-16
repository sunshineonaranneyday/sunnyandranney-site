/**
 * The site search's log (migrations/0013_search_events.sql): what /api/search-log keeps
 * from a shopper's search, and what the admin's Search page reads back.
 *
 * Kept: the words (lowercase, anything like an email address or a phone number taken out),
 * how many pieces they found, and which piece was opened from where. Nothing about who.
 */

const HANDLE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const MAX_QUERY = 120;
/** The largest event a page sends is under 300 bytes. */
export const MAX_BODY = 2048;
/** How long rows are kept. */
export const KEEP_DAYS = 180;

/** A search's words as the log keeps them, or '' when nothing's left. */
export function cleanQuery(raw) {
  // Cut first: the patterns below are slow on very long text, and a search is never this long.
  return String(raw ?? '')
    .slice(0, 500)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '(email)')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '(number)')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY)
    .trim();
}

const count = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/**
 * A row for search_events from what a page sent, or null when it isn't one.
 * @param {unknown} body  { e: 'search', q, n, src: 'page' } or { e: 'click', q, h, p, src: 'page' | 'panel' }
 */
export function cleanSearchEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  const query = cleanQuery(b.q);
  if (!query) return null;
  if (b.e === 'search') {
    const results = count(b.n, 100000);
    if (results === null || b.src !== 'page') return null;
    return { kind: 'search', query, results, handle: null, position: null, source: 'page' };
  }
  if (b.e === 'click') {
    const position = count(b.p, 10000);
    const handle = typeof b.h === 'string' && HANDLE.test(b.h) ? b.h : null;
    if (!handle || !position || (b.src !== 'page' && b.src !== 'panel')) return null;
    return { kind: 'click', query, results: null, handle, position, source: b.src };
  }
  return null;
}

/**
 * The admin's Search page: the last `days` of searches.
 * @param {D1Database} db
 * @param {{ days?: number, now?: Date }} [options]
 */
export async function searchReport(db, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  // A search is a results page, or a piece opened straight from the box's suggestions.
  const [totals, top, none] = await db.batch([
    db.prepare(
      `SELECT SUM(kind = 'search' OR (kind = 'click' AND source = 'panel')) AS searches,
              SUM(kind = 'search' AND results = 0) AS found_nothing,
              SUM(kind = 'click') AS opened,
              COUNT(DISTINCT query) AS different
         FROM search_events WHERE at >= ?1`,
    ).bind(since),
    db.prepare(
      `SELECT query,
              SUM(kind = 'search' OR (kind = 'click' AND source = 'panel')) AS searches,
              SUM(kind = 'click') AS opened,
              (SELECT results FROM search_events s
                 WHERE s.query = e.query AND s.kind = 'search' ORDER BY s.at DESC LIMIT 1) AS results,
              MAX(at) AS last
         FROM search_events e WHERE at >= ?1
        GROUP BY query ORDER BY searches DESC, last DESC LIMIT 40`,
    ).bind(since),
    db.prepare(
      `SELECT query, COUNT(*) AS searches, MAX(at) AS last
         FROM search_events WHERE kind = 'search' AND results = 0 AND at >= ?1
        GROUP BY query ORDER BY searches DESC, last DESC LIMIT 40`,
    ).bind(since),
  ]);
  const t = /** @type {any} */ (totals.results?.[0] ?? {});
  return {
    since,
    totals: { searches: t.searches ?? 0, foundNothing: t.found_nothing ?? 0, opened: t.opened ?? 0, different: t.different ?? 0 },
    top: /** @type {Array<{ query: string, searches: number, opened: number, results: number | null, last: string }>} */ (top.results ?? []),
    foundNothing: /** @type {Array<{ query: string, searches: number, last: string }>} */ (none.results ?? []),
  };
}
