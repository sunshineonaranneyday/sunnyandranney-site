/**
 * The weekly email page on a phone
 * ================================
 * Loads the email page on an iPhone-sized touch screen (390x844, and 320x568) and fails on what made it
 * second-rate there before (found 2026-11-17):
 *
 *  - zoom:     a text field under 16px, which iPhone Safari zooms the whole page into when it's tapped,
 *              leaving the page's right edge (Save with it) off screen until pinched back;
 *  - target:   anything tapped smaller than 44px each way (Apple's Human Interface Guidelines), counting
 *              the area around it that still taps it;
 *  - sideways: the page scrolling sideways;
 *  - preview:  "See the preview" has to open the preview over the page, put focus in it, and close with
 *              Back or Escape, the page exactly where it was and focus back on the button; the preview's
 *              checks have to keep reporting while it's closed (its measuring frames still lay out);
 *  - length:   the page longer than 11 screens (it was 14.7, with the preview 11 screens down);
 *  - turned:   an iPad turned upright (1366 to 768 wide) has to show "See the preview", now the preview is a sheet.
 *
 * Nothing is typed or saved. Exits 1 with each problem.
 *
 *   npx astro dev --config astro.local.config.mjs   (in another terminal)
 *   node scripts/check-email-phone.mjs [http://localhost:4321/admin/email/]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4321/admin/email/';
const problems = [];
const browser = await chromium.launch();
for (const [w, h] of [
  [390, 844],
  [320, 568],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.em-section');
  await page.waitForTimeout(3000);
  const found = await page.evaluate(() => {
    const out = [];
    const H = innerHeight;
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert], dialog:not([open]), .visually-hidden, .em-measure');
    };
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.id || el.className).trim().replace(/\s+/g, ' ').slice(0, 50);
    const where = (el) => el.closest('.em-section')?.querySelector('h2')?.textContent ?? (el.closest('.em-bar') ? 'top bar' : 'page');
    for (const f of document.querySelectorAll('.em input:not([type=checkbox], [type=radio], [type=file], [type=range]), .em textarea, .em select')) {
      if (shown(f) && parseFloat(getComputedStyle(f).fontSize) < 16) out.push(`zoom     ${where(f)}: ${name(f)} is ${getComputedStyle(f).fontSize}`);
    }
    for (const t of document.querySelectorAll('.em button, .em a[href], .em label:has(input[type=checkbox]), .em label:has(input[type=radio]), .em summary, .em select')) {
      if (!shown(t)) continue;
      let r = t.getBoundingClientRect();
      if (r.width >= 44 && r.height >= 44) continue;
      t.scrollIntoView({ block: 'center' });
      r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const taps = [
        [cx - 21, cy],
        [cx + 21, cy],
        [cx, cy - 21],
        [cx, cy + 21],
      ].every(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return e && (e === t || t.contains(e));
      });
      if (!taps) out.push(`target   ${where(t)}: ${name(t)} is ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    scrollTo(0, 0);
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push(`sideways the page is ${document.documentElement.scrollWidth}px wide`);
    const screens = document.documentElement.scrollHeight / H;
    if (screens > 11 && H > 700) out.push(`length   the page is ${screens.toFixed(1)} screens long`);
    // The preview's checks report with the preview closed: its frames lay out out of sight
    const checks = [...document.querySelectorAll('.em-check')].map((c) => c.textContent);
    if (!checks.some((c) => /fits a small phone/i.test(c))) out.push(`preview  its checks didn't report with it closed: ${checks.join(' | ') || 'none'}`);
    return out;
  });
  problems.push(...found.map((p) => `${w}px ${p}`));

  // The preview, from the middle of the page: over the page, and back to the same spot
  await page.locator('#em-photos').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  const y0 = await page.evaluate(() => scrollY);
  await page.locator('.em-jump').tap();
  await page.waitForTimeout(600);
  const open = await page.evaluate(() => {
    const side = document.querySelector('.em-side');
    const r = side.getBoundingClientRect();
    return {
      visible: getComputedStyle(side).visibility === 'visible',
      covers: r.top <= 80 && r.bottom >= innerHeight - 1 && r.width >= innerWidth - 1,
      focus: document.activeElement?.classList.contains('em-side-back'),
      behindInert: document.querySelector('.em-edit').hasAttribute('inert'),
    };
  });
  if (!open.visible || !open.covers) problems.push(`${w}px preview  "See the preview" didn't open it over the page`);
  if (!open.focus) problems.push(`${w}px preview  focus didn't move to Back to editing`);
  if (!open.behindInert) problems.push(`${w}px preview  the page under it could still be reached`);
  await page.locator('.em-side-back').tap();
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ y: scrollY, focus: document.activeElement?.classList.contains('em-jump'), hidden: getComputedStyle(document.querySelector('.em-side')).visibility === 'hidden' }));
  if (!back.hidden) problems.push(`${w}px preview  Back to editing didn't close it`);
  if (back.y !== y0) problems.push(`${w}px preview  the page moved ${back.y - y0}px while it was open`);
  if (!back.focus) problems.push(`${w}px preview  focus didn't come back to "See the preview"`);
  await page.locator('.em-jump').tap();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if ((await page.evaluate(() => getComputedStyle(document.querySelector('.em-side')).visibility)) !== 'hidden') problems.push(`${w}px preview  Escape didn't close it`);
  await ctx.close();
}
// An iPad turned upright: the preview goes from beside the form to a sheet, and "See the preview" has to show
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('.em-section');
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(800);
  const shows = await page.evaluate(() => {
    const j = document.querySelector('.em-jump');
    const s = getComputedStyle(j);
    return s.display !== 'none' && s.visibility === 'visible' && s.opacity !== '0';
  });
  if (!shows) problems.push('768px preview  turned upright, "See the preview" stayed hidden');
  await ctx.close();
}
await browser.close();
for (const p of problems) console.log(p);
console.log(problems.length ? `${url}: ${problems.length} problem(s) on a phone` : `${url}: on a phone, no field zooms, every target is 44px, nothing scrolls sideways, and the preview opens over the page and back`);
process.exit(problems.length ? 1 : 0);
