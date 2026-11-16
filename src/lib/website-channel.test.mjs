import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOOGLE, HEADLESS, ONLINE_STORE, POS, channelChanges, coverage, ensureWebsiteChannels, sweepWebsiteChannels } from './website-channel.mjs';

const settled = { status: 'ACTIVE', tags: [], inWebsite: true, onHeadless: true, onPos: true, onGoogle: true, onOnlineStore: false };
const none = { publish: [], unpublish: [] };

test('a website piece goes on the website, Point of Sale and Google, and off Online Store', () => {
  assert.deepEqual(channelChanges({ ...settled, onHeadless: false, onPos: false, onGoogle: false }), { publish: [POS, HEADLESS, GOOGLE], unpublish: [] });
  assert.deepEqual(channelChanges({ ...settled, status: 'active', onOnlineStore: true }), { publish: [], unpublish: [ONLINE_STORE] });
  assert.deepEqual(channelChanges(settled), none);
});

test('drafts and archived products are left alone', () => {
  // A draft (from a wholesale app, or the Flow that drafted new products) waits until it's made Active.
  assert.deepEqual(channelChanges({ ...settled, status: 'DRAFT', onHeadless: false, onGoogle: false, onOnlineStore: true }), none);
  assert.deepEqual(channelChanges({ ...settled, status: 'ARCHIVED', onOnlineStore: true }), none);
});

test('a product without a page goes on the website channel and Point of Sale, and off Google (its listing would lead nowhere); its Online Store stays as it is', () => {
  const gift = { ...settled, inWebsite: false, onHeadless: false, onPos: false };
  assert.deepEqual(channelChanges({ ...gift, onGoogle: false, onOnlineStore: true }), { publish: [POS, HEADLESS], unpublish: [] });
  assert.deepEqual(channelChanges({ ...gift, onGoogle: true, onOnlineStore: false }), { publish: [POS, HEADLESS], unpublish: [GOOGLE] });
});

test('hide-online keeps a product off the website, Google and Online Store, but sellable in the store', () => {
  assert.deepEqual(channelChanges({ ...settled, tags: ['Hide-Online '], onPos: false, onOnlineStore: true }), { publish: [POS], unpublish: [HEADLESS, GOOGLE, ONLINE_STORE] });
  assert.deepEqual(channelChanges({ ...settled, tags: ['hide-online'], inWebsite: false, onHeadless: false, onGoogle: false }), none);
});

/** A fake Admin API: products by id, and a log of the mutations it took. */
function fakeShopify(products, { refuse = null, slow = 0 } = {}) {
  const calls = [];
  const gql = async (query, vars) => {
    if (query.includes('collectionByHandle')) {
      const nodes = products.filter((p) => p.collections.includes(vars.h));
      // Like Shopify: no such collection, no answer.
      if (!nodes.length) return { data: { collectionByHandle: null } };
      return { data: { collectionByHandle: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } };
    }
    const name = ['publishablePublish', 'publishableUnpublish'].find((n) => query.includes(n));
    if (name) {
      calls.push({ name, id: vars.id, ids: vars.input.map((i) => i.publicationId) });
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (refuse === 'top') return { errors: [{ message: 'Access denied for publishablePublish field.' }], data: { [name]: null } };
      if (refuse === 'user') return { data: { [name]: { userErrors: [{ message: 'Publication not found' }] } } };
      if (refuse === 'already') return { data: { [name]: { userErrors: [{ message: 'Product has already been published to this publication' }] } } };
      return { data: { [name]: { userErrors: [] } } };
    }
    const p = products.find((x) => x.id === vars.id);
    return { data: { product: p ? { ...p, collections: { nodes: p.collections.map((handle) => ({ handle })) } } : null } };
  };
  return { gql, calls };
}

const sofa = { id: 'gid://shopify/Product/1', handle: 'prato-leather-sofa-jkc', title: 'Prato Leather Sofa', status: 'ACTIVE', tags: [], totalInventory: 1, onHeadless: false, onPos: true, onGoogle: false, onOnlineStore: true, collections: ['living', 'staff-picks'] };
const SITE = ['living', 'dining', 'bedroom'];

test('ensure reads the product fresh, then sends one publish and one unpublish, only when needed', async () => {
  const { gql, calls } = fakeShopify([sofa]);
  assert.deepEqual(await ensureWebsiteChannels(gql, sofa.id, SITE), { handle: sofa.handle, published: [HEADLESS, GOOGLE], unpublished: [ONLINE_STORE] });
  assert.deepEqual(calls, [
    { name: 'publishablePublish', id: sofa.id, ids: [HEADLESS, GOOGLE] },
    { name: 'publishableUnpublish', id: sofa.id, ids: [ONLINE_STORE] },
  ]);
  const done = fakeShopify([{ ...sofa, onHeadless: true, onGoogle: true, onOnlineStore: false }]);
  await ensureWebsiteChannels(done.gql, sofa.id, SITE);
  assert.equal(done.calls.length, 0, 'nothing to do, nothing sent: no webhook loop');
});

