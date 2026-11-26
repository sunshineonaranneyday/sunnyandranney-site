/**
 * The whole weekly email from what's set in the admin
 * ===========================================================================
 * The page's preview and the draft the admin puts into Kit both come from pageEmail, so what
 * Staci sees on the page is what goes into Kit: the masthead, the top photo, the sale, the
 * products once 4 to 9 are picked, the story and its collage, a charity reveal, the events, the charity section
 * with its live numbers, the visit band and the footer. No Node or browser APIs.
 */

import { emailHours } from '../store-hours.mjs';
import { SECTIONS, lines } from './email.mjs';
import { NO_SALE, briefParts, isOff, sectionsOff } from './parts.mjs';
import { PICKS, previewWall } from './wall.mjs';

/**
 * @param {{ sale: any, wall: any, parts: any, photos: Map<string, any>, kids: any[], reveals?: any[], catalog: Map<string, any> | null, events: any[], impact: { rooms: string, children: string } | null, hours?: import('../store-hours.mjs').StoreHours | null, send: string, site: string }} week
 *   sale as the email takes it (toSale/draftSale); events already brief events; photos the library by id;
 *   hours the store's as Google has them (settings:hours, store-hours.mjs).
 */
export function pageEmail({ sale: setSale, wall, parts, photos, kids, reveals = [], catalog, events, impact, hours = null, send, site }) {
  // The sections turned off (parts.mjs SWITCHES): a sale that's off isn't in the email, and the
  // subject line can't promise one
  const off = sectionsOff(parts);
  const sale = off.includes('offer') ? null : setSale;
  /** @type {Record<string, any>} */
  const brief = { send_date: send, sale, ...briefParts(parts, { sale, photos, kids, reveals }) };
  const shownHours = emailHours(hours, send);
  if (shownHours) brief.hours = shownHours;
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
  // In the email's own order (SECTIONS), so the preview and the email sent can't drift from it: a
  // second list here kept the story above the reveal after the email's moved (Nov 17, 2026)
  const has = { offer: Boolean(sale), wall: wallReady, story: Boolean(brief.story), reveal: Boolean(brief.reveal), events: events.length > 0, mission: Boolean(brief.mission) };
  const sections = SECTIONS.filter((s) => (has[s] ?? true) && !off.includes(s));
  return { brief, sections, wallReady };
}

/**
 * The admin page's sections, top to bottom (Peter, 2026-11-17: "subject, sale, products, reveal,
 * photos, events, charity, send!!!!!! thats the fucking order"): the subject line, the sale, the
 * products, the reveal (a charity reveal still ahead, or none), the photos (the top photo and the
 * collage), the events, the charity, and Send. There is no story: its words are gone from the page
 * and the email ("i want the "story" fuckong gone"). The page, its error list and "Before it can go"
 * all follow this list; page-order.test.mjs holds them to it.
 */
export const PAGE_SECTIONS = ['em-lines', 'em-sale', 'em-products', 'em-reveal', 'em-photos', 'em-events', 'em-charity', 'em-send'];

/** The fields each section of the page holds, by the first part of an error's key (check, checkWall, checkParts). */
const FIELDS = {
  'em-lines': ['subject', 'preheader'],
  'em-sale': ['kind', 'tiers', 'percent', 'ends', 'name', 'windows'],
  'em-reveal': ['reveal'],
  'em-photos': ['photos', 'story'],
  'em-products': ['picks', 'label', 'headline'],
  'em-charity': ['kid'],
};

/** The page section that fixes the field an error's key names, or null if no section holds it. */
export function sectionOf(key) {
  const [head, sub] = key.split('.');
  const found = Object.entries(FIELDS).find(([, fields]) => fields.includes(`${head}.${sub}`)) ?? Object.entries(FIELDS).find(([, fields]) => fields.includes(head));
  return found ? found[0] : null;
}

/** Where a section sits on the page; an unknown one goes last. */
export const pagePlace = (section) => {
  const k = PAGE_SECTIONS.indexOf(section ?? '');
  return k < 0 ? PAGE_SECTIONS.length : k;
};

/**
 * What still stands between the saved week and sending it, in words with the page section that
 * fixes each, or [] when it's ready: a sale, 4 to 9 products that pass their checks, and the parts
 * the finished email needs. Listed in the page's order (PAGE_SECTIONS).
 * @returns {{ text: string, section: string }[]}
 * @param {{ special: any, wall: any, parts: any, photos: Map<string, any>, kids: any[], reveals?: any[] | null, catalog: Map<string, any> | null, send: string, check: Function, checkWall: Function, checkParts: Function, sale: any }} week
 */
export function kitProblems({ special, wall, parts, photos, kids, reveals = null, catalog, send, check, checkWall, checkParts, sale }) {
  const out = [];
  const add = (text, section) => out.push({ text, section });
  // A section that's off (parts.mjs SWITCHES) needs nothing: the email goes without it
  const saleOff = isOff(parts, 'sale');
  const e = checkParts(parts, { sale: saleOff ? NO_SALE : sale, photos, kids, reveals, ready: true });
  if (e.subject || e.preheader) add(e.subject && !parts.subject ? 'Write the subject line.' : 'Fix the subject line.', 'em-lines');
  if (e.photos || e['story.photos']) add(e.photos || 'Fix the collage’s photos.', 'em-photos');
  if (saleOff) {
    // nothing to set
  } else if (!special) add('Set the sale.', 'em-sale');
  else if (Object.keys(check(special, send)).length) add('Fix the sale.', 'em-sale');
  const n = wall?.picks.length ?? 0;
  if (isOff(parts, 'products')) {
    // nothing to pick
  } else if (n < PICKS[0]) add(`Pick ${PICKS[0] - n} more product${PICKS[0] - n === 1 ? '' : 's'}.`, 'em-products');
  else if (Object.keys(checkWall(wall, { catalog: catalog ?? undefined, send })).length) add('Fix the products.', 'em-products');
  // Everything a reader comes for turned off leaves the masthead, the visit row and the footer
  if (['sale', 'products', 'photos', 'events', 'charity'].every((k) => isOff(parts, k)) && !parts.reveal) add('Every section is off. Turn at least one back on.', 'em-sale');
  if (e.reveal) add(e.reveal, 'em-reveal');
  // A reveal invite can't go out after the reveal
  const reveal = parts.reveal && reveals?.find((r) => r.slug === parts.reveal);
  if (reveal && reveal.day < send) add(`${reveal.name}’s reveal was ${reveal.short}, before this email goes out. Pick another, or no reveal.`, 'em-reveal');
  if (e.kid) add(e.kid, 'em-charity');
  // A stable sort: within a section, the order above
  return out.sort((a, b) => pagePlace(a.section) - pagePlace(b.section));
}
