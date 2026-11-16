import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { broadcastUrl, cancel, kitClient, schedule, statusOf, templateFor } from '@/lib/sunny-side/kit.mjs';
import { isSendDate, isSendDay, sendLabel } from '@/lib/sunny-side/special.mjs';
import { getWeek, otherWeek, setKit, weekToWorkOn } from '@/lib/sunny-side/week-store.mjs';
import { weekEmail } from '@/lib/sunny-side/week-email';
import { localDate, localInputToUtc } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

/** At least this far ahead, so there's time to cancel and Kit has time to queue it. */
const LEAD_MS = 10 * 60 * 1000;

/** The send date from a request, or a response saying why it can't be sent or cancelled: only the email being worked on can (weekToWorkOn). */
async function sendOf(db: D1Database, body: Record<string, unknown> | null): Promise<string | Response> {
  const send = body?.send;
  if (!isSendDate(send)) return json({ error: 'Invalid request' }, 400);
  const { send: work } = await weekToWorkOn(db, localDate(new Date().toISOString()));
  const refused = otherWeek(send as string, work);
  return refused ? json({ error: refused }, 409) : (send as string);
}

/**
 * Schedules the week's email, as saved, to every subscriber, through Kit, on a day of its week
 * (sendDays; Tuesday is the usual one) at a time, Eastern. Managers only. Built as of that day,
 * kept off the web, and checked with Kit once scheduled.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager');
  if (admin instanceof Response) return admin;
  const env = context.locals.runtime.env;
  if (!env.KIT_API_KEY) return json({ error: 'The site isn’t connected to Kit: KIT_API_KEY isn’t set.' }, 503);
  const body = await readJson(context.request);
  const db = dbOf(context);
  const send = await sendOf(db, body);
  if (send instanceof Response) return send;
  const today = localDate(new Date().toISOString());
  const day = typeof body?.day === 'string' ? body.day : send;
  if (!isSendDay(send, day) || day < today) return json({ error: `Pick a day from today to the end of the ${sendLabel(send)} email’s week.` }, 400);
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

  try {
    const templateId = await templateFor(kit, env.KIT_TEMPLATE_ID);
    const sent = await schedule(kit, {
      subject: email.subject,
      preheader: email.preheader,
      html: email.html,
      description: `The Sunny Side for ${sendLabel(send)}${day === send ? '' : `, going ${sendLabel(day)}`}, from the store admin`,
      templateId,
      sendAt,
    });
    const at = new Date().toISOString();
    try {
      await setKit(db, { send, id: sent.id, at, by: admin.email, sendAt: sent.sendAt });
    } catch (err) {
      // Scheduled in Kit but not noted here: take it back out of Kit, so nothing goes that the page can't cancel
      await cancel(kit, sent.id).catch(() => {});
      throw new Error(`It was scheduled in Kit but couldn’t be saved here, so it was taken back out of Kit. Nothing will be sent. Try again. (${err instanceof Error ? err.message : err})`);
    }
    return json({ ok: true, kit: { id: String(sent.id), url: broadcastUrl(sent.id), at, by: admin.email, sendAt: sent.sendAt, status: sent.status } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Kit didn’t schedule it. Try again.' }, 502);
  }
};

/** Cancels the scheduled send, before it goes. Managers only. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager');
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
  return json({ ok: true });
};
