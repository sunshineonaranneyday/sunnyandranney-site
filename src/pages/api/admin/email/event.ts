import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { checkEvent, cleanEvent, idFor, sortedDates } from '@/lib/sunny-side/events.mjs';
import { deleteEvent, putEvent } from '@/lib/sunny-side/event-store.mjs';
import { STORE_TIME_ZONE } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

const at = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

function conflict(title: string, current: { updatedAt: string; updatedBy: string } | null | undefined, isNew: boolean) {
  if (isNew && current) return json({ error: `There’s already an event called “${title}” that year. Edit that one instead.`, current }, 409);
  const message = current
    ? `${who(current.updatedBy)} saved “${title}” at ${at.format(new Date(current.updatedAt))}. Reload to see it, then make your change again.`
    : `“${title}” was deleted while you were editing. Reload, then add it again.`;
  return json({ error: message, current }, 409);
}

/**
 * Saves one of the store's events. Managers and email-only logins. A new event (since: null) gets its address
 * from its name and first date; an event keeps its address after that, because emails already
 * sent link to its calendar file.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;

  const body = await readJson(context.request);
  const since = body?.since;
  if (since !== null && typeof since !== 'string') return json({ error: 'Invalid request' }, 400);
  const event = cleanEvent(body?.event);
  const errors = checkEvent(event);
  if (Object.keys(errors).length) return json({ error: 'Some of the event needs fixing.', errors }, 422);
  if (since === null) event.id = idFor(event.title, sortedDates(event)[0].date);
  else if (!event.id) return json({ error: 'Invalid request' }, 400);

  const saved = await putEvent(dbOf(context), { event, by: admin.email, now: new Date().toISOString(), since });
  if (!saved.ok) return conflict(event.title, saved.current, since === null);
  return json({ ok: true, event: saved.record!.event, updatedAt: saved.record!.updatedAt, updatedBy: saved.record!.updatedBy });
};

/** Takes one of the store's events away. Managers and email-only logins. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;

  const body = await readJson(context.request);
  if (typeof body?.id !== 'string' || typeof body?.since !== 'string') return json({ error: 'Invalid request' }, 400);
  const done = await deleteEvent(dbOf(context), { id: body.id, since: body.since });
  if (!done.ok) return conflict(done.current?.event.title ?? 'The event', done.current, false);
  return json({ ok: true });
};
