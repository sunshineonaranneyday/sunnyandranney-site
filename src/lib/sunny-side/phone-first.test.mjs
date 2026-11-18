// The email is written phones first: what must fit a 320px phone fits with the style block gone,
// as the Gmail app shows an email to a Yahoo, Outlook or iCloud account. verify.mjs renders it that
// way at every width on every pull request; these hold the rules that make it so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Email, bareEmail, render } from './email.mjs';
import { cleanReport } from './layout-store.mjs';

const brief = JSON.parse(readFileSync(new URL('../../../scripts/sunny-side/tests/edge-maximum.json', import.meta.url), 'utf8'));
const html = render(brief);
// The main style block (Outlook's comes first, inside its own conditional comment)
const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].at(-1)[1];

test('the style block only makes things bigger: no max-width query, so nothing a phone needs hangs on one', () => {
  const queries = [...style.matchAll(/@media \(([a-z-]+):(\d+)px\) \{([\s\S]*?)\n {2}\}/g)].map((m) => ({ kind: m[1], px: Number(m[2]), rules: m[3] }));
  assert.deepEqual(
    queries.map((q) => `${q.kind}:${q.px}`),
    ['min-width:375', 'min-width:621'],
  );
});

test('a button fills its row inline, on a phone with or without the style block; a computer and Outlook get its own width', () => {
  const bare = bareEmail(html);
  // Everyone but Outlook: a full-width table and a block link, as a phone shows it
  assert.match(bare, /<!--\[if !mso\]><!--><table [^>]*class="btn" style="border-collapse:separate;width:100%;"><!--<!\[endif\]-->/);
  assert.match(bare, /class="btn"[^]*?<a href="[^"]*" target="_blank" style="display:block;text-align:center;/);
  // Outlook: a table of the shape's own width, or the color would fill the row around it
  assert.match(html, /<!--\[if mso\]><table [^>]*class="btn" style="border-collapse:separate;"><!\[endif\]-->/);
  // A computer gives it its own width back
  const desktop = style.match(/@media \(min-width:621px\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(desktop, /\.btn \{ width:auto !important; \}/);
  assert.match(desktop, /\.btn a \{ display:inline-block !important; \}/);
});

test('Outlook for Windows, which reads no media query, gets the computer sizes in its own block', () => {
  const mso = html.match(/<!--\[if mso\]><style>([\s\S]*?)<\/style><!\[endif\]-->/)[1];
  const desktop = style.match(/@media \(min-width:621px\) \{([\s\S]*?)\n {2}\}/)[1];
  for (const cls of ['.px', '.pt', '.pb', '.h1', '.h2', '.mega', '.tile-cap', '.soard-stat', '.logo']) {
    assert.ok(desktop.includes(`${cls} {`), `${cls} grows on a computer`);
    assert.ok(mso.includes(`${cls} {`), `${cls} grows in Outlook`);
  }
});

test('bare is one thing everywhere: no style block, no web fonts, the inline styles only', () => {
  const bare = bareEmail(html);
  assert.doesNotMatch(bare, /<style/);
  assert.doesNotMatch(bare, /fonts\.googleapis\.com/);
  assert.ok(html.includes('fonts.googleapis.com'), 'the email as sent links its fonts');
  // The rest is the email as sent, byte for byte
  assert.equal(bare.length, html.length - [...html.matchAll(/<style[\s\S]*?<\/style>/g)].reduce((n, m) => n + m[0].length, 0) - html.match(/<!--\[if !mso\]><!--><link href="https:\/\/fonts[^>]*><!--<!\[endif\]-->/)[0].length);
});

test('inline, every size is a phone’s: 20px sides, 32px gaps, phone type', () => {
  const bare = bareEmail(html);
  assert.doesNotMatch(bare, /padding:\d+px 32px/, 'no band keeps a computer’s 32px sides inline');
  assert.doesNotMatch(bare, /padding:40px/, 'no band keeps a computer’s 40px inline');
  assert.match(bare, /class="mega" style="[^"]*font-size:76px;/);
  assert.match(bare, /class="h2" style="[^"]*font-size:26px;/);
  assert.match(bare, /class="logo" src="[^"]*" width="150" height="60" alt="Sunny &amp; Ranney" style="display:block;width:120px;/);
});

