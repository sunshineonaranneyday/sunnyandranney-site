/**
 * The week's special: what Staci types in the admin, and how it becomes the email's offer
 * ===========================================================================
 * Staci taps one of four ready-made sales and changes a number if she needs to: the deal and
 * its last day, nothing else (Peter, 2026-11-16: "pick a ready-made sale"). Everything else the
 * offer shows (its small label, its words, the button's words and page, the fine print) is the
 * store's, by kind (defaults), so there's nothing to write. clean() turns what she typed into a special, check()
 * says what's wrong in words she can act on (the same rules in her browser and on the
 * server), and toSale() makes the email's offer from it. No Node or browser APIs, so
 * the admin page, the API and the weekly build (scripts/sunny-side/build.mjs) share it.
 */

import { WORKWEEK_START_DAY } from '../time-clock/hours.mjs';
import { day, monthShort, weekday } from './email.mjs';

/** The Sunny Side goes out on Tuesdays (Tue Nov 3 and Tue Nov 10, 2026). 0 = Sunday. */
export const SEND_WEEKDAY = 2;

/** The ready-made sales, in the order the page offers them: the usual one first. */
export const KINDS = {
  percent: { title: 'Percent off everything', hint: 'One discount on the whole order' },
  tiers: { title: 'Spend more, save more', hint: 'Bigger discounts for bigger orders' },
  times: { title: 'By the hour', hint: 'A different percent off by day or hour, like Black Friday' },
  headline: { title: 'No sale this week', hint: 'What’s new instead, with no discount' },
};

/**
 * The store's usual sale: 20% off. Of the 190 orders from Oct 20 to Nov 16, 2026, 148 were
 * discounted 20% at the register; no other discount came close.
 */
export const USUAL_PERCENT = 20;
/**
 * The store's spend-more sale as it last went out, before this admin kept sales: the Nov 3, 2026
 * email ("Our Spend More, Save More Sale Is BACK!"). The ready-made spend-more sale starts here
 * until one is saved in the admin; after that it starts from the last one saved.
 */
export const STORE_TIERS = Object.freeze([
  { spend: 250, percent: 10 },
  { spend: 500, percent: 15 },
  { spend: 1000, percent: 20 },
]);

/** The big line over the deal, by kind: the store's words, not a field to fill. A percent sale's number is its own. */
export const SALE_HEADLINES = { tiers: 'Spend more, save more.', headline: 'New in the showroom this week.' };

/** The last day a sale runs unless she changes it: the Sunday the email's week ends on, or the day itself if that's a Sunday. */
export const usualEnds = (send) => addDays(send, (7 - day(send).getUTCDay()) % 7);

/** The kinds that are a discount, so the email says where it counts and when it ends. */
export const isDiscount = (kind) => kind === 'tiers' || kind === 'percent' || kind === 'times';

/**
 * Every sale counts in the showroom and online, so the fine print always says so and there's
 * nothing to pick (the store, 2026-11-16). Specials saved before then may still carry a `where`;
 * it's ignored.
 */
export const EVERYWHERE = 'In the showroom and online.';

/**
 * Limits from the email's layout: four digits of spend can't be written short exactly unless
 * they're round, and more than four tiers don't fit a phone.
 */
export const LIMITS = {
  percent: [1, 90],
  spend: [50, 50000],
  spendStep: 50,
  tiers: [2, 4],
  // A sale by the hour: as many as tiers, for the same reason (they sit in one row); four only
  // with whole hours, which is all a quarter of a small phone holds (checkWindows)
  windows: [2, 4],
  name: 40,
  endsWithinDays: 60,
};

/**
 * What the offer says around the deal, by kind. Both sales count the whole order (spend more,
 * save more, or a percent off everything), so the button opens the whole shop: the sale page lists
 * only the marked-down items (7 in stock on Nov 11, 2026), so it would hide most of what the sale
 * covers. A week with no sale points at what's new.
 */
export function defaults(kind) {
  if (kind === 'percent' || kind === 'times') return { label: 'Storewide sale', cta: 'Shop the sale', link: '/shop/' };
  if (kind === 'headline') return { label: 'This week', cta: 'See what’s new', link: '/shop/?collection=new-arrivals' };
  return { label: 'This week’s sale', cta: 'Shop the sale', link: '/shop/' };
}

/** A fresh special of a kind: two empty tiers to start from, everything else blank. */
export function blank(kind = 'tiers') {
  return { kind, tiers: [{ spend: null, percent: null }, { spend: null, percent: null }], percent: null, ends: '', name: '', windows: [] };
}

