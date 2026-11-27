import type { APIRoute } from 'astro';
import { fetchShopData } from '@/lib/shop-data';

export const prerender = true;

/**
 * Every product's availability as this build worked it out: the admin's Special orders
 * page lists the pieces that are gone or special orders from it, with why, so the store
 * can see what shoppers see and mark a piece one of a kind or orderable.
 */
export const GET: APIRoute = async () => {
  const { allProducts, leadTimes } = await fetchShopData();
  const products = allProducts.map((p) => ({
    handle: p.handle,
    title: p.title,
    vendor: p.vendor || null,
    price: p.priceRange.minVariantPrice.amount,
    image: p.images.edges[0]?.node.url ?? null,
    category: p.category?.name ?? null,
    ...p.availability,
  }));
  return new Response(JSON.stringify({ builtAt: new Date().toISOString(), leadTimes, products }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
