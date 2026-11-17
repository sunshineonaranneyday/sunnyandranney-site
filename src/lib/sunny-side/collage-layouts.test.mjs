import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIC, GUTTER, LAYOUTS, bestFit, cellWords, countOf, fitOf, fitPhotos, heightAt, kept, layoutFor, paddings, place, solve } from './collage-layouts.mjs';
import { COLLAGE_ROWS, Email, render } from './email.mjs';
import { briefParts, cleanParts } from './parts.mjs';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const all = Object.entries(LAYOUTS).flatMap(([n, list]) => list.map((l) => ({ n: Number(n), ...l })));

/**
 * The collage at width w as a picture: every photo's edges either sit on the collage's own edge or
 * face another photo's edge across exactly one gutter. A ragged edge (a photo a pixel short of its
 * neighbors) or a gap that isn't 4px fails it.
 */
function loose(rects, w) {
  const H = Math.max(...rects.map((r) => r.y + r.h));
  const out = [];
  for (const [k, r] of rects.entries()) {
    const right = r.x + r.w, bottom = r.y + r.h;
    const overlapsV = (o) => o.y < bottom - 0.01 && o.y + o.h > r.y + 0.01;
    const overlapsH = (o) => o.x < right - 0.01 && o.x + o.w > r.x + 0.01;
    if (!near(right, w, 1e-6) && !rects.some((o) => overlapsV(o) && near(o.x, right + GUTTER, 1e-6))) out.push(`photo ${k + 1}'s right edge`);
    if (!near(r.x, 0, 1e-6) && !rects.some((o) => overlapsV(o) && near(o.x + o.w, r.x - GUTTER, 1e-6))) out.push(`photo ${k + 1}'s left edge`);
    if (!near(bottom, H, 1e-6) && !rects.some((o) => overlapsH(o) && near(o.y, bottom + GUTTER, 1e-6))) out.push(`photo ${k + 1}'s bottom edge`);
    if (!near(r.y, 0, 1e-6) && !rects.some((o) => overlapsH(o) && near(o.y + o.h, r.y - GUTTER, 1e-6))) out.push(`photo ${k + 1}'s top edge`);
  }
  // The photos and gutters fill the box: no hole a photo should have covered
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  if (area > w * H + 1e-6) out.push('photos overlap');
  return out;
}

test('every layout holds its count, fills the full width and ends level, with 4px gutters at every width', () => {
  for (const l of all) {
    assert.equal(countOf(l.tree), l.n, `${l.n} ${l.id}`);
    for (let w = 280; w <= 700; w += 7) {
      const rects = place(l.tree, w);
      assert.equal(rects.length, l.n);
      assert.ok(rects.every((r) => r.w > 40 && r.h > 30), `${l.n} ${l.id} at ${w}: a photo too small to see`);
      assert.deepEqual(loose(rects, w), [], `${l.n} ${l.id} at ${w}px`);
      // Each photo keeps its cell's shape at every width, so a resized photo fills it exactly
      const shapes = place(l.tree, 600).map((r) => r.w / r.h);
      rects.forEach((r, k) => assert.ok(near(r.w / r.h, shapes[k], 1e-9), `${l.n} ${l.id}: photo ${k + 1} changes shape at ${w}px`));
      assert.ok(near(heightAt(l.tree, w), Math.max(...rects.map((r) => r.y + r.h)), 1e-6));
    }
  }
});

test('no cell needs a negative padding, which an email can’t draw', () => {
  const walk = (t, s) => {
    if (Array.isArray(t)) return;
    if (t.across) for (const [l, r] of paddings(s.c)) assert.ok(l >= -1e-9 && r >= -1e-9, JSON.stringify(t));
    (t.across ?? t.down).forEach((c, k) => walk(c, s.kids[k]));
  };
  for (const l of all) walk(l.tree, solve(l.tree));
});

test('the first layout for each count is the classic collage, so a week that never picks keeps its sizes', () => {
  for (const n of [3, 4, 5]) assert.equal(LAYOUTS[n][0].id, CLASSIC);
  const sizes = (n) => place(LAYOUTS[n][0].tree).map((r) => `${Math.round(r.w)}x${Math.round(r.h)}`);
  assert.deepEqual(sizes(3), ['600x300', '298x298', '298x298']);
  assert.deepEqual(sizes(4), ['600x300', '197x197', '197x197', '197x197']);
  assert.deepEqual(sizes(5), ['600x300', '298x298', '298x298', '298x298', '298x298']);
  // COLLAGE_ROWS still describes it
  for (const n of [1, 2, 3, 4, 5]) assert.equal(COLLAGE_ROWS[n].reduce((a, b) => a + b, 0), n);
  // The bento box lines up with a row of three: 2 squares and a gutter
  const [big, small] = place(LAYOUTS[3].find((l) => l.id === 'big-left').tree);
  assert.ok(near(big.w, 2 * small.w + GUTTER) && near(big.h, big.w) && near(small.x, big.w + GUTTER));
});

