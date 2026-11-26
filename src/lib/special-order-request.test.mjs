import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRequest, emailSuggestion, fieldError, openDaysOf, replyByDate, replyByLong, replyByShort, splitContact } from './special-order-request.mjs';

const good = { handle: 'maverly-rocker-recl-sand-bhf', name: '  Pat   Lee ', contact: ' Pat@Example.com ', note: 'In the sand fabric, two of them' };

test('a good request is cleaned up for the record', () => {
  assert.deepEqual(checkRequest(good), {
    ok: true,
    value: { handle: 'maverly-rocker-recl-sand-bhf', name: 'Pat Lee', email: 'pat@example.com', phone: null, note: 'In the sand fabric, two of them' },
  });
  const byPhone = checkRequest({ ...good, contact: '(678) 888-5140', note: '' });
  assert.equal(byPhone.ok, true);
  assert.deepEqual([byPhone.value.email, byPhone.value.phone, byPhone.value.note], [null, '(678) 888-5140', null]);
  // Email and phone sent separately (an older page) still work.
  assert.equal(checkRequest({ handle: good.handle, name: 'Pat', email: 'pat@example.com' }).value.email, 'pat@example.com');
  assert.equal(checkRequest({ handle: good.handle, name: 'Pat', phone: '678 888 5140' }).value.phone, '678 888 5140');
});

test('one box: an @ makes it an email, anything else a phone number', () => {
  assert.deepEqual(splitContact(' Pat@Example.COM '), { email: 'pat@example.com', phone: null });
  assert.deepEqual(splitContact('678-888-5140'), { email: null, phone: '678-888-5140' });
  assert.deepEqual(splitContact('  '), { email: null, phone: null });
});

test('each mistake names its field and says how to fix it', () => {
  const err = (over) => { const r = checkRequest({ ...good, ...over }); return [r.field, r.error]; };
  assert.deepEqual(err({ name: ' ' }), ['name', 'Enter your name']);
  assert.deepEqual(err({ name: 'x'.repeat(81) }), ['name', 'Name must be 80 characters or fewer']);
  assert.deepEqual(err({ contact: '' }), ['contact', 'Enter an email address or a phone number']);
  assert.deepEqual(err({ contact: 'pat@example' }), ['contact', 'Enter an email address like name@example.com']);
  assert.deepEqual(err({ contact: '888-5140' }), ['contact', 'Enter a phone number with the area code, like (770) 555-0123']);
  assert.deepEqual(err({ contact: 'pat.example.com' }), ['contact', 'Enter an email address like name@example.com, or a phone number']);
  assert.deepEqual(err({ note: 'x'.repeat(1001) }), ['note', 'Note must be 1,000 characters or fewer']);
  // The same words when a shopper leaves the box, before sending.
  assert.equal(fieldError('contact', 'pat@example'), 'Enter an email address like name@example.com');
  assert.equal(fieldError('name', 'Pat'), null);
  // No message talks down: none says please, sorry, invalid or oops.
  for (const [, msg] of [err({ name: '' }), err({ contact: '' }), err({ contact: 'x@y' }), err({ contact: '123' }), err({ note: 'x'.repeat(1001) })]) {
    assert.doesNotMatch(msg, /please|sorry|invalid|oops/i);
  }
});

test('a filled-in hidden box is a bot; a made-up handle is refused', () => {
  assert.equal(checkRequest({ ...good, website: 'http://spam' }).bot, true);
  assert.equal(checkRequest({ ...good, handle: '../admin' }).ok, false);
  assert.equal(checkRequest({ ...good, handle: '' }).ok, false);
});

// The store is open Tuesday to Saturday, as the Google-synced hours in D1 say.
const HOURS = { days: [
  { day: 'Monday', closed: true }, { day: 'Tuesday', closed: false }, { day: 'Wednesday', closed: false },
  { day: 'Thursday', closed: false }, { day: 'Friday', closed: false }, { day: 'Saturday', closed: false }, { day: 'Sunday', closed: true },
] };
const OPEN = openDaysOf(HOURS);

test('open days come from the store hours', () => {
  assert.deepEqual(OPEN, [2, 3, 4, 5, 6]);
  assert.deepEqual(openDaysOf(null), []);
});

test('the reply day is the next open day in Roswell, whatever the shopper\'s clock says', () => {
  // Tuesday 3 PM in Roswell → Wednesday.
  assert.equal(replyByDate(new Date('2026-11-10T20:00:00Z'), OPEN), '2026-11-11');
  // Saturday 11 AM → Tuesday (closed Sunday and Monday).
  assert.equal(replyByDate(new Date('2026-11-14T16:00:00Z'), OPEN), '2026-11-17');
  // Friday 9:30 PM in California is already Saturday 12:30 AM in Roswell → Tuesday, not "tomorrow".
  assert.equal(replyByDate(new Date('2026-11-14T05:30:00Z'), OPEN), '2026-11-17');
  // Monday → Tuesday.
  assert.equal(replyByDate(new Date('2026-11-16T15:00:00Z'), OPEN), '2026-11-17');
  // No hours known → tomorrow.
  assert.equal(replyByDate(new Date('2026-11-14T16:00:00Z'), []), '2026-11-15');
});

test('the page says "tomorrow" or the weekday; the email names the date', () => {
  assert.equal(replyByShort('2026-11-11', new Date('2026-11-10T20:00:00Z')), 'tomorrow');
  assert.equal(replyByShort('2026-11-17', new Date('2026-11-14T16:00:00Z')), 'Tuesday');
  assert.equal(replyByLong('2026-11-17'), 'Tuesday, November 17');
});

test('a likely slip in an email domain is offered as a fix; a fine address gets nothing', () => {
  assert.equal(emailSuggestion('Pat@gmial.com'), 'pat@gmail.com');
  assert.equal(emailSuggestion('pat@exmaple.con'), 'pat@exmaple.com');
  assert.equal(emailSuggestion('pat@gmail.con'), 'pat@gmail.com');
  assert.equal(emailSuggestion('pat@bellsouth.ent'), 'pat@bellsouth.net');
  assert.equal(emailSuggestion('pat@gmail.com'), null);
  assert.equal(emailSuggestion('pat@company.co'), null, 'a real .co address is left alone');
  assert.equal(emailSuggestion('(770) 555-0123'), null);
});
