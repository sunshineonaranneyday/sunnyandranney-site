/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FIRST_SCREEN, FONT_LINK, PARTS, bareEmail, render } from '@/lib/sunny-side/email.mjs';
import { FONT } from './font';

/** Text too wide for a phone: the word that doesn't fit, by how much, and the part of the email it's in. */
export interface Spill {
  word: string;
  over: number;
  part: Focus | 'layout';
}

/** What the preview measures at a small phone's and a phone's width, by the rules verify.mjs holds the email to. */
export interface Fit {
  /** Where the sale button's foot is, or null in an email without the sale. */
  buttonAt: number | null;
  spill: boolean;
  /** What's too wide, so the page can say what and where, never just "something". */
  spills: Spill[];
  /** Handles of products whose name runs past two lines. */
  longNames: string[];
}

/**
 * The email for this brief and these sections, built once: as sent, with the font swapped for the
 * admin's copy, and bare (bareEmail), as the Gmail app shows it to a Yahoo, Outlook or iCloud
 * account: no web fonts (Helvetica or Arial in their place, which run wider) and no style block, only
 * the inline styles, the worst case verify.mjs holds the email to.
 */
function emailHtml(brief: Record<string, unknown>, sections: string[]): { html: string; bare: string } {
  const sent = render(brief, sections);
  if (!FONT_LINK.test(sent)) throw new Error('The email’s font link changed; update the preview’s font swap.');
  return { html: sent.replace(FONT_LINK, FONT), bare: bareEmail(sent) };
}

const rowsOf = (doc: Document) => {
  const body = doc.querySelector<HTMLTableElement>('table[style*="max-width:600px"]')?.tBodies[0];
  return body ? [...body.rows] : null;
};

/**
 * Shows new email HTML in a frame. The first time, the whole document is written; after that only
 * the rows (the email's bands) that changed are swapped, so photos that didn't change don't
 * flash while Staci types or moves a product.
 */
function show(frame: HTMLIFrameElement, html: string) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const now = frame.dataset.drawn ? rowsOf(doc) : null;
  const next = rowsOf(new DOMParser().parseFromString(html, 'text/html'));
  if (now && next) {
    let a = 0;
    while (a < now.length && a < next.length && now[a].outerHTML === next[a].outerHTML) a++;
    let b = 0;
    while (b < now.length - a && b < next.length - a && now[now.length - 1 - b].outerHTML === next[next.length - 1 - b].outerHTML) b++;
    const parent = now[0]?.parentElement;
    if (parent) {
      const before = now[now.length - b] ?? null;
      now.slice(a, now.length - b).forEach((r) => r.remove());
      next.slice(a, next.length - b).forEach((r) => parent.insertBefore(doc.importNode(r, true), before));
      return;
    }
  }
  doc.open();
  doc.write(html);
  doc.close();
  // Links in the preview don't open the store
  doc.addEventListener('click', (e) => e.preventDefault(), true);
  frame.dataset.drawn = '1';
}

