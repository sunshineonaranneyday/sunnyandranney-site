/**
 * The phone's top bar and slide-in menu against the pages under them (AdminBase.astro):
 *
 *  - A page's sticky bar stops under the top bar: its top is --topbar (0 beside a desktop
 *    sidebar), or something built on it. A bar stuck at top: 0 slid over the top bar and its
 *    menu button on an upright iPad (the weekly email's, found in review 2026-11-16).
 *  - Nothing on a page is drawn above the open menu, which is z-index 200 while the page under
 *    it is inert. A schedule editor at 40 stayed bright over it and took taps meant for it.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const SRC = new URL('../../', import.meta.url);
/** Where the admin's pages and their parts live. The public site has layers of its own. */
const ADMIN = ['pages/admin/', 'components/admin/', 'components/buying/', 'components/email/', 'components/schedule/', 'lib/sales-tax/'];

function files(dir) {
  return readdirSync(new URL(dir, SRC)).flatMap((name) => {
    const path = `${dir}${name}`;
    if (statSync(new URL(path, SRC)).isDirectory()) return files(`${path}/`);
    return /\.(astro|css|ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const SOURCES = ADMIN.flatMap(files).map((path) => ({ path, text: readFileSync(new URL(path, SRC), 'utf8') }));
const LAYOUT = readFileSync(new URL('layouts/AdminBase.astro', SRC), 'utf8');

/** Each CSS rule body in a file, as written: what's between one { and its }. */
const rules = (text) => [...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);

test('every sticky bar on an admin page stops under the top bar', () => {
  const stuck = [];
  for (const { path, text } of SOURCES) {
    for (const body of rules(text)) {
      if (!/position:\s*sticky/.test(body)) continue;
      const top = body.match(/(?:^|[;\s])top:\s*([^;]+)/)?.[1]?.trim();
      // A bar held to the bottom, or partway down the screen, never meets the top bar.
      if (top === undefined || /vh\b/.test(top)) continue;
      if (!/var\(--(topbar|sticky-top)\b/.test(top)) stuck.push(`${path}: top: ${top}`);
    }
  }
  assert.deepEqual(stuck, [], 'these stick at the very top, under the phone top bar; build their top on var(--topbar, 0px)');
});

test('--sticky-top, which the schedule sticks to, is the top bar at every width', () => {
  const schedule = SOURCES.find((file) => file.path === 'components/schedule/schedule.css').text;
  const sets = [...schedule.matchAll(/--sticky-top:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(sets, ['var(--topbar, 0px)']);
});

test('nothing on an admin page is drawn above the open menu', () => {
  const open = Number(LAYOUT.match(/html\.menu-open \.sidebar \{ z-index: (\d+); \}/)?.[1]);
  assert.ok(open > 0, 'the layout no longer raises the open menu');
  const above = [];
  for (const { path, text } of SOURCES) {
    for (const m of text.matchAll(/z-?[iI]ndex['"]?:\s*['"]?(\d+)/g)) if (Number(m[1]) >= open) above.push(`${path}: z-index ${m[1]}`);
  }
  assert.deepEqual(above, [], `these would be drawn over the open menu (z-index ${open})`);
});

test('the top bar is one height everywhere it is measured from', () => {
  // The bar's own height and the variable everything lines up with are the same rule.
  assert.match(LAYOUT, /:root \{ --topbar: calc\(69px \+ env\(safe-area-inset-top, 0px\)\); \}\s*\.sidebar \{ min-height: var\(--topbar\); z-index: 30; \}/);
  assert.match(LAYOUT, /\.side-menu \{\s*position: fixed;\s*top: var\(--topbar\);/);
  assert.match(LAYOUT, /inset: var\(--topbar\) 0 0;/);
});
