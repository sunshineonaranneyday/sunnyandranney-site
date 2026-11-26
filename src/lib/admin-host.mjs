/**
 * The admin lives at its own address, admin.sunnyandranney.com. Cloudflare
 * Access guards that whole host. The store's own addresses skip Cloudflare's
 * proxy, so Access can't guard them, and the admin there would only ever
 * refuse everyone.
 *
 * The weekly email also has an address of its own, email.sunnyandranney.com,
 * for people who help with the email and nothing else. It has its own Access
 * application, so its sign-ins are a different token (another audience) that
 * the admin's address never accepts, and Access refuses those people at the
 * admin's address before any of this code runs. Here, that address serves the
 * weekly email and nothing else, whoever signs in.
 */
export const ADMIN_HOST = 'admin.sunnyandranney.com';
export const EMAIL_HOST = 'email.sunnyandranney.com';
const STORE_HOSTS = new Set(['sunnyandranney.com', 'www.sunnyandranney.com']);
const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/i;
const EMAIL_PATH = /^\/(api\/)?admin\/email(\/|$)/i;
const EMAIL_HOME = `https://${EMAIL_HOST}/admin/email/`;

/** The weekly email's page, or one of the calls it makes. */
export const isEmailPath = (path) => EMAIL_PATH.test(path);

/**
 * The path as the front door checks it: decoded, and with repeated slashes made one, since
 * Astro finds /admin/staff/ for "//admin/staff/" (it drops a leading slash before matching).
 * @param {string} pathname
 */
export function frontDoorPath(pathname) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Not valid percent-encoding: check it as it came.
  }
  return path.replace(/\/{2,}/g, '/');
}

/**
 * What the front door does before it asks who's there: 'refuse' anything but the weekly email on
 * the email address; let 'public' pages through (they aren't the admin); or 'sign-in' for the admin,
 * where who's asking is checked next, then inScope.
 * @param {string} host lower case
 * @param {string} path from frontDoorPath
 * @returns {'refuse' | 'public' | 'sign-in'}
 */
export function frontDoor(host, path) {
  if (host === EMAIL_HOST && !isEmailPath(path)) return 'refuse';
  return ADMIN_PATH.test(path) ? 'sign-in' : 'public';
}

/**
 * Whether a signed-in person may reach this path at all, decided in the
 * middleware before any page runs; each page then checks the role again.
 * On the email address, and for an email-only login anywhere, that's the
 * weekly email alone, so a page added later is closed to them by default.
 * @param {{ role: string }} who
 * @param {string} host lower case
 * @param {string} path decoded
 */
export function inScope(who, host, path) {
  if (host === EMAIL_HOST || who.role === 'email') return isEmailPath(path);
  return true;
}

/**
 * Where to send a request instead, or null to handle it here.
 * - The admin host opens on the admin. Prebuilt pages, the home page included,
 *   never reach this code, so a zone redirect rule covers `/` on that host.
 * - The email host opens on the weekly email, from any page that isn't it
 *   (a zone redirect rule covers its `/` the same way).
 * - An admin page asked for on a store address goes to the admin host.
 * API calls and form posts are never redirected; they get the usual refusal.
 */
export function adminHostRedirect(url, method) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const host = url.hostname.toLowerCase();
  // As the front door sees it, so "//admin/staff/" goes where "/admin/staff/" does
  const path = frontDoorPath(url.pathname);
  const isAdminPath = ADMIN_PATH.test(path);
  if (host === EMAIL_HOST) {
    if (isEmailPath(path)) return null;
    return path.toLowerCase().startsWith('/api/') ? null : EMAIL_HOME;
  }
  if (host === ADMIN_HOST) return isAdminPath ? null : `https://${ADMIN_HOST}/admin/`;
  if (STORE_HOSTS.has(host) && isAdminPath && !path.toLowerCase().startsWith('/api/')) {
    return `https://${ADMIN_HOST}${url.pathname.replace(/\/{2,}/g, '/')}${url.search}`;
  }
  return null;
}
