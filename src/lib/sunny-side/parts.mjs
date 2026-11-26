/**
 * The rest of the weekly email, set in the admin beside the sale, products and events
 * ===========================================================================
 * The subject and preview line, the top photo, the story (its words and a collage of the week's
 * store photos), a charity reveal still ahead, if any, and which of the charity's kids the charity section shows (kids.mjs: picked from
 * a list, never written at the store). With these in the admin the page holds the whole email,
 * so it can put the finished email into Kit as a draft (kit.mjs). Photos are the store's own
 * uploads (photo-store.mjs), referred to by id. No Node or browser APIs: the page, the server and
 * the tests share it.
 */

import { fillLine, lines, offerClaims, plain } from './email.mjs';
import { LAYOUT_ID, layoutFor, ratioOf } from './collage-layouts.mjs';
import { KID_PHOTO, KID_SLUG, kidFor, missionOf, revealOf } from './kids.mjs';
import { withFocus } from './photo-store.mjs';
import { typeset } from './special.mjs';

export const PART_LIMITS = { subject: 80, preheader: 110, label: 40, headline: 70, body: 320, cta: 30 };
export const COLLAGE_MAX = 5;
export const PHOTO_ID = /^[a-z0-9]{12,40}$/;

/**
 * The sections an email can go without (Peter, 2026-11-25: "id also like the abiliyt to turn off
 * sections"), by the page's name for each, and the email's sections (email.mjs SECTIONS) each one
 * takes out: the sale, the products, the photos (the top photo and the collage), the events and the
 * charity. The masthead, the visit row and the footer, with its unsubscribe link, always go. A
 * section that's off keeps what's set in it, so turning it back on brings it back, and nothing in
 * it has to be finished for the email to save or go.
 */
export const SWITCHES = { sale: ['offer'], products: ['wall'], photos: ['hero', 'story'], events: ['events'], charity: ['mission'] };

/** True when the email has the section `key` (SWITCHES) turned off. */
export const isOff = (p, key) => Array.isArray(p?.off) && p.off.includes(key);

/** The email's sections (email.mjs SECTIONS) the parts turn off. */
export const sectionsOff = (p) => (Array.isArray(p?.off) ? p.off : []).flatMap((k) => SWITCHES[k] ?? []);

/**
 * The sale as the subject line is checked against when the sale is off: no discount, so {offer} and
 * {upto} have nothing to say and no percent is one it gives (email.mjs offerClaims).
 */
export const NO_SALE = Object.freeze({ kind: 'none' });

/** The store's wide shot, until the week has its own top photo. */
export const DEFAULT_HERO = { src: 'cf:sunny-ranney-interior', alt: 'The Sunny & Ranney showroom floor' };
export const STORY_DEFAULTS = { label: 'This week in the showroom', cta: 'Plan your visit', link: '/visit/' };

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 20);
const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, max + 40);
const photoId = (v) => (typeof v === 'string' && PHOTO_ID.test(v) ? v : '');
const revealSlug = (v) => (typeof v === 'string' && KID_SLUG.test(v) ? v : '');

/** Parts as typed: known fields only, trimmed, a few over the limit kept so the check can say so. */
export function cleanParts(p) {
  const s = p?.story ?? {};
  return {
    subject: str(p?.subject, PART_LIMITS.subject),
    preheader: str(p?.preheader, PART_LIMITS.preheader),
    hero: photoId(p?.hero),
    story: {
      label: str(s.label, PART_LIMITS.label),
      headline: str(s.headline, PART_LIMITS.headline),
      body: text(s.body, PART_LIMITS.body),
      cta: str(s.cta, PART_LIMITS.cta),
      link: str(s.link, 200),
      photos: [...new Set((Array.isArray(s.photos) ? s.photos : []).map(photoId).filter(Boolean))].slice(0, COLLAGE_MAX + 2),
      // The collage's layout (collage-layouts.mjs), or '' for the one that fits her photos best
      layout: typeof s.layout === 'string' && LAYOUT_ID.test(s.layout) ? s.layout : '',
    },
    // A charity reveal still ahead (its kid's slug): the charity's invite to watch it live, in the
    // charity's words, its own section under the story. '' for none. The story and the reveal are each
    // their own section (Peter, 2026-11-17: "its not a either or"); a week saved while the reveal took
    // the story's place kept it in the story (story.reveal), and both now show.
    reveal: revealSlug(p?.reveal ?? s.reveal),
    // '' shows the charity's most recent reveal
    kid: typeof p?.kid === 'string' && KID_SLUG.test(p.kid) ? p.kid : '',
    // One of that family's photos ("cf:" id), or '' for their finished room
    kidPhoto: typeof p?.kidPhoto === 'string' && KID_PHOTO.test(p.kidPhoto) ? p.kidPhoto : '',
    // The sections turned off (SWITCHES), in their own order
    off: Object.keys(SWITCHES).filter((k) => Array.isArray(p?.off) && p.off.includes(k)),
  };
}

