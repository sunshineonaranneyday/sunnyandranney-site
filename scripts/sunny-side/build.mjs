// Builds the weekly email from its brief: node scripts/sunny-side/build.mjs [--local] [--tests] [brief.json ...]
// With no briefs named, every brief in briefs/ goes to out/ and every stress test in tests/ to out/tests/,
// which verify.mjs then holds to the standard. --tests builds the stress tests alone: they need nothing
// but this repo (no admin database, no store pages), so the pull request check builds them. The email itself is src/lib/sunny-side/email.mjs, the
// same code the admin uses to preview the week's special.
//
// A brief whose "sale", "wall" or "events" is "admin" takes what Staci set at /admin/email/: the
// special and the products she saved for its send date, and the store's events with dates still
// ahead, read from the store's D1 database with wrangler (--local reads the local dev database).
// A brief whose mission "impact" is "live" takes the charity's impact numbers from its own site,
// where its records keep them current.
// Every photo-wall product is read from its own page on sunnyandranney.com (name, price, photo) and
// its stock from the shop's own count, so the email shows what the store shows today and never a
// product it doesn't have.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { lines, render } from '../../src/lib/sunny-side/email.mjs';
import { check, clean, isSendDate, sendLabel, toSale } from '../../src/lib/sunny-side/special.mjs';
import { checkWall, cleanWall, toWall } from '../../src/lib/sunny-side/wall.mjs';
import { checkEvent, cleanEvent, toBriefEvent } from '../../src/lib/sunny-side/events.mjs';
import { IMPACT_PAGE, impactFromPage } from '../../src/lib/sunny-side/impact.mjs';
import { NAME_MAX, displayName, handleOf, isProductPage, photoFor, productFromPage, quantitiesFromShop } from '../../src/lib/sunny-side/product.mjs';
import { SITE } from '../../src/lib/sunny-side/email.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..', '..');
const args = process.argv.slice(2);
const local = args.includes('--local');
const testsOnly = args.includes('--tests');
const briefs = args.filter((a) => a !== '--local' && a !== '--tests');

const ADMIN = 'admin.sunnyandranney.com/admin/email/';

/** Rows from the store's D1 database, or null when the table hasn't been made yet (nothing saved). */
function query(sql) {
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'sunnyandranney-db', local ? '--local' : '--remote', '--json', '--command', sql], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out)[0]?.results ?? [];
  } catch (err) {
    // A table only exists once something is first saved in it
    if (/no such table/i.test(String(err.stdout) + String(err.stderr))) return null;
    throw new Error(`Couldn't read the admin's database with wrangler: ${String(err.stderr || err.message).trim()}`);
  }
}

/** What Staci saved for a send date: { special, wall }, each null until she saves it. */
const weeks = new Map();
function weekFromAdmin(send) {
  if (!isSendDate(send)) throw new Error(`send_date ${send} isn't a Tuesday, so the admin has nothing for it.`);
  if (!weeks.has(send)) {
    const row = query(`SELECT special, wall FROM email_weeks WHERE send_date = '${send}'`)?.[0];
    weeks.set(send, { special: row?.special ? JSON.parse(row.special) : null, wall: row?.wall ? JSON.parse(row.wall) : null });
  }
  return weeks.get(send);
}

/** The special Staci saved for a send date, as the email's offer. */
function specialFromAdmin(send) {
  const saved = weekFromAdmin(send).special;
  if (!saved) throw new Error(`No special is saved for the ${sendLabel(send)} email yet. Staci sets it at ${ADMIN}.`);
  const special = clean(saved);
  const problems = Object.values(check(special, send));
  if (problems.length) throw new Error(`The ${sendLabel(send)} special needs fixing in the admin: ${problems.join(' ')}`);
  return toSale(special);
}

/** The products Staci picked for a send date, as the email's photo wall. The store check comes after, as for any wall. */
function wallFromAdmin(send) {
  const saved = weekFromAdmin(send).wall;
  if (!saved) throw new Error(`No products are picked for the ${sendLabel(send)} email yet. Staci picks them at ${ADMIN}.`);
  const wall = cleanWall(saved);
  const problems = Object.values(checkWall(wall, { send }));
  if (problems.length) throw new Error(`The ${sendLabel(send)} products need fixing in the admin: ${problems.join(' ')}`);
  return toWall(wall, SITE);
}

/** The store's events with dates on or after the send date, soonest first, as the email takes them. */
function eventsFromAdmin(send) {
  const rows = query(`SELECT event FROM store_events WHERE last_date >= '${send}' ORDER BY first_date, id`) ?? [];
  return rows.map((r) => {
    const ev = cleanEvent(JSON.parse(r.event));
    const problems = Object.values(checkEvent(ev));
    if (problems.length) throw new Error(`The event "${ev.title}" needs fixing in the admin: ${problems.join(' ')}`);
    return toBriefEvent(ev, send, SITE);
  }).filter(Boolean);
}

