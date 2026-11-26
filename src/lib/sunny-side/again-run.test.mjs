import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { AGAIN_TAG } from './again.mjs';
import { againDescription, runAgain, stopAgain } from './again-run.mjs';
import { dropLock, getAgain, setAgain, takeLock } from './again-store.mjs';
import { NO_MARKETING_TAG, STORE_TAG, isAgainEmail, fromThisAdmin } from './kit.mjs';
import { putWeek, setKit } from './week-store.mjs';

/*
 * A stand-in for Kit with just what the run uses, holding subscribers, tags and what each broadcast
 * did, and answering the subscriber filter the way Kit's docs describe it. Pages are small, so
 * every list is read over several pages.
 */
const PAGE = 3;
function fakeKit({ subscribers, broadcasts, events }) {
  const tags = new Map([
    [1, { id: 1, name: STORE_TAG, members: new Set() }],
    [2, { id: 2, name: NO_MARKETING_TAG, members: new Set() }],
  ]);
  let nextTag = 50;
  let nextBroadcast = 900;
  for (const s of subscribers) for (const t of s.tags ?? []) tags.get(t).members.add(s.id);
  const calls = [];
  const kit = {
    calls,
    tags,
    broadcasts,
    events,
    failNext: null,
    /** Calls to fail: { method, re, status, times, after } (after: do it, then fail, as when Kit's answer is lost) */
    fail: [],
    ignoreOpens: false,
    tagOf: (name) => [...tags.values()].find((t) => t.name === name),
    async call(path, init = {}) {
      const { method = 'GET' } = init;
      calls.push(`${method} ${path}`);
      if (kit.failNext) {
        const status = kit.failNext;
        kit.failNext = null;
        throw Object.assign(new Error(`Kit said no (${status})`), { status });
      }
      const rule = kit.fail.find((f) => f.times > 0 && f.method === method && f.re.test(path.split('?')[0]));
      if (rule) {
        rule.times--;
        if (rule.after) await kit.answer(path, init);
        throw Object.assign(new Error(`Kit said no (${rule.status})`), { status: rule.status });
      }
      return kit.answer(path, init);
    },
    async answer(path, { method = 'GET', body } = {}) {
      const url = new URL(`https://kit.test${path}`);
      const p = url.pathname;
      const after = Number(url.searchParams.get('after') || 0);
      const page = (list, key) => ({ [key]: list.slice(after, after + PAGE), pagination: { has_next_page: after + PAGE < list.length, end_cursor: String(after + PAGE) } });
      let m;
      if (method === 'GET' && p === '/tags') return page([...tags.values()].map(({ id, name }) => ({ id, name })), 'tags');
      if (method === 'POST' && p === '/tags') {
        const had = kit.tagOf(body.name);
        if (had) return { tag: { id: had.id, name: had.name } };
        const t = { id: nextTag++, name: body.name, members: new Set() };
        tags.set(t.id, t);
        return { tag: { id: t.id, name: t.name } };
      }
      if ((m = p.match(/^\/tags\/(\d+)\/subscribers$/)) && method === 'GET') return page([...tags.get(Number(m[1])).members].map((id) => ({ id: Number(id) })), 'subscribers');
      if ((m = p.match(/^\/tags\/(\d+)\/subscribers\/(\d+)$/))) {
        if (!subscribers.some((x) => x.id === m[2])) throw Object.assign(new Error('Kit said no (404)'), { status: 404 });
        const t = tags.get(Number(m[1]));
        if (method === 'POST') t.members.add(m[2]);
        else if (!t.members.delete(m[2])) throw Object.assign(new Error('Kit said no (404)'), { status: 404 });
        return {};
      }
      if (method === 'POST' && p === '/subscribers/filter') return page(subscribers.filter((s) => body.all.every((c) => matches(s, c))).map((s) => ({ id: s.id })), 'subscribers');
      if (method === 'GET' && p === '/broadcasts') {
        const since = url.searchParams.get('sent_after');
        const status = url.searchParams.get('status');
        return { broadcasts: [...broadcasts.values()].filter((b) => (!status || b.status === status) && (!since || b.send_at.slice(0, 10) >= since)) };
      }
      if ((m = p.match(/^\/broadcasts\/(\d+)\/stats$/))) {
        const id = Number(m[1]);
        const b = broadcasts.get(id);
        return { broadcast: { id, stats: { recipients: b.recipients ?? countOf('sent', id), emails_opened: countOf('opens', id), status: b.status } } };
      }
      if ((m = p.match(/^\/broadcasts\/(\d+)$/))) {
        const id = Number(m[1]);
        const b = broadcasts.get(id);
        if (!b) throw Object.assign(new Error('Kit said no (404)'), { status: 404 });
        if (method === 'DELETE') return void broadcasts.delete(id) ?? {};
        if (method === 'PUT') return { broadcast: Object.assign(b, body) };
        return { broadcast: b };
      }
      if (method === 'POST' && p === '/broadcasts') {
        const b = { id: nextBroadcast++, ...body, status: 'scheduled', public: false };
        broadcasts.set(b.id, b);
        return { broadcast: b };
      }
      throw new Error(`The stand-in doesn’t know ${method} ${path}`);
    },
  };
  const countOf = (what, id) => new Set(events.filter((e) => e.what === what && e.broadcast === id).map((e) => e.who)).size;
  function matches(s, c) {
    if (c.type === 'tags') return c.any.some((x) => x.matching.some((id) => tags.get(id)?.members.has(s.id)));
    if (c.type === 'subscriber_state') return c.states.includes(s.state ?? 'active');
    if (c.type === 'subscribed') return s.joined > c.after;
    const ids = c.any?.find((x) => x.type === 'broadcasts')?.ids;
    if (kit.ignoreOpens && c.type === 'opens' && ids) return false;
    const n = events.filter((e) => e.who === s.id && e.what === c.type && (!ids || ids.includes(e.broadcast)) && (!c.after || e.day > c.after)).length;
    return n >= c.count_greater_than_or_equal;
  }
  return kit;
}

