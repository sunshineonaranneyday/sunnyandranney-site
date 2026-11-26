import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FORM_LIKE, nightlySyncRequest } from './nightly-sync.mjs';

test('the nightly sync is a JSON POST with the shared secret, so the site’s cross-site check lets it in', () => {
  const { url, init } = nightlySyncRequest('https://sunnyandranney.com/api/sync-products/', 's3cret');
  assert.equal(url, 'https://sunnyandranney.com/api/sync-products/');
  assert.equal(init.method, 'POST');
  const type = String(init.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  // The first version sent no Content-Type and Astro answered 403 "Cross-site POST form submissions are forbidden".
  assert.ok(!FORM_LIKE.includes(type), `a form-like or missing Content-Type is refused (got "${type}")`);
  assert.equal(type, 'application/json');
  assert.equal(init.headers['x-sync-secret'], 's3cret');
  assert.doesNotThrow(() => JSON.parse(init.body));
});
