/**
 * The first change on the weekly email page moves nothing
 * =======================================================
 * On a phone, Save leaves the page's top bar for the bottom of the screen once there's something to
 * save. The bar used to close up behind it, so the first change pushed everything below up 56px (85px
 * under 375px wide), under the finger that made it; after a drag, iPhone Safari put the page back only
 * at the next touch and swallowed that tap (found 2026-11-17). The bar now keeps the height it had with
 * Save in it: mount.ts measures it while nothing is unsaved (--em-bar-h), and email.css holds the bar
 * at that height wherever Save is moved out of it. `node scripts/check-email-first-change.mjs` checks
 * the page itself in a browser at nine widths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = read('../../components/email/email.css');
const mount = read('../../components/email/mount.ts');

/** The body of each @container block, with its condition. */
const containers = [...css.matchAll(/@container\s*\(([^)]*)\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => ({ when: m[1], body: m[2] }));

test('wherever Save leaves the top bar, the bar keeps its height', () => {
  const moves = containers.filter((c) => /\.em\.is-dirty \.em-bar-save\s*\{[^}]*position:\s*fixed/.test(c.body));
  assert.ok(moves.length > 0, 'found no rule that moves Save out of the bar: the scan is reading the wrong thing');
  for (const c of moves) {
    assert.match(c.body, /\.em\.is-dirty \.em-bar\s*\{[^}]*min-height:\s*var\(--em-bar-h\b/, `@container (${c.when}) moves Save out of the bar without holding the bar's height`);
  }
});

test('the page measures the bar while nothing is unsaved', () => {
  assert.match(mount, /keepBarHeight\(\)/, 'mountEmail no longer starts the measuring');
  assert.match(mount, /is-dirty/, 'the measuring has to skip the bar while Save is out of it');
  assert.match(mount, /setProperty\('--em-bar-h'/);
  assert.match(mount, /new ResizeObserver/, 'the bar changes height with its words and the screen');
});
