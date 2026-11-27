/**
 * The website's products, fetched once per build and shared by every page that needs
 * them (the shop grid, product pages, data.json), so they can never disagree.
 *
 * Each product gets its availability (src/lib/availability.mjs): where it is, or whether
 * it can be special ordered, from Shopify's stock at each location and the vendor lead
 * times in the admin (or, if the admin is down, the live site's). `products` is what shoppers browse and search: in stock first,
 * then special orders, best sellers first within each. `allProducts` adds the pieces
 * that are gone, whose pages stay up for old links and Google.
 */
import { getCollectionsStatic } from '@/lib/settings';
import type { Product } from '@/lib/shopify';
import { medusaConfigured, medusaJson } from '@/lib/medusa-admin';
import {
  availabilityOf, isListed, loadLeadTimes, STATE_RANK, type Availability,
} from '@/lib/availability.mjs';

export type ShopProduct = Product & { availability: Availability };

export interface LeadTimes {
  /** When they were read from the admin: older than this build when the live site's stood in. */
  asOf: string;
  source: 'admin' | 'live-site' | 'none';
  days: Map<string, number>;
  problem: string | null;
}

export interface ShopData {
  /** Browsable: everything but gone, in grid order. */
  products: ShopProduct[];
  /** Every product with a page, gone ones included. */
  allProducts: ShopProduct[];
  hasShopify: boolean;
  productCollections: Record<string, string[]>;
  collectionTitles: Record<string, string>;
  collectionSubcategories: Record<string, string[]>;
  staffPickHandles: Set<string>;
  /** Vendor lead times from the admin, for pages outside the enabled collections. */
  leadDays: Map<string, number>;
  /** Where this build's lead times came from, for /shop/lead-times.json and the admin. */
  leadTimes: Omit<LeadTimes, 'days'>;
}

function buildEnv(name: 'MEDUSA_BACKEND_URL' | 'MEDUSA_ADMIN_KEY'): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name];
}

/** The live site's lead times, from its last good build (src/pages/shop/lead-times.json.ts). */
const LIVE_LEAD_TIMES = 'https://sunnyandranney.com/shop/lead-times.json';

/**
 * Vendor lead times from the admin (Medusa's vendors), or the live site's when the admin
 * can't be reached (src/lib/availability.mjs loadLeadTimes). On Cloudflare's build, with
 * neither, the build stops and the last good site stays up; on a laptop it warns.
 */
async function loadVendorLeadTimes(): Promise<LeadTimes> {
  const env = { MEDUSA_BACKEND_URL: buildEnv('MEDUSA_BACKEND_URL'), MEDUSA_ADMIN_KEY: buildEnv('MEDUSA_ADMIN_KEY') };
  const lt = await loadLeadTimes({
    fromAdmin: medusaConfigured(env)
      ? async () => (await medusaJson<{ vendors: Array<{ name: string; aliases: string[]; active: boolean; lead_days: number | null }> }>(env, 'purchasing/vendors')).vendors
      : null,
    fromLiveSite: async () => {
      const res = await fetch(LIVE_LEAD_TIMES, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    strict: Boolean(process.env.CF_PAGES),
  });
  console.log(`[availability] Lead times from ${lt.source} (${lt.asOf}): ${lt.days.size} vendor names with one`);
  return lt;
}

let shopData: Promise<ShopData> | null = null;

/** The build's one fetch of the catalog. */
export function fetchShopData(): Promise<ShopData> {
  // A failure isn't kept: the next caller (say, a dev server's next request) tries again.
  shopData ??= loadShopData().catch((err) => {
    shopData = null;
    throw err;
  });
  return shopData;
}

async function loadShopData(): Promise<ShopData> {
  const fetched: Product[] = [];
  const staffPickHandles = new Set<string>();
  const productCollections: Record<string, string[]> = {};
  const collectionTitles: Record<string, string> = {};

  const shopify = await import('@/lib/shopify');
  const collectionSettings = await getCollectionsStatic();
  const enabledHandles = collectionSettings
    ?.filter(c => c.enabled)
    .sort((a, b) => a.order - b.order)
    .map(c => c.handle) ?? [];

  const [results, leadTimes] = await Promise.all([
    Promise.all(enabledHandles.map(handle => shopify.getCollectionByHandle(handle))),
    loadVendorLeadTimes(),
  ]);
  const leadDays = leadTimes.days;

  const seen = new Set<string>();
  enabledHandles.forEach((handle, i) => {
    const collection = results[i];
    // A collection switched on in settings but missing in Shopify is a mistake to see, not skip.
    if (!collection) throw new Error(`[shop] Collection "${handle}" is enabled in settings but Shopify has no collection by that handle.`);
    collectionTitles[collection.handle] = collection.title;
    for (const product of collection.products) {
      (productCollections[product.handle] ??= []).push(collection.handle);
      if (!seen.has(product.id)) {
        seen.add(product.id);
        fetched.push(product);
      }
    }
  });

  const staffPicksCollection = await shopify.getCollectionByHandle('staff-picks');
  for (const p of staffPicksCollection?.products ?? []) staffPickHandles.add(p.handle);

  // Best sellers first (Shopify's order), then by availability: in stock, then special order.
  const allProducts: ShopProduct[] = fetched.map(p => ({ ...p, availability: availabilityOf(p, leadDays) }));
  const products = allProducts
    .map((p, order) => ({ p, order }))
    .filter(({ p }) => isListed(p.availability))
    .sort((a, b) => STATE_RANK[a.p.availability.state] - STATE_RANK[b.p.availability.state] || a.order - b.order)
    .map(({ p }) => p);

  const counts: Record<string, number> = {};
  for (const p of allProducts) counts[p.availability.state] = (counts[p.availability.state] ?? 0) + 1;
  console.log(`[availability] ${allProducts.length} products: ${JSON.stringify(counts)}`);

  // Subcategory pills come from what shoppers can browse, so a pill never leads to nothing.
  const collectionSubcategories: Record<string, string[]> = {};
  for (const product of products) {
    const catName = product.category?.name;
    if (!catName || catName === 'Uncategorized') continue;
    for (const handle of productCollections[product.handle] || []) {
      const list = (collectionSubcategories[handle] ??= []);
      if (!list.includes(catName)) list.push(catName);
    }
  }
  for (const list of Object.values(collectionSubcategories)) list.sort();

  return {
    products,
    allProducts,
    hasShopify: allProducts.length > 0,
    productCollections,
    collectionTitles,
    collectionSubcategories,
    staffPickHandles,
    leadDays,
    leadTimes: { asOf: leadTimes.asOf, source: leadTimes.source, problem: leadTimes.problem },
  };
}

/** The quick-view / search data map (images, variants, descriptions). */
export function buildProductDataMap(products: Product[]): Record<string, { i: string[]; v: Array<{ id: string; title: string; price: string; available: boolean; image: string }>; d: string }> {
  const map: Record<string, { i: string[]; v: Array<{ id: string; title: string; price: string; available: boolean; image: string }>; d: string }> = {};
  for (const product of products) {
    map[product.handle] = {
      i: product.images.edges.map(e => e.node.url),
      v: product.variants.edges.map(e => ({
        id: e.node.id,
        title: e.node.title,
        price: e.node.price.amount,
        available: e.node.availableForSale,
        image: e.node.image?.url || '',
      })),
      d: product.description?.slice(0, 300) || '',
    };
  }
  return map;
}
