/**
 * Who a verified Cloudflare Access sign-in is, at the address it came to.
 * Kept apart from admin-auth.ts (which fetches Access's keys) so the tests can
 * run real signed tokens through the same decisions the admin makes.
 */
import { EMAIL_HOST } from './admin-host.mjs';

/** @typedef {'manager' | 'kiosk' | 'email'} AdminRole */
/** @typedef {{ email: string, role: AdminRole, owner: boolean }} AdminIdentity */
/**
 * The login settings (Cloudflare Pages variables) these read.
 * @typedef {{ CF_ACCESS_AUD?: string, CF_ACCESS_EMAIL_AUD?: string, ADMIN_MANAGER_EMAILS?: string, ADMIN_KIOSK_EMAILS?: string,
 *   ADMIN_EMAIL_EMAILS?: string, ADMIN_OWNER_EMAILS?: string, ADMIN_KIOSK_SERVICE_TOKENS?: string }} LoginEnv
 */

const emailList = (value) =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

/**
 * The Access audience a sign-in must carry at this address. The email address has
 * its own Access application, so its tokens are refused everywhere else, and the
 * admin's tokens are refused there. '' (unset) refuses everyone.
 * @param {string} host lower case
 * @param {LoginEnv} env
 */
export function audienceFor(host, env) {
  return (host === EMAIL_HOST ? env.CF_ACCESS_EMAIL_AUD : env.CF_ACCESS_AUD) ?? '';
}

/**
 * A person's role from the login lists, or null for anyone not on one.
 * @param {string} email lower case
 * @param {LoginEnv} env
 * @returns {AdminIdentity | null}
 */
export function identityFor(email, env) {
  /** @type {AdminRole | null} */
  let role = null;
  if (emailList(env.ADMIN_MANAGER_EMAILS).includes(email)) role = 'manager';
  else if (emailList(env.ADMIN_KIOSK_EMAILS).includes(email)) role = 'kiosk';
  else if (emailList(env.ADMIN_EMAIL_EMAILS).includes(email)) role = 'email';
  if (!role) return null;
  return { email, role, owner: role === 'manager' && emailList(env.ADMIN_OWNER_EMAILS).includes(email) };
}

/**
 * Who a sign-in that passed verifyAccessJwt is, at this address.
 * @param {{ email: string } | { serviceToken: string }} verified
 * @param {string} host lower case
 * @param {LoginEnv} env
 * @returns {AdminIdentity | null}
 */
export function identityFrom(verified, host, env) {
  if ('serviceToken' in verified) {
    // A service token is only ever a store tablet: it can use the time clock and
    // nothing a manager does, whatever else is configured, and never the email address.
    if (host === EMAIL_HOST) return null;
    const allowed = (env.ADMIN_KIOSK_SERVICE_TOKENS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    return allowed.includes(verified.serviceToken) ? { email: `service-token:${verified.serviceToken}`, role: 'kiosk', owner: false } : null;
  }
  return identityFor(verified.email, env);
}
