// Holds every built email to the standard: two engines (Chromium for Gmail/Outlook.com/Android,
// WebKit for Apple Mail), three widths, plus a Gmail-style render with the web font blocked, and a
// bare render: no web fonts and no style block at all, as the Gmail app shows an email to a Yahoo,
// Outlook or iCloud account (it keeps only inline styles), so the email can't lean on its media
// queries to fit a phone. Then the sweep: every email, as sent, as Gmail shows it and bare, in both
// engines, at every width from 320 to 700px, fails on anything wider than the screen or spilling out
// of its box. Run on every pull request (.github/workflows/checks.yml).
// Fails loudly on: horizontal overflow, any off-brand color (the store's palette everywhere but the
// mission band, which is held to the charity's), links under 44px, missing alt,
// broken images, heading order, duplicate tracked links, HTML codes showing as text, text spilling
// out of its box, a product without its name and price or with a name over two lines, anything off
// the grid (photo rows run
// the full 600px or sit on the 536px column; cards and the words that start a row sit on the
// column), a phone render whose sale button lands below the first screen, CSS that Gmail strips
// (these renders load the raw file, so a layout that leans on stripped CSS would pass here and
// break in the inbox), any image with dark artwork on a transparent background (Gmail and
// Outlook darken backgrounds in dark mode but never images, so that artwork vanishes), and any
// image that, fetched as an inbox that can't show WebP would fetch it, isn't a JPEG, PNG or GIF or
// weighs over 150KB (on Nov 12, 2026 the heaviest good image was the 103KB hero, and the screenshot
// PNGs Shopify wouldn't convert were 177–493KB a tile).
import { chromium, webkit } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('./out/', import.meta.url).pathname;
const dirs = [root, join(root, 'tests')].filter(existsSync);
const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.html')).map(f => join(d, f)));
// About what Apple Mail and the Gmail app show of an email on a 390px iPhone before any scrolling,
// below their own bars (852pt screen less roughly 250pt of the app's own bars).
const FIRST_SCREEN = 600;
// The charity's palette, as sunshineonaranneyday.com renders it, allowed only inside its section (.soard):
// Sunshine Yellow, SOARD Dark, Dark Deep, Warm Gray, its muted text, and white.
// Plus the cream its story sections sit on and the soft white of its italic lines, as its own emails draw them.
const CHARITY = ['rgb(255, 218, 36)', 'rgb(55, 58, 54)', 'rgb(30, 31, 37)', 'rgb(245, 244, 240)', 'rgb(90, 91, 97)', 'rgb(255, 255, 255)',
  'rgb(254, 252, 245)', 'rgb(228, 228, 229)'];
const BRAND = ['rgb(255, 212, 0)', 'rgb(75, 149, 180)', 'rgb(43, 122, 150)', 'rgb(44, 44, 44)', 'rgb(107, 107, 104)', 'rgb(255, 255, 255)'];
const runs = [
  { e: 'webkit', n: 'iphone-se', w: 320, mode: 'sent' }, { e: 'webkit', n: 'iphone', w: 390, mode: 'sent' }, { e: 'chromium', n: 'android', w: 390, mode: 'sent' },
  { e: 'chromium', n: 'desktop', w: 700, mode: 'sent' },
  // Gmail as it serves the email: no web font, and the CSS it strips is gone.
  { e: 'chromium', n: 'gmail-web', w: 700, mode: 'gmail' }, { e: 'chromium', n: 'gmail-app', w: 390, mode: 'gmail' },
  // The Gmail app on the smallest iPhone: no web fonts, so every word is set in the fallback font
  { e: 'webkit', n: 'gmail-se', w: 320, mode: 'gmail' },
  // No style block: the Gmail app with a Yahoo, Outlook or iCloud account, on the smallest iPhone, and
  // a computer that drops it (the phone's sizes, inline, are all it gets)
  { e: 'webkit', n: 'bare-se', w: 320, mode: 'bare' }, { e: 'chromium', n: 'bare-desktop', w: 700, mode: 'bare' },
];
mkdirSync(join(root, 'shots'), { recursive: true });
const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
// Declarations Gmail removes from inline styles: negative margins, positioning, flex and grid.
const GMAIL_STRIPS = /(?:margin[a-z-]*\s*:[^;"]*-\d[^;"]*|position\s*:[^;"]*|display\s*:\s*(?:inline-)?(?:flex|grid)[^;"]*);?/gi;
/** The email as each kind of inbox gets it: as sent; as Gmail serves it; bare, with no style block either. */
const MODES = {
  sent: (src) => src,
  gmail: (src) => src.replace(GMAIL_STRIPS, ''),
  bare: (src) => src.replace(GMAIL_STRIPS, '').replace(/<style[\s\S]*?<\/style>/g, ''),
};
/** Every width the sweep lays each email out at: 320 to 700 in 10s, and both sides of each media query. */
const SWEEP = [...new Set([...Array.from({ length: 39 }, (_, k) => 320 + 10 * k), 374, 375, 620, 621])].sort((a, b) => a - b);
/** The sweep's stand-in for every photo: a blank pixel (a const up here, since the sweep runs in the loop below). */
const BLANK = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
/**
 * Offline (EMAIL_CHECK_OFFLINE=1, as the pull-request check runs it): no image host is asked for
 * anything. Each photo is a blank of its own shape (the width and height the email gives it), so every
 * render lays out exactly as with the real photo, and the checks of the live photos themselves (their
 * format, weight and dark artwork) are left to the full check on a computer. Otherwise a deleted
 * product photo, or Shopify itself going away at the Medusa switch, would fail every pull request,
 * whatever it changed. The email's Google Fonts still load, as they do in a reader's mail app.
 */
