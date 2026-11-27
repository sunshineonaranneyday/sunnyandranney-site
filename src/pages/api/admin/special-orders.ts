import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { resendEmails, setStatus, setStoreAddress } from '@/lib/store-notify/requests-store.mjs';
import { archiveProduct, markProduct, type Mark } from '@/lib/shopify-product-admin';

export const prerender = false;

const MARKS: Mark[] = ['one-of-a-kind', 'special-order', 'clear'];
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;

/**
 * The Special orders page's changes. Managers only.
 *   { action: 'status', id, status }        answered, ordered or closed
 *   { action: 'resend', id }                 try its emails again after the outbox gave up
 *   { action: 'address', email }            where the store's copy of each request goes
 *   { action: 'mark', handle, mark }         one of a kind, special order, or neither, in Shopify
 *   { action: 'archive', handle }            archive a duplicate or a mistake in Shopify
 */
export const POST: APIRoute = async (context) => {
  const who = requireRole(context.locals, 'manager');
  if (who instanceof Response) return who;
  const body = await readJson(context.request);
  const env = context.locals.runtime.env;

  switch (body?.action) {
    case 'status': {
      const { id, status } = body;
      if (typeof id !== 'string' || !['replied', 'ordered', 'closed'].includes(status as string)) return json({ error: 'Invalid request' }, 400);
      const found = await setStatus(dbOf(context), { id, status, by: who.email, now: new Date() });
      return found ? json({ ok: true }) : json({ error: 'That request is gone. Reload the page.' }, 404);
    }
    case 'resend': {
      if (typeof body.id !== 'string') return json({ error: 'Invalid request' }, 400);
      return (await resendEmails(dbOf(context), body.id)) ? json({ ok: true }) : json({ error: 'That request is gone. Reload the page.' }, 404);
    }
    case 'address': {
      const error = await setStoreAddress(dbOf(context), body.email);
      return error ? json({ error }, 422) : json({ ok: true });
    }
    case 'mark':
    case 'archive': {
      const { handle } = body;
      if (typeof handle !== 'string' || !HANDLE.test(handle)) return json({ error: 'Invalid request' }, 400);
      if (body.action === 'mark' && !MARKS.includes(body.mark as Mark)) return json({ error: 'Invalid request' }, 400);
      try {
        if (body.action === 'archive') await archiveProduct(env, handle);
        else await markProduct(env, handle, body.mark as Mark);
        console.log(JSON.stringify({ at: 'special-orders', action: body.action, mark: body.mark ?? null, handle, by: who.email }));
        return json({ ok: true });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : 'Shopify didn’t take the change.' }, 502);
      }
    }
    default:
      return json({ error: 'Invalid request' }, 400);
  }
};
