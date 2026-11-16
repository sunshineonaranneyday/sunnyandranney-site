import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { REMIND_DAYS, ensureTable as ensureTaxTable, salesTaxFacts } from '../sales-tax/status.mjs';
import { emailNeeds, emailToWorkOn } from '../sunny-side/special.mjs';
import { ensureTable as ensureEmailTable, getWeek, wentOut } from '../sunny-side/week-store.mjs';
import { dueText, loadNavStatus, navStatus } from './nav-status.mjs';
import { allLinks, navFor } from './nav.mjs';
import { loadToday } from './today.mjs';

// Monday, November 16, 2026, 10 AM in the store: the Tuesday email goes tomorrow,
// and October's sales tax is due Friday the 20th.
const NOW = '2026-11-16T15:00:00.000Z';
const ME = 'staci@example.com';

const shift = (id, staff, clockIn, clockOut, extra = {}) => ({
  id,
  version: 1,
  staff_id: staff,
  display_name: staff,
  email: `${staff}@example.com`,
  clock_in_at: clockIn,
  clock_out_at: clockOut,
  status: 'pending',
  push_state: null,
  ...extra,
});

/** One of everything Hours can hold, and things it must leave out. */
const SHIFTS = [
  shift('forgot', 'ana', '2026-11-13T14:00:00.000Z', null), // clocked in Friday, never out
  shift('working', 'ben', '2026-11-16T13:00:00.000Z', null), // on the clock now: not work for a manager
  shift('clean', 'cy', '2026-11-14T14:00:00.000Z', '2026-11-14T22:00:00.000Z'), // ready to approve
  shift('long', 'di', '2026-11-12T12:00:00.000Z', '2026-11-13T02:00:00.000Z'), // 14 hours: needs a look
  shift('mine', 'staci', '2026-11-14T14:00:00.000Z', '2026-11-14T22:00:00.000Z', { email: ME }), // someone else approves it
  shift('approved', 'cy', '2026-11-13T14:00:00.000Z', '2026-11-13T22:00:00.000Z', { status: 'approved' }),
  shift('sent', 'ana', '2026-11-12T14:00:00.000Z', '2026-11-12T22:00:00.000Z', { push_state: 'pushed' }),
  shift('rejected', 'di', '2026-11-11T14:00:00.000Z', '2026-11-11T22:00:00.000Z', { status: 'rejected' }),
];

const TAX = [
  { month: '2026-10', state: 'sent', filed_at: null },
  { month: '2026-09', state: 'sent', filed_at: '2026-10-15T14:00:00.000Z' },
];

test('no work, no marks: nothing informational, no zeros', () => {
  assert.deepEqual(navStatus({ entries: [], week: { special: '{}', wall: '{}' }, taxMonths: [{ month: '2026-10', state: 'sent', filed_at: 'x' }], now: NOW, myEmail: ME }), {});
  assert.deepEqual(navStatus({ now: NOW, myEmail: ME }), {}, 'a source that could not be read gets no mark');
});

test('Hours counts the shifts a manager has to deal with, and turns clay when one is wrong', () => {
  const hours = navStatus({ entries: SHIFTS, now: NOW, myEmail: ME })['/admin/hours/'];
  assert.deepEqual(hours, {
    text: '3',
    spoken: '1 shift missing a clock-out, 1 shift over 12 hours, 1 shift ready to approve',
    tone: 'alert',
    count: 3,
  });
  const routine = navStatus({ entries: [SHIFTS[2]], now: NOW, myEmail: ME })['/admin/hours/'];
  assert.equal(routine.tone, 'plain', 'shifts that are only waiting for approval are routine');
  const many = Array.from({ length: 120 }, (_, i) => shift(`s${i}`, `p${i}`, '2026-11-14T14:00:00.000Z', '2026-11-14T15:00:00.000Z'));
  assert.equal(navStatus({ entries: many, now: NOW })['/admin/hours/'].text, '99+');
});

