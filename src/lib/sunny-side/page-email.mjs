/**
 * The whole weekly email from what's set in the admin
 * ===========================================================================
 * The page's preview and the draft the admin puts into Kit both come from pageEmail, so what
 * Staci sees on the page is what goes into Kit: the masthead, the top photo, the sale, the
 * products once 4 to 9 are picked, the story and its collage, the events, the charity section
 * with its live numbers, the visit band and the footer. No Node or browser APIs.
 */

import { lines } from './email.mjs';
import { briefParts } from './parts.mjs';
import { PICKS, previewWall } from './wall.mjs';

/**
 * @param {{ sale: any, wall: any, parts: any, photos: Map<string, any>, kids: any[], catalog: Map<string, any> | null, events: any[], impact: { rooms: string, children: string } | null, send: string, site: string }} week
 *   sale as the email takes it (toSale/draftSale); events already brief events; photos the library by id.
 */
export function pageEmail({ sale, wall, parts, photos, kids, catalog, events, impact, send, site }) {
  /** @type {Record<string, any>} */
  const brief = { send_date: send, sale, ...briefParts(parts, { sale, photos, kids }) };
  // A subject that promises more than the sale can't be drawn; the page says why beside the field
  try {
    lines(brief);
  } catch {
    brief.subject = 'The Sunny Side';
    brief.preheader = '';
  }
  if (impact && brief.mission) brief.mission = { ...brief.mission, impact };
  const wallReady = Boolean(catalog) && Boolean(wall) && wall.picks.length >= PICKS[0] && wall.picks.length <= PICKS[1];
  if (wallReady) brief.wall = previewWall(wall, catalog, site);
  if (events.length) brief.events = events;
  const sections = [
    'masthead',
    'hero',
    'offer',
    ...(wallReady ? ['wall'] : []),
    ...(brief.story ? ['story'] : []),
    ...(events.length ? ['events'] : []),
    ...(brief.mission ? ['mission'] : []),
    'visit',
    'footer',
  ];
  return { brief, sections, wallReady };
}

/**
 * What still stands between the saved week and sending it, in words with the page section that
 * fixes each, or [] when it's ready: a sale, 4 to 9 products that pass their checks, and the parts
 * the finished email needs.
 * @returns {{ text: string, section: string }[]}
 * @param {{ special: any, wall: any, parts: any, photos: Map<string, any>, kids: any[], catalog: Map<string, any> | null, send: string, check: Function, checkWall: Function, checkParts: Function, sale: any }} week
 */
export function kitProblems({ special, wall, parts, photos, kids, catalog, send, check, checkWall, checkParts, sale }) {
  const out = [];
  const add = (text, section) => out.push({ text, section });
  if (!special) add('Set the sale.', 'em-sale');
  else if (Object.keys(check(special, send)).length) add('Fix the sale.', 'em-sale');
  const n = wall?.picks.length ?? 0;
  if (n < PICKS[0]) add(`Pick ${PICKS[0] - n} more product${PICKS[0] - n === 1 ? '' : 's'}.`, 'em-products');
  else if (Object.keys(checkWall(wall, { catalog: catalog ?? undefined, send })).length) add('Fix the products.', 'em-products');
  const e = checkParts(parts, { sale, photos, kids, ready: true });
  if (e.photos || e['story.photos']) add(e.photos || 'Fix the story’s photos.', 'em-photos');
  if (e['story.headline'] || e['story.body']) add('Write the story.', 'em-story');
  else if (Object.keys(e).some((k) => k.startsWith('story.') && k !== 'story.photos')) add('Fix the story.', 'em-story');
  if (e.kid) add(e.kid, 'em-charity');
  if (e.subject || e.preheader) add(e.subject && !parts.subject ? 'Write the subject line.' : 'Fix the subject line.', 'em-lines');
  return out;
}
