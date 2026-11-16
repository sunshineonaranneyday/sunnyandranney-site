/**
 * The store's events: what Staci types in the admin, the email's events section, and the calendar file
 * ===========================================================================
 * An event is a name, its hours, and its dates, each with what's on that day (Kids' Christmas
 * Saturdays: 11am–2pm; Nov 21, write a letter to Santa; ...). Events belong to the store, not to
 * one email: every email shows the dates still ahead on its send day, and the site serves each
 * event's calendar file (/events/<id>.ics) with only the dates still ahead, so a customer never
 * adds one that has passed. No Node or browser APIs: the admin, the API, the calendar file and the
 * weekly build share it.
 */

import { day, monthShort, weekday } from './email.mjs';
import { typeset } from './special.mjs';

export const EVENT_LIMITS = { title: 48, what: 60, note: 80, when: 70, dates: 16 };

/** The showroom, as calendars show it. */
export const PLACE = 'Sunny & Ranney, 109A Oak Street, Roswell, GA';
export const VISIT = 'https://sunnyandranney.com/visit/';

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** A real calendar date: "2026-02-30" has the right shape but no such day. */
const isIso = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const MONTH_DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d/i;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** What Staci typed, tidied. Dates stay in the order she typed them; checkEvent() and the email sort them. */
export function cleanEvent(input) {
  const i = input && typeof input === 'object' ? input : {};
  return {
    id: str(i.id).toLowerCase(),
    title: str(i.title),
    start: isTime(i.start) ? i.start : '',
    end: isTime(i.end) ? i.end : '',
    when: str(i.when),
    dates: (Array.isArray(i.dates) ? i.dates : []).slice(0, EVENT_LIMITS.dates + 4).map((d) => ({
      date: isIso(d?.date) ? d.date : '',
      what: str(d?.what),
      note: str(d?.note),
      greg: d?.greg === true,
    })),
  };
}

/** A new event: one empty date to fill in. */
export const blankEvent = () => ({ id: '', title: '', start: '', end: '', when: '', dates: [{ date: '', what: '', note: '', greg: false }] });

