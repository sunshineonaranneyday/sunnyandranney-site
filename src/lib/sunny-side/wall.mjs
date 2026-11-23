/**
 * The week's products: what Staci picks in the admin for the email's photo wall
 * ===========================================================================
 * She picks 4 to 9 products from the shop's catalog (catalog.mjs), each with the photo the
 * email shows and, when the store's name is too long for a tile, a short name. They're arranged
 * for her (arrange()), and she can move any of them herself. The same rules run in her browser,
 * on the server and in the weekly build, which turns the picks into the email's photo wall
 * (toWall()) and then checks every product's price and stock against the store again.
 * No Node or browser APIs.
 */

import { NAME_MAX, displayName } from './product.mjs';
import { typeset } from './special.mjs';

/** The email's photo wall holds 4 to 9 products (email.mjs, WALL_ROWS). */
export const PICKS = [4, 9];

/** What the wall says over the products unless Staci changes it. True of any picks. */
export const WALL_DEFAULTS = { label: 'Shop the floor', headline: 'Our picks this week.' };
export const WALL_LIMITS = { label: 32, headline: 48 };

/** A word that promises the products are new, which only new products can keep. */
const NEW_WORDS = /\b(new|just (in|landed|arrived)|arrivals?|fresh)\b/i;
/** How new a product has to be for "new" to be true: the shop's own "New" badge counts 30 days. */
export const NEW_FOR_DAYS = 30;

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const HANDLE = /^[a-z0-9][a-z0-9-]{0,200}$/;
/** Photos the email can use: the store's own photos on Shopify, or Cloudflare Images ("cf:<id>"). */
const PHOTO = /^(https:\/\/cdn\.shopify\.com\/s\/files\/1\/0930\/2117\/6092\/[^\s"<>]+|cf:[A-Za-z0-9/_.-]+)$/;

/** What Staci saved, tidied: unknown fields dropped, at most a few more picks than the wall holds. */
export function cleanWall(input) {
  const i = input && typeof input === 'object' ? input : {};
  const picks = (Array.isArray(i.picks) ? i.picks : []).slice(0, PICKS[1] + 3).map((p) => ({
    handle: str(p?.handle).toLowerCase(),
    photo: str(p?.photo),
    name: str(p?.name),
  }));
  return { label: str(i.label), headline: str(i.headline), picks, arranged: i.arranged === 'hand' ? 'hand' : 'auto' };
}

/** A wall with nothing picked yet. */
export const blankWall = () => ({ label: '', headline: '', picks: [], arranged: 'auto' });

/**
 * A short name for a tile, when the store's name is too long and can be shortened cleanly: the
 * finish after the last comma goes ("Hamlin Swivel Chair, Beamer Blue" -> "Hamlin Swivel Chair"),
 * then a finish like "Nat/Grey", then a leading size. '' when that doesn't leave a real name,
 * so Staci writes one.
 */
export function shortName(name) {
  let s = str(name);
  if (s.length <= NAME_MAX) return s;
  const steps = [(t) => t.replace(/,[^,]*$/, ''), (t) => t.replace(/\s+\S*\/\S*$/, ''), (t) => t.replace(/^\d+(\.\d+)?("|in\.?)\s+/i, '')];
  for (const step of steps) {
    if (s.length <= NAME_MAX) break;
    s = step(s).replace(/[\s,]+$/, '');
  }
  const words = s.match(/[A-Za-z]{3,}/g) ?? [];
  return s.length <= NAME_MAX && words.length >= 2 ? s : '';
}

/** The name a tile shows: Staci's short name, or the store's name cleaned up. */
export const tileName = (pick, product) => pick.name || (product ? displayName(product.title) : '');

const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

/**
 * What's wrong with the picks, in words Staci can act on. Empty when the wall is ready.
 * With the catalog, each product is also checked against the store: it's still listed, in stock,
 * and the photo is one of its own. Without it (the server), only what can be checked without it.
 * Keys: "picks" for the set, "picks.<handle>" for one product, "label" and "headline".
 * @param {ReturnType<typeof cleanWall>} w
 * @param {{ catalog?: Map<string, any>, send?: string }} [ctx]
 * @returns {Record<string, string>}
 */
export function checkWall(w, { catalog, send } = {}) {
  /** @type {Record<string, string>} */
  const e = {};
  const [few, many] = PICKS;
  if (w.picks.length < few) e.picks = `Pick at least ${few} products. ${w.picks.length ? `${few - w.picks.length} more to go.` : ''}`.trim();
  else if (w.picks.length > many) e.picks = `The email shows ${many} products at most. Take ${w.picks.length - many} out.`;
  for (const [field, name] of [['label', 'The small label'], ['headline', 'The title']]) {
    if (w[field].length > WALL_LIMITS[field]) e[field] = `${name} can be ${WALL_LIMITS[field]} characters at most. This one is ${w[field].length}.`;
  }
  const seen = new Set();
  const names = new Map();
  w.picks.forEach((p) => {
    const key = `picks.${p.handle}`;
    const product = catalog?.get(p.handle);
    const name = tileName(p, product) || p.handle;
    if (!HANDLE.test(p.handle)) return void (e[key] = 'That isn’t a product on the website.');
    if (seen.has(p.handle)) return void (e[key] = `${name} is in twice.`);
    seen.add(p.handle);
    if (!PHOTO.test(p.photo)) return void (e[key] = `Pick a photo for ${name}.`);
    if (p.name.length > NAME_MAX) return void (e[key] = `“${p.name}” is too long for a tile (${p.name.length} characters, ${NAME_MAX} at most).`);
    if (!catalog) return;
    if (!product) return void (e[key] = `${name} isn’t on the website anymore. Take it out.`);
    if (product.qty <= 0) return void (e[key] = `${name} is sold out. Take it out or pick another.`);
    if (!p.photo.startsWith('cf:') && !product.photos.some((ph) => ph.url === p.photo)) return void (e[key] = `Pick one of ${name}’s own photos.`);
    if (!p.name && displayName(product.title).length > NAME_MAX) return void (e[key] = `Give ${displayName(product.title)} a short name for its tile (${NAME_MAX} characters at most).`);
    const shown = name.toLowerCase();
    if (names.has(shown)) return void (e[key] = `Two products would both say “${name}”. Give this one a name that tells them apart, like its color.`);
    names.set(shown, p.handle);
  });
  const words = `${w.label} ${w.headline}`;
  if (catalog && send && NEW_WORDS.test(words)) {
    const old = w.picks.map((p) => catalog.get(p.handle)).filter((p) => p && (!p.added || daysBetween(p.added, send) > NEW_FOR_DAYS));
    if (old.length) e.headline = `The title says they’re new, but ${old.length === 1 ? `${tileName({ name: '' }, old[0])} isn’t` : `${old.length} of the products aren’t`} (new means added in the last ${NEW_FOR_DAYS} days). Change the words or the products.`;
  }
  return e;
}

/** The rows the email lays the products out in: at most two across, an odd count leading with one wide product. */
export const ROWS = { 4: [2, 2], 5: [1, 2, 2], 6: [2, 2, 2], 7: [1, 2, 2, 2], 8: [2, 2, 2, 2], 9: [1, 2, 2, 2, 2] };

const aspect = (product, url) => {
  const ph = product?.photos.find((p) => p.url === url);
  return ph && ph.w && ph.h ? ph.w / ph.h : 1;
};
const rankOf = (product) => product?.rank ?? Number.MAX_SAFE_INTEGER;

/**
 * The picks in the order the email shows them, arranged the way a merchandiser would:
 * - best sellers first;
 * - when the count is odd, the lead tile is wide (3:2), so it goes to the pick whose photo is
 *   widest, since a tall photo cropped that wide loses its top and bottom;
 * - two of a kind (two armchairs) never share a row when another pick can sit between them.
 * Staci can move any product after; arrange() runs again only when she asks or adds one while
 * the wall is still arranged for her.
 * @param {{handle: string, photo: string, name: string}[]} picks
 * @param {Map<string, any>} catalog
 */
export function arrange(picks, catalog) {
  const left = [...picks].sort((a, b) => rankOf(catalog.get(a.handle)) - rankOf(catalog.get(b.handle)));
  const out = [];
  const rows = ROWS[picks.length];
  if (!rows) return left; // fewer than 4 or more than 9: there's no layout to arrange for yet
  for (const n of rows) {
    if (n === 1) {
      const widest = left.reduce((best, p, k) => (aspect(catalog.get(p.handle), p.photo) > aspect(catalog.get(left[best].handle), left[best].photo) + 0.05 ? k : best), 0);
      out.push(...left.splice(widest, 1));
      continue;
    }
    const first = left.shift();
    const kind = catalog.get(first.handle)?.kind;
    const other = left.findIndex((p) => !kind || catalog.get(p.handle)?.kind !== kind);
    out.push(first, ...left.splice(other === -1 ? 0 : other, 1));
  }
  return out;
}

/**
 * The email's photo wall (brief.wall) from Staci's picks. The build reads each product's name,
 * price and stock from its page, so only what she chose goes in: which product, which photo, and
 * the short name when she gave one.
 */
export function toWall(w, site) {
  return {
    label: typeset(w.label || WALL_DEFAULTS.label),
    headline: typeset(w.headline || WALL_DEFAULTS.headline),
    more: '/shop/',
    photos: w.picks.map((p) => ({ url: `${site}/shop/${p.handle}/`, src: p.photo, ...(p.name ? { name: typeset(p.name) } : {}) })),
  };
}

/**
 * The wall as the preview draws it: names and prices from the catalog, the way the build fills
 * them from the store. Products not found yet show as they will once found.
 */
export function previewWall(w, catalog, site) {
  const wall = toWall(w, site);
  wall.photos = wall.photos.map((ph, k) => {
    const product = catalog.get(w.picks[k].handle);
    const name = ph.name || typeset(product ? displayName(product.title) : w.picks[k].handle);
    return { ...ph, name, price: product?.price || 1 };
  });
  return wall;
}

/** One line for lists: "6 products" */
export const wallSummary = (w) => (w?.picks.length ? `${w.picks.length} product${w.picks.length === 1 ? '' : 's'}` : '');
