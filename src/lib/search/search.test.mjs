/**
 * The site search, tested the way it runs: the catalog as the build turns it into the index
 * (toSearchDocs, without descriptions), the engine the browser runs, and the judged query
 * set (fixtures/judged-queries.mjs: Baymard's query types, each with a rule for a right answer).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { completions, countFor, popular, results } from './complete.mjs';
import { imageUrl, toSearchDocs } from './docs.mjs';
import { buildIndex, cleanTitle, distance, normalize, parse, search, stem, suggest } from './engine.mjs';
import { NON_PRODUCT_PAGES, QUERIES } from './fixtures/judged-queries.mjs';
import { cleanQuery, cleanSearchEvent } from './log.mjs';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/catalog-2026-11-16.json', import.meta.url), 'utf8'));
const docs = toSearchDocs(catalog, Object.fromEntries(catalog.map((p) => [p.handle, p.collections])));
// Through JSON, as the browser gets it.
const index = buildIndex(JSON.parse(JSON.stringify(docs)));
const byHandle = new Map(catalog.map((p) => [p.handle, p]));
const found = (q) => results(index, q).items.map(({ item }) => byHandle.get(item.doc.h));

// ── text ────────────────────────────────────────────────────────────────

test('inches and feet are written one way, however they were typed', () => {
  assert.equal(normalize('72" Console'), '72in console');
  assert.equal(normalize('72 inch console'), '72in console');
  assert.equal(normalize("72'' console"), '72in console');
  assert.equal(normalize("8' x 10' rug"), '8ft x 10ft rug');
  assert.equal(normalize('Café & Bar'), 'cafe and bar');
});

test('plurals become singular', () => {
  assert.deepEqual(['shelves', 'benches', 'tables', 'accessories', 'glass', 'sofa'].map(stem), ['shelf', 'bench', 'table', 'accessory', 'glass', 'sofa']);
});

test('a title loses the vendor code shoppers never type', () => {
  assert.equal(cleanTitle('Dovely Sofa - Natural - BHF'), 'Dovely Sofa - Natural');
  assert.equal(cleanTitle('36"Trenton Coffee Table'), '36" Trenton Coffee Table');
});

test('edit distance counts a swap of two letters as one slip', () => {
  assert.equal(distance('sofa', 'sofa'), 0);
  assert.equal(distance('sofa', 'sfoa'), 1);
  assert.equal(distance('dresser', 'drsser'), 1);
  assert.ok(distance('sofa', 'table') > 2);
});

// ── understanding a query ───────────────────────────────────────────────

test('prices: under is below the number, up to includes it, between is both ends', () => {
  assert.equal(parse('sofa under 1000', index).price.max, 999.99);
  assert.equal(parse('sofa up to $1,000', index).price.max, 1000);
  assert.equal(parse('chair over 300', index).price.min, 300);
  assert.deepEqual(parse('rug between 200 and 400', index).price, { min: 200, max: 400, cheap: false });
  assert.equal(parse('cheap coffee table', index).price.cheap, true);
});

test('sizes: a rug in feet, a piece in inches, a table by how many it seats', () => {
  assert.deepEqual(parse('8x10 rug', index).rug, [8, 10]);
  assert.deepEqual(parse('72 inch console', index).inches, [72]);
  const q = parse('a table for 6 people', index);
  assert.equal(q.seats, 6);
  assert.ok(q.kinds.includes('dining-table'));
});

test('a misspelling is fixed to a word the catalog or the lexicon has', () => {
  assert.equal(parse('sectinal', index).corrected, 'sectional');
  assert.equal(parse('recliener', index).corrected, 'recliner');
  assert.equal(parse('sofa', index).corrected, null);
});

test('a real word for something the store doesn’t sell is left alone, not “fixed” into something it does', () => {
  for (const q of ['gift card', 'lamp', 'pillow', 'candle']) {
    assert.equal(parse(q, index).corrected, null, q);
    assert.equal(results(index, q).items.length, 0, `${q} shows pieces nobody asked for`);
  }
  // The store has one vase: it's found, and "vase" is never read as "base".
  assert.deepEqual(found('vase').map((p) => p.title), ['S/2 Abstract Floral Vase - DON']);
});

test('a room with a kind narrows nothing; alone, it is the room', () => {
  assert.deepEqual(parse('living room sofa', index).rooms, []);
  assert.deepEqual(parse('living room', index).rooms, ['living']);
});

// ── the judged set ──────────────────────────────────────────────────────

const judged = QUERIES.filter(([, , rule]) => rule);
const rows = judged.map(([q, type, rule]) => {
  const list = found(q);
  const top = list.slice(0, 5);
  const relevant = catalog.filter(rule).length;
  return { q, type, relevant, results: list.length, hits: top.filter(rule).length, top: top.length, recall: relevant ? list.filter(rule).length / relevant : 1 };
}).filter((r) => r.relevant > 0);
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test(`every judged query (${rows.length}) finds a right piece in its first five`, () => {
  const misses = rows.filter((r) => r.hits === 0).map((r) => `${r.q} (${r.type}): ${r.results} results`);
  assert.deepEqual(misses, []);
});

test('the first five are right at least 96% of the time (precision@5, was 0.55 before this engine)', () => {
  const p = avg(rows.map((r) => r.hits / Math.min(5, r.top || 5)));
  assert.ok(p >= 0.96, `precision@5 ${p.toFixed(3)}`);
});

test('a search finds at least 93% of the pieces it should (recall, was 0.38)', () => {
  const r = avg(rows.map((x) => x.recall));
  assert.ok(r >= 0.93, `recall ${r.toFixed(3)}`);
});

test('questions that aren’t products offer the page that answers them, and no pieces', () => {
  for (const [q, href] of Object.entries(NON_PRODUCT_PAGES)) {
    const r = results(index, q);
    assert.deepEqual(r.query.pages.map((p) => p.href), href ? [href] : [], q);
    assert.equal(r.items.length, 0, q);
  }
});

const soldBeforeStock = (items) => {
  const stock = items.map(({ item }) => item.doc.s);
  const firstSold = stock.indexOf(0);
  return firstSold !== -1 && stock.slice(firstSold).includes(1);
};

test('every piece in stock comes before every sold one, as everywhere on the site', () => {
  // "gray" is any gray: a heather sofa in stock comes before a sold one called Gray.
  for (const q of ['sofa', 'gray sofa', 'grey sectional', 'leather sofa', 'dining table', 'rug']) {
    assert.ok(!soldBeforeStock(results(index, q).items), `${q}: a piece in stock after a sold one`);
  }
});

test('a specific look typed comes first ("walnut", "king"), then pieces in stock', () => {
  for (const [q, word] of [['walnut table', 'walnut'], ['king bed', 'king'], ['navy chair', 'navy'], ['swivel chair', 'swivel']]) {
    const items = results(index, q).items;
    const says = items.map(({ item }) => item.titleT.includes(word) || (word === 'king' && item.titleT.includes('kg')));
    const firstNot = says.indexOf(false);
    assert.ok(firstNot === -1 || !says.slice(firstNot).includes(true), `${q}: a piece without “${word}” before one with it`);
    assert.ok(!soldBeforeStock(items.filter((_, i) => says[i])), `${q}: among pieces saying “${word}”, a sold one before one in stock`);
  }
});

test('every keystroke is answered fast: 95% of searches under 8ms, with suggestions', () => {
  const times = [];
  for (const [q] of QUERIES) {
    for (let i = 1; i <= q.length; i++) {
      const typed = q.slice(0, i);
      const t0 = performance.now();
      suggest(index, typed, { products: 5, kinds: 0 });
      completions(index, typed, { max: 4 });
      results(index, typed);
      times.push(performance.now() - t0);
    }
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 8, `p95 ${p95.toFixed(2)}ms over ${times.length} keystrokes`);
});

// ── as you type ─────────────────────────────────────────────────────────

test('suggested searches finish the word being typed', () => {
  assert.equal(completions(index, 'coff')[0].text, 'coffee table');
  assert.equal(completions(index, 'nig')[0].text, 'nightstand');
  assert.ok(completions(index, 'gray so').some((s) => s.text === 'gray sofa'));
});

test('a suggested search never leads to an empty page or to “closest matches”', () => {
  for (const [q] of QUERIES) {
    for (let i = 1; i <= q.length; i++) {
      for (const s of completions(index, q.slice(0, i))) {
        const r = search(index, s.text);
        assert.ok(r.items.length > 0 && !r.partial && !r.relaxed.length, `“${q.slice(0, i)}” suggests “${s.text}”`);
        assert.equal(s.count, r.items.length);
      }
    }
  }
});

test('a typo still gets suggestions, marked as fixed', () => {
  const s = completions(index, 'recliener');
  assert.equal(s[0].text, 'recliner');
  assert.equal(s[0].corrected, true);
});

test('no suggestion repeats what was typed, or a kind twice', () => {
  const s = completions(index, 'sofa', { max: 6 });
  assert.ok(!s.some((x) => x.text === 'sofa'));
  assert.equal(new Set(s.map((x) => x.text)).size, s.length);
  assert.ok(!completions(index, 'cou').some((x) => x.text === 'chair and a half'));
});

test('a look is suggested only when it tells pieces apart: the word “coffee” doesn’t make a table brown', () => {
  // 57 of 61 coffee tables were "brown" while coffee counted as a shade of brown.
  assert.ok(countFor(index, 'brown coffee table') <= 20, `${countFor(index, 'brown coffee table')} brown coffee tables`);
  assert.ok(!completions(index, 'sofa', { max: 8 }).some((x) => x.text === 'upholstered sofa'));
});

test('half-typed words find pieces on the results page, as the box showed them', () => {
  assert.ok(results(index, 'sof').prefixed);
  assert.ok(results(index, 'sof').items.length > 100);
  const dining = results(index, 'dining t');
  assert.ok(dining.prefixed && dining.items.slice(0, 5).every(({ item }) => item.kinds.has('dining-table')));
  // A whole word that's unknown is left out, not read as the start of another.
  assert.equal(results(index, 'sofa for my cat').prefixed, false);
});

test('before anything is typed: the kinds the best sellers are, never the catch-all “chair”', () => {
  const p = popular(index, 6);
  assert.equal(p.length, 6);
  assert.ok(!p.some((x) => x.text === 'chair'));
  for (const x of p) assert.equal(x.count, countFor(index, x.text));
});

// ── the index the build writes ──────────────────────────────────────────

test('the index is small enough to fetch on a phone: under 45KB gzipped', async () => {
  const { gzipSync } = await import('node:zlib');
  const size = gzipSync(JSON.stringify({ docs })).length;
  assert.ok(size < 45 * 1024, `${(size / 1024).toFixed(1)}KB`);
});

test('image addresses are kept short and rebuilt at the size asked for', () => {
  const withImage = toSearchDocs([{ ...catalog[0], images: { edges: [{ node: { url: 'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/a.jpg?v=1' } }] } }], {})[0];
  assert.equal(withImage.i, '~a.jpg?v=1');
  assert.equal(imageUrl(withImage.i, 112), 'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/a.jpg?v=1&width=112&height=112&crop=center&quality=70&format=webp');
});

test('any query is answered, and fast: empty, punctuation, emoji, other scripts, or a page of text', () => {
  for (const q of ['', '   ', '!!!', '"', '🛋️', 'ソファ', '__proto__', 'constructor', '9'.repeat(400), 'sofa '.repeat(2000)]) {
    const t0 = performance.now();
    results(index, q);
    completions(index, q);
    suggest(index, q);
    assert.ok(performance.now() - t0 < 100, `${JSON.stringify(q.slice(0, 20))} took ${(performance.now() - t0).toFixed(0)}ms`);
  }
});

// ── the log ─────────────────────────────────────────────────────────────

test('the log keeps the words, never an email address or a phone number', () => {
  assert.equal(cleanQuery('  Gray   SOFA '), 'gray sofa');
  assert.equal(cleanQuery('jane.doe@example.com sofa'), '(email) sofa');
  assert.equal(cleanQuery('call me 678-555-1234'), 'call me (number)');
  assert.equal(cleanQuery('72 inch console under 1000'), '72 inch console under 1000');
  assert.equal(cleanQuery('x'.repeat(300)).length, 120);
});

test('the log cleans even a huge query quickly (the endpoint reads 2KB at most, this is the backstop)', () => {
  const t0 = performance.now();
  cleanQuery(`${'a'.repeat(40000)}@${'b1 '.repeat(20000)}`);
  assert.ok(performance.now() - t0 < 50, `${(performance.now() - t0).toFixed(0)}ms`);
});

test('the log takes only well-formed events', () => {
  assert.deepEqual(cleanSearchEvent({ e: 'search', q: 'Sofa', n: 135, src: 'page' }), { kind: 'search', query: 'sofa', results: 135, handle: null, position: null, source: 'page' });
  assert.deepEqual(cleanSearchEvent({ e: 'click', q: 'sofa', h: 'dovely-sofa', p: 2, src: 'panel' }), { kind: 'click', query: 'sofa', results: null, handle: 'dovely-sofa', position: 2, source: 'panel' });
  for (const bad of [null, 'sofa', {}, { e: 'search', q: '', n: 1, src: 'page' }, { e: 'search', q: 'sofa', n: -1, src: 'page' }, { e: 'search', q: 'sofa', n: 1.5, src: 'page' },
    { e: 'click', q: 'sofa', h: '../admin', p: 1, src: 'page' }, { e: 'click', q: 'sofa', h: 'a', p: 0, src: 'page' }, { e: 'click', q: 'sofa', h: 'a', p: 1, src: 'email' }, { e: 'drop', q: 'sofa' }]) {
    assert.equal(cleanSearchEvent(bad), null, JSON.stringify(bad));
  }
});
