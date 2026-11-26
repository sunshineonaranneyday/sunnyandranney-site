/**
 * The special-order requests outbox. The website saves a request (special_order_requests);
 * the store-notify worker runs this every few minutes to email the store and send the
 * shopper a confirmation, stamping each row as it goes. A failed send is tried again on
 * the next run, up to MAX_ATTEMPTS, and the error shows on the admin's Requests page.
 *
 * Where the store's copy goes is the admin's choice (settings key below), so a manager
 * can change it without a deploy. Until it's set, shoppers still get their confirmation
 * and the requests wait in the admin.
 */
import { shopperEmail, storeEmail } from './emails.mjs';

export { shopperEmail, storeEmail };
export const FROM = { email: 'requests@mail.sunnyandranney.com', name: 'Sunny & Ranney' };
export const STORE_TO_KEY = 'settings:special_order_to';
export const MAX_ATTEMPTS = 8;
/** Confirmations one address can get in 24 hours; more are skipped, the store still hears. */
export const SHOPPER_DAILY_LIMIT = 3;
export { ADMIN_URL } from './emails.mjs';

/** The address the admin chose for the store's copy, or null. */
export async function storeAddress(db) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(STORE_TO_KEY).first();
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value);
    return typeof v === 'string' && v.includes('@') ? v : null;
  } catch {
    return null;
  }
}

/**
 * Send whatever is waiting. `send(message)` is the worker's EMAIL.send with FROM added.
 * @param {{ db: any, send: (message: Record<string, unknown>) => Promise<void>, now?: Date }} options
 * @returns {Promise<{ storeSent: number, shopperSent: number, shopperSkipped: number, failed: number, waitingForAddress: number }>}
 */
export async function sendPending({ db, send, now = new Date() }) {
  const to = await storeAddress(db);
  const at = new Date(now).toISOString();
  // With no store address, rows that only wait on it aren't picked, so they can never
  // crowd out shoppers still owed a confirmation.
  const { results } = await db.prepare(
    `SELECT * FROM special_order_requests
     WHERE ((store_emailed_at IS NULL AND ?1)
         OR (email IS NOT NULL AND shopper_emailed_at IS NULL AND shopper_email_skipped IS NULL))
       AND email_attempts < ?2
     ORDER BY created_at LIMIT 25`,
  ).bind(to ? 1 : 0, MAX_ATTEMPTS).all();
  const waiting = to ? { n: 0 } : await db.prepare(
    `SELECT COUNT(*) AS n FROM special_order_requests WHERE store_emailed_at IS NULL AND email_attempts < ?`,
  ).bind(MAX_ATTEMPTS).first();

  const out = { storeSent: 0, shopperSent: 0, shopperSkipped: 0, failed: 0, waitingForAddress: waiting?.n ?? 0 };
  for (const req of results) {
    const errors = [];
    if (!req.store_emailed_at && to) {
      try {
        await send(storeEmail(req, to));
        await db.prepare('UPDATE special_order_requests SET store_emailed_at = ? WHERE id = ?').bind(at, req.id).run();
        out.storeSent++;
      } catch (err) {
        errors.push(`To the store: ${err?.message || err}`);
      }
    }
    if (req.email && !req.shopper_emailed_at && !req.shopper_email_skipped) {
      const recent = await db.prepare(
        `SELECT COUNT(*) AS n FROM special_order_requests
         WHERE email = ? AND id != ? AND shopper_emailed_at > ?`,
      ).bind(req.email, req.id, new Date(new Date(now).getTime() - 24 * 3_600_000).toISOString()).first();
      if ((recent?.n ?? 0) >= SHOPPER_DAILY_LIMIT) {
        await db.prepare('UPDATE special_order_requests SET shopper_email_skipped = ? WHERE id = ?')
          .bind(`${SHOPPER_DAILY_LIMIT} confirmations already went to this address today`, req.id).run();
        out.shopperSkipped++;
      } else {
        try {
          await send(shopperEmail(req, { storeTo: to }));
          await db.prepare('UPDATE special_order_requests SET shopper_emailed_at = ? WHERE id = ?').bind(at, req.id).run();
          out.shopperSent++;
        } catch (err) {
          errors.push(`To the shopper: ${err?.message || err}`);
        }
      }
    }
    if (errors.length) {
      out.failed++;
      await db.prepare('UPDATE special_order_requests SET email_attempts = email_attempts + 1, email_error = ? WHERE id = ?')
        .bind(errors.join(' · ').slice(0, 500), req.id).run();
    } else if (req.email_error) {
      await db.prepare('UPDATE special_order_requests SET email_error = NULL WHERE id = ?').bind(req.id).run();
    }
  }
  return out;
}
