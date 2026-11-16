import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { clean, forKind } from './special.mjs';
import { cleanWall } from './wall.mjs';
import { cleanEvent } from './events.mjs';
import { clearWeek, getWeek, pastWeeks, putWeek, weeksBetween } from './week-store.mjs';
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

test('past weeks with a special come newest first; a range comes in order', async () => {
  const { DB, mf } = await freshDb();
  try {
    for (const send of ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']) await putWeek(DB, { send, special, wall: null, by: 'staci@x', now: send, since: null });
    await putWeek(DB, { send: '2026-10-27', special: null, wall, by: 'staci@x', now: 'x', since: null });
    assert.deepEqual((await pastWeeks(DB, '2026-11-17')).map((r) => r.send), ['2026-11-10', '2026-11-03']);
    assert.deepEqual((await weeksBetween(DB, '2026-11-10', '2026-11-24')).map((r) => r.send), ['2026-11-10', '2026-11-17', '2026-11-24']);
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