async function measure(frame: HTMLIFrameElement): Promise<Fit | null> {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return null;
  // No scrollbar: where the computer always shows them, the frame's took 15px and the "320px" check
  // laid the email out at 305 (Peter's Chrome, Nov 16, 2026). A phone has none.
  doc.documentElement.style.overflow = 'hidden';
  await doc.fonts?.ready;
  // An email with its sale turned off has no button, and is still measured for what spills
  const button = doc.querySelector('a[href*="utm_content=offer-button"]');
  if (!doc.body?.childElementCount) return null;
  // Each line of text wider than its column, with its widest word (what to shorten) and the part it's in:
  // the band it sits in says (data-part, from email.mjs). Guessing from the page's structure missed the
  // product tiles (a band below the products' heading) and every event after the first, so Staci was
  // never told about a word there she could fix, and the owner was told it was the email's own layout.
  const partOfEl = (el: Element): Spill['part'] => {
    const part = el.closest('[data-part]')?.getAttribute('data-part') ?? '';
    return (PARTS as string[]).includes(part) ? (part as Spill['part']) : 'layout';
  };
  const ruler = doc.createElement('canvas').getContext('2d');
  /** An element's widest word and its width: what to shorten. */
  const widestWord = (t: HTMLElement): [string, number] => {
    const text = (t.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!ruler) return [text, 0];
    ruler.font = win.getComputedStyle(t).font;
    let best: [string, number] = [text, 0];
    for (const w of text.split(' ')) {
      const width = ruler.measureText(w).width;
      if (width > best[1]) best = [w, width];
    }
    return best;
  };
  const short = (w: string) => (w.length > 40 ? `${w.slice(0, 39)}…` : w);
  const spills: Spill[] = [];
  // The same two rules verify.mjs holds the email to: text spilling out of its own box (a fixed cell,
  // a tile's name or price), and the email as a whole wider than the phone (a word that holds a cell open)
  for (const t of doc.querySelectorAll<HTMLElement>('p,h1,h2,.tile-name,.tile-price')) {
    if (!t.getBoundingClientRect().width || t.scrollWidth <= t.clientWidth + 1) continue;
    spills.push({ word: short(widestWord(t)[0]), over: t.scrollWidth - t.clientWidth, part: partOfEl(t) });
  }
  const wider = doc.documentElement.scrollWidth - win.innerWidth;
  if (wider > 1 && !spills.length) {
    const past = [...doc.querySelectorAll<HTMLElement>('body *')].filter(
      (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()) && el.getBoundingClientRect().right > win.innerWidth + 1,
    );
    const culprit = past.map((el) => [el, widestWord(el)] as const).sort((a, b) => b[1][1] - a[1][1])[0];
    spills.push({ word: culprit ? short(culprit[1][0]) : 'Something', over: wider, part: culprit ? partOfEl(culprit[0]) : 'layout' });
  }
  const spill = spills.length > 0;
  const longNames = [...doc.querySelectorAll<HTMLElement>('.tile-name')]
    .filter((t) => t.getBoundingClientRect().height > 2 * 20 + 1)
    .map((t) => t.closest('a')?.getAttribute('href')?.match(/\/shop\/([^/?]+)/)?.[1] ?? '')
    .filter(Boolean);
  return { buttonAt: button ? Math.round(button.getBoundingClientRect().bottom + win.scrollY) : null, spill, spills, longNames };
}

/** The part of the email Staci is working on, which the preview keeps in view. */
export type Focus = 'offer' | 'wall' | 'photos' | 'story' | 'reveal' | 'events' | 'mission';

/**
 * Where a part starts in the email: the first band tagged with it (data-part). The photos are the
 * story's. The sale is the top of the email, its photo and masthead included, so it scrolls to the top.
 */
function partOf(doc: Document, focus: Focus): Element | null {
  if (focus === 'offer') return null;
  const part = focus === 'photos' ? 'story' : focus;
  return doc.querySelector(`[data-part="${part}"]`)?.closest('tr') ?? null;
}

interface Props {
  focus: Focus;
  brief: Record<string, unknown> | null;
  sections: string[];
  problem: string | null;
  checks: { ok: boolean | null; text: string }[];
  onFit: (fit: Fits) => void;
}

/** What each measuring frame found: the smallest phone, a phone, and the smallest phone bare (emailHtml). */
export interface Fits {
  small: Fit | null;
  phone: Fit | null;
  bare: Fit | null;
}

/**
 * The email as customers will see it, at phone or computer width, drawn by the same code that
 * builds the email. Three frames out of sight measure what verify.mjs would: 320 and 390px as sent,
 * and 320px bare (no style block, no web fonts).
 */
