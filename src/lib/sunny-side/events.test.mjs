import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './email.mjs';
import { clean, previewBrief, toSale } from './special.mjs';
import { checkEvent, cleanEvent, eventSummary, hoursLabel, icsFor, idFor, isWeekly, toBriefEvent } from './events.mjs';

const SITE = 'https://sunnyandranney.com';
const saturdays = (extra = {}) =>
  cleanEvent({
    id: 'kids-christmas-saturdays-2026',
    title: 'Kids’ Christmas Saturdays',
    start: '11:00',
    end: '14:00',
    dates: [
      { date: '2026-11-14', what: 'Build a snowman' },
      { date: '2026-11-21', what: 'Write a letter to Santa' },
      { date: '2026-11-28', what: 'Color a Sunny & Ranney Christmas banner' },
      { date: '2026-12-12', what: 'Color a holiday magnet', note: 'Plus pictures with Greg, aka Santa Paws', greg: true },
      { date: '2026-12-05', what: 'Make your own beaded ornament' },
    ],
    ...extra,
  });

test('an event is tidied: times and dates checked for shape, Greg only when ticked', () => {
  const e = cleanEvent({ title: '  Late  nights ', start: '9:00', end: '21:00', dates: [{ date: '2026-02-30', what: ' x ', greg: 'yes' }], junk: 1 });
  assert.equal(e.title, 'Late nights');
  assert.equal(e.start, '');
  assert.equal(e.end, '21:00');
  assert.deepEqual(e.dates, [{ date: '', what: 'x', note: '', greg: false }]);
});

test('what an event needs, in words Staci can act on', () => {
  assert.deepEqual(checkEvent(saturdays()), {});
  const e = checkEvent(cleanEvent({ start: '14:00', end: '11:00', dates: [{ date: '2026-11-21', what: '' }, { date: '2026-11-21', what: 'x'.repeat(61) }] }));
  assert.match(e.title, /Name the event/);
  assert.equal(e.end, 'It has to end after it starts.');
  assert.match(e['dates.0.what'], /Say what’s on/);
  assert.equal(e['dates.1.date'], 'That date is in twice.');
  assert.match(e['dates.1.what'], /60 characters/);
  assert.equal(checkEvent(cleanEvent({ title: 'X', start: '10:00', end: '11:00', dates: [] })).dates, 'Add at least one date.');
});

test('dates on different weekdays need a line saying what’s on, with no dates in it', () => {
  const mixed = (when) => saturdays({ when, dates: [{ date: '2026-11-19', what: 'Late shopping' }, { date: '2026-11-21', what: 'Crafts' }] });
  assert.match(checkEvent(mixed('')).when, /different days of the week/);
  assert.match(checkEvent(mixed('Late nights, Nov 19 and 21')).when, /Leave the dates out/);
  assert.deepEqual(checkEvent(mixed('Late shopping nights and Saturday crafts for kids')), {});
});

test('hours, addresses and summaries read the way people write them', () => {
  assert.equal(hoursLabel('11:00', '14:00'), '11am–2pm');
  assert.equal(hoursLabel('09:00', '11:30'), '9–11:30am');
  assert.equal(hoursLabel('17:30', '20:00'), '5:30–8pm');
  assert.equal(hoursLabel('00:00', '12:00'), '12am–12pm');
  assert.equal(idFor('Kids’ Christmas Saturdays', '2026-11-14'), 'kids-christmas-saturdays-2026');
  assert.equal(idFor('Café & Cookies!', '2027-01-02'), 'cafe-and-cookies-2027');
  assert.equal(eventSummary(saturdays(), '2026-11-17'), 'Saturdays, Nov 21 to Dec 12 · 11am–2pm');
  assert.equal(eventSummary(saturdays(), '2027-01-01'), 'No dates ahead');
});

test('the email gets the event with what its rules allow on that send date', () => {
  const ev = saturdays({ dates: [...saturdays().dates, { date: '2026-12-19', what: 'Decorate your own Christmas cookie', note: '', greg: false }] });
  const b = toBriefEvent(ev, '2026-11-17', SITE);
  assert.equal(b.title, 'Kids’ Christmas Saturdays');
  assert.equal(toBriefEvent(saturdays({ title: "Kids' Saturdays" }), '2026-11-17', SITE).title, 'Kids&#8217; Saturdays');
  assert.equal(b.time, '11am&#8211;2pm');
  assert.equal(b.when, undefined);
  assert.equal(b.items.length, 6);
  assert.equal(b.items[4].greg, true);
  assert.equal(b.items[2].what, 'Color a Sunny &amp; Ranney Christmas banner');
  assert.deepEqual(b.calendar, { title: 'Kids’ Christmas Saturdays at Sunny & Ranney', start: '11:00', end: '14:00', intro: 'Kids’ Christmas Saturdays, 11am-2pm:', ics: `${SITE}/events/kids-christmas-saturdays-2026.ics/` });
  // The email draws it: past dates gone, the calendar from the next date, Greg on his date
  const html = render({ ...previewBrief(toSale(clean({ kind: 'headline', headline: 'Hi' })), '2026-11-17'), events: [b] }, ['events']);
  assert.match(html, /Write a letter to&nbsp;Santa/);
  assert.doesNotMatch(html, /Build a snowman/);
  assert.match(html, /dates=20261121T110000\/20261121T140000/);
  assert.match(html, /RRULE%3AFREQ%3DWEEKLY%3BCOUNT%3D5/);
  assert.match(html, /greg-ranney/);
  assert.equal(toBriefEvent(ev, '2026-12-22', SITE), null);
});

