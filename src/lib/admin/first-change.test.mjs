/**
 * The first change on the weekly email page moves nothing
 * =======================================================
 * On a phone, Save used to leave the page's top bar for the bottom of the screen at the first change,
 * and the bar closed up behind it: everything below moved up 56px (85px under 375px wide), under the
 * finger that made the change, and after a drag iPhone Safari put the page back only at the next
 * touch and swallowed that tap (found 2026-11-17). Save and Preview now live in a toolbar at the foot
 * of a phone's screen from the start (email.css), so nothing has anywhere to move from.
 * `node scripts/check-email-first-change.mjs` checks the page itself in a browser at nine widths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = read('../../components/email/email.css');

/** The body of each @container block, with its condition. */
const containers = [...css.matchAll(/@container\s*\(([^)]*)\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => ({ when: m[1], body: m[2] }));

test('on a phone, Save is in the toolbar at the foot of the screen from the start, not only once there’s a change', () => {
  const phone = containers.filter((c) => /max-width:\s*600px/.test(c.when));
  assert.ok(phone.length > 0, 'found no phone rules: the scan is reading the wrong thing');
  assert.ok(
    phone.some((c) => /(^|\})\s*\.em-bar-save\s*\{[^}]*position:\s*fixed/.test(c.body)),
    'the toolbar rule is gone',
  );
});

test('nothing moves Save at the first change: no rule puts it somewhere else once something is unsaved', () => {
  for (const c of containers) {
    assert.doesNotMatch(c.body, /\.is-dirty[^{]*\.em-bar-save\s*\{[^}]*position/, `@container (${c.when}) moves Save at the first change`);
    assert.doesNotMatch(c.body, /\.is-dirty[^{]*\.em-bar\s*\{[^}]*(min-)?height/, `@container (${c.when}) changes the bar at the first change`);
  }
});

test('the page’s end clears the toolbar, so Schedule is never under it', () => {
  const phone = containers.find((c) => /max-width:\s*600px/.test(c.when) && /\.em-bar-save/.test(c.body));
  assert.match(phone.body, /\.em-grid\s*\{[^}]*padding-bottom:/);
});
