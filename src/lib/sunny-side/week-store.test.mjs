import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { clean, forKind } from './special.mjs';
import { cleanWall } from './wall.mjs';
import { cleanEvent } from './events.mjs';
import { clearWeek, createExtra, extrasAhead, getWeek, otherWeek, pastWeeks, photoInKitEmail, putWeek, scheduledRefusal, setKit, weekToWorkOn, wentOut, workRefusal } from './week-store.mjs';
import { addPhoto, deletePhoto, listPhotos } from './photo-store.mjs';
import { cleanParts } from './parts.mjs';
import { deleteEvent, eventsFrom, getEvent, putEvent } from './event-store.mjs';

// Real D1 (Miniflare's local SQLite)
const SEND = '2026-11-17';
let dbCount = 0;
async function freshDb() {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: `week-test-${dbCount++}` } });
  return { DB: await mf.getD1Database('DB'), mf };
}
const special = forKind(clean({ kind: 'percent', percent: 20, what: 'everything', ends: '2026-11-29' }));
const wall = cleanWall({ picks: [{ handle: 'a', photo: 'cf:a', name: '' }], arranged: 'hand' });

test('a week saves its special and products together, checking the version the page loaded', async () => {
  const { DB, mf } = await freshDb();
  try {
    assert.equal((await putWeek(DB, { send: SEND, special, wall: null, by: 'staci@x', now: 't1', since: null })).ok, true);
    // Another manager's page loaded before that first save
    const late = await putWeek(DB, { send: SEND, special: null, wall, by: 'holly@x', now: 't2', since: null });
    assert.equal(late.ok, false);
    assert.equal(late.current.updatedBy, 'staci@x');
    assert.equal((await putWeek(DB, { send: SEND, special, wall, by: 'staci@x', now: 't3', since: 't1' })).ok, true);
    assert.equal((await putWeek(DB, { send: SEND, special: null, wall, by: 'holly@x', now: 't4', since: 't1' })).ok, false);
    const week = await getWeek(DB, SEND);
    assert.equal(week.special.percent, 20);
    assert.deepEqual(week.wall.picks, [{ handle: 'a', photo: 'cf:a', name: '' }]);
    assert.equal(week.wall.arranged, 'hand');
    assert.equal((await clearWeek(DB, { send: SEND, since: 't1' })).ok, false);
    assert.equal((await clearWeek(DB, { send: SEND, since: 't3' })).ok, true);
    assert.equal(await getWeek(DB, SEND), null);
  } finally {
    await mf.dispose();
  }
});

test('specials saved before the page had products move over once, and the old table goes', async () => {
  const { DB, mf } = await freshDb();
  try {
    await DB.prepare('CREATE TABLE email_specials (send_date TEXT PRIMARY KEY, special TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)').run();
    await DB.prepare('INSERT INTO email_specials VALUES (?, ?, ?, ?)').bind(SEND, JSON.stringify(special), 't0', 'staci@x').run();
    const week = await getWeek(DB, SEND);
    assert.equal(week.special.percent, 20);
    assert.equal(week.wall, null);
    assert.equal(week.updatedAt, 't0');
    assert.equal(await DB.prepare("SELECT name FROM sqlite_master WHERE name = 'email_specials'").first(), null);
  } finally {
    await mf.dispose();
  }
});

