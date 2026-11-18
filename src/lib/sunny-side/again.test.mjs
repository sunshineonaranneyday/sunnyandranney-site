import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  againAudience,
  againDays,
  againLine,
  againProblem,
  againTimes,
  againView,
  checkAgainSubject,
  checkAgainTime,
  nextStep,
  stillForSale,
  START_BEFORE_MS,
  LATE_MS,
  tagChanges,
  usualAgainDay,
  usualAgainSubject,
  usualAgainTime,
} from './again.mjs';
import { againRequest } from './again-call.mjs';
import { blankParts } from './parts.mjs';
import { draftSale, forKind, clean } from './special.mjs';
import { FORM_LIKE } from '../nightly-sync.mjs';

const SEND = '2026-11-17'; // a Tuesday; its week is Sun Nov 15 – Sat Nov 21

const at = { day: SEND, time: '10:00' };

test('it goes again at least two days after, in its own week', () => {
  assert.deepEqual(againDays({ send: SEND, ...at }), ['2026-11-19', '2026-11-20', '2026-11-21']);
  // Sent late in the week, fewer days are left; sent Friday, none
  assert.deepEqual(againDays({ send: SEND, day: '2026-11-19', time: '10:00' }), ['2026-11-21']);
  assert.deepEqual(againDays({ send: SEND, day: '2026-11-20', time: '10:00' }), []);
  // Sent Thursday after the page's last time: Saturday has no time left two days after
  assert.deepEqual(againDays({ send: SEND, day: '2026-11-19', time: '20:15' }), []);
});

test('it never goes again after the sale ends, or once a reveal it invites people to has started', () => {
  assert.deepEqual(againDays({ send: SEND, ...at, saleEnds: '2026-11-20' }), ['2026-11-19', '2026-11-20']);
  assert.deepEqual(againDays({ send: SEND, ...at, saleEnds: '2026-11-18' }), []);
  // A reveal Friday at 10 AM Eastern (15:00 UTC): Thursday, and Friday before 10
  const revealStart = '2026-11-20T15:00:00.000Z';
  assert.deepEqual(againDays({ send: SEND, ...at, revealStart }), ['2026-11-19', '2026-11-20']);
  assert.deepEqual(againTimes('2026-11-20', { ...at, revealStart }).slice(-2), ['09:30', '09:45']);
  // Sent Tuesday at 6 PM, the reveal Friday at 10 AM: the usual time (6 PM) would be after it started
  const six = { day: SEND, time: '18:00', revealStart };
  assert.equal(usualAgainTime('2026-11-20', six), '09:45');
  assert.match(checkAgainTime({ againAt: '2026-11-20T23:00:00.000Z', againDay: '2026-11-20', sendAt: '2026-11-17T23:00:00.000Z', days: againDays({ send: SEND, ...six }), revealStart }), /before the reveal starts/);
  // A reveal Thursday at 9 AM: after a Tuesday 10 AM send there's no time left before it
  assert.deepEqual(againDays({ send: SEND, ...at, revealStart: '2026-11-19T14:00:00.000Z' }), []);
});

test('the usual day is the week’s Friday, else the last it can', () => {
  assert.equal(usualAgainDay(['2026-11-19', '2026-11-20', '2026-11-21']), '2026-11-20');
  assert.equal(usualAgainDay(['2026-11-19']), '2026-11-19');
  assert.equal(usualAgainDay([]), null);
});

test('on the second day after, it can’t go before the first send’s time', () => {
  assert.equal(againTimes('2026-11-19', at)[0], '10:00');
  assert.equal(againTimes('2026-11-20', at)[0], '06:00');
  assert.equal(againTimes('2026-11-20', at).at(-1), '20:00');
  assert.equal(usualAgainTime('2026-11-20', at), '10:00');
  assert.equal(usualAgainTime('2026-11-19', { day: SEND, time: '18:00' }), '18:00');
});

