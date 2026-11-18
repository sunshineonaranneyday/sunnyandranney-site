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

// ── Reveals still ahead, for the story spot ─────────────────────────────────
// A week with a reveal coming can give the story spot to it: the charity's "join us live" invite,
// in its own words and photos, built like its own reveal email ("Join Us Live for Dylan’s Reveal
// Day!", Nov 16, 2026). The reveals are the ones the charity has a watch-live email for
// (reveal_watch_kit), and the day and time are the ones its own calendar file publishes
// (/api/reveals.ics), so a reveal shows only once the charity has set its time. The invite never
// carries the family's address: it's watched live on the charity's site.

const SOARD_SITE = 'https://sunshineonaranneyday.com';
export const livePage = (slug) => `${SOARD_SITE}/live/${slug}/`;
/** The charity's reveal calendar file, with the start time it publishes. */
export const revealIcs = (slug) => `${SOARD_SITE}/api/reveals.ics?kid=${slug}`;
/** Its "add to calendar" links: the day, the time and the link to watch, nothing else. Apple opens the file. */
export const revealCalendar = (slug, app = '') => `${SOARD_SITE}/api/calendar.ics?reveal=${slug}&watch=1${app ? `&app=${app}` : ''}`;

/** The start time a calendar file publishes, as an ISO time, or null: "DTSTART:20261118T210000Z". */
export function icsStart(ics) {
  const m = String(ics || '').match(/^DTSTART(?:;[^:\r\n]*)?:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\r?$/m);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

const ET = 'America/New_York';
/** An ISO time in the store's time zone: its day ("2026-11-18"), "Wednesday, November 18", "Wed, Nov 18" and "4:00 PM". */
export function easternParts(iso) {
  const at = new Date(iso);
  const f = (o) => new Intl.DateTimeFormat('en-US', { timeZone: ET, ...o }).format(at);
  const ymd = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    day: `${ymd.year}-${ymd.month}-${ymd.day}`,
    long: f({ weekday: 'long', month: 'long', day: 'numeric' }),
    short: f({ weekday: 'short', month: 'short', day: 'numeric' }),
    time: f({ hour: 'numeric', minute: '2-digit' }),
  };
}

/**
 * The reveals still ahead on `today` that the story spot can show, soonest first. `rows` are the
 * charity's watch-live reveals joined to its kids ({ slug, name, data }), `starts` each slug's start
 * time from its calendar file (ISO). One the charity hasn't timed, or that isn't published, is left out.
 * @returns {{ slug: string, name: string, start: string, day: string, long: string, short: string, time: string, room: string, photo: { src: string, alt: string }, story: string, page: string, live: string }[]}
 */
export function upcomingReveals(rows, starts, today) {
  const out = [];
  for (const row of rows) {
    const start = starts.get(row.slug);
    if (!start || !KID_SLUG.test(row.slug || '')) continue;
    let d;
    try {
      d = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (d.publishStatus && d.publishStatus !== 'published') continue;
    const when = easternParts(start);
    if (when.day < today) continue;
    const name = String(row.name || d.name || '').trim();
    const story = String(d.heroSummary || '').trim();
    // The photo the charity's own invite leads with: the one its page leads with. Its words say who it
    // is: the description the charity's gallery keeps for it was written to describe a photo, and read
    // a child out by wheelchair and expression ("a neutral expression" for a smiling boy, Nov 17, 2026)
    const lead = photosOf({ heroImage: d.heroImage, photos: d.photos }, '')[0];
    const photo = lead && { ...lead, alt: `${name}, before reveal day` };
    if (!name || !story || !photo) continue;
    const rooms = (Array.isArray(d.roomTypes) ? d.roomTypes : []).map((r) => String(r).trim()).filter(Boolean);
    out.push({ slug: row.slug, name, start, ...when, room: rooms.join(' & ') || 'Dream room', photo, story, page: kidPage(row.slug), live: livePage(row.slug) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Reads the reveals still ahead: the charity's database for who, its calendar files for when. Throws in words fit to show. */
export async function listUpcomingReveals(db, today, get = fetch) {
  if (!db) throw new Error('The site can’t read the charity’s reveals: it isn’t connected to the charity’s database.');
  let rows;
  try {
    ({ results: rows } = await db
      .prepare(
        `SELECT w.slug AS slug, k.name AS name, k.data AS data FROM reveal_watch_kit w JOIN kids k ON k.slug = w.slug
         WHERE w.reveal_date >= ? GROUP BY w.slug`,
      )
      .bind(today)
      .all());
  } catch (err) {
    throw new Error(`Couldn’t read the charity’s reveals (${err instanceof Error ? err.message : err}).`);
  }
  const starts = new Map();
  await Promise.all(
    (rows || []).map(async (r) => {
      if (!KID_SLUG.test(r.slug || '')) return;
      try {
        const res = await get(revealIcs(r.slug), { headers: { 'User-Agent': 'sunny-and-ranney-admin' }, signal: AbortSignal.timeout(6000) });
        const at = res.ok ? icsStart(await res.text()) : null;
        if (at) starts.set(r.slug, at);
      } catch {
        // Not timed on the charity's site yet, or it didn't answer: that reveal isn't offered
      }
    }),
  );
  return upcomingReveals(rows || [], starts, today);
}

/** The story spot as the reveal invite draws it, from the reveal picked. */
export function revealOf(r) {
  return {
    name: typeset(r.name),
    long: r.long,
    short: r.short,
    time: r.time,
    room: typeset(r.room),
    photo: r.photo,
    story: typeset(r.story),
    page: r.page,
    live: r.live,
    calendar: { google: revealCalendar(r.slug, 'google'), apple: revealCalendar(r.slug), outlook: revealCalendar(r.slug, 'outlook') },
  };
}