const SEND = '2026-11-17';
const EMAIL = 100; // the week's email in Kit
const LAST_WEEK = 90;
const AGAIN_AT = '2026-11-20T15:00:00.000Z'; // Fri 10 AM Eastern
const T = Date.parse(AGAIN_AT);
const MIN = 60 * 1000;

/** Ten store subscribers, and what each did. */
function world() {
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const subscribers = ids.map((id) => ({ id, tags: [1], joined: '2025-01-01', state: 'active' }));
  subscribers[9].tags.push(2); // 10 asked for no marketing after the email went
  subscribers[8].joined = '2026-11-10'; // 9 is new
  subscribers.push({ id: '77', tags: [], joined: '2025-01-01' }); // the charity's, not the store's
  const sent = (who, broadcast, day) => ({ who, what: 'sent', broadcast, day });
  const events = [
    ...ids.map((who) => sent(who, EMAIL, '2026-11-17')),
    ...ids.map((who) => sent(who, LAST_WEEK, '2026-11-10')),
    sent('77', 300, '2026-11-12'),
    { who: '1', what: 'opens', broadcast: EMAIL, day: '2026-11-17' },
    { who: '2', what: 'clicks', broadcast: EMAIL, day: '2026-11-18' },
    // Read last week's email: still reading the store's email
    ...['3', '4', '5', '6', '10'].map((who) => ({ who, what: 'opens', broadcast: LAST_WEEK, day: '2026-11-10' })),
    { who: '7', what: 'clicks', broadcast: LAST_WEEK, day: '2026-11-11' },
    // 8 hasn't opened anything: cold
  ];
  const broadcasts = new Map([
    [EMAIL, { id: EMAIL, status: 'completed', send_at: '2026-11-17T15:00:00Z', description: 'The Sunny Side for Tue, Nov 17, from the store admin', content: '<a href="https://sunnyandranney.com/">x</a>' }],
    [LAST_WEEK, { id: LAST_WEEK, status: 'completed', send_at: '2026-11-10T15:00:00Z', description: '', content: '<a href="https://sunnyandranney.com/shop/">x</a>' }],
    [300, { id: 300, status: 'completed', send_at: '2026-11-12T15:00:00Z', description: '', content: '<a href="https://sunshineonaranneyday.com/">x</a>' }],
  ]);
  return { subscribers, events, broadcasts };
}

