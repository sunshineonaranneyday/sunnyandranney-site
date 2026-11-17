// The email is written phones first: what must fit a 320px phone fits with the style block gone,
// as the Gmail app shows an email to a Yahoo, Outlook or iCloud account. verify.mjs renders it that
// way at every width on every pull request; these hold the rules that make it so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Email, render } from './email.mjs';
import { cleanReport } from './layout-store.mjs';

const brief = JSON.parse(readFileSync(new URL('../../../scripts/sunny-side/tests/edge-maximum.json', import.meta.url), 'utf8'));
const html = render(brief);
// The main style block (Outlook's comes first, inside its own conditional comment)
const style = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].at(-1)[1];

test('the style block only makes things bigger: nothing a phone needs to fit hangs on a max-width query', () => {
  const queries = [...style.matchAll(/@media \(([a-z-]+):(\d+)px\) \{([\s\S]*?)\n {2}\}/g)].map((m) => ({ kind: m[1], px: Number(m[2]), rules: m[3] }));
  assert.deepEqual(
    queries.map((q) => `${q.kind}:${q.px}`),
    ['min-width:375', 'min-width:621', 'max-width:620'],
  );
  // The one max-width query only stretches buttons across a phone, which still fit without it
  const narrow = queries.find((q) => q.kind === 'max-width');
  assert.deepEqual([...narrow.rules.matchAll(/^\s*([^{]+?)\s*\{/gm)].map((m) => m[1]), ['.btn', '.btn a']);
});

test('Outlook for Windows, which reads no media query, gets the computer sizes in its own block', () => {
  const mso = html.match(/<!--\[if mso\]><style>([\s\S]*?)<\/style><!\[endif\]-->/)[1];
  const desktop = style.match(/@media \(min-width:621px\) \{([\s\S]*?)\n {2}\}/)[1];
  for (const cls of ['.px', '.pt', '.pb', '.h1', '.h2', '.mega', '.tile-cap', '.soard-stat', '.logo']) {
    assert.ok(desktop.includes(`${cls} {`), `${cls} grows on a computer`);
    assert.ok(mso.includes(`${cls} {`), `${cls} grows in Outlook`);
  }
});

test('inline, every size is a phone’s: 20px sides, 32px gaps, phone type', () => {
  const bare = html.replace(/<style[\s\S]*?<\/style>/g, '');
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
  assert.match(cols, /<!--\[if mso\]><td width="326" valign="middle" align="left"><!\[endif\]-->/);
});

test('two of the charity’s numbers fit across the smallest phone, three across a computer', () => {
  const strip = Email.statColumns(['1', '2', '3']);
  const phone = Number(strip.match(/max-width:(\d+)px/)[1]);
  assert.ok(2 * phone <= 320 - 2 * 20, `two at ${phone}px fit a 320px phone's 280px column`);
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
