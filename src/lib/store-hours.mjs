/**
 * The store's hours in words, as Google has them
 * ===========================================================================
 * The hours-sync worker (workers/hours-sync/) reads the store's Google Business Profile every
 * morning and keeps its hours in D1 as settings:hours: the usual week, Monday first, and the special
 * days Google lists for the week ahead (a holiday, a short day). The weekly email reads them from
 * there each time it's built, so it says what Google says. Until Nov 24, 2026 the email had
 * "Tue–Sat, 10am–5pm, Closed Sun & Mon" typed in, and kept saying it after Google's hours changed
 * to open Sunday and Monday 11am–2pm.
 * No Node or browser APIs: the admin's preview and the server build both use it.
 */

/** @typedef {{ day: string, open: string, close: string, closed: boolean }} HoursDay */
/** @typedef {{ date: string, label?: string, open: string, close: string, closed: boolean }} HoursSpecial */
/** @typedef {{ days: HoursDay[], holidays?: HoursSpecial[] }} StoreHours */

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DASH = '\u2013';
const DAY_MS = 86400000;

/** "10:00" as "10am", "16:30" as "4:30pm", "00:00" as "12am". */
export function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 && h < 24 ? 'pm' : 'am'}`;
}

/** "10am–5pm" */
const span = (open, close) => `${clock(open)}${DASH}${clock(close)}`;

/** One day's hours as the week lists them, or "closed", to tell runs of days alike apart. */
const keyOf = (d) => (!d || d.closed ? 'closed' : `${d.open}-${d.close}`);

/** "Tue–Sat" for three days or more in a row, "Sun & Mon" for two, "Wed" for one. */
function dayRun(names) {
  const short = names.map((n) => n.slice(0, 3));
  if (short.length === 1) return short[0];
  if (short.length === 2) return `${short[0]} & ${short[1]}`;
  return `${short[0]}${DASH}${short[short.length - 1]}`;
}

/**
 * The usual week in lines, days alike together and closed days last: Google's hours on Nov 24,
 * 2026 read ["Tue–Sat, 10am–5pm", "Sun & Mon, 11am–2pm"], and the ones before them
 * ["Tue–Sat, 10am–5pm", "Closed Sun & Mon"]. The week goes round, so Sunday and Monday sit together.
 * @param {HoursDay[]} days
 * @returns {string[]}
 */
export function weekLines(days) {
  const byName = new Map(days.map((d) => [d.day, d]));
  const week = WEEK.map((name) => ({ name, day: byName.get(name) }));
  const keys = week.map((w) => keyOf(w.day));
  if (keys.every((k) => k === keys[0])) {
    return keys[0] === 'closed' ? ['Closed'] : [`Every day, ${span(week[0].day.open, week[0].day.close)}`];
  }
  // Start where one run of days ends, Monday or the first change after it, so no run is split in two
  const start = keys.findIndex((k, i) => k !== keys[(i + 6) % 7]);
  /** @type {{ key: string, names: string[], day: HoursDay | undefined }[]} */
  const runs = [];
  for (let n = 0; n < 7; n++) {
    const { name, day } = week[(start + n) % 7];
    const key = keys[(start + n) % 7];
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.names.push(name);
    else runs.push({ key, names: [name], day });
  }
  const open = runs.filter((r) => r.key !== 'closed').map((r) => `${dayRun(r.names)}, ${span(r.day.open, r.day.close)}`);
  const closed = runs.filter((r) => r.key === 'closed').map((r) => `Closed ${dayRun(r.names)}`);
  return [...open, ...closed];
}

/** The days the store is closed every week, "Closed Sun & Mon", or null when it's open every day. */
export function closedLine(days) {
  return weekLines(days).find((l) => l.startsWith('Closed')) ?? null;
}

/** A 'YYYY-MM-DD' date as a UTC-midnight Date, or null. */
function dateOf(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** US holiday name for a 'YYYY-MM-DD' date, or null: the federal ones and the ones stores keep hours for. */
export function holidayName(iso) {
  const at = dateOf(iso);
  if (!at) return null;
  const m = at.getUTCMonth() + 1;
  const d = at.getUTCDate();
  const dow = at.getUTCDay(); // 0 = Sunday
  if (m === 1 && d === 1) return "New Year's Day";
  if (m === 6 && d === 19) return 'Juneteenth';
  if (m === 7 && d === 4) return 'Independence Day';
  if (m === 11 && d === 11) return 'Veterans Day';
  if (m === 12 && d === 24) return 'Christmas Eve';
  if (m === 12 && d === 25) return 'Christmas Day';
  if (m === 12 && d === 31) return "New Year's Eve";
  if (m === 1 && dow === 1 && d >= 15 && d <= 21) return 'MLK Day';
  if (m === 2 && dow === 1 && d >= 15 && d <= 21) return "Presidents' Day";
  if (m === 5 && dow === 0 && d >= 8 && d <= 14) return "Mother's Day";
  if (m === 5 && dow === 1 && d >= 25 && d <= 31) return 'Memorial Day';
  if (m === 6 && dow === 0 && d >= 15 && d <= 21) return "Father's Day";
  if (m === 9 && dow === 1 && d <= 7) return 'Labor Day';
  if (m === 10 && dow === 1 && d >= 8 && d <= 14) return 'Columbus Day';
  if (m === 11 && dow === 4 && d >= 22 && d <= 28) return 'Thanksgiving';
  if (m === 11 && dow === 5 && d >= 23 && d <= 29) return 'Black Friday';
  return null;
}

/**
 * The days in the week from `from` (the day the email goes) whose hours aren't the usual ones,
 * soonest first: "Wed, Nov 25: 10am–4pm", "Thanksgiving, Nov 26: Closed". Google lists special
 * days only for the coming week, and a day it lists with the usual hours isn't one.
 * @param {StoreHours} hours
 * @param {string} from 'YYYY-MM-DD'
 * @returns {string[]}
 */
export function specialLines(hours, from) {
  const start = dateOf(from);
  if (!start) return [];
  const usual = new Map(hours.days.map((d) => [d.day, d]));
  return (hours.holidays ?? [])
    .map((h) => ({ h, at: dateOf(h.date) }))
    .filter(({ at }) => at && at >= start && at.getTime() - start.getTime() < 7 * DAY_MS)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter(({ h, at }) => keyOf(h) !== keyOf(usual.get(WEEK[(at.getUTCDay() + 6) % 7])))
    .map(({ h, at }) => {
      const name = holidayName(h.date);
      const date = `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
      return `${name ? name : WEEKDAYS[at.getUTCDay()]}, ${date}: ${h.closed ? 'Closed' : span(h.open, h.close)}`;
    });
}

/**
 * The hours the email shows on `from`, the day it goes: the usual week, and the days that week
 * that aren't usual. Null when there are no hours to read (the email then leaves them out).
 * @param {StoreHours | null | undefined} hours
 * @param {string} from
 * @returns {{ week: string[], special: string[] } | null}
 */
export function emailHours(hours, from) {
  if (!hours || !Array.isArray(hours.days) || !hours.days.length) return null;
  return { week: weekLines(hours.days), special: specialLines(hours, from) };
}
