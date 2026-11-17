/**
 * The admin's weekly email page runs in the email's own order
 * ============================================================
 * Staci works down the page the way a reader meets the email: the subject line first (what an
 * inbox shows), then each section of the email in SECTIONS order, and Send last. Reading the page's
 * source keeps this honest without a browser: a section moved in EmailApp.tsx, or a section added to
 * the email, fails here until the two agree again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS } from './email.mjs';

/** Which part of the email each section of the page sets up. Send sets up none. */
const PART = { 'em-lines': 'subject', 'em-photos': 'hero', 'em-sale': 'offer', 'em-products': 'wall', 'em-story': 'story', 'em-events': 'events', 'em-charity': 'mission', 'em-send': 'send' };

const page = readFileSync(new URL('../../components/email/EmailApp.tsx', import.meta.url), 'utf8');
const sections = [...page.matchAll(/<Section n=\{(\d+)\} id="([\w-]+)"/g)].map(([, n, id]) => ({ n: Number(n), id }));

test('the page’s sections are numbered 1, 2, 3… down the page', () => {
  assert.ok(sections.length >= 8, `found ${sections.length} sections: the pattern is reading the wrong thing`);
  assert.deepEqual(sections.map((s) => s.n), sections.map((_, k) => k + 1));
});

test('every section sets up a known part of the email', () => {
  for (const s of sections) assert.ok(PART[s.id], `${s.id} isn’t in PART: say which part of the email it sets up`);
});

test('the subject line comes first and Send last, with the email’s parts between in the email’s order', () => {
  const parts = sections.map((s) => PART[s.id]);
  assert.equal(parts[0], 'subject');
  assert.equal(parts.at(-1), 'send');
  const middle = parts.slice(1, -1);
  const emailOrder = SECTIONS.filter((x) => middle.includes(x));
  assert.deepEqual(middle, emailOrder, `the page has ${middle.join(', ')}; the email has ${SECTIONS.join(', ')}`);
});
