// The email is written phones first: what must fit a 320px phone fits with the style block gone,
// as the Gmail app shows an email to a Yahoo, Outlook or iCloud account. verify.mjs renders it that
// way at every width on every pull request; these hold the rules that make it so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Email, SERIF, bareEmail, render, statSize } from './email.mjs';
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

test('where an inbox loads no web fonts (Gmail, Outlook), every serif falls back to one face, with every digit the same height', () => {
  // Peter, Nov 18, 2026, of the charity's numbers in Gmail: "the fonts (See the numbers ...": its numbers
  // fell back to Times New Roman under a headline in Georgia
  const reveal = JSON.parse(readFileSync(new URL('../../../scripts/sunny-side/tests/edge-reveal.json', import.meta.url), 'utf8'));
  for (const email of [html, render(reveal)]) {
    const serifs = [...email.matchAll(/font-family:\s*([^;"]*serif)[;"]/g)].map((m) => m[1].trim()).filter((f) => !/sans-serif/.test(f));
    assert.ok(serifs.length >= 4, 'the charity’s headline and numbers are in it');
    // One stack for its headlines and its numbers alike, so no inbox shows two serifs in one section
    assert.deepEqual([...new Set(serifs.filter((f) => !f.includes('!important')))], [SERIF]);
  }
  const faces = SERIF.split(',').map((f) => f.trim().replace(/'/g, ''));
  // What Gmail shows on a Mac or an iPhone, then on Windows, before Times New Roman; never Georgia, whose
  // old-style figures made "$0" read "$o" and dropped "295" below the line
  assert.deepEqual(faces, ['Libre Baskerville', 'Baskerville', 'Palatino Linotype', 'Palatino', 'Times New Roman', 'serif']);
  assert.doesNotMatch(html, /Georgia/);
  // Outlook for Windows: the same face as Gmail on Windows, for every serif, numbers too
  const mso = html.match(/<!--\[if mso\]><style>([\s\S]*?)<\/style><!\[endif\]-->/)[1];
  assert.match(mso, /\.soard-serif, \.soard-serif em \{ font-family: 'Palatino Linotype', Palatino, 'Times New Roman', serif !important; \}/);
  assert.match(html, /class="soard-stat soard-serif"/);
});

test('every band shows as much space over its first words as under its last, the 12px a link carries for a thumb taken off its padding', () => {
  // Peter, Nov 18, 2026: "so all the spacing is top tier", "check it all". verify.mjs measures it in every
  // render ("uneven space"); these hold the code that makes it so.
  const reveal = render(JSON.parse(readFileSync(new URL('../../../scripts/sunny-side/tests/edge-reveal.json', import.meta.url), 'utf8')));
  const computer = style.match(/@media \(min-width:621px\) \{([\s\S]*?)\n {2}\}/)[1];
  // The products' label and "Shop all" share the foot of their row, the link's 44px all over its words, so the
  // label sits 32 under the sale on a phone (4 + 28) and 40 on a computer (12 + 28), and 8 over its headline
  assert.match(html, /<td class="px pt-tap" data-part="wall" [^>]*padding:4px 20px 16px;">/);
  assert.match(computer, /\.pt-tap \{ padding-top:12px !important; \}/);
  assert.match(html, /valign="bottom" style="vertical-align:bottom;white-space:nowrap;padding-left:16px;font-size:0;line-height:0;"><a [^>]*padding:28px 0 0;[^>]*>Shop all/);
  assert.match(html, /Shop all &#8594;<\/a><\/td><\/tr><\/table><div style="height:8px;/);
  // Under the products, whose captions end with 24px of their own, 8 more white before a band of color (16 on a computer)
  assert.match(reveal, /tile-price[^]*?<div class="g16" style="height:8px;[^]*?data-part="reveal"/);
  assert.match(computer, /\.g16 \{ height:16px !important;/);
  // Ending in links: the events, their card, the reveal take the links' 12 off their own; events ending in
  // their card keep their 32 (40 on a computer)
  const series = render(JSON.parse(readFileSync(new URL('../../../scripts/sunny-side/tests/edge-big-tiers.json', import.meta.url), 'utf8')));
  assert.match(series, /<td class="px pt pb-tap" data-part="events" [^>]*padding:32px 20px 20px;">/);
  assert.match(html, /<td class="px pt pb" data-part="events" [^>]*padding:32px 20px 32px;">/);
  assert.match(computer, /\.pb-tap \{ padding-bottom:28px !important; \}/);
  assert.match(html, /border-radius:12px;padding:16px 16px 4px;/);
  assert.match(reveal, /<td class="px soard" data-part="reveal" [^>]*padding:28px 20px 16px;">/);
  // The charity's two sections open alike: 24 under the logo, 8 under the label, 24 from the headline to the photo
  for (const part of ['reveal', 'mission']) {
    const band = reveal.match(new RegExp(`data-part="${part}"[^]*?</td></tr>`))[0];
    assert.match(band, /alt="Sunshine on a Ranney Day"[^>]*><\/a><div style="height:24px;/, `${part}: 24 under the logo`);
    assert.match(band, /<\/h2><\/div><div style="height:24px;/, `${part}: 24 from the headline to the photo`);
  }
  // The footer's rule: as much white under it as over it
  assert.match(html, /class="rule-gap" style="[^"]*margin:0 0 32px;/);
  assert.match(computer, /\.rule-gap \{ margin-bottom:40px !important; \}/);
});

test('the charity’s three numbers each take a third of the column at every width, edge to edge, with no media query', () => {
  const strip = Email.statColumns(['1', '2', '3']);
  const shares = [...strip.matchAll(/class="stat" style="[^"]*width:([\d.]+)%;/g)].map((m) => Number(m[1]));
  assert.deepEqual(shares, [33.333, 33.333, 33.333]);
  assert.ok(shares.reduce((a, b) => a + b) <= 100, 'never more than the column, or the last would drop a line');
  assert.doesNotMatch(strip, /max-width/);
  assert.doesNotMatch(style, /\.stat \{/);
});

test('the charity’s numbers are as big as fits: 32px on a phone up to three digits, 24 past that, 40 on a computer', () => {
  assert.deepEqual(statSize(['310+', '218+', '$0']), [32, 36]);
  assert.deepEqual(statSize(['999+', '999+', '$0']), [32, 36]);
  // "2,480+" is 85px at 24px in Libre Baskerville Bold, of a 320px phone's 93px third; 113 at 32
  assert.deepEqual(statSize(['1,295+', '2,480+', '$0']), [24, 28]);
  const computer = style.match(/@media \(min-width:621px\) \{([\s\S]*?)\n {2}\}/)[1];
  assert.match(computer, /\.soard-stat \{ font-size:40px !important; line-height:44px !important; \}/);
  // edge-maximum's own numbers, as written
  assert.match(html, new RegExp(`class="soard-stat soard-serif" style="[^"]*font-size:${statSize([brief.mission.impact.rooms, brief.mission.impact.children, '$0'])[0]}px;`));
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