/** The event's address: its name and the year it starts, like "kids-christmas-saturdays-2026". */
export function idFor(title, firstDate) {
  const slug = str(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return [slug || 'event', firstDate ? firstDate.slice(0, 4) : ''].filter(Boolean).join('-');
}

/** The dates, in order. */
export const sortedDates = (ev) => ev.dates.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
const weekdayOf = (iso) => day(iso).getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
/** True when the dates fall on more than one day of the week, so the email needs a "when" to say what's on. */
export const isMixed = (dates) => new Set(dates.map((d) => weekdayOf(d.date))).size > 1;
/** True when every date is a week after the one before: the email can offer all of them as one calendar series. */
export const isWeekly = (dates) => dates.slice(1).every((d, k) => daysBetween(dates[k].date, d.date) === 7);

/**
 * What's wrong, by field, in words Staci can act on. Empty when the event is ready.
 * Date fields are "dates.0.date", "dates.0.what" and so on, in the order she typed them.
 * @returns {Record<string, string>}
 */
export function checkEvent(ev) {
  /** @type {Record<string, string>} */
  const e = {};
  if (!ev.title) e.title = 'Name the event, like “Kids’ Christmas Saturdays”.';
  else if (ev.title.length > EVENT_LIMITS.title) e.title = `The name can be ${EVENT_LIMITS.title} characters at most. This one is ${ev.title.length}.`;
  if (!ev.start) e.start = 'Add when it starts.';
  if (!ev.end) e.end = 'Add when it ends.';
  else if (ev.start && ev.end <= ev.start) e.end = 'It has to end after it starts.';
  if (!ev.dates.length) e.dates = 'Add at least one date.';
  else if (ev.dates.length > EVENT_LIMITS.dates) e.dates = `An event can have ${EVENT_LIMITS.dates} dates at most. Make the rest a new event.`;
  const seen = new Set();
  ev.dates.forEach((d, k) => {
    if (!d.date) e[`dates.${k}.date`] = 'Add the date.';
    else if (seen.has(d.date)) e[`dates.${k}.date`] = 'That date is in twice.';
    seen.add(d.date);
    if (!d.what) e[`dates.${k}.what`] = 'Say what’s on that day.';
    else if (d.what.length > EVENT_LIMITS.what) e[`dates.${k}.what`] = `Keep it to ${EVENT_LIMITS.what} characters. This is ${d.what.length}.`;
    if (d.note.length > EVENT_LIMITS.note) e[`dates.${k}.note`] = `Keep the note to ${EVENT_LIMITS.note} characters. This is ${d.note.length}.`;
  });
  const dates = sortedDates(ev);
  if (dates.length > 1 && isMixed(dates)) {
    if (!ev.when) e.when = 'These dates fall on different days of the week, so say what’s on in a few words, like “Late shopping nights and Saturday crafts for kids”.';
    else if (MONTH_DATE.test(ev.when)) e.when = 'Leave the dates out. The email writes them from the dates still ahead.';
    else if (ev.when.length > EVENT_LIMITS.when) e.when = `Keep it to ${EVENT_LIMITS.when} characters. This is ${ev.when.length}.`;
  }
  if (ev.id && !ID.test(ev.id)) e.title = 'That event’s address is broken. Make it again.';
  return e;
}

/** "11am–2pm", "9–11am", "5:30pm–8pm" (a plain en dash). */
export function hoursLabel(start, end) {
  const part = (t) => {
    const [h, m] = t.split(':').map(Number);
    return { n: `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, ap: h < 12 ? 'am' : 'pm' };
  };
  const a = part(start), b = part(end);
  return a.ap === b.ap ? `${a.n}–${b.n}${b.ap}` : `${a.n}${a.ap}–${b.n}${b.ap}`;
}

/** "Saturdays, Nov 21 to Dec 19 · 11am–2pm" for lists in the admin. */
export function eventSummary(ev, from) {
  const dates = sortedDates(ev).filter((d) => !from || d.date >= from);
  if (!dates.length) return 'No dates ahead';
  const md = (iso) => `${monthShort(day(iso))} ${day(iso).getUTCDate()}`;
  const days = isMixed(dates) ? '' : `${weekday(day(dates[0].date))}${dates.length > 1 ? 's' : ''}, `;
  const span = dates.length > 1 ? `${md(dates[0].date)} to ${md(dates[dates.length - 1].date)}` : md(dates[0].date);
  return `${days}${span}${ev.start && ev.end ? ` · ${hoursLabel(ev.start, ev.end)}` : ''}`;
}

/** The last date, so events that are over can be told apart. */
export const lastDate = (ev) => sortedDates(ev).at(-1)?.date ?? '';

/**
 * The event as the email takes it (one of brief.events), with only what the email's own rules
 * allow for this send date: "when" only when the dates still ahead fall on different weekdays,
 * and calendar links only for a weekly series. Null when no date is still ahead.
 */
export function toBriefEvent(ev, send, site) {
  const all = sortedDates(ev);
  const ahead = all.filter((d) => d.date >= send);
  if (!ahead.length) return null;
  const hours = hoursLabel(ev.start, ev.end);
  const plainTitle = ev.title;
  const out = {
    title: typeset(ev.title),
    time: typeset(hours).replace('–', '&#8211;'),
    items: all.map((d) => ({ date: d.date, what: typeset(d.what), ...(d.note ? { note: typeset(d.note) } : {}), ...(d.greg ? { greg: true } : {}) })),
  };
  if (isMixed(ahead)) out.when = typeset(ev.when);
  // The next date alone, for the card that leads the event: any event, weekly or not
  out.one = { title: `${plainTitle} at Sunny & Ranney`, start: ev.start, end: ev.end, ics: `${site}/events/${ev.id}` };
  if (isWeekly(all)) {
    out.calendar = {
      title: `${plainTitle} at Sunny & Ranney`,
      start: ev.start,
      end: ev.end,
      intro: `${plainTitle}, ${hours.replace('–', '-')}:`,
      ics: `${site}/events/${ev.id}.ics`,
    };
  }
  return out;
}

// ── The calendar file ──────────────────────────────────────────────────────

/** Text for a calendar field: backslashes, semicolons, commas and line breaks escaped (RFC 5545 3.3.11). */
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes continue on the next line after a space (RFC 5545 3.1), never splitting a character. */
function fold(line) {
  const bytes = new TextEncoder();
  let out = '';
  let width = 0;
  for (const ch of line) {
    const n = bytes.encode(ch).length;
    if (width + n > 75) {
      out += '\r\n ';
      width = 1;
    }
    out += ch;
    width += n;
  }
  return out;
}

const stampOf = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
const local = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

/**
 * The event's calendar file: one entry for each date from `today` on, each with what's on that day,
 * in the store's time zone. Apple Calendar and Outlook offer to add them all at once. With `only`,
 * just that date: the email's link under the event's next date. Each date keeps the same UID either
 * way, so adding the date and later the series doesn't put it on a calendar twice.
 * @param {ReturnType<typeof cleanEvent>} ev
 * @param {{ today: string, updatedAt: string, only?: string | null }} at
 */
export function icsFor(ev, { today, updatedAt, only = null }) {
  const dates = sortedDates(ev).filter((d) => d.date >= today && (only === null || d.date === only));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sunny & Ranney//Store events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(`${ev.title} at Sunny & Ranney`)}`,
    // America/New_York since 2007: daylight time from the second Sunday in March to the first in November
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:20070311T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:20071104T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const d of dates) {
    const about = [d.what, d.note].filter(Boolean).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}-${d.date.replace(/-/g, '')}@sunnyandranney.com`,
      `DTSTAMP:${stampOf(updatedAt)}`,
      `DTSTART;TZID=America/New_York:${local(d.date, ev.start)}`,
      `DTEND;TZID=America/New_York:${local(d.date, ev.end)}`,
      `SUMMARY:${icsText(`${ev.title}: ${d.what}`)}`,
      `LOCATION:${icsText(PLACE)}`,
      `DESCRIPTION:${icsText(`${about}\n${hoursLabel(ev.start, ev.end)} at the showroom.`)}`,
      `URL:${VISIT}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
