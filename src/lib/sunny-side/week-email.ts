/**
 * The week's finished email on the server, for a test and for the real send
 * ===========================================================================
 * One function builds it both times, from what's saved: the same pageEmail the page previews, with
 * the shop's catalog as the site published it, the charity's kids from its own database, the
 * events still ahead, the charity's numbers read live, and the store's hours as Google has them
 * (synced each morning into settings:hours). So a test is the email that goes out.
 */
import type { APIContext } from 'astro';
import { readStoreHours } from '@/lib/schedule/store';
import { SITE, lines, plain, render } from './email.mjs';
import { eventsFrom } from './event-store.mjs';
import { toBriefEvent } from './events.mjs';
import { IMPACT_PAGE, impactFromPage } from './impact.mjs';
import { listRevealedKids, listUpcomingReveals } from './kids.mjs';
import { kitProblems, pageEmail } from './page-email.mjs';
import { blankParts, checkParts, isOff } from './parts.mjs';
import { photosByIds } from './photo-store.mjs';
import { check, draftSale } from './special.mjs';
import { checkWall } from './wall.mjs';
import { stillForSale } from './again.mjs';
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
  | { ok: false; problems: string[]; sections?: string[]; status: number }
  | { ok: true; week: NonNullable<Awaited<ReturnType<typeof getWeek>>>; html: string; subject: string; preheader: string; leftOut: string[] };

/**
 * The email as it goes again (again.mjs): a new subject line, and products sold out since left out.
 * It's held to the checks of the day it was approved for (`firstDay`), so a product's "new" or a
 * sale's terms that were right then still are; only what's sold since and what's still ahead change.
 */
export interface Again {
  subject: string;
  firstDay: string;
}

/**
 * The saved week as the finished email, or what's still missing (status says how to answer).
 * `send` is the week's email (its Tuesday); `day` is the day it goes out (sendDays), which the
 * sale's end, the events still ahead and the masthead's date go by.
 */
export async function weekEmail(context: APIContext, send: string, today: string, day: string = send, again: Again | null = null): Promise<WeekEmail> {
  const env = context.locals.runtime.env;
  const db = env.DB;
  const week = await getWeek(db, send);
  const saved = week?.parts ?? blankParts();
  const parts = again ? { ...saved, subject: again.subject } : saved;
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
  // Going again days later, a product sold since is left out, as long as enough are left (again.mjs)
  let leftOut: string[] = [];
  if (again && week?.wall && catalog && !isOff(parts, 'products')) {
    const still = stillForSale(week.wall, catalog);
    if (still.problem) return { ok: false, problems: [still.problem], status: 409 };
    week.wall = still.wall;
    leftOut = still.leftOut;
  }
  const sale = special && !Object.keys(check(special, day)).length ? draftSale(special) : null;
  const checkDay = again ? again.firstDay : day;
  const checkSale = again ? (special && !Object.keys(check(special, checkDay)).length ? draftSale(special) : null) : sale;
  const problems = kitProblems({ special, wall: week?.wall ?? null, parts, photos, kids, reveals, catalog, send: checkDay, check, checkWall, checkParts, sale: checkSale });
  // Going again, the sale must still be on that day (the page only offers days it is)
  if (again && special && !sale && !isOff(parts, 'sale')) problems.push({ text: 'The sale has ended.', section: 'em-sale' });
  if (problems.length || !week) return { ok: false, problems: problems.map((p) => p.text), sections: problems.map((p) => p.section), status: 409 };

  let impact;
  try {
    const res = await fetch(IMPACT_PAGE, { headers: { 'User-Agent': 'sunny-and-ranney-admin' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
    impact = impactFromPage(await res.text());
  } catch (err) {
    return { ok: false, problems: [`Couldn’t read the charity’s numbers from its site (${err instanceof Error ? err.message : err}), so the email would show old ones. Try again in a minute.`], status: 502 };
  }
  const events = (await eventsFrom(db, today)).map((r) => toBriefEvent(r.event, day, SITE)).filter(Boolean);
  const hours = await readStoreHours(db);
  const { brief, sections } = pageEmail({ sale, wall: week.wall, parts, photos, kids, reveals: reveals ?? [], catalog, events, impact, hours, send: day, site: SITE });
  // Kit takes the subject and preview line as plain text, so they go as characters, not HTML
  const { subject, preheader } = lines(brief);
  return { ok: true, week, html: render(brief, sections), subject: plain(subject), preheader: plain(preheader), leftOut };
}
