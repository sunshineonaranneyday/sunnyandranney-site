/**
 * The site's own addresses for the files the weekly email points at
 * ===========================================================================
 * The site uses `trailingSlash: 'always'`, and on Cloudflare an on-demand route matches only at
 * its address with the slash: "/media/email/<id>.jpg" matches nothing and gets the 404 page before
 * any middleware can step in. The dev server is more forgiving, which hid this until the first
 * deploy (2026-11-16). So every file the email points at on this site is addressed with its slash,
 * from here, and a test checks that every address on the site an email holds ends in one.
 * Calendar apps and Cloudflare's resizing go by the file's type and name (Content-Type,
 * Content-Disposition), not by how the address ends.
 */

/** An uploaded photo (src/pages/media/email/[id].jpg.ts). */
export const photoPath = (id) => `/media/email/${id}.jpg/`;

/**
 * A store event's calendar file: every date still ahead, or one date
 * (src/pages/events/[id].ics.ts, src/pages/events/[id]/[date].ics.ts).
 */
export const icsUrl = (site, id, date = '') => `${site}/events/${id}${date ? `/${date}` : ''}.ics/`;
