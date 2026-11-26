import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { againView } from '@/lib/sunny-side/again.mjs';
import { stopAgain } from '@/lib/sunny-side/again-run.mjs';
import { kitClient } from '@/lib/sunny-side/kit.mjs';
import { isSendDate } from '@/lib/sunny-side/special.mjs';

export const prerender = false;

/**
 * "Don't send it again": turns off a week's email going again to the people who didn't open it,
 * before it goes. One already in Kit is taken out of Kit. Managers and email-only logins. Any
 * week's, since by then the page is working on the next email.
 */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const env = context.locals.runtime.env;
  if (!env.KIT_API_KEY) return json({ error: 'The site isn’t connected to Kit: KIT_API_KEY isn’t set.' }, 503);
  const body = await readJson(context.request);
  const send = body?.send;
  if (!isSendDate(send)) return json({ error: 'Invalid request' }, 400);
  try {
    const done = await stopAgain({ db: dbOf(context), kit: kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined }), send: send as string, by: admin.email });
    if (!done.ok) return json({ error: done.error }, 409);
    return json({ ok: true, again: done.again && againView(done.again) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Kit didn’t take it out. Try again.' }, 502);
  }
};
