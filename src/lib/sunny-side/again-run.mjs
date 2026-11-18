/**
 * The run that sends the weekly email again to the people who didn't open it
 * ===========================================================================
 * A small worker (workers/email-again) calls the site every two minutes (/api/email-again/), and
 * the site runs this once. Most runs find nothing to do. For a resend coming up (again-store.mjs):
 *
 * 1. Two hours before its time, once the email itself has gone out, it lists who gets it
 *    (again.mjs: who didn't open it, still reads the store's email, hasn't had one lately) and
 *    checks the list against Kit's own report of the email, so a filter Kit reads differently than
 *    we do can't send it to the wrong people.
 * 2. It tags them in Kit (AGAIN_TAG), a share each run, at a pace that leaves Kit room for the
 *    admin's own calls (an API key gets 120 calls a minute).
 * 3. Fifteen minutes before, it takes off anyone who has opened it since, checks the tag holds
 *    exactly the list, builds the email as of that day (products sold out since are left out), and
 *    schedules it in Kit to that tag, checked like every other send (kit.mjs schedule()).
 *    It goes all at once or not at all: until the tag is right, nothing is scheduled.
 * 4. Once Kit has sent it, it takes the tag back off everyone.
 *
 * If it can't go (the email was cancelled, too few products are left, it's three hours late),
 * it doesn't, and the page says why: in words for staff, with what went wrong for the owner.
 */

import { addDays, localDate } from '../time-clock/hours.mjs';
import { AGAIN_TAG, ENGAGED_DAYS, NEW_DAYS, ONCE_PER_DAYS, againAudience, againProblem, nextStep, tagChanges } from './again.mjs';
import { againsSince, dropLock, getAgain, liveAgains, moveAgain, takeLock } from './again-store.mjs';
import { ACTIVE, addTag, cancel, didWith, dropStrays, filterIds, onTag, removeTag, schedule, sentSince, statsOf, statusOf, storeTags, tagMembers, tagNamed } from './kit.mjs';
import { sendLabel } from './special.mjs';
import { getWeek } from './week-store.mjs';

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
/** It's scheduled in Kit this long before its time, after a last look for anyone who opened it since. */
export const READY_MS = 15 * MIN_MS;
/**
 * Kit wants a time ahead; one late goes this soon after it's ready: long enough for the next run (two
 * minutes on) to find and take out a copy a failed run left in Kit before it could go.
 */
const LEAD_MS = 5 * MIN_MS;
/**
 * Kit calls a run may make, and the gap between them: 60 in about 54 seconds, every two minutes, so
 * Kit's 120 a minute (per API key, shared with the admin) always has room for Staci's own sends.
 */
export const BUDGET = 60;
export const GAP_MS = 900;
/** Calls kept back so making it in Kit and noting it here never runs out partway (schedule() takes up to 5). */
const RESERVE = 10;
/** How far Kit's filter may be from Kit's own report of the email before the list isn't trusted. */
const SENT_SLACK = 0.1;

/** A run's Kit calls ran out (or Kit asked it to slow down): the rest waits for the next run. */
class OutOfCalls extends Error {}

/**
 * Kit, at a pace, up to a number of calls. `sure` is the same pace without the limit, for making a
 * broadcast and taking one back out: those must finish, and Kit asking to slow down there is an
 * error that takes it back out of Kit (schedule()), not a pause.
 */
function paced(kit, { budget, gapMs, sleep }) {
  let used = 0;
  let last = 0;
  const go = async (path, init) => {
    used++;
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return kit.call(path, init);
  };
  return {
    used: () => used,
    left: () => budget - used,
    sure: { call: go },
    async call(path, init) {
      if (used >= budget) throw new OutOfCalls('out of calls');
      try {
        return await go(path, init);
      } catch (err) {
        if (/** @type {{ status?: number }} */ (err).status === 429) throw new OutOfCalls('Kit asked to slow down');
        throw err;
      }
    },
  };
}

const union = (...sets) => new Set(sets.flatMap((s) => [...s]));
/** "A", "A and B", "A, B and C" */
const listed = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The description the resend goes to Kit with; kit.mjs isAgainEmail knows it by this. */
export const againDescription = (send) => `The Sunny Side for ${sendLabel(send)}, again to the people who didn’t open it`;

/**
 * Who gets it, from Kit, and how many were left out and why. Checked against Kit's own report of
 * the email: the list of who it went to must be what the report says, give or take who has left
 * since, and who opened it no more than the report's count.
 */
