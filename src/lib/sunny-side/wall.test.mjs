import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Email, render } from './email.mjs';
import { previewBrief, toSale, clean } from './special.mjs';
import { arrange, checkWall, cleanWall, previewWall, shortName, tileNames, toWall } from './wall.mjs';

const SITE = 'https://sunnyandranney.com';
const SEND = '2026-11-17';
const photo = (h, w = 1000, ht = 1000) => ({ url: `https://cdn.shopify.com/s/files/1/0930/2117/6092/files/${h}.jpg?v=1`, w, h: ht });
const item = (handle, o = {}) => ({ handle, name: handle.replace(/-/g, ' '), title: handle.replace(/-/g, ' '), price: 100, was: null, qty: 2, added: '2026-01-01', kind: 'Armchairs', type: '', collections: [], photos: [photo(handle)], rank: null, staffPick: false, ...o });
const catalogOf = (...items) => new Map(items.map((p) => [p.handle, p]));
const pickOf = (p, o = {}) => ({ handle: p.handle, photo: p.photos[0].url, name: '', ...o });

test('picks are tidied: unknown fields dropped, at most a few over the limit kept', () => {
  const w = cleanWall({ picks: Array.from({ length: 20 }, (_, k) => ({ handle: ` Chair-${k} `, photo: 'x', name: '  A  name ', extra: 1 })), arranged: 'hand', label: ' Hi ' });
  assert.equal(w.picks.length, 12);
  assert.deepEqual(w.picks[0], { handle: 'chair-0', photo: 'x', name: 'A name' });
  assert.equal(w.arranged, 'hand');
  assert.equal(w.label, 'Hi');
  assert.equal(cleanWall(null).arranged, 'auto');
});

test('the email holds 4 to 9 products', () => {
  const items = Array.from({ length: 10 }, (_, k) => item(`p${k}`));
  const cat = catalogOf(...items);
  assert.equal(checkWall(cleanWall({ picks: items.slice(0, 3).map((p) => pickOf(p)) }), { catalog: cat }).picks, 'Pick at least 4 products. 1 more to go.');
  assert.deepEqual(checkWall(cleanWall({ picks: items.slice(0, 4).map((p) => pickOf(p)) }), { catalog: cat }), {});
  assert.deepEqual(checkWall(cleanWall({ picks: items.slice(0, 9).map((p) => pickOf(p)) }), { catalog: cat }), {});
  assert.match(checkWall(cleanWall({ picks: items.map((p) => pickOf(p)) }), { catalog: cat }).picks, /9 products at most. Take 1 out/);
});

test('each product is checked against the store: listed, in stock, its own photo, a name that fits', () => {
  const ok = [item('a'), item('b'), item('c')];
  const sold = item('sold', { qty: 0 });
  const long = item('long', { title: 'Lullaby Power Glider Recliner, Pebble' });
  const cat = catalogOf(...ok, sold, long);
  const base = ok.map((p) => pickOf(p));
  const errs = (extra) => checkWall(cleanWall({ picks: [...base, extra] }), { catalog: cat });
  assert.match(errs(pickOf(sold))['picks.sold'], /is sold out/);
  assert.match(errs({ handle: 'gone', photo: photo('gone').url, name: '' })['picks.gone'], /isn’t on the website anymore/);
  assert.match(errs({ ...pickOf(ok[0]), handle: 'a' })['picks.a'], /is in twice/);
  // Asked only when it can't be shortened on its own
  assert.match(errs(pickOf(long))['picks.long'], /Lullaby Power Glider Recliner, Pebble is too long for a tile and can’t be shortened on its own/);
  assert.equal(errs(pickOf(long, { name: 'Lullaby Glider' }))['picks.long'], undefined);
  assert.match(errs(pickOf(long, { name: 'x'.repeat(29) }))['picks.long'], /too long for a tile/);
  assert.match(errs(pickOf(long, { photo: photo('someone-else').url, name: 'Lullaby Glider' }))['picks.long'], /one of Lullaby Glider’s own photos/);
  assert.match(errs(pickOf(long, { photo: 'https://example.com/x.jpg', name: 'L' }))['picks.long'], /Pick a photo/);
  // Without the catalog (the server), only what can be checked without it
  assert.deepEqual(checkWall(cleanWall({ picks: [...base, pickOf(sold)] })), {});
});

