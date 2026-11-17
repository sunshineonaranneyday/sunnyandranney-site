import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { Email, lines, plain, render, usePhotoOrigin } from './email.mjs';
import { broadcastUrl, cancel, kitClient, readyTester, schedule, sendTest, sentEmail, sentEmails, statusOf, subscriberCount, templateFor, usualTime } from './kit.mjs';
import { KID_PHOTOS, cfIdOf, kidFor, missionOf, photosDate, photosOf, revealedKids, roomsPhrase } from './kids.mjs';
import { cleanEvent, toBriefEvent } from './events.mjs';
import { kitProblems, pageEmail } from './page-email.mjs';
import { DEFAULT_HERO, arrangeCollage, blankParts, briefParts, checkParts, cleanParts, linesOf } from './parts.mjs';
import { addPhoto, isJpeg, listPhotos, newPhotoId, photosByIds, setAlt } from './photo-store.mjs';
import { check, clean, draftSale, toSale } from './special.mjs';
import { addPerson, listPeople, logTest, recentTests, removePerson, testsSince } from './test-store.mjs';
import { TEST_MAX, checkPerson, cleanPerson, namesOf, testPeople, testRecipients } from './testers.mjs';
import { checkWall, cleanWall } from './wall.mjs';

const SITE = 'https://sunnyandranney.com';
const SEND = '2026-11-17';
const special = clean({ kind: 'percent', percent: 20, what: 'everything', ends: '2026-11-29' });
const sale = draftSale(special);
const item = (handle) => ({ handle, name: handle, title: handle, price: 100, was: null, qty: 2, added: '2026-01-01', kind: 'Chairs', type: '', collections: [], photos: [{ url: `https://cdn.shopify.com/s/files/1/0930/2117/6092/files/${handle}.jpg?v=1`, w: 1000, h: 1000 }], rank: null, staffPick: false });
const catalog = new Map(['a', 'b', 'c', 'd'].map((h) => [h, item(h)]));
const wallOf = (n) => cleanWall({ picks: [...catalog.values()].slice(0, n).map((p) => ({ handle: p.handle, photo: p.photos[0].url, name: '' })) });
const ids = ['aaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaa2', 'aaaaaaaaaaaaaaaa3', 'aaaaaaaaaaaaaaaa4', 'aaaaaaaaaaaaaaaa5', 'aaaaaaaaaaaaaaaa6'];
const photos = new Map(ids.map((id, k) => [id, { id, w: k === 2 ? 2400 : 1600, h: k === 2 ? 1200 : 2000, alt: `Photo ${k + 1}` }]));
const story = (n, extra = {}) => cleanParts({ subject: 'Christmas is in store! Save up to {upto}', hero: ids[0], story: { headline: 'Christmas is here.', body: 'The trees are up.', photos: ids.slice(0, n) }, ...extra });
const impact = { rooms: '233', children: '284' };
// The charity's kids as its database keeps them (made up here, in the same shape)
const kidRow = (slug, o = {}) => ({
  slug,
  name: o.name ?? slug[0].toUpperCase() + slug.slice(1),
  status: o.status ?? 'completed',
  data: JSON.stringify({
    publishStatus: o.publish ?? 'published',
    heroImage: o.hero === undefined ? `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/${slug}/${o.stamp ?? '1780000000000'}-a.jpg/public` : o.hero,
    heroSummary: o.summary ?? `${slug} got a new room.`,
    roomTypes: o.rooms ?? ['Accessible Bathroom'],
    photos: [{ url: `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/${slug}/${o.stamp ?? '1780000000000'}-a.jpg/public`, alt: o.alt ?? '' }],
  }),
});
const kids = revealedKids([kidRow('ava', { stamp: '1791000000000' }), kidRow('ben', { stamp: '1785000000000' })], [], '2026-11-16');

