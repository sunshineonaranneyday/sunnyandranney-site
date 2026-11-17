/**
 * No hover look sticks after a tap
 * ================================
 * A phone or iPad keeps :hover on whatever was tapped last, so a hover style shows there as a
 * stuck state: the weekly email's X (and the Undo that lands under the same finger) stayed in a
 * grey box after a tap. Every :hover in the admin's shared stylesheet and the weekly email page
 * sits inside @media (hover: hover), which only a mouse or trackpad matches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['../../layouts/AdminBase.astro', '../../components/email/email.css'];

/** The CSS in a file: an .astro file's <style> blocks, or the whole stylesheet, without comments. */
function cssOf(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const css = path.endsWith('.astro') ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : text;
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every rule whose selector has :hover, with the at-rules around it. */
export function hoverRules(css) {
  const out = [];
  const open = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      const prelude = css.slice(start, i).trim();
      open.push(prelude);
      if (!prelude.startsWith('@') && prelude.includes(':hover')) out.push({ selector: prelude, within: open.slice(0, -1) });
      start = i + 1;
    } else if (c === '}') {
      open.pop();
      start = i + 1;
    } else if (c === ';') start = i + 1;
  }
  return out;
}

const pointerOnly = (within) => within.some((p) => /^@media\b[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(p));

test('hoverRules finds a :hover and the at-rules around it', () => {
  const rules = hoverRules('.a:hover { color: red; } @media (hover: hover) { .b:hover { color: red; } } @media (min-width: 1px) { .c:hover { x: y } }');
  assert.deepEqual(
    rules.map((r) => [r.selector, pointerOnly(r.within)]),
    [['.a:hover', false], ['.b:hover', true], ['.c:hover', false]],
  );
});

for (const file of FILES) {
  test(`every :hover in ${file.split('/').pop()} is for a mouse only`, () => {
    const rules = hoverRules(cssOf(file));
    assert.ok(rules.length > 0, 'found no :hover at all: the scan is reading the wrong thing');
    const sticky = rules.filter((r) => !pointerOnly(r.within)).map((r) => r.selector);
    assert.deepEqual(sticky, [], `put these inside @media (hover: hover), or they stick after a tap on a phone or iPad`);
  });
}
