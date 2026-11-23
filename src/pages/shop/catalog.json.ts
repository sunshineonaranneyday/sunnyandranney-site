import type { APIRoute } from 'astro';
import { fetchShopData } from '@/lib/shop-data';
import { getBestSellingHandles } from '@/lib/shopify';
import { toCatalog } from '@/lib/sunny-side/catalog.mjs';

// Built with the site, from the same products the shop lists, so the email's product picker
// offers exactly what the shop shows, with the stock its cards count.
export const prerender = true;

export const GET: APIRoute = async () => {
  const [shop, ranks] = await Promise.all([fetchShopData(), getBestSellingHandles()]);
  if (!shop.hasShopify) throw new Error('The shop has no products, so the catalog would be empty.');
  const catalog = toCatalog(shop.products, {
    productCollections: shop.productCollections,
    collectionTitles: shop.collectionTitles,
    staffPicks: shop.staffPickHandles,
    ranks,
    built: new Date().toISOString(),
  });
  return new Response(JSON.stringify(catalog), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  });
};
