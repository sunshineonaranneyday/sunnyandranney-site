import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { EXTRA_WITHIN_DAYS, isExtraDate, isSendDate, sendLabel } from '@/lib/sunny-side/special.mjs';
import { createExtra } from '@/lib/sunny-side/week-store.mjs';
import { addDays, localDate } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

/**
 * Starts an extra email on a day of its own, besides the weekly one (special.mjs isExtraDate), with
 * the last email's products, photos and charity to start from (createExtra). Managers and email-only
 * logins. Any day from today to EXTRA_WITHIN_DAYS ahead but a Tuesday, the weekly email's, and one
 * email a day.
 */
export const POST: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const body = await readJson(context.request);
  const send = body?.day;
  if (typeof send !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(send)) return json({ error: 'Pick the day it goes.' }, 400);
  if (isSendDate(send)) return json({ error: `${sendLabel(send)} is a Tuesday, the weekly email’s day. Pick another day.` }, 400);
  if (!isExtraDate(send)) return json({ error: 'That isn’t a date.' }, 400);
  const today = localDate(new Date().toISOString());
  if (send < today) return json({ error: 'That day has passed. Pick today or a day ahead.' }, 400);
  if (send > addDays(today, EXTRA_WITHIN_DAYS)) return json({ error: `Pick a day within ${EXTRA_WITHIN_DAYS} days.` }, 400);
  const db = dbOf(context);
  const made = await createExtra(db, { send, by: admin.email, now: new Date().toISOString() });
  if (!made.ok) return json({ error: `There’s already an email for ${sendLabel(send)}. Open it from the list.`, send }, 409);
  return json({ ok: true, send });
};
