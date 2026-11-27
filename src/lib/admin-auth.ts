import { verifyAccessJwt } from '@/lib/access-jwt.mjs';
import { EMAIL_HOST } from '@/lib/admin-host.mjs';
import { audienceFor, identityFor, identityFrom } from '@/lib/admin-identity.mjs';

/** A manager runs the store; the kiosk is the store tablet; email may only work on the weekly email. */
export type AdminRole = 'manager' | 'kiosk' | 'email';

export interface AdminIdentity {
  email: string;
  role: AdminRole;
  /** May connect or disconnect Gusto, which needs more trust than running the store. */
  owner: boolean;
}

interface AdminEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /** The audience of the email address's own Access application, the only one accepted there. */
  CF_ACCESS_EMAIL_AUD?: string;
  ADMIN_MANAGER_EMAILS?: string;
  /** Logins that may work on the weekly email and reach nothing else. */
  ADMIN_EMAIL_EMAILS?: string;
  ADMIN_KIOSK_EMAILS?: string;
  /** Access service token client IDs that act as a store tablet, like the registers' time clock. */
  ADMIN_KIOSK_SERVICE_TOKENS?: string;
  ADMIN_OWNER_EMAILS?: string;
  ADMIN_DEV_EMAIL?: string;
}

const CERT_TTL_MS = 60 * 60 * 1000;
const CERT_RETRY_MS = 60 * 1000;

let certCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

async function fetchCerts(teamDomain: string): Promise<JsonWebKey[]> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Access certs request failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  certCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function getKeys(teamDomain: string, kid: string): Promise<JsonWebKey[]> {
  const age = certCache ? Date.now() - certCache.fetchedAt : Infinity;
  if (certCache && age < CERT_TTL_MS) {
    const known = certCache.keys.some((key) => (key as { kid?: string }).kid === kid);
    // An unknown kid usually means Access rotated keys, so refetch, but no more
    // than once a minute or forged tokens could trigger a fetch per request.
    if (known || age < CERT_RETRY_MS) return certCache.keys;
  }
  return fetchCerts(teamDomain);
}

/** Returns who is calling, or null. Anything unconfigured or invalid is denied. */
export async function authenticate(request: Request, env: AdminEnv): Promise<AdminIdentity | null> {
  // Removed from production builds: Vite replaces DEV with false at build time.
  if (import.meta.env.DEV && env.ADMIN_DEV_EMAIL) {
    return identityFor(env.ADMIN_DEV_EMAIL.toLowerCase(), env);
  }

  // A sign-in counts only at the address whose Access application issued it: the email
  // address's token is refused everywhere else, and the admin's is refused there.
  const host = new URL(request.url).hostname.toLowerCase();
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN ?? '';
  const audience = audienceFor(host, env);
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) || !audience) {
    console.error(`Admin auth is not configured: set CF_ACCESS_TEAM_DOMAIN and ${host === EMAIL_HOST ? 'CF_ACCESS_EMAIL_AUD' : 'CF_ACCESS_AUD'}`);
    return null;
  }

  const verified = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
    teamDomain,
    audience,
    getKeys: (kid: string) => getKeys(teamDomain, kid),
  });
  if (!verified) return null;

  return identityFrom(verified, host, env);
}
