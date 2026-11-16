/**
 * Words and controls stay on the box they're drawn on
 * ===================================================
 * Loads admin pages in a real browser at phone to desktop widths, opens every folded part, and
 * checks each piece of text and each control against the nearest box that paints a background or
 * border around it:
 *
 *  - spill:    it reaches outside that box (a page-wide "does it scroll sideways" check misses this);
 *  - straddle: a fieldset that paints a box, with its legend drawn across the box's top edge (the
 *              browser's default, which put "The story's collage" half off its panel);
 *  - tight:    text less than 4px from the inside edge of a filled box (a panel lost its padding);
 *  - cut:      text clipped by its own box without ending in "…";
 *  - offscreen: text or a control past the side of the screen, outside anything meant to scroll sideways.
 *
 * Text cut short on purpose with an ellipsis, labels hidden for screen readers, and fixed or
 * sticky bars are left alone. Exits 1 with a list of problems, by width.
 *
 *   npx astro dev --config astro.local.config.mjs   (in another terminal)
 *   node scripts/check-admin-boxes.mjs http://localhost:4321/admin/email/ [more pages…] [--widths 320,390,1440] [--click "<css>"]…
 *
 * --click opens something first (a dialog, a menu) by clicking what the selector finds, in order, so
 * what only shows when opened is checked too: a dialog with nothing in it measured runs off a phone unseen.
 *
 * Run it on a page after any change to how it looks, with the page showing real content: an empty
 * section and a full one can fail differently.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const wi = args.indexOf('--widths');
const widths = (wi >= 0 ? args.splice(wi, 2)[1] : '320,360,390,430,768,1024,1280,1440').split(',').map(Number);
const clicks = [];
for (let ci = args.indexOf('--click'); ci >= 0; ci = args.indexOf('--click')) clicks.push(args.splice(ci, 2)[1]);
const pages = args.length ? args : ['http://localhost:4321/admin/email/'];

/** Runs in the page: every problem on it, as { kind, what, box, by }. */
function problemsOnPage() {
  const out = [];
  const root = document.querySelector('main') ?? document.body;
  const CONTROL = /^(INPUT|SELECT|TEXTAREA|BUTTON|IMG)$/;
  const clear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
  const paints = (el) => {
    const s = getComputedStyle(el);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== 'none');
    return !clear(s.backgroundColor) || border || s.backgroundImage !== 'none';
  };
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    const txt = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `${el.tagName.toLowerCase()}${id}${cls} "${txt}"`;
  };
  const screenReaderOnly = (s, r) => s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)' || (r.width <= 1 && s.overflow === 'hidden');
  const visible = (el) => {
    // Not drawn: hidden, or skipped by content-visibility until scrolled near
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (screenReaderOnly(s, r) || s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false;
    return r.width > 0 && r.height > 0;
  };
  const scrollsSideways = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (/^(auto|scroll)$/.test(getComputedStyle(a).overflowX)) return true;
    return false;
  };
  // Bars pinned to the screen are left alone; a dialog's contents are checked like the page's
  const pinned = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (a.tagName === 'DIALOG') return false;
      if (/^(fixed|sticky)$/.test(getComputedStyle(a).position)) return true;
    }
    return false;
  };
  const drawnLegend = (fs) => {
    const lg = [...fs.children].find((c) => c.tagName === 'LEGEND');
    if (!lg || !visible(lg)) return null;
    const s = getComputedStyle(lg);
    return s.float === 'none' && s.position === 'static' ? lg : null;
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());

  const items = [...root.querySelectorAll('*')].filter(
    (el) => visible(el) && !pinned(el) && (CONTROL.test(el.tagName) || /^(LABEL|LEGEND)$/.test(el.tagName) || ownText(el).length),
  );
  for (const el of items) {
    const isText = !CONTROL.test(el.tagName) && ownText(el).length > 0;
    // What's drawn: the words themselves for text, else the element.
    let r = el.getBoundingClientRect();
    if (isText) {
      const range = document.createRange();
      let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
      for (const n of ownText(el)) {
        range.selectNodeContents(n);
        for (const q of range.getClientRects()) {
          if (!q.width) continue;
          L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom);
        }
      }
      if (L < Infinity) r = { left: L, top: T, right: R, bottom: B };
      // Words clipped by their own box (an ellipsis) are drawn only up to it.
      if (getComputedStyle(el).overflowX !== 'visible') {
        const own = el.getBoundingClientRect();
        r = { left: Math.max(r.left, own.left), top: Math.max(r.top, own.top), right: Math.min(r.right, own.right), bottom: Math.min(r.bottom, own.bottom) };
      }
    }
    // The box it's drawn on: text on its own pill counts as on that pill.
    let box = null;
    for (let a = isText ? el : el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (paints(a)) {
        box = a;
        break;
      }
    }
    // Scrolled out of view inside a scrolling list isn't spilling: it's measured only while in view
    let scroller = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/^(auto|scroll)$/.test(o.overflowY) || /^(auto|scroll)$/.test(o.overflowX)) { scroller = a; break; }
    }
    const sr = scroller?.getBoundingClientRect();
    const inView = !sr || (r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 && r.left >= sr.left - 1 && r.right <= sr.right + 1);
    if (box && inView) {
      const br = box.getBoundingClientRect();
      // A fieldset with a drawn legend paints from the legend's middle down.
      const lg = box.tagName === 'FIELDSET' && drawnLegend(box);
      const top = lg ? lg.getBoundingClientRect().top + lg.getBoundingClientRect().height / 2 : br.top;
      const over = Math.max(br.left - r.left, r.right - br.right, top - r.top, r.bottom - br.bottom);
      if (over > 1) out.push({ kind: 'spill', what: name(el), box: name(box), by: Math.round(over) });
      const fills = !clear(getComputedStyle(box).backgroundColor) && box !== document.body && box !== root;
      if (isText && fills && over <= 1) {
        // A pill's few pixels above and below its words are fine; a panel's edge touching its text isn't.
        const sides = [r.left - br.left, br.right - r.right];
        if (box !== el) sides.push(r.top - top, br.bottom - r.bottom);
        const inset = Math.min(...sides);
        if (inset < 4) out.push({ kind: 'tight', what: name(el), box: name(box), by: Math.round(inset) });
      }
    }
    const whole = el.getBoundingClientRect();
    if ((whole.left < -1 || whole.right > innerWidth + 1) && !scrollsSideways(el)) out.push({ kind: 'offscreen', what: name(el), by: Math.round(Math.max(-whole.left, whole.right - innerWidth)) });
    const s = getComputedStyle(el);
    if (!/^(INPUT|SELECT|TEXTAREA|IMG)$/.test(el.tagName) && s.textOverflow !== 'ellipsis' && /^(hidden|clip)$/.test(s.overflowX) && el.scrollWidth - el.clientWidth > 1) {
      out.push({ kind: 'cut', what: name(el), by: el.scrollWidth - el.clientWidth });
    }
  }
  for (const fs of root.querySelectorAll('fieldset')) {
    if (!visible(fs) || !paints(fs)) continue;
    const lg = drawnLegend(fs);
    if (lg) out.push({ kind: 'straddle', what: name(lg), box: name(fs) });
  }
  return out;
}

