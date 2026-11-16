/**
 * Search as you type, for the header's search boxes (desktop and phone).
 *
 * Built to the W3C combobox pattern (focus stays in the box; arrow keys move a highlight that
 * screen readers follow through aria-activedescendant; Escape closes) and Baymard's
 * autocomplete findings: suggested searches first, with the part the shopper hasn't typed in
 * bold; then labeled groups in fixed places; at most 10 rows on a desktop and 8 on a phone;
 * a highlighted search is copied into the box; a typo still gets suggestions; nothing
 * suggested leads to an empty page. Every keystroke is answered in a few milliseconds from
 * the index in the browser, so there's no waiting and no debounce.
 */
import { navigate } from 'astro:transitions/client';
import { loadSearchIndex, warmSearchIndex } from './client';
import { completions, popular, results } from './complete.mjs';
import { imageUrl } from './docs.mjs';
import { normalize, suggest } from './engine.mjs';
import { logSearch, rememberSearch, recentSearches } from './memory';

type Index = Awaited<ReturnType<typeof loadSearchIndex>>;
type Kind = 'query' | 'product' | 'page' | 'all';
type Option = { id: string; kind: Kind; href: string; text?: string; handle?: string };

export const resultsHref = (q: string) => `/shop/?q=${encodeURIComponent(q.trim())}`;
const money = (n: number) => (n % 1 === 0 ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const ICON = {
  search: '<svg class="ss-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/></svg>',
  recent: '<svg class="ss-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  page: '<svg class="ss-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/></svg>',
  arrow: '<svg class="ss-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Appends nodes and text (Element.append's type clashes with the Workers types in this project). */
function add(parent: Node, ...children: Array<Node | string>): void {
  for (const c of children) parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
}

/** The suggestion with the shopper's own letters plain and the rest bold (Baymard: bold the prediction). */
function predicted(text: string, typed: string): HTMLElement {
  const span = el('span', 'ss-text');
  const t = normalize(typed);
  const at = t ? text.toLowerCase().indexOf(t) : -1;
  const bold = (s: string) => { if (s) add(span, el('strong', undefined, s)); };
  if (at < 0) { bold(text); return span; }
  bold(text.slice(0, at));
  add(span, text.slice(at, at + t.length));
  bold(text.slice(at + t.length));
  return span;
}

export interface SearchBox {
  form: HTMLFormElement;
  input: HTMLInputElement;
  /** The panel the suggestions show in; the listbox is inside it. */
  panel: HTMLElement;
  list: HTMLElement;
  note: HTMLElement;
  /** A live region: how many results there are, once typing pauses. */
  status: HTMLElement;
  clear?: HTMLButtonElement | null;
  /** A phone: fewer rows, and the panel fills the screen below the box. */
  compact?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Wires one search box until `signal` aborts (the next page). */
export function mountSearch(box: SearchBox, signal: AbortSignal): { close: () => void } {
  const { form, input, panel, list, note, status, clear, compact = false } = box;
  const limits = compact ? { queries: 3, products: 4, popular: 5, recent: 3 } : { queries: 4, products: 5, popular: 6, recent: 3 };
  let options: Option[] = [];
  let active = -1;
  let typed = input.value;
  let open = false;
  let frame = 0;
  let announce = 0;
  let index: Index | null = null;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  list.setAttribute('role', 'listbox');

  const syncClear = () => { if (clear) clear.hidden = !input.value; };

  const setActive = (i: number, copy: boolean) => {
    list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    active = i;
    if (i < 0) {
      input.removeAttribute('aria-activedescendant');
      if (copy) input.value = typed;
      syncClear();
      return;
    }
    const opt = options[i];
    const row = document.getElementById(opt.id);
    row?.setAttribute('aria-selected', 'true');
    row?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', opt.id);
    // A highlighted search goes into the box, where it can be edited (Baymard); anything else leaves what was typed.
    if (copy) input.value = opt.kind === 'query' && opt.text ? opt.text : typed;
    syncClear();
  };

  const setOpen = (on: boolean) => {
    if (open === on) return;
    open = on;
    panel.dataset.open = String(on);
    input.setAttribute('aria-expanded', String(on));
    if (on) box.onOpen?.();
    else { setActive(-1, false); status.textContent = ''; box.onClose?.(); }
  };

  const group = (label: string) => {
    const g = el('div', 'ss-group');
    g.setAttribute('role', 'group');
    const id = `${list.id}-g${list.children.length}`;
    const h = el('div', 'ss-group__label', label);
    h.id = id;
    h.setAttribute('role', 'presentation');
    g.setAttribute('aria-labelledby', id);
    add(g, h);
    add(list, g);
    return g;
  };

  /** What happens when a row is chosen, by click or Enter: remembered, and counted for the admin's Search page. */
  const chosen = (opt: Option) => {
    const q = typed.trim();
    if (opt.kind === 'query' && opt.text) rememberSearch(opt.text);
    else if (q) rememberSearch(q);
    if (opt.kind === 'product' && q) {
      const at = options.filter((o) => o.kind === 'product').indexOf(opt) + 1;
      logSearch({ e: 'click', q, h: opt.handle, p: at, src: 'panel' });
    }
  };

  const option = (parent: HTMLElement, opt: Omit<Option, 'id'>, build: (a: HTMLAnchorElement) => void) => {
    const id = `${list.id}-o${options.length}`;
    const a = el('a', `ss-option ss-option--${opt.kind}`);
    a.id = id;
    a.href = opt.href;
    a.tabIndex = -1;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', 'false');
    build(a);
    const at = options.length;
    a.addEventListener('pointermove', () => { if (active !== at) setActive(at, false); });
    a.addEventListener('click', () => { chosen(options[at]); setOpen(false); input.blur(); });
    add(parent, a);
    options.push({ ...opt, id });
  };

  const queryRow = (parent: HTMLElement, text: string, count: number | null, icon: string, label?: string) =>
    option(parent, { kind: 'query', href: resultsHref(text), text }, (a) => {
      a.insertAdjacentHTML('beforeend', icon);
      add(a, label ? el('span', 'ss-text', label) : predicted(text, typed));
      if (count !== null) add(a, el('span', 'ss-count', count.toLocaleString('en-US')));
    });

  const say = (text: string) => {
    window.clearTimeout(announce);
    announce = window.setTimeout(() => { status.textContent = text; }, 600); // once typing pauses
  };

  const render = () => {
    if (!index) return;
    typed = input.value;
    list.replaceChildren();
    options = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    note.hidden = true;
    const q = typed.trim();

    if (!q) {
      const recents = recentSearches().slice(0, limits.recent);
      if (recents.length) {
        const g = group('Recent searches');
        for (const r of recents) queryRow(g, r, null, ICON.recent, r);
      }
      const g = group('Popular');
      for (const p of popular(index, limits.popular)) queryRow(g, p.text, p.count, ICON.search, p.label);
      say(`${plural(options.length, 'suggestion')}. Use up and down arrows to review.`);
      setOpen(true);
      return;
    }

    const found = results(index, q);
    const asTyped = suggest(index, q, { products: limits.products, kinds: 0 });
    // Half-typed words find pieces as they go; a typo finds them through its fix ("recliener").
    const products = asTyped.products.length ? asTyped.products : found.items.slice(0, limits.products);
    const pages = [...new Map([...asTyped.pages, ...found.query.pages].map((p) => [p.href, p])).values()];
    const queries = completions(index, q, { max: limits.queries });
    if (!asTyped.products.length && found.items.length && found.query.corrected) {
      note.replaceChildren();
      add(note, 'Showing results for ', el('strong', undefined, found.query.corrected));
      note.hidden = false;
    }
    if (queries.length) {
      const g = group('Suggestions');
      for (const s of queries) queryRow(g, s.text, s.count, ICON.search);
    }
    if (products.length) {
      const g = group('Products');
      for (const { item } of products) {
        const d = item.doc;
        option(g, { kind: 'product', href: `/shop/${d.h}/`, handle: d.h }, (a) => {
          const thumb = el('span', 'ss-thumb');
          if (d.i) {
            const img = el('img');
            img.src = imageUrl(d.i, 112);
            img.alt = '';
            img.width = 56;
            img.height = 56;
            img.decoding = 'async';
            add(thumb, img);
          }
          const info = el('span', 'ss-info');
          add(info, el('span', 'ss-title', item.title));
          const meta = el('span', 'ss-meta');
          if (d.p > 0) add(meta, el('span', 'ss-price', money(d.p)));
          if (d.cp) add(meta, el('s', 'ss-was', money(d.cp)));
          if (!d.s) add(meta, el('span', 'ss-sold', 'Sold out'));
          add(info, meta);
          add(a, thumb, info);
        });
      }
    }
    if (pages.length) {
      const g = group('Help');
      for (const p of pages) {
        option(g, { kind: 'page', href: p.href }, (a) => {
          a.insertAdjacentHTML('beforeend', ICON.page);
          const info = el('span', 'ss-info');
          add(info, el('span', 'ss-title', p.title), el('span', 'ss-meta', p.blurb));
          add(a, info);
        });
      }
    }
    const n = found.items.length;
    if (n) {
      option(list, { kind: 'all', href: resultsHref(q) }, (a) => {
        const t = el('span', 'ss-text');
        add(t, `See all ${plural(n, 'result')} for `, el('strong', undefined, `“${q}”`));
        add(a, t);
        a.insertAdjacentHTML('beforeend', ICON.arrow);
      });
    }
    if (!options.length) {
      // Never a dead end: what the store does have, and people who can help.
      const empty = el('div', 'ss-empty');
      empty.setAttribute('role', 'presentation');
      const head = el('p', 'ss-empty__head');
      add(head, 'Nothing in the showroom matches ', el('strong', undefined, `“${q}”`), '.');
      const help = el('p', 'ss-empty__help', 'Try another word, or call us at (678) 888-5140.');
      add(empty, head, help);
      add(list, empty);
      const g = group('Popular');
      for (const p of popular(index, 4)) queryRow(g, p.text, p.count, ICON.search, p.label);
    }
    say(n
      ? `${plural(n, 'result')}. ${plural(options.length, 'suggestion')}, use up and down arrows to review.`
      : `No results for ${q}. ${plural(options.length, 'suggestion')}.`);
    setOpen(true);
  };

  const update = () => {
    syncClear();
    if (index) { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); return; }
    loadSearchIndex()
      .then((ix) => {
        // The page may have changed while it downloaded: this box's listeners are gone then.
        if (signal.aborted) return;
        index = ix;
        if (document.activeElement === input) render();
      })
      .catch(() => { if (!signal.aborted) setOpen(false); });
  };

  const go = (href: string) => { setOpen(false); input.blur(); void navigate(href); };

  input.addEventListener('pointerenter', warmSearchIndex, { signal, once: true });
  input.addEventListener('focus', update, { signal });
  input.addEventListener('input', update, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) { update(); return; }
        if (!options.length) return;
        // Loops, through "nothing highlighted" (what was typed) and around.
        let next = active + (e.key === 'ArrowDown' ? 1 : -1);
        if (next >= options.length) next = -1;
        else if (next < -1) next = options.length - 1;
        setActive(next, true);
        return;
      }
      case 'Enter': {
        e.preventDefault();
        const opt = open && active >= 0 ? options[active] : undefined;
        if (opt) { chosen(opt); go(opt.href); return; }
        const q = input.value.trim();
        if (q) { rememberSearch(q); go(resultsHref(q)); }
        return;
      }
      case 'Escape':
        if (open) { e.preventDefault(); input.value = typed; syncClear(); setOpen(false); }
        else if (input.value) { e.preventDefault(); input.value = ''; typed = ''; syncClear(); }
        return;
      case 'Tab':
        setOpen(false);
        return;
    }
  }, { signal });
  // The magnifier button submits the form (and without a script, the browser does): same as Enter.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) { rememberSearch(q); go(resultsHref(q)); } else input.focus();
  }, { signal });
  // A click anywhere in the panel (a row, a heading, the note) or on the clear button keeps focus,
  // and so the panel, in the box.
  panel.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
  clear?.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
  clear?.addEventListener('click', () => { input.value = ''; typed = ''; input.focus(); update(); }, { signal });
  // On a desktop, leaving the box closes the panel. A phone keeps it open when the keyboard is
  // put away, so the list can be scrolled; Cancel, or a tap outside, closes it.
  if (!compact) {
    input.addEventListener('blur', () => window.setTimeout(() => { if (document.activeElement !== input) setOpen(false); }, 0), { signal });
  }
  document.addEventListener('pointerdown', (e) => {
    if (open && !form.contains(e.target as Node)) setOpen(false);
  }, { signal });
  signal.addEventListener('abort', () => { cancelAnimationFrame(frame); window.clearTimeout(announce); setOpen(false); });
  syncClear();
  return { close: () => setOpen(false) };
}