export const blankParts = () => cleanParts({});

const over = (v, max, what) => (v.length > max ? `${what} is ${v.length} characters; keep it to ${max}.` : '');

/**
 * What's wrong with the parts, keyed by field, or {}. `ready` asks for what the finished email
 * needs (the subject); without it, only what's typed is checked, so the week
 * can be saved as it's built up. `photos` is the library (id → photo), to check the ids exist.
 */
/**
 * @param {ReturnType<typeof cleanParts>} p
 * @param {{ sale?: any, photos?: Map<string, any> | null, kids?: any[] | null, reveals?: any[] | null, ready?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function checkParts(p, { sale = null, photos = null, kids = null, reveals = null, ready = false } = {}) {
  /** @type {Record<string, string>} */
  const e = {};
  const set = (k, msg) => msg && (e[k] = msg);
  set('subject', over(p.subject, PART_LIMITS.subject, 'The subject line'));
  set('preheader', over(p.preheader, PART_LIMITS.preheader, 'The preview line'));
  if (ready && !p.subject) e.subject = 'Write the subject line: it’s what people see first in their inbox.';
  if (sale && !e.subject && !e.preheader) {
    // The same check the build makes: no promise the offer doesn't give. A week with no sale has
    // nothing for {offer} or {upto} to write, which is said here, beside the field, never thrown.
    for (const [k, line] of [['subject', p.subject], ['preheader', p.preheader]]) {
      let filled;
      try {
        filled = fill(line, sale);
      } catch {
        e[k] = `This week has no sale, so ${/\{upto\}/.test(line) ? '{upto}' : '{offer}'} has nothing to say. Take it out, or pick a sale.`;
        continue;
      }
      const claims = offerClaims(filled, sale, k);
      // Each claim is its own sentence ("The subject says 50%, but the sale gives 20%."): "It says" before them read "It says The subject says"
      if (claims.length) e[k] = `${claims.join(' ')} Change the words, or use {offer} and the email writes the sale for you.`;
    }
  }
  const s = p.story;
  // No words to check: the story's words are gone (Peter, 2026-11-17: "i want the "story" fuckong
  // gone"); what's left of it is the collage, in Photos, and a week can go without one
  if (p.reveal && reveals && !reveals.some((r) => r.slug === p.reveal)) {
    e.reveal = reveals.length ? 'That reveal isn’t coming up anymore. Pick another, or no reveal.' : 'The charity’s reveals didn’t load. Reload the page, or pick no reveal.';
  }
  if (s.photos.length > COLLAGE_MAX) e['story.photos'] = `The collage holds ${COLLAGE_MAX} photos at most. Take ${s.photos.length - COLLAGE_MAX} out.`;
  // A section that's off goes without its photos and its family, so nothing in it holds the email up
  if (photos && !isOff(p, 'photos')) {
    const used = [p.hero, ...s.photos];
    const gone = used.filter((id) => id && !photos.has(id));
    if (gone.length) e.photos = 'A photo this email uses isn’t in the library anymore. Pick another.';
    const noAlt = used.filter((id) => id && photos.get(id) && !photos.get(id).alt);
    if (noAlt.length) e.photos = `${noAlt.length === 1 ? 'A photo' : `${noAlt.length} photos`} in the email need${noAlt.length === 1 ? 's' : ''} a few words saying what’s in ${noAlt.length === 1 ? 'it' : 'them'}, for people who can’t see images.`;
  }
  if (kids && !isOff(p, 'charity')) {
    if (!kids.length) e.kid = 'The charity’s kids didn’t load, so the charity section can’t be drawn. Reload the page to try again.';
    else if (p.kid && !kids.some((k) => k.slug === p.kid)) e.kid = 'That family isn’t on the charity’s site anymore. Pick another.';
  }
  return e;
}