test('the server holds it to two days after the first send, by the clock', () => {
  const days = againDays({ send: SEND, ...at });
  const sendAt = '2026-11-17T15:00:00.000Z'; // 10 AM Eastern
  assert.equal(checkAgainTime({ againAt: '2026-11-19T15:00:00.000Z', againDay: '2026-11-19', sendAt, days }), '');
  assert.match(checkAgainTime({ againAt: '2026-11-19T14:45:00.000Z', againDay: '2026-11-19', sendAt, days }), /two days/);
  assert.match(checkAgainTime({ againAt: '2026-11-18T15:00:00.000Z', againDay: '2026-11-18', sendAt, days }), /Thu, Nov 19 to Sat, Nov 21/);
  assert.match(checkAgainTime({ againAt: sendAt, againDay: SEND, sendAt, days: [] }), /no day left/);
});

test('the subject line it goes again with is a new one, and keeps the first one’s rules', () => {
  const sale = draftSale(forKind(clean({ kind: 'percent', percent: 20, ends: '2026-11-22' })));
  const parts = { ...blankParts(), subject: 'Save {upto} this week' };
  const shown = 'Save 20% this week';
  assert.equal(usualAgainSubject(shown), 'In case you missed it: Save 20% this week');
  assert.equal(usualAgainSubject('x'.repeat(70)), 'x'.repeat(70)); // too long to say as a reminder: left as it was, for Staci to change
  assert.equal(checkAgainSubject('In case you missed it: Save 20% this week', { parts, sale, shown }), '');
  assert.match(checkAgainSubject('', { parts, sale, shown }), /Write the subject line/);
  // The same words, or the same once {upto} is written, aren't new
  assert.match(checkAgainSubject('save 20%  this week', { parts, sale, shown }), /new subject line/);
  assert.match(checkAgainSubject('Save {upto} this week', { parts, sale, shown }), /new subject line/);
  // No promise the sale doesn't give
  assert.match(checkAgainSubject('Last chance: 40% off', { parts, sale, shown }), /40%/);
  assert.match(checkAgainSubject('y'.repeat(81), { parts, sale, shown }), /81 characters/);
});

test('it goes only to who didn’t read it, still reads the store’s email, and hasn’t had one lately', () => {
  const S = (...ids) => new Set(ids);
  const { people, left } = againAudience({
    sent: S('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'),
    opened: S('a'),
    clicked: S('b'), // a click without an open (images off) is still reading it
    engaged: S('c', 'f', 'g', 'h', 'i', 'zz'),
    joined: S('d'), // new: no history yet, but in
    lately: S('f'),
    mailed: S('g'),
    noMarketing: S('h'),
  });
  assert.deepEqual([...people].sort(), ['c', 'd', 'i']);
  assert.deepEqual(left, { read: 2, cold: 1, lately: 1, mailed: 1, noMarketing: 1 }); // 'e' is cold; 'zz' wasn't sent it
});

test('the tag is changed to hold exactly the list', () => {
  assert.deepEqual(tagChanges(new Set(['a', 'b']), new Set(['b', 'c'])), { add: ['a'], remove: ['c'] });
  assert.deepEqual(tagChanges(new Set(), new Set(['x'])), { add: [], remove: ['x'] });
});

test('each run knows what’s next', () => {
  const at = Date.parse('2026-11-20T15:00:00.000Z');
  const r = { state: 'waiting', sendAt: new Date(at).toISOString(), tagClean: false };
  assert.equal(nextStep(r, at - START_BEFORE_MS - 1), 'wait');
  assert.equal(nextStep(r, at - START_BEFORE_MS), 'build');
  assert.equal(nextStep(r, at + LATE_MS), 'build');
  assert.equal(nextStep(r, at + LATE_MS + 1), 'late');
  assert.equal(nextStep({ ...r, state: 'scheduled' }, at), 'watch');
  for (const state of ['sent', 'skipped', 'cancelled']) {
    assert.equal(nextStep({ ...r, state }, at), 'clean');
    assert.equal(nextStep({ ...r, state, tagClean: true }, at), 'done');
  }
});