export async function listPeople(kit, db, { emailId, now }) {
  const today = localDate(new Date(now).toISOString());
  const { store, noMarketing } = await storeTags(kit);
  const recent = await sentSince(kit, addDays(today, -ENGAGED_DAYS));
  const others = recent.filter((b) => b.id !== emailId);
  const storeIds = others.filter((b) => b.store).map((b) => b.id);
  const lastDay = others.filter((b) => Date.parse(b.sentAt) >= now - DAY_MS).map((b) => b.id);
  const sinceEngaged = addDays(today, -ENGAGED_DAYS);
  const lately = await againsSince(db, new Date(now - ONCE_PER_DAYS * DAY_MS).toISOString());
  const none = new Set();
  // Read the store's other emails, or (before there were any) any email from the account
  const engagedBy = (what) =>
    filterIds(kit, [storeIds.length ? didWith(what, storeIds, sinceEngaged) : { type: what, count_greater_than_or_equal: 1, after: sinceEngaged }, onTag(store)]);
  const report = await statsOf(kit, emailId);
  const sent = await filterIds(kit, [didWith('sent', [emailId]), onTag(store), ACTIVE]);
  const opened = await filterIds(kit, [didWith('opens', [emailId])]);
  const clicked = await filterIds(kit, [didWith('clicks', [emailId])]);
  const sets = {
    sent,
    opened,
    clicked,
    engaged: union(await engagedBy('opens'), await engagedBy('clicks')),
    joined: await filterIds(kit, [{ type: 'subscribed', after: addDays(today, -NEW_DAYS) }, onTag(store)]),
    lately: lately.length ? await filterIds(kit, [didWith('sent', lately), onTag(store)]) : none,
    mailed: lastDay.length ? await filterIds(kit, [didWith('sent', lastDay), onTag(store)]) : none,
    noMarketing: await tagMembers(kit, noMarketing),
  };
  const went = report.recipients;
  if (!Number.isInteger(went) || went <= 0) throw new Trust(`Kit’s report of the email gives no number of people it went to (${went}).`);
  if (sent.size > went || sent.size < went * (1 - SENT_SLACK)) {
    throw new Trust(`Kit’s filter found ${sent.size} people the email went to, and Kit’s report says ${went}. It didn’t go again rather than go to the wrong people.`);
  }
  // Both ways: too few found would send it to people who read it, too many would mean the filter isn't this email's
  // (and a filter that finds no one while Kit counts some is the misreading this is for, however few)
  if (!Number.isInteger(report.opened) || Math.abs(opened.size - report.opened) > report.opened * SENT_SLACK + 5 || (report.opened > 0 && opened.size === 0)) {
    throw new Trust(`Kit’s filter found ${opened.size} people who opened the email, and Kit’s report says ${report.opened}. It didn’t go again rather than go to the wrong people.`);
  }
  return againAudience(sets);
}

/** The list couldn't be trusted: it doesn't go, and the owner is told why. */
export class Trust extends Error {}

/**
 * One run. Returns what it did, for the log.
 * @param {{ db: any, kit: { call: Function }, build: (send: string, day: string, subject: string, firstDay: string) => Promise<any>, from: string | undefined,
 *   templateId: () => Promise<number>, now?: number, budget?: number, gapMs?: number, sleep?: (ms: number) => Promise<void> }} deps
 */