export function Preview({ focus, brief, sections, problem, checks, onFit }: Props) {
  const [view, setView] = useState<'phone' | 'computer'>('phone');
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(900);
  const frame = useRef<HTMLIFrameElement>(null);
  const small = useRef<HTMLIFrameElement>(null);
  const phone = useRef<HTMLIFrameElement>(null);
  const bare = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const width = view === 'phone' ? 390 : 640;

  useEffect(() => {
    if (frame.current) delete frame.current.dataset.drawn;
  }, [view]);

  useEffect(() => {
    if (!brief) return;
    const t = window.setTimeout(async () => {
      let html: string;
      let bareHtml: string;
      try {
        ({ html, bare: bareHtml } = emailHtml(brief, sections));
      } catch {
        return; // the page says what's wrong; the preview keeps the last good email
      }
      for (const f of [frame.current, small.current, phone.current]) if (f) show(f, html);
      if (bare.current) show(bare.current, bareHtml);
      const [a, b, c] = await Promise.all([small.current, phone.current, bare.current].map((f) => (f ? measure(f) : null)));
      onFit({ small: a, phone: b, bare: c });
      const doc = frame.current?.contentDocument;
      if (doc) {
        await doc.fonts?.ready;
        // Photos that load after the first measure make the email taller
        const fitHeight = () => setHeight(Math.ceil(doc.documentElement.scrollHeight));
        fitHeight();
        doc.querySelectorAll('img').forEach((img) => !img.complete && img.addEventListener('load', fitHeight, { once: true }));
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [brief, sections.join(), view]);

  // Beside the form, the preview scrolls to the part being worked on. Below it (one column) it
  // leaves the page's scrolling alone.
  useEffect(() => {
    const side = stage.current?.closest<HTMLElement>('.em-side');
    const doc = frame.current?.contentDocument;
    if (!side || !doc || !stage.current || side.scrollHeight <= side.clientHeight + 1) return;
    const part = partOf(doc, focus);
    const into = part ? part.getBoundingClientRect().top + (doc.defaultView?.scrollY ?? 0) : 0;
    const stageTop = stage.current.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
    side.scrollTo({ top: part ? Math.max(0, stageTop + into * scale - 48) : 0, behavior: 'smooth' });
  }, [focus, height, scale, sections.join()]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <section class="em-preview card" aria-labelledby="em-preview-title">
      <div class="em-preview-head">
        <h2 id="em-preview-title">Preview</h2>
        <div class="btn-group" role="group" aria-label="Preview size">
          <button type="button" class="btn btn-small" aria-pressed={view === 'phone'} onClick={() => setView('phone')}>
            Phone
          </button>
          <button type="button" class="btn btn-small" aria-pressed={view === 'computer'} onClick={() => setView('computer')}>
            Computer
          </button>
        </div>
      </div>
      <ul class="em-checks" aria-live="polite">
        {checks.map((c) => (
          <li class={`em-check ${c.ok === null ? '' : c.ok ? 'is-ok' : 'is-bad'}`}>{c.text}</li>
        ))}
      </ul>
      {problem && <p class="em-error">{problem}</p>}
      <div class="em-stage" ref={stage}>
        <div class="em-frame" style={{ width: `${width * scale}px`, height: `${height * scale}px` }}>
          <div class={`em-device em-${view}`}>
            <iframe ref={frame} title={`The email at ${view} width`} tabIndex={-1} style={{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }} />
          </div>
          {view === 'phone' && (
            // Where a phone's first screen ends, marked on the phone's edges: a line across would strike through
            // whatever words of the email sit there. The check above names the marks.
            <div class="em-fold" style={{ top: `${FIRST_SCREEN * scale}px` }} aria-hidden="true" />
          )}
        </div>
      </div>
      <p class="em-hint em-preview-foot">The whole email, as it goes into Kit.</p>
      <div class="em-measure" aria-hidden="true">
        <iframe ref={small} tabIndex={-1} title="" style={{ width: '320px', height: '900px' }} />
        <iframe ref={phone} tabIndex={-1} title="" style={{ width: '390px', height: '900px' }} />
        <iframe ref={bare} tabIndex={-1} title="" style={{ width: '320px', height: '900px' }} />
      </div>
    </section>
  );
}
