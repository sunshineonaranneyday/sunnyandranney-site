// Holds every collage layout (src/lib/sunny-side/collage-layouts.mjs) to its promise in real browser
// engines: Chromium (Gmail, Outlook.com, Android) and WebKit (Apple Mail, iOS), as sent, as Gmail shows
// it and bare (no style block, as the Gmail app shows a Yahoo, Outlook or iCloud account), at every width
// from 320 to 700px. At each, every photo's edges must sit on the collage's own edge or face another
// photo across a 4px gutter (within half a pixel), the collage must run the email's full width, and no
// photo may be stretched out of the shape it was asked for. A bento box drawn as nested tables misses by
// a pixel or two on a phone unless the shares are solved (solve()); this is the check that sees it.
// Photos are stand-ins of exactly the size each one asks the resizing for, so they lay out as the real
// ones do. Run on every pull request (.github/workflows/checks.yml).
import { chromium, webkit } from 'playwright';
import { LAYOUTS } from '../../src/lib/sunny-side/collage-layouts.mjs';
import { render } from '../../src/lib/sunny-side/email.mjs';
import { MODES, SWEEP } from './inboxes.mjs';

const GUTTER = 4;
const TOL = 0.5;
const brief = (n, layout) => ({
  send_date: '2026-11-17',
  story: {
    label: 'This week in the showroom',
    headline: 'Every layout',
    body: 'A line.',
    cta: ['Plan your visit', '/visit/'],
    layout,
    photos: Array.from({ length: n }, (_, k) => ({ src: `cf:collage-check/${k + 1}`, alt: `Photo ${k + 1}` })),
  },
});

/** A stand-in photo the size the email asked for (cf: ".../w=632,h=474,..." or resizing "width=632,height=474"). */
function standIn(url) {
  const m = url.match(/\bw(?:idth)?=(\d+),h(?:eight)?=(\d+)/);
  const [w, h] = m ? [m[1], m[2]] : [1, 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ccc"/></svg>`;
}

const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
let failing = 0;
let checked = 0;
for (const [e, browser] of Object.entries(engines)) {
  const ctx = await browser.newContext({ viewport: { width: SWEEP[0], height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
  await ctx.route(/^https?:\/\//, (x) => (x.request().resourceType() === 'image' ? x.fulfill({ status: 200, contentType: 'image/svg+xml', body: standIn(x.request().url()) }) : x.continue()));
  const page = await ctx.newPage();
  for (const [n, list] of Object.entries(LAYOUTS)) {
    for (const { id } of list) {
      const src = render(brief(Number(n), id), ['story']);
      for (const mode of Object.keys(MODES)) {
        await page.setViewportSize({ width: SWEEP[0], height: 900 });
        await page.setContent(MODES[mode](src), { waitUntil: 'load' });
        await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
        const bad = new Map();
        for (const w of SWEEP) {
          await page.setViewportSize({ width: w, height: 900 });
          const found = await page.evaluate(
            ([G, T]) => {
              const out = [];
              const imgs = [...document.images].filter((i) => /utm_content=story-photo-\d/.test(i.closest('a')?.getAttribute('href') ?? ''));
              const box = document.querySelector('table[style*="max-width:600px"]').getBoundingClientRect();
              const r = imgs.map((i) => i.getBoundingClientRect());
              const near = (a, b) => Math.abs(a - b) <= T;
              const L = Math.min(...r.map((q) => q.left)), R = Math.max(...r.map((q) => q.right));
              const Top = Math.min(...r.map((q) => q.top)), Bot = Math.max(...r.map((q) => q.bottom));
              if (!near(L, box.left) || !near(R, box.right)) out.push(`runs ${(L - box.left).toFixed(1)}–${(R - box.left).toFixed(1)}, not the full ${box.width}`);
              r.forEach((q, k) => {
                const v = (o) => o.top < q.bottom - 1 && o.bottom > q.top + 1;
                const h = (o) => o.left < q.right - 1 && o.right > q.left + 1;
                if (!near(q.right, R) && !r.some((o) => v(o) && near(o.left, q.right + G))) out.push(`photo ${k + 1}: right edge`);
                if (!near(q.left, L) && !r.some((o) => v(o) && near(o.right, q.left - G))) out.push(`photo ${k + 1}: left edge`);
                if (!near(q.bottom, Bot) && !r.some((o) => h(o) && near(o.top, q.bottom + G))) out.push(`photo ${k + 1}: bottom edge`);
                if (!near(q.top, Top) && !r.some((o) => h(o) && near(o.bottom, q.top - G))) out.push(`photo ${k + 1}: top edge`);
                const i = imgs[k];
                if (Math.abs(q.width / q.height - i.naturalWidth / i.naturalHeight) > 0.02) out.push(`photo ${k + 1}: stretched`);
              });
              return out;
            },
            [GUTTER, TOL],
          );
          checked++;
          for (const x of found) (bad.get(x) ?? bad.set(x, []).get(x)).push(w);
        }
        const where = `${`${n} ${id}`.padEnd(14)} ${`${mode} ${e}`.padEnd(16)}`;
        if (bad.size) {
          failing++;
          console.log(`FAIL  ${where} ${[...bad].map(([x, ws]) => `${x} at ${ws.length === SWEEP.length ? 'every width' : ws.join(', ') + 'px'}`).join('; ')}`);
        } else console.log(`pass  ${where} ${SWEEP.length} widths`);
      }
    }
  }
  await ctx.close();
}
for (const b of Object.values(engines)) await b.close();
console.log(failing ? `\n${failing} failing collages` : `\nevery collage lines up: ${checked} renders measured`);
process.exit(failing ? 1 : 0);