test('ensure tells a website piece from one without a page by its collections', async () => {
  const candle = { ...sofa, id: 'gid://shopify/Product/9', handle: 'candle', onGoogle: true, collections: ['gifts'] };
  const { gql, calls } = fakeShopify([candle]);
  assert.deepEqual(await ensureWebsiteChannels(gql, candle.id, SITE), { handle: 'candle', published: [HEADLESS], unpublished: [GOOGLE] });
  assert.equal(calls.length, 2);
});

test('a refusal is a failure, never a silent success; "already published" is no refusal', async () => {
  await assert.rejects(ensureWebsiteChannels(fakeShopify([sofa], { refuse: 'top' }).gql, sofa.id, SITE), /Access denied/);
  await assert.rejects(ensureWebsiteChannels(fakeShopify([sofa], { refuse: 'user' }).gql, sofa.id, SITE), /Publication not found/);
  await ensureWebsiteChannels(fakeShopify([sofa], { refuse: 'already' }).gql, sofa.id, SITE);
});

const catalog = [
  sofa,
  { id: 'gid://shopify/Product/2', handle: 'maverly-rocker-recl-sand-bhf', title: 'Maverly', status: 'ACTIVE', tags: [], totalInventory: 1, onHeadless: true, onPos: true, onGoogle: true, onOnlineStore: false, collections: ['living'] },
  { id: 'gid://shopify/Product/3', handle: 'sold-out-table', title: 'Table', status: 'ACTIVE', tags: [], totalInventory: 0, onHeadless: true, onPos: true, onGoogle: false, onOnlineStore: false, collections: ['dining'] },
  { id: 'gid://shopify/Product/4', handle: 'draft-bed', title: 'Bed', status: 'DRAFT', tags: [], totalInventory: 2, onHeadless: false, onPos: false, onGoogle: false, onOnlineStore: false, collections: ['bedroom'] },
];

test('the sweep fixes what is off, and lists in-stock pieces the live site lacks', async () => {
  const { gql, calls } = fakeShopify(catalog);
  const out = await sweepWebsiteChannels(gql, SITE, new Set(['maverly-rocker-recl-sand-bhf']));
  assert.equal(out.checked, 4);
  assert.deepEqual(out.fixed.map((f) => [f.handle, f.published]), [['prato-leather-sofa-jkc', [HEADLESS, GOOGLE]], ['sold-out-table', [GOOGLE]]]);
  assert.deepEqual(out.failed, []);
  assert.equal(out.pending, 0);
  // The sofa was just published: it shows as missing until the rebuild; sold-out and draft pieces don't count.
  assert.deepEqual(out.missing, [{ handle: 'prato-leather-sofa-jkc', title: 'Prato Leather Sofa' }]);
  assert.equal(calls.length, 3);
});

test('the sweep stops fixing at its deadline, counts the rest, and still lists what is missing', async () => {
  let clock = 0;
  const { gql, calls } = fakeShopify(catalog);
  const out = await sweepWebsiteChannels(gql, SITE, new Set(), { deadline: 1, now: () => clock++ });
  assert.equal(out.fixed.length, 1);
  assert.equal(out.pending, 1);
  assert.deepEqual(out.missing.map((m) => m.handle), ['prato-leather-sofa-jkc', 'maverly-rocker-recl-sand-bhf']);
  assert.equal(calls.length, 2);
});

test('a collection switched on for the website but missing in Shopify fails the check', async () => {
  await assert.rejects(sweepWebsiteChannels(fakeShopify(catalog).gql, ['living', 'lighting'], new Set()), /lighting: not found/);
});

test('a piece only counts as missing once it has been missing over two hours', () => {
  const now = new Date('2026-11-16T15:00:00Z');
  const first = coverage([{ handle: 'a', title: 'A' }], {}, now);
  assert.deepEqual(first.late, []);
  assert.equal(first.firstSeen.a, '2026-11-16T15:00:00.000Z');
  const later = coverage([{ handle: 'a', title: 'A' }, { handle: 'b', title: 'B' }], first.firstSeen, new Date('2026-11-16T17:30:00Z'));
  assert.deepEqual(later.late.map((m) => m.handle), ['a']);
  // Back on the site: forgotten.
  assert.deepEqual(coverage([], later.firstSeen, new Date('2026-11-16T18:00:00Z')).firstSeen, {});
});
