/**
 * What the website says about whether a piece can be had, and where it is.
 *
 * Every product on the site is in exactly one state, worked out from Shopify's stock
 * at each location and the vendor's lead time in the admin (Vendors page, stored in
 * Medusa as `lead_days`). Staff never set a state by hand; they can only mark a piece
 * one of a kind (the `one-of-a-kind` tag) or force a special order (`special-order`).
 *
 *   showroom   in stock on the floor at 109 Oak Street
 *   warehouse  in stock, but only at the warehouse
 *   in-stock   can be bought, but Shopify gives no location (untracked or sold past zero)
 *   special    none in stock; the vendor can supply it, so a shopper can request it
 *   gone       none in stock and it won't come back: off the grid and search, page kept
 *
 * Plain JavaScript with JSDoc so `node --test` runs it and Astro imports it as is.
 */

export const SHOWROOM = '109 Oak Street';
export const WAREHOUSE = 'Warehouse';
export const ONE_OF_A_KIND_TAG = 'one-of-a-kind';
export const SPECIAL_ORDER_TAG = 'special-order';

/** @typedef {'showroom' | 'warehouse' | 'in-stock' | 'special' | 'gone'} AvailabilityState */

/**
 * @typedef {object} Availability
 * @property {AvailabilityState} state
 * @property {number} showroom   units on the showroom floor
 * @property {number} warehouse  units at the warehouse
 * @property {number | null} leadDays  the vendor's lead time, when the piece is a special order and it's known
 * @property {'stock' | 'tag' | 'vendor' | 'one-of-a-kind' | 'no-lead-time'} why  what decided it, for the admin:
 *   stock (it's in stock), tag (marked special-order), vendor (the vendor's lead time),
 *   one-of-a-kind (marked so), no-lead-time (its vendor has none in the admin, or isn't there)
 */

/** Order on the grid: in stock first (floor, then warehouse), then special orders. */
export const STATE_RANK = { showroom: 0, warehouse: 1, 'in-stock': 1, special: 2, gone: 3 };

