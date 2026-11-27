/**
 * The story's collage layouts: bento boxes for 1 to 5 photos
 * ===========================================================================
 * Staci picks how the week's story photos are laid out, from the layouts made for that many photos.
 * Each one is drawn on the email page with her own photos in it, the way Instagram's Layout app showed
 * its layouts (about.instagram.com, "Introducing Layout", 2015), and the one that keeps the most of
 * her photos is marked. Switching layouts keeps her photos and their order, as Google Photos' collage
 * editor does since its 2025 update.
 *
 * A layout is a tree of cuts (C. Brian Atkins, "Blocked Recursive Image Composition", ACM Multimedia
 * 2008): photos side by side ({ across }), photos stacked ({ down }), or one photo cell ([w, h], its
 * shape). The email draws it as nested tables, and photos scale with the screen while the 4px gutters
 * don't, so a big photo beside two stacked ones would normally miss their bottom edge by a pixel or two
 * on a phone. solve() gives every column a share of the width plus a fixed number of pixels, worked out
 * so each side of every cut is exactly as tall as the other at every width, 4px gutters included.
 * That's what lets a bento box with real 4px gutters work in an email at all. No Node or browser APIs.
 */

/** The space between photos, as on the photo wall. */
export const GUTTER = 4;
/** The width the email's photos are drawn at on a computer. */
export const WIDTH = 600;

const L = [4, 3]; // a phone's landscape shot
const P = [3, 4]; // a phone's portrait shot
const SQ = [1, 1];
const across = (...a) => ({ across: a });
const down = (...d) => ({ down: d });

/**
 * The layouts for each number of photos, in the order the page shows them. The first is the one the
 * email always had for that many (a wide photo on top), so a week that never picks keeps its look
 * until the best fit is asked for. Names are what Staci reads under each.
 * @type {Record<number, { id: string, name: string, tree: any }[]>}
 */
export const LAYOUTS = {
  1: [
    { id: 'wide', name: 'Wide', tree: [2, 1] },
    { id: 'whole', name: 'Whole photo', tree: L },
  ],
  2: [
    { id: 'pair', name: 'Two squares', tree: across(SQ, SQ) },
    { id: 'pair-tall', name: 'Two tall', tree: across(P, P) },
    { id: 'wide-tall', name: 'Wide and tall', tree: across(L, P) },
    { id: 'tall-wide', name: 'Tall and wide', tree: across(P, L) },
  ],
  3: [
    { id: 'wide-top', name: 'Wide on top', tree: down([2, 1], across(SQ, SQ)) },
    { id: 'big-left', name: 'Big on the left', tree: across(SQ, down(SQ, SQ)) },
    { id: 'big-right', name: 'Big on the right', tree: across(down(SQ, SQ), SQ) },
    { id: 'tall-left', name: 'Tall beside two', tree: across(P, down(L, L)) },
    { id: 'tall-right', name: 'Two beside tall', tree: across(down(L, L), P) },
    { id: 'three-tall', name: 'Three tall', tree: across(P, P, P) },
  ],
  4: [
    { id: 'wide-top', name: 'Wide on top', tree: down([2, 1], across(SQ, SQ, SQ)) },
    { id: 'grid', name: 'Four squares', tree: down(across(SQ, SQ), across(SQ, SQ)) },
    { id: 'tall-left', name: 'Tall beside three', tree: across(P, down(L, L, L)) },
    { id: 'columns', name: 'Two wide, two tall', tree: across(down(L, L), down(P, P)) },
    { id: 'checker', name: 'Mixed pairs', tree: down(across(L, P), across(P, L)) },
  ],
  5: [
    { id: 'wide-top', name: 'Wide on top', tree: down([2, 1], across(SQ, SQ), across(SQ, SQ)) },
    { id: 'big-left', name: 'Big beside four', tree: across(SQ, down(across(SQ, SQ), across(SQ, SQ))) },
    { id: 'big-right', name: 'Four beside big', tree: across(down(across(SQ, SQ), across(SQ, SQ)), SQ) },
    { id: 'two-three', name: 'Two over three', tree: down(across(SQ, SQ), across(SQ, SQ, SQ)) },
    { id: 'tall-row', name: 'Three tall, two wide', tree: down(across(P, P, P), across(L, L)) },
  ],
};

