import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { kitClient, readyTester, sendTest, templateFor } from '@/lib/sunny-side/kit.mjs';
import { isSendDate, isSendDay, sendLabel } from '@/lib/sunny-side/special.mjs';
import { otherWeek, weekToWorkOn } from '@/lib/sunny-side/week-store.mjs';
import { TEST_MAX, TESTS_PER_DAY, namesOf, testPeople, testRecipients } from '@/lib/sunny-side/testers.mjs';
import { listPeople, logTest, testsSince } from '@/lib/sunny-side/test-store.mjs';
import { weekEmail } from '@/lib/sunny-side/week-email';
import { localDate } from '@/lib/time-clock/hours.mjs';

export const prerender = false;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sends a test of one Tuesday email, as saved, through Kit, to people on the page's list (and the
 * person sending). Managers only. Kit sends it about a minute later, exactly as subscribers will
 * get it, with "[Test]" before the subject.
 */
export const POST: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager');
  if (admin instanceof Response) return admin;
  const env = context.locals.runtime.env;
  if (!env.KIT_API_KEY) return json({ error: 'The site isn’t connected to Kit: KIT_API_KEY isn’t set.' }, 503);

  const body = await readJson(context.request);
  const send = body?.send;
  if (!isSendDate(send)) return json({ error: 'Invalid request' }, 400);
  const now = new Date();
  const today = localDate(now.toISOString());
  const db = dbOf(context);
  // Only the email being worked on can be tested (weekToWorkOn)
  const refused = otherWeek(send as string, (await weekToWorkOn(db, today, now.getTime())).send);
  if (refused) return json({ error: refused }, 409);
  // The day it'll go, so the test is the email as it'll be that day
  const day = typeof body?.day === 'string' ? body.day : (send as string);
  if (!isSendDay(send, day)) return json({ error: `Pick a day in the ${sendLabel(send as string)} email’s week.` }, 400);

  const people = testPeople(await listPeople(db), admin.email);
  const chosen = testRecipients(body?.to, people);
  if ('error' in chosen) return json({ error: chosen.error }, 400);
  if ((await testsSince(db, new Date(now.getTime() - DAY_MS).toISOString())) >= TESTS_PER_DAY) {
    return json({ error: `That’s ${TESTS_PER_DAY} tests in a day, the most the admin sends. Try again tomorrow.` }, 429);
  }

  const email = await weekEmail(context, send as string, today, day);
  if (!email.ok) return json({ error: `Before a test can go: ${email.problems.join(' ')}`, problems: email.problems }, email.status);

  try {
    const kit = kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined });
    const templateId = await templateFor(kit, env.KIT_TEMPLATE_ID);
    const tagIds = [];
    for (const address of chosen.to) {
      const p = people.find((x) => x.email === address)!;
      // "You" is the person signed in: Kit gets the start of their email as a first name
      const name = p.you ? address.split('@')[0].replace(/^./, (c) => c.toUpperCase()) : p.name;
      tagIds.push(await readyTester(kit, { email: address, name }));
    }
    const sent = await sendTest(kit, {
      subject: email.subject,
      preheader: email.preheader,
      html: email.html,
      templateId,
      tagIds,
      description: `Test of the ${sendLabel(send as string)} email, from the store admin`,
      now: now.getTime(),
    });
    const at = now.toISOString();
    // Kit has it now: a log that doesn't save mustn't say the test didn't go
    await logTest(db, { send, at, by: admin.email, to: chosen.to, kitId: sent.id }).catch((err) => console.error('test log', err));
    return json({ ok: true, test: { at, by: admin.email, to: chosen.to }, names: namesOf(chosen.to, people), max: TEST_MAX });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Kit didn’t send the test. Try again.' }, 502);
  }
};