let dbCount = 0;
async function setup({ scheduled = true } = {}) {
  const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: { DB: `again-run-${dbCount++}` } });
  const db = await mf.getD1Database('DB');
  await putWeek(db, { send: SEND, special: null, wall: null, by: 'staci@x', now: 't0', since: null });
  if (scheduled) await setKit(db, { send: SEND, id: EMAIL, at: 't0', by: 'staci@x', sendAt: '2026-11-17T15:00:00.000Z' });
  await setAgain(db, { send: SEND, subject: 'In case you missed it: Save 20%', sendAt: AGAIN_AT, by: 'staci@x', now: 't1' });
  const w = world();
  const kit = fakeKit(w);
  const built = [];
  const build = async (send, day, subject, firstDay) => {
    built.push({ send, day, subject, firstDay });
    return { ok: true, html: '<p>email</p>', subject, preheader: 'pre', leftOut: [] };
  };
  const run = (now, extra = {}) => runAgain({ db, kit, build, from: 'store@x', templateId: async () => 7, now, gapMs: 0, sleep: async () => {}, ...extra });
  return { mf, db, kit, run, built, w };
}

const WHO = ['3', '4', '5', '6', '7', '9']; // didn't read it, still reading (or new), no marketing left out
const membersOf = (kit) => [...kit.tagOf(AGAIN_TAG).members].sort((a, b) => a - b);

test('it lists who gets it, tags them over several runs, and schedules it once the tag is right', async () => {
  const { mf, db, kit, run, built } = await setup();
  try {
    // Not yet: two hours before is when it starts
    assert.deepEqual((await run(T - 3 * 60 * MIN)).did, []);
    // A small share of calls each run: it pauses and goes on
    const first = await run(T - 2 * 60 * MIN, { budget: 18 });
    assert.ok(first.did.some((d) => /paused/.test(d)), first.did.join(' | '));
    let r = await getAgain(db, SEND);
    assert.deepEqual([...r.want].sort((a, b) => a - b), WHO);
    assert.deepEqual(r.left, { read: 2, cold: 1, lately: 0, mailed: 0, noMarketing: 1 });
    for (let k = 1; k < 6 && membersOf(kit).length < WHO.length; k++) await run(T - (2 * 60 - k * 2) * MIN, { budget: 7 });
    assert.deepEqual(membersOf(kit), WHO);
    // Tagged with time to spare: it waits for its time
    assert.match((await run(T - 60 * MIN)).did.join(), /waiting for its time/);
    assert.equal((await getAgain(db, SEND)).state, 'waiting');

    const ready = await run(T - 15 * MIN);
    assert.match(ready.did.join(), /scheduled in Kit/);
    r = await getAgain(db, SEND);
    assert.equal(r.state, 'scheduled');
    assert.equal(r.people, WHO.length);
    const b = kit.broadcasts.get(Number(r.kitId));
    assert.deepEqual(b.subscriber_filter, [{ any: [{ type: 'tag', ids: [kit.tagOf(AGAIN_TAG).id] }] }]);
    assert.equal(b.send_at, AGAIN_AT);
    assert.equal(b.subject, 'In case you missed it: Save 20%');
    assert.equal(b.email_address, 'store@x');
    assert.equal(b.description, againDescription(SEND));
    // Kept apart from the store's own sends: not in Sent emails' list, not the usual time
    assert.ok(isAgainEmail(b) && !fromThisAdmin(b));
    // Built as of its own day, held to the checks of the day the email itself went
    assert.deepEqual(built, [{ send: SEND, day: '2026-11-20', subject: 'In case you missed it: Save 20%', firstDay: '2026-11-17' }]);

    // Kit sends it; the run notes it, then takes the tag back off everyone
    b.status = 'completed';
    assert.match((await run(T + 5 * MIN)).did.join(), /sent/);
    assert.equal((await getAgain(db, SEND)).state, 'sent');
    await run(T + 7 * MIN);
    assert.deepEqual(membersOf(kit), []);
    assert.equal((await getAgain(db, SEND)).tagClean, true);
    assert.deepEqual((await run(T + 9 * MIN)).did, []);
  } finally {
    await mf.dispose();
  }
});

test('whoever opens it after the list is made comes off before it goes', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    assert.deepEqual(membersOf(kit), WHO);
    kit.events.push({ who: '4', what: 'opens', broadcast: EMAIL, day: '2026-11-20' });
    await run(T - 10 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'scheduled');
    assert.equal(r.people, WHO.length - 1);
    assert.equal(r.left.read, 3);
    assert.deepEqual(membersOf(kit), WHO.filter((id) => id !== '4'));
  } finally {
    await mf.dispose();
  }
});