const fill = (line, sale) => fillLine(line, sale);

/**
 * The subject and preview line as they'll go out, {offer} and {upto} written from the sale. An empty
 * preview line says the sale; in a week with no sale it stays empty, so the subject still goes out
 * as written.
 */
export function linesOf(p, sale) {
  const discount = sale?.kind === 'tiers' || sale?.kind === 'percent';
  const preheader = p.preheader || (discount ? '{offer}' : '');
  try {
    return lines({ subject: p.subject, preheader, sale });
  } catch {
    return { subject: p.subject, preheader };
  }
}

/**
 * The parts as the email draws them. `photos` maps an id to its library record ({ alt, w, h, focus });
 * `photoSrc` makes an id into the email's photo source, which carries the photo's focus point
 * ("photo:<id>@0.42x0.31") so every crop keeps that part in view (Email.photo).
 */
/**
 * @param {ReturnType<typeof cleanParts>} p
 * @param {{ sale: any, photos: Map<string, any>, kids?: any[], reveals?: any[], photoSrc?: (id: string) => string }} opts
 */
export function briefParts(p, { sale, photos, kids = [], reveals = [], photoSrc = (id) => `photo:${id}` }) {
  // Alt text stays plain: the email escapes it where it draws the photo
  const pic = (id) => ({ src: withFocus(photoSrc(id), photos.get(id)?.focus), alt: photos.get(id)?.alt || '' });
  const s = p.story;
  const collage = collageOf(s, photos, pic);
  const kid = kidFor(p.kid, kids);
  const reveal = p.reveal ? reveals.find((r) => r.slug === p.reveal) : null;
  const { subject, preheader } = linesOf(p, sale);
  return {
    // Plain text with curly quotes as characters: the email escapes these once where it writes them
    // (its <title> and hidden preview line), and Kit takes them as plain text. As HTML they were
    // escaped twice, and an inbox showed "kids&#8217;".
    subject: plain(typeset(subject)),
    preheader: plain(typeset(preheader)),
    hero: p.hero && photos.has(p.hero) ? pic(p.hero) : DEFAULT_HERO,
    // Only the collage: words a week saved before Nov 17, 2026 still holds never go out
    story: collage.photos.length ? { link: STORY_DEFAULTS.link, ...collage } : null,
    reveal: reveal ? revealOf(reveal) : null,
    mission: kid ? missionOf(kid, p.kidPhoto) : null,
  };
}

/**
 * The story's photos and the layout the email draws them in: the one she picked while it's made for
 * this many photos, else the one that keeps the most of them (collage-layouts.mjs, layoutFor).
 */
function collageOf(s, photos, pic) {
  const ids = s.photos.filter((id) => photos.has(id)).slice(0, COLLAGE_MAX);
  if (!ids.length) return { photos: [] };
  return { photos: ids.map(pic), layout: layoutFor(s.layout, ids.map((id) => ratioOf(photos.get(id)))).id };
}

/** The collage in the order the email draws it, arranged for her: the widest photo leads. */
export function arrangeCollage(ids, photos) {
  const ratio = (id) => (photos.get(id)?.w || 1) / (photos.get(id)?.h || 1);
  if (ids.length < 3) return ids;
  const lead = ids.reduce((best, id) => (ratio(id) > ratio(best) ? id : best), ids[0]);
  return [lead, ...ids.filter((id) => id !== lead)];
}
