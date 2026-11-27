/**
 * Work waiting, shown on the sidebar link where it's done:
 *
 *  - Hours: shifts to review, counted by the rules the Today page lists them.
 *  - Weekly email: when the email to work on (this week's until it has gone out,
 *    then next week's: emailToWorkOn) still needs its sale or products, how long
 *    until its Tuesday, by the rule the Today page asks it.
 *  - Sales tax: a month ready to file, how long until it's due, by the rule the
 *    Sales tax page shows it.
 *
 * So a mark here is always a list or a task on that page, never a second
 * opinion. Only work gets one: no totals, no zeros, at most one a link (Apple:
 * "Reserve badges for critical information"; NN/g: indicators "can introduce
 * noise and clutter"). A mark turns clay when something is wrong or due within
 * REMIND_DAYS, the day the sales-tax worker sends its reminder.
 *
 * Read on every manager page, so the reads run together (one round trip) and a
 * read that fails only loses its own mark.
 */

import { REMIND_DAYS, RECENT_MONTHS, toFileOf } from '../sales-tax/status.mjs';
import { emailNeeds, emailToWorkOn, sendLabel, thisWeeksSend } from '../sunny-side/special.mjs';
import { wentOut } from '../sunny-side/week-store.mjs';
import { addDays, localDate, localInputToUtc, workweekStart } from '../time-clock/hours.mjs';
import { hoursToReview } from './today.mjs';

/**
 * @typedef {object} NavMark
 * @property {string} text What the link shows: a count, or how long until it's due.
 * @property {string} spoken The whole of it, for screen readers and the hover tooltip.
 * @property {'alert' | 'plain'} tone Alert when something is wrong or due soon.
 * @property {number} [count] Set for a count, which a phone tab shows on its icon; a date shows as a dot.
 */

/** @typedef {Record<string, NavMark>} NavStatus Marks by link href. */

/** Counts above this read 99+, so a mark never grows past its pill. */
const MAX_COUNT = 99;

/** How long until something is due, in a word or two: "4 days", "Tomorrow", "Today", "Late". */
export function dueText(daysLeft) {
  if (daysLeft < 0) return 'Late';
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  return `${daysLeft} days`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

/**
 * The marks, from what loadNavStatus read. A source that couldn't be read is
 * undefined and gets no mark; a week with no row yet is null and needs everything.
 * @param {object} input
 * @param {Array<object>} [input.entries] open and unapproved shifts (HOURS_SQL)
 * @param {{ special?: unknown, wall?: unknown } | null} [input.week] the row of the email to work on
 * @param {string} [input.send] which email that is (emailToWorkOn); this week's when not given
 * @param {Array<{ month: string, state: string, filed_at: string | null }>} [input.taxMonths] RECENT_MONTHS
 * @param {string} input.now ISO instant
 * @param {string} [input.myEmail]
 * @returns {NavStatus}
 */
export function navStatus({ entries, week, send, taxMonths, now, myEmail }) {
  /** @type {NavStatus} */
  const marks = {};

  if (entries) {
    const { missed, ready, needsLook } = hoursToReview(entries, { now, myEmail });
    const count = missed.length + ready.length + needsLook.length;
    if (count > 0) {
      const parts = [
        missed.length && `${plural(missed.length, 'shift', 'shifts')} missing a clock-out`,
        needsLook.length && `${plural(needsLook.length, 'shift', 'shifts')} over 12 hours`,
        ready.length && `${plural(ready.length, 'shift', 'shifts')} ready to approve`,
      ].filter(Boolean);
      marks['/admin/hours/'] = {
        text: count > MAX_COUNT ? `${MAX_COUNT}+` : String(count),
        spoken: parts.join(', '),
        tone: missed.length + needsLook.length > 0 ? 'alert' : 'plain',
        count,
      };
    }
  }

  if (week !== undefined) {
    const today = localDate(now);
    const email = send ?? thisWeeksSend(today);
    const needs = emailNeeds(week);
    if (needs.length > 0) {
      const left = days(today, email);
      marks['/admin/email/'] = {
        text: dueText(left),
        spoken: `The ${sendLabel(email)} email needs ${needs.join(' and ')}`,
        tone: left <= REMIND_DAYS ? 'alert' : 'plain',
      };
    }
  }

  if (taxMonths) {
    const toFile = toFileOf(taxMonths, Date.parse(now));
    if (toFile) {
      const { daysLeft } = toFile;
      const when = daysLeft < 0 ? `${plural(-daysLeft, 'day', 'days')} late` : daysLeft === 0 ? 'due today' : `due ${toFile.dueWords.split(',')[0]}`;
      marks['/admin/sales-tax/'] = {
        text: dueText(daysLeft),
        spoken: `${toFile.name} sales tax is ready to file, ${when}`,
        tone: daysLeft <= REMIND_DAYS ? 'alert' : 'plain',
      };
    }
  }

  return marks;
}

/**
 * Open shifts and finished ones not yet approved, from as far back as Today
 * looks: the part of Today's read that hoursToReview uses.
 */
export const HOURS_SQL = `SELECT e.id, e.version, e.staff_id, e.clock_in_at, e.clock_out_at, e.status, e.push_state, s.display_name, s.email
  FROM time_entries e JOIN staff s ON s.id = e.staff_id
  WHERE e.status <> 'rejected' AND e.clock_in_at >= ?
    AND (e.clock_out_at IS NULL OR (e.status = 'pending' AND e.push_state IS NULL))`;

/**
 * Reads what navStatus needs, all at once.
 * @param {any} db D1
 * @param {{ now: string, myEmail?: string }} options
 * @returns {Promise<NavStatus>}
 */
export async function loadNavStatus(db, { now, myEmail }) {
  const today = localDate(now);
  const since = localInputToUtc(`${addDays(workweekStart(today), -60)}T00:00`);
  // undefined when a read fails, so its mark is left off rather than guessed.
  const read = (statement) =>
    statement.all().then(
      (r) => r.results ?? [],
      (err) => {
        console.error('Sidebar:', err);
        return undefined;
      },
    );
  const thisWeek = thisWeeksSend(today);
  const [entries, weeks, taxMonths] = await Promise.all([
    read(db.prepare(HOURS_SQL).bind(since)),
    // This week's email and next week's in one read; the mark is about the one to work on. Every
    // column, so a table from before the Kit columns were added still reads.
    read(db.prepare('SELECT * FROM email_weeks WHERE send_date IN (?, ?)').bind(thisWeek, addDays(thisWeek, 7))),
    read(db.prepare(RECENT_MONTHS)),
  ]);
  const row = (s) => weeks?.find((r) => r.send_date === s) ?? null;
  const asWeek = (r) => r && { kit: r.kit_id && r.kit_send_at ? { sendAt: r.kit_send_at } : null };
  const send = emailToWorkOn(today, (s) => wentOut(asWeek(row(s)), Date.parse(now)));
  return navStatus({ entries, week: weeks && row(send), send, taxMonths, now, myEmail });
}
