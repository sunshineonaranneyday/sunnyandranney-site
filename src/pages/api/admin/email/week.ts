import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { checkParts, cleanParts } from '@/lib/sunny-side/parts.mjs';
import { photosByIds } from '@/lib/sunny-side/photo-store.mjs';
import { check, clean, draftSale, forKind, isSendDate } from '@/lib/sunny-side/special.mjs';
import { checkWall, cleanWall } from '@/lib/sunny-side/wall.mjs';
import { clearWeek, otherWeek, putWeek, scheduledRefusal, weekToWorkOn } from '@/lib/sunny-side/week-store.mjs';
import { STORE_TIME_ZONE, localDate } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

const at = new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

/**
 * The send date from a request, or a response saying why it can't be changed: only the email being
 * worked on can (weekToWorkOn), and not while it's scheduled in Kit (scheduledRefusal).
 */
async function sendOf(db: D1Database, body: Record<string, unknown> | null): Promise<string | Response> {
  const send = body?.send;
  if (!isSendDate(send)) return json({ error: 'Invalid request' }, 400);
  const { send: work, week } = await weekToWorkOn(db, localDate(new Date().toISOString()));
  const refused = otherWeek(send as string, work) ?? scheduledRefusal(week);
  return refused ? json({ error: refused }, 409) : (send as string);
}

function conflict(current: { updatedAt: string; updatedBy: string } | null | undefined) {
  const message = current
    ? `${who(current.updatedBy)} saved this email at ${at.format(new Date(current.updatedAt))}. Reload to see it, then make your change again.`
    : 'This email was cleared while you were editing. Reload, then save again.';
  return json({ error: message, current }, 409);
}

/**
 * Saves the week's special and products. Managers only. Either can be left unset (null) until
 * it's ready; what's set has to pass the same checks the page runs. The products' stock is
 * checked in the page against the shop's catalog, and again by the weekly build.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager');
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
  const errors = {
    ...(special ? check(special, send) : {}),
    ...(wall ? checkWall(wall, { send }) : {}),
    ...(parts ? checkParts(parts, { sale, photos }) : {}),
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

/** Takes the week's special and products away. Managers only. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager');
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
