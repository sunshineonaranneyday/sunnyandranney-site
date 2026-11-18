/**
 * Sending the weekly email again, to the people who didn't open it
 * ===========================================================================
 * When Staci schedules the week's email she can have it go again, a few days later, to the
 * subscribers who didn't open it, under a new subject line (Peter, 2026-11-17: "can we do it
 * automatically though? as part of the sunny weekly emails?"). These are the rules for it, shared
 * by her page, the server and the run that sends it (again-run.mjs). No Node or browser APIs.
 *
 * Who gets it, and when, follows what the people who send email for a living advise, since Kit
 * itself says to resend "sparingly" (help.kit.com, "Resending to unopens") and Klaviyo's
 * deliverability team doesn't recommend it at all. Each rule keeps the store's mail out of spam
 * folders, which matters more than any one email:
 * - Only people who didn't open or click it. (Kit's own resend does the same.)
 * - Only people who are still reading the store's email: they opened or clicked one of its
 *   emails in the last ENGAGED_DAYS days, or they joined in the last NEW_DAYS. Mailing people who
 *   haven't opened anything in months is what hurts a sender's name with Gmail (suped.com,
 *   "Best practices for resending emails to non-openers": recent engagers, 30 to 60 days).
 * - At least AGAIN_AFTER_HOURS after the first send (suped.com: at least 48 hours; Flodesk: 48
 *   hours to 7 days; Kit: "a few days to a week"), and within the email's own week, while its
 *   sale is on and before any reveal it invites people to.
 * - No one gets one of these more than once in ONCE_PER_DAYS (suped.com: for a weekly email,
 *   one resend per person a month), or within a day of another email from the account: the
 *   charity sends from the same Kit account.
 * - A new subject line (Kit's resend asks for one; every guide says so).
 */

import { addDays, utcToLocalInput } from '../time-clock/hours.mjs';
import { plain } from './email.mjs';
import { checkParts, linesOf } from './parts.mjs';
import { sendDays, sendLabel } from './special.mjs';
import { PICKS, arrange, tileName } from './wall.mjs';

/** The Kit tag the people it goes to get, one at a time, and lose once it's sent. One tag, kept. */
export const AGAIN_TAG = 'Sunny & Ranney weekly email: sent again';
export const AGAIN_AFTER_HOURS = 48;
export const ENGAGED_DAYS = 60;
export const NEW_DAYS = 30;
export const ONCE_PER_DAYS = 28;
/** The Friday of the email's week: three days after a Tuesday, and before the weekend in the showroom. */
const USUAL_WEEKDAY = 5;
const HOUR_MS = 60 * 60 * 1000;
const SUBJECT_MAX = 80;

/** The weekday of a YYYY-MM-DD date, 0 = Sunday. */
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The times of day the page offers: every quarter hour from 6 AM to 8 PM (Send.tsx), as minutes. */
const DAY_FROM = 6 * 60;
const DAY_UNTIL = 20 * 60;
const STEP = 15;

/**
 * The times it can go again on `d`, as "HH:MM": on the second day after, not before the first send's
 * time; on the day of a reveal the email invites people to, only before the reveal starts.
 * @param {string} d @param {{ day: string, time: string, revealStart?: string | null }} at
 */
export function againTimes(d, { day, time, revealStart = null }) {
  const from = d === addDays(day, Math.ceil(AGAIN_AFTER_HOURS / 24)) ? minutesOf(time) : 0;
  const reveal = revealStart ? utcToLocalInput(revealStart) : '';
  if (reveal && d > reveal.slice(0, 10)) return [];
  const before = reveal.slice(0, 10) === d ? minutesOf(reveal.slice(11, 16)) : Infinity;
  const out = [];
  for (let m = DAY_FROM; m <= DAY_UNTIL; m += STEP) if (m >= from && m < before) out.push(hhmm(m));
  return out;
}

/**
 * The days the email can go again: in its week (Sunday to Saturday, sendDays), at least two days
 * after the day it goes, no later than the sale's last day, and before a reveal the email invites
 * people to starts. Only days with a time left (againTimes). Empty when none are left.
 * @param {{ send: string, day: string, time: string, saleEnds?: string | null, revealStart?: string | null }} at
 * @returns {string[]}
 */
export function againDays({ send, day, time, saleEnds = null, revealStart = null }) {
  const first = addDays(day, Math.ceil(AGAIN_AFTER_HOURS / 24));
  return sendDays(send).filter((d) => d >= first && (!saleEnds || d <= saleEnds) && againTimes(d, { day, time, revealStart }).length > 0);
}

