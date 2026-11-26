import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { againDays, againView, checkAgainSubject, checkAgainTime } from '@/lib/sunny-side/again.mjs';
import { dropAgain, getAgain, setAgain } from '@/lib/sunny-side/again-store.mjs';
import { listUpcomingReveals } from '@/lib/sunny-side/kids.mjs';
import { broadcastUrl, cancel, dropStrays, kitClient, schedule, statusOf, storeSegmentId, templateFor } from '@/lib/sunny-side/kit.mjs';
import { blankParts, isOff } from '@/lib/sunny-side/parts.mjs';
import { check, draftSale, isExtraDate, isSendDay, sendLabel } from '@/lib/sunny-side/special.mjs';
import { getWeek, setKit, workRefusal } from '@/lib/sunny-side/week-store.mjs';
import { weekEmail } from '@/lib/sunny-side/week-email';
import { localDate, localInputToUtc } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

/** At least this far ahead, so there's time to cancel and Kit has time to queue it. */
const LEAD_MS = 10 * 60 * 1000;

/** The send date from a request, or a response saying why it can't be sent or cancelled: only the weekly email being worked on (weekToWorkOn) or an extra still to go can (workRefusal). */
async function sendOf(db: D1Database, body: Record<string, unknown> | null): Promise<string | Response> {
  const send = body?.send;
  if (typeof send !== 'string') return json({ error: 'Invalid request' }, 400);
  const { refused } = await workRefusal(db, send, localDate(new Date().toISOString()));
  if (refused) return json({ error: refused }, refused === 'Invalid request' ? 400 : 409);
  return send;
}

/** When and how the email goes again to who didn't open it (again.mjs), checked; or why not; or null when it doesn't. */
async function againOf(
  env: { SOARD_DB?: D1Database },
  db: D1Database,
  { body, send, day, time: firstTime, sendAt, today, firstSubject }: { body: Record<string, unknown> | null; send: string; day: string; time: string; sendAt: string; today: string; firstSubject: string },
): Promise<{ subject: string; sendAt: string } | { error: string; field: string } | null> {
  const want = body?.again;
  if (want == null || want === false) return null;
  if (typeof want !== 'object') return { error: 'Invalid request', field: 'again' };
  // An extra email goes once: going again is the weekly email's (again.mjs)
  if (isExtraDate(send)) return { error: 'An extra email doesn’t go again. Turn off “Send it again”.', field: 'again' };
  const a = want as Record<string, unknown>;
  const week = await getWeek(db, send);
  const parts = week?.parts ?? blankParts();
  const special = isOff(parts, 'sale') ? null : (week?.special ?? null);
  const sale = special && !Object.keys(check(special, day)).length ? draftSale(special) : null;
  let revealStart: string | null = null;
  if (parts.reveal) {
    try {
      revealStart = (await listUpcomingReveals(env.SOARD_DB, today)).find((r: { slug: string }) => r.slug === parts.reveal)?.start ?? null;
    } catch {
      return { error: 'The charity’s reveals didn’t load, so when it can go again can’t be checked. Try again in a minute.', field: 'again' };
    }
  }
  const days = againDays({ send, day, time: firstTime, saleEnds: sale && special?.ends ? special.ends : null, revealStart });
  const againDay = typeof a.day === 'string' ? a.day : '';
  const time = typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time) ? a.time : '';
  const againAt = time && againDay ? localInputToUtc(`${againDay}T${time}`) : null;
  if (!againAt) return { error: 'Pick when it goes again.', field: 'again.day' };
  const late = checkAgainTime({ againAt, againDay, sendAt, days, revealStart });
  if (late) return { error: late, field: 'again.day' };
  const subject = typeof a.subject === 'string' ? a.subject.replace(/\s+/g, ' ').trim() : '';
  const wrong = checkAgainSubject(subject, { parts, sale, shown: firstSubject });
  if (wrong) return { error: wrong, field: 'again.subject' };
  return { subject, sendAt: againAt };
}

