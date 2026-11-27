/**
 * The first change on the weekly email page moves nothing
 * =======================================================
 * Loads the email page at phone to desktop widths, in Chromium and WebKit, types one letter into the
 * preview line (a plain text field, so nothing of the collage's own steadying is involved), then
 * presses Discard, and checks that the page below the top bar stayed exactly where it was both times.
 * On a phone, Save used to move from the top bar to the bottom of the screen at the first change, and the
 * bar closed up behind it and pushed the page up 56–85px; it now waits in the toolbar at the foot of the
 * screen from the start (src/lib/admin/first-change.test.mjs). Nothing is saved. Exits 1 if anything moved.
 *
 *   npx astro dev --config astro.local.config.mjs   (in another terminal)
 *   node scripts/check-email-first-change.mjs [http://localhost:4321/admin/email/]
 */
import { chromium, webkit } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4321/admin/email/';
let failed = 0;
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  for (const w of [320, 360, 375, 390, 430, 600, 700, 1024, 1440]) {
    const phone = w < 500;
    const page = await browser.newPage({ viewport: { width: w, height: 900 }, isMobile: phone && engine === chromium, hasTouch: phone });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.em-grid');
    await page.waitForTimeout(2000);
    // A finished section starts folded: open the subject line's, as Staci would
    const folded = page.locator('#em-lines.is-folded .em-section-toggle');
    if (await folded.count()) {
      await folded.click();
      await page.waitForTimeout(200);
    }
    const field = page.locator('.em-edit input[id*="preheader"]').first();
    await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    // Where the page under the top bar starts, on the page (scrolling can't hide a move)
    const top = () => page.evaluate(() => Math.round(document.querySelector('.em-grid').getBoundingClientRect().top + scrollY));
    const before = await top();
    await field.focus();
    await page.keyboard.type('x');
    await page.waitForTimeout(400);
    const changed = await top();
    await page.locator('.em-bar-save').getByRole('button', { name: 'Discard' }).click();
    await page.waitForTimeout(400);
    const discarded = await top();
    const moved = [changed - before, discarded - before].filter(Boolean);
    if (moved.length) {
      failed++;
      console.log(`${engine.name()} ${w}px: the page moved ${changed - before}px at the first change and ${discarded - before}px after Discard`);
    }
    await page.close();
  }
  await browser.close();
}
console.log(failed ? `${failed} width(s) moved` : `${url}: the first change and Discard move nothing, at 9 widths in Chromium and WebKit`);
process.exit(failed ? 1 : 0);