/** The day it goes again unless Staci picks another: the week's Friday, else the last day it can. */
export function usualAgainDay(days) {
  return days.find((d) => weekday(d) === USUAL_WEEKDAY) ?? days[days.length - 1] ?? null;
}

/** The time it goes again unless Staci picks another: the first send's time if it can, else the nearest it can. */
export function usualAgainTime(d, at) {
  const times = againTimes(d, at);
  return times.includes(at.time) ? at.time : (times.find((t) => t > at.time) ?? times[times.length - 1] ?? at.time);
}

/** The subject line it goes again with unless Staci writes another: the first one, said as a reminder. */
export function usualAgainSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return '';
  const said = `In case you missed it: ${s}`;
  return said.length <= SUBJECT_MAX ? said : s;
}

/** A subject line as compared: case, spacing and quote marks don't make it new. */
const said = (v) => String(v || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * What's wrong with the subject line it goes again with, or ''. The first one's rules (its length,
 * and no promise the sale doesn't give), and it must be a new one: `shown` is the first as it goes
 * out, {offer} and {upto} written.
 * @param {string} again @param {{ parts: any, sale: any, shown: string }} first
 */
export function checkAgainSubject(again, { parts, sale, shown }) {
  const s = String(again || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Write the subject line it goes again with.';
  const e = checkParts({ ...parts, subject: s }, { sale });
  if (e.subject) return e.subject.replace('The subject line', 'This subject line');
  if (said(plain(linesOf({ ...parts, subject: s }, sale).subject)) === said(shown)) return 'Use a new subject line: a new one gets more of them to open it.';
  return '';
}

/**
 * Whether `againAt` is a time the email can go again, or why not: in the days againDays allows,
 * at least AGAIN_AFTER_HOURS after `sendAt`, and before a reveal the email invites people to.
 * @param {{ againAt: string, againDay: string, sendAt: string, days: string[], revealStart?: string | null }} t
 */
export function checkAgainTime({ againAt, againDay, sendAt, days, revealStart = null }) {
  if (!days.length) return 'There’s no day left in this email’s week to send it again: it needs two days after it goes, while the sale is on.';
  if (!days.includes(againDay)) return days.length === 1 ? `It can only go again ${sendLabel(days[0])}.` : `Pick a day from ${sendLabel(days[0])} to ${sendLabel(days[days.length - 1])} for it to go again.`;
  if (Date.parse(againAt) - Date.parse(sendAt) < AGAIN_AFTER_HOURS * HOUR_MS) return 'It goes again at least two days after it goes out. Pick a later time.';
  if (revealStart && Date.parse(againAt) >= Date.parse(revealStart)) return 'It invites people to a reveal, so it has to go again before the reveal starts. Pick an earlier time.';
  return '';
}

/**
 * Who gets it again. Each set holds Kit subscriber ids (as strings):
 * - sent: everyone the email went to, still subscribed and still on the store's tag;
 * - opened, clicked: who opened or clicked it (a click counts as reading it, even when the mail
 *   app hid the open);
 * - engaged: who opened or clicked any of the store's emails in the last ENGAGED_DAYS days;
 * - joined: who joined in the last NEW_DAYS days;
 * - lately: who got one of these in the last ONCE_PER_DAYS days;
 * - mailed: who got another email from the account (the charity's too) since yesterday;
 * - noMarketing: who has since asked the store for no marketing (kit.mjs NO_MARKETING_TAG).
 * @returns {{ people: Set<string>, left: { read: number, cold: number, lately: number, mailed: number, noMarketing: number } }}
 */
export function againAudience({ sent, opened, clicked, engaged, joined, lately, mailed, noMarketing }) {
  const people = new Set();
  const left = { read: 0, cold: 0, lately: 0, mailed: 0, noMarketing: 0 };
  for (const id of sent) {
    if (noMarketing.has(id)) left.noMarketing++;
    else if (opened.has(id) || clicked.has(id)) left.read++;
    else if (!engaged.has(id) && !joined.has(id)) left.cold++;
    else if (lately.has(id)) left.lately++;
    else if (mailed.has(id)) left.mailed++;
    else people.add(id);
  }
  return { people, left };
}

/** What to change on the tag so it holds exactly `want`. @param {Set<string>} want @param {Set<string>} have */
export function tagChanges(want, have) {
  return { add: [...want].filter((id) => !have.has(id)), remove: [...have].filter((id) => !want.has(id)) };
}

/** When the run starts building the list, and how late it may still go. */
export const START_BEFORE_MS = 2 * HOUR_MS;
export const LATE_MS = 3 * HOUR_MS;

/**
 * What the run does next for one resend (state in again-store.mjs), at `now`:
 * - 'wait': not time to start;
 * - 'build': list who gets it and tag them (again and again, a share each run, until it's ready);
 * - 'late': it's too late to go, so it doesn't;
 * - 'watch': it's in Kit; check whether it has gone;
 * - 'clean': it went, or won't: take the tag back off whoever has it;
 * - 'done': nothing left to do.
 * @param {{ state: string, sendAt: string, tagClean: boolean }} r
 */
export function nextStep(r, now) {
  if (r.state === 'waiting') {
    const at = Date.parse(r.sendAt);
    if (now < at - START_BEFORE_MS) return 'wait';
    if (now > at + LATE_MS) return 'late';
    return 'build';
  }
  if (r.state === 'scheduled') return 'watch';
  return r.tagClean ? 'done' : 'clean';
}

/**
 * How it stands, in words for the page. `people` and `left` once it's listed; `when` formats a time.
 * @param {{ state: string, sendAt: string, people: number | null, note: string | null, by?: string | null }} r
 * @param {(iso: string) => string} when
 */
export function againLine(r, when) {
  const n = (k) => `${k.toLocaleString('en-US')} ${k === 1 ? 'person' : 'people'}`;
  switch (r.state) {
    case 'waiting':
      return `Goes again ${when(r.sendAt)} to the people who haven’t opened it.`;
    case 'scheduled':
      return `Goes again ${when(r.sendAt)} to ${r.people == null ? 'the people who haven’t opened it' : `${n(r.people)} who haven’t opened it`}.`;
    case 'sent':
      return `Went again ${when(r.sendAt)} to ${r.people == null ? 'the people who hadn’t opened it' : `${n(r.people)} who hadn’t opened it`}.`;
    case 'cancelled':
      return 'It won’t go again: it was turned off.';
    default:
      return `It didn’t go again: ${r.note || 'something stopped it.'}`;
  }
}

/**
 * A resend as the page shows it: no list of people, and what went wrong only for the owner.
 * @param {import('./again-store.mjs').Again} r @param {{ owner?: boolean }} [who]
 */
export function againView(r, { owner = false } = {}) {
  return {
    state: r.state,
    sendAt: r.sendAt,
    subject: r.subject,
    people: r.people,
    left: r.left,
    note: r.note,
    stoppedBy: r.stoppedBy,
    kitId: r.kitId,
    ...(owner && r.detail ? { detail: r.detail } : {}),
  };
}

/**
 * The week's products as they go again: one sold since (most of the store's are one of a kind), or
 * taken off the website, is left out, and the rest keep Staci's order (or are arranged again if she
 * left that to the page). With fewer left than the email shows, it doesn't go again: `problem` says why.
 * @template {{ picks: { handle: string, photo: string, name: string }[], arranged: string }} W
 * @param {W} wall
 * @param {Map<string, any>} catalog
 * @returns {{ wall: W, leftOut: string[], problem: string }}
 */
export function stillForSale(wall, catalog) {
  const gone = (p) => !(Number(catalog.get(p.handle)?.qty ?? 0) > 0);
  const keep = wall.picks.filter((p) => !gone(p));
  const leftOut = wall.picks.filter(gone).map((p) => tileName(p, catalog.get(p.handle)) || p.handle);
  if (!leftOut.length) return { wall, leftOut, problem: '' };
  if (keep.length < PICKS[0]) {
    return { wall, leftOut, problem: `Only ${keep.length} of its ${wall.picks.length} products are still for sale (${leftOut.join(', ')} sold), and the email shows at least ${PICKS[0]}.` };
  }
  return { wall: { ...wall, picks: wall.arranged === 'auto' ? /** @type {W['picks']} */ (arrange(keep, catalog)) : keep }, leftOut, problem: '' };
}

/**
 * Why it didn't go again, for staff: the email can't be changed once it has gone out, so this says
 * what changed, not what to fix. By the part of the page each problem belongs to (kitProblems).
 * @param {string[]} sections
 */
export function againProblem(sections) {
  const why = {
    'em-products': 'its products changed on the website since it went out',
    'em-photos': 'a photo in it was deleted from the library since it went out',
    'em-charity': 'the family in its charity section isn’t on the charity’s site anymore',
    'em-story': 'the reveal in it has changed or passed',
    'em-sale': 'its sale has ended',
  };
  const found = [...new Set(sections)].map((k) => why[k]).filter(Boolean);
  const said = found.length ? found.join(', and ') : 'something in it changed since it went out';
  return `${said[0].toUpperCase()}${said.slice(1)}.`;
}