test('two tiles can’t say the same name', () => {
  const a = item('knox-natural', { title: 'Knox Nesting Table Set, Natural' });
  const b = item('knox-black', { title: 'Knox Nesting Table Set, Black' });
  const cat = catalogOf(a, b, item('c'), item('d'));
  const e = checkWall(cleanWall({ picks: [pickOf(a, { name: 'Knox Nesting Table Set' }), pickOf(b, { name: 'knox nesting table set' }), pickOf(item('c')), pickOf(item('d'))] }), { catalog: cat });
  assert.match(e['picks.knox-black'], /Two products would both say “knox nesting table set”/);
  assert.equal(e['picks.knox-natural'], undefined);
});

test('the title can only call the products new if every one is', () => {
  const fresh = [1, 2, 3, 4].map((k) => item(`n${k}`, { added: '2026-11-01' }));
  const cat = catalogOf(...fresh, item('old', { added: '2025-09-01' }));
  const w = (picks, headline) => cleanWall({ picks: picks.map((p) => pickOf(p)), headline });
  assert.deepEqual(checkWall(w(fresh, 'Just landed this week.'), { catalog: cat, send: SEND }), {});
  assert.match(checkWall(w([...fresh.slice(0, 3), cat.get('old')], 'New this week.'), { catalog: cat, send: SEND }).headline, /old isn’t \(new means added in the last 30 days\)/);
  assert.deepEqual(checkWall(w([...fresh.slice(0, 3), cat.get('old')], 'Our picks this week.'), { catalog: cat, send: SEND }), {});
});

test('every tile is named for her: shortened when too long, never two alike, asked only when it can’t be', () => {
  const names = ['Knox Nesting Table Set, Chestnut', 'Knox Nesting Table Set, Natural', 'Rosalie Dining Side Chair Nat/Grey', 'Hamlin Swivel Chair, Beamer Blue', 'Hamlin Swivel Chair, Pebble', 'Dovely Sofa, Natural', 'Lullaby Power Glider Recliner, Pebble'];
  const cat = catalogOf(...names.map((title, k) => item(`p${k}`, { title })));
  const picks = names.map((_, k) => ({ handle: `p${k}`, photo: '', name: '' }));
  assert.deepEqual(tileNames(picks, cat), [
    'Knox Nesting Table, Chestnut', // two colors of one piece: each keeps its color
    'Knox Nesting Table, Natural',
    'Rosalie Dining Side Chair', // the finish goes
    'Hamlin Swivel, Beamer Blue', // a twin keeps its color, a word goes to make room
    'Hamlin Swivel Chair, Pebble', // fits as it is
    'Dovely Sofa, Natural',
    '', // no clean short name: the one time she's asked
  ]);
  // One Knox alone needs no color; her own name always wins, and a twin of it keeps its color
  assert.deepEqual(tileNames([picks[1]], cat), ['Knox Nesting Table Set']);
  assert.deepEqual(tileNames([{ ...picks[1] }, { ...picks[0], name: 'Knox Nesting Table Set' }], cat), ['Knox Nesting Table, Natural', 'Knox Nesting Table Set']);
  // Picked with no name, the wall is ready: the email names the tile the same way
  const four = [picks[0], picks[1], picks[2], picks[3]].map((p, k) => ({ ...p, photo: cat.get(`p${k}`).photos[0].url }));
  assert.deepEqual(checkWall(cleanWall({ picks: four }), { catalog: cat }), {});
  assert.deepEqual(previewWall(cleanWall({ picks: four }), cat, 'https://sunnyandranney.com').photos.map((ph) => ph.name), ['Knox Nesting Table, Chestnut', 'Knox Nesting Table, Natural', 'Rosalie Dining Side Chair', 'Hamlin Swivel Chair']);
});

test('a short name is suggested only when shortening leaves a real name', () => {
  assert.equal(shortName('Hamlin Swivel Chair, Beamer Blue'), 'Hamlin Swivel Chair');
  assert.equal(shortName('Rosalie Dining Side Chair Nat/Grey'), 'Rosalie Dining Side Chair');
  assert.equal(shortName('36" Portland Round Coffee Table, Natural'), 'Portland Round Coffee Table');
  assert.equal(shortName('Kuga Swivel, Sand'), 'Kuga Swivel, Sand');
  assert.equal(shortName('Lullaby Power Glider Recliner, Pebble'), '');
  assert.equal(shortName("5'x7', Haley Cozy Shag Abstract Area Rug"), '');
});

