/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FIRST_SCREEN, render } from '@/lib/sunny-side/email.mjs';
import { FONT, FONT_LINK } from './font';

/** What the preview measures at a small phone's and a phone's width, by the rules verify.mjs holds the email to. */
export interface Fit {
  buttonAt: number;
  spill: boolean;
  /** Handles of products whose name runs past two lines. */
  longNames: string[];
}

/** The email for this brief and these sections, with the font swapped for the admin's copy. */
function emailHtml(brief: Record<string, unknown>, sections: string[]): string {
  const html = render(brief, sections);
  const swapped = html.replace(FONT_LINK, FONT);
  if (swapped === html) throw new Error('The email’s font link changed; update the preview’s font swap.');
  return swapped;
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
  await doc.fonts?.ready;
  const button = doc.querySelector('a[href*="utm_content=offer-button"]');
  if (!button) return null;
  const spill = [...doc.querySelectorAll<HTMLElement>('p,h1,h2')].some((t) => t.getBoundingClientRect().width && t.scrollWidth > t.clientWidth + 1);
  const longNames = [...doc.querySelectorAll<HTMLElement>('.tile-name')]
    .filter((t) => t.getBoundingClientRect().height > 2 * 20 + 1)
    .map((t) => t.closest('a')?.getAttribute('href')?.match(/\/shop\/([^/?]+)/)?.[1] ?? '')
    .filter(Boolean);
  return { buttonAt: Math.round(button.getBoundingClientRect().bottom + win.scrollY), spill, longNames };
}

/** The part of the email Staci is working on, which the preview keeps in view. */
export type Focus = 'offer' | 'wall' | 'photos' | 'story' | 'events' | 'mission';

/** Where a part starts in the email: found by what's in it, since the email's bands carry no names. */
function partOf(doc: Document, focus: Focus): Element | null {
  const byLink = (slot: string) => doc.querySelector(`a[href*="utm_content=${slot}"]`)?.closest('td[bgcolor]')?.closest('tr') ?? null;
  if (focus === 'wall') return doc.querySelector('a[href*="utm_content=wall-shop-all"]')?.closest('table')?.closest('tr') ?? null;
  if (focus === 'story') return byLink('story-link');
  if (focus === 'photos') return byLink('story-link') ?? null;
  if (focus === 'events') return doc.querySelector('[bgcolor="#2B7A96"]');
  if (focus === 'mission') return doc.querySelector('.soard');
  return null;
}

interface Props {
  focus: Focus;
  brief: Record<string, unknown> | null;
  sections: string[];
  problem: string | null;
  checks: { ok: boolean | null; text: string }[];
  onFit: (fit: { small: Fit | null; phone: Fit | null }) => void;
}

/**
 * The email as customers will see it, at phone or computer width, drawn by the same code that
 * builds the email. Two frames out of sight, at 320 and 390px, measure what verify.mjs would.
 */
export function Preview({ focus, brief, sections, problem, checks, onFit }: Props) {
  const [view, setView] = useState<'phone' | 'computer'>('phone');
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(900);
  const frame = useRef<HTMLIFrameElement>(null);
  const small = useRef<HTMLIFrameElement>(null);
  const phone = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const width = view === 'phone' ? 390 : 640;

  useEffect(() => {
    if (frame.current) delete frame.current.dataset.drawn;
  }, [view]);

  useEffect(() => {
    if (!brief) return;
    const t = window.setTimeout(async () => {
      let html: string;
      try {
        html = emailHtml(brief, sections);
      } catch {
        return; // the page says what's wrong; the preview keeps the last good email
      }
      for (const f of [frame.current, small.current, phone.current]) if (f) show(f, html);
      const [a, b] = await Promise.all([small.current ? measure(small.current) : null, phone.current ? measure(phone.current) : null]);
      onFit({ small: a, phone: b });
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
      </div>
    </section>
  );
}
