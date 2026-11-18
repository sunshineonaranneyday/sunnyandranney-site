import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_CSP, imageAllowed } from './admin-csp.mjs';

test('the emails written in Kit’s own editor show their pictures on the sent page', () => {
  // As in the Nov 10, 2026 email (Kit broadcast 26929032), which showed all 13 broken
  for (const url of [
    'https://embed.filekitcdn.com/e/ddd7RSJXxrc6y4KjqdBqmb/abc123/email',
    'https://functions-js.kit.com/icons?color=%23000000&platform=instagram&style=solid',
    'https://cdn.convertkit.com/assets/images/kit-badge-light.png',
    'https://cdn.kit.com/assets/images/kit-badge-light.png', // where the badge's address sends it
  ]) {
    assert.ok(imageAllowed(url), url);
  }
});

test('the store’s own pictures still load, and nothing else does', () => {
  for (const url of [
    'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ/products/123-abc/public',
    'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/sofa.jpg',
    'https://shop.sunnyandranney.com/cdn-cgi/image/format=jpeg/https://cdn.shopify.com/x.png',
    '/favicon.svg',
    'data:image/png;base64,iVBORw0KGgo=',
  ]) {
    assert.ok(imageAllowed(url), url);
  }
  for (const url of [
    'https://evil.example/x.png',
    'https://imagedelivery.net/SOMEONEELSE/x/public',
    'https://cdn.shopify.com/s/files/1/0000/0000/0001/files/x.jpg',
    'https://functions-js.kit.com/track',
    'https://cdn.convertkit.com/other/x.png',
    'http://embed.filekitcdn.com/e/x',
  ]) {
    assert.equal(imageAllowed(url), false, url);
  }
});

test('the policy is the same as it was otherwise: no scripts, styles or frames from anywhere else', () => {
  assert.match(ADMIN_CSP, /^default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src /);
  assert.match(ADMIN_CSP, /; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'$/);
});
