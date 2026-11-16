/**
 * Suggested searches for the search box: what a shopper is probably typing, each with how
 * many pieces it finds (never one that finds nothing). Built from the catalog itself: the
 * kinds of piece it has ("coffee table"), the looks it has enough of to be worth a search
 * ("gray sofa", "swivel chair": three pieces or more), and the names its product lines
 * share ("Dovely"). Pure functions, like the engine, so the tests run them in Node.
 */
import { normalize, search, tokens, parse } from './engine.mjs';
import { COLORS, FEATURES, KINDS, MATERIALS, PAGES, ROOMS, STOPWORDS, STYLES, CHEAP } from './lexicon.mjs';

const LEXICON = new Set(
  [...KINDS, ...ROOMS, ...COLORS, ...MATERIALS, ...FEATURES, ...PAGES]
    .flatMap((g) => g.say)
    .concat(STYLES, CHEAP)
    .flatMap((s) => tokens(s)),
);
const STOP = new Set([...STOPWORDS].flatMap((w) => tokens(w)));
/** A kind too broad to suggest on its own ("chair" is every chair). */
const BROAD = new Set(['chair']);
/** A look needs this many pieces of a kind before it's worth suggesting. */
const MIN_LOOK = 3;
/** How a kind reads after a look word ("gray outdoor furniture", not "gray outdoor"). */
const KIND_NOUN = { outdoor: 'outdoor furniture', console: 'console table' };
/** How a look reads before a kind ("rectangular dining table"). */
const LOOK_WORD = { rectangle: 'rectangular' };
/** Looks that say nothing a shopper would search for with a kind ("feather sofa"). */
const NOT_A_LOOK = new Set(['removable', 'feather', 'foam', 'rocking', 'full', 'nesting', 'power', 'usb']);
/** "Upholstered" only tells pieces apart where some are bare wood or metal. */
const UPHOLSTERED_KINDS = new Set(['bed', 'bench', 'dining-chair', 'stool', 'ottoman']);

const cache = new WeakMap();

function prepared(index) {
  let c = cache.get(index);
  if (c) return c;
  const list = [];
  const add = (text, group, weight, tier) => list.push({ text, group, weight, tier, key: tokens(text).join(' '), plain: normalize(text) });

  const ofKind = new Map(KINDS.map((k) => [k.id, index.items.filter((it) => it.kinds.has(k.id))]));
  for (const k of KINDS) {
    const n = ofKind.get(k.id).length;
    // Phrases with filler words ("chair and a half", "table for 4") help read a query, but as a
    // suggestion they promise something narrower than the kind they find.
    if (n) k.say.forEach((s, i) => { if (!tokens(s).some((w) => STOP.has(w))) add(s, `k:${k.id}`, n - i * 0.001, 0); });
  }
  const looks = [['colors', COLORS], ['materials', MATERIALS], ['features', FEATURES]];
  for (const k of KINDS) {
    const items = ofKind.get(k.id);
    if (items.length < MIN_LOOK || BROAD.has(k.id)) continue;
    for (const [field, list2] of looks) {
      for (const a of list2) {
        if (NOT_A_LOOK.has(a.id) || (a.id === 'upholstered' && !UPHOLSTERED_KINDS.has(k.id))) continue;
        const n = items.filter((it) => it[field].has(a.id)).length;
        if (n >= MIN_LOOK) add(`${LOOK_WORD[a.id] ?? a.say[0]} ${KIND_NOUN[k.id] ?? k.say[0]}`, `a:${a.id}+${k.id}`, n, 1);
      }
    }
  }
  // Product lines: the name several pieces start with ("Dovely Sofa", "Dovely Chair").
  const lines = new Map();
  for (const it of index.items) {
    const first = it.title.split(/\s+/)[0] ?? '';
    const key = tokens(first).join(' ');
    if (!/^[A-Za-z][a-z]{3,}$/.test(first) || LEXICON.has(key) || STOP.has(key)) continue;
    const seen = lines.get(key) ?? { text: first, n: 0 };
    seen.n += 1;
    lines.set(key, seen);
  }
  for (const [key, { text, n }] of lines) if (n >= 2) add(text, `n:${key}`, n, 2);

  c = { list, counts: new Map() };
  cache.set(index, c);
  return c;
}

/**
 * How many pieces a suggested search finds, worked out once per index. A search that only
 * finds pieces by giving up part of itself (no blue velvet sofas: all sofas) counts as none,
 * so it's never suggested.
 */