let impact = null;
/** Sunshine on a Ranney Day's room makeovers and children served, as its brand page shows them today. */
async function liveImpact() {
  if (impact) return impact;
  try {
    const res = await fetch(IMPACT_PAGE, { headers: { 'User-Agent': 'sunny-side-build' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`it answered ${res.status}.`);
    impact = impactFromPage(await res.text());
    return impact;
  } catch (err) {
    throw new Error(`Couldn't read the charity's impact numbers from ${IMPACT_PAGE}: ${err.message}`);
  }
}

const SHOP = 'https://sunnyandranney.com/shop/';
const text = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * Each wall product filled from its own page on sunnyandranney.com, where it can be bought: its name
 * (cleaned for customers, unless the brief gives a short one), its price, its photo (unless the brief
 * picks one), and a stock check. Every problem is listed at once, and any problem stops the build.
 * Prices always come from the store. Only the stress tests in tests/ bring their own name and price,
 * so they run offline; a real brief that names a price is stopped, so it can't skip the stock check.
 */
async function productsFromStore(photos, { fixed }) {
  if (fixed) return photos;
  const problems = [];
  let stock;
  try {
    const res = await fetch(SHOP, { headers: { 'User-Agent': 'sunny-side-build' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`it answered ${res.status}.`);
    stock = quantitiesFromShop(await res.text());
  } catch (err) {
    throw new Error(`Couldn't read stock from ${SHOP}: ${err.message}`);
  }
  const filled = await Promise.all(
    photos.map(async (ph, k) => {
      if ('price' in ph) {
        problems.push(`Product ${k + 1} gives its own "price". Take it out: the price comes from the store, with the stock check.`);
        return ph;
      }
      if (!isProductPage(ph.url || '')) {
        problems.push(`Product ${k + 1} needs its page on sunnyandranney.com/shop/ as its "url".`);
        return ph;
      }
      let p;
      try {
        const res = await fetch(ph.url, { headers: { 'User-Agent': 'sunny-side-build' }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`it answered ${res.status}.`);
        p = productFromPage(await res.text());
      } catch (err) {
        problems.push(`Couldn't read ${ph.url}: ${err.message}`);
        return ph;
      }
      const name = ph.name || text(displayName(p.name));
      const qty = stock.get(handleOf(ph.url));
      if (qty === undefined) problems.push(`${name} isn't listed in the shop, so its stock can't be checked. Pick another product.`);
      else if (qty <= 0 || !p.inStock) problems.push(`${name} is out of stock (${qty} in the shop). Pick another product.`);
      if (!ph.name && name.length > NAME_MAX) problems.push(`"${name}" is too long for a tile (${name.length} characters, ${NAME_MAX} at most). Give it a short "name".`);
      const src = ph.src || photoFor(p.images);
      if (!src) problems.push(`${name} has no photo. Give it a "src" photo.`);
      return { ...ph, name, price: p.price, src };
    }),
  );
  const seen = new Set();
  for (const { name } of filled) {
    if (name && seen.has(name.toLowerCase())) problems.push(`Two products would both say "${name}". Give one a name that tells them apart.`);
    seen.add(name?.toLowerCase());
  }
  if (problems.length) throw new Error(`The photo wall needs fixing:\n- ${problems.join('\n- ')}`);
  return filled;
}

/** Builds one brief. Its old email goes first, so a brief that can't be built leaves nothing for verify.mjs to pass. */
async function build(path, out) {
  mkdirSync(out, { recursive: true });
  const name = basename(path, '.json');
  rmSync(join(out, `${name}.html`), { force: true });
  const brief = JSON.parse(readFileSync(path, 'utf8'));
  if (brief.sale === 'admin') brief.sale = specialFromAdmin(brief.send_date);
  if (brief.wall === 'admin') brief.wall = wallFromAdmin(brief.send_date);
  if (brief.events === 'admin') brief.events = eventsFromAdmin(brief.send_date);
  if (brief.mission?.impact === 'live') brief.mission.impact = await liveImpact();
  const fixed = !relative(join(HERE, 'tests'), path).startsWith('..');
  if (brief.wall?.photos) brief.wall.photos = await productsFromStore(brief.wall.photos, { fixed });
  const html = render(brief);
  writeFileSync(join(out, `${name}.html`), html);
  console.log('built', join(relative(HERE, out), name), '·', lines(brief).subject);
}

// Every brief is tried, so one waiting on the admin doesn't hold up the rest; any that fail are
// listed at the end and the build exits 1. With no briefs named, emails whose brief is gone go too.
const failed = [];
async function attempt(path, out) {
  try {
    await build(path, out);
  } catch (err) {
    failed.push(`${relative(HERE, path)}: ${err.message}`);
  }
}
if (briefs.length) {
  for (const path of briefs) await attempt(path, join(HERE, 'out'));
} else {
  const folders = [['briefs', join(HERE, 'out')], ['tests', join(HERE, 'out', 'tests')]].filter(([folder]) => !testsOnly || folder === 'tests');
  for (const [folder, out] of folders) {
    const files = readdirSync(join(HERE, folder)).filter((f) => f.endsWith('.json')).sort();
    const current = new Set(files.map((f) => `${basename(f, '.json')}.html`));
    mkdirSync(out, { recursive: true });
    for (const old of readdirSync(out).filter((f) => f.endsWith('.html') && !current.has(f))) rmSync(join(out, old));
    for (const file of files) await attempt(join(HERE, folder, file), out);
  }
}
if (failed.length) {
  console.error(`\nNot built:\n${failed.map((f) => `- ${f}`).join('\n')}`);
  process.exit(1);
}
