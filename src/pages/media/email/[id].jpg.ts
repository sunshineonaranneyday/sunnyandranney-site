import type { APIRoute } from 'astro';
import { keyOf } from '@/lib/sunny-side/photo-store.mjs';

// A photo uploaded for the weekly email (/media/email/<id>.jpg/, photoPath), from the PHOTOS bucket. The
// email asks for it through Cloudflare's resizing on shop.sunnyandranney.com, which fetches it
// from here; the file never changes, so it caches for a year.
export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const id = /^[a-z0-9]{12,40}$/.test(params.id ?? '') ? params.id! : null;
  const file = id ? await locals.runtime.env.PHOTOS?.get(keyOf(id)) : null;
  if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(file.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: file.httpEtag },
  });
};