test('past weeks with a special come newest first', async () => {
  const { DB, mf } = await freshDb();
  try {
    for (const send of ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']) await putWeek(DB, { send, special, wall: null, by: 'staci@x', now: send, since: null });
    await putWeek(DB, { send: '2026-10-27', special: null, wall, by: 'staci@x', now: 'x', since: null });
    assert.deepEqual((await pastWeeks(DB, '2026-11-17')).map((r) => r.send), ['2026-11-10', '2026-11-03']);
  } finally {
    await mf.dispose();
  }
});

test('events save by version, and the ones still ahead come soonest first', async () => {
  const { DB, mf } = await freshDb();
  try {
    const ev = (id, dates) => cleanEvent({ id, title: id, start: '11:00', end: '14:00', dates: dates.map((date) => ({ date, what: 'x' })) });
    assert.equal((await putEvent(DB, { event: ev('later', ['2026-12-05', '2026-12-12']), by: 's', now: 't1', since: null })).ok, true);
    assert.equal((await putEvent(DB, { event: ev('sooner', ['2026-11-21', '2026-11-14']), by: 's', now: 't1', since: null })).ok, true);
    assert.equal((await putEvent(DB, { event: ev('over', ['2026-10-01']), by: 's', now: 't1', since: null })).ok, true);
    // The same address again is refused, with what's there
    const dup = await putEvent(DB, { event: ev('later', ['2027-01-01']), by: 'h', now: 't2', since: null });
    assert.equal(dup.ok, false);
    assert.equal(dup.current.event.dates[0].date, '2026-12-05');
    assert.deepEqual((await eventsFrom(DB, '2026-11-12')).map((r) => r.event.id), ['sooner', 'later']);
    assert.equal((await putEvent(DB, { event: ev('later', ['2026-12-19']), by: 'h', now: 't3', since: 't1' })).ok, true);
    assert.equal((await putEvent(DB, { event: ev('later', ['2026-12-26']), by: 's', now: 't4', since: 't1' })).ok, false);
    assert.equal((await getEvent(DB, 'later')).event.dates[0].date, '2026-12-19');
    assert.equal((await deleteEvent(DB, { id: 'later', since: 't1' })).ok, false);
    assert.equal((await deleteEvent(DB, { id: 'later', since: 't3' })).ok, true);
    assert.equal(await getEvent(DB, 'later'), null);
  } finally {
    await mf.dispose();
  }
});

test('a week has gone out once Kit’s send time has passed; scheduled ahead or never sent, it hasn’t', () => {
  const at = (sendAt) => ({ kit: { id: '1', at: '', by: '', sendAt } });
  const now = Date.parse('2026-11-17T16:00:00Z');
  assert.equal(wentOut(at('2026-11-17T15:00:00Z'), now), true);
  assert.equal(wentOut(at('2026-11-19T15:00:00Z'), now), false);
  assert.equal(wentOut({ kit: null }, now), false);
  assert.equal(wentOut(null, now), false);
});

test('one email is worked on: this week’s until it has gone out, then next week’s; every other week is refused', async () => {
  const { DB, mf } = await freshDb();
  try {
    const MON = '2026-11-16';
    const SAT = '2026-11-21';
    const NEXT = '2026-11-24';
    // Nothing saved: this week's
    assert.equal((await weekToWorkOn(DB, MON, Date.parse('2026-11-16T17:00:00Z'))).send, SEND);
    await putWeek(DB, { send: SEND, special, wall, by: 'staci@x', now: 't1', since: null });
    await putWeek(DB, { send: NEXT, special, wall: null, by: 'staci@x', now: 't1', since: null });
    // Scheduled for Tuesday morning: still this week's until it goes, then next week's, with that week's row
    await setKit(DB, { send: SEND, id: 77, at: 't2', by: 'staci@x', sendAt: '2026-11-17T14:00:00Z' });
    const before = await weekToWorkOn(DB, MON, Date.parse('2026-11-17T13:59:00Z'));
    assert.deepEqual([before.send, before.week?.kit?.id], [SEND, '77']);
    const after = await weekToWorkOn(DB, '2026-11-17', Date.parse('2026-11-17T14:00:00Z'));
    assert.deepEqual([after.send, after.week?.wall], [NEXT, null]);
    // Missed its Tuesday and never scheduled: still this week's, through Saturday
    await setKit(DB, { send: SEND, id: null });
    assert.equal((await weekToWorkOn(DB, SAT, Date.parse('2026-11-21T20:00:00Z'))).send, SEND);
    // Sunday starts the next week
    assert.equal((await weekToWorkOn(DB, '2026-11-22', Date.parse('2026-11-22T15:00:00Z'))).send, NEXT);
  } finally {
    await mf.dispose();
  }
  assert.equal(otherWeek(SEND, SEND), null);
  // Scheduled in Kit: no change until the send is cancelled
  assert.match(scheduledRefusal({ kit: { id: '77', sendAt: '2026-11-17T14:00:00Z' } }), /scheduled in Kit, so it can’t change. Cancel the send first/);
  assert.equal(scheduledRefusal({ kit: null }), null);
  assert.equal(scheduledRefusal(null), null);
  assert.match(otherWeek('2026-11-10', SEND), /Nov 10 email has gone out, so it can’t change. Reload to work on the Tue, Nov 17 email/);
  assert.match(otherWeek('2026-11-24', SEND), /Only the Tue, Nov 17 email can be worked on until it goes out/);
});

test('a deleted photo leaves the library; its file stays only for an email scheduled or sent through Kit', async () => {
  const { DB, mf } = await freshDb();
  try {
    const add = (id) => addPhoto(DB, { id, w: 2400, h: 1800, bytes: 1, alt: 'x', by: 'mike@x', now: 't' });
    for (const id of ['sentphoto0001', 'draftphoto001', 'spare0photo01']) await add(id);
    // Last week's email went out with one; this week's draft (not scheduled) uses another as its top photo
    await putWeek(DB, { send: '2026-11-10', special: null, wall: null, parts: cleanParts({ story: { headline: 'h', body: 'b', photos: ['sentphoto0001'] } }), by: 's', now: 't1', since: null });
    await setKit(DB, { send: '2026-11-10', id: 900, at: 't', by: 's', sendAt: '2026-11-10T15:00:00Z' });
    await putWeek(DB, { send: SEND, special: null, wall: null, parts: cleanParts({ hero: 'draftphoto001' }), by: 's', now: 't2', since: null });
    assert.equal(await photoInKitEmail(DB, 'sentphoto0001'), true);
    assert.equal(await photoInKitEmail(DB, 'draftphoto001'), false);
    assert.equal(await photoInKitEmail(DB, 'spare0photo01'), false);
    // A photo id is letters and digits only, never a pattern
    await assert.rejects(photoInKitEmail(DB, '%'), /Not a photo id/);
    // Cancelling the send in Kit frees it
    await setKit(DB, { send: '2026-11-10', id: null });
    assert.equal(await photoInKitEmail(DB, 'sentphoto0001'), false);
    assert.equal(await deletePhoto(DB, 'spare0photo01'), true);
    assert.equal(await deletePhoto(DB, 'spare0photo01'), false);
    assert.deepEqual((await listPhotos(DB)).map((p) => p.id).sort(), ['draftphoto001', 'sentphoto0001']);
  } finally {
    await mf.dispose();
  }
});

// ─── More than one email a week (Peter, 2026-11-25) ──────────────────
test('an extra email starts from the last email’s products and photos, with its own subject and sale', async () => {
  const { DB, mf } = await freshDb();
  try {
    const parts = cleanParts({ subject: 'Cozy week', preheader: 'Come in', hero: 'aaaaaaaaaaaaaaaa1', kid: 'ava', off: ['events'] });
    await putWeek(DB, { send: '2026-11-24', special, wall, parts, by: 'staci@x', now: 't1', since: null });
    // Next week's, being worked on, has no products yet: the extra starts from the one that does
    await putWeek(DB, { send: '2026-12-01', special: null, wall: null, parts: cleanParts({ subject: 'Next' }), by: 'staci@x', now: 't2', since: null });
    assert.equal((await createExtra(DB, { send: '2026-11-27', by: 'holly@x', now: 't3' })).ok, true);
    const extra = await getWeek(DB, '2026-11-27');
    assert.equal(extra.special, null, 'its sale is its own');
    assert.deepEqual(extra.wall, wall);
    assert.equal(extra.parts.subject, '', 'so is its subject line');
    assert.equal(extra.parts.preheader, '');
    assert.equal(extra.parts.hero, 'aaaaaaaaaaaaaaaa1');
    assert.equal(extra.parts.kid, 'ava');
    assert.deepEqual(extra.parts.off, ['events']);
    assert.equal(extra.updatedBy, 'holly@x');
    // One email a day: a second extra that day is refused, and the first stays as it was
    assert.equal((await createExtra(DB, { send: '2026-11-27', by: 'staci@x', now: 't4' })).ok, false);
    assert.equal((await getWeek(DB, '2026-11-27')).updatedBy, 'holly@x');
    await assert.rejects(() => createExtra(DB, { send: '2026-12-01', by: 'staci@x', now: 't5' }), /Not an extra email's day/);
  } finally {
    await mf.dispose();
  }
});

test('extras still to go are listed soonest first, and drop off once they go out', async () => {
  const { DB, mf } = await freshDb();
  try {
    for (const send of ['2026-11-26', '2026-11-27', '2026-11-29', '2026-12-01']) await putWeek(DB, { send, special: null, wall: null, by: 'staci@x', now: 't1', since: null });
    const now = Date.parse('2026-11-27T13:00:00Z');
    assert.deepEqual((await extrasAhead(DB, '2026-11-27', now)).map((w) => w.send), ['2026-11-27', '2026-11-29'], 'from today on, and never the weekly one');
    await setKit(DB, { send: '2026-11-27', id: 9, at: 't2', by: 'staci@x', sendAt: '2026-11-27T12:00:00Z' });
    assert.deepEqual((await extrasAhead(DB, '2026-11-27', now)).map((w) => w.send), ['2026-11-29'], 'one that went out is in Sent emails');
    await setKit(DB, { send: '2026-11-29', id: 10, at: 't2', by: 'staci@x', sendAt: '2026-11-29T12:00:00Z' });
    assert.deepEqual((await extrasAhead(DB, '2026-11-27', now)).map((w) => w.send), ['2026-11-29'], 'one scheduled ahead still shows, to cancel');
  } finally {
    await mf.dispose();
  }
});

test('only the weekly email being worked on, or an extra still to go, can change or go', async () => {
  const { DB, mf } = await freshDb();
  try {
    const now = Date.parse('2026-11-26T15:00:00Z');
    await putWeek(DB, { send: '2026-11-24', special, wall, by: 'staci@x', now: 't1', since: null });
    await setKit(DB, { send: '2026-11-24', id: 1, at: 't1', by: 'staci@x', sendAt: '2026-11-24T21:30:00Z' });
    assert.equal((await workRefusal(DB, '2026-12-01', '2026-11-26', now)).refused, null, 'next week’s, once this week’s went');
    assert.match((await workRefusal(DB, '2026-11-24', '2026-11-26', now)).refused, /has gone out/);
    assert.match((await workRefusal(DB, '2026-11-27', '2026-11-26', now)).refused, /was deleted/, 'an extra has to be started first');
    await putWeek(DB, { send: '2026-11-27', special: null, wall: null, by: 'staci@x', now: 't2', since: null });
    const ok = await workRefusal(DB, '2026-11-27', '2026-11-26', now);
    assert.equal(ok.refused, null);
    assert.equal(ok.week.send, '2026-11-27');
    assert.match((await workRefusal(DB, '2026-11-27', '2026-11-28', now)).refused, /day has passed/);
    await setKit(DB, { send: '2026-11-27', id: 2, at: 't3', by: 'staci@x', sendAt: '2026-11-27T12:00:00Z' });
    assert.equal((await workRefusal(DB, '2026-11-27', '2026-11-26', now)).refused, null, 'scheduled, it can still be cancelled');
    assert.match((await workRefusal(DB, '2026-11-27', '2026-11-27', Date.parse('2026-11-27T13:00:00Z'))).refused, /has gone out/);
    assert.equal((await workRefusal(DB, 'soon', '2026-11-26', now)).refused, 'Invalid request');
  } finally {
    await mf.dispose();
  }
});