test('arranged for her: best sellers first, the widest photo leading an odd wall, two of a kind never side by side', () => {
  const chairs = [1, 2, 3].map((k) => item(`chair${k}`, { rank: k }));
  const tables = [item('table1', { rank: 4, kind: 'End Tables' }), item('table2', { rank: 6, kind: 'End Tables' })];
  const wide = item('sofa', { rank: 9, kind: 'Sofas', photos: [photo('sofa', 1500, 1000)] });
  const cat = catalogOf(...chairs, ...tables, wide);
  const order = (ps) => arrange(ps.map((p) => pickOf(p)), cat).map((p) => p.handle);
  // Even: rows of two, each row a chair beside something else
  assert.deepEqual(order([...chairs, ...tables, item('x', { rank: 99, kind: 'Rugs' })].filter((p) => cat.has(p.handle) || (cat.set(p.handle, p), true))), ['chair1', 'table1', 'chair2', 'table2', 'chair3', 'x']);
  // Odd: the sofa's wide photo leads, though it sells least
  assert.deepEqual(order([...chairs, ...tables.slice(0, 1), wide]), ['sofa', 'chair1', 'table1', 'chair2', 'chair3']);
  // A tall photo never leads when a wider one is there
  const tall = item('mirror', { rank: 0, kind: 'Mirrors', photos: [photo('mirror', 800, 1600)] });
  cat.set('mirror', tall);
  assert.equal(order([tall, ...chairs.slice(0, 3), wide])[0], 'sofa');
});

test('the picks become the email’s photo wall, which the email draws', () => {
  const items = [1, 2, 3, 4, 5].map((k) => item(`product-${k}`, { name: `Product ${k}`, title: `Product ${k} - ELMT`, price: 100 * k }));
  const w = cleanWall({ picks: items.map((p, k) => pickOf(p, k === 0 ? { name: 'First "One"' } : {})) });
  const wall = toWall(w, SITE);
  assert.equal(wall.label, 'Shop the floor');
  assert.equal(wall.headline, 'Our picks this week.');
  assert.equal(wall.more, '/shop/');
  assert.deepEqual(wall.photos[0], { url: `${SITE}/shop/product-1/`, src: items[0].photos[0].url, name: 'First &#8220;One&#8221;' });
  assert.equal(wall.photos[1].name, undefined);
  const preview = previewWall(w, catalogOf(...items), SITE);
  assert.equal(preview.photos[1].name, 'Product 2');
  assert.equal(preview.photos[1].price, 200);
  const sale = toSale(clean({ kind: 'headline', headline: 'Hello' }));
  const html = render({ ...previewBrief(sale, SEND), wall: preview }, ['masthead', 'hero', 'offer', 'wall']);
  // Its last two words kept together, so a name never ends with one word alone on a phone (noWidow)
  assert.match(html, /Product&nbsp;2<\/span>/);
  assert.match(html, /\$200</);
  assert.match(html, /utm_content=wall-5/);
});

test('every store photo goes out as a JPEG of exactly its spot’s shape, through the site’s image resizing', () => {
  // Shopify's own resizing skipped the crop of a photo smaller than asked for: the lead product's
  // 1000px photo came back 800x800 for its 1200x800 spot (Nov 17, 2026). And it wouldn't send a PNG
  // with a transparency channel as a JPEG. Cloudflare's cover does both, for every store photo.
  const png = 'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/x.png?v=2';
  const webp = 'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/w.webp?v=3';
  const p = item('png', { photos: [{ url: png, w: 1, h: 1 }] });
  const w = item('webp', { photos: [{ url: webp, w: 1, h: 1 }] });
  const items = [p, w, item('c'), item('d')];
  const sale = toSale(clean({ kind: 'headline', headline: 'Hello' }));
  const html = render({ ...previewBrief(sale, SEND), wall: previewWall(cleanWall({ picks: items.map((x) => pickOf(x)) }), catalogOf(...items), SITE) }, ['wall']);
  const resized = (src) => `src="https://shop.sunnyandranney.com/cdn-cgi/image/width=596,height=596,fit=cover,gravity=center,quality=64,format=jpeg,background=white/${src}"`;
  assert.ok(html.includes(resized(png)));
  assert.ok(html.includes(resized(webp)));
  assert.ok(!/crop=center/.test(html), 'no store photo is left to Shopify’s resizing');
  // A photo from anywhere else can't go through the site's resizing, which accepts only the store's files
  assert.equal(Email.photo('https://example.com/y.png', 10, 10), 'https://example.com/y.png?width=10&height=10&crop=center&quality=64&format=jpg');
});
