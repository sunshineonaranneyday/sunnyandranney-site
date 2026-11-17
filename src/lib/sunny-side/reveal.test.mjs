import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from './email.mjs';
import { easternParts, icsStart, listUpcomingReveals, revealCalendar, upcomingReveals } from './kids.mjs';
import { kitProblems } from './page-email.mjs';
import { briefParts, checkParts, cleanParts } from './parts.mjs';

// The charity's own calendar file for Dylan's reveal, as it served it on Nov 17, 2026 (shortened)
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:live-reveal-dylan-2026@sunshineonaranneyday.com\r\nDTSTAMP:20261117T153117Z\r\nDTSTART:20261118T210000Z\r\nDTEND:20261118T220000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const data = (o = {}) =>
  JSON.stringify({
    heroImage: 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/dylan-2026/1788202617604-dylanSOARD-23.jpeg/public',
    heroSummary: 'Dylan has MECP2 Duplication Syndrome. SOARD is building a therapy room so he can learn and grow.',
    roomTypes: ['Therapy Room'],
    publishStatus: 'published',
    ...o,
  });
const dylan = { slug: 'dylan-2026', name: 'Dylan', data: data() };
const max = { slug: 'max', name: 'Max', data: data({ roomTypes: ['Accessible Bathroom'] }) };

test('the start time comes from the charity’s calendar file, in the store’s time zone', () => {
  assert.equal(icsStart(ICS), '2026-11-18T21:00:00Z');
  assert.equal(icsStart('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), null);
  assert.deepEqual(easternParts('2026-11-18T21:00:00Z'), { day: '2026-11-18', long: 'Wednesday, November 18', short: 'Wed, Nov 18', time: '4:00 PM' });
  // 11:30 PM Eastern is still that day, though it's the next in UTC
  assert.equal(easternParts('2026-11-19T04:30:00Z').day, '2026-11-18');
});

test('only reveals still ahead that the charity has timed are offered, soonest first', () => {
  const starts = new Map([['max', '2026-11-20T21:00:00Z'], ['dylan-2026', '2026-11-18T21:00:00Z']]);
  assert.deepEqual(upcomingReveals([max, dylan], starts, '2026-11-17').map((r) => r.slug), ['dylan-2026', 'max']);
  assert.deepEqual(upcomingReveals([max, dylan], starts, '2026-11-19').map((r) => r.slug), ['max']);
  assert.deepEqual(upcomingReveals([max, dylan], new Map([['max', '2026-11-20T21:00:00Z']]), '2026-11-17').map((r) => r.slug), ['max']);
  assert.deepEqual(upcomingReveals([{ ...dylan, data: data({ publishStatus: 'draft' }) }], starts, '2026-11-17'), []);
  const [r] = upcomingReveals([dylan], starts, '2026-11-17');
  assert.equal(r.live, 'https://sunshineonaranneyday.com/live/dylan-2026/');
  assert.equal(r.room, 'Therapy Room');
  assert.equal(r.photo.src, 'cf:kids/dylan-2026/1788202617604-dylanSOARD-23.jpeg');
});

test('a reveal the charity’s site doesn’t answer for is left out, not shown without its time', async () => {
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [dylan, max] }) }) }) };
  const get = async (url) => (url.endsWith('kid=dylan-2026') ? new Response(ICS) : new Response('', { status: 500 }));
  assert.deepEqual((await listUpcomingReveals(db, '2026-11-17', get)).map((r) => r.slug), ['dylan-2026']);
  await assert.rejects(listUpcomingReveals(null, '2026-11-17', get), /isn’t connected/);
});

const reveals = upcomingReveals([dylan, max], new Map([['dylan-2026', '2026-11-18T21:00:00Z'], ['max', '2026-11-20T21:00:00Z']]), '2026-11-17');

test('the reveal is its own part: nothing to write for it, and a gone reveal says so', () => {
  const p = cleanParts({ subject: 'Hi', reveal: 'dylan-2026' });
  assert.equal(p.reveal, 'dylan-2026');
  assert.equal('reveal' in p.story, false);
  assert.equal(cleanParts({ reveal: '../x' }).reveal, '');
  assert.deepEqual(checkParts(p, { reveals, ready: true }), {});
  assert.match(checkParts(cleanParts({ reveal: 'zed' }), { reveals }).reveal, /isn’t coming up anymore/);
  assert.match(checkParts(cleanParts({ reveal: 'zed' }), { reveals: [] }).reveal, /didn’t load/);
  // Without the list (a save), only what's typed is checked
  assert.deepEqual(checkParts(cleanParts({ reveal: 'zed' }), {}), {});
});

