import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOWS, SORTS, entry, fold, haystack, isNew, matches, toCatalog, unpickable } from './catalog.mjs';

const product = (o = {}) => ({
  handle: 'kuga-swivel-sand-elmt',
  title: 'Kuga Swivel |Sand - ELMT',
  createdAt: '2026-11-01T10:00:00Z',
  productType: 'Chair',
  category: { name: 'Armchairs' },
  priceRange: { minVariantPrice: { amount: '699.0' } },
  compareAtPriceRange: { minVariantPrice: { amount: '0.0' } },
  images: { edges: [{ node: { url: 'https://cdn.shopify.com/a.png?v=1', width: 1000, height: 1000 } }, { node: { url: 'https://cdn.shopify.com/b.jpg?v=1', width: 1500, height: 1000 } }] },
  variants: { edges: [{ node: { quantityAvailable: 2 } }, { node: { quantityAvailable: 1 } }, { node: { quantityAvailable: null } }] },
  ...o,
});

test('a product comes with its customer name, price, stock and every photo', () => {
  const p = entry(product(), { collections: ['living'], rank: 4 });
  assert.equal(p.name, 'Kuga Swivel, Sand');
  assert.equal(p.price, 699);
  assert.equal(p.was, null);
  assert.equal(p.qty, 3);
  assert.equal(p.added, '2026-11-01');
  assert.equal(p.kind, 'Armchairs');
  // PNGs too: the email sends every photo as a JPEG
  assert.deepEqual(p.photos, [{ url: 'https://cdn.shopify.com/a.png?v=1', w: 1000, h: 1000 }, { url: 'https://cdn.shopify.com/b.jpg?v=1', w: 1500, h: 1000 }]);
});

test('only a product sold out or with no photo at all can’t be picked, and it says why', () => {
  const p = entry(product({ images: { edges: [] } }));
  assert.deepEqual(p.photos, []);
  assert.equal(unpickable(p), 'No photo in Shopify');
  assert.equal(unpickable({ ...p, qty: 0 }), 'Sold out');
  assert.equal(unpickable(entry(product())), '');
});

test('a sale price shows what it was', () => {
  assert.equal(entry(product({ compareAtPriceRange: { minVariantPrice: { amount: '899' } } })).was, 899);
});

test('the catalog puts best sellers first, unranked last', () => {
  const c = toCatalog([product({ handle: 'a' }), product({ handle: 'b' }), product({ handle: 'c' })], {
    productCollections: { a: ['living'] },
    collectionTitles: { living: 'Living' },
    staffPicks: new Set(['c']),
    ranks: ['c', 'a'],
    built: 'now',
  });
  assert.deepEqual(c.products.map((p) => [p.handle, p.rank]), [['c', 1], ['a', 2], ['b', null]]);
  assert.deepEqual(c.collections, [{ handle: 'living', title: 'Living' }]);
  assert.equal(c.products[0].staffPick, true);
});

test('search matches every word typed, in any order, ignoring case, accents and quotes', () => {
  const hay = haystack(entry(product({ title: '36" Marlowe Gold Mirror - OLX', handle: '36-marlowe-gold-wall-mirror-olx', category: { name: 'Wall Mirrors' } }), { collections: ['art-mirrors'] }), { 'art-mirrors': 'Art & Mirrors' });
  assert.ok(matches(hay, 'gold mirror'));
  assert.ok(matches(hay, 'MIRROR gold'));
  assert.ok(matches(hay, '36"'));
  assert.ok(matches(hay, 'art and mirrors'));
  assert.ok(matches(hay, ''));
  assert.ok(!matches(hay, 'gold sofa'));
  assert.equal(fold('Café “Bistro” Chair'), 'cafe bistro chair');
});

test('the sorts and the "new" filter', () => {
  const a = { name: 'A', rank: 2, added: '2026-10-01', price: 300 };
  const b = { name: 'B', rank: 1, added: '2026-11-01', price: 100 };
  assert.deepEqual([a, b].sort(SORTS.best.compare), [b, a]);
  assert.deepEqual([b, a].sort(SORTS.priceHigh.compare), [a, b]);
  assert.deepEqual([a, b].sort(SORTS.newest.compare), [b, a]);
  assert.ok(isNew(b, '2026-11-12'));
  assert.ok(!SHOWS.new.test(a, '2026-11-12'));
});