export async function runAgain({ db, kit: raw, build, from, templateId, now = Date.now(), budget = BUDGET, gapMs = GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  // A run holds the lock for at most four minutes; one that dies leaves it to the run after next
  const token = await takeLock(db, now, now + 4 * MIN_MS);
  if (!token) return { ran: false, why: 'another run is going' };
  const kit = paced(raw, { budget, gapMs, sleep });
  const did = [];
  try {
    const rows = await liveAgains(db);
    // The tag is one: the resend that's building or in Kit owns it, and an older one's leftovers are its to clear
    const owner = rows.find((r) => r.state === 'scheduled' || nextStep(r, now) === 'build');
    for (const r of rows) {
      const step = nextStep(r, now);
      try {
        // A run stopped while making it in Kit may have left a copy there that nothing here knows of: take it out first
        if (r.creatingAt) {
          const strays = await dropStrays(kit.sure, againDescription(r.send), r.state === 'scheduled' ? r.kitId : null);
          await moveAgain(db, r.send, r.state, { creatingAt: null }, iso(now));
          did.push(`${r.send}: ${strays} unnoted cop${strays === 1 ? 'y' : 'ies'} taken out of Kit`);
          r.creatingAt = null;
        }
        if (step === 'wait' || step === 'done') continue;
        if (step === 'late') did.push(await late(db, r, now));
        else if (step === 'watch') did.push(await watch(kit, db, r, now));
        else if (step === 'clean') did.push(owner && owner.send !== r.send ? await handOver(db, r, now) : await clean(kit, db, r, now));
        else if (step === 'build') did.push(await ready(kit, db, r, { now, build, from, templateId }));
      } catch (err) {
        if (err instanceof OutOfCalls) {
          did.push(`${r.send}: paused (${err.message}), the next run goes on`);
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof Trust) {
          await moveAgain(db, r.send, 'waiting', { state: 'skipped', note: 'Kit’s list of who it would go to didn’t match Kit’s own report of the email, so it didn’t go again.', detail: message }, iso(now));
          did.push(`${r.send}: skipped, ${message}`);
        } else {
          // Tried again next run until it's too late (nextStep 'late'); the owner sees the last error meanwhile
          await moveAgain(db, r.send, r.state, { detail: message }, iso(now));
          did.push(`${r.send}: ${step} failed, ${message}`);
        }
      }
    }
  } finally {
    await dropLock(db, token);
  }
  return { ran: true, did, calls: kit.used() };
}

const iso = (ms) => new Date(ms).toISOString();

async function late(db, r, now) {
  await moveAgain(db, r.send, 'waiting', { state: 'skipped', note: 'It couldn’t be readied in time, so it didn’t go.', detail: r.detail }, iso(now));
  return `${r.send}: too late, skipped`;
}

/**
 * Once it's in Kit: sent; deleted in Kit's own app; or taken off the schedule there (back to a draft,
 * aborted, anything but waiting or sending), which is taken out of Kit too, since its tag is about
 * to be emptied and a draft sent later would go to whoever is on it then.
 */
async function watch(kit, db, r, now) {
  const { status } = await statusOf(kit, r.kitId);
  if (status === 'completed') {
    await moveAgain(db, r.send, 'scheduled', { state: 'sent' }, iso(now));
    return `${r.send}: sent`;
  }
  if (status === 'scheduled' || status === 'sending') return `${r.send}: ${status} in Kit`;
  if (status !== 'gone') await kit.sure.call(`/broadcasts/${r.kitId}`, { method: 'DELETE' });
  await moveAgain(db, r.send, 'scheduled', { state: 'cancelled', note: status === 'gone' ? 'It was deleted in Kit, so it didn’t go.' : 'It was taken off the schedule in Kit, so it didn’t go.' }, iso(now));
  return `${r.send}: ${status} in Kit, cancelled`;
}

/** A newer resend owns the tag and will take these people off it as it builds its own list. */
async function handOver(db, r, now) {
  await moveAgain(db, r.send, r.state, { tagClean: true }, iso(now));
  return `${r.send}: tag handed to a newer resend`;
}

/** Takes the tag back off everyone, a share each run. */
async function clean(kit, db, r, now) {
  const tag = await tagNamed(kit, AGAIN_TAG);
  const have = await tagMembers(kit, tag);
  for (const id of have) await removeTag(kit, tag, id);
  await moveAgain(db, r.send, r.state, { tagClean: true }, iso(now));
  return `${r.send}: tag cleared (${have.size})`;
}

/** Lists, tags, and once the tag is right and it's nearly time, schedules it in Kit. */
async function ready(kit, db, r, { now, build, from, templateId }) {
  const week = await getWeek(db, r.send);
  const email = week?.kit ? await statusOf(kit, week.kit.id) : { status: 'gone' };
  if (email.status === 'gone') {
    await moveAgain(db, r.send, 'waiting', { state: 'skipped', note: 'The email itself was cancelled, so it didn’t go again.' }, iso(now));
    return `${r.send}: the email was cancelled, skipped`;
  }
  if (email.status !== 'completed') return `${r.send}: waiting for the email itself to go (${email.status})`;
  const emailId = Number(week.kit.id);
  const skip = async (note, why) => {
    await moveAgain(db, r.send, 'waiting', { state: 'skipped', note }, iso(now));
    return `${r.send}: skipped, ${why ?? note}`;
  };

  let want = r.want ? new Set(r.want) : null;
  let left = r.left ?? {};
  if (!want) {
    const fresh = await listPeople(kit, db, { emailId, now });
    want = fresh.people;
    left = fresh.left;
    await moveAgain(db, r.send, 'waiting', { want: [...want], people: want.size, left, listedAt: iso(now), detail: null }, iso(now));
  }
  if (!want.size) return skip('No one is left to send it to.');
  // Who comes off before it goes is noted first, so a run that stops partway can't put them back on
  const drop = async (ids, why) => {
    if (!ids.length) return;
    for (const id of ids) want.delete(id);
    left = { ...left, [why]: (left[why] ?? 0) + ids.length };
    await moveAgain(db, r.send, 'waiting', { want: [...want], people: want.size, left }, iso(now));
  };
  const tag = await tagNamed(kit, AGAIN_TAG);
  const { add, remove } = tagChanges(want, await tagMembers(kit, tag));
  for (const id of remove) await removeTag(kit, tag, id);
  const gone = [];
  try {
    for (const id of add) if (!(await addTag(kit, tag, id))) gone.push(id);
  } finally {
    // Someone no longer in Kit can't be tagged, and can't be sent it
    await drop(gone, 'gone');
  }
  const at = Date.parse(r.sendAt);
  if (now < at - READY_MS) return `${r.send}: ${want.size} tagged (${add.length - gone.length} this run), waiting for its time`;

  // Last look: whoever has read it since the list was made, left the store's list or asked for no marketing comes off
  const { store, noMarketing } = await storeTags(kit);
  const read = union(await filterIds(kit, [didWith('opens', [emailId])]), await filterIds(kit, [didWith('clicks', [emailId])]));
  const still = await filterIds(kit, [didWith('sent', [emailId]), onTag(store), ACTIVE]);
  const noMk = await tagMembers(kit, noMarketing);
  await drop([...want].filter((id) => read.has(id)), 'read');
  await drop([...want].filter((id) => !still.has(id)), 'gone');
  await drop([...want].filter((id) => noMk.has(id)), 'noMarketing');
  for (const id of tagChanges(want, await tagMembers(kit, tag)).remove) await removeTag(kit, tag, id);
  const off = tagChanges(want, await tagMembers(kit, tag));
  if (off.add.length || off.remove.length) return `${r.send}: the tag doesn’t match the list yet (${off.add.length} to add, ${off.remove.length} to take off)`;
  if (!want.size) return skip('No one is left to send it to.');

  const day = localDate(r.sendAt);
  const made = await build(r.send, day, r.subject, localDate(week.kit.sendAt));
  if (!made.ok) {
    // Kit, the charity's site or its database not answering is tried again next run; anything else changed for good
    if (made.status >= 500) throw new Error(made.problems.join(' '));
    await moveAgain(db, r.send, 'waiting', { state: 'skipped', note: made.sections?.length ? againProblem(made.sections) : made.problems.join(' '), detail: made.problems.join(' ') }, iso(now));
    return `${r.send}: skipped, ${made.problems.join(' ')}`;
  }
  // Made and noted here as one: not without the calls to finish, and marked first, so a run that stops partway leaves a mark the next run clears up after
  if (kit.left() < RESERVE) return `${r.send}: ready, waiting for the next run to have the calls to schedule it`;
  const templ = await templateId();
  if (!(await moveAgain(db, r.send, 'waiting', { creatingAt: iso(now) }, iso(now)))) return `${r.send}: turned off while readying`;
  await dropStrays(kit.sure, againDescription(r.send));
  const sent = await schedule(kit.sure, {
    subject: made.subject,
    preheader: made.preheader,
    html: made.html,
    description: againDescription(r.send),
    templateId: templ,
    sendAt: iso(Math.max(at, now + LEAD_MS)),
    from,
    audience: { type: 'tag', ids: [tag] },
  });
  const note = made.leftOut?.length ? `${listed(made.leftOut)} sold since, so ${made.leftOut.length === 1 ? 'it’s' : 'they’re'} left out.` : null;
  if (!(await moveAgain(db, r.send, 'waiting', { state: 'scheduled', kitId: String(sent.id), people: want.size, note, detail: null, creatingAt: null }, iso(now)))) {
    // Turned off while it was being made: it doesn't go (and if Kit won't take it out now, the mark makes the next run try)
    await cancel(kit.sure, sent.id);
    await moveAgain(db, r.send, ['cancelled', 'skipped'], { creatingAt: null }, iso(now));
    return `${r.send}: turned off while readying, taken back out of Kit`;
  }
  return `${r.send}: scheduled in Kit for ${sent.sendAt} to ${want.size}`;
}

/**
 * Turns a resend off from the page: it won't go. One already in Kit is taken out of Kit first, and
 * one Kit is sending or has sent can't be stopped.
 */
export async function stopAgain({ db, kit, send, by, now = Date.now() }) {
  const r = await getAgain(db, send);
  if (!r || r.state === 'cancelled' || r.state === 'skipped') return { ok: true, again: r };
  if (r.state === 'sent') return { ok: false, error: 'It has already gone again.' };
  if (r.state === 'scheduled' && r.kitId) await cancel(kit, r.kitId);
  const moved = await moveAgain(db, send, r.state, { state: 'cancelled', stoppedBy: by }, iso(now));
  return moved ? { ok: true, again: await getAgain(db, send) } : { ok: false, error: 'It changed just now. Reload to see where it stands.' };
}