/**
 * Schedules the week's email, as saved, to the store's subscribers (STORE_SEGMENT), through Kit, on a day of its week
 * (sendDays; Tuesday is the usual one) at a time, Eastern. Managers and email-only logins. Built as of that day,
 * kept off the web, and checked with Kit once scheduled. With `again`, it also goes again days later to the
 * people who didn't open it (again.mjs), checked here first so a wrong time or subject doesn't leave half of it set.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const env = context.locals.runtime.env;
  if (!env.KIT_API_KEY) return json({ error: 'The site isn’t connected to Kit: KIT_API_KEY isn’t set.' }, 503);
  if (!env.KIT_SENDER) return json({ error: 'The site has no sending address for the store’s emails: KIT_SENDER isn’t set. Without it Kit would send them as the charity.' }, 503);
  const body = await readJson(context.request);
  const db = dbOf(context);
  const send = await sendOf(db, body);
  if (send instanceof Response) return send;
  const today = localDate(new Date().toISOString());
  const day = typeof body?.day === 'string' ? body.day : send;
  if (!isSendDay(send, day) || day < today) return json({ error: isExtraDate(send) ? `The ${sendLabel(send)} email goes on its own day.` : `Pick a day from today to the end of the ${sendLabel(send)} email’s week.` }, 400);
  const time = typeof body?.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : '';
  const sendAt = time ? localInputToUtc(`${day}T${time}`) : null;
  if (!sendAt) return json({ error: 'Pick a time for it to go.' }, 400);
  if (Date.parse(sendAt) < Date.now() + LEAD_MS) return json({ error: 'Pick a time at least 10 minutes from now.' }, 400);

  const kit = kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined });
  const already = (await getWeek(db, send))?.kit;
  if (already) {
    // Only if it's still in Kit: one deleted in Kit's own app doesn't count
    const now = await statusOf(kit, already.id).catch(() => null);
    if (now?.status !== 'gone') return json({ error: 'This email is already scheduled. Cancel it first to change the time.' }, 409);
    await setKit(db, { send, id: null });
  }
  const email = await weekEmail(context, send, today, day);
  if (!email.ok) return json({ error: `Before it can be scheduled: ${email.problems.join(' ')}`, problems: email.problems }, email.status);
  const again = await againOf(env, db, { body, send, day, time, sendAt, today, firstSubject: email.subject });
  if (again && 'error' in again) return json({ error: again.error, field: again.field }, 400);

  try {
    const templateId = await templateFor(kit, env.KIT_TEMPLATE_ID);
    const description = `The Sunny Side for ${sendLabel(send)}${day === send ? '' : `, going ${sendLabel(day)}`}, from the store admin`;
    // A try that failed after Kit made it, and couldn't take it back out, must not leave a second copy to go
    await dropStrays(kit, (d) => d.startsWith(`The Sunny Side for ${sendLabel(send)},`) && d.endsWith(', from the store admin'));
    const sent = await schedule(kit, {
      subject: email.subject,
      preheader: email.preheader,
      html: email.html,
      description,
      templateId,
      sendAt,
      from: env.KIT_SENDER,
      audience: { type: 'segment', ids: [await storeSegmentId(kit)] },
    });
    const at = new Date().toISOString();
    try {
      await setKit(db, { send, id: sent.id, at, by: admin.email, sendAt: sent.sendAt });
      if (again) await setAgain(db, { send, subject: again.subject, sendAt: again.sendAt, by: admin.email, now: at });
      else await dropAgain(db, { send, by: admin.email, now: at });
    } catch (err) {
      // Scheduled in Kit but not noted here: take it back out of Kit, so nothing goes that the page can't cancel
      await cancel(kit, sent.id).catch(() => {});
      throw new Error(`It was scheduled in Kit but couldn’t be saved here, so it was taken back out of Kit. Nothing will be sent. Try again. (${err instanceof Error ? err.message : err})`);
    }
    const kitAgain = again ? await getAgain(db, send) : null;
    return json({ ok: true, kit: { id: String(sent.id), url: broadcastUrl(sent.id), at, by: admin.email, sendAt: sent.sendAt, status: sent.status, again: kitAgain && againView(kitAgain) } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Kit didn’t schedule it. Try again.' }, 502);
  }
};

/** Cancels the scheduled send, before it goes. Managers and email-only logins. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const env = context.locals.runtime.env;
  if (!env.KIT_API_KEY) return json({ error: 'The site isn’t connected to Kit: KIT_API_KEY isn’t set.' }, 503);
  const body = await readJson(context.request);
  const db = dbOf(context);
  const send = await sendOf(db, body);
  if (send instanceof Response) return send;
  const kitSend = (await getWeek(db, send))?.kit;
  if (!kitSend) return json({ ok: true });
  try {
    await cancel(kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined }), kitSend.id); // one deleted in Kit is already cancelled
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Kit didn’t cancel it. Try again.' }, 502);
  }
  await setKit(db, { send, id: null });
  // Going again goes with it
  await dropAgain(db, { send, by: admin.email, now: new Date().toISOString() });
  return json({ ok: true });
};
