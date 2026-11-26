import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { MAX_ATTEMPTS, SHOPPER_DAILY_LIMIT, sendPending, STORE_TO_KEY } from './special-orders.mjs';

// ─── Real D1 (Miniflare's local SQLite) with the real migration ──────

const mfs = [];
after(() => Promise.all(mfs.map((m) => m.dispose())));
let n = 0;
async function createD1() {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: `special-orders-test-${n++}` } });
  mfs.push(mf);
  const db = await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)').run();
  const sql = readFileSync(new URL('../../../migrations/0013_special_order_requests.sql', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
  return db;
}

async function addRequest(db, over = {}) {
  const r = {
    id: `req-${Math.random().toString(36).slice(2)}`,
    created_at: '2026-11-14T16:00:00.000Z', // Saturday, 11 AM in Roswell
    handle: 'caverra-sofa-snow-bhf', title: '83"Caverra Sofa - Snow - BHF', vendor: 'Best Home Furnishings',
    price_cents: 159900, lead_days: 42, name: 'Pat Lee', email: 'pat@example.com', phone: '678-555-0100', note: 'In the snow fabric',
    reply_by: '2026-11-17', // saved by the website when the request came in
    ...over,
  };
  await db.prepare(`INSERT INTO special_order_requests (id, created_at, handle, title, vendor, price_cents, lead_days, name, email, phone, note, reply_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.created_at, r.handle, r.title, r.vendor, r.price_cents, r.lead_days, r.name, r.email, r.phone, r.note, r.reply_by).run();
  return r.id;
}

const setStoreTo = (db, to) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(STORE_TO_KEY, JSON.stringify(to)).run();
const row = (db, id) => db.prepare('SELECT * FROM special_order_requests WHERE id = ?').bind(id).first();

const SAT = new Date('2026-11-14T16:05:00Z'); // 11:05 AM Saturday in Roswell

function mailbox({ failFor = null } = {}) {
  const sent = [];
  const send = async (m) => {
    if (failFor && failFor(m)) throw new Error('E_RATE_LIMITED: slow down');
    sent.push(m);
  };
  return { sent, send };
}

test('one request: the store gets the details with Reply going to the shopper; the shopper gets a confirmation with the reply day', async () => {
  const db = await createD1();
  await setStoreTo(db, 'staci@sunnyandranney.com');
  const id = await addRequest(db);
  const box = mailbox();

  const out = await sendPending({ db, send: box.send, now: SAT });
  assert.deepEqual(out, { storeSent: 1, shopperSent: 1, shopperSkipped: 0, failed: 0, waitingForAddress: 0 });

  const [store, shopper] = box.sent;
  assert.equal(store.to, 'staci@sunnyandranney.com');
  assert.equal(store.replyTo, 'pat@example.com');
  assert.match(store.subject, /Caverra Sofa/);
  assert.match(store.text, /Lead time shown: about 6 weeks/);
  assert.match(store.text, /Price on the site: \$1,599/);
  assert.match(store.text, /Their note: “In the snow fabric/);
  assert.match(store.text, /admin\.sunnyandranney\.com\/admin\/vendors\/special-orders\//);
  assert.match(store.text, /told to expect an answer by Tuesday, November 17/);
  // The store's Reply button opens a draft with the price and date left to fill in.
  assert.match(store.html, /href="mailto:pat%40example\.com\?subject=Your%20special%20order/);
  assert.match(decodeURIComponent(store.html.match(/mailto:[^"]+subject=[^"]+/)[0]), /Price: \$\n/);

  assert.equal(shopper.to, 'pat@example.com');
  assert.equal(shopper.replyTo, 'staci@sunnyandranney.com');
  // The day the website saved on the request, as a date: it may be read days later.
  assert.match(shopper.text, /email you by Tuesday, November 17/);
  assert.match(shopper.text, /^Hi Pat,/);
  assert.match(shopper.text, /nothing to pay until you say yes/i);
  assert.match(shopper.html, /We got your request,(?: |&nbsp;)Pat/);
  assert.match(shopper.html, /What happens next/);
  // Everything a shopper typed is shown as text, never as markup.
  assert.doesNotMatch(shopper.html, /<script/i);

  const r = await row(db, id);
  assert.ok(r.store_emailed_at && r.shopper_emailed_at);
  // Nothing goes twice.
  assert.deepEqual(await sendPending({ db, send: box.send, now: SAT }), { storeSent: 0, shopperSent: 0, shopperSkipped: 0, failed: 0, waitingForAddress: 0 });
  assert.equal(box.sent.length, 2);
});

test('no store address yet: the shopper is still confirmed, the store copy waits, then goes once it is set', async () => {
  const db = await createD1();
  const id = await addRequest(db);
  const box = mailbox();

  assert.deepEqual(await sendPending({ db, send: box.send, now: SAT }), { storeSent: 0, shopperSent: 1, shopperSkipped: 0, failed: 0, waitingForAddress: 1 });
  assert.equal((await row(db, id)).email_attempts, 0, 'waiting for an address is not a failure');
  assert.equal(box.sent[0].replyTo, undefined, 'no reply-to until the store has an address');

  await setStoreTo(db, 'staci@sunnyandranney.com');
  assert.deepEqual(await sendPending({ db, send: box.send, now: SAT }), { storeSent: 1, shopperSent: 0, shopperSkipped: 0, failed: 0, waitingForAddress: 0 });
});

test('a phone-only request emails the store and no one else', async () => {
  const db = await createD1();
  await setStoreTo(db, 'staci@sunnyandranney.com');
  await addRequest(db, { email: null });
  const box = mailbox();
  assert.deepEqual(await sendPending({ db, send: box.send, now: SAT }), { storeSent: 1, shopperSent: 0, shopperSkipped: 0, failed: 0, waitingForAddress: 0 });
  assert.equal(box.sent[0].replyTo, undefined);
  assert.match(box.sent[0].text, /Phone: 678-555-0100/);
  assert.match(box.sent[0].html, /Call Pat/);
});

test('a failed send is kept, counted and retried; it stops after the limit with the error on record', async () => {
  const db = await createD1();
  await setStoreTo(db, 'staci@sunnyandranney.com');
  const id = await addRequest(db);
  const failing = mailbox({ failFor: (m) => m.to === 'pat@example.com' });

  assert.deepEqual(await sendPending({ db, send: failing.send, now: SAT }), { storeSent: 1, shopperSent: 0, shopperSkipped: 0, failed: 1, waitingForAddress: 0 });
  let r = await row(db, id);
  assert.equal(r.email_attempts, 1);
  assert.match(r.email_error, /To the shopper: E_RATE_LIMITED/);
  assert.ok(r.store_emailed_at, 'the part that worked is not sent again');

  const ok = mailbox();
  await sendPending({ db, send: ok.send, now: SAT });
  assert.equal(ok.sent.length, 1, 'only the shopper copy is retried');
  r = await row(db, id);
  assert.ok(r.shopper_emailed_at);
  assert.equal(r.email_error, null, 'the error clears once it goes');

  const stuck = await addRequest(db);
  const always = mailbox({ failFor: () => true });
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await sendPending({ db, send: always.send, now: SAT });
  assert.equal((await row(db, stuck)).email_attempts, MAX_ATTEMPTS);
});

test('the database refuses a request with no way to reach the shopper', async () => {
  const db = await createD1();
  await assert.rejects(addRequest(db, { email: null, phone: null }), /CHECK constraint failed/);
});

test('with no store address, 30 waiting requests never crowd out the shoppers owed a confirmation', async () => {
  const db = await createD1();
  for (let i = 0; i < 30; i++) await addRequest(db, { email: `shopper${i}@example.com`, created_at: `2026-11-14T15:${String(i).padStart(2, '0')}:00.000Z` });
  const box = mailbox();
  const first = await sendPending({ db, send: box.send, now: SAT });
  const second = await sendPending({ db, send: box.send, now: SAT });
  assert.equal(first.shopperSent + second.shopperSent, 30, 'every shopper is confirmed within two runs');
  assert.equal(second.waitingForAddress, 30);
  assert.equal((await sendPending({ db, send: box.send, now: SAT })).shopperSent, 0);
});

test('one address gets at most 3 confirmations a day; the store still hears about every request', async () => {
  const db = await createD1();
  await setStoreTo(db, 'staci@sunnyandranney.com');
  for (let i = 0; i < SHOPPER_DAILY_LIMIT + 2; i++) await addRequest(db, { email: 'target@example.com', created_at: `2026-11-14T15:0${i}:00.000Z` });
  const box = mailbox();
  const out = await sendPending({ db, send: box.send, now: SAT });
  assert.equal(out.storeSent, SHOPPER_DAILY_LIMIT + 2);
  assert.equal(out.shopperSent, SHOPPER_DAILY_LIMIT);
  assert.equal(out.shopperSkipped, 2);
  assert.equal(box.sent.filter((m) => m.to === 'target@example.com').length, SHOPPER_DAILY_LIMIT);
  assert.equal((await sendPending({ db, send: box.send, now: SAT })).shopperSkipped, 0, 'a skipped one is not tried again');
});