/** The layout the email always had for n photos. */
export const CLASSIC = 'wide-top';
const classicOf = (n) => LAYOUTS[n]?.[0];

/** The layout called `id` for n photos, or undefined. */
export const layoutOf = (id, n) => LAYOUTS[n]?.find((l) => l.id === id);

const isCell = (t) => Array.isArray(t);
/** How many photos a layout holds. */
export const countOf = (t) => (isCell(t) ? 1 : (t.across ?? t.down).reduce((s, c) => s + countOf(c), 0));

/**
 * A node's height for a width w is A·w + B. For a photo cell, B is 0; a stack adds its children's and
 * a gutter between each; photos side by side share a height, so each gets the share of the width
 * (f·w + c) that makes it so, at every w:
 *   A = 1 / Σ(1/Aᵢ),  B = (Σ(Bᵢ/Aᵢ) − (k−1)·g) / Σ(1/Aᵢ),  fᵢ = A/Aᵢ,  cᵢ = (B − Bᵢ)/Aᵢ
 * @returns {{ A: number, B: number, kids?: any[], f?: number[], c?: number[] }}
 */
export function solve(t, g = GUTTER) {
  if (isCell(t)) return { A: t[1] / t[0], B: 0 };
  const kids = (t.across ?? t.down).map((c) => solve(c, g));
  const k = kids.length;
  if (t.down) return { A: kids.reduce((s, x) => s + x.A, 0), B: kids.reduce((s, x) => s + x.B, 0) + (k - 1) * g, kids };
  const S = kids.reduce((s, x) => s + 1 / x.A, 0);
  const A = 1 / S;
  const B = (kids.reduce((s, x) => s + x.B / x.A, 0) - (k - 1) * g) / S;
  return { A, B, kids, f: kids.map((x) => A / x.A), c: kids.map((x) => (B - x.B) / x.A) };
}

/**
 * The padding each of a row's cells takes from its share so the photos come out the width solve()
 * asks for: none on the outer edges (the photos touch the email's sides), a gutter between each pair.
 * @returns {[number, number][]} [left, right] for each cell
 */
export function paddings(c, g = GUTTER) {
  const out = [];
  let left = 0;
  c.forEach((ck, k) => {
    const right = k === c.length - 1 ? 0 : -ck - left;
    out.push([left, right]);
    left = g - right;
  });
  return out;
}

/**
 * Where each photo sits at width w: { x, y, w, h } in pixels, in the order the photos fill the layout
 * (left to right, then top to bottom, inside each cut).
 */
export function place(t, w = WIDTH, g = GUTTER, x = 0, y = 0, s = solve(t, g)) {
  if (isCell(t)) return [{ x, y, w, h: s.A * w }];
  const kids = t.across ?? t.down;
  const out = [];
  if (t.down) {
    let top = y;
    kids.forEach((c, k) => {
      out.push(...place(c, w, g, x, top, s.kids[k]));
      top += s.kids[k].A * w + s.kids[k].B + g;
    });
    return out;
  }
  let left = x;
  const pads = paddings(s.c, g);
  kids.forEach((c, k) => {
    const share = s.f[k] * w;
    out.push(...place(c, share - pads[k][0] - pads[k][1], g, left + pads[k][0], y, s.kids[k]));
    left += share;
  });
  return out;
}

/** The layout's height at width w. */
export const heightAt = (t, w = WIDTH, g = GUTTER) => {
  const s = solve(t, g);
  return s.A * w + s.B;
};

/** The shape of every photo cell, in fill order: [w, h] */
export const cellShapes = (t) => (isCell(t) ? [t] : (t.across ?? t.down).flatMap(cellShapes));

/**
 * How much of a photo of shape a (width over height) a cell of shape c keeps when the photo is cropped
 * to fill it: 1 when the shapes match, 0.56 for a 4:3 photo in a 2:1 cell.
 */
export const kept = (a, c) => Math.min(a, c) / Math.max(a, c);

/**
 * How much of her photos a layout keeps, weighed by how big each is drawn: 1 is nothing cropped away.
 * `ratios` are the photos' widths over heights, in her order.
 */
