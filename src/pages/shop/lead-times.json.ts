import type { APIRoute } from 'astro';
import { fetchShopData } from '@/lib/shop-data';

export const prerender = true;

/**
 * The vendor lead times this build used, by vendor name, with when they were read from
 * the admin. The next build falls back to these if it can't reach the admin
 * (src/lib/availability.mjs loadLeadTimes), so an admin outage never holds back the site.
 */
export const GET: APIRoute = async () => {
  const { leadDays, leadTimes } = await fetchShopData();
  return new Response(JSON.stringify({ asOf: leadTimes.asOf, source: leadTimes.source, vendors: Object.fromEntries(leadDays) }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
};
