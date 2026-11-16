import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkRateLimit } from '@/lib/db';
import { KEEP_DAYS, MAX_BODY, cleanSearchEvent } from '@/lib/search/log.mjs';

export const prerender = false;

/**
 * Counts a site search or a click on one of its results, for the admin's Search page
 * (src/lib/search/log.mjs says what's kept). Sent by the site's own pages with
 * navigator.sendBeacon, which never reads the answer, so every answer is an empty 204:
 * a bad or refused event is dropped quietly, and a broken log never breaks a search.
 */
export const POST: APIRoute = async ({ request, clientAddress, url }) => {
  const done = new Response(null, { status: 204 });
  // Only this site's pages log searches.
  if (request.headers.get('origin') !== url.origin) return done;
  // An event is a few hundred bytes: anything bigger isn't one, and isn't read.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return done;
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return done;
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return done; }
  const row = cleanSearchEvent(body);
  if (!row) return done;

  // 300 events an hour from one address is far beyond a shopper. The limiter keys on a
  // one-way hash of the address, kept an hour, so no address is stored.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`search-log:${clientAddress}`));
  const key = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!(await checkRateLimit(`search-log:${key}`, 300, 3600))) return done;

  try {
    await env.DB.prepare(
      'INSERT INTO search_events (at, kind, query, results, handle, position, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(new Date().toISOString(), row.kind, row.query, row.results, row.handle, row.position, row.source).run();
    // Now and then, rows past their time go.
    if (Math.random() < 0.01) {
      await env.DB.prepare('DELETE FROM search_events WHERE at < ?')
        .bind(new Date(Date.now() - KEEP_DAYS * 86400000).toISOString())
        .run();
    }
  } catch (err) {
    console.error('search-log: not saved', err instanceof Error ? err.message : err);
  }
  return done;
};
