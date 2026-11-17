/**
 * The week's finished email on the server, for a test and for the real send
 * ===========================================================================
 * One function builds it both times, from what's saved: the same pageEmail the page previews, with
 * the shop's catalog as the site published it, the charity's kids from its own database, the
 * events still ahead, and the charity's numbers read live. So a test is the email that goes out.
 */
import type { APIContext } from 'astro';
import { SITE, lines, plain, render } from './email.mjs';
import { eventsFrom } from './event-store.mjs';
import { toBriefEvent } from './events.mjs';
import { IMPACT_PAGE, impactFromPage } from './impact.mjs';
import { listRevealedKids, listUpcomingReveals } from './kids.mjs';
import { kitProblems, pageEmail } from './page-email.mjs';
import { blankParts, checkParts } from './parts.mjs';
import { photosByIds } from './photo-store.mjs';
import { check, draftSale } from './special.mjs';
import { checkWall } from './wall.mjs';
import { getWeek } from './week-store.mjs';

/** The shop's catalog as the site published it, for the products' names and prices, or null. */
async function catalogOf(context: APIContext): Promise<Map<string, unknown> | null> {
  const url = new URL('/shop/catalog.json', context.url);
  const env = context.locals.runtime.env;
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(url) : await fetch(url);
    if (!res.ok) return null;
    const c = (await res.json()) as { products: { handle: string }[] };
    return new Map(c.products.map((p) => [p.handle, p]));
  } catch {
    return null;
  }
}

export type WeekEmail =
  | { ok: false; problems: string[]; status: number }
  | { ok: true; week: NonNullable<Awaited<ReturnType<typeof getWeek>>>; html: string; subject: string; preheader: string };

/**
 * The saved week as the finished email, or what's still missing (status says how to answer).
 * `send` is the week's email (its Tuesday); `day` is the day it goes out (sendDays), which the
 * sale's end, the events still ahead and the masthead's date go by.
 */
export async function weekEmail(context: APIContext, send: string, today: string, day: string = send): Promise<WeekEmail> {
  const env = context.locals.runtime.env;
  const db = env.DB;
  const week = await getWeek(db, send);
  const parts = week?.parts ?? blankParts();
  const photos = new Map((await photosByIds(db, [parts.hero, ...parts.story.photos])).map((p) => [p.id, p]));
  let kids: Awaited<ReturnType<typeof listRevealedKids>> = [];
  try {
    kids = await listRevealedKids(env.SOARD_DB, today);
  } catch (err) {
    return { ok: false, problems: [err instanceof Error ? err.message : String(err)], status: 502 };
  }
  // The charity's reveals, only when the email shows one: its day and time come from the charity's site
  let reveals: Awaited<ReturnType<typeof listUpcomingReveals>> | null = null;
  if (parts.reveal) {
    try {
      reveals = await listUpcomingReveals(env.SOARD_DB, today);
    } catch (err) {
      return { ok: false, problems: [err instanceof Error ? err.message : String(err)], status: 502 };
    }
  }
  const catalog = await catalogOf(context);
  const special = week?.special ?? null;
  const sale = special && !Object.keys(check(special, day)).length ? draftSale(special) : null;
  const problems = kitProblems({ special, wall: week?.wall ?? null, parts, photos, kids, reveals, catalog, send: day, check, checkWall, checkParts, sale });
  if (problems.length || !week) return { ok: false, problems: problems.map((p) => p.text), status: 409 };

  let impact;
  try {
    const res = await fetch(IMPACT_PAGE, { headers: { 'User-Agent': 'sunny-and-ranney-admin' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
    impact = impactFromPage(await res.text());
  } catch (err) {
    return { ok: false, problems: [`Couldn’t read the charity’s numbers from its site (${err instanceof Error ? err.message : err}), so the email would show old ones. Try again in a minute.`], status: 502 };
  }
  const events = (await eventsFrom(db, today)).map((r) => toBriefEvent(r.event, day, SITE)).filter(Boolean);
  const { brief, sections } = pageEmail({ sale, wall: week.wall, parts, photos, kids, reveals: reveals ?? [], catalog, events, impact, send: day, site: SITE });
  // Kit takes the subject and preview line as plain text, so they go as characters, not HTML
  const { subject, preheader } = lines(brief);
  return { ok: true, week, html: render(brief, sections), subject: plain(subject), preheader: plain(preheader) };
}