test('no one gets one again within four weeks of the last, or on a day the account already mailed them', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    // Last week's went again to 3; the charity mailed 5 yesterday
    await db.prepare("INSERT INTO email_again (send_date, subject, send_at, state, kit_id, set_by, set_at, tag_clean, updated_at) VALUES ('2026-11-10', 's', '2026-11-13T15:00:00.000Z', 'sent', '555', 'x', 'x', 1, 'x')").run();
    kit.broadcasts.set(555, { id: 555, status: 'completed', send_at: '2026-11-13T15:00:00Z', description: againDescription('2026-11-10'), content: '' });
    kit.events.push({ who: '3', what: 'sent', broadcast: 555, day: '2026-11-13' });
    kit.broadcasts.set(301, { id: 301, status: 'completed', send_at: '2026-11-19T20:00:00Z', description: '', content: '<a href="https://sunshineonaranneyday.com/">x</a>' });
    kit.events.push({ who: '5', what: 'sent', broadcast: 301, day: '2026-11-19' });
    await run(T - 2 * 60 * MIN);
    const r = await getAgain(db, SEND);
    assert.deepEqual([...r.want].sort((a, b) => a - b), ['4', '6', '7', '9']);
    assert.equal(r.left.lately, 1);
    assert.equal(r.left.mailed, 1);
  } finally {
    await mf.dispose();
  }
});

test('a list Kit’s own report doesn’t back up never goes', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    // Kit's report says the email went to 6, but the filter finds 10: the filter isn't what we think
    kit.broadcasts.get(EMAIL).recipients = 6;
    await run(T - 2 * 60 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'skipped');
    assert.match(r.note, /didn’t match Kit’s own report/);
    assert.match(r.detail, /found 10 people .* report says 6/);
    assert.equal([...kit.broadcasts.values()].filter((b) => b.id >= 900).length, 0);
  } finally {
    await mf.dispose();
  }
});

test('it doesn’t go if the email was cancelled, if it can’t be built, or if it’s too late', async () => {
  {
    const { mf, db, run } = await setup({ scheduled: false });
    try {
      await run(T - 2 * 60 * MIN);
      assert.match((await getAgain(db, SEND)).note, /cancelled/);
    } finally {
      await mf.dispose();
    }
  }
  {
    const { mf, db, kit, run } = await setup();
    try {
      await run(T - 2 * 60 * MIN);
      await runAgain({ db, kit, from: 'store@x', templateId: async () => 7, now: T - 10 * MIN, gapMs: 0, sleep: async () => {}, build: async () => ({ ok: false, problems: ['Only 3 of its 6 products are still for sale.'] }) });
      const r = await getAgain(db, SEND);
      assert.equal(r.state, 'skipped');
      assert.equal(r.note, 'Only 3 of its 6 products are still for sale.');
      // Then the tag comes back off
      await run(T);
      assert.deepEqual(membersOf(kit), []);
    } finally {
      await mf.dispose();
    }
  }
  {
    const { mf, db, kit, run } = await setup();
    try {
      // Kit was down the whole time: the owner sees why while it keeps trying, then it gives up
      kit.failNext = 500;
      await run(T - 2 * 60 * MIN);
      assert.match((await getAgain(db, SEND)).detail, /Kit said no \(500\)/);
      await run(T + 3 * 60 * MIN + 1);
      const r = await getAgain(db, SEND);
      assert.equal(r.state, 'skipped');
      assert.match(r.note, /in time/);
    } finally {
      await mf.dispose();
    }
  }
});

test('if no one is left to send it to, it doesn’t go', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    for (const who of WHO) kit.events.push({ who, what: 'opens', broadcast: EMAIL, day: '2026-11-19' });
    await run(T - 10 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.note, 'No one is left to send it to.');
    assert.equal(r.left.read, 2 + WHO.length);
  } finally {
    await mf.dispose();
  }
});

