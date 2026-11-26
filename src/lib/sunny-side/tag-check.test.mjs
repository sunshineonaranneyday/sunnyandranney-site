import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { NO_MARKETING_TAG, STORE_TAG } from './kit.mjs';
import { askCheck, ensureTables, runTagCheck } from './tag-check.mjs';

let dbCount = 0;
async function freshDb() {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: `tag-check-${dbCount++}` } });
  return { DB: await mf.getD1Database('DB'), mf };
}

/** A stand-in Kit with the store's tag (1) and the no-marketing tag (2), lists read 2 to a page. */
function fakeKit(people) {
  const tags = new Map([[1, new Map()], [2, new Map()]]);
  for (const p of people) for (const [t, at] of Object.entries(p.tags)) tags.get(Number(t)).set(p.id, at);
  const calls = [];
  const kit = {
    calls,
    tags,
    failDelete: 0,
    async call(path, { method = 'GET' } = {}) {
      calls.push(`${method} ${path}`);
      const url = new URL(`https://kit.test${path}`);
      let m;
      if (method === 'GET' && url.pathname === '/tags') return { tags: [{ id: 1, name: STORE_TAG }, { id: 2, name: NO_MARKETING_TAG }], pagination: { has_next_page: false } };
      if (method === 'GET' && (m = url.pathname.match(/^\/tags\/(\d+)\/subscribers$/))) {
        const all = [...tags.get(Number(m[1])).entries()].map(([id, at]) => {
          const p = people.find((x) => x.id === id);
          return { id, email_address: p.email, state: p.state ?? 'active', created_at: '2025-01-01T00:00:00Z', tagged_at: at };
        });
        const after = Number(url.searchParams.get('after') || 0);
        return { subscribers: all.slice(after, after + 2), pagination: { has_next_page: after + 2 < all.length, end_cursor: String(after + 2) } };
      }
      if (method === 'DELETE' && (m = url.pathname.match(/^\/tags\/(\d+)\/subscribers\/(\d+)$/))) {
        if (kit.failDelete > 0) {
          kit.failDelete--;
          throw Object.assign(new Error('Kit said no (500).'), { status: 500 });
        }
        if (!tags.get(Number(m[1])).delete(Number(m[2]))) throw Object.assign(new Error('Kit said no (404).'), { status: 404 });
        return {};
      }
      throw Object.assign(new Error(`Kit said no (404): ${method} ${path}`), { status: 404 });
    },
  };
  return kit;
}

const PEOPLE = [
  // Subscribed in Shopify, on the store's list and the no-marketing tag: left out of the email by mistake
  { id: 11, email: 'Holly@Example.com', tags: { 1: '2026-11-03T10:00:00Z', 2: '2026-11-16T16:40:00Z' } },
  { id: 12, email: 'yes@example.com', tags: { 2: '2026-10-01T00:00:00Z' } },
  { id: 13, email: 'gone@example.com', state: 'cancelled', tags: { 1: '2026-11-01T00:00:00Z', 2: '2026-10-01T00:00:00Z' } },
  // Said no, or never said, in Shopify; not a Shopify customer at all
  { id: 14, email: 'no@example.com', tags: { 1: '2026-11-01T00:00:00Z', 2: '2026-10-01T00:00:00Z' } },
  { id: 15, email: 'never@example.com', tags: { 2: '2026-10-01T00:00:00Z' } },
  { id: 16, email: 'stranger@example.com', tags: { 1: '2026-11-01T00:00:00Z', 2: '2026-10-01T00:00:00Z' } },
  // On the store's list only
  { id: 17, email: 'fine@example.com', tags: { 1: '2026-11-01T00:00:00Z' } },
];
const SHOPIFY = [
  ['holly@example.com', 'SUBSCRIBED', '2025-09-18T18:33:05Z'],
  ['yes@example.com', 'SUBSCRIBED', '2025-01-01T00:00:00Z'],
  ['gone@example.com', 'SUBSCRIBED', '2025-01-01T00:00:00Z'],
  ['no@example.com', 'UNSUBSCRIBED', '2025-06-01T00:00:00Z'],
  ['never@example.com', 'NOT_SUBSCRIBED', null],
  ['fine@example.com', 'SUBSCRIBED', null],
];
async function loadShopify(DB) {
  await ensureTables(DB);
  await DB.batch(SHOPIFY.map(([e, s, at]) => DB.prepare('INSERT INTO shopify_email_consent (email, state, state_at, read_at) VALUES (?, ?, ?, ?)').bind(e, s, at, '2026-11-25T16:00:00Z')));
}
const people = async (DB) => (await DB.prepare('SELECT * FROM kit_tag_check_people ORDER BY kit_id').all()).results;

test('nothing is asked for: a run does nothing and calls Kit for nothing', async () => {
  const { DB, mf } = await freshDb();
  const kit = fakeKit(PEOPLE);
  assert.equal(await runTagCheck({ db: DB, kit }), null);
  assert.deepEqual(kit.calls, []);
  await mf.dispose();
});