/** A vendor's name as it's matched: case, spacing and punctuation don't count. */
export function vendorKey(name) {
  return String(name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Medusa's vendors → lead days by vendor key, under the vendor's name and each of its
 * aliases (the other spellings Shopify uses). An inactive vendor, or one with no lead
 * time on file, is left out: we don't promise a special order we can't place or time.
 * @param {Array<{ name?: string | null; aliases?: string[] | null; active?: boolean; lead_days?: number | null }>} vendors
 * @returns {Map<string, number>}
 */
export function leadDaysByVendor(vendors) {
  const map = new Map();
  for (const v of vendors ?? []) {
    if (!v || v.active === false) continue;
    if (v.lead_days == null || !Number.isFinite(v.lead_days) || v.lead_days < 0) continue;
    for (const name of [v.name, ...(v.aliases ?? [])]) {
      const key = vendorKey(name);
      if (key) map.set(key, Math.round(v.lead_days));
    }
  }
  return map;
}

function hasTag(product, tag) {
  return (product.tags ?? []).some((t) => String(t).trim().toLowerCase() === tag);
}

/**
 * A single physical piece by its own name: a damaged piece, a display or floor model, an
 * as-is or open-box piece, or a customer's order. There's no "another one" to order, so
 * it's one of a kind even untagged. Whole phrases only: "Denton" is not "dent", and a
 * "Display Cabinet" is a cabinet, not a display piece.
 */
const ONE_OFF_TITLE = /\b(damage[ds]?|floor[ -]model|display (?:model|piece)|as[ -]is|open[ -]box|customer[ -]order)\b|\(display\)/i;
const ONE_OFF_PREFIX = ['display', 'customer-order', 'floor-model'];
const slug = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function isOneOff(product) {
  const title = String(product.title ?? '');
  const handle = String(product.handle ?? '');
  if (ONE_OFF_TITLE.test(title) || /(^|-)damage[ds]?(-|$)/.test(handle)) return true;
  // A prefix the store put on the handle ("display-natures-edge-bookcase-jfn" for the
  // Natures Edge Bookcase), not one Shopify made from the title ("display-cabinet" for a Display Cabinet).
  return ONE_OFF_PREFIX.some((p) => handle.startsWith(`${p}-`) && !slug(title).startsWith(p));
}

/** Units at the showroom and the warehouse, from the Storefront API's storeAvailability. */
export function unitsByLocation(product) {
  let showroom = 0;
  let warehouse = 0;
  for (const edge of product.variants?.edges ?? []) {
    for (const s of edge.node?.storeAvailability?.nodes ?? []) {
      const units = Math.max(0, Number(s.quantityAvailable) || 0);
      if (s.location?.name === SHOWROOM) showroom += units;
      else if (s.location?.name === WAREHOUSE) warehouse += units;
    }
  }
  return { showroom, warehouse };
}

/**
 * @param {{ availableForSale: boolean; vendor?: string; tags?: string[]; variants?: { edges: Array<{ node: any }> } }} product
 * @param {Map<string, number>} leadDays  from leadDaysByVendor
 * @returns {Availability}
 */
export function availabilityOf(product, leadDays) {
  const { showroom, warehouse } = unitsByLocation(product);
  if (product.availableForSale) {
    const state = showroom > 0 ? 'showroom' : warehouse > 0 ? 'warehouse' : 'in-stock';
    return { state, showroom, warehouse, leadDays: null, why: 'stock' };
  }
  const vendorDays = leadDays.get(vendorKey(product.vendor)) ?? null;
  if (hasTag(product, ONE_OF_A_KIND_TAG) || isOneOff(product)) return { state: 'gone', showroom, warehouse, leadDays: null, why: 'one-of-a-kind' };
  if (hasTag(product, SPECIAL_ORDER_TAG)) return { state: 'special', showroom, warehouse, leadDays: vendorDays, why: 'tag' };
  if (vendorDays != null) return { state: 'special', showroom, warehouse, leadDays: vendorDays, why: 'vendor' };
  return { state: 'gone', showroom, warehouse, leadDays: null, why: 'no-lead-time' };
}

/** Shown on the grid and in search: everything but gone. */
export function isListed(availability) {
  return availability.state !== 'gone';
}

/** "about 6 weeks" from lead days, or null when the vendor has none on file. */
export function leadTimeLabel(leadDays) {
  if (leadDays == null) return null;
  const weeks = Math.max(1, Math.ceil(leadDays / 7));
  return `about ${weeks} week${weeks === 1 ? '' : 's'}`;
}

/** The one line a shopper reads on a card or a product page. */
export function availabilityLine(availability) {
  switch (availability.state) {
    case 'showroom': return 'On the showroom floor';
    case 'warehouse': return 'At our warehouse';
    case 'in-stock': return 'In stock';
    case 'special': {
      const lead = leadTimeLabel(availability.leadDays);
      return lead ? `Special order · ${lead}` : 'Special order';
    }
    default: return 'Sold';
  }
}

/** schema.org availability for the Product structured data Google reads. */
export function schemaAvailability(availability) {
  switch (availability.state) {
    case 'showroom':
    case 'warehouse':
    case 'in-stock': return 'https://schema.org/InStock';
    case 'special': return 'https://schema.org/BackOrder';
    default: return 'https://schema.org/SoldOut';
  }
}

/**
 * Vendor lead times for a build. From the admin when it answers; when it doesn't, the
 * live site's (published by its last good build at /shop/lead-times.json, with the date
 * they were read from the admin), so an admin outage never stops new products reaching
 * the website and never turns every special order into gone. Only when neither answers
 * does a strict (Cloudflare) build stop, leaving the last good site up.
 * @param {{
 *   fromAdmin: (() => Promise<Array<{ name?: string | null; aliases?: string[] | null; active?: boolean; lead_days?: number | null }>>) | null,
 *   fromLiveSite: () => Promise<unknown>,
 *   strict: boolean,
 *   now?: Date,
 *   log?: { warn: (msg: string) => void },
 * }} sources  fromAdmin is null when the build has no admin settings
 * @returns {Promise<{ asOf: string, source: 'admin' | 'live-site' | 'none', days: Map<string, number>, problem: string | null }>}
 */
export async function loadLeadTimes({ fromAdmin, fromLiveSite, strict, now = new Date(), log = console }) {
  let adminProblem;
  try {
    if (!fromAdmin) throw new Error('the admin’s address and key (MEDUSA_BACKEND_URL, MEDUSA_ADMIN_KEY) aren’t set for this build');
    return { asOf: now.toISOString(), source: 'admin', days: leadDaysByVendor(await fromAdmin()), problem: null };
  } catch (err) {
    adminProblem = err instanceof Error ? err.message : String(err);
  }
  let liveProblem;
  try {
    const live = /** @type {{ asOf?: unknown, vendors?: unknown }} */ (await fromLiveSite());
    if (typeof live?.asOf !== 'string' || Number.isNaN(Date.parse(live.asOf)) || !live.vendors || typeof live.vendors !== 'object') {
      throw new Error('its lead-times.json isn’t what this build writes');
    }
    const days = new Map(Object.entries(live.vendors).filter(([k, d]) => k && Number.isInteger(d) && d >= 0));
    const problem = `Couldn’t read vendor lead times from the admin (${adminProblem}); using the live site’s, read from the admin ${live.asOf}.`;
    log.warn(`[availability] ${problem}`);
    return { asOf: live.asOf, source: 'live-site', days, problem };
  } catch (err) {
    liveProblem = err instanceof Error ? err.message : String(err);
  }
  const problem = `Couldn’t read vendor lead times from the admin (${adminProblem}) or the live site (${liveProblem}).`;
  if (strict) throw new Error(`[availability] ${problem} Without them every special order would vanish from the website, so this build stops and the last good site stays up.`);
  log.warn(`[availability] ${problem} Every sold-out piece counts as gone in this build.`);
  return { asOf: now.toISOString(), source: 'none', days: new Map(), problem };
}