test('turned off from the page, it doesn’t go; once in Kit, it comes out of Kit', async () => {
  {
    const { mf, db, kit, run } = await setup();
    try {
      await run(T - 2 * 60 * MIN);
      const done = await stopAgain({ db, kit, send: SEND, by: 'holly@x', now: T - 60 * MIN });
      assert.equal(done.ok, true);
      assert.equal(done.again.state, 'cancelled');
      assert.equal(done.again.stoppedBy, 'holly@x');
      await run(T - 58 * MIN);
      assert.deepEqual(membersOf(kit), []);
      assert.equal([...kit.broadcasts.values()].filter((b) => b.id >= 900).length, 0);
    } finally {
      await mf.dispose();
    }
  }
  {
    const { mf, db, kit, run } = await setup();
    try {
      await run(T - 2 * 60 * MIN);
      await run(T - 10 * MIN);
      const { kitId } = await getAgain(db, SEND);
      assert.ok(kit.broadcasts.has(Number(kitId)));
      assert.equal((await stopAgain({ db, kit, send: SEND, by: 'holly@x', now: T - 5 * MIN })).ok, true);
      assert.ok(!kit.broadcasts.has(Number(kitId)));
      // Once it has gone, it can't be stopped
      await setAgain(db, { send: SEND, subject: 's', sendAt: AGAIN_AT, by: 'x', now: 'x' });
      await db.prepare("UPDATE email_again SET state = 'sent' WHERE send_date = ?").bind(SEND).run();
      assert.equal((await stopAgain({ db, kit, send: SEND, by: 'holly@x' })).ok, false);
    } finally {
      await mf.dispose();
    }
  }
});

test('one run at a time; Kit asking to slow down pauses it until the next', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    const stale = await takeLock(db, T, T + 60 * 1000);
    assert.ok(stale);
    assert.deepEqual(await run(T - 2 * 60 * MIN), { ran: false, why: 'another run is going' });
    // A lock left by a run that died is taken once its time is up, and the old run can't let go of the new one
    const fresh = await takeLock(db, T + 61 * 1000, T + 5 * 60 * 1000);
    assert.ok(fresh);
    await dropLock(db, stale);
    assert.equal(await takeLock(db, T + 62 * 1000, T + 9 * 60 * 1000), null);
    await dropLock(db, fresh);
    const later = await run(T + 61 * 1000);
    assert.equal(later.ran, true);
    kit.failNext = 429;
    const slowed = await run(T - 100 * MIN);
    assert.match(slowed.did.join(), /paused \(Kit asked to slow down\)/);
  } finally {
    await mf.dispose();
  }
});

const resends = (kit) => [...kit.broadcasts.values()].filter((b) => b.id >= 900 && b.status === 'scheduled');

test('Kit busy while it checks a new resend: it’s taken back out, and the next run makes exactly one', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    kit.fail.push({ method: 'GET', re: /^\/broadcasts\/9\d\d$/, status: 429, times: 1 });
    const failed = await run(T - 10 * MIN);
    assert.match(failed.did.join(), /taken back out of Kit/);
    assert.equal(resends(kit).length, 0);
    assert.ok((await getAgain(db, SEND)).creatingAt);
    await run(T - 8 * MIN);
    assert.equal(resends(kit).length, 1);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'scheduled');
    assert.equal(Number(r.kitId), resends(kit)[0].id);
    assert.equal(r.creatingAt, null);
  } finally {
    await mf.dispose();
  }
});

test('Kit made it but its answer was lost: the next run finds the copy nothing knows of and takes it out first', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    kit.fail.push({ method: 'POST', re: /^\/broadcasts$/, status: 504, times: 1, after: true });
    await run(T - 10 * MIN);
    assert.equal(resends(kit).length, 1, 'the lost one is in Kit');
    const lost = resends(kit)[0].id;
    assert.equal((await getAgain(db, SEND)).state, 'waiting');
    const next = await run(T - 8 * MIN);
    assert.match(next.did.join(), /1 unnoted copy taken out of Kit/);
    assert.equal(resends(kit).length, 1);
    assert.notEqual(resends(kit)[0].id, lost);
    assert.equal(Number((await getAgain(db, SEND)).kitId), resends(kit)[0].id);
  } finally {
    await mf.dispose();
  }
});

