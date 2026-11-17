/**
 * The rest of the weekly email, set in the admin beside the sale, products and events
 * ===========================================================================
 * The subject and preview line, the top photo, the story (its words and a collage of the week's
 * store photos) and which of the charity's kids the charity section shows (kids.mjs: picked from
 * a list, never written at the store). With these in the admin the page holds the whole email,
 * so it can put the finished email into Kit as a draft (kit.mjs). Photos are the store's own
 * uploads (photo-store.mjs), referred to by id. No Node or browser APIs: the page, the server and
 * the tests share it.
 */

import { fillLine, lines, offerClaims, plain } from './email.mjs';
import { KID_PHOTO, KID_SLUG, kidFor, missionOf } from './kids.mjs';
import { typeset } from './special.mjs';

export const PART_LIMITS = { subject: 80, preheader: 110, label: 40, headline: 70, body: 320, cta: 30 };
export const COLLAGE_MAX = 5;
export const PHOTO_ID = /^[a-z0-9]{12,40}$/;

/** The store's wide shot, until the week has its own top photo. */
export const DEFAULT_HERO = { src: 'cf:sunny-ranney-interior', alt: 'The Sunny & Ranney showroom floor' };
export const STORY_DEFAULTS = { label: 'This week in the showroom', cta: 'Plan your visit', link: '/visit/' };

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 20);
const text = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, max + 40);
const photoId = (v) => (typeof v === 'string' && PHOTO_ID.test(v) ? v : '');

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
    },
    // '' shows the charity's most recent reveal
    kid: typeof p?.kid === 'string' && KID_SLUG.test(p.kid) ? p.kid : '',
    // One of that family's photos ("cf:" id), or '' for their finished room
    kidPhoto: typeof p?.kidPhoto === 'string' && KID_PHOTO.test(p.kidPhoto) ? p.kidPhoto : '',
  };
}

export const blankParts = () => cleanParts({});

const over = (v, max, what) => (v.length > max ? `${what} is ${v.length} characters; keep it to ${max}.` : '');
const isStorePath = (v) => /^\/[a-z0-9\-/_]*$/i.test(v) && !v.startsWith('//');

/**
 * What's wrong with the parts, keyed by field, or {}. `ready` asks for what the finished email
 * needs (the subject, the story's words); without it, only what's typed is checked, so the week
 * can be saved as it's built up. `photos` is the library (id → photo), to check the ids exist.
 */
/**
 * @param {ReturnType<typeof cleanParts>} p
 * @param {{ sale?: any, photos?: Map<string, any> | null, kids?: any[] | null, ready?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function checkParts(p, { sale = null, photos = null, kids = null, ready = false } = {}) {
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
      if (claims.length) e[k] = `It says ${claims.join(' ')} Change the words, or use {offer} and the email writes the sale for you.`;
    }
  }
  const s = p.story;
  set('story.label', over(s.label, PART_LIMITS.label, 'The small label'));
  set('story.headline', over(s.headline, PART_LIMITS.headline, 'The headline'));
  set('story.body', over(s.body, PART_LIMITS.body, 'The story'));
  set('story.cta', over(s.cta, PART_LIMITS.cta, 'The link’s words'));
  if (s.link && !isStorePath(s.link)) e['story.link'] = 'The link goes to a page on sunnyandranney.com, like /visit/ or /shop/.';
  if (ready && !s.headline) e['story.headline'] = 'Give the story a headline.';
  if (ready && !s.body) e['story.body'] = 'Write a few lines for the story.';
  if (s.photos.length > COLLAGE_MAX) e['story.photos'] = `The collage holds ${COLLAGE_MAX} photos at most. Take ${s.photos.length - COLLAGE_MAX} out.`;
  if (photos) {
    const gone = [p.hero, ...s.photos].filter((id) => id && !photos.has(id));
    if (gone.length) e.photos = 'A photo this email uses isn’t in the library anymore. Pick another.';
    const noAlt = [p.hero, ...s.photos].filter((id) => id && photos.get(id) && !photos.get(id).alt);
    if (noAlt.length) e.photos = `${noAlt.length === 1 ? 'A photo' : `${noAlt.length} photos`} in the email need${noAlt.length === 1 ? 's' : ''} a few words saying what’s in ${noAlt.length === 1 ? 'it' : 'them'}, for people who can’t see images.`;
  }
  if (kids) {
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
 * The parts as the email draws them. `photos` maps an id to its library record ({ alt, w, h });
 * `photoSrc` makes an id into the email's photo source.
 */
/**
 * @param {ReturnType<typeof cleanParts>} p
 * @param {{ sale: any, photos: Map<string, any>, kids?: any[], photoSrc?: (id: string) => string }} opts
 */
export function briefParts(p, { sale, photos, kids = [], photoSrc = (id) => `photo:${id}` }) {
  // Alt text stays plain: the email escapes it where it draws the photo
  const pic = (id) => ({ src: photoSrc(id), alt: photos.get(id)?.alt || '' });
  const s = p.story;
  const kid = kidFor(p.kid, kids);
  const { subject, preheader } = linesOf(p, sale);
  return {
    // Plain text with curly quotes as characters: the email escapes these once where it writes them
    // (its <title> and hidden preview line), and Kit takes them as plain text. As HTML they were
    // escaped twice, and an inbox showed "kids&#8217;".
    subject: plain(typeset(subject)),
    preheader: plain(typeset(preheader)),
    hero: p.hero && photos.has(p.hero) ? pic(p.hero) : DEFAULT_HERO,
    story:
      s.headline || s.body || s.photos.length
        ? {
            label: typeset(s.label || STORY_DEFAULTS.label),
            headline: typeset(s.headline || 'Your headline'),
            body: typeset(s.body || 'A few lines about what’s new in the showroom.').replace(/\n/g, '<br>'),
            cta: [typeset(s.cta || STORY_DEFAULTS.cta), s.link || STORY_DEFAULTS.link],
            photos: s.photos.filter((id) => photos.has(id)).slice(0, COLLAGE_MAX).map(pic),
          }
        : null,
    mission: kid ? missionOf(kid, p.kidPhoto) : null,
  };
}

/** The collage in the order the email draws it, arranged for her: the widest photo leads. */
export function arrangeCollage(ids, photos) {
  const ratio = (id) => (photos.get(id)?.w || 1) / (photos.get(id)?.h || 1);
  if (ids.length < 3) return ids;
  const lead = ids.reduce((best, id) => (ratio(id) > ratio(best) ? id : best), ids[0]);
  return [lead, ...ids.filter((id) => id !== lead)];
}
