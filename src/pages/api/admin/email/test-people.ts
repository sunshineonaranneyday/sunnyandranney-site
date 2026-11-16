import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { checkPerson, cleanPerson, testPeople } from '@/lib/sunny-side/testers.mjs';
import { addPerson, listPeople, removePerson } from '@/lib/sunny-side/test-store.mjs';

export const prerender = false;

/** Puts someone on the list a weekly email's test can go to. Managers and email-only logins. */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const body = await readJson(context.request);
  const person = cleanPerson(body ?? {});
  const db = dbOf(context);
  const errors = checkPerson(person, testPeople(await listPeople(db), admin.email));
  if (Object.keys(errors).length) return json({ error: Object.values(errors)[0], errors }, 422);
  await addPerson(db, { ...person, by: admin.email, now: new Date().toISOString() });
  return json({ ok: true, person, people: testPeople(await listPeople(db), admin.email) });
};

/** Takes someone off the list. Managers and email-only logins. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const body = await readJson(context.request);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Invalid request' }, 400);
  const db = dbOf(context);
  await removePerson(db, email);
  return json({ ok: true, people: testPeople(await listPeople(db), admin.email) });
};
