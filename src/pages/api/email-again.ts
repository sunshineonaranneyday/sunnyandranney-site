import type { APIRoute } from 'astro';
import { runAgain } from '@/lib/sunny-side/again-run.mjs';
import { kitClient, templateFor } from '@/lib/sunny-side/kit.mjs';
import { runTagCheck } from '@/lib/sunny-side/tag-check.mjs';
import { weekEmail } from '@/lib/sunny-side/week-email';
import { localDate } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

/** Equal strings, in time that doesn't say how much of them matched. */
function sameSecret(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * One run of sending the weekly email again to the people who didn't open it (again-run.mjs). The
 * email-again worker calls this every two minutes with its secret (EMAIL_AGAIN_SECRET); nothing
 * else can. A run does only what's due, so an extra call does no harm. After it, the run takes a
 * step of any check of Kit's "Shopify: no marketing" tag that's been asked for (tag-check.mjs).
 */
export const POST: APIRoute = async (context) => {
  const env = context.locals.runtime.env;
  const secret = env.EMAIL_AGAIN_SECRET;
  const given = context.request.headers.get('x-again-secret') ?? '';
  if (!secret || !given || !sameSecret(given, secret)) return json({ error: 'Not authorized' }, 403);
  if (!env.KIT_API_KEY) return json({ error: 'KIT_API_KEY isn’t set.' }, 503);
  const kit = kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined });
  // Its own try: a check that fails never stops the email going again, nor the other way round
  const tagCheck = () => runTagCheck({ db: env.DB, kit }).catch((err) => ({ check: null, did: [`tag check: ${err?.message ?? err}`] }));
  let result;
  try {
    result = await runAgain({
      db: env.DB,
      kit,
      from: env.KIT_SENDER,
      templateId: () => templateFor(kit, env.KIT_TEMPLATE_ID),
      // Built as of the day it goes again, held to the checks of the day the email itself went (week-email.ts Again)
      build: (send, day, subject, firstDay) => weekEmail(context, send, localDate(new Date().toISOString()), day, { subject, firstDay }),
    });
  } catch (err) {
    await tagCheck();
    throw err;
  }
  const checked = await tagCheck();
  return json(checked ? { ...result, did: [...(result.did ?? []), ...checked.did] } : result);
};