test('the page says where it stands, and only the owner sees what went wrong', () => {
  const when = () => 'Fri, Nov 20, 10:00 AM';
  const r = { send: SEND, subject: 'S', sendAt: 'x', state: 'scheduled', kitId: '9', people: 812, left: { read: 1 }, want: ['1'], note: null, detail: 'Kit said no (500)', stoppedBy: null };
  assert.equal(againLine(r, when), 'Goes again Fri, Nov 20, 10:00 AM to 812 people who haven’t opened it.');
  assert.equal(againLine({ ...r, state: 'waiting' }, when), 'Goes again Fri, Nov 20, 10:00 AM to the people who haven’t opened it.');
  assert.equal(againLine({ ...r, state: 'sent', people: 1 }, when), 'Went again Fri, Nov 20, 10:00 AM to 1 person who hadn’t opened it.');
  assert.equal(againLine({ ...r, state: 'skipped', note: 'Everyone it would have gone to has opened it.' }, when), 'It didn’t go again: Everyone it would have gone to has opened it.');
  assert.equal(againView(r).detail, undefined);
  assert.equal(againView(r).want, undefined);
  assert.equal(againView(r, { owner: true }).detail, 'Kit said no (500)');
});

test('the worker’s call is JSON with its secret, which the site’s cross-site check lets through', () => {
  const { url, init } = againRequest('https://sunnyandranney.com/api/email-again/', 's3cret');
  assert.equal(url, 'https://sunnyandranney.com/api/email-again/');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-again-secret'], 's3cret');
  assert.ok(!FORM_LIKE.includes(init.headers['content-type']));
  assert.ok(url.endsWith('/'), 'the site only matches routes at their slash-ended address');
});

test('a product sold since is left out when it goes again, unless too few are left', () => {
  const product = (title, qty, rank) => ({ title, qty, rank, kind: title, photos: [{ url: 'cf:x', w: 4, h: 3 }] });
  const catalog = new Map([
    ['a', product('Arlo Chair', 1, 1)],
    ['b', product('Bea Lamp', 0, 2)],
    ['c', product('Cleo Table', 2, 3)],
    ['d', product('Dax Sofa', 1, 4)],
    ['e', product('Eve Rug', 1, 5)],
  ]);
  const pick = (handle) => ({ handle, photo: 'cf:x', name: '' });
  // Staci's own order is kept; 'gone' isn't on the website anymore
  const hand = { picks: ['e', 'b', 'a', 'gone', 'c', 'd'].map(pick), arranged: 'hand' };
  const out = stillForSale(hand, catalog);
  assert.equal(out.problem, '');
  assert.deepEqual(out.leftOut, ['Bea Lamp', 'gone']);
  assert.deepEqual(out.wall.picks.map((p) => p.handle), ['e', 'a', 'c', 'd']);
  // Nothing sold: the wall is as it was
  const all = { picks: ['a', 'c', 'd', 'e'].map(pick), arranged: 'auto' };
  assert.equal(stillForSale(all, catalog).wall, all);
  // Fewer than the email shows: it doesn't go again
  const few = stillForSale({ picks: ['a', 'b', 'c', 'd'].map(pick), arranged: 'auto' }, catalog);
  assert.match(few.problem, /Only 3 of its 4 products are still for sale \(Bea Lamp sold\)/);
});

test('when it can’t go again, staff are told what changed, not asked to fix what can’t be changed', () => {
  assert.equal(againProblem(['em-products']), 'Its products changed on the website since it went out.');
  assert.equal(againProblem(['em-photos', 'em-charity', 'em-photos']), 'A photo in it was deleted from the library since it went out, and the family in its charity section isn’t on the charity’s site anymore.');
  assert.equal(againProblem(['em-lines']), 'Something in it changed since it went out.');
});