test('a week saved while the reveal took the story’s place keeps both: the reveal, and the story with its photos', () => {
  // The Nov 17 week as saved: the story written, five photos, and Dylan's reveal inside the story
  const saved = { subject: 'Hi', story: { headline: 'Christmas is here.', body: 'The trees are up.', photos: ['aaaaaaaaaaaa1', 'aaaaaaaaaaaa2'], reveal: 'dylan-2026', layout: '' } };
  const p = cleanParts(saved);
  assert.equal(p.reveal, 'dylan-2026');
  assert.deepEqual(p.story.photos, ['aaaaaaaaaaaa1', 'aaaaaaaaaaaa2']);
  // A reveal saved in its own place wins over an old one left in the story
  assert.equal(cleanParts({ ...saved, reveal: '' }).reveal, '');
  const photos = new Map(p.story.photos.map((id) => [id, { id, w: 1800, h: 2400, alt: 'The tree', focus: '' }]));
  const brief = { send_date: '2026-11-17', ...briefParts(p, { sale: null, photos, reveals }) };
  assert.equal(brief.story.headline, 'Christmas is here.');
  assert.equal(brief.story.photos.length, 2);
  assert.equal(brief.reveal.name, 'Dylan');
  const html = render(brief, ['story', 'reveal']);
  // The story and its collage, then the invite, each tagged with its own part
  assert.ok(html.indexOf('Christmas is here.') < html.indexOf('Reveal Day'));
  assert.match(html, /utm_content=story-photo-2/);
  assert.match(html, /data-part="reveal"/);
});

test('the reveal opens with the charity’s logo, centered over the date and headline, as its own invite does', () => {
  const brief = { send_date: '2026-11-17', ...briefParts(cleanParts({ subject: 'Hi', reveal: 'dylan-2026' }), { sale: null, photos: new Map(), reveals }) };
  const html = render(brief, ['reveal']);
  const at = html.indexOf('data-part="reveal"');
  const logo = html.indexOf('brand-logo-dark-bg-tagline-display', at);
  assert.ok(at > -1 && logo > at, 'the logo is in the reveal');
  assert.ok(logo < html.indexOf('Reveal Day &middot;', at), 'above the date');
  assert.match(html, /utm_content=reveal-logo"[^>]*class="soard-mark"[^>]*><img class="soard-logo soard-mark" [^>]*width="96" height="90" alt="Sunshine on a Ranney Day"/);
  assert.match(html, /text-align:center;">Reveal Day &middot; Wed, Nov 18<\/p>/);
  assert.match(html, /<h2 class="soard-h soard-serif" [^>]*text-align:center;/);
});

test('a week can go with the reveal and no story, but a story started needs its words', () => {
  assert.deepEqual(checkParts(cleanParts({ subject: 'Hi', reveal: 'dylan-2026' }), { reveals, ready: true }), {});
  // Photos picked but nothing written: "Your headline" would go out
  const started = checkParts(cleanParts({ subject: 'Hi', reveal: 'dylan-2026', story: { photos: ['aaaaaaaaaaaa1'] } }), { reveals, ready: true });
  assert.ok(started['story.headline'] && started['story.body']);
  // No reveal: the story is the email's own words, so it's needed
  assert.ok(checkParts(cleanParts({ subject: 'Hi' }), { ready: true })['story.headline']);
});

test('a reveal before the send day stops the send', () => {
  const ok = { special: {}, wall: { picks: [1, 2, 3, 4] }, parts: cleanParts({ subject: 'Hi', reveal: 'dylan-2026' }), photos: new Map(), kids: [{ slug: 'a' }], reveals, catalog: null, check: () => ({}), checkWall: () => ({}), checkParts, sale: null };
  assert.deepEqual(kitProblems({ ...ok, send: '2026-11-17' }), []);
  assert.deepEqual(kitProblems({ ...ok, send: '2026-11-19' }), [{ text: 'Dylan’s reveal was Wed, Nov 18, before this email goes out. Pick another, or no reveal.', section: 'em-reveal' }]);
});

test('the invite: the charity’s day, time, room and calendar links, the live page, and never an address', () => {
  const brief = { send_date: '2026-11-17', ...briefParts(cleanParts({ reveal: 'dylan-2026' }), { sale: null, photos: new Map(), reveals }) };
  assert.ok(brief.reveal && !brief.story);
  const html = render(brief, ['story', 'reveal']);
  for (const words of ['Reveal Day &middot; Wed, Nov 18', 'Dylan&#8217;s <em', 'Wednesday, November 18<br>4:00 PM', 'Therapy Room', 'Email me when it starts']) assert.ok(html.includes(words), words);
  for (const app of ['google', '', 'outlook']) assert.ok(html.includes(`href="${revealCalendar('dylan-2026', app).replace(/&/g, '&amp;')}"`), app || 'apple');
  assert.match(html, /live\/dylan-2026\/\?utm_source=kit[^"]*utm_content=reveal-remind#remind"/);
  assert.doesNotMatch(html.slice(html.indexOf("<body")), /Oak Street|Hembree|Roswell|GA 30\d{3}/);
  // Every link is its own, so Kit's report tells them apart
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
