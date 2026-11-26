import type { APIRoute } from 'astro';
import { fetchShopData } from '@/lib/shop-data';
import { toSearchDocs } from '@/lib/search/docs.mjs';

export const prerender = true;

/**
 * The search index: every product shoppers can browse, worked out at build time for the
 * search in the header and on /shop/?q= (src/lib/search). Rebuilt with the site.
 */
export const GET: APIRoute = async () => {
  const { products, productCollections } = await fetchShopData();
  const docs = toSearchDocs(products, productCollections);
  return new Response(JSON.stringify({ built: new Date().toISOString(), docs }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
