/**
 * The site's product search: understands what a shopper types (synonyms, typos, colors,
 * sizes, prices, rooms, questions that aren't products), then ranks the catalog by how
 * well each piece answers it. Pure functions: the browser, the build and the tests all
 * run this same code. The catalog is small (about 830 pieces), so the whole index lives
 * in the browser and every keystroke is answered in a few milliseconds.
 *
 * Measured against a judged set of 130 queries by Baymard's query types (see the tests).
 */
import { CHEAP, COLORS, FAMILIES, FEATURES, KINDS, MATERIALS, PAGES, REAL_WORDS, ROOMS, SALE, STOPWORDS, STYLES } from './lexicon.mjs';

const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([f, ids]) => ids.map((id) => [id, f])));

// ── text ──────────────────────────────────────────────────────────────────

/** Lowercase, plain letters, one way of writing inches and feet. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'").replace(/[“”″]/g, '"')
    .replace(/(\d)\s*(?:''|"|in\b\.?|inch(?:es)?\b)/g, '$1in ')
    .replace(/(\d)\s*(?:'|ft\b\.?|feet\b|foot\b)/g, '$1ft ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words whose plural turns f into ves; any other "-ves" just loses the s ("curves", "loves…"). */
const VES = { shelves: 'shelf', leaves: 'leaf', halves: 'half', knives: 'knife', scarves: 'scarf', wolves: 'wolf', loaves: 'loaf', calves: 'calf' };