const OFFLINE = process.env.EMAIL_CHECK_OFFLINE === '1';
/** Each photo's address with its width and height in the email, for its offline stand-in. */
function shapes(html) {
  const out = new Map();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = tag.match(/\bsrc="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    const w = Number(tag.match(/\bwidth="(\d+)"/)?.[1]), h = Number(tag.match(/\bheight="(\d+)"/)?.[1]);
    if (src && w && h) out.set(src, [w, h]);
  }
  return out;
}
const standIn = ([w, h]) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#d8d8d8"/></svg>`;
/**
 * Where a render must have no web font (Gmail's and the bare ones), whether one loaded anyway: a route
 * that sent requests straight to the network skipped the font block, and the "fallback font" sweeps
 * quietly checked DM Sans (Nov 16, 2026).
 */
const webFontsIn = (page) => page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));

/**
 * Images that would lose their dark parts in dark mode: more than 1% transparent and more than 0.5%
 * dark opaque pixels (a logo's lettering). An image must be opaque, or light enough for any background.
 */
async function darkOnTransparent(html) {
  const urls = [...new Set([...html.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')))];
  const page = await engines.chromium.newPage();
  const bad = await page.evaluate(async (urls) => {
    const out = [];
    for (const u of urls) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = u;
      try { await img.decode(); } catch { continue; } // a broken image fails its own check
      const k = Math.min(1, 200 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      let d;
      try { d = g.getImageData(0, 0, c.width, c.height).data; } catch { out.push(`can't read the pixels of ${u.slice(0, 70)}`); continue; }
      let clear = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 250) clear++;
        else if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 110) dark++;
      }
      const n = d.length / 4;
      if (clear / n > 0.01 && dark / n > 0.005) out.push(`${u.split('/').slice(-3).join('/').slice(0, 70)} is ${Math.round((dark / n) * 100)}% dark artwork on a transparent background`);
    }
    return out;
  }, urls);
  await page.close();
  return bad;
}
/**
 * Every image as the email sends it, fetched the way Outlook for Windows would (no WebP, no AVIF):
 * a JPEG, PNG or GIF, and light enough for a phone on a slow connection.
 */