test('a fix lists everyone on the no-marketing tag with Shopify’s answer, then takes it off all but those who unsubscribed in Shopify', async () => {
  const { DB, mf } = await freshDb();
  await loadShopify(DB);
  const kit = fakeKit(PEOPLE);
  const id = await askCheck(DB, { mode: 'fix', by: 'peter', now: '2026-11-25T17:00:00Z' });
  const first = await runTagCheck({ db: DB, kit, now: () => '2026-11-25T17:02:00Z' });
  assert.deepEqual(first.did, [`tag check ${id}: 6 on the tag, 1 of them unsubscribed in Shopify`]);
  assert.ok(!kit.calls.some((c) => c.startsWith('DELETE')), 'the first run only reads');
  const listed = await people(DB);
  assert.deepEqual(listed.map((p) => [p.kit_id, p.email, p.shopify_state, p.action]), [
    [11, 'holly@example.com', 'SUBSCRIBED', 'untag'],
    [12, 'yes@example.com', 'SUBSCRIBED', 'untag'],
    [13, 'gone@example.com', 'SUBSCRIBED', 'untag'],
    [14, 'no@example.com', 'UNSUBSCRIBED', 'keep'],
    // Never asked (at the register), or not in Shopify at all: the tag comes off
    [15, 'never@example.com', 'NOT_SUBSCRIBED', 'untag'],
    [16, 'stranger@example.com', null, 'untag'],
  ]);
  assert.equal(listed[0].tagged_at, '2026-11-16T16:40:00Z');
  assert.equal(listed[0].store_tagged_at, '2026-11-03T10:00:00Z');
  assert.equal(listed[1].store_tagged_at, null, 'not on the store’s list');
  assert.equal(listed[0].shopify_state_at, '2025-09-18T18:33:05Z');

  // Three a run, as Kit allows
  const second = await runTagCheck({ db: DB, kit, now: () => '2026-11-25T17:04:00Z', budget: 3 });
  assert.deepEqual(second.did, [`tag check ${id}: tag taken off 3, 2 to go`]);
  const third = await runTagCheck({ db: DB, kit, now: () => '2026-11-25T17:06:00Z', budget: 3 });
  assert.deepEqual(third.did, [`tag check ${id}: tag taken off 2, 0 to go`]);
  assert.deepEqual([...kit.tags.get(2).keys()], [14], 'only the one who unsubscribed in Shopify keeps the tag');
  assert.equal(kit.tags.get(1).size, 5, 'the store’s list is left alone');
  const done = await DB.prepare('SELECT * FROM kit_tag_checks WHERE id = ?').bind(id).first();
  assert.equal(done.done_at, '2026-11-25T17:06:00Z');
  assert.equal(await runTagCheck({ db: DB, kit }), null, 'a finished check isn’t run again');
  await mf.dispose();
});

test('a report lists them and changes nothing in Kit', async () => {
  const { DB, mf } = await freshDb();
  await loadShopify(DB);
  const kit = fakeKit(PEOPLE);
  await askCheck(DB, { mode: 'report', by: 'peter' });
  await runTagCheck({ db: DB, kit });
  assert.equal((await people(DB)).length, 6);
  assert.equal(await runTagCheck({ db: DB, kit }), null);
  assert.ok(!kit.calls.some((c) => !c.startsWith('GET')));
  assert.equal(kit.tags.get(2).size, 6);
  await mf.dispose();
});

test('with no answers from Shopify loaded, a check asks Kit nothing and says why', async () => {
  const { DB, mf } = await freshDb();
  const kit = fakeKit(PEOPLE);
  const id = await askCheck(DB, { mode: 'fix', by: 'peter' });
  const run = await runTagCheck({ db: DB, kit, now: () => '2026-11-25T17:02:00Z' });
  assert.match(run.did[0], /no answers from Shopify are loaded/);
  assert.deepEqual(kit.calls, []);
  const check = await DB.prepare('SELECT * FROM kit_tag_checks WHERE id = ?').bind(id).first();
  assert.equal(check.done_at, null);
  assert.equal(check.error_at, '2026-11-25T17:02:00Z');
  await mf.dispose();
});

test('Kit failing partway is noted, and the next run picks up where it stopped', async () => {
  const { DB, mf } = await freshDb();
  await loadShopify(DB);
  const kit = fakeKit(PEOPLE);
  const id = await askCheck(DB, { mode: 'fix', by: 'peter' });
  await runTagCheck({ db: DB, kit });
  kit.failDelete = 1;
  const failed = await runTagCheck({ db: DB, kit });
  assert.match(failed.did[0], /stopped \(Kit said no \(500\)\.\)/);
  // Already off the tag (someone did it in Kit) counts as done
  kit.tags.get(2).delete(12);
  const next = await runTagCheck({ db: DB, kit });
  assert.deepEqual(next.did, [`tag check ${id}: tag taken off 5, 0 to go`]);
  assert.deepEqual([...kit.tags.get(2).keys()], [14]);
  const check = await DB.prepare('SELECT * FROM kit_tag_checks WHERE id = ?').bind(id).first();
  assert.ok(check.done_at);
  assert.equal(check.error, null);
  await mf.dispose();
});
