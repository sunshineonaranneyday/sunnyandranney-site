import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, closedLine, emailHours, holidayName, specialLines, weekLines } from './store-hours.mjs';
import { pageEmail } from './sunny-side/page-email.mjs';
import { render } from './sunny-side/email.mjs';
import { draftSale, clean } from './sunny-side/special.mjs';
import { blankParts } from './sunny-side/parts.mjs';

const day = (name, open, close, closed = false) => ({ day: name, open, close, closed });
const week = (mon, sun, rest = ['10:00', '17:00']) => [
  mon,
  ...['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n) => day(n, ...rest)),
  sun,
];
// The store's hours as the hours-sync worker kept them from Google on Nov 24, 2026
const GOOGLE = {
  days: week(day('Monday', '11:00', '14:00'), day('Sunday', '11:00', '14:00')),
  holidays: [
    { date: '2026-11-25', label: 'Wednesday, November 25', closed: false, open: '10:00', close: '16:00' },
    { date: '2026-11-26', label: 'Thursday, November 26', closed: true, open: '00:00', close: '00:00' },
  ],
  note: '',
};
// And the ones the email had typed in before
const BEFORE = { days: week(day('Monday', '10:00', '17:00', true), day('Sunday', '10:00', '17:00', true)), holidays: [] };

test('times read as a person writes them', () => {
  assert.equal(clock('10:00'), '10am');
  assert.equal(clock('14:00'), '2pm');
  assert.equal(clock('16:30'), '4:30pm');
  assert.equal(clock('12:00'), '12pm');
  assert.equal(clock('00:00'), '12am');
});

test('the usual week: days alike together, round the end of the week, closed days last', () => {
  assert.deepEqual(weekLines(GOOGLE.days), ['Tue–Sat, 10am–5pm', 'Sun & Mon, 11am–2pm']);
  // The hours the email had typed in come out the same as they read
  assert.deepEqual(weekLines(BEFORE.days), ['Tue–Sat, 10am–5pm', 'Closed Sun & Mon']);
  assert.deepEqual(weekLines(week(day('Monday', '10:00', '17:00'), day('Sunday', '12:00', '16:00', true), ['10:00', '17:00']).map((d) => (d.day === 'Saturday' ? day('Saturday', '10:00', '14:00') : d))), [
    'Mon–Fri, 10am–5pm',
    'Sat, 10am–2pm',
    'Closed Sun',
  ]);
  assert.deepEqual(weekLines(week(day('Monday', '10:00', '17:00'), day('Sunday', '10:00', '17:00'))), ['Every day, 10am–5pm']);
  // In whatever order the days come
  assert.deepEqual(weekLines([...GOOGLE.days].reverse()), ['Tue–Sat, 10am–5pm', 'Sun & Mon, 11am–2pm']);
});

test('the visit page says which days are closed from the same hours, or nothing when none are', () => {
  assert.equal(closedLine(GOOGLE.days), null);
  assert.equal(closedLine(BEFORE.days), 'Closed Sun & Mon');
});

test('the days of the email’s week that aren’t usual, named when they’re a holiday', () => {
  assert.equal(holidayName('2026-11-26'), 'Thanksgiving');
  assert.equal(holidayName('2026-12-25'), 'Christmas Day');
  assert.equal(holidayName('2026-11-25'), null);
  assert.deepEqual(specialLines(GOOGLE, '2026-11-24'), ['Wed, Nov 25: 10am–4pm', 'Thanksgiving, Nov 26: Closed']);
  // Only from the day it goes, and for its week
  assert.deepEqual(specialLines(GOOGLE, '2026-11-26'), ['Thanksgiving, Nov 26: Closed']);
  assert.deepEqual(specialLines(GOOGLE, '2026-11-27'), []);
  assert.deepEqual(specialLines(GOOGLE, '2026-11-19'), ['Wed, Nov 25: 10am–4pm']);
  // A day Google lists with its usual hours isn't special
  const same = { ...GOOGLE, holidays: [{ date: '2026-11-28', label: '', closed: false, open: '10:00', close: '17:00' }] };
  assert.deepEqual(specialLines(same, '2026-11-24'), []);
});

test('no hours to read: the email leaves them out', () => {
  assert.equal(emailHours(null, '2026-11-24'), null);
  assert.equal(emailHours({ days: [], holidays: [] }, '2026-11-24'), null);
});

test('the weekly email shows the hours it was built with, not ones typed into it', () => {
  const sale = draftSale(clean({ kind: 'percent', percent: 20, what: 'everything', ends: '2026-11-29' }));
  const build = (hours) => {
    const { brief, sections } = pageEmail({ sale, wall: null, parts: blankParts(), photos: new Map(), kids: [], catalog: null, events: [], impact: null, hours, send: '2026-11-24', site: 'https://sunnyandranney.com' });
    return render(brief, sections);
  };
  const html = build(GOOGLE);
  assert.match(html, />Tue&#8211;Sat,&nbsp;10am&#8211;5pm<br>Sun&nbsp;&amp;&nbsp;Mon,&nbsp;11am&#8211;2pm</);
  assert.doesNotMatch(html, /Closed Sun/);
  assert.match(html, /class="hours-special"[^>]*font-weight:700;[^>]*>Wed, Nov 25:&nbsp;10am&#8211;4pm<br>Thanksgiving, Nov 26:&nbsp;Closed</);
  assert.match(build(BEFORE), />Tue&#8211;Sat,&nbsp;10am&#8211;5pm<br>Closed&nbsp;Sun&nbsp;&amp;&nbsp;Mon</);
  assert.doesNotMatch(build(BEFORE), /hours-special/);
  // Built with none, it says none rather than old ones
  assert.doesNotMatch(build(null), /10am/);
});