test('calendar links only for a weekly series; "when" only when the dates ahead are mixed', () => {
  const gap = saturdays({ dates: [{ date: '2026-11-21', what: 'A' }, { date: '2026-12-12', what: 'B' }] });
  assert.equal(isWeekly(gap.dates), false);
  assert.equal(toBriefEvent(gap, '2026-11-17', SITE).calendar, undefined);
  const mixed = saturdays({ when: 'Late nights and Saturday crafts', dates: [{ date: '2026-11-19', what: 'Late shopping' }, { date: '2026-11-21', what: 'Crafts' }, { date: '2026-11-28', what: 'Crafts' }] });
  assert.equal(toBriefEvent(mixed, '2026-11-17', SITE).when, 'Late nights and Saturday crafts');
  // By Nov 20 only Saturdays are left, so the email writes the line itself
  assert.equal(toBriefEvent(mixed, '2026-11-20', SITE).when, undefined);
  render({ ...previewBrief(toSale(clean({ kind: 'headline', headline: 'Hi' })), '2026-11-17'), events: [toBriefEvent(mixed, '2026-11-17', SITE)] }, ['events']);
});

test('the calendar file has each date still ahead, in the store’s time zone, folded and escaped', () => {
  const ics = icsFor(saturdays(), { today: '2026-11-17', updatedAt: '2026-11-12T14:00:00.123Z' });
  const lines = ics.split('\r\n');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 4);
  assert.ok(!ics.includes('20261114'));
  assert.ok(lines.includes('DTSTART;TZID=America/New_York:20261121T110000'));
  assert.ok(lines.includes('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU'));
  assert.ok(lines.includes('DTSTAMP:20261112T140000Z'));
  assert.ok(lines.includes('LOCATION:Sunny & Ranney\\, 109A Oak Street\\, Roswell\\, GA'));
  assert.ok(lines.includes('SUMMARY:Kids’ Christmas Saturdays: Color a holiday magnet'));
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'every line is 75 bytes at most');
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /DESCRIPTION:Color a holiday magnet\. Plus pictures with Greg\\, aka Santa Paws\.\\n11am–2pm at the showroom\./);
});

test('the next date gets its own calendar links, for any event; "every date" only when there’s more than one left', () => {
  const sale = toSale(clean({ kind: 'headline', headline: 'Hi' }));
  const draw = (ev, send) => render({ ...previewBrief(sale, send), events: [toBriefEvent(ev, send, SITE)] }, ['events']);
  const b = toBriefEvent(saturdays(), '2026-11-17', SITE);
  assert.deepEqual(b.one, { title: 'Kids’ Christmas Saturdays at Sunny & Ranney', start: '11:00', end: '14:00', site: SITE, id: 'kids-christmas-saturdays-2026' });
  const html = draw(saturdays(), '2026-11-17');
  // In the card: Nov 21 alone, as one Google event and a one-date file
  assert.match(html, /Add Nov 21 to your calendar:/);
  assert.match(html, /\/events\/kids-christmas-saturdays-2026\/2026-11-21\.ics\/\?[^"]*utm_content=next-apple/);
  assert.match(html, /utm_content=next-outlook/);
  assert.match(html, /text=Kids%E2%80%99%20Christmas%20Saturdays%20at%20Sunny%20%26%20Ranney&amp;dates=20261121T110000\/20261121T140000&amp;ctz=America\/New_York&amp;location=[^&]+&amp;details=Write%20a%20letter%20to%20Santa"/);
  // Below: every date still ahead, as before
  assert.match(html, /Add every date to your calendar:/);
  assert.match(html, /\/events\/kids-christmas-saturdays-2026\.ics\/\?[^"]*utm_content=cal-apple/);
  // One date left: the card's links are the only ones
  const last = draw(saturdays(), '2026-12-08');
  assert.match(last, /Add Dec 12 to your calendar:/);
  assert.doesNotMatch(last, /Add every date|Add it to your calendar|cal-apple/);
  // Dates on different weekdays get no series links, but the next one still gets its own
  const mixed = saturdays({ when: 'Late nights and Saturday crafts', dates: [{ date: '2026-11-19', what: 'Late shopping' }, { date: '2026-11-21', what: 'Crafts' }] });
  const m = draw(mixed, '2026-11-17');
  assert.match(m, /Add Nov 19 to your calendar:/);
  assert.doesNotMatch(m, /Add every date/);
});

test('the calendar file for one date has only that date, with the same UID the series gives it', () => {
  const one = icsFor(saturdays(), { today: '2026-11-17', updatedAt: '2026-11-12T14:00:00Z', only: '2026-11-28' });
  const all = icsFor(saturdays(), { today: '2026-11-17', updatedAt: '2026-11-12T14:00:00Z' });
  assert.equal(one.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 1);
  assert.ok(one.includes('DTSTART;TZID=America/New_York:20261128T110000'));
  const uid = (ics, day) => ics.split('\r\n').find((l) => l.startsWith('UID:') && l.includes(day));
  assert.equal(uid(one, '20261128'), uid(all, '20261128'));
  assert.equal(icsFor(saturdays(), { today: '2026-11-17', updatedAt: '2026-11-12T14:00:00Z', only: '2026-11-14' }).includes('BEGIN:VEVENT'), false);
});
