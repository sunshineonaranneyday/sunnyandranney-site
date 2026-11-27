/**
 * The deploy coordinator's nightly call to the website's full sync
 * (src/pages/api/sync-products.ts), built in one place so a test can hold it to
 * what the site accepts.
 *
 * It must say it carries JSON. Astro's cross-site check (security.checkOrigin)
 * refuses a POST with no Content-Type, or a form one, unless it comes from the site
 * itself: "Cross-site POST form submissions are forbidden". The first nightly call
 * sent only its secret header and would have been refused every night.
 * @param {string} url     the site's /api/sync-products/
 * @param {string} secret  the site's SYNC_SECRET (the coordinator's POKE_SECRET)
 * @returns {{ url: string, init: RequestInit }}
 */
export function nightlySyncRequest(url, secret) {
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-secret': secret, 'user-agent': 'sunnyandranney-deploy-coordinator' },
      body: '{}',
    },
  };
}

/** Content types Astro's cross-site check treats as a form (or no type at all). */
export const FORM_LIKE = ['', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