const browser = await chromium.launch();
let total = 0;
for (const url of pages) {
  const byProblem = new Map();
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('main', { timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
    for (const sel of clicks) {
      // Once it's on (a button can be off until its data loads), as a person would, whatever bar is over it
      await page.waitForFunction((q) => { const el = document.querySelector(q); return el && !el.disabled; }, sel, { timeout: 120000 });
      await page.locator(sel).first().evaluate((el) => el.click());
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(500);
    for (const f of await page.evaluate(problemsOnPage)) {
      const key = `${f.kind}\u0000${f.what}\u0000${f.box ?? ''}`;
      const e = byProblem.get(key) ?? { ...f, at: [] };
      const at = f.by ? `${width} (${f.by}px)` : String(width);
      if (!e.at.includes(at)) e.at.push(at);
      byProblem.set(key, e);
    }
    await page.close();
  }
  console.log(`${url}: ${byProblem.size ? `${byProblem.size} problem(s)` : 'every box holds its words'}`);
  for (const e of byProblem.values()) console.log(`  ${e.kind.padEnd(8)} ${e.what}\n           on ${(e.box ?? '-').slice(0, 90)}\n           at ${e.at.join(', ')}`);
  total += byProblem.size;
}
await browser.close();
process.exit(total ? 1 : 0);
