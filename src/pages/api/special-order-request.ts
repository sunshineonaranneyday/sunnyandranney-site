import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkRateLimit } from '@/lib/db';
import { getProductByHandle } from '@/lib/shopify';
import { medusaConfigured, medusaJson } from '@/lib/medusa-admin';
import { ONE_OF_A_KIND_TAG, availabilityOf, leadDaysByVendor, vendorKey } from '@/lib/availability.mjs';
import { STORE_PHONE, checkRequest, openDaysOf, replyByDate, replyByShort } from '@/lib/special-order-request.mjs';
import fallbackHours from '@/content/settings/hours.json';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
/** Every refusal says what to do next. `code` lets the page offer the right button. */
const CALL = `call us at ${STORE_PHONE} and we’ll help`;

/** The admin's vendor lead times now, or null when Medusa can't be asked. */
async function vendorLeadDays(): Promise<Map<string, number> | null> {
  if (!medusaConfigured(env)) return null;
  try {
    const { vendors } = await medusaJson<{ vendors: Array<{ name: string; aliases: string[]; active: boolean; lead_days: number | null }> }>(env, 'purchasing/vendors');
    return leadDaysByVendor(vendors);
  } catch {
    return null;
  }
}

/** Open days from the store's hours as the hours-sync worker keeps them (Google), else the file. */
async function openDays(): Promise<number[]> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'settings:hours'`).first<{ value: string }>();
    const days = openDaysOf(row?.value ? JSON.parse(row.value) : null);
    if (days.length) return days;
  } catch { /* fall back to the file */ }
  return openDaysOf(fallbackHours);
}

/**
 * A shopper's "Request this piece". Saved here; the store-notify worker emails the
 * store and a confirmation to the shopper (an outbox, so a mail hiccup loses nothing).
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Only the site's own pages may post here, and only as JSON: a form on another
  // site can't make the store email a confirmation to someone.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return reply(403, { code: 'reload', error: `We couldn’t send this from here. Reload the page and try again, or ${CALL}.` });
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return reply(415, { code: 'reload', error: `We couldn’t send this from here. Reload the page and try again, or ${CALL}.` });

  if (!(await checkRateLimit(`special-order:${clientAddress}`, 5, 3600))) {
    return reply(429, { code: 'too-many', error: `You’ve sent several requests in the last hour. Call us at ${STORE_PHONE} and we’ll help right away.` });
  }

  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = checkRequest(input ?? {});
  if (!checked.ok) {
    // A bot gets a thank-you and nothing is saved.
    if (checked.bot) return reply(200, { success: true });
    return reply(400, { code: 'field', error: checked.error, field: checked.field });
  }
  const r = checked.value;

  // The piece as Shopify has it now: the page can be up to a build old.
  const product = await getProductByHandle(r.handle).catch(() => null);
  if (!product) return reply(404, { code: 'not-found', error: `We couldn’t find this piece. Call us at ${STORE_PHONE} and we’ll help.` });
  if (product.availableForSale) {
    return reply(409, { code: 'back-in-stock', error: 'Good news: it’s back in stock. Reload the page to buy it now.' });
  }

  // Only a piece the website offers as a special order can be requested. If the admin
  // can't be asked right now, trust the page unless the piece is marked one of a kind.
  const leadDays = await vendorLeadDays();
  const gone = leadDays
    ? availabilityOf(product, leadDays).state === 'gone'
    : (product.tags ?? []).some((t) => t.trim().toLowerCase() === ONE_OF_A_KIND_TAG);
  if (gone) return reply(410, { code: 'sold', error: 'This piece has sold and can’t be ordered again. Reload the page to see what we have like it.' });

  const now = new Date();
  const replyBy = replyByDate(now, await openDays());
  const id = crypto.randomUUID();
  const price = product.priceRange?.minVariantPrice?.amount;
  try {
  await env.DB.prepare(
    `INSERT INTO special_order_requests
       (id, created_at, handle, title, vendor, price_cents, image_url, lead_days, name, email, phone, note, reply_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    now.toISOString(),
    r.handle,
    product.title,
    product.vendor || null,
    price ? Math.round(parseFloat(price) * 100) : null,
    product.images?.edges?.[0]?.node?.url ?? null,
    leadDays?.get(vendorKey(product.vendor)) ?? null,
    r.name,
    r.email,
    r.phone,
    r.note,
    replyBy,
  ).run();
  } catch (err) {
    console.error('Special-order request not saved:', err instanceof Error ? err.message : err);
    return reply(503, { code: 'retry', error: `We couldn’t save your request just now. Try again in a minute, or call us at ${STORE_PHONE}.` });
  }

  return reply(201, { success: true, id, replyBy: replyByShort(replyBy, now) });
};
