// Kit wraps the email in its own template, whose style block comes ahead of the email's
// (scripts/sunny-side/kit-wrapper.mjs). Its `table td { vertical-align:top; }` beat every bare valign:
// in Gmail on Nov 17, 2026 the issue date sat at the top of the masthead and "Shop all" 14px under
// its label. verify.mjs renders every email inside the wrapper and fails on anything it moves; these
// hold the rules that keep it from moving anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from './email.mjs';
import { inKit } from '../../../scripts/sunny-side/kit-wrapper.mjs';

const brief = (name) => JSON.parse(readFileSync(new URL(`../../../scripts/sunny-side/tests/${name}.json`, import.meta.url), 'utf8'));
const emails = ['edge-maximum', 'edge-reveal', 'edge-quiet-week', 'edge-mixed-days'].map((n) => [n, render(brief(n))]);

test('every cell aligned top, middle or bottom says so inline, where Kit’s style block can’t beat it', () => {
  for (const [name, html] of emails) {
    const cells = [...html.matchAll(/<td\b[^>]*>/g)].map((m) => m[0]).filter((td) => /\bvalign=/.test(td));
    assert.ok(cells.length > 5, `${name}: found no aligned cells, so the scan is reading the wrong thing`);
    for (const td of cells) {
      const valign = td.match(/\bvalign="(\w+)"/)[1];
      assert.match(td, new RegExp(`style="vertical-align:${valign};`), `${name}: ${td.slice(0, 90)}`);
    }
  }
});

test('the wrapper keeps the email whole: its style blocks come first, and the email’s own is still there after them', () => {
  const [, html] = emails[0];
  const wrapped = inKit(html);
  const blocks = [...wrapped.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.match(blocks[0], /table td \{ vertical-align:top; \}/);
  assert.ok(blocks.length > 3);
  assert.ok(wrapped.includes(html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1]), 'the email’s body is inside the wrapper as it was');
});

test('sections of color meet edge to edge, with white only under a photo, words or their own color', () => {
  for (const [name, html] of emails) {
    // The bands in order: each top-level row's background, and whether it's the white breather
    const bands = [...html.matchAll(/<tr><td(?: class="[^"]*")?(?: data-part="[^"]*")? bgcolor="(#[0-9A-Fa-f]{6})"[^>]*>(<div class="g40")?/g)].map((m) => ({ bg: m[1].toUpperCase(), gap: Boolean(m[2]) }));
    assert.ok(bands.length > 8 && bands.some((b) => b.bg !== '#FFFFFF'), `${name}: found too few bands, so the scan is reading the wrong thing`);
    for (let i = 1; i < bands.length - 1; i++) {
      if (!bands[i].gap) continue;
      const [above, below] = [bands[i - 1].bg, bands[i + 1].bg];
      assert.ok(above === '#FFFFFF' || above === below, `${name}: a white strip between ${above} and ${below}`);
    }
  }
});
