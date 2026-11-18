/**
 * The admin's weekly email page runs in the order Staci decides things
 * =====================================================================
 * PAGE_SECTIONS (page-email.mjs) is the one list of the page's order: the subject line, the sale, the
 * products, the reveal, the photos, the events, the charity, Send (Peter, 2026-11-17). The page's sections, its error
 * list and "Before it can go" all follow it. Reading the page's source keeps this honest without a
 * browser: a section moved in EmailApp.tsx, or one added to it, fails here until the two agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PAGE_SECTIONS, sectionOf } from './page-email.mjs';
import { blankParts, checkParts } from './parts.mjs';
import { check } from './special.mjs';
import { checkWall } from './wall.mjs';

const page = readFileSync(new URL('../../components/email/EmailApp.tsx', import.meta.url), 'utf8');
const sections = [...page.matchAll(/<Section n=\{(\d+)\} id="([\w-]+)"/g)].map(([, n, id]) => ({ n: Number(n), id }));

test('the page’s sections are numbered 1, 2, 3… down the page', () => {
  assert.ok(sections.length >= 8, `found ${sections.length} sections: the pattern is reading the wrong thing`);
  assert.deepEqual(sections.map((s) => s.n), sections.map((_, k) => k + 1));
});

test('the page runs subject line, sale, products, reveal, photos, events, charity, Send', () => {
  // Peter, 2026-11-17: "subject, sale, products, reveal, photos, events, charity, send!!!!!! thats the fucking order"
  assert.deepEqual(PAGE_SECTIONS, ['em-lines', 'em-sale', 'em-products', 'em-reveal', 'em-photos', 'em-events', 'em-charity', 'em-send']);
  assert.deepEqual(sections.map((s) => s.id), PAGE_SECTIONS);
  assert.match(page, /<Section n=\{4\} id="em-reveal"[^>]* title="The reveal"/);
  assert.match(page, /<Section n=\{5\} id="em-photos"[^>]* title="Photos"/);
  // And no story: "i want the "story" fuckong gone"
  assert.doesNotMatch(page, /em-story|title="The story"/);
});

test('no field takes a section’s id, so an error’s link lands on one place', () => {
  const dir = new URL('../../components/email/', import.meta.url);
  const used = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/fieldId\('([\w.]+)'\)/g)].map(([, key]) => ({ f, id: `em-${key.replace(/[.]/g, '-')}` })));
  assert.ok(used.length > 5, 'found no fieldId calls: the pattern is reading the wrong thing');
  for (const { f, id } of used) assert.ok(!PAGE_SECTIONS.includes(id), `${f} gives a field the id ${id}, which is a section’s`);
});

test('every error the page can show belongs to a section, so its list runs in the page’s order', () => {
  const tiers = { kind: 'tiers', tiers: [{ spend: null, percent: null }, { spend: 5, percent: 900 }], ends: 'x' };
  const keys = [
    ...Object.keys(check({ kind: '' }, '2026-11-17')),
    ...Object.keys(check(tiers, '2026-11-17')),
    ...Object.keys(check({ kind: 'percent', percent: null, ends: '' }, '2026-11-17')),
    ...Object.keys(checkWall({ label: 'x'.repeat(200), headline: 'x'.repeat(200), picks: [{ handle: 'Not A Handle', photo: '', name: '' }] }, {})),
    ...Object.keys(checkParts({ ...blankParts(), subject: '', hero: 'gone', reveal: 'gone', story: { ...blankParts().story, link: 'https://example.com', photos: ['a', 'b', 'c', 'd', 'e', 'f'] } }, { photos: new Map(), kids: [], reveals: [], ready: true })),
    ...Object.keys(checkParts(blankParts(), { kids: [], ready: true })),
  ];
  for (const k of ['kind', 'tiers.0.spend', 'percent', 'ends', 'label', 'headline', 'picks.Not A Handle', 'subject', 'photos', 'story.photos', 'reveal', 'kid']) {
    assert.ok(keys.includes(k), `the checks didn’t make ${k}: the stand-ins above need changing`);
  }
  for (const k of keys) assert.ok(sectionOf(k), `${k} isn’t in any section: add it to FIELDS in page-email.mjs`);
  assert.equal(sectionOf('story.photos'), 'em-photos');
  assert.equal(sectionOf('story'), 'em-photos', 'a too-wide word in the photos part (Preview’s spill) goes to Photos');
  assert.equal(sectionOf('reveal'), 'em-reveal');
  assert.equal(sectionOf('tiers.1.percent'), 'em-sale');
});