test('side by side columns stack on a phone with no media query, and never hold a phone open', () => {
  const cols = Email.fabFour([
    { html: 'a', width: 326 },
    { html: 'b', width: 210, align: 'right' },
  ]);
  // A pixel min-width beats max-width:100%, so 326px held a 280px phone's column open (Nov 16, 2026)
  assert.doesNotMatch(cols, /min-width:\d+px/);
  const shares = [...cols.matchAll(/min-width:([\d.]+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual(shares, [60.82, 39.17]);
  assert.ok(shares.reduce((a, b) => a + b) <= 100);
  // Full width under 536px of room, its own width from there: (536px - 100%) * 536, written without parentheses
  assert.equal((cols.match(/width:100%;width:calc\(287296px - 53600%\)/g) || []).length, 2);
  // Outlook gets the columns as a table
  assert.match(cols, /<!--\[if mso\]><td width="326" align="left" valign="middle" style="vertical-align:middle;"><!\[endif\]-->/);
  // No gap asked for, no spacer
  assert.doesNotMatch(cols, /fab-gap/);
});

test('a gap between side by side columns is there only while they stack, with no media query', () => {
  const cols = Email.fabFour([{ html: 'a', width: 326 }, { html: 'b', width: 210 }], 536, { gap: 24 });
  const spacers = cols.match(/<div class="fab-gap" style="([^"]*)"><\/div>/g) || [];
  assert.equal(spacers.length, 1, 'one spacer, between the two columns');
  // The whole row while stacked, nothing once side by side (the columns' own calc), 24px tall
  assert.match(spacers[0], /min-width:0;max-width:100%;width:100%;width:calc\(287296px - 53600%\);height:24px;/);
  // Not for Outlook, whose columns are a table
  assert.match(cols, /<!--\[if !mso\]><!--><div class="fab-gap"[^]*?<\/div><!--<!\[endif\]-->/);
  // The visit row uses it, and nothing hides it with a media query any more
  assert.equal((html.match(/class="fab-gap"/g) || []).length, 1);
  assert.doesNotMatch(html, /visit-gap/);
});

test('the charity’s three numbers fit across the smallest phone and a computer', () => {
  const strip = Email.statColumns(['1', '2', '3']);
  const phone = Number(strip.match(/max-width:(\d+)px/)[1]);
  assert.ok(3 * phone <= 320 - 2 * 20, `three at ${phone}px fit a 320px phone's 280px column`);
  const desktop = Number(style.match(/\.stat \{ max-width:(\d+)px/)[1]);
  assert.ok(3 * desktop <= 536, `three at ${desktop}px fit a computer's 536px column`);
});

test('a layout report is a word, how far over, at a phone width, for a send date; anything else is refused', () => {
  assert.deepEqual(cleanReport({ word: '  makeovers ', over: 2.4, width: 320, send: '2026-11-17' }), { word: 'makeovers', over: 2, width: 320, send: '2026-11-17' });
  assert.equal(cleanReport({ word: '', over: 2, width: 320, send: '2026-11-17' }), null);
  assert.equal(cleanReport({ word: 'x', over: 0, width: 320, send: '2026-11-17' }), null);
  assert.equal(cleanReport({ word: 'x', over: 2, width: 1200, send: '2026-11-17' }), null);
  assert.equal(cleanReport({ word: 'x', over: 2, width: 320, send: 'Tuesday' }), null);
  assert.equal(cleanReport(null), null);
  assert.equal(cleanReport({ word: 'y'.repeat(100), over: 2, width: 320, send: '2026-11-17' }).word.length, 60);
});

test('a word reported again keeps its first sighting and counts up, and the page gets the row as it stands', async () => {
  const { Miniflare } = await import('miniflare');
  const { noteReport, listReports } = await import('./layout-store.mjs');
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: 'layout-report-test' } });
  try {
    const DB = await mf.getD1Database('DB');
    const first = await noteReport(DB, { word: 'makeovers', over: 2, width: 320, send: '2026-11-17', by: 'staci@store.test', now: '2026-11-17T10:00:00.000Z' });
    assert.equal(first.times, 1);
    // The owner opens the page later and the preview measures it again: 8 times, first seen at 10:00
    let row = first;
    for (let i = 0; i < 7; i++) row = await noteReport(DB, { word: 'makeovers', over: 3, width: 390, send: '2026-11-17', by: 'owner@store.test', now: `2026-11-17T1${i}:30:00.000Z` });
    assert.deepEqual(row, { word: 'makeovers', over: 3, width: 390, send: '2026-11-17', seenBy: 'owner@store.test', firstSeen: '2026-11-17T10:00:00.000Z', lastSeen: '2026-11-17T16:30:00.000Z', times: 8 });
    assert.deepEqual(await listReports(DB), [row], 'what the page shows is what the server has');
  } finally {
    await mf.dispose();
  }
});

test('a whole-email overflow wider than 600px is still noted, at 600', () => {
  assert.deepEqual(cleanReport({ word: 'the email', over: 1450, width: 320, send: '2026-11-17' }), { word: 'the email', over: 600, width: 320, send: '2026-11-17' });
});
