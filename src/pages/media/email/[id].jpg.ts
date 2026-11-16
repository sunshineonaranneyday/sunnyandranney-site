import type { APIRoute } from 'astro';
import { keyOf } from '@/lib/sunny-side/photo-store.mjs';

// A photo uploaded for the weekly email (/media/email/<id>.jpg), from the PHOTOS bucket. The
// email asks for it through Cloudflare's resizing on shop.sunnyandranney.com, which fetches it
// from here; the file never changes, so it caches for a year.
export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  // From the address itself: the middleware's rewrite to "<id>.jpg/" doesn't carry the route's params
  const id = url.pathname.match(/^\/media\/email\/([a-z0-9]{12,40})\.jpg\/?$/)?.[1];
  const file = id ? await locals.runtime.env.PHOTOS?.get(keyOf(id)) : null;
  if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(file.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: file.httpEtag },
  });
};
