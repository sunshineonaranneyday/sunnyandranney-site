/**
 * Suggested searches for the search box: what a shopper is probably typing, each with how
 * many pieces it finds (never one that finds nothing). Built from the catalog itself: the
 * kinds of piece it has ("coffee table"), the looks it has enough of to be worth a search
 * ("gray sofa", "swivel chair": three pieces or more), and the names its product lines
 * share ("Dovely"). Pure functions, like the engine, so the tests run them in Node.
 */
import { normalize, search, stem, tokens, parse } from './engine.mjs';
import { CHEAP, COLORS, FEATURES, KINDS, MATERIALS, PAGES, REAL_WORDS, ROOMS, STOPWORDS, STYLES } from './lexicon.mjs';

const LEXICON = new Set(
  [...KINDS, ...ROOMS, ...COLORS, ...MATERIALS, ...FEATURES, ...PAGES]
    .flatMap((g) => g.say)
    .concat(STYLES, CHEAP)
    .flatMap((s) => tokens(s)),
);
const STOP = new Set([...STOPWORDS].flatMap((w) => tokens(w)));
const REAL_TOKENS = new Set(REAL_WORDS.flatMap((w) => tokens(w)));
/**
 * Phrases with filler words ("chair and a half", "table for 4", "chair that rocks") help read a
 * query, but as a suggestion they promise something narrower than the kind they find.
 */
const hasFiller = (phrase) => tokens(phrase).some((w) => STOP.has(w));
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
    if (n) k.say.forEach((s, i) => { if (!hasFiller(s)) add(s, `k:${k.id}`, n - i * 0.001, 0); });
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

  // The words before the last describe a look or a price: finish the last one with a kind
  // ("blue velvet so" → "blue velvet sofa"). Never after words that already name a kind or
  // something else ("chest of d" isn't "chest of display cabinet").
  const words = typedPlain.split(' ');
  const head = words.slice(0, -1).join(' ');
  const h = head ? parse(head, index) : null;
  const describes = !!h && !h.kinds.length && !h.terms.length && !h.pages.length
    && (h.looks.length + h.rooms.length > 0 || h.price.min !== null || h.price.max !== null);
  if (out.length < max && describes) {
    const last = words[words.length - 1];
    // A typo before the kind is offered fixed, and says so ("gary so" → "gray sofa").
    const lead = h.corrected ?? head;
    for (const k of KINDS) {
      // The same rule as every other suggestion: no phrase with filler words ("chair and a half").
      const say = k.say.find((s) => s.startsWith(last) && !hasFiller(s));
      if (say) take(`${lead} ${say}`, !!h.corrected);
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
 * The results page's search, and the box's "See all" count. When the last word isn't a word
 * the store knows but starts one ("sect", "sofa tab", "loves"), the shopper was still typing:
 * the search the box was finishing comes first ("sectional", "sofa table", "loveseat"), not a
 * typo fix ("sect" isn't "set"). Then the pieces with a word that starts that way; then the
 * query as typed, typos fixed.
 */
export function results(index, raw) {
  const full = search(index, raw);
  const typed = normalize(raw);
  const lastRaw = typed.split(' ').pop() ?? '';
  const last = stem(lastRaw);
  const known = (w) => index.df.has(w) || LEXICON.has(w) || REAL_TOKENS.has(w);
  const halfTyped = /[a-z]$/.test(typed) && !known(last) && !known(lastRaw);
  if (!halfTyped) return { ...full, prefixed: false, completed: null };
  const finish = completions(index, raw, { max: 3 }).find((c) => !c.corrected && normalize(c.text).startsWith(typed));
  if (finish) {
    const done = search(index, finish.text);
    if (done.items.length) return { ...done, prefixed: true, completed: finish.text };
  }
  if (full.items.length && !full.relaxed.length && !full.query.corrected) return { ...full, prefixed: false, completed: null };
  const prefixed = search(index, raw, { prefix: true });
  // Words that start that way: only when nothing else was found, or the last word is a letter or two
  // ("dining t"). A whole unknown word isn't the start of another ("sofa for my cat" isn't Catnapper).
  if (prefixed.items.length && (!full.items.length || (last.length <= 2 && full.relaxed.includes(last)))) return { ...prefixed, prefixed: true, completed: null };
  return { ...full, prefixed: false, completed: null };
}
