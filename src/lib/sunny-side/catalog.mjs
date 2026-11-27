/**
 * The products Staci can pick for the email
 * ===========================================================================
 * The website publishes its own catalog with every deploy (/shop/catalog.json): every product
 * the shop lists, with the same stock count its cards show and its photos' sizes. The admin's
 * product picker reads it, so Staci only ever sees products the email can link to, and the
 * stock she sees is the stock the weekly build checks (scripts/sunny-side/build.mjs reads the
 * same shop). No Node or browser APIs: the catalog page, the picker and the tests share it.
 */

import { NAME_MAX, displayName } from './product.mjs';

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const amount = (m) => {
  const n = Number(m?.amount);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One product as the picker needs it, from a Storefront API product. Every photo can go in the
 * email, which sends each one as a JPEG (email.mjs, Email.photo).
 * @param {any} p the product
 * @param {{ collections?: string[], rank?: number | null, staffPick?: boolean }} extra
 */
export function entry(p, { collections = [], rank = null, staffPick = false } = {}) {
  const price = amount(p.priceRange?.minVariantPrice);
  const was = amount(p.compareAtPriceRange?.minVariantPrice);
  const photos = (p.images?.edges ?? [])
    .map((e) => e.node)
    .filter((n) => n?.url)
    .map((n) => ({ url: n.url, w: n.width ?? 0, h: n.height ?? 0 }));
  return {
    handle: p.handle,
    name: displayName(p.title),
    title: p.title,
    price,
    was: was > price ? was : null,
    qty: (p.variants?.edges ?? []).reduce((sum, e) => sum + (e.node?.quantityAvailable ?? 0), 0),
    added: day(p.createdAt),
    kind: p.category?.name && p.category.name !== 'Uncategorized' ? p.category.name : p.productType || '',
    type: p.productType || '',
    collections,
    photos,
    rank,
    staffPick,
  };
}

/**
 * The whole catalog: every product the shop lists, best sellers first.
 * @param {any[]} products the shop's products (src/lib/shop-data.ts)
 * @param {{ productCollections: Record<string, string[]>, collectionTitles: Record<string, string>, staffPicks: Set<string>, ranks: string[], built: string }} shop
 */
export function toCatalog(products, { productCollections, collectionTitles, staffPicks, ranks, built }) {
  const rankOf = new Map(ranks.map((h, k) => [h, k + 1]));
  const items = products.map((p) =>
    entry(p, { collections: productCollections[p.handle] ?? [], rank: rankOf.get(p.handle) ?? null, staffPick: staffPicks.has(p.handle) }),
  );
  return {
    built,
    collections: Object.entries(collectionTitles).map(([handle, title]) => ({ handle, title })),
    products: items.sort(byBestSelling),
  };
}

// ── Searching and sorting, in the picker ───────────────────────────────────

/** Lowercase, no accents, "&" as "and", no quotes or punctuation: what both the search and the names are compared as. */
export function fold(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/["'’‘”“″]/g, '')
    .replace(/[^a-z0-9$.]+/g, ' ')
    .trim();
}

/** What a search is matched against: the name, the catalog's own title, the kind, and the collections it's in. */
export function haystack(p, collectionTitles = {}) {
  return fold([p.name, p.title, p.kind, p.type, p.handle.replace(/-/g, ' '), ...p.collections.map((c) => collectionTitles[c] || c)].join(' '));
}

/** True when every word typed is in the product's words, so "swivel sand" finds the Kuga Swivel, Sand. */
export function matches(hay, query) {
  const words = fold(query).split(' ').filter(Boolean);
  return words.every((w) => hay.includes(w));
}

const unranked = Number.MAX_SAFE_INTEGER;
export const byBestSelling = (a, b) => (a.rank ?? unranked) - (b.rank ?? unranked) || a.name.localeCompare(b.name);

export const SORTS = {
  best: { label: 'Best selling', compare: byBestSelling },
  newest: { label: 'Newest', compare: (a, b) => b.added.localeCompare(a.added) || byBestSelling(a, b) },
  priceLow: { label: 'Price, low to high', compare: (a, b) => a.price - b.price || byBestSelling(a, b) },
  priceHigh: { label: 'Price, high to low', compare: (a, b) => b.price - a.price || byBestSelling(a, b) },
};

/** New arrivals are the last 30 days' products, as the shop's own "New" badge counts them. */
export const NEW_DAYS = 30;
const daysAgo = (today, iso) => (Date.parse(today) - Date.parse(iso)) / 86400000;
export const isNew = (p, today) => Boolean(p.added) && daysAgo(today, p.added) <= NEW_DAYS;

export const SHOWS = {
  all: { label: 'Everything', test: () => true },
  new: { label: 'New arrivals', test: (p, today) => isNew(p, today) },
  staff: { label: 'Staff picks', test: (p) => p.staffPick },
  sale: { label: 'On sale', test: (p) => p.was !== null },
};

/**
 * Why a product can't go in the email, or '' when it can: it's sold out, or it has no photo at all.
 * A name too long for a tile isn't a reason: Staci gives it a short one.
 */
export function unpickable(p) {
  if (p.qty <= 0) return 'Sold out';
  if (!p.photos.length) return 'No photo in Shopify';
  return '';
}

/** The longer why, for the card's tooltip. */
export const NO_PHOTO_WHY = 'It has no photo in Shopify. Add one there and it can go in after the next site update.';

/** True when the store's name is too long for a tile, so Staci gives it a short one. */
export const needsShortName = (p) => p.name.length > NAME_MAX;
