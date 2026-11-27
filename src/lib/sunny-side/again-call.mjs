/**
 * The email-again worker's call to the site (/api/email-again/), built in one place so a test can
 * hold it to what the site accepts: JSON (Astro's cross-site check refuses a POST with no
 * Content-Type or a form one; see nightly-sync.mjs) and the worker's secret.
 * @param {string} url the site's /api/email-again/
 * @param {string} secret EMAIL_AGAIN_SECRET, the same on the worker and the site
 * @returns {{ url: string, init: RequestInit }}
 */
export function againRequest(url, secret) {
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-again-secret': secret, 'user-agent': 'sunnyandranney-email-again' },
      body: '{}',
    },
  };
}