test('Weekly email shows how long until it goes while it needs its sale or products', () => {
  const email = (week, now = NOW) => navStatus({ week, now })['/admin/email/'];
  assert.deepEqual(email(null), { text: 'Tomorrow', spoken: 'The Tue, Nov 17 email needs the sale and the products', tone: 'alert' });
  assert.equal(email({ special: '{}' }).spoken, 'The Tue, Nov 17 email needs the products');
  assert.equal(email({ special: '{}', wall: '{}' }), undefined);
  // The Wednesday after a send, the next one is six days out: shown, quietly.
  assert.deepEqual(navStatus({ week: null, send: '2026-11-24', now: '2026-11-18T15:00:00.000Z' })['/admin/email/'], { text: '6 days', spoken: 'The Tue, Nov 24 email needs the sale and the products', tone: 'plain' });
  // A Tuesday missed: this week's email can still go by Saturday, so it stays, late
  assert.deepEqual(email(null, '2026-11-18T15:00:00.000Z'), { text: 'Late', spoken: 'The Tue, Nov 17 email needs the sale and the products', tone: 'alert' });
  assert.equal(email(null, '2026-11-17T15:00:00.000Z').text, 'Today');
});

test('Sales tax shows how long until a month ready to file is due, clay from the reminder on', () => {
  const tax = (now) => navStatus({ taxMonths: TAX, now })['/admin/sales-tax/'];
  assert.deepEqual(tax(NOW), { text: '4 days', spoken: 'October 2026 sales tax is ready to file, due Friday', tone: 'plain' });
  assert.equal(tax('2026-11-17T15:00:00.000Z').tone, 'alert', `${REMIND_DAYS} days before, when the worker emails its reminder`);
  assert.deepEqual(tax('2026-11-20T15:00:00.000Z'), { text: 'Today', spoken: 'October 2026 sales tax is ready to file, due today', tone: 'alert' });
  assert.deepEqual(tax('2026-11-22T15:00:00.000Z'), { text: 'Late', spoken: 'October 2026 sales tax is ready to file, 2 days late', tone: 'alert' });
  assert.equal(navStatus({ taxMonths: [TAX[1]], now: NOW })['/admin/sales-tax/'], undefined, 'nothing to file');
});

test('a mark is short enough for its pill, and only on a link the manager has', () => {
  for (const n of [-3, 0, 1, 2, 9, 31]) assert.ok(dueText(n).length <= 8, dueText(n));
  const marks = navStatus({ entries: SHIFTS, week: null, taxMonths: TAX, now: NOW, myEmail: ME });
  const hrefs = new Set(allLinks(navFor({ role: 'manager' })).map((link) => link.href));
  assert.deepEqual(Object.keys(marks).sort(), ['/admin/email/', '/admin/hours/', '/admin/sales-tax/']);
  for (const href of Object.keys(marks)) assert.ok(hrefs.has(href), `${href} isn't in the sidebar`);
});

test('the reads go out together, and one that fails loses only its own mark', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const db = {
    prepare: (sql) => {
      const statement = {
        bind: () => statement,
        all: async () => {
          started.push(sql);
          await gate;
          if (sql.includes('email_weeks')) throw new Error('no such table: email_weeks');
          return { results: sql.includes('sales_tax_months') ? TAX : SHIFTS };
        },
      };
      return statement;
    },
  };
  const loading = loadNavStatus(db, { now: NOW, myEmail: ME });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 3, 'all three reads start before any answers: one round trip');
  release();
  const original = console.error;
  console.error = () => {};
  const marks = await loading.finally(() => (console.error = original));
  assert.deepEqual(Object.keys(marks).sort(), ['/admin/hours/', '/admin/sales-tax/']);
});

/** A D1 binding over SQLite, with every migration applied: the database the admin really reads. */
function database() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, dir), 'utf8'));
  const prepare = (sql) => {
    const bound = (params) => ({
      bind: (...next) => bound(next),
      all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
      first: async () => sqlite.prepare(sql).get(...params) ?? null,
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
    });
    return bound([]);
  };
  return { sqlite, db: { prepare, batch: (statements) => Promise.all(statements.map((s) => s.run())) } };
}