const IMAGE_MAX_KB = 150;
const weighed = new Map();
async function heavyOrUnshowable(html) {
  const urls = [...new Set([...html.matchAll(/<img[^>]*\bsrc="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')))];
  const out = [];
  for (const u of urls) {
    if (!weighed.has(u)) {
      weighed.set(u, (async () => {
        let last;
        // A second try, so a blip on an image host doesn't fail a pull request
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(u, { headers: { Accept: 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(30000) });
            const kb = Math.round((await res.arrayBuffer()).byteLength / 1024);
            last = { status: res.status, type: (res.headers.get('content-type') || '').split(';')[0], kb };
            if (res.status < 500) return last;
          } catch (err) {
            last = { status: 0, type: '', kb: 0, err: err.message };
          }
        }
        return last;
      })());
    }
    const w = await weighed.get(u);
    const name = u.replace(/^https:\/\/[^/]+/, '').split('?')[0].split('/').slice(-3).join('/').slice(0, 70);
    if (w.status !== 200) out.push(`${name} answered ${w.status || w.err}`);
    else if (!/^image\/(jpeg|png|gif)$/.test(w.type)) out.push(`${name} comes as ${w.type || 'no type'}, which Outlook can't show`);
    else if (w.kb > IMAGE_MAX_KB) out.push(`${name} weighs ${w.kb}KB (${IMAGE_MAX_KB}KB at most)`);
  }
  return out;
}
let failures = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const stripped = [...new Set(src.match(GMAIL_STRIPS) || [])];
  if (stripped.length) { failures++; console.log(`FAIL  ${f.split('/').pop()}  Gmail strips: ${stripped.join(' | ')}`); }
  if (!OFFLINE) {
    const darkMode = await darkOnTransparent(src);
    if (darkMode.length) { failures++; console.log(`FAIL  ${f.split('/').pop()}  dark mode: ${darkMode.join(' | ')}`); }
    const images = await heavyOrUnshowable(src);
    if (images.length) { failures++; console.log(`FAIL  ${f.split('/').pop()}  images: ${images.join(' | ')}`); }
  }
  const shape = shapes(src);
  for (const r of runs) {
    const ctx = await engines[r.e].newContext({ viewport: { width: r.w, height: 844 }, deviceScaleFactor: r.w < 600 ? 2 : 1 });
    if (r.mode !== 'sent') await ctx.route(/fonts\.(googleapis|gstatic)\.com/, x => x.abort());
    // Registered last, so it runs first; fallback() hands everything else on to the font block above
    if (OFFLINE) {
      await ctx.route(/^https?:\/\//, (x) => {
        if (x.request().resourceType() !== 'image') return x.fallback();
        const size = shape.get(x.request().url());
        return size ? x.fulfill({ status: 200, contentType: 'image/svg+xml', body: standIn(size) }) : x.fulfill({ status: 200, contentType: 'image/gif', body: BLANK });
      });
    }
    const page = await ctx.newPage();
    const failed = [];
    page.on('response', x => { if (x.status() >= 400) failed.push(x.status() + ' ' + x.url().slice(0, 70)); });
    if (r.mode !== 'sent') await page.setContent(MODES[r.mode](src), { waitUntil: 'networkidle' });
    else await page.goto('file://' + f, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const fontsLoaded = r.mode === 'sent' ? [] : await webFontsIn(page);
    // Decode every image first, so the full-page screenshot shows what a reader would see.
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
    const m = await page.evaluate(([brand, charity, bare]) => {
      const B = new Set(brand), C = new Set(charity), off = {};
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el), rc = el.getBoundingClientRect();
        if (!rc.width || !rc.height || el.closest('[style*="display:none"]')) continue;
        const props = ['backgroundColor'];
        if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) props.push('color');
        for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs['border' + s + 'Width']) > 0) props.push('border' + s + 'Color');
        const allowed = el.closest('.soard') ? C : B;
        for (const k of props) { const v = cs[k]; if (v && !v.startsWith('rgba(0, 0, 0, 0)') && !allowed.has(v)) off[v] = (off[v] || 0) + 1; }
      }
      const links = [...document.querySelectorAll('a[href]')];
      const small = links.filter(a => { const q = a.getBoundingClientRect(); return q.height > 0 && q.height < 44; }).map(a => (a.textContent.trim() || '[img]').slice(0, 18));
      const hrefs = links.map(a => a.getAttribute('href')).filter(h => !/unsubscribe|^tel:|^#/.test(h));
      const dupes = [...new Set(hrefs.filter((h, i) => hrefs.indexOf(h) !== i))];
      const heads = [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName);
      const offer = links.find(a => /utm_content=offer-button/.test(a.getAttribute('href')));

      // The column: 600px email, 32px sides (20px on phones, and everywhere with no style block: the
      // email is written phones first, and only the style block's min-width:621px gives a computer 32).
      const box = document.querySelector('table[style*="max-width:600px"]').getBoundingClientRect();
      const inset = innerWidth <= 620 || bare ? 20 : 32, L = box.left + inset, R = box.right - inset, near = (a, b) => Math.abs(a - b) <= 1;
      // A card is a rounded, filled cell (the event spotlight). Buttons are rounded and filled too, but aren't cards.
      const isCard = el => el.tagName === 'TD' && !el.closest('table.btn') && parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 12
        && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
      const inCard = el => { for (let a = el.parentElement; a; a = a.parentElement) if (isCard(a)) return true; return false; };
      // Photo rows and card rows start and end on the column, or (photos) run the full email width.
      // The logo and small marks (the pig, Greg) are exempt.
      const blocks = [...document.images].filter(i => {
        const q = i.getBoundingClientRect(); return q.width >= 120 && !/(^|\s)(soard-)?logo(\s|$)/.test(i.className);
      }).concat([...document.querySelectorAll('td')].filter(isCard));
      const byRow = {};
      for (const el of blocks) { const q = el.getBoundingClientRect(); if (q.width) (byRow[Math.round(q.top + scrollY)] ||= []).push(q); }
      const drift = [], col = x => Math.round(x - box.left);
      for (const [y, rs] of Object.entries(byRow)) {
        rs.sort((a, b) => a.left - b.left);
        const l = rs[0].left, r = rs.at(-1).right;
        const onColumn = near(l, L) && near(r, R), fullBleed = near(l, box.left) && near(r, box.right);
        if (!onColumn && !fullBleed) drift.push(`row@${y} ${col(l)}-${col(r)}`);
      }
      // Left-aligned words that start a row (not a second column: a tier, an event's "what") and sit
      // outside cards start on the column.
      const startsRow = el => { const td = el.closest('td'); return !td || !td.previousElementSibling; };
      for (const t of document.querySelectorAll('p,h1,h2,.tile-name,.tile-price')) {
        const q = t.getBoundingClientRect(), a = getComputedStyle(t).textAlign;
        if (q.width && (a === 'left' || a === 'start') && !inCard(t) && startsRow(t) && !near(q.left, L))
          drift.push(`"${t.textContent.trim().slice(0, 16)}"@${col(q.left)}`);
      }
      // Text that spills out of its own box: into a neighbor's padding, a rule, or off the email.
      const spill = [...document.querySelectorAll('p,h1,h2,.tile-name,.tile-price')].filter(t => t.getBoundingClientRect().width && t.scrollWidth > t.clientWidth + 1)
        .map(t => `"${t.textContent.trim().slice(0, 12)}"`);
      // HTML codes that ended up as text (an escaped or mangled &nbsp;, &amp;, &#8594; ...), hidden text
      // too: the preview line an inbox shows is hidden in the email, and the title is the subject.
      const codes = [...new Set(`${document.body.textContent} ${document.title}`.match(/&[a-z]+;|&#x?[0-9a-f]+;/gi) || [])];
      // Every product on the wall is shoppable at a glance: one link with its name and price, and the
      // name fits two lines.
      const tiles = links.filter(a => /utm_content=wall-\d/.test(a.getAttribute('href')));
      const unlabeled = tiles.filter(a => !a.querySelector('.tile-name')?.textContent.trim() || !a.querySelector('.tile-price')?.textContent.trim()).length;
      const longNames = tiles.map(a => a.querySelector('.tile-name')).filter(n => n && n.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(n).lineHeight) + 1)
        .map(n => `"${n.textContent.trim().slice(0, 20)}"`);
      // Everything Staci writes or picks sits in a band tagged with its part (data-part), so the admin's
      // preview can send her to the section a too-wide word is in. The preview used to guess from the
      // page's structure and filed the product tiles and every event after the first as the email's own layout.
      const tagged = (sel, part) => [...document.querySelectorAll(sel)].filter(el => el.closest('[data-part]')?.getAttribute('data-part') !== part).map(() => `${sel} not in ${part}`);
      const untagged = [...new Set([
        ...tagged('.tile-name', 'wall'), ...tagged('a[href*="utm_content=wall-"]', 'wall'),
        ...tagged('a[href*="utm_content=offer-button"]', 'offer'), ...tagged('a[href*="utm_content=story-"]', 'story'),
        ...tagged('[bgcolor="#2B7A96"]', 'events'), ...tagged('td.soard', 'mission'),
      ])];
      return {
        unlabeled, longNames, untagged,
        spill, codes,
        misaligned: drift,
        h: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth, off,
        small, dupes, noAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        broken: [...document.images].filter(i => !i.naturalWidth).length,
        headingsOk: heads.filter(x => x === 'H1').length === 1 && heads[0] === 'H1',
        offerY: offer ? Math.round(offer.getBoundingClientRect().bottom + scrollY) : null,
        // The sale's fine print goes under its button, never beside it (a floated button let it ride up)
        beside: Boolean(offer && document.querySelector('.fine') && document.querySelector('.fine').getBoundingClientRect().top < offer.getBoundingClientRect().bottom - 1),
      };
    }, [BRAND, CHARITY, r.mode === 'bare']);
    const name = f.split('/').pop().replace('.html', '');
    await page.screenshot({ path: join(root, 'shots', `${name}.${r.n}.png`), fullPage: true });
    const problems = [m.overflow && 'overflow', Object.keys(m.off).length && 'off-brand ' + JSON.stringify(m.off),
      m.small.length && 'small ' + m.small, m.dupes.length && 'duplicate links ' + m.dupes.length, m.noAlt && 'no alt',
      m.broken && 'broken images', !m.headingsOk && 'heading order', failed.length && 'failed ' + failed,
      fontsLoaded.length && `web fonts loaded where none may (${[...new Set(fontsLoaded)].join(', ')})`,
      m.untagged.length && 'not tagged with its part: ' + m.untagged.join(', '),
      m.misaligned.length && 'off the grid ' + m.misaligned.join(' '),
      m.codes.length && 'HTML codes showing as text ' + m.codes.join(' '),
      m.spill.length && 'text spilling out of its box ' + m.spill.join(' '),
      m.unlabeled && `${m.unlabeled} products without a name and price`,
      m.longNames.length && 'product names over two lines ' + m.longNames.join(' '),
      r.w < 600 && m.offerY > FIRST_SCREEN && `sale button below the first screen (${m.offerY}px)`,
      m.offerY === null && 'no sale button',
      m.beside && 'fine print beside the sale button, not under it'].filter(Boolean);
    if (problems.length) failures++;
    console.log(`${problems.length ? 'FAIL' : 'pass'}  ${name.padEnd(34)} ${r.n.padEnd(14)} ${(m.h / 700).toFixed(2)} screens  sale button ${m.offerY ?? '-'}px  ${problems.join('; ')}`);
    await ctx.close();
  }
  failures += await sweep(f, src);
}

