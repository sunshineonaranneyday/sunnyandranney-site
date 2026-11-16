/**
 * What search remembers. Recent searches stay on the shopper's own device (localStorage).
 * What the store learns is only the words searched, how many pieces they found and which
 * piece was opened: no name, address, cookie or IP (see /api/search-log). The admin's Search
 * page lists the searches that found nothing, so the lexicon can learn the store's words.
 */
const RECENT_KEY = 'sr_recent_searches';

export function recentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(q: string): void {
  const v = q.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!v) return;
  try {
    const next = [v, ...recentSearches().filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage off: nothing to remember */ }
}

export type SearchEvent =
  | { e: 'search'; q: string; n: number; src: 'page' }
  | { e: 'click'; q: string; h?: string; p: number; src: 'panel' | 'page' };

/** Counts one search or click for the admin's Search page. Never waits, never fails loudly. */
export function logSearch(event: SearchEvent): void {
  const url = '/api/search-log/';
  const json = JSON.stringify(event);
  let sent = false;
  try {
    sent = navigator.sendBeacon?.(url, new Blob([json], { type: 'application/json' })) ?? false;
  } catch { /* some browsers refuse a JSON beacon: send it the other way */ }
  if (!sent) {
    try {
      void fetch(url, { method: 'POST', body: json, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
    } catch { /* logging is never worth an error */ }
  }
}