test('on the same database, a mark is exactly what Today, Weekly email and Sales tax show', async () => {
  const { sqlite, db } = database();
  const stamp = '2026-11-01T00:00:00.000Z';
  const insertStaff = sqlite.prepare('INSERT OR IGNORE INTO staff (id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  const insertShift = sqlite.prepare(
    'INSERT INTO time_entries (id, staff_id, clock_in_at, clock_out_at, status, push_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  // Plus a forgotten clock-out from two months back, past where both look.
  const rows = [...SHIFTS, shift('ancient', 'eve', '2026-09-01T14:00:00.000Z', null)];
  for (const r of rows) {
    insertStaff.run(r.staff_id, r.display_name, r.email, stamp, stamp);
    insertShift.run(r.id, r.staff_id, r.clock_in_at, r.clock_out_at, r.status, r.push_state, stamp, stamp);
  }
  await ensureTaxTable(db);
  for (const m of TAX) sqlite.prepare("INSERT INTO sales_tax_months (month, state, filed_at) VALUES (?, ?, ?)").run(m.month, m.state, m.filed_at);
  await ensureEmailTable(db);

  const check = async (label) => {
    const marks = await loadNavStatus(db, { now: NOW, myEmail: ME });
    const today = await loadToday(db, { now: NOW, myEmail: ME });
    const onToday = today.missedClockOuts.length + today.ready.length + today.needsLook.length;
    assert.equal(marks['/admin/hours/']?.count ?? 0, onToday, `${label}: Hours`);
    assert.equal(marks['/admin/hours/']?.tone === 'alert', today.missedClockOuts.length + today.needsLook.length > 0, `${label}: Hours tone`);
    const needs = emailNeeds(await getWeek(db, '2026-11-17'));
    assert.equal(marks['/admin/email/']?.spoken ?? null, needs.length ? `The Tue, Nov 17 email needs ${needs.join(' and ')}` : null, `${label}: email`);
    const { toFile } = await salesTaxFacts(db, { now: Date.parse(NOW) });
    assert.equal(marks['/admin/sales-tax/']?.text ?? null, toFile ? dueText(toFile.daysLeft) : null, `${label}: sales tax`);
    return marks;
  };

  const before = await check('as set up');
  assert.equal(before['/admin/hours/'].count, 3);
  // The manager deals with each: approves, fixes the clock-out, saves the email, files October.
  sqlite.exec("UPDATE time_entries SET status = 'approved' WHERE id IN ('clean', 'long')");
  sqlite.exec("UPDATE time_entries SET clock_out_at = '2026-11-13T22:00:00.000Z' WHERE id = 'forgot'");
  sqlite.prepare("INSERT INTO email_weeks (send_date, special, wall, updated_at, updated_by) VALUES ('2026-11-17', '{}', NULL, ?, ?)").run(stamp, ME);
  await check('half done');
  sqlite.exec("UPDATE email_weeks SET wall = '{}'");
  sqlite.exec("UPDATE sales_tax_months SET filed_at = '2026-11-16T15:00:00.000Z' WHERE month = '2026-10'");
  sqlite.exec("UPDATE time_entries SET status = 'approved' WHERE id = 'forgot'");
  assert.deepEqual(await check('all done'), {});
});

test('the email mark is about the email the email page and Today open: this week’s until it has gone out', async () => {
  const { sqlite, db } = database();
  await ensureEmailTable(db);
  const WED = '2026-11-18T15:00:00.000Z';
  const stamp = '2026-11-10T00:00:00.000Z';
  const mark = async () => (await loadNavStatus(db, { now: WED, myEmail: ME }))['/admin/email/'];
  const page = async () => {
    const tuesday = await getWeek(db, '2026-11-17');
    return emailToWorkOn('2026-11-18', (s) => s === '2026-11-17' && wentOut(tuesday, Date.parse(WED)));
  };
  // Tuesday's email never went: it's still this week's to send, and late
  sqlite.prepare("INSERT INTO email_weeks (send_date, special, wall, updated_at, updated_by) VALUES ('2026-11-17', '{}', NULL, ?, ?)").run(stamp, ME);
  assert.equal((await mark()).spoken, 'The Tue, Nov 17 email needs the products');
  assert.equal(await page(), '2026-11-17');
  // Scheduled for Thursday: not gone yet, and it has all it needs, so no mark
  sqlite.exec("UPDATE email_weeks SET wall = '{}', kit_id = '5', kit_send_at = '2026-11-19T15:00:00.000Z' WHERE send_date = '2026-11-17'");
  assert.equal(await mark(), undefined);
  assert.equal(await page(), '2026-11-17');
  // Sent on Tuesday: the mark and the page both move to next week's
  sqlite.exec("UPDATE email_weeks SET kit_send_at = '2026-11-17T15:00:00.000Z' WHERE send_date = '2026-11-17'");
  assert.equal((await mark()).spoken, 'The Tue, Nov 24 email needs the sale and the products');
  assert.equal(await page(), '2026-11-24');
});
