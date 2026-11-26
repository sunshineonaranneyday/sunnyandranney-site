import { defineMiddleware } from 'astro:middleware';
import { authenticate } from '@/lib/admin-auth';
import { adminHostRedirect, frontDoor, frontDoorPath, inScope } from '@/lib/admin-host.mjs';

// Admin paths are matched case-insensitively and with repeated slashes made one (frontDoorPath), so
// a route can't be reached around this check by changing the URL's case. Handlers also check the role.

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    // Images may also come from the store's own Cloudflare Images account (the logo), from the
    // store's own Shopify files, where product photos live until they move to Cloudflare Images, and
    // from the domain's image resizing, which sends those files' PNGs as JPEGs (email.mjs, RESIZE).
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/ https://cdn.shopify.com/s/files/1/0930/2117/6092/ https://shop.sunnyandranney.com/cdn-cgi/image/; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function deny(isApi: boolean, status: number, message: string): Response {
  const headers = new Headers(SECURITY_HEADERS);
  if (isApi) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(message, { status, headers });
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) {
    const elsewhere = adminHostRedirect(context.url, context.request.method);
    if (elsewhere) return context.redirect(elsewhere, 302);
  }

  const path = frontDoorPath(context.url.pathname);
  const isApi = path.toLowerCase().startsWith('/api/');
  const host = context.url.hostname.toLowerCase();
  if (context.isPrerendered) return next();
  // The email address serves the weekly email and nothing else: not the store's own calls either.
  const door = frontDoor(host, path);
  if (door === 'refuse') return deny(isApi, 403, 'Not authorized');
  if (door === 'public') return next();

  const identity = await authenticate(context.request, context.locals.runtime?.env ?? {});
  if (!identity) return deny(isApi, 403, 'Not authorized');
  // Decided here, before any page runs, so a page added later is closed to an email-only login.
  if (!inScope(identity, host, path)) return deny(isApi, 403, 'Not authorized');

  const method = context.request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    if (context.request.headers.get('origin') !== context.url.origin) {
      return deny(isApi, 403, 'Cross-site request refused');
    }
  }

  context.locals.admin = identity;
  const response = await next();

  // _headers only covers static assets on Pages, so set these here.
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
});