/** "320–360, 374" from [320, 330, 340, 350, 360, 374]: the widths in SWEEP order, runs joined. */
function widths(ws) {
  const runs = [];
  for (const w of ws) {
    const last = runs.at(-1);
    if (last && SWEEP.indexOf(w) === SWEEP.indexOf(last[1]) + 1) last[1] = w;
    else runs.push([w, w]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ') + 'px';
}

/**
 * The sweep: one email laid out at every width in SWEEP, as sent, as Gmail shows it and bare, in both
 * engines. Fails on the email being wider than the screen, or text spilling out of its box (the same
 * two rules as the renders, and as the admin's preview). Photos are a blank stand-in: their width
 * comes from the email, so the layout across is the same and the sweep is quick.
 * @returns {Promise<number>} how many of its renders failed
 */
async function sweep(f, src) {
  const name = f.split('/').pop().replace('.html', '');
  let failing = 0;
  for (const [e, browser] of Object.entries(engines)) {
    for (const mode of Object.keys(MODES)) {
      const ctx = await browser.newContext({ viewport: { width: SWEEP[0], height: 844 } });
      if (mode !== 'sent') await ctx.route(/fonts\.(googleapis|gstatic)\.com/, x => x.abort());
      // fallback(), not continue(): continue() sends the request straight to the network, past the font
      // block, and the no-web-font sweeps loaded DM Sans
      await ctx.route(/^https?:\/\//, x => (x.request().resourceType() === 'image' ? x.fulfill({ status: 200, contentType: 'image/gif', body: BLANK }) : x.fallback()));
      const page = await ctx.newPage();
      await page.setContent(MODES[mode](src), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const bad = new Map();
      const loaded = mode === 'sent' ? [] : await webFontsIn(page);
      if (loaded.length) bad.set(`web fonts loaded where none may (${[...new Set(loaded)].join(', ')})`, [SWEEP[0]]);
      for (const w of SWEEP) {
        await page.setViewportSize({ width: w, height: 844 });
        const found = await page.evaluate(() => {
          const out = [];
          const wider = document.documentElement.scrollWidth - innerWidth;
          if (wider > 0) out.push(`the email is ${wider}px wider than the screen`);
          for (const t of document.querySelectorAll('p,h1,h2,.tile-name,.tile-price')) {
            if (t.getBoundingClientRect().width && t.scrollWidth > t.clientWidth + 1) out.push(`"${t.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)}" spills out of its box`);
          }
          return out;
        });
        for (const x of found) (bad.get(x) ?? bad.set(x, []).get(x)).push(w);
      }
      await ctx.close();
      const where = `${name.padEnd(34)} ${`sweep ${mode} ${e}`.padEnd(22)}`;
      if (bad.size) {
        failing++;
        console.log(`FAIL  ${where} ${[...bad].map(([x, ws]) => `${x} at ${widths(ws)}`).join('; ')}`);
      } else console.log(`pass  ${where} ${SWEEP.length} widths, ${SWEEP[0]}–${SWEEP.at(-1)}px`);
    }
  }
  return failing;
}
for (const b of Object.values(engines)) await b.close();
console.log(failures ? `\n${failures} failing renders` : '\nall renders pass');
process.exit(failures ? 1 : 0);