// ── A sale by the hour (Peter, 2026-11-25: "the sale for black friday is 30% 10am-1pm then 25% off
// from 1-5 on black friday, then saturday 25% off everything"): each row is a day, the hours it runs
// that day (or all day), and its percent off everything. Its last day is the sale's last day. ──
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const clockOf = (v) => (typeof v === 'string' && CLOCK.test(v.trim()) ? v.trim() : '');
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** "10am", "1pm", "10:30am", "12pm" from "HH:MM". */
export function clock(t) {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h < 12 ? 'am' : 'pm'}`;
}

/** "10am–1pm", "1–5pm" (one am or pm when both are), or "all day". `dash` is how the dash is written. */
export function hoursOf(from, to, dash = '–') {
  if (!from || !to) return 'all day';
  const a = clock(from);
  const b = clock(to);
  const same = a.slice(-2) === b.slice(-2);
  return `${same ? a.slice(0, -2) : a}${dash}${b}`;
}

/** The rows of a sale by the hour in the order they run: by day, then by the hour they start (all day first). */
export const windowsInOrder = (windows) => [...windows].sort((a, b) => (a.day + (a.from || '')).localeCompare(b.day + (b.from || '')));

/** The last day of a sale by the hour, or '' while no row has a day. */
const lastDayOf = (windows) => windows.map((w) => w.day).filter(isDate).sort().pop() ?? '';

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** A whole number from a form value, or null when it isn't one ("", "abc", 2.5). "$1,000" and "20%" read as 1000 and 20. */
export function whole(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/[$,%\s]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * What Staci typed, tidied: strings trimmed, numbers parsed, everything else dropped. Keeps every
 * kind's fields. A special saved before 2026-11-16 may carry a label, button, link, fine print or
 * "off what"; they're dropped here, so the email never shows something the page can't.
 */
export function clean(input) {
  const i = input && typeof input === 'object' ? input : {};
  const rows = Array.isArray(i.tiers) ? i.tiers : [];
  const kind = Object.hasOwn(KINDS, i.kind) ? i.kind : '';
  const windows = (Array.isArray(i.windows) ? i.windows : []).slice(0, 8).map((w) => ({ day: dateOf(w?.day), from: clockOf(w?.from), to: clockOf(w?.to), percent: whole(w?.percent) }));
  return {
    kind,
    tiers: rows.slice(0, 8).map((r) => ({ spend: whole(r?.spend), percent: whole(r?.percent) })),
    percent: whole(i.percent),
    // A sale by the hour ends on its last row's day: there's no end date to type
    ends: kind === 'times' ? lastDayOf(windows) : typeof i.ends === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.ends) ? i.ends : '',
    name: str(i.name).slice(0, LIMITS.name + 20),
    windows,
  };
}

/** Only the fields the special's kind uses, for saving. A headline week has no discount, so no terms. */
export function forKind(s) {
  if (s.kind === 'tiers') return { kind: s.kind, tiers: s.tiers, ends: s.ends };
  if (s.kind === 'percent') return { kind: s.kind, percent: s.percent, ends: s.ends };
  if (s.kind === 'times') return { kind: s.kind, name: s.name, windows: s.windows, ends: s.ends };
  return { kind: s.kind };
}

const money = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const isDate = (iso) => {
  try {
    day(iso);
    return true;
  } catch {
    return false;
  }
};
const addDays = (iso, n) => new Date(day(iso).getTime() + n * 86400000).toISOString().slice(0, 10);

/**
 * What's wrong, by field, in words Staci can act on. Empty when the special is ready.
 * Tier fields are "tiers.0.spend" and so on; "tiers" alone is about the set of tiers.
 * @returns {Record<string, string>}
 */
export function check(s, send) {
  /** @type {Record<string, string>} */
  const e = {};
  if (!s.kind) e.kind = 'Pick this week’s sale.';
  if (s.kind === 'tiers') {
    const [few, many] = LIMITS.tiers;
    if (s.tiers.length < few) e.tiers = `Add at least ${few} tiers.`;
    else if (s.tiers.length > many) e.tiers = `The email shows ${many} tiers at most.`;
    const [lo, hi] = LIMITS.spend;
    const [pLo, pHi] = LIMITS.percent;
    s.tiers.forEach((t, k) => {
      if (t.spend === null) e[`tiers.${k}.spend`] = 'Add how much they spend, in whole dollars.';
      else if (t.spend < lo || t.spend > hi) e[`tiers.${k}.spend`] = `Use an amount from ${money(lo)} to ${money(hi)}.`;
      else if (t.spend % LIMITS.spendStep) e[`tiers.${k}.spend`] = `Use a round amount, like $250 or $1,000 (a multiple of $${LIMITS.spendStep}).`;
      if (t.percent === null) e[`tiers.${k}.percent`] = 'Add the percent off.';
      else if (t.percent < pLo || t.percent > pHi) e[`tiers.${k}.percent`] = `Use a percent from ${pLo} to ${pHi}.`;
      const prev = s.tiers[k - 1];
      if (k && prev && t.spend !== null && prev.spend !== null && !e[`tiers.${k}.spend`] && t.spend <= prev.spend)
        e[`tiers.${k}.spend`] = `Each tier needs a bigger amount than the one above it (${money(prev.spend)}).`;
      if (k && prev && t.percent !== null && prev.percent !== null && !e[`tiers.${k}.percent`] && t.percent <= prev.percent)
        e[`tiers.${k}.percent`] = `Each tier needs a bigger percent than the one above it (${prev.percent}%).`;
    });
  }
  if (s.kind === 'percent') {
    const [pLo, pHi] = LIMITS.percent;
    if (s.percent === null) e.percent = 'Add the percent off, like 20.';
    else if (s.percent < pLo || s.percent > pHi) e.percent = `Use a percent from ${pLo} to ${pHi}.`;
  }
  if (s.kind === 'times') Object.assign(e, checkWindows(s, send));
  if (isDiscount(s.kind) && s.kind !== 'times') {
    if (!s.ends) e.ends = 'Add the last day of the sale. The email tells customers when it ends.';
  }
  if (isDiscount(s.kind) && s.kind !== 'times' && s.ends) {
    if (!isDate(s.ends)) e.ends = 'That isn’t a date.';
    else if (send && s.ends < send) e.ends = 'The sale can’t end before the email goes out.';
    else if (send && s.ends > addDays(send, LIMITS.endsWithinDays)) e.ends = `Pick an end date within ${LIMITS.endsWithinDays} days of the email.`;
  }
  return e;
}

/**
 * A sale by the hour's problems: its name (the line over the percents), 2 to 4 rows, each with a day
 * from the email's on, its hours (both, with the end after the start) or all day, and a percent; and
 * the rows in the order they run, none starting before the one above it ends.
 * @returns {Record<string, string>}
 */
function checkWindows(s, send) {
  /** @type {Record<string, string>} */
  const e = {};
  const name = s.name ?? '';
  const windows = s.windows ?? [];
  if (!name) e.name = 'Name the sale, like “Black Friday weekend.” It’s the big line over the percents.';
  else if (name.length > LIMITS.name) e.name = `The name is ${name.length} characters; keep it to ${LIMITS.name}.`;
  const [few, many] = LIMITS.windows;
  if (windows.length < few) e.windows = `Add at least ${few} times. With one, pick Percent off everything.`;
  else if (windows.length > many) e.windows = `The email shows ${many} at most.`;
  const [pLo, pHi] = LIMITS.percent;
  windows.forEach((w, k) => {
    if (!w.day) e[`windows.${k}.day`] = 'Pick the day.';
    else if (!isDate(w.day)) e[`windows.${k}.day`] = 'That isn’t a date.';
    else if (send && w.day < send) e[`windows.${k}.day`] = 'That’s before the email goes out.';
    else if (send && w.day > addDays(send, LIMITS.endsWithinDays)) e[`windows.${k}.day`] = `Pick a day within ${LIMITS.endsWithinDays} days of the email.`;
    if (Boolean(w.from) !== Boolean(w.to)) e[`windows.${k}.hours`] = w.from ? 'Pick when it ends, or All day.' : 'Pick when it starts, or All day.';
    else if (w.from && w.to <= w.from) e[`windows.${k}.hours`] = 'It has to end after it starts.';
    // Four across, a quarter of a small phone holds "12pm" but not "12:30pm" (verify.mjs, edge-by-the-hour-4)
    else if (windows.length >= 4 && [w.from, w.to].some((t) => t && !t.endsWith(':00')))
      e[`windows.${k}.hours`] = 'With four times, the email only has room for whole hours (10am, not 10:30am). Use whole hours, or three times.';
    if (w.percent === null) e[`windows.${k}.percent`] = 'Add the percent off.';
    else if (w.percent < pLo || w.percent > pHi) e[`windows.${k}.percent`] = `Use a percent from ${pLo} to ${pHi}.`;
    const prev = windows[k - 1];
    if (!k || !prev?.day || !w.day || e[`windows.${k}.day`] || e[`windows.${k}.hours`]) return;
    if (w.day < prev.day) e[`windows.${k}.day`] = 'Put the times in order: this one comes before the one above it.';
    else if (w.day === prev.day) {
      if (!prev.from) e[`windows.${k}.day`] = 'The one above runs all day that day. Pick another day.';
      else if (!w.from) e[`windows.${k}.hours`] = 'That day has hours above, so give this one its hours too, or pick another day.';
      else if (w.from < prev.to) e[`windows.${k}.hours`] = `It starts before the one above it ends (${clock(prev.to)}).`;
    }
  });
  return e;
}

/** Plain text for the email: HTML-safe, with curly quotes and apostrophes. */
export function typeset(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(^|[\s(\[{])"/g, '$1&#8220;')
    .replace(/"/g, '&#8221;')
    .replace(/(^|[\s(\[{])'/g, '$1&#8216;')
    .replace(/'/g, '&#8217;');
}

/** "Ends Sunday, Nov 22." */
export const endsLine = (iso) => {
  const d = day(iso);
  return `Ends ${weekday(d)}, ${monthShort(d)} ${d.getUTCDate()}.`;
};

/** The terms as the fine print says them: "In the showroom and online. Ends Sunday, Nov 29." */
export function termsLine(s) {
  if (!isDiscount(s.kind)) return '';
  return [EVERYWHERE, s.ends ? endsLine(s.ends) : ''].filter(Boolean).join(' ');
}

/** The email's offer (brief.sale) from a checked special: the deal, with the store's words around it and the terms as the fine print. */
export function toSale(s) {
  const d = defaults(s.kind);
  const sale = { kind: s.kind, name: typeset(d.label), cta: typeset(d.cta), url: d.link };
  if (s.kind === 'tiers') Object.assign(sale, { headline: typeset(SALE_HEADLINES.tiers), tiers: s.tiers.map((t) => [t.spend, t.percent]) });
  if (s.kind === 'percent') Object.assign(sale, { percent: s.percent, what: 'everything.' });
  if (s.kind === 'times') Object.assign(sale, timesSale(s));
  if (s.kind === 'headline') sale.headline = typeset(SALE_HEADLINES.headline);
  const fine = termsLine(s);
  if (fine) sale.details = fine;
  return sale;
}

/**
 * A sale by the hour as the email takes it: its name over the row, and each row's percent, day and
 * hours ("30%", "Fri", "10am–1pm"), in the order they run. The days are short in the row (a third of
 * a 320px phone holds "off Fri", not "off Friday"); `days` names them in full for {offer}.
 */
function timesSale(s) {
  const rows = windowsInOrder(s.windows);
  const short = (iso) => (isDate(iso) ? weekday(day(iso)).slice(0, 3) : '?');
  const long = (iso) => (isDate(iso) ? weekday(day(iso)) : '');
  return {
    headline: typeset(s.name || 'Your sale’s name'),
    windows: rows.map((w) => [w.percent ?? '?', short(w.day), hoursOf(w.from, w.to, '&#8211;')]),
    days: [...new Set(rows.map((w) => long(w.day)).filter(Boolean))],
  };
}

/**
 * The offer as the preview draws it while Staci is still typing: what's missing shows as
 * "?" or a placeholder instead of breaking the preview.
 */
export function draftSale(s) {
  const kind = s.kind || 'tiers';
  const filled = { ...s, kind };
  if (filled.ends && !isDate(filled.ends)) filled.ends = '';
  const sale = toSale(filled);
  if (kind === 'tiers') {
    const rows = s.tiers.slice(0, LIMITS.tiers[1]).map((t) => [t.spend ?? '?', t.percent ?? '?']);
    while (rows.length < LIMITS.tiers[0]) rows.push(['?', '?']);
    sale.tiers = rows;
  }
  if (kind === 'percent' && s.percent === null) sale.percent = '?';
  if (kind === 'times') {
    const rows = sale.windows.slice(0, LIMITS.windows[1]);
    while (rows.length < LIMITS.windows[0]) rows.push(['?', '?', 'all day']);
    sale.windows = rows;
  }
  return sale;
}

/** One line for lists: "10% off $250+ · 15% off $500+" / "20% off everything" / "No sale this week". */
export function summary(s) {
  if (s.kind === 'tiers') return s.tiers.map((t) => `${t.percent}% off ${money(t.spend)}+`).join(' · ');
  if (s.kind === 'percent') return `${s.percent}% off everything`;
  if (s.kind === 'times') return windowsInOrder(s.windows).map((w) => `${w.percent ?? '?'}% ${isDate(w.day) ? weekday(day(w.day)).slice(0, 3) : '?'} ${hoursOf(w.from, w.to)}`).join(' · ');
  return KINDS.headline.title;
}

// ── Send dates ──────────────────────────────────────────────────────────────
/** A weekly email's date: its Tuesday. */
export const isSendDate = (iso) => typeof iso === 'string' && isDate(iso) && day(iso).getUTCDay() === SEND_WEEKDAY;

/**
 * An extra email's date: any day but a Tuesday, the weekly email's day. Now and then the store sends
 * more than one a week (Peter, 2026-11-25: "with black friday, i need to send another email this week
 * and will need the ability to send more than 1 email per week on occasion"). An extra is kept like a
 * week, under its own day, and goes that day only.
 */
export const isExtraDate = (iso) => typeof iso === 'string' && isDate(iso) && day(iso).getUTCDay() !== SEND_WEEKDAY;

/** How far ahead an extra email can be started. */
export const EXTRA_WITHIN_DAYS = 30;

/** Any email's date, weekly or extra. */
export const isEmailDate = (iso) => isSendDate(iso) || isExtraDate(iso);

/** The email for this week: today if it's a Tuesday, else the next Tuesday. */
export function nextSend(today) {
  const d = day(today).getUTCDay();
  return addDays(today, (SEND_WEEKDAY - d + 7) % 7);
}

/**
 * What a week's email still needs before it can go: the sale, the products, or both.
 * Today lists it and the sidebar dates it on Weekly email, from this one rule.
 * @param {{ special?: unknown, wall?: unknown } | null | undefined} week a saved week, or its row
 * @returns {string[]}
 */
export const emailNeeds = (week) => {
  // A section that's off (parts.mjs SWITCHES) isn't needed. `parts` is parsed on a saved week, JSON on its row
  let parts = week?.parts ?? null;
  if (typeof parts === 'string') {
    try {
      parts = JSON.parse(parts);
    } catch {
      parts = null;
    }
  }
  const off = (key) => Array.isArray(parts?.off) && parts.off.includes(key);
  return [week?.special || off('sale') ? '' : 'the sale', week?.wall || off('products') ? '' : 'the products'].filter(Boolean);
};

/**
 * The days an email can go: its week as the store keeps it, Sunday to Saturday (the staff
 * schedule's and Gusto's workweek, WORKWEEK_START_DAY), so every day belongs to one email and
 * the emails go out in order. Its Tuesday is the usual day.
 */
export function sendDays(send) {
  // An extra email goes on its own day
  if (isExtraDate(send)) return [send];
  const start = addDays(send, -((SEND_WEEKDAY - WORKWEEK_START_DAY + 7) % 7));
  return Array.from({ length: 7 }, (_, k) => addDays(start, k));
}

/** True when `d` is one of the days the email for `send` can go: its week's, or an extra's own day. */
export const isSendDay = (send, d) => isEmailDate(send) && typeof d === 'string' && sendDays(send).includes(d);

/** The email whose week today is in: until Saturday, an email can still go out late. */
export const thisWeeksSend = (today) => addDays(today, -((day(today).getUTCDay() - WORKWEEK_START_DAY + 7) % 7) + ((SEND_WEEKDAY - WORKWEEK_START_DAY + 7) % 7));

/**
 * The email to work on: this week's, unless it has already gone out, then next week's. The email
 * page opens on it and the Today page's task is about it, so the two always agree.
 * @param {string} today @param {(send: string) => boolean} wentOut
 */
export function emailToWorkOn(today, wentOut) {
  const first = thisWeeksSend(today);
  return wentOut(first) ? addDays(first, 7) : first;
}

/** "Tue, Nov 17" */
export const sendLabel = (iso) => {
  const d = day(iso);
  return `${weekday(d).slice(0, 3)}, ${monthShort(d)} ${d.getUTCDate()}`;
};

/** A small brief with just what the top of the email needs, for the preview. The week's top photo comes from the photographer. */
export function previewBrief(sale, send) {
  return {
    send_date: send,
    subject: 'The Sunny Side',
    preheader: '',
    hero: { src: 'cf:sunny-ranney-interior', alt: 'The Sunny & Ranney showroom' },
    sale,
  };
}