export function countFor(index, text) {
  const c = prepared(index);
  if (!c.counts.has(text)) {
    const r = search(index, text);
    c.counts.set(text, r.partial || r.relaxed.length ? 0 : r.items.length);
  }
  return c.counts.get(text);
}

function matches(list, typedKey, typedPlain) {
  const out = [];
  for (const cand of list) {
    let where = -1;
    if (cand.key.startsWith(typedKey) || cand.plain.startsWith(typedPlain)) where = 2;
    else if (cand.key.includes(` ${typedKey}`) || cand.plain.includes(` ${typedPlain}`)) where = 1;
    if (where > 0) out.push({ cand, where });
  }
  return out.sort((a, b) => b.where - a.where || a.cand.tier - b.cand.tier || b.cand.weight - a.cand.weight || a.cand.text.length - b.cand.text.length);
}

/**
 * Searches that finish or refine what's typed, best first.
 * @returns {Array<{ text: string, count: number, corrected: boolean }>}
 */
export function completions(index, raw, { max = 4 } = {}) {
  const typedPlain = normalize(raw);
  const typedKey = tokens(raw).join(' ');
  if (!typedKey) return [];
  const { list } = prepared(index);
  const out = [];
  const groups = new Set();
  const take = (text, corrected) => {
    if (out.length >= max || out.some((o) => o.text === text)) return;
    if (normalize(text) === typedPlain) return; // "See all results" already offers what's typed
    const count = countFor(index, text);
    if (count > 0) out.push({ text, count, corrected });
  };
  const run = (key, plain, corrected) => {
    for (const { cand } of matches(list, key, plain)) {
      if (out.length >= max) break;
      if (groups.has(cand.group)) continue;
      groups.add(cand.group);
      take(cand.text, corrected);
    }
  };
  run(typedKey, typedPlain, false);

  // The words before the last are settled; finish the last one with a kind ("blue velvet so" → "blue velvet sofa").
  const words = typedPlain.split(' ');
  if (out.length < max && words.length > 1) {
    const head = words.slice(0, -1).join(' ');
    const last = words[words.length - 1];
    for (const k of KINDS) {
      const say = k.say.find((s) => s.startsWith(last));
      if (say && !BROAD.has(k.id)) take(`${head} ${say}`, false);
      if (out.length >= max) break;
    }
  }

  // A typo: what it most likely means ("recliener" → "recliner").
  if (out.length < max) {
    const fixed = parse(raw, index).corrected;
    if (fixed && fixed !== typedKey) {
      take(fixed, true);
      run(fixed, fixed, true);
    }
  }
  return out;
}

/**
 * The kinds of piece most worth showing before anything is typed: the ones the store's
 * best sellers are, in stock now (each piece counts more the better it sells).
 * @returns {Array<{ text: string, label: string, count: number }>}
 */
export function popular(index, n = 6) {
  const weight = new Map();
  for (const it of index.items) {
    if (!it.doc.s) continue;
    for (const [id] of it.kinds) weight.set(id, (weight.get(id) ?? 0) + (1 - it.doc.r / Math.max(1, index.n)));
  }
  return KINDS.filter((k) => weight.get(k.id) && !BROAD.has(k.id))
    .sort((a, b) => weight.get(b.id) - weight.get(a.id))
    .slice(0, n)
    .map((k) => ({ text: k.say[0], label: k.label, count: countFor(index, k.say[0]) }))
    .filter((p) => p.count > 0);
}

/**
 * The results page's search: the query as typed; or, when its last word looks half typed
 * ("sof" finds nothing; "dining t" only finds anything by ignoring the "t"), the pieces with
 * a word that starts that way, as the search box showed them.
 */
export function results(index, raw) {
  const full = search(index, raw);
  const words = tokens(raw);
  const last = words[words.length - 1] ?? '';
  const unknownLast = /[a-z]$/i.test(String(raw).trim()) && !index.df.has(last) && !LEXICON.has(last);
  // Found nothing, or found things only by ignoring a last word of a letter or two.
  const halfTyped = unknownLast && (!full.items.length || (last.length <= 2 && full.relaxed.includes(last)));
  if (!halfTyped) return { ...full, prefixed: false };
  const prefixed = search(index, raw, { prefix: true });
  return prefixed.items.length ? { ...prefixed, prefixed: true } : { ...full, prefixed: false };
}
