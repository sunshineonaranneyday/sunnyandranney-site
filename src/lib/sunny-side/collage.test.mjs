import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { insertAt, moveTo, spotWords, swapAt } from './collage.mjs';
import { LAYOUTS } from './collage-layouts.mjs';
import { Email, render } from './email.mjs';
import { pageEmail } from './page-email.mjs';
import { cleanParts } from './parts.mjs';
import { addPhoto, cleanFocus, focusPoint, listPhotos, photoSource, photosByIds, setFocus, withFocus } from './photo-store.mjs';
import { draftSale, clean } from './special.mjs';

const SITE = 'https://sunnyandranney.com';
const ids = ['aaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaa3', 'aaaaaaaaaaaaaaaa4', 'aaaaaaaaaaaaaaaa5', 'aaaaaaaaaaaaaaaa6'];
const [a, b, c, d, e, f] = ids;

test('a photo dragged to a new spot takes it; the ones between shift over one', () => {
  assert.deepEqual(moveTo([a, b, c, d, e], 4, 0), [e, a, b, c, d], 'photo 5 to the wide spot in one move');
  assert.deepEqual(moveTo([a, b, c, d, e], 0, 4), [b, c, d, e, a]);
  assert.deepEqual(moveTo([a, b, c], 1, 2), [a, c, b]);
  assert.deepEqual(moveTo([a, b, c], 1, 1), [a, b, c]);
  assert.deepEqual(moveTo([a, b, c], 1, 9), [a, c, b], 'past the end is the last spot');
  assert.deepEqual(moveTo([a, b, c], 5, 0), [a, b, c], 'a spot that isn’t there changes nothing');
});

test('a library photo goes in at a spot while there’s room, else swaps out the one there', () => {
  assert.deepEqual(insertAt([a, b, c], d, 0), [d, a, b, c]);
  assert.deepEqual(insertAt([a, b, c], d, 3), [a, b, c, d]);
  assert.deepEqual(insertAt([a, b, c], b, 0), [a, b, c], 'a photo already in it isn’t doubled');
  assert.deepEqual(insertAt([a, b, c, d, e], f, 0), [a, b, c, d, e], 'a full collage takes no more');
  assert.deepEqual(swapAt([a, b, c, d, e], f, 2), [a, b, f, d, e]);
  assert.deepEqual(swapAt([a, b, c, d, e], b, 2), [a, b, c, d, e], 'a photo already in it can’t be swapped in twice');
  assert.deepEqual(swapAt([a, b], f, 4), [a, b]);
});

test('each spot is said where it is in its layout, as a spot', () => {
  const tree = (id, n) => LAYOUTS[n].find((l) => l.id === id).tree;
  assert.equal(spotWords(tree('wide-top', 5), 0), 'spot 1 of 5, top, wide');
  assert.equal(spotWords(tree('wide-top', 5), 4), 'spot 5 of 5, bottom right, square');
  assert.equal(spotWords(tree('big-left', 3), 0), 'spot 1 of 3, left, square');
  assert.equal(spotWords(tree('big-left', 3), 2), 'spot 3 of 3, bottom right, square');
  assert.equal(spotWords(tree('three-tall', 3), 1), 'spot 2 of 3, middle, tall');
  // Every spot of every layout has words, and no two spots of a layout say the same
  for (const [n, list] of Object.entries(LAYOUTS)) {
    for (const l of list) {
      const words = Array.from({ length: Number(n) }, (_, k) => spotWords(l.tree, k));
      assert.ok(
        words.every((w) => /^spot \d of \d, /.test(w)),
        `${l.id}: ${words}`,
      );
      assert.equal(new Set(words.map((w) => w.replace(/^spot \d of \d, /, ''))).size, words.length, `${l.id}: two spots said the same way: ${words}`);
    }
  }
});

test('a focus point is two numbers from 0 to 1, kept to two places, and nothing else gets through', () => {
  assert.equal(cleanFocus('0.42x0.31'), '0.42x0.31');
  assert.equal(cleanFocus('0.425x0.3'), '0.43x0.3');
  assert.equal(cleanFocus('1x0'), '1x0');
  assert.equal(cleanFocus({ x: 0.333333, y: 1.4 }), '0.33x1', 'a drag past the edge stops at it');
  assert.equal(cleanFocus({ x: -0.2, y: 0.5 }), '0x0.5');
  for (const bad of ['', 'auto', '1.2x0.5', '0.5', '0.5x', 'x0.5', '0.5x0.5,quality=100', '0.5x0.5/../', null, undefined, 3, { x: NaN, y: 0 }]) {
    assert.equal(cleanFocus(bad), '', String(bad));
  }
  assert.deepEqual(focusPoint('0.25x0.75'), { x: 0.25, y: 0.75 });
  assert.equal(focusPoint(''), null);
});

