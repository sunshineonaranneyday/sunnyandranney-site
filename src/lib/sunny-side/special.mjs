/**
 * The week's special: what Staci types in the admin, and how it becomes the email's offer
 * ===========================================================================
 * Staci picks one of three kinds and fills in only what changes week to week: the deal, a
 * headline, the last day. Everything else the offer shows (its small label, the button's
 * words and page, the fine print) is the store's, by kind (defaults), so there's nothing
 * else to set (the store, 2026-11-16). clean() turns what she typed into a special, check()
 * says what's wrong in words she can act on (the same rules in her browser and on the
 * server), and toSale() makes the email's offer from it. No Node or browser APIs, so
 * the admin page, the API and the weekly build (scripts/sunny-side/build.mjs) share it.
 */

import { WORKWEEK_START_DAY } from '../time-clock/hours.mjs';
import { day, monthShort, weekday } from './email.mjs';

/** The Sunny Side goes out on Tuesdays (Tue Nov 3 and Tue Nov 10, 2026). 0 = Sunday. */
export const SEND_WEEKDAY = 2;

export const KINDS = {
  tiers: { title: 'Spend more, save more', hint: 'Bigger discounts for bigger orders' },
  percent: { title: 'Percent off everything', hint: 'One discount on the whole order' },
  headline: { title: 'No sale this week', hint: 'A headline instead, with no discount' },
};

/** The kinds that are a discount, so the email says where it counts and when it ends. */
export const isDiscount = (kind) => kind === 'tiers' || kind === 'percent';

/**
 * Every sale counts in the showroom and online, so the fine print always says so and there's
 * nothing to pick (the store, 2026-11-16). Specials saved before then may still carry a `where`;
 * it's ignored.
 */
export const EVERYWHERE = 'In the showroom and online.';

/**
 * Lengths come from the email's layout: a headline over three lines on a small phone
 * would push the button off the first screen, and four digits of spend can't be written
 * short exactly unless they're round.
 */
export const LIMITS = {
  headline: 70,
  percent: [1, 90],
  spend: [50, 50000],
  spendStep: 50,
  tiers: [2, 4],
  endsWithinDays: 60,
};

/**
 * What the offer says around the deal, by kind. Both sales count the whole order (spend more,
 * save more, or a percent off everything), so the button opens the whole shop: the sale page lists
 * only the marked-down items (7 in stock on Nov 11, 2026), so it would hide most of what the sale
 * covers. A week with no sale points at what's new.
 */
export function defaults(kind) {
  if (kind === 'percent') return { label: 'Storewide sale', cta: 'Shop the sale', link: '/shop/' };
  if (kind === 'headline') return { label: 'This week', cta: 'See what’s new', link: '/shop/?collection=new-arrivals' };
  return { label: 'Spend more, save more', cta: 'Shop the sale', link: '/shop/' };
}

/** A fresh special of a kind: two empty tiers to start from, everything else blank. */
export function blank(kind = 'tiers') {
  return { kind, headline: '', tiers: [{ spend: null, percent: null }, { spend: null, percent: null }], percent: null, ends: '' };
}

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
  return {
    kind: Object.hasOwn(KINDS, i.kind) ? i.kind : '',
    headline: str(i.headline),
    tiers: rows.slice(0, 8).map((r) => ({ spend: whole(r?.spend), percent: whole(r?.percent) })),
    percent: whole(i.percent),
    ends: typeof i.ends === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.ends) ? i.ends : '',
  };
}

/** Only the fields the special's kind uses, for saving. A headline week has no discount, so no terms. */
export function forKind(s) {
  if (s.kind === 'tiers') return { kind: s.kind, headline: s.headline, tiers: s.tiers, ends: s.ends };
  if (s.kind === 'percent') return { kind: s.kind, percent: s.percent, ends: s.ends };
  return { kind: s.kind, headline: s.headline };
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
  if (!s.kind) e.kind = 'Pick what kind of special this is.';
  const tooLong = (field, name) => {
    if (s[field].length > LIMITS[field]) e[field] = `${name} can be ${LIMITS[field]} characters at most. This one is ${s[field].length}.`;
  };
  if (s.kind === 'tiers' || s.kind === 'headline') {
    if (!s.headline) e.headline = s.kind === 'tiers' ? 'Add a headline, like “The holidays are here. So are the savings.”' : 'Add the headline, like “Black Friday sneak peeks start this Friday.”';
    else tooLong('headline', 'The headline');
  }
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
  if (isDiscount(s.kind)) {
    if (!s.ends) e.ends = 'Add the last day of the sale. The email tells customers when it ends.';
  }
  if (isDiscount(s.kind) && s.ends) {
    if (!isDate(s.ends)) e.ends = 'That isn’t a date.';
    else if (send && s.ends < send) e.ends = 'The sale can’t end before the email goes out.';
    else if (send && s.ends > addDays(send, LIMITS.endsWithinDays)) e.ends = `Pick an end date within ${LIMITS.endsWithinDays} days of the email.`;
  }
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
  if (s.kind === 'tiers') Object.assign(sale, { headline: typeset(s.headline), tiers: s.tiers.map((t) => [t.spend, t.percent]) });
  if (s.kind === 'percent') Object.assign(sale, { percent: s.percent, what: 'everything.' });
  if (s.kind === 'headline') sale.headline = typeset(s.headline);
  const fine = termsLine(s);
  if (fine) sale.details = fine;
  return sale;
}

/**
 * The offer as the preview draws it while Staci is still typing: what's missing shows as
 * "?" or a placeholder instead of breaking the preview.
 */
export function draftSale(s) {
  const kind = s.kind || 'tiers';
  const filled = { ...s, kind };
  if (kind !== 'percent' && !filled.headline) filled.headline = kind === 'tiers' ? 'Your headline' : 'Your headline goes here';
  if (filled.ends && !isDate(filled.ends)) filled.ends = '';
  const sale = toSale(filled);
  if (kind === 'tiers') {
    const rows = s.tiers.slice(0, LIMITS.tiers[1]).map((t) => [t.spend ?? '?', t.percent ?? '?']);
    while (rows.length < LIMITS.tiers[0]) rows.push(['?', '?']);
    sale.tiers = rows;
  }
  if (kind === 'percent' && s.percent === null) sale.percent = '?';
  return sale;
}

/** One line for lists: "10% off $250+ · 15% off $500+" / "20% off everything" / the headline. */
export function summary(s) {
  if (s.kind === 'tiers') return s.tiers.map((t) => `${t.percent}% off ${money(t.spend)}+`).join(' · ');
  if (s.kind === 'percent') return `${s.percent}% off everything`;
  return s.headline;
}

// ── Send dates ──────────────────────────────────────────────────────────────
export const isSendDate = (iso) => typeof iso === 'string' && isDate(iso) && day(iso).getUTCDay() === SEND_WEEKDAY;

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
export const emailNeeds = (week) => [week?.special ? '' : 'the sale', week?.wall ? '' : 'the products'].filter(Boolean);

/**
 * The days an email can go: its week as the store keeps it, Sunday to Saturday (the staff
 * schedule's and Gusto's workweek, WORKWEEK_START_DAY), so every day belongs to one email and
 * the emails go out in order. Its Tuesday is the usual day.
 */
export function sendDays(send) {
  const start = addDays(send, -((SEND_WEEKDAY - WORKWEEK_START_DAY + 7) % 7));
  return Array.from({ length: 7 }, (_, k) => addDays(start, k));
}

/** True when `d` is one of the days the email for `send` can go. */
export const isSendDay = (send, d) => isSendDate(send) && typeof d === 'string' && sendDays(send).includes(d);

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