test('the whole email from the admin: every part in order, the store’s photos through the resizing', () => {
  const e = pageEmail({ sale, wall: wallOf(4), parts: story(3), photos, kids, catalog, events: [], impact, send: SEND, site: SITE });
  assert.deepEqual(e.sections, ['masthead', 'hero', 'offer', 'wall', 'story', 'mission', 'visit', 'footer']);
  const html = render(e.brief, e.sections);
  assert.match(html, /<title>Christmas is in store! Save up to 20%<\/title>/);
  assert.match(html, /mso-hide:all;">20% off everything\./); // an empty preview line says the sale
  assert.ok(html.includes(`src="https://shop.sunnyandranney.com/cdn-cgi/image/width=1200,height=600,fit=cover,gravity=auto,quality=64,format=jpeg/${SITE}/media/email/${ids[0]}.jpg/"`));
  assert.match(html, /alt="Photo 1"/);
  assert.match(html, /Christmas is&nbsp;here\./);
  assert.match(html, /utm_content=story-photo-3/);
  assert.match(html, />233</); // the charity's numbers
  // Kit fills one thing, the unsubscribe link's address, which only it can make for each subscriber.
  // Nothing else is left for Kit: a {{ tag }} anywhere a reader sees it showed as those words in the
  // Nov 16, 2026 test ("{{ address }}"), and in the admin's preview.
  assert.deepEqual([...html.matchAll(/\{\{[^}]*\}\}|\{%[^%]*%\}/g)].map((m) => m[0]), ['{{ unsubscribe_url }}']);
  assert.match(html, /href="\{\{ unsubscribe_url \}\}"[^>]*>Unsubscribe</);
  const shown = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(shown, /\{\{|\{%/, 'no Kit tag shows as text');
  assert.match(shown, /Sunny &amp; Ranney &middot; 109A Oak Street, Roswell, GA&nbsp;30075/); // the store's mailing address, written in
  // Nothing written yet: the store's wide shot, no story, the charity's most recent reveal
  const bare = pageEmail({ sale, wall: wallOf(4), parts: blankParts(), photos, kids, catalog, events: [], impact: null, send: SEND, site: SITE });
  assert.deepEqual(bare.sections, ['masthead', 'hero', 'offer', 'wall', 'mission', 'visit', 'footer']);
  assert.equal(bare.brief.hero, DEFAULT_HERO);
  assert.equal(bare.brief.mission.url, 'https://sunshineonaranneyday.com/kids/ava/');
  // No kids loaded: no charity section rather than a made-up one
  assert.ok(!pageEmail({ sale, wall: null, parts: blankParts(), photos, kids: [], catalog, events: [], impact, send: SEND, site: SITE }).sections.includes('mission'));
  // A subject promising more than the sale still draws (the field says why)
  assert.equal(pageEmail({ sale, wall: null, parts: cleanParts({ subject: '50% off!' }), photos, kids, catalog, events: [], impact, send: SEND, site: SITE }).brief.subject, 'The Sunny Side');
});

test('the collage lays out 1 to 5 photos edge to edge: one wide, then rows of two or three', () => {
  const cells = (n) => {
    const html = render(pageEmail({ sale, wall: null, parts: story(n), photos, kids, catalog: null, events: [], impact, send: SEND, site: SITE }).brief, ['story']);
    return [...html.matchAll(/width="(\d+)" height="(\d+)" alt="Photo/g)].map((m) => `${m[1]}x${m[2]}`);
  };
  assert.deepEqual(cells(1), ['600x300']);
  assert.deepEqual(cells(2), ['298x298', '298x298']);
  assert.deepEqual(cells(3), ['600x300', '298x298', '298x298']);
  assert.deepEqual(cells(4), ['600x300', '197x197', '197x197', '197x197']);
  assert.deepEqual(cells(5), ['600x300', '298x298', '298x298', '298x298', '298x298']);
  // The widest photo leads when arranged
  assert.equal(arrangeCollage(ids.slice(0, 4), photos)[0], ids[2]);
  assert.deepEqual(arrangeCollage(ids.slice(0, 2), photos), ids.slice(0, 2));
});

test('the parts are checked: lengths, links, the subject against the sale, alt text, and what the finished email needs', () => {
  const ok = story(2);
  assert.deepEqual(checkParts(ok, { sale, photos, ready: true }), {});
  assert.match(checkParts(cleanParts({ subject: 'Half off everything: 50% off!' }), { sale }).subject, /It says .*50%/);
  assert.match(checkParts(cleanParts({ subject: 'x'.repeat(81) }), {}).subject, /81 characters; keep it to 80/);
  const empty = checkParts(blankParts(), { sale, ready: true });
  assert.ok(empty.subject && empty['story.headline'] && empty['story.body']);
  assert.match(checkParts(cleanParts({ story: { link: 'https://evil.com' } }), {})['story.link'], /page on sunnyandranney\.com/);
  assert.match(checkParts(cleanParts({ story: { photos: ids } }), {})['story.photos'], /5 photos at most\. Take 1 out/);
  assert.match(checkParts(cleanParts({ hero: 'zzzzzzzzzzzzzzzz' }), { photos }).photos, /isn’t in the library/);
  const noAlt = new Map(photos);
  noAlt.set(ids[0], { ...photos.get(ids[0]), alt: '' });
  assert.match(checkParts(ok, { photos: noAlt }).photos, /need.* a few words/);
  // The charity section is picked, never written: only a kid's slug is kept
  assert.equal(cleanParts({ kid: 'ava', mission: { story: 'typed' } }).kid, 'ava');
  assert.equal(cleanParts({ kid: '../x' }).kid, '');
  assert.match(checkParts(cleanParts({ kid: 'zed' }), { kids }).kid, /isn’t on the charity’s site anymore/);
  assert.match(checkParts(blankParts(), { kids: [] }).kid, /didn’t load/);
  assert.deepEqual(linesOf(cleanParts({ subject: 'Save {upto}', preheader: '' }), sale), { subject: 'Save 20%', preheader: '20% off everything.' });
  // A week with no sale: {upto} or {offer} is a field to fix, never a crash; an empty preview line
  // stays empty, so the subject goes out as written
  const quiet = toSale(clean({ kind: 'headline', headline: 'Christmas décor is in.' }));
  assert.match(checkParts(cleanParts({ subject: 'Save up to {upto}' }), { sale: quiet }).subject, /no sale, so \{upto\} has nothing to say/);
  assert.match(checkParts(cleanParts({ subject: 'Hi', preheader: '{offer} today' }), { sale: quiet }).preheader, /no sale, so \{offer\} has nothing to say/);
  assert.deepEqual(checkParts(cleanParts({ subject: 'Christmas décor is in' }), { sale: quiet }), {});
  assert.deepEqual(linesOf(cleanParts({ subject: 'Christmas décor is in', preheader: '' }), quiet), { subject: 'Christmas décor is in', preheader: '' });
  const quietEmail = pageEmail({ sale: quiet, wall: null, parts: cleanParts({ subject: 'Christmas décor is in' }), photos: new Map(), kids, catalog: null, events: [], impact: null, send: '2026-11-17', site: 'https://sunnyandranney.com' });
  assert.equal(quietEmail.brief.subject, 'Christmas décor is in', 'the subject as written, not the fallback');
  // Only known fields, photo ids shaped like ids
  assert.deepEqual(cleanParts({ hero: '../etc', story: { photos: ['x', ids[0], ids[0]] }, extra: 1 }).story.photos, [ids[0]]);
});

test('an email going later in its week is checked and drawn as of that day', () => {
  // The Nov 17 email going Thursday, Nov 19: Wednesday's event date has passed by then
  const ev = cleanEvent({ id: 'late-nights-2026', title: 'Late shopping nights', start: '17:00', end: '20:00', dates: [{ date: '2026-11-18', what: 'Wine and wrapping' }, { date: '2026-11-25', what: 'Cocoa' }] });
  const draw = (day) => render(...Object.values((({ brief, sections }) => ({ brief, sections }))(pageEmail({ sale, wall: wallOf(4), parts: story(1), photos, kids, catalog, events: [toBriefEvent(ev, day, SITE)], impact, send: day, site: SITE }))));
  assert.match(draw('2026-11-17'), /Wine and(&nbsp;| )wrapping/);
  const thursday = draw('2026-11-19');
  assert.doesNotMatch(thursday, /Wine and(&nbsp;| )wrapping/);
  assert.match(thursday, /Cocoa/);
  assert.match(thursday, /Nov 19, 2026|November 19/); // the masthead's date
  // A sale that ends Wednesday can go Tuesday, but not Thursday
  const short = clean({ kind: 'percent', percent: 20, what: 'everything', ends: '2026-11-18' });
  const problems = (day) => kitProblems({ special: short, wall: wallOf(4), parts: story(1), photos, kids, catalog, send: day, check, checkWall, checkParts, sale: draftSale(short) });
  assert.deepEqual(problems('2026-11-17'), []);
  assert.deepEqual(problems('2026-11-19').map((p) => p.section), ['em-sale']);
});

test('the subject and preview line go to Kit as plain text, never HTML codes an inbox would show', () => {
  // As week-email.ts hands them to Kit: an apostrophe is ’, not "&#8217;", and & is &
  const p = cleanParts({ subject: "Santa's here & so is {upto} off", preheader: "Kids' crafts every Saturday" });
  const sale = { kind: 'percent', percent: 20, what: 'everything.' };
  const brief = { ...briefParts(p, { sale, photos: new Map(), kids: [] }), sale, send_date: '2026-11-17' };
  const l = lines(brief);
  assert.deepEqual(l, { subject: 'Santa’s here & so is 20% off', preheader: 'Kids’ crafts every Saturday' }, 'plain text, curly quotes as characters');
  assert.deepEqual({ subject: plain(l.subject), preheader: plain(l.preheader) }, l, 'and plain() leaves plain text alone');
  // The email escapes them once: its title and hidden preview line read as written, never "&amp;#8217;"
  const html = render(brief, ['masthead']);
  assert.match(html, /<title>Santa’s here &amp; so is 20% off<\/title>/);
  assert.match(html, />Kids’ crafts every Saturday&#847;/);
  assert.doesNotMatch(html, /&amp;(#\d+|[a-z]+);/, 'nothing escaped twice anywhere');
  assert.equal(plain('&lt;3 &amp;amp; &quot;x&quot;&nbsp;y'), '<3 &amp; "x" y', '&amp; last: nothing decoded twice');
});

test('every address on the store’s own site in an email ends in a slash, or production can’t serve it', () => {
  // The site uses trailingSlash: 'always'; in production an on-demand route without its slash gets
  // the 404 page before any middleware runs (addresses.mjs). The first deploy's photos and calendar
  // files did exactly that while the dev server served them.
  const ev = cleanEvent({ id: 'kids-christmas-saturdays-2026', title: 'Kids’ Christmas Saturdays', start: '11:00', end: '14:00', dates: [{ date: '2026-11-21', what: 'Write a letter to Santa' }, { date: '2026-11-28', what: 'Color a banner' }] });
  const e = pageEmail({ sale, wall: wallOf(4), parts: story(5), photos, kids, catalog, events: [toBriefEvent(ev, SEND, SITE)], impact, send: SEND, site: SITE });
  const html = render(e.brief, e.sections);
  const own = [...html.matchAll(/https:\/\/sunnyandranney\.com(\/[^"'\s?&#)]*)/g)].map((m) => m[1]);
  assert.ok(own.some((p) => p.startsWith('/media/email/')), 'it holds the store’s photos');
  assert.ok(own.some((p) => /^\/events\/[^/]+\/\d{4}-\d{2}-\d{2}\.ics\/$/.test(p)), 'and the next date’s calendar file');
  assert.ok(own.some((p) => /^\/events\/[^/]+\.ics\/$/.test(p)), 'and the series’ calendar file');
  assert.deepEqual(own.filter((p) => !p.endsWith('/')), []);
});

test('a store photo is cropped by the resizing; on a developer’s machine it shows straight from the site', () => {
  assert.equal(Email.photo(`photo:${ids[0]}`, 100, 50), `https://shop.sunnyandranney.com/cdn-cgi/image/width=100,height=50,fit=cover,gravity=auto,quality=64,format=jpeg/${SITE}/media/email/${ids[0]}.jpg/`);
  usePhotoOrigin('http://localhost:4322', { direct: true });
  try {
    assert.equal(Email.photo(`photo:${ids[0]}`, 100, 50), `http://localhost:4322/media/email/${ids[0]}.jpg/`);
  } finally {
    usePhotoOrigin(SITE);
  }
});

test('it can go only when it’s finished, and says what’s left, each with the section that does it', () => {
  const ready = { special, wall: wallOf(4), parts: story(2), photos, kids, catalog, send: SEND, check, checkWall, checkParts, sale };
  assert.deepEqual(kitProblems(ready), []);
  assert.deepEqual(kitProblems({ ...ready, special: null, sale: null, wall: wallOf(2), parts: blankParts() }), [
    { text: 'Set the sale.', section: 'em-sale' },
    { text: 'Pick 2 more products.', section: 'em-products' },
    { text: 'Write the story.', section: 'em-story' },
    { text: 'Write the subject line.', section: 'em-lines' },
  ]);
  assert.deepEqual(kitProblems({ ...ready, kids: [] }), [{ text: 'The charity’s kids didn’t load, so the charity section can’t be drawn. Reload the page to try again.', section: 'em-charity' }]);
});

/** A stand-in Kit: answers from `routes` ("METHOD /path"), and keeps every call. */
function fakeKit(routes) {
  const calls = [];
  const get = async (url, init) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('https://kit.test/v4', '')}`;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const out = routes[key];
    if (!out && out !== null) return new Response(JSON.stringify({ errors: ['Not found'] }), { status: 404 });
    const value = typeof out === 'function' ? out(body, calls) : out;
    return value === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value), { status: 200 });
  };
  return { kit: kitClient({ key: 'k', base: 'https://kit.test/v4', get }), calls };
}
const msg = { subject: 'S', preheader: 'P', html: '<html></html>', description: 'D', templateId: 7 };
/** Kit's list of sent emails is read for the year before now. */
const NOW = Date.parse('2026-11-16T17:00:00Z');
const SENT_AFTER = '2025-11-15';

test('a test goes through Kit to just the testers, a minute later, never published', async () => {
  const { kit, calls } = fakeKit({
    'POST /subscribers': (b) => ({ subscriber: { id: 1, state: 'active', email_address: b.email_address } }),
    'POST /tags': (b) => ({ tag: { id: b.name.endsWith('a@x.com') ? 11 : 12 } }),
    'POST /tags/11/subscribers': { subscriber: { id: 1 } },
    'POST /broadcasts': { broadcast: { id: 90 } },
    'GET /broadcasts/90': { broadcast: { id: 90, public: false, send_at: '2026-11-16T15:01:00Z', status: 'scheduled' } },
  });
  assert.equal(await readyTester(kit, { email: 'a@x.com', name: 'A' }), 11);
  assert.deepEqual(calls.map((c) => c.key), ['POST /subscribers', 'POST /tags', 'POST /tags/11/subscribers']);
  assert.equal(calls[1].body.name, 'Weekly email test: a@x.com');
  const sent = await sendTest(kit, { ...msg, tagIds: [11, 12], now: Date.parse('2026-11-16T15:00:00Z') });
  assert.equal(sent.id, 90);
  const made = calls.find((c) => c.key === 'POST /broadcasts').body;
  assert.equal(made.subject, '[Test] S');
  assert.equal(made.public, false);
  assert.equal(made.send_at, '2026-11-16T15:01:00.000Z');
  assert.deepEqual(made.subscriber_filter, [{ any: [{ type: 'tag', ids: [11, 12] }] }]);
});

test('someone who unsubscribed from the store’s emails isn’t signed back up for a test', async () => {
  const { kit } = fakeKit({ 'POST /subscribers': { subscriber: { id: 1, state: 'cancelled' } } });
  await assert.rejects(readyTester(kit, { email: 'm@x.com', name: 'Mike' }), /Mike \(m@x\.com\) is unsubscribed from the store’s emails/);
});

test('the real send is scheduled for every subscriber, checked with Kit, and taken off the web if Kit published it', async () => {
  const { kit, calls } = fakeKit({
    'POST /broadcasts': { broadcast: { id: 5 } },
    'GET /broadcasts/5': (_, all) => ({ broadcast: { id: 5, public: !all.some((c) => c.key === 'PUT /broadcasts/5'), send_at: '2026-11-17T15:00:00Z', status: 'scheduled' } }),
    'PUT /broadcasts/5': { broadcast: { id: 5 } },
  });
  const sent = await schedule(kit, { ...msg, sendAt: '2026-11-17T15:00:00.000Z' });
  assert.deepEqual(sent, { id: 5, status: 'scheduled', sendAt: '2026-11-17T15:00:00Z' });
  const made = calls.find((c) => c.key === 'POST /broadcasts').body;
  assert.equal(made.subscriber_filter, undefined); // every subscriber
  assert.equal(made.public, false);
  assert.deepEqual(calls.find((c) => c.key === 'PUT /broadcasts/5').body, { public: false });
});

test('a send Kit keeps as a draft is deleted, so nothing is left half-done', async () => {
  const { kit, calls } = fakeKit({
    'POST /broadcasts': { broadcast: { id: 6 } },
    'GET /broadcasts/6': { broadcast: { id: 6, public: false, send_at: null, status: 'draft' } },
    'DELETE /broadcasts/6': null,
  });
  await assert.rejects(schedule(kit, { ...msg, sendAt: '2026-11-17T15:00:00.000Z' }), /kept it as a draft/);
  assert.ok(calls.some((c) => c.key === 'DELETE /broadcasts/6'));
});

test('a scheduled send can be cancelled until it goes; the template, count and usual time come from Kit', async () => {
  const sched = fakeKit({ 'GET /broadcasts/5': { broadcast: { id: 5, send_at: 'x', status: 'scheduled' } }, 'DELETE /broadcasts/5': null });
  await cancel(sched.kit, 5);
  assert.ok(sched.calls.some((c) => c.key === 'DELETE /broadcasts/5'));
  const sent = fakeKit({ 'GET /broadcasts/5': { broadcast: { id: 5, send_at: 'x', status: 'completed' } } });
  await assert.rejects(cancel(sent.kit, 5), /already gone out/);
  // Deleted in Kit's own app: it reads as gone, and cancelling it is already done (no DELETE sent)
  const deleted = fakeKit({});
  assert.deepEqual(await statusOf(deleted.kit, 5), { status: 'gone', sendAt: null });
  await cancel(deleted.kit, 5);
  assert.ok(!deleted.calls.some((c) => c.key.startsWith('DELETE')));
  // Any other refusal still throws
  const down = kitClient({ key: 'k', base: 'https://kit.test/v4', get: async () => new Response('{}', { status: 500 }) });
  await assert.rejects(statusOf(down, 5), /Kit said no \(500\)/);
  const info = fakeKit({
    'GET /email_templates?per_page=100': { email_templates: [{ id: 1, category: 'Classic' }, { id: 5, category: 'Starting point' }] },
    'GET /subscribers?status=active&include_total_count=true&per_page=1&slim=true': { subscribers: [], pagination: { total_count: 4812 } },
    [`GET /broadcasts?status=completed&sent_after=${SENT_AFTER}&per_page=1000&slim=true`]: {
      broadcasts: [
        // The store's weekly emails this admin scheduled, labeled as send.ts labels them
        { subject: 'A', send_at: '2026-11-10T15:00:00Z', description: 'The Sunny Side for Tue, Nov 10, from the store admin' },
        { subject: 'B', send_at: '2026-11-03T15:00:00Z', description: 'The Sunny Side for Tue, Nov 3, going Wed, Nov 4, from the store admin' },
        { subject: '[Test] C', send_at: '2026-11-02T20:00:00Z', description: 'Test of the Tue, Nov 3 email, from the store admin' },
        { subject: 'D', send_at: '2026-10-27T13:30:00Z', description: 'The Sunny Side for Tue, Oct 27, from the store admin' },
        // The charity's emails from the same account, more of them and at their own time, count for nothing
        { subject: 'Reveal day', send_at: '2026-11-16T20:31:00Z', description: null },
        { subject: 'Last call', send_at: '2026-11-09T20:31:00Z' },
        { subject: 'Newsletter', send_at: '2026-11-02T20:31:00Z', description: 'Monthly Dose of Sunshine' },
        { subject: 'Hand-sent sale', send_at: '2026-11-11T02:52:00Z' },
      ],
    },
  });
  assert.equal(await templateFor(info.kit, null), 5);
  assert.equal(await templateFor(info.kit, '9'), 9);
  assert.equal(await subscriberCount(info.kit), 4812);
  assert.equal(await usualTime(info.kit, NOW), '10:00'); // 15:00 UTC in November is 10 AM Eastern; the test and the charity's emails are left out
  // Before this admin has scheduled one, there's no usual time to offer (not the charity's)
  const none = fakeKit({ [`GET /broadcasts?status=completed&sent_after=${SENT_AFTER}&per_page=1000&slim=true`]: { broadcasts: [{ subject: 'Reveal day', send_at: '2026-11-16T20:31:00Z' }] } });
  assert.equal(await usualTime(none.kit, NOW), null);
  assert.equal(broadcastUrl(5), 'https://app.kit.com/campaigns/5/draft');
});

test('sent emails: the store’s, newest first, tests and the charity’s left out, read-only from Kit', async () => {
  // Read with each email's HTML, to tell the store's from the charity's (the Kit account is shared)
  const list = `GET /broadcasts?status=completed&sent_after=${SENT_AFTER}&per_page=1000`;
  // As the real ones read on Nov 16, 2026: the store's hand-sent sale links mostly to the store, a charity email only to the charity
  const STORE = '<a href="https://sunnyandranney.com/shop/?utm_source=kit&amp;utm_campaign=x">Shop</a><a href="https://shop.sunnyandranney.com/">Shop</a><a href="https://sunshineonaranneyday.com/">Learn more</a>';
  const CHARITY = '<a href="https://sunshineonaranneyday.com/kids/dylan/?ref=sunnyandranney.com">Watch live</a><a href="mailto:hi@sunshineonaranneyday.com">Write</a><a href="{{ unsubscribe_url }}">Unsubscribe</a>';
  const k = fakeKit({
    // Kit's list has no stated order, so it's sorted here
    [list]: {
      broadcasts: [
        { id: 2, subject: 'Nov 3', preview_text: 'P2', send_at: '2026-11-03T14:00:00Z', status: 'completed', content: STORE },
        { id: 3, subject: '[Test] Nov 10', preview_text: null, send_at: '2026-11-09T20:00:00Z', status: 'completed', content: STORE },
        { id: 1, subject: 'Nov 10', preview_text: null, send_at: '2026-11-10T14:00:00Z', status: 'completed', content: STORE },
        { id: 7, subject: 'Join us live for Dylan’s reveal', preview_text: 'Watch', send_at: '2026-11-16T15:56:00Z', status: 'completed', content: CHARITY },
        { id: 8, subject: 'Still want our emails?', preview_text: null, send_at: '2026-11-11T15:11:00Z', status: 'completed', content: '<p>One click keeps you on the list.</p>' },
        // One this admin scheduled is the store's by its label, whatever it links to
        { id: 9, subject: 'Nov 17', preview_text: 'P9', send_at: '2026-11-17T15:00:00Z', status: 'completed', content: '', description: 'The Sunny Side for Tue, Nov 17, from the store admin' },
      ],
    },
    'GET /broadcasts/1': { broadcast: { id: 1, subject: 'Nov 10', preview_text: 'P1', send_at: '2026-11-10T14:00:00Z', status: 'completed', content: STORE } },
    'GET /broadcasts/3': { broadcast: { id: 3, subject: '[Test] Nov 10', send_at: '2026-11-09T20:00:00Z', status: 'completed', content: STORE } },
    'GET /broadcasts/4': { broadcast: { id: 4, subject: 'Next week', send_at: '2026-11-24T14:00:00Z', status: 'scheduled', content: STORE } },
    'GET /broadcasts/6': { broadcast: { id: 6, subject: 'Draft', send_at: null, status: 'draft', content: STORE } },
    'GET /broadcasts/7': { broadcast: { id: 7, subject: 'Join us live for Dylan’s reveal', send_at: '2026-11-16T15:56:00Z', status: 'completed', content: CHARITY } },
  });
  assert.deepEqual(await sentEmails(k.kit, { now: NOW }), [
    { id: 9, subject: 'Nov 17', preheader: 'P9', sentAt: '2026-11-17T15:00:00Z' },
    { id: 1, subject: 'Nov 10', preheader: '', sentAt: '2026-11-10T14:00:00Z' },
    { id: 2, subject: 'Nov 3', preheader: 'P2', sentAt: '2026-11-03T14:00:00Z' },
  ]);
  assert.deepEqual(await sentEmails(k.kit, { now: NOW, limit: 1 }).then((r) => r.map((e) => e.id)), [9]);
  assert.deepEqual(await sentEmail(k.kit, 1), { id: 1, subject: 'Nov 10', preheader: 'P1', sentAt: '2026-11-10T14:00:00Z', html: STORE, status: 'completed' });
  // A test, one still scheduled, a draft, one deleted in Kit, or the charity's isn't a sent store email
  for (const id of [3, 4, 6, 7, 99]) assert.equal(await sentEmail(k.kit, id), null, `broadcast ${id}`);
  // Only reads: nothing is ever created, changed or deleted
  assert.ok(k.calls.every((c) => c.key.startsWith('GET ')));
  // Any other refusal is said, not hidden as "nothing sent"
  const down = kitClient({ key: 'k', base: 'https://kit.test/v4', get: async () => new Response('{}', { status: 500 }) });
  await assert.rejects(sentEmails(down, { now: NOW }), /Kit said no \(500\)/);
  await assert.rejects(sentEmail(down, 1), /Kit said no \(500\)/);
});

test('the charity’s kids: the most recent reveal first, by its recorded date, else the day its photos went up', () => {
  const rows = [
    kidRow('older', { stamp: '1785000000000' }), // photos Jul 25, 2026
    kidRow('newer', { stamp: '1791465775704', rooms: ['Dream Bedroom', 'Accessible Bathroom'], alt: 'Newer in the new room' }), // Oct 8
    kidRow('dylan', { status: 'in-progress', stamp: '1780000000000' }), // reveal on record for Nov 18
    kidRow('max', { status: 'in-progress' }), // reveal on record for Nov 20: not yet
    kidRow('hidden', { publish: 'draft' }),
    kidRow('nophoto', { hero: null }),
    kidRow('nosummary', { summary: '' }),
  ];
  const reveals = [{ slug: 'dylan', d: '2026-11-18' }, { slug: 'max', d: '2026-11-20' }];
  assert.deepEqual(revealedKids(rows, reveals, '2026-11-16').map((k) => k.slug), ['newer', 'older']);
  assert.deepEqual(revealedKids(rows, reveals, '2026-11-19').map((k) => [k.slug, k.revealedOn, k.dated]), [
    ['dylan', '2026-11-18', 'recorded'],
    ['newer', '2026-10-08', 'photos'],
    ['older', '2026-07-25', 'photos'],
  ]);
  const k = revealedKids(rows, reveals, '2026-11-16')[0];
  assert.deepEqual(k.photo, { src: 'cf:kids/newer/1791465775704-a.jpg', alt: 'Newer in the new room' });
  assert.equal(k.caption, 'Newer’s new dream bedroom and accessible bathroom.');
  assert.equal(k.page, 'https://sunshineonaranneyday.com/kids/newer/');
  assert.deepEqual(missionOf(k), { photo: k.photo, caption: 'Newer’s new dream bedroom and accessible bathroom.', story: 'newer got a new room.', cta: 'See their story', url: k.page });
  assert.equal(kidFor('', [k]), k);
  assert.equal(kidFor('older', revealedKids(rows, reveals, '2026-11-16')).slug, 'older');
  assert.equal(cfIdOf('https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/adrian/photo-18/public'), 'kids/adrian/photo-18');
  assert.equal(cfIdOf('https://elsewhere.com/a.jpg'), null);
  assert.equal(roomsPhrase(['Chair Lift', 'Dream Bedroom', 'Accessible Bathroom']), 'chair lift, dream bedroom and accessible bathroom');
  assert.equal(photosDate([{ url: '/kids/x/photo-11/public' }]), null);
});

test('a family’s photos: the finished room first, then their page’s photo, accent and gallery, each once', () => {
  const cf = (n) => `https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/kids/ava/${n}/public`;
  const d = {
    beforeAfterPhotos: [{ before: cf('before-1'), after: cf('after-1'), afterAlt: 'Ava’s new bathroom, with its roll-in shower' }, { after: cf('after-2') }, { after: 'https://elsewhere.com/x.jpg' }],
    heroImage: cf('hero'),
    accentImage: cf('after-2'),
    photos: [{ url: cf('hero'), alt: 'Ava laughing' }, { url: cf('g-1'), alt: '' }, { url: cf('after-1') }, ...Array.from({ length: 40 }, (_, i) => ({ url: cf(`g-${i + 2}`) }))],
  };
  const photos = photosOf(d, 'Ava’s new accessible bathroom');
  assert.deepEqual(photos.slice(0, 4), [
    { src: 'cf:kids/ava/after-1', alt: 'Ava’s new bathroom, with its roll-in shower', after: true },
    { src: 'cf:kids/ava/after-2', alt: 'Ava’s new accessible bathroom', after: true },
    { src: 'cf:kids/ava/hero', alt: 'Ava laughing' },
    { src: 'cf:kids/ava/g-1', alt: 'Ava’s new accessible bathroom' },
  ]);
  assert.equal(photos.length, KID_PHOTOS);
  assert.equal(new Set(photos.map((p) => p.src)).size, photos.length);

  // The family as the page gets it starts on the finished room; a family without one, on their page's photo
  const [withRoom] = revealedKids([{ slug: 'ava', name: 'Ava', status: 'completed', data: JSON.stringify({ ...d, heroSummary: 'Ava got a new bathroom.', roomTypes: ['Accessible Bathroom'] }) }], [], '2026-11-16');
  assert.equal(withRoom.photo.src, 'cf:kids/ava/after-1');
  assert.equal(kids[0].photo.src, 'cf:kids/ava/1791000000000-a.jpg');
  assert.ok(!kids[0].photo.after);

  // The photo she picks goes in the email; one no longer on their page falls back to the finished room
  assert.equal(missionOf(withRoom, 'cf:kids/ava/g-1').photo.src, 'cf:kids/ava/g-1');
  assert.equal(missionOf(withRoom, 'cf:kids/ava/gone').photo.src, 'cf:kids/ava/after-1');
  const brief = (kidPhoto) => briefParts(cleanParts({ kid: 'ava', kidPhoto }), { sale, photos: new Map(), kids: [withRoom] }).mission.photo.src;
  assert.equal(brief('cf:kids/ava/hero'), 'cf:kids/ava/hero');
  assert.equal(brief(''), 'cf:kids/ava/after-1');
  // Only a photo id of the charity's is kept
  assert.equal(cleanParts({ kidPhoto: 'https://evil.com/x.jpg' }).kidPhoto, '');
  assert.equal(cleanParts({ kidPhoto: 'cf:kids/ava/../x' }).kidPhoto, '');
  assert.equal(cleanParts({ kidPhoto: 'cf:kids/ava/photo-09' }).kidPhoto, 'cf:kids/ava/photo-09');
});

test('the people who check it: the sender first as “You”, then the list by name', () => {
  const people = testPeople([{ name: 'Staci', email: 'staci@x.com' }, { name: 'Mike', email: 'mike@x.com' }], 'Peter@X.com');
  assert.deepEqual(people.map((p) => p.name), ['You', 'Mike', 'Staci']);
  assert.deepEqual(cleanPerson({ name: '  Holly   S ', email: ' Holly@Example.Test ' }), { name: 'Holly S', email: 'holly@example.test' });
  assert.match(checkPerson(cleanPerson({ email: 'MIKE@x.com' }), people).email, /Mike is already on the list/);
  assert.match(checkPerson(cleanPerson({ email: 'peter@x.com' }), people).email, /your own email/);
  assert.match(checkPerson(cleanPerson({ email: 'nope' }), people).email, /isn’t an email address/);
  assert.deepEqual(testRecipients(['MIKE@x.com ', 'mike@x.com', 'peter@x.com'], people), { to: ['mike@x.com', 'peter@x.com'] });
  assert.match(testRecipients(['someone@else.com'], people).error, /isn’t on the list\. Add them first/);
  const many = Array.from({ length: TEST_MAX + 1 }, (_, k) => ({ name: `P${k}`, email: `p${k}@x.com` }));
  assert.match(testRecipients(many.map((p) => p.email), testPeople(many, 'me@x.com')).error, /10 people at most/);
  assert.equal(namesOf(['staci@x.com', 'mike@x.com', 'peter@x.com'], [{ name: 'Staci', email: 'staci@x.com' }, ...people]), 'Staci, Mike and you');
});

// Real D1 (Miniflare's local SQLite)
test('the photo library and the people live in D1', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: 'page-email-test' } });
  try {
    const DB = await mf.getD1Database('DB');
    const id = newPhotoId();
    assert.match(id, /^[a-z0-9]{20}$/);
    await addPhoto(DB, { id, w: 2400, h: 1600, bytes: 300000, alt: 'The tree', by: 'peter@x.com', now: '2026-11-16T10:00:00Z' });
    await addPhoto(DB, { id: 'bbbbbbbbbbbbbbbbbbbb', w: 1600, h: 2400, bytes: 200000, alt: 'Ornaments', by: 'staci@x.com', now: '2026-11-16T11:00:00Z' });
    assert.deepEqual((await listPhotos(DB)).map((p) => p.alt), ['Ornaments', 'The tree']);
    assert.equal(await setAlt(DB, id, 'The big tree'), true);
    assert.equal(await setAlt(DB, 'nope', 'x'), false);
    assert.deepEqual((await photosByIds(DB, [id, id, ''])).map((p) => p.alt), ['The big tree']);
    assert.equal(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);

    await addPerson(DB, { name: 'Mike', email: 'mike@x.com', by: 'peter@x.com', now: 't1' });
    await addPerson(DB, { name: 'Mike T', email: 'mike@x.com', by: 'staci@x.com', now: 't2' });
    assert.deepEqual(await listPeople(DB), [{ name: 'Mike T', email: 'mike@x.com' }]);
    assert.equal(await removePerson(DB, 'mike@x.com'), true);
    await logTest(DB, { send: SEND, at: '2026-11-16T14:00:00Z', by: 'peter@x.com', to: ['staci@x.com'], kitId: 90 });
    await logTest(DB, { send: SEND, at: '2026-11-16T15:00:00Z', by: 'staci@x.com', to: ['staci@x.com', 'mike@x.com'], kitId: 91 });
    assert.deepEqual((await recentTests(DB, SEND)).map((t) => t.by), ['staci@x.com', 'peter@x.com']);
    assert.equal(await testsSince(DB, '2026-11-16T14:30:00Z'), 1);
  } finally {
    await mf.dispose();
  }
});