test('turned off while it was being made, and Kit wouldn’t take it out: the next run does', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    // Staci turns it off the moment Kit makes it, and Kit refuses the first take-out
    const answer = kit.answer;
    kit.answer = async (path, init = {}) => {
      const out = await answer(path, init);
      if (init.method === 'POST' && path === '/broadcasts') {
        await stopAgain({ db, kit: { call: answer }, send: SEND, by: 'holly@x', now: T - 10 * MIN });
        kit.fail.push({ method: 'DELETE', re: /^\/broadcasts\/9\d\d$/, status: 500, times: 1 });
      }
      return out;
    };
    await run(T - 10 * MIN);
    kit.answer = answer;
    assert.equal(resends(kit).length, 1);
    assert.equal((await getAgain(db, SEND)).state, 'cancelled');
    await run(T - 8 * MIN);
    assert.equal(resends(kit).length, 0);
    assert.equal((await getAgain(db, SEND)).creatingAt, null);
  } finally {
    await mf.dispose();
  }
});

test('a filter that finds too few who opened it is caught too: they’d be sent it again', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    // Kit's report counts 12 who opened it (more than the slack of 5 people); the filter finds none
    for (let k = 0; k < 11; k++) kit.events.push({ who: `x${k}`, what: 'opens', broadcast: EMAIL, day: '2026-11-17' });
    kit.ignoreOpens = true;
    await run(T - 2 * 60 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'skipped');
    assert.match(r.detail, /found 0 people who opened the email, and Kit’s report says 12/);
  } finally {
    await mf.dispose();
  }
});

test('Kit or the charity not answering is tried again; something changed for good is said in words staff can use', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    const once = (made) => runAgain({ db, kit, from: 'store@x', templateId: async () => 7, now: T - 10 * MIN, gapMs: 0, sleep: async () => {}, build: async () => made });
    await once({ ok: false, status: 502, problems: ['Couldn’t read the charity’s numbers from its site.'] });
    let r = await getAgain(db, SEND);
    assert.equal(r.state, 'waiting');
    assert.match(r.detail, /charity’s numbers/);
    await once({ ok: false, status: 409, problems: ['A photo this email uses isn’t in the library anymore. Pick another.'], sections: ['em-photos'] });
    r = await getAgain(db, SEND);
    assert.equal(r.state, 'skipped');
    assert.equal(r.note, 'A photo in it was deleted from the library since it went out.');
    assert.match(r.detail, /Pick another/);
  } finally {
    await mf.dispose();
  }
});

test('taken off the schedule in Kit’s own app, it’s taken out of Kit and the tag is cleared', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    await run(T - 2 * 60 * MIN);
    await run(T - 10 * MIN);
    const b = resends(kit)[0];
    b.status = 'draft';
    await run(T - 5 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'cancelled');
    assert.match(r.note, /taken off the schedule in Kit/);
    assert.ok(!kit.broadcasts.has(b.id));
    await run(T - 3 * MIN);
    assert.deepEqual(membersOf(kit), []);
  } finally {
    await mf.dispose();
  }
});

test('someone gone from Kit, unsubscribed or asking for no marketing after the list was made isn’t sent it', async () => {
  const { mf, db, kit, run, w } = await setup();
  try {
    await run(T - 2 * 60 * MIN, { budget: 18 }); // lists, tags no one yet
    w.subscribers.splice(w.subscribers.findIndex((x) => x.id === '4'), 1); // deleted from Kit
    w.subscribers.find((x) => x.id === '5').state = 'cancelled'; // unsubscribed
    kit.tagOf(NO_MARKETING_TAG).members.add('6');
    await run(T - 100 * MIN);
    await run(T - 10 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'scheduled');
    assert.deepEqual(membersOf(kit), ['3', '7', '9']);
    assert.equal(r.people, 3);
    assert.equal(r.left.gone, 2);
    assert.equal(r.left.noMarketing, 2);
    assert.equal(r.left.cold, 1, 'the counts from the list are kept');
  } finally {
    await mf.dispose();
  }
});

test('a filter that finds no one who opened it stops it, however few Kit counts', async () => {
  const { mf, db, kit, run } = await setup();
  try {
    kit.ignoreOpens = true; // Kit's report counts 1 who opened it
    await run(T - 2 * 60 * MIN);
    const r = await getAgain(db, SEND);
    assert.equal(r.state, 'skipped');
    assert.equal(r.want, null, 'no list was kept, so no one was tagged');
    assert.equal(kit.tagOf(AGAIN_TAG)?.members.size ?? 0, 0);
  } finally {
    await mf.dispose();
  }
});
