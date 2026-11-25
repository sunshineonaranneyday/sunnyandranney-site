import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkRateLimit } from '@/lib/db';
import { kitClient, signUp } from '@/lib/sunny-side/kit.mjs';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Rate limit: 5 signups per IP per hour
  const allowed = await checkRateLimit(`subscribe:${clientAddress}`, 5, 3600);
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }

  const { email, website } = await request.json().catch(() => ({})) as { email?: string; website?: string };

  // Honeypot: people never see the hidden "website" box, bots fill it in.
  // Answer like a real signup so the bot moves on, and add no one.
  if (website) {
    return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Valid email address is required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!env.KIT_API_KEY) {
    return new Response(JSON.stringify({ error: 'Email signup is not configured yet' }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  try {
    // Into Kit with the store's tag, and off "Shopify: no marketing", so they get the weekly
    // email (signUp in kit.mjs). KIT_API_KEY is a secret set in the Cloudflare dashboard.
    const get: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    await signUp(kitClient({ key: env.KIT_API_KEY, base: env.KIT_API_BASE || undefined, get }), email);
    return new Response(JSON.stringify({ success: true }), {
      headers: JSON_HEADERS,
    });
  } catch (err: any) {
    console.error('Subscribe error:', err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Failed to subscribe. Please try again.' }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
};
