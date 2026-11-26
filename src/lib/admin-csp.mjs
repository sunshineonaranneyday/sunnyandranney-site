/**
 * The admin's Content-Security-Policy (middleware.ts), and where its images may come from.
 *
 * Images may come from:
 * - the store's own Cloudflare Images account (the logo, product photos)
 * - the store's own Shopify files, where product photos live until they move to Cloudflare Images
 * - the domain's image resizing, which sends those files' PNGs as JPEGs (email.mjs, RESIZE)
 * - Kit, for the emails written in Kit's own editor, as they went out (/admin/email/sent/<id>/):
 *   their photos (embed.filekitcdn.com), the social icons Kit draws (functions-js.kit.com/icons)
 *   and its own images: the "Built with Kit" badge, and the grey placeholder its layouts set behind a
 *   photo, which shows where the photo doesn't fill its cell (the Nov 3 email). cdn.convertkit.com
 *   sends these on to cdn.kit.com (a 301, and a redirect is held to this list too). Without these,
 *   the Nov 3 and Nov 10, 2026 emails showed every picture broken. Only these paths: nothing else of
 *   Kit's loads.
 */
export const IMG_SOURCES = [
  "'self'",
  'data:',
  'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/',
  'https://cdn.shopify.com/s/files/1/0930/2117/6092/',
  'https://shop.sunnyandranney.com/cdn-cgi/image/',
  'https://embed.filekitcdn.com/',
  'https://functions-js.kit.com/icons',
  'https://cdn.convertkit.com/assets/',
  'https://cdn.kit.com/assets/',
];

export const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${IMG_SOURCES.join(' ')}`,
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Whether an image at `url` may load under IMG_SOURCES, matched the way browsers match a CSP source
 * (a path ending in "/" covers everything under it; one that doesn't is that path only; the query
 * doesn't count). `self` is the admin's own origin.
 */
export function imageAllowed(url, self = 'https://admin.sunnyandranney.com') {
  let u;
  try {
    u = new URL(url, self);
  } catch {
    return false;
  }
  if (u.protocol === 'data:') return IMG_SOURCES.includes('data:');
  return IMG_SOURCES.some((s) => {
    if (s === "'self'") return u.origin === new URL(self).origin;
    if (!s.startsWith('https://')) return false;
    const src = new URL(s);
    if (u.origin !== src.origin) return false;
    return src.pathname.endsWith('/') ? u.pathname.startsWith(src.pathname) : u.pathname === src.pathname;
  });
}
