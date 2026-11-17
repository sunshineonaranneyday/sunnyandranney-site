/**
 * The charity's kids, for the email's charity section
 * ===========================================================================
 * The section shows one family's makeover, in the charity's own words and photo: nobody at the
 * store writes any of it. Staci picks the kid from a list; it starts on the most recent reveal.
 * The list comes from the charity's own database (soard-db, bound to this site as SOARD_DB and
 * only ever read): its published kids, each with the photo and summary its site shows.
 *
 * "Most recent reveal": the latest reveal date the charity has on record that has passed (its
 * reveal invites keep them, from November 2026 on). Reveals from before it kept dates are dated
 * by the day their photos went up, which the charity's photo ids carry (a 13-digit time in ms).
 * The photo starts on the finished room (the charity's own "after" photo), since the section's
 * line is "Every purchase builds a dream room"; she can pick any photo from the family's page.
 * No Node or browser APIs: the page, the server and the tests share it.
 */

import { typeset } from './special.mjs';

const CF_PREFIX = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/';
export const kidPage = (slug) => `https://sunshineonaranneyday.com/kids/${slug}/`;
export const KID_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** A Cloudflare Images address as the email's "cf:" source, without its variant: kids/x/1-a.jpg/public → kids/x/1-a.jpg. */
export function cfIdOf(url) {
  if (typeof url !== 'string' || !url.startsWith(CF_PREFIX)) return null;
  const parts = url.slice(CF_PREFIX.length).split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null;
}

/** "accessible bathroom", "dream bedroom and accessible bathroom", "chair lift, dream bedroom and accessible bathroom" */
export function roomsPhrase(rooms) {
  const r = (Array.isArray(rooms) ? rooms : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (r.length <= 1) return r[0] || 'room';
  return `${r.slice(0, -1).join(', ')} and ${r.at(-1)}`;
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** How many of a family's photos the page offers: the charity's galleries run 11 to 48. */
export const KID_PHOTOS = 24;
/** A family photo as the email keeps it: "cf:" and its Cloudflare Images id. */
export const KID_PHOTO = /^cf:kids\/[a-z0-9-]+\/[A-Za-z0-9._-]{1,120}$/;

/**
 * The family's photos, the finished room first: its "after" photos (marked `after`), then the photo
 * its page leads with, its accent photo and the rest of its gallery, each once.
 */
export function photosOf(d, fallbackAlt) {
  const alts = new Map((Array.isArray(d.photos) ? d.photos : []).filter((p) => p && typeof p === 'object').map((p) => [cfIdOf(p.url), p.alt]));
  const seen = new Set();
  const out = [];
  const add = (url, alt, after = false) => {
    const id = cfIdOf(url);
    if (!id || seen.has(id) || !KID_PHOTO.test(`cf:${id}`)) return;
    seen.add(id);
    out.push({ src: `cf:${id}`, alt: String(alt || alts.get(id) || fallbackAlt).trim().slice(0, 160), ...(after ? { after: true } : {}) });
  };
  for (const b of Array.isArray(d.beforeAfterPhotos) ? d.beforeAfterPhotos : []) add(b?.after, b?.afterAlt, true);
  add(d.heroImage);
  add(d.accentImage);
  for (const p of Array.isArray(d.photos) ? d.photos : []) add(typeof p === 'string' ? p : p?.url, p?.alt);
  return out.slice(0, KID_PHOTOS);
}

/** The day the kid's newest photo went up, from the time in its id, or null. */
export function photosDate(photos) {
  const stamps = (Array.isArray(photos) ? photos : [])
    .map((p) => String(typeof p === 'string' ? p : p?.url || p?.id || ''))
    .map((u) => Number(u.match(/\/(\d{13})-/)?.[1]))
    .filter((n) => n > 1.5e12 && n < 4e12);
  return stamps.length ? dayOf(Math.max(...stamps)) : null;
}

/**
 * The kids the section can show, most recent reveal first. `rows` are soard-db's kids rows
 * ({ slug, name, status, data }), `reveals` its recorded reveal dates ({ slug, d }).
 * @returns {{ slug: string, name: string, page: string, photo: { src: string, alt: string, after?: true }, photos: { src: string, alt: string, after?: true }[], caption: string, story: string, revealedOn: string | null, dated: 'recorded' | 'photos' | null }[]}
 */
export function revealedKids(rows, reveals, today) {
  const recorded = new Map(reveals.filter((r) => r.slug && r.d && r.d <= today).map((r) => [r.slug, r.d]));
  const out = [];
  for (const row of rows) {
    let d;
    try {
      d = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (d.publishStatus && d.publishStatus !== 'published') continue;
    const revealed = row.status === 'completed' || recorded.has(row.slug);
    const src = cfIdOf(d.heroImage);
    const story = String(d.heroSummary || '').trim();
    if (!revealed || !src || !story || !KID_SLUG.test(row.slug)) continue;
    const name = String(row.name || d.name || '').trim();
    const where = roomsPhrase(d.roomTypes);
    const photos = photosOf(d, `${name}’s new ${where}`);
    if (!photos.length) continue;
    const onRecord = recorded.get(row.slug) ?? null;
    const byPhotos = photosDate(d.photos);
    out.push({
      slug: row.slug,
      name,
      page: kidPage(row.slug),
      photo: photos[0],
      photos,
      caption: `${name}’s new ${where}.`,
      story,
      revealedOn: onRecord ?? byPhotos,
      dated: onRecord ? 'recorded' : byPhotos ? 'photos' : null,
    });
  }
  return out.sort((a, b) => String(b.revealedOn ?? '').localeCompare(String(a.revealedOn ?? '')) || a.name.localeCompare(b.name));
}

/** Reads the charity's kids from its database. Throws in words fit to show when it can't. */
export async function listRevealedKids(db, today) {
  if (!db) throw new Error('The site can’t read the charity’s kids: it isn’t connected to the charity’s database.');
  try {
    const [{ results: rows }, { results: reveals }] = await db.batch([
      db.prepare('SELECT slug, name, status, data FROM kids'),
      db.prepare(
        `SELECT slug, MAX(reveal_date) AS d FROM (
           SELECT slug, reveal_date FROM reveal_invite_kit UNION ALL SELECT slug, reveal_date FROM reveal_watch_kit
         ) WHERE slug IS NOT NULL AND reveal_date <= ? GROUP BY slug`,
      ).bind(today),
    ]);
    return revealedKids(rows || [], reveals || [], today);
  } catch (err) {
    throw new Error(`Couldn’t read the charity’s kids (${err instanceof Error ? err.message : err}).`);
  }
}

/** The kid the email shows: the one picked, or the most recent reveal. */
export const kidFor = (slug, kids) => (slug && kids.find((k) => k.slug === slug)) || kids[0] || null;

/** The family photo the email shows: the one picked, if it's still on their page, else the finished room. */
export const kidPhotoFor = (src, kid) => (src && kid.photos?.find((p) => p.src === src)) || kid.photo;

/** The charity section as the email draws it, from the kid and the photo picked, in the charity's words. */
export function missionOf(kid, photo = '') {
  return { photo: kidPhotoFor(photo, kid), name: typeset(kid.name), caption: typeset(kid.caption), story: typeset(kid.story), cta: 'See their story', url: kid.page };
}