test('the email crops a photo around its focus point, and around what stands out without one', () => {
  assert.equal(withFocus(`photo:${a}`, '0.2x0.8'), `photo:${a}@0.2x0.8`);
  assert.equal(withFocus(`photo:${a}`, ''), `photo:${a}`);
  assert.equal(withFocus('cf:sunny-ranney-interior', '0.2x0.8'), 'cf:sunny-ranney-interior', 'only the store’s own uploads carry one');
  assert.deepEqual(photoSource(`photo:${a}@0.2x0.8`), { id: a, gravity: '0.2x0.8' });
  assert.deepEqual(photoSource(`photo:${a}@quality=100`), { id: a, gravity: 'auto' }, 'anything else is left to the resizing');
  assert.equal(Email.photo(`photo:${a}@0.2x0.8`, 600, 300), `https://shop.sunnyandranney.com/cdn-cgi/image/width=600,height=300,fit=cover,gravity=0.2x0.8,quality=64,format=jpeg/${SITE}/media/email/${a}.jpg/`);
  assert.equal(Email.photo(`photo:${a}`, 600, 300), `https://shop.sunnyandranney.com/cdn-cgi/image/width=600,height=300,fit=cover,gravity=auto,quality=64,format=jpeg/${SITE}/media/email/${a}.jpg/`);

  // The whole email: the top photo and every collage photo with a point are cropped around it
  const photos = new Map(ids.map((id, k) => [id, { id, w: 1600, h: 2000, alt: `Photo ${k + 1}`, focus: k % 2 ? '' : `0.${k + 1}x0.9` }]));
  const parts = cleanParts({ subject: 'Christmas is in store!', hero: a, story: { headline: 'Christmas is here.', body: 'The trees are up.', photos: [c, b, e], layout: 'wide-top' } });
  const sale = draftSale(clean({ kind: 'percent', percent: 20, what: 'everything', ends: '2026-11-29' }));
  const page = pageEmail({ sale, wall: null, parts, photos, kids: [], catalog: null, events: [], impact: null, send: '2026-11-17', site: SITE });
  const html = render(page.brief, page.sections);
  assert.ok(html.includes(`width=1200,height=600,fit=cover,gravity=0.1x0.9,quality=64,format=jpeg/${SITE}/media/email/${a}.jpg/`), 'the top photo');
  assert.ok(html.includes(`width=1200,height=600,fit=cover,gravity=0.3x0.9,quality=64,format=jpeg/${SITE}/media/email/${c}.jpg/`), 'the collage’s wide photo');
  assert.ok(html.includes(`fit=cover,gravity=auto,quality=64,format=jpeg/${SITE}/media/email/${b}.jpg/`), 'one without a point');
  assert.ok(html.includes(`fit=cover,gravity=0.5x0.9,quality=64,format=jpeg/${SITE}/media/email/${e}.jpg/`));
  assert.ok(!html.includes('@0.'), 'the point never shows in an address as typed');
});

// Real D1 (Miniflare's local SQLite)
test('a photo’s focus point is kept in the library, and a library made before it gets the column', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: 'collage-test' } });
  try {
    const DB = await mf.getD1Database('DB');
    // The table as it was first made, with a photo in it
    await DB.prepare(`CREATE TABLE email_photos (id TEXT PRIMARY KEY, w INTEGER NOT NULL, h INTEGER NOT NULL, bytes INTEGER NOT NULL, alt TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL)`).run();
    await DB.prepare('INSERT INTO email_photos VALUES (?, 2400, 1600, 1, ?, ?, ?)').bind(a, 'The tree', 'staci@x.com', '2026-11-16T10:00:00Z').run();
    assert.deepEqual(
      (await listPhotos(DB)).map((p) => [p.id, p.focus]),
      [[a, '']],
    );
    await addPhoto(DB, { id: b, w: 1600, h: 2400, bytes: 2, alt: 'Ornaments', by: 'staci@x.com', now: '2026-11-16T11:00:00Z' });
    assert.equal(await setFocus(DB, a, '0.3x0.65'), true);
    assert.equal(await setFocus(DB, 'nope', '0.3x0.65'), false);
    assert.equal(await setFocus(DB, b, 'gravity=face'), true, 'something that isn’t a point is stored as none');
    assert.deepEqual((await photosByIds(DB, [a, b])).map((p) => [p.id, p.focus]).sort(), [
      [a, '0.3x0.65'],
      [b, ''],
    ]);
    assert.equal(await setFocus(DB, a, ''), true, 'back to the resizing’s choice');
    assert.equal((await photosByIds(DB, [a]))[0].focus, '');
  } finally {
    await mf.dispose();
  }
});