test('the best fit for the store’s real photos: phone shots, 3 tall and 2 wide (the Nov 17, 2026 library)', () => {
  const P = 0.75, L = 4 / 3;
  const real = [P, P, L, L, P]; // the Nov 17 collage, in Staci's order
  const classic = fitOf(LAYOUTS[5][0], real);
  const best = bestFit(real);
  assert.equal(best.id, 'tall-row');
  assert.ok(classic < 0.63 && fitOf(best, real) > 0.8, `${classic} -> ${fitOf(best, real)}`);
  // Moving photos 3 and 5 keeps all of every photo
  const moved = fitPhotos(best, ['a', 'b', 'c', 'd', 'e'], (x) => real['abcde'.indexOf(x)]);
  assert.deepEqual(moved.items, ['a', 'b', 'e', 'c', 'd']);
  assert.ok(near(moved.fit, 1));
  // Her order stays when moving keeps less than 3 points more
  const square = LAYOUTS[4].find((l) => l.id === 'grid');
  assert.deepEqual(fitPhotos(square, ['a', 'b', 'c', 'd'], (x) => (x === 'a' ? L : P)).items, ['a', 'b', 'c', 'd']);
  // All portraits or all landscapes find their own layouts
  assert.equal(bestFit([P, P]).id, 'pair-tall');
  assert.equal(bestFit([P, P, P]).id, 'three-tall');
  assert.equal(bestFit([L]).id, 'whole');
  assert.ok(near(kept(4 / 3, 2), 2 / 3));
});

test('the layout the email draws: hers while it fits the count, else the best fit, else the classic', () => {
  assert.equal(layoutFor('big-left', [1, 1, 1]).id, 'big-left');
  assert.equal(layoutFor('big-left', [1, 1]).id, bestFit([1, 1]).id);
  assert.equal(layoutFor('', null, 4).id, CLASSIC);
  assert.equal(layoutFor('nope', [0.75, 0.75, 0.75]).id, 'three-tall');
  assert.equal(cleanParts({ story: { layout: 'big-left' } }).story.layout, 'big-left');
  assert.equal(cleanParts({ story: { layout: '<b>' } }).story.layout, '');
  const photos = new Map(['aaaaaaaaaaaa1', 'aaaaaaaaaaaa2', 'aaaaaaaaaaaa3'].map((id) => [id, { id, w: 1800, h: 2400, alt: 'x' }]));
  const s = (layout) => briefParts(cleanParts({ story: { headline: 'h', photos: [...photos.keys()], layout } }), { sale: null, photos }).story;
  assert.equal(s('').layout, 'three-tall');
  assert.equal(s('big-right').layout, 'big-right');
  assert.equal(s('').photos.length, 3);
});

test('the email asks for each photo in its cell’s exact shape, and a brief naming no layout gets the classic one', () => {
  const brief = (layout) => ({
    send_date: '2026-11-17',
    story: { label: 'x', headline: 'x', body: 'x', cta: ['Visit', '/visit/'], layout, photos: [1, 2, 3].map((k) => ({ src: `photo:aaaaaaaaaaaa${k}`, alt: `Photo ${k}` })) },
  });
  const tall = render(brief('tall-left'), ['story']);
  const asked = [...tall.matchAll(/width=(\d+),height=(\d+),fit=cover/g)].map((m) => Number(m[1]) / Number(m[2]));
  assert.deepEqual(asked, [0.75, 4 / 3, 4 / 3]);
  // The tall photo's column and the stack beside it: shares and paddings from solve()
  assert.match(tall, /<td width="52\.94%" valign="top"><table [^>]+><tr><td style="padding:0 0\.706px 0 0;">/);
  assert.match(tall, /max-width:316\.941px/);
  assert.match(render(brief(undefined), ['story']), /width="600" height="300" alt="Photo 1"/);
  assert.throws(() => render(brief('grid'), ['story']), /isn't a layout for 3 photos/);
  assert.equal(Email.photo('photo:abc', 10, 10).includes('width=10,height=10'), true);
});

test('each photo’s spot in words, for a screen reader', () => {
  const t = (n, id) => LAYOUTS[n].find((l) => l.id === id).tree;
  assert.equal(cellWords(t(3, 'big-left'), 0), 'photo 1 of 3, left, square');
  assert.equal(cellWords(t(3, 'big-left'), 2), 'photo 3 of 3, bottom right, square');
  assert.equal(cellWords(t(3, 'wide-top'), 0), 'photo 1 of 3, top, wide');
  assert.equal(cellWords(t(1, 'wide'), 0), 'photo 1 of 1, full width, wide');
  assert.equal(cellWords(t(5, 'tall-row'), 4), 'photo 5 of 5, bottom right, wide');
});

test('a reveal never takes the collage out of the email, so its photos are held to the email’s checks either way', async () => {
  const { checkParts } = await import('./parts.mjs');
  const ids = ['aaaaaaaaaaaa1', 'aaaaaaaaaaaa2'];
  const photos = new Map([
    [ids[0], { id: ids[0], w: 1800, h: 2400, alt: 'The tree by the door' }],
    [ids[1], { id: ids[1], w: 1800, h: 2400, alt: '' }],
  ]);
  const week = (reveal) => cleanParts({ hero: ids[0], reveal, story: { headline: 'h', body: 'b', photos: ids } });
  assert.match(checkParts(week(''), { photos }).photos, /A photo in the email needs a few words/);
  assert.match(checkParts(week('dylan'), { photos }).photos, /A photo in the email needs a few words/);
});
