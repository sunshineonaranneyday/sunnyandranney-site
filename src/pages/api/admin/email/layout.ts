import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireOwner, requireRole } from '@/lib/admin-http';
import { cleanReport, clearReports, noteReport } from '@/lib/sunny-side/layout-store.mjs';

export const prerender = false;

/**
 * The preview measured a problem in the email's own layout, which nothing typed can fix, so the page
 * reports it here instead of showing whoever is working on the email; the owner sees it on the email
 * page (layout-store.mjs). Managers and email-only logins, whoever has the page open.
 */
export const POST: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const report = cleanReport(await readJson(context.request));
  if (!report) return json({ error: 'Invalid request' }, 400);
  // The row as it now stands: the owner's page shows it as is (how often, since when)
  const saved = await noteReport(dbOf(context), { ...report, by: admin.email, now: new Date().toISOString() });
  return json({ ok: true, report: saved });
};

/** Clears the reports once the layout is fixed. The owner only. */
export const DELETE: APIRoute = async (context) => {
  const admin = requireOwner(context.locals);
  if (admin instanceof Response) return admin;
  await clearReports(dbOf(context));
  return json({ ok: true });
};
