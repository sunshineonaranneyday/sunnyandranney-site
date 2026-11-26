/**
 * store-notify: every 5 minutes, sends the website's special-order requests on, the
 * store's copy to the address chosen on the admin's Requests page and a confirmation
 * to the shopper. The rows are the outbox (special_order_requests); nothing is lost if
 * a run fails, the next one tries again.
 */

// @ts-ignore: plain JS module shared with the admin and its tests
import { FROM, sendPending } from '../../../src/lib/store-notify/special-orders.mjs';

interface Env {
  DB: unknown;
  EMAIL: { send(message: Record<string, unknown>): Promise<{ messageId?: string }> };
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const send = async (message: Record<string, unknown>) => {
      try {
        await env.EMAIL.send({ from: FROM, ...message });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        throw new Error(`${e?.code ? `${e.code}: ` : ''}${e?.message || err}`);
      }
    };
    const out = await sendPending({ db: env.DB, send });
    if (out.storeSent || out.shopperSent || out.shopperSkipped || out.failed) console.log(JSON.stringify(out));
  },
};
