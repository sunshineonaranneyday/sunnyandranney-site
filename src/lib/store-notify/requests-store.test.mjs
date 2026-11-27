import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { getStoreAddress, listRequests, replyStats, resendEmails, setStatus, setStoreAddress, waitingCount } from './requests-store.mjs';

const mfs = [];
after(() => Promise.all(mfs.map((m) => m.dispose())));
let n = 0;
async function createD1() {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: `requests-store-test-${n++}` } });
  mfs.push(mf);
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)').run();
  const sql = readFileSync(new URL('../../../migrations/0014_special_order_requests.sql', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  return db;
}

async function add(db, id, created_at) {
  await db.prepare(`INSERT INTO special_order_requests (id, created_at, handle, title, name, email) VALUES (?, ?, 'h', 'T', 'Pat', 'pat@example.com')`).bind(id, created_at).run();
}

const NOW = '2026-11-14T18:00:00.000Z';

test('waiting requests come first, the longest-waiting at the top; answered ones follow, newest first', async () => {
  const db = await createD1();
  await add(db, 'a', '2026-11-10T15:00:00.000Z');
  await add(db, 'b', '2026-11-12T15:00:00.000Z');
  await add(db, 'c', '2026-11-13T15:00:00.000Z');
  await add(db, 'd', '2026-11-14T15:00:00.000Z');
  await setStatus(db, { id: 'a', status: 'replied', by: 'staci@sunnyandranney.com', now: '2026-11-10T19:00:00.000Z' });
  await setStatus(db, { id: 'd', status: 'ordered', by: 'staci@sunnyandranney.com', now: NOW });
  assert.deepEqual((await listRequests(db)).map((r) => r.id), ['b', 'c', 'd', 'a']);
  assert.deepEqual(await waitingCount(db), { count: 2, oldest: '2026-11-12T15:00:00.000Z', due: null });
});

test('answering is stamped once; ordering or closing also counts as answered', async () => {
  const db = await createD1();
  await add(db, 'a', '2026-11-13T15:00:00.000Z');
  await setStatus(db, { id: 'a', status: 'replied', by: 'staci@x.com', now: '2026-11-13T17:00:00.000Z' });
  await setStatus(db, { id: 'a', status: 'ordered', by: 'peter@x.com', now: NOW });
  const r = (await listRequests(db))[0];
  assert.equal(r.replied_at, '2026-11-13T17:00:00.000Z', 'the first answer stands');
  assert.equal(r.replied_by, 'staci@x.com');
  assert.equal(r.closed_by, 'peter@x.com');

  await add(db, 'b', '2026-11-13T15:00:00.000Z');
  await setStatus(db, { id: 'b', status: 'closed', by: 'staci@x.com', now: NOW });
  const b = (await listRequests(db)).find((x) => x.id === 'b');
  assert.equal(b.replied_at, NOW);
  assert.equal(await setStatus(db, { id: 'nope', status: 'replied', by: 'x', now: NOW }), false);
  await assert.rejects(setStatus(db, { id: 'b', status: 'new', by: 'x', now: NOW }));
});

test('the numbers: received, median hours to answer, orders, and the oldest wait', () => {
  const rows = [
    { created_at: '2026-11-13T10:00:00.000Z', replied_at: '2026-11-13T12:00:00.000Z', status: 'ordered' },
    { created_at: '2026-11-12T10:00:00.000Z', replied_at: '2026-11-13T10:00:00.000Z', status: 'replied' },
    { created_at: '2026-11-11T10:00:00.000Z', replied_at: '2026-11-11T14:00:00.000Z', status: 'closed' },
    { created_at: '2026-11-14T12:00:00.000Z', replied_at: null, status: 'new' },
    { created_at: '2026-09-01T10:00:00.000Z', replied_at: '2026-09-09T10:00:00.000Z', status: 'ordered' }, // too old to count
  ];
  assert.deepEqual(replyStats(rows, NOW), { received: 4, medianReplyHours: 4, ordered: 1, waiting: 1, oldestWaitingHours: 6 });
  assert.deepEqual(replyStats([], NOW), { received: 0, medianReplyHours: null, ordered: 0, waiting: 0, oldestWaitingHours: null });
});

test('the store address: checked, saved, and read back', async () => {
  const db = await createD1();
  assert.equal(await getStoreAddress(db), null);
  assert.equal(await setStoreAddress(db, 'not an email'), 'That email doesn’t look right.');
  assert.equal(await setStoreAddress(db, ' Staci@SunnyAndRanney.com '), null);
  assert.equal(await getStoreAddress(db), 'staci@sunnyandranney.com');
});

test('send again clears the attempts and the error, so the outbox picks it up', async () => {
  const db = await createD1();
  await add(db, 'a', '2026-11-13T15:00:00.000Z');
  await db.prepare(`UPDATE special_order_requests SET email_attempts = 8, email_error = 'bad address' WHERE id = 'a'`).run();
  assert.equal(await resendEmails(db, 'a'), true);
  const r = (await listRequests(db))[0];
  assert.equal(r.email_attempts, 0);
  assert.equal(r.email_error, null);
  assert.equal(await resendEmails(db, 'nope'), false);
});

test('a closed or ordered request can be reopened; its first answer stands', async () => {
  const db = await createD1();
  await add(db, 'a', '2026-11-13T15:00:00.000Z');
  await setStatus(db, { id: 'a', status: 'replied', by: 'staci@x.com', now: '2026-11-13T17:00:00.000Z' });
  await setStatus(db, { id: 'a', status: 'closed', by: 'staci@x.com', now: NOW });
  await setStatus(db, { id: 'a', status: 'replied', by: 'staci@x.com', now: NOW });
  const r = (await listRequests(db))[0];
  assert.equal(r.status, 'replied');
  assert.equal(r.closed_at, null);
  assert.equal(r.replied_at, '2026-11-13T17:00:00.000Z');
});

test('the soonest answer-by day among waiting requests', async () => {
  const db = await createD1();
  await add(db, 'a', '2026-11-13T15:00:00.000Z');
  await add(db, 'b', '2026-11-14T15:00:00.000Z');
  await db.prepare(`UPDATE special_order_requests SET reply_by = CASE id WHEN 'a' THEN '2026-11-14' ELSE '2026-11-17' END`).run();
  assert.equal((await waitingCount(db)).due, '2026-11-14');
});