/** Plural to singular, the common English way (shelves → shelf, benches → bench, tables → table). */
export function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return word.slice(0, -3) + 'y';
  if (/ves$/.test(word)) return VES[word] ?? word.slice(0, -1);
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokens(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

/** The vendor's code at the end of a title ("Dovely Sofa - Natural - BHF") is for the store, not shoppers. */
export function cleanTitle(title) {
  let t = String(title ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(/\s*[-–—|]\s*[A-Z]{2,5}\s*$/, '').trim();
  t = t.replace(/^(\d+(?:\.\d+)?)("|'')(?=[A-Za-z])/, '$1$2 '); // 36"Trenton → 36" Trenton
  t = t.replace(/\s+-\s+-\s+/g, ' - ').replace(/\s*-\s*$/, '');
  return t;
}

// ── edit distance, for typos ──────────────────────────────────────────────

/** Damerau-Levenshtein (optimal string alignment), stopping early past `max`. */
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// One slip from 4 letters, two from 8 (between Algolia's and Meilisearch's defaults); never in numbers.
const allowedTypos = (word) => (word.length <= 3 ? 0 : word.length <= 7 ? 1 : 2);

// ── lexicon as token phrases ──────────────────────────────────────────────

const phrase = (s) => tokens(s).join(' ');
const GROUPS = [
  ...KINDS.map((k) => ({ kind: 'kind', id: k.id, label: k.label, say: k.say, find: k.find, collection: k.collection })),
  ...ROOMS.map((r) => ({ kind: 'room', id: r.id, label: r.label, say: r.say, collection: r.collection })),
  ...COLORS.map((c) => ({ kind: 'color', id: c.id, say: c.say, find: c.say })),
  ...MATERIALS.map((m) => ({ kind: 'material', id: m.id, say: m.say, find: m.say })),
  ...FEATURES.map((f) => ({ kind: 'feature', id: f.id, say: f.say, find: f.say })),
  ...PAGES.map((p) => ({ kind: 'page', id: p.href, say: p.say, page: p })),
  { kind: 'style', id: 'style', say: STYLES },
  { kind: 'cheap', id: 'cheap', say: CHEAP },
  { kind: 'sale', id: 'sale', say: SALE },
];
/** Every phrase a shopper might type, longest first, so "dining table" wins over "dining". */
const SAY = GROUPS.flatMap((g) => g.say.map((s) => ({ g, words: phrase(s).split(' ').filter(Boolean), text: phrase(s) })))
  .filter((s) => s.words.length)
  .sort((a, b) => b.words.length - a.words.length || b.text.length - a.text.length);
const LEXICON_WORDS = new Set(SAY.flatMap((s) => s.words));
/** Every group a phrase belongs to: "linen" is a color and a material, "walnut" a color and a wood. */
const SAY_GROUPS = new Map();
for (const s of SAY) SAY_GROUPS.set(s.text, [...(SAY_GROUPS.get(s.text) ?? []), s.g]);
const LOOK_KINDS = ['color', 'material', 'feature'];
const STOP = new Set([...STOPWORDS].map(stem));
const REAL = new Set(REAL_WORDS.flatMap((w) => tokens(w)));
/**
 * A color or material's own name ("gray", "wood") covers every shade of it: heather is as gray
 * as gray. Any other word for a look ("walnut", "navy", "king", "round") is the one the
 * shopper wants, so pieces that say it come first.
 */
const BROAD_LOOK = new Set([...COLORS, ...MATERIALS].map((g) => tokens(g.say[0]).join(' ')).concat('grey'));
/** A feature's one-word names are the same thing ("KG" is king, "QN" is queen); a shade's aren't (walnut isn't cherry). */
const SAME_FEATURE = new Map(FEATURES.flatMap((f) => {
  const words = f.say.map((x) => tokens(x)).filter((t) => t.length === 1).map((t) => t[0]);
  return words.map((w) => [w, words]);
}));

const containsPhrase = (hay, words) => {
  outer: for (let i = 0; i + words.length <= hay.length; i++) {
    for (let j = 0; j < words.length; j++) if (hay[i + j] !== words[j]) continue outer;
    return true;
  }
  return false;
};

// ── sizes ─────────────────────────────────────────────────────────────────

/** Inch sizes written in a title or description: 72", 82.5'', 93 in. */
function inchSizes(text) {
  return [...normalize(text).matchAll(/(\d+(?:\.\d+)?)in\b/g)].map((m) => parseFloat(m[1])).filter((n) => n >= 10 && n <= 140);
}
/** A rug's size in feet: 5' 3" x 7' 3" → [5.25, 7.25]; 8x10 → [8, 10]. */
function rugSize(text) {
  const n = normalize(text);
  const m = n.match(/(\d+)ft\s*(?:(\d+)in)?\s*x\s*(\d+)ft\s*(?:(\d+)in)?/) || n.match(/\b(\d{1,2})\s*x\s*(\d{1,2})\b(?!\s*in)/);
  if (!m) return null;
  if (m.length === 5) return [parseInt(m[1], 10) + (parseInt(m[2] ?? '0', 10) / 12), parseInt(m[3], 10) + (parseInt(m[4] ?? '0', 10) / 12)];
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// ── the index ─────────────────────────────────────────────────────────────

// Lexicon phrases as token lists, worked out once.
const FIND = (list, key) => list.map((x) => ({ id: x.id, collection: x.collection, words: x[key].map((f) => phrase(f).split(' ')) }));
const KIND_FIND = FIND(KINDS, 'find');
const ATTRS = [['c', FIND(COLORS, 'say')], ['m', FIND(MATERIALS, 'say')], ['f', FIND(FEATURES, 'say')]];
const anyIn = (field, words) => words.some((w) => containsPhrase(field, w));

/** Where each of a kind's phrases sits in a title: [start, end) word spans. */
function spans(field, words) {
  const out = [];
  for (let i = 0; i + words.length <= field.length; i++) {
    if (words.every((w, j) => field[i + j] === w)) out.push([i, i + words.length]);
  }
  return out;
}

/**
 * The kinds a title or a category names. A kind's word inside a longer phrase of another
 * family's kind doesn't count: a "Sofa Table" is a console table, not a sofa, and neither is
 * a piece Shopify files under "Sofa Tables". Within a family it does: an "Accent Chair" is a
 * chair too.
 */
function phraseKinds(fieldT) {
  const hits = KIND_FIND.flatMap((k) => k.words.flatMap((w) => spans(fieldT, w).map(([a, b]) => ({ id: k.id, a, b }))));
  const inside = (h, o) => o.a <= h.a && h.b <= o.b && o.b - o.a > h.b - h.a;
  return new Set(hits.filter((h) => !hits.some((o) => inside(h, o) && FAMILY_OF.get(o.id) !== FAMILY_OF.get(h.id))).map((h) => h.id));
}

/**
 * What kinds of piece it is: 2 when the title names it, 1 from its own category, type or
 * tags (not the category's parents: "Armchairs, Recliners & Sleeper Chairs" would make
 * every armchair a recliner). The category only adds kinds from the title's family, so a
 * piece Shopify files under the wrong category (a dining table under Dressers) stays what
 * its title says, while a cabinet filed under Buffets is both.
 */
function deriveKinds(titleT, leafT, collections) {
  const kinds = new Map();
  for (const id of phraseKinds(titleT)) kinds.set(id, 2);
  const families = new Set([...kinds.keys()].map((id) => FAMILY_OF.get(id)).filter(Boolean));
  const leafKinds = phraseKinds(leafT);
  for (const k of KIND_FIND) {
    if (kinds.has(k.id)) continue;
    const fits = !families.size || families.has(FAMILY_OF.get(k.id));
    if ((fits && leafKinds.has(k.id)) || (k.collection && collections?.includes(k.collection))) kinds.set(k.id, 1);
  }
  return kinds;
}

/** Colors, materials and features a text names, as "c:gray", "m:wood", "f:round". */
function deriveAttrs(t) {
  return ATTRS.flatMap(([prefix, list]) => list.filter((x) => anyIn(t, x.words)).map((x) => `${prefix}:${x.id}`));
}

const leafText = (p) => [p.category?.name ?? p.c, p.productType ?? p.y, ...(p.tags ?? p.g ?? [])].filter(Boolean).join(' | ');

/**
 * At build time, from the whole product: its kinds ("sofa:2"), colors, materials and
 * features ("c:gray"), the colors its title or tags name ("xs": the description's "black
 * legs" don't make a sofa black), inch sizes and rug size. The browser gets these ready-made
 * and no description, so its download is small and its index builds in a blink.
 * @param {{ title: string, description?: string, tags?: string[], productType?: string, category?: { name: string } | null, collections?: string[] }} p
 */
export function enrich(p) {
  const full = `${p.title} ${(p.tags ?? []).join(' ')} ${p.description ?? ''}`;
  const kinds = deriveKinds(tokens(cleanTitle(p.title)), tokens(leafText(p)), p.collections);
  const named = deriveAttrs(tokens(`${p.title} ${(p.tags ?? []).join(' ')}`)).filter((a) => a.startsWith('c:'));
  return {
    k: [...kinds].map(([id, s]) => `${id}:${s}`),
    x: deriveAttrs(tokens(full)),
    xs: named,
    z: [...new Set(inchSizes(full))],
    rg: rugSize(full),
  };
}

/**
 * @typedef {{ h: string, t: string, y?: string, c?: string, g?: string[], v?: string, d?: string, p: number,
 *   s: number, i?: string, col?: string[], r: number, k?: string[], x?: string[], xs?: string[], z?: number[], rg?: number[] | null }} Doc
 *   h handle · t title · y type · c category · g tags · v vendor · d description (tests only; the site's
 *   index has none) · p price · s in stock (1/0) · i image · col collections · r best-seller rank
 *   k, x, xs, z, rg from enrich()
 */

/** @param {Doc[]} docs */
export function buildIndex(docs) {
  const df = new Map();
  const items = docs.map((doc) => {
    const title = cleanTitle(doc.t);
    const code = (String(doc.t).match(/[-–]\s*([A-Z]{2,5})\s*$/) || [])[1]?.toLowerCase();
    const titleT = tokens(title);
    const kindT = tokens([doc.c, doc.y, ...(doc.g ?? [])].filter(Boolean).join(' | '));
    const vendorT = tokens([doc.v, code].filter(Boolean).join(' '));
    const descT = tokens(doc.d ?? '');
    const kinds = doc.k ? new Map(doc.k.map((x) => { const [id, s] = x.split(':'); return [id, Number(s)]; })) : deriveKinds(titleT, kindT, doc.col);
    const attrs = new Set(doc.x ?? deriveAttrs([...titleT, ...kindT, ...descT]));
    const pick = (prefix) => new Set([...attrs].filter((a) => a.startsWith(prefix)).map((a) => a.slice(2)));
    const named = doc.xs ?? deriveAttrs([...titleT, ...tokens((doc.g ?? []).join(' '))]).filter((a) => a.startsWith('c:'));
    const item = {
      doc, title, titleT, kindT, vendorT, descT, kinds,
      colors: pick('c:'), materials: pick('m:'), features: pick('f:'),
      namedColors: new Set(named.map((a) => a.slice(2))),
      inches: doc.z ?? inchSizes(`${doc.t} ${doc.d ?? ''}`),
      rug: doc.rg !== undefined ? doc.rg : rugSize(`${doc.t} ${doc.d ?? ''}`),
      titleStr: titleT.join(' '),
    };
    for (const w of new Set([...titleT, ...kindT, ...vendorT, ...descT])) df.set(w, (df.get(w) ?? 0) + 1);
    return item;
  });
  const vocab = new Set([...df.keys(), ...LEXICON_WORDS]);
  return { items, df, vocab, n: items.length };
}

// ── understanding a query ─────────────────────────────────────────────────

/** Fixes a word that isn't in the catalog or the lexicon to the nearest one that is. */
function correct(word, index) {
  if (index.vocab.has(word) || STOP.has(word) || REAL.has(word) || /\d/.test(word)) return word;
  const max = allowedTypos(word);
  if (!max) return word;
  let best = null;
  for (const v of index.vocab) {
    if (Math.abs(v.length - word.length) > max || v.length <= 2) continue;
    // A wrong first letter costs double: shoppers rarely get the first letter wrong.
    const dist = distance(word, v, max) + (word[0] === v[0] ? 0 : 1);
    if (dist > max) continue;
    const weight = (index.df.get(v) ?? 0) + (LEXICON_WORDS.has(v) ? 50 : 0);
    if (!best || dist < best.dist || (dist === best.dist && weight > best.weight)) best = { v, dist, weight };
  }
  return best ? best.v : word;
}

/**
 * Splits a query into what it asks for.
 * @param {string} raw
 * @param {{ prefix?: boolean }} options  prefix: the last word may be half typed (search as you type)
 */
/** A search is read up to here: the box takes 120 characters, and a link could carry any amount. */
const MAX_QUERY = 200;

export function parse(raw, index, { prefix = false } = {}) {
  let text = normalize(String(raw ?? '').slice(0, MAX_QUERY));
  // How many it seats comes first, so "at least 6 people" is a table size, not a price.
  // "for 6", "seats 8", "6 people", "3 seater": the catalog doesn't say; with "table" it means a dining table.
  let seats = null;
  text = text.replace(/\b(?:for|seat|seats|seating)\s+(?:at least\s+|up to\s+)?(\d{1,2})\b|\b(?:at least\s+|up to\s+)?(\d{1,2})\s*-?\s*(?:people|person|persons|guests|seat|seats|seater|seaters)\b/, (_, a, b) => { seats = parseInt(a ?? b, 10); return ' '; });
  const price = { min: null, max: null, cheap: false, sale: false };
  const N = '\\$?([\\d,]+(?:\\.\\d+)?)(k)?';
  const money = (s, k) => parseFloat(s.replace(/,/g, '')) * (k ? 1000 : 1);
  text = text.replace(new RegExp(`\\bbetween\\s*${N}\\s*(?:and|-|to)\\s*${N}`), (_, a, ak, b, bk) => {
    const [lo, hi] = [money(a, ak), money(b, bk)].sort((x, y) => x - y);
    price.min = lo; price.max = hi; return ' ';
  });
  text = text.replace(new RegExp(`\\b(?:under|below|less than|cheaper than)\\s*${N}(?![\\d.])|<\\s*${N}`), (_, a, k, c, k2) => { price.max = money(a ?? c, k ?? k2) - 0.01; return ' '; });
  text = text.replace(new RegExp(`\\b(?:up to|max(?:imum)?|no more than|at most)\\s*${N}(?![\\d.])`), (_, a, k) => { price.max = money(a, k); return ' '; });
  text = text.replace(new RegExp(`\\b(?:over|above|more than|min(?:imum)?|at least)\\s*${N}(?![\\d.])|>\\s*${N}`), (_, a, k, c, k2) => { price.min = money(a ?? c, k ?? k2); return ' '; });
  // Sizes: a rug's feet (5x8, 8' x 10'), or inches (72", 72 inch).
  let rug = null;
  text = text.replace(/\b(\d{1,2})(?:ft)?\s*x\s*(\d{1,2})(?:ft)?\b(?!\s*in)/, (_, a, b) => { rug = [parseFloat(a), parseFloat(b)]; return ' '; });
  const inches = [];
  text = text.replace(/\b(\d+(?:\.\d+)?)in\b/g, (_, n) => { inches.push(parseFloat(n)); return ' '; });

  const words = text.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  const corrections = [];
  const fixed = words.map((w, i) => {
    if (prefix && i === words.length - 1) return w; // still being typed
    const c = correct(w, index);
    if (c !== w) corrections.push([w, c]);
    return c;
  });

  // Longest lexicon phrases first; what's left are plain words.
  const used = new Array(fixed.length).fill(false);
  const usedBy = new Array(fixed.length).fill(null); // what each word was read as
  const found = [];
  /** Looks asked for: each is met by any of its meanings ("linen": a beige, or the fabric). */
  const looks = [];
  /** Where each kind was named, so "dining table and chairs" lists tables first. */
  const kindAt = new Map();
  for (const s of SAY) {
    for (let i = 0; i + s.words.length <= fixed.length; i++) {
      if (used.slice(i, i + s.words.length).some(Boolean)) continue;
      if (!s.words.every((w, j) => fixed[i + j] === w)) continue;
      const groups = SAY_GROUPS.get(s.text) ?? [s.g];
      // A phrase that names a kind of piece is that kind ("rocker" is a glider, not just rocking).
      const asKind = groups.filter((g) => g.kind === 'kind');
      const asLook = groups.filter((g) => LOOK_KINDS.includes(g.kind));
      const read = asKind.length ? [...asKind, ...groups.filter((g) => !LOOK_KINDS.includes(g.kind) && g.kind !== 'kind')] : groups;
      found.push(...read);
      if (!asKind.length && asLook.length) looks.push(asLook.map((g) => ({ kind: g.kind, id: g.id })));
      for (const g of asKind) if (!kindAt.has(g.id)) kindAt.set(g.id, i);
      const by = asKind.length ? 'kind' : asLook.length ? 'look' : read[0].kind;
      for (let j = 0; j < s.words.length; j++) { used[i + j] = true; usedBy[i + j] = by; }
    }
  }
  let rest = fixed.filter((w, i) => !used[i] && !STOP.has(w));
  const ids = (kind) => [...new Set(found.filter((g) => g.kind === kind).map((g) => g.id))];
  // The exact shade, material or feature typed ("walnut", "navy", "king") ranks first.
  const literal = fixed.filter((w, i) => !STOP.has(w) && usedBy[i] === 'look');
  const kinds = ids('kind').sort((a, b) => (kindAt.get(a) ?? 99) - (kindAt.get(b) ?? 99));
  if (seats && !kinds.includes('dining-table') && /\btable\b/.test(text)) kinds.push('dining-table');
  // "Table and chairs", "dining table and chairs": a dining set, so its chairs are dining chairs.
  if (kinds.includes('chair') && (kinds.includes('dining-table') || rest.includes('table'))) {
    kinds.splice(kinds.indexOf('chair'), 1, 'dining-chair');
    if (!kinds.includes('dining-table')) kinds.unshift('dining-table');
    rest = rest.filter((w) => w !== 'table');
  }
  // A room named with a kind ("living room sofa") narrows nothing the kind doesn't; alone, it's the room.
  const rooms = kinds.length ? [] : ids('room');
  if (found.some((g) => g.kind === 'cheap')) price.cheap = true;
  if (found.some((g) => g.kind === 'sale')) price.sale = true;
  return {
    kinds, rooms, looks,
    colors: ids('color'), materials: ids('material'), features: ids('feature'),
    styles: found.some((g) => g.kind === 'style'),
    pages: [...new Set(found.filter((g) => g.kind === 'page').map((g) => g.page))],
    terms: rest, literal, inches, rug, seats, price, corrections,
    corrected: corrections.length ? fixed.join(' ') : null,
    prefix,
  };
}

// ── ranking ───────────────────────────────────────────────────────────────

const FIELD = { title: 3, vendor: 2, kind: 1.6, desc: 0.6 };

/** How well one plain word matches a piece: 0 when it doesn't. */
function termScore(item, word, index, partial) {
  const idf = Math.log(1 + index.n / (1 + (index.df.get(word) ?? 0)));
  const hit = (field) => (partial ? field.some((w) => w.startsWith(word)) : field.includes(word));
  if (hit(item.titleT)) return FIELD.title * idf;
  if (hit(item.vendorT)) return FIELD.vendor * idf;
  if (hit(item.kindT)) return FIELD.kind * idf;
  if (hit(item.descT)) return FIELD.desc * idf;
  return 0;
}

/**
 * What a query finds, best first.
 * @returns {{ items: Array<{ item: any, score: number }>, query: ReturnType<typeof parse>, partial: boolean, relaxed: string[] }}
 */
export function search(index, raw, { prefix = false, limit = Infinity } = {}) {
  raw = String(raw ?? '').slice(0, MAX_QUERY);
  const q = parse(raw, index, { prefix });
  // A query of style words alone ("modern", "farmhouse") looks for those words.
  if (q.styles && !q.kinds.length && !q.rooms.length && !q.looks.length && !q.terms.length) {
    q.terms = tokens(raw).filter((w) => STYLES.some((x) => phrase(x).split(' ').includes(w)) && index.df.has(w));
  }
  const last = prefix ? q.terms[q.terms.length - 1] : null;
  // "On sale", "clearance": marked-down pieces; when none of what was asked is on sale, all of it (closest matches).
  let saleOnly = q.price.sale;
  const priced = (item) => (q.price.min === null || item.doc.p >= q.price.min) && (q.price.max === null || (item.doc.p > 0 && item.doc.p <= q.price.max))
    && (!saleOnly || (item.doc.cp ?? 0) > item.doc.p);

  // A count ("4 dining chairs", "2 seat") ranks pieces that say it, but never rules one out;
  // a model number ("926 sofa") must match.
  const counts = q.terms.filter((w) => /^\d{1,2}$/.test(w));
  const words = q.terms.filter((w) => !counts.includes(w));
  // Words the catalog doesn't know at all can't be required ("something cozy for a reading nook").
  const knownTerms = words.filter((w) => (w === last ? [...index.vocab].some((v) => v.startsWith(w)) : index.df.has(w)));
  const relaxed = words.filter((w) => !knownTerms.includes(w));
  // What the piece is (its kind, its name) must match; how it looks (color, material,
  // features, size, room) is given up first when nothing has everything.
  const core = (q.kinds.length ? 1 : 0) + knownTerms.length;
  const looks = q.rooms.length + q.looks.length + (q.inches.length ? 1 : 0) + (q.rug ? 1 : 0);
  const pricedOnly = !core && !looks && (q.price.min !== null || q.price.max !== null || q.price.cheap || q.price.sale);
  if (!core && !looks && !pricedOnly) return { items: [], query: q, partial: false, relaxed };

  const score = () => {
  const scored = [];
  for (const item of index.items) {
    if (!priced(item)) continue;
    let score = 0;
    let missedTerms = 0;
    let missedLooks = 0;
    // Two kinds in one search ("dining table and chairs", "bed and nightstand") show both;
    // a piece that is both ("bookcase headboard") comes first.
    let kindHits = 0;
    let firstKind = 99;
    for (const [n, k] of q.kinds.entries()) { const s = item.kinds.get(k); if (s) { score += s === 2 ? 5 : 3.5; kindHits++; firstKind = Math.min(firstKind, n); } }
    const missedKind = q.kinds.length && !kindHits ? 1 : 0;
    for (const w of knownTerms) { const s = termScore(item, w, index, w === last); if (s) score += s; else missedTerms++; }
    for (const w of counts) if (item.titleT.includes(w)) score += 1;
    for (const r of q.rooms) { const room = ROOMS.find((x) => x.id === r); if (room && item.doc.col?.includes(room.collection)) score += 2; else missedLooks++; }
    let namedLooks = 1;
    for (const look of q.looks) {
      const has = (o) => (o.kind === 'color' ? item.colors : o.kind === 'material' ? item.materials : item.features).has(o.id);
      const hit = look.filter(has);
      if (!hit.length) { missedLooks++; continue; }
      score += hit.some((o) => o.kind !== 'feature') ? 2.5 : 2;
      // A color the title or tags name beats one only the description mentions.
      if (look.some((o) => o.kind === 'color') && !hit.some((o) => o.kind !== 'color' || item.namedColors.has(o.id))) namedLooks = 0;
    }
    if (q.inches.length) {
      const near = q.inches.some((n) => item.inches.some((m) => Math.abs(m - n) <= 2));
      if (near) score += q.inches.some((n) => item.inches.includes(n)) ? 4 : 2.5; else missedLooks++;
    }
    if (q.rug) { if (item.rug && Math.abs(item.rug[0] - q.rug[0]) <= 0.75 && Math.abs(item.rug[1] - q.rug[1]) <= 1.1) score += 3; else missedLooks++; }
    // The exact shade or material typed, in the title or the description.
    for (const w of q.literal) score += item.titleT.includes(w) ? 3 : item.descT.includes(w) ? 1.5 : 0;
    scored.push({ item, score, missedKind, missedTerms, missedLooks, kindHits, firstKind, namedLooks });
  }
  return scored;
  };
  let scored = score();

  // Nothing has it all: give up what matters least first. The look ("no white dressers: all
  // dressers"), then the other words, keeping the kind of piece ("tall bookcase": bookcases).
  const has = (s) => s.score > 0 || pricedOnly;
  const steps = [
    (s) => !s.missedKind && !s.missedTerms && !s.missedLooks,
    looks && core ? (s) => !s.missedKind && !s.missedTerms : null,
    q.kinds.length && knownTerms.length ? (s) => !s.missedKind && !s.missedLooks : null,
    q.kinds.length && (knownTerms.length || looks) ? (s) => !s.missedKind : null,
  ].filter(Boolean);
  let matches = [];
  let partial = false;
  for (const [i, ok] of steps.entries()) {
    matches = scored.filter((s) => ok(s) && has(s));
    if (matches.length) { partial = i > 0; break; }
  }
  if (!matches.length && !core && looks > 1) {
    const fewest = Math.min(...scored.map((s) => s.missedLooks));
    if (fewest < looks) { matches = scored.filter((s) => s.missedLooks === fewest && s.score > 0); partial = true; }
  }
  if (!matches.length && saleOnly && !pricedOnly) {
    saleOnly = false;
    scored = score();
    matches = scored.filter((s) => steps[0](s) && has(s));
    partial = matches.length > 0;
  }

  // Ties go to: the whole query in the title, style words, then best sellers.
  const whole = tokens(raw).filter((w) => !STOP.has(w)).join(' ');
  for (const m of matches) {
    if (whole && m.item.titleStr.includes(whole)) m.score += 4;
    if (q.styles) for (const w of tokens(raw)) if (STYLES.some((x) => phrase(x) === w) && (m.item.titleT.includes(w) || m.item.descT.includes(w) || m.item.kindT.includes(w))) m.score += 1;
    m.score += m.item.doc.s ? 2.5 : 0;
    m.score += 1 - m.item.doc.r / Math.max(1, index.n);
  }
  // Order: pieces whose title says the exact look typed ("walnut", "king": not just any brown
  // or any bed size), then pieces in stock, as everywhere on the site (most of the catalog is
  // one of a kind and sold), then how well each matches.
  const exact = q.literal.filter((w) => !BROAD_LOOK.has(w));
  const says = (m) => (exact.length && exact.every((w) => (SAME_FEATURE.get(w) ?? [w]).some((x) => m.item.titleT.includes(x))) ? 1 : 0);
  for (const m of matches) m.exact = says(m);
  // Pieces that are every kind asked for, then the exact look, then a color the title names,
  // then in stock; then, for "cheap", the lowest price, otherwise how well each matches.
  const tiers = (a, b) => b.kindHits - a.kindHits || a.firstKind - b.firstKind || b.exact - a.exact || b.namedLooks - a.namedLooks || b.item.doc.s - a.item.doc.s;
  const byPrice = (a, b) => (a.item.doc.p || Infinity) - (b.item.doc.p || Infinity);
  matches.sort((a, b) => tiers(a, b) || (q.price.cheap ? byPrice(a, b) : b.score - a.score) || a.item.doc.r - b.item.doc.r);
  return { items: matches.slice(0, limit).map(({ item, score }) => ({ item, score })), query: q, partial, relaxed };
}

/**
 * Search as you type: the kinds of piece that fit what's typed so far (with how many),
 * the best pieces, and any page that answers a question.
 */
export function suggest(index, raw, { products = 6, kinds = 4 } = {}) {
  const result = search(index, raw, { prefix: true });
  const counts = new Map();
  for (const { item } of result.items) for (const [id] of item.kinds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const typed = normalize(raw);
  const kindList = KINDS
    .filter((k) => counts.get(k.id))
    .map((k) => ({ id: k.id, label: k.label, count: counts.get(k.id), starts: k.say.some((s) => phrase(s).startsWith(tokens(typed).join(' '))) || k.label.toLowerCase().startsWith(typed) }))
    .sort((a, b) => Number(b.starts) - Number(a.starts) || b.count - a.count)
    .slice(0, kinds);
  return { products: result.items.slice(0, products), total: result.items.length, kinds: kindList, pages: result.query.pages, query: result.query, partial: result.partial };
}
