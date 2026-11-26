import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { NO_SALE, checkParts, cleanParts, isOff } from '@/lib/sunny-side/parts.mjs';
import { photosByIds } from '@/lib/sunny-side/photo-store.mjs';
import { check, clean, draftSale, forKind } from '@/lib/sunny-side/special.mjs';
import { checkWall, cleanWall } from '@/lib/sunny-side/wall.mjs';
import { clearWeek, putWeek, scheduledRefusal, workRefusal } from '@/lib/sunny-side/week-store.mjs';
import { STORE_TIME_ZONE, localDate } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

const at = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

/**
 * The send date from a request, or a response saying why it can't be changed: only the weekly email
 * being worked on (weekToWorkOn) or an extra still to go can (workRefusal), and not while it's
 * scheduled in Kit (scheduledRefusal).
 */
async function sendOf(db: D1Database, body: Record<string, unknown> | null): Promise<string | Response> {
  const send = body?.send;
  if (typeof send !== 'string') return json({ error: 'Invalid request' }, 400);
  const { refused, week } = await workRefusal(db, send, localDate(new Date().toISOString()));
  if (refused === 'Invalid request') return json({ error: refused }, 400);
  const why = refused ?? scheduledRefusal(week);
  return why ? json({ error: why }, 409) : send;
}

function conflict(current: { updatedAt: string; updatedBy: string } | null | undefined) {
  const message = current
    ? `${who(current.updatedBy)} saved this email at ${at.format(new Date(current.updatedAt))}. Reload to see it, then make your change again.`
    : 'This email was cleared while you were editing. Reload, then save again.';
  return json({ error: message, current }, 409);
}

/**
 * Saves the week's special and products. Managers and email-only logins. Either can be left unset (null) until
 * it's ready; what's set has to pass the same checks the page runs. The products' stock is
 * checked in the page against the shop's catalog, and again by the weekly build.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;

  const body = await readJson(context.request);
  const db = dbOf(context);
  const send = await sendOf(db, body);
  if (send instanceof Response) return send;
  const since = body?.since;
  if (since !== null && typeof since !== 'string') return json({ error: 'Invalid request' }, 400);

  const special = body?.special == null ? null : clean(body.special);
  const wall = body?.wall == null ? null : cleanWall(body.wall);
  const parts = body?.parts == null ? null : cleanParts(body.parts);
  const photoIds = parts ? [parts.hero, ...parts.story.photos] : [];
  const photos = new Map((await photosByIds(db, photoIds)).map((p) => [p.id, p]));
  const sale = special && !Object.keys(check(special, send)).length ? draftSale(special) : null;
  // A section that's off keeps what's in it, finished or not (parts.mjs SWITCHES)
  const saleOff = isOff(parts, 'sale');
  const errors = {
    ...(special && !saleOff ? check(special, send) : {}),
    ...(wall && !isOff(parts, 'products') ? checkWall(wall, { send }) : {}),
    ...(parts ? checkParts(parts, { sale: saleOff ? NO_SALE : sale, photos }) : {}),
  };
  if (Object.keys(errors).length) return json({ error: 'Some of this email needs fixing.', errors }, 422);

  const saved = await putWeek(db, {
    send,
    special: special ? forKind(special) : null,
    wall: wall && wall.picks.length ? wall : null,
    parts,
    by: admin.email,
    now: new Date().toISOString(),
    since,
  });
  if (!saved.ok) return conflict(saved.current);
  return json({ ok: true, updatedAt: saved.record!.updatedAt, updatedBy: saved.record!.updatedBy });
};

/** Takes the week's special and products away, or deletes an extra email. Managers and email-only logins. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;

  const body = await readJson(context.request);
  const db = dbOf(context);
  const send = await sendOf(db, body);
  if (send instanceof Response) return send;
  if (typeof body?.since !== 'string') return json({ error: 'Invalid request' }, 400);

  const cleared = await clearWeek(db, { send, since: body.since });
  if (!cleared.ok) return conflict(cleared.current);
  return json({ ok: true });
};