export function fitOf(layout, ratios) {
  const cells = place(layout.tree);
  let area = 0;
  let sum = 0;
  cells.forEach((cell, k) => {
    const a = cell.w * cell.h;
    area += a;
    sum += a * kept(ratios[k] ?? 1, cell.w / cell.h);
  });
  return area ? sum / area : 1;
}

/**
 * The layout that keeps the most of her photos in her order. Ties go to the shorter layout, then to the
 * one listed first.
 */
export function bestFit(ratios) {
  const n = ratios.length;
  const list = LAYOUTS[n] ?? [];
  let best = list[0];
  let score = -1;
  for (const l of list) {
    const s = fitOf(l, ratios);
    if (s > score + 0.005 || (Math.abs(s - score) <= 0.005 && heightAt(l.tree) < heightAt(best.tree))) {
      best = l;
      score = Math.max(score, s);
    }
  }
  return best;
}

/**
 * The layout the email draws: the one she picked, while it's made for this many photos; otherwise the
 * best fit for her photos (`auto`); otherwise the classic one. `ratios` may be missing on a brief
 * written by hand, which keeps the classic layout.
 * @param {string} chosen '' for "pick for me"
 * @param {number[] | null} ratios
 */
export function layoutFor(chosen, ratios, n = ratios?.length ?? 0) {
  return layoutOf(chosen, n) ?? (ratios && ratios.length === n ? bestFit(ratios) : classicOf(n));
}

/** The words for a layout in a list: "Big on the left" */
export const layoutName = (id, n) => layoutOf(id, n)?.name ?? '';

/**
 * Photo k of a layout, in words for people who can't see the page: where it sits and its shape.
 * "photo 2 of 3, top right, wide" — so moving a photo says where it lands.
 */
export function cellWords(t, k) {
  const cells = place(t);
  const total = heightAt(t);
  const c = cells[k];
  if (!c) return '';
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const across = cells.length === 1 || c.w > WIDTH * 0.9 ? '' : cx < WIDTH / 3 ? 'left' : cx > (2 * WIDTH) / 3 ? 'right' : 'middle';
  const rows = new Set(cells.map((x) => Math.round(x.y))).size;
  const up = rows === 1 || c.h > total * 0.9 ? '' : cy < total / 3 ? 'top' : cy > (2 * total) / 3 ? 'bottom' : 'middle';
  const where = [up, across].filter(Boolean).join(' ').replace('middle middle', 'middle') || 'full width';
  const r = c.w / c.h;
  const shape = r > 1.15 ? 'wide' : r < 0.87 ? 'tall' : 'square';
  return `photo ${k + 1} of ${cells.length}, ${where}, ${shape}`;
}

/** What a saved layout id looks like. */
export const LAYOUT_ID = /^[a-z][a-z-]{0,23}$/;

/** A library photo's width over its height; 1 when its size isn't known. */
export const ratioOf = (photo) => (photo?.w && photo?.h ? photo.w / photo.h : 1);

/**
 * Her photos (in her order) moved to the spots that keep the most of them in this layout. Her order
 * stays unless moving photos keeps at least 3 points more, so a tap never shuffles photos for nothing.
 * @template T
 * @param {{ tree: any }} layout
 * @param {T[]} items
 * @param {(item: T) => number} ratio
 * @returns {{ items: T[], fit: number }}
 */
export function fitPhotos(layout, items, ratio) {
  const ratios = items.map(ratio);
  const mine = fitOf(layout, ratios);
  let best = { order: items.map((_, k) => k), fit: mine };
  for (const order of permutations(items.length)) {
    const f = fitOf(layout, order.map((k) => ratios[k]));
    if (f > best.fit + 1e-9) best = { order, fit: f };
  }
  return best.fit - mine >= 0.03 ? { items: best.order.map((k) => items[k]), fit: best.fit } : { items, fit: mine };
}

function permutations(n) {
  const out = [];
  const walk = (left, done) => {
    if (!left.length) return void out.push(done);
    left.forEach((k, i) => walk([...left.slice(0, i), ...left.slice(i + 1)], [...done, k]));
  };
  walk([...Array(n).keys()], []);
  return out;
}
