import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailto, replyDraft, shopperEmail, storeEmail } from './emails.mjs';

const req = {
  handle: 'caverra-sofa-snow-bhf', title: 'Caverra Sofa - Snow - BHF', vendor: 'Best Home Furnishings',
  price_cents: 159900, lead_days: 42, image_url: 'https://cdn.shopify.com/s/files/1/caverra.jpg?v=17',
  name: 'Pat Lee', email: 'pat@example.com', phone: null, note: null, reply_by: '2026-11-17',
};

test('what a shopper typed is shown as text, never run as markup', () => {
  const evil = { ...req, name: '<img src=x onerror=alert(1)>', note: '</p><script>steal()</script>' };
  for (const m of [shopperEmail(evil, { storeTo: 'staci@sunnyandranney.com' }), storeEmail(evil, 'staci@sunnyandranney.com')]) {
    assert.doesNotMatch(m.html, /<script|<img src=x/i);
    assert.match(m.html, /&lt;script&gt;steal\(\)&lt;\/script&gt;/);
  }
});

test('the photo comes from Shopify at the width the email shows it; no photo, no broken image', () => {
  assert.match(shopperEmail(req, {}).html, /caverra\.jpg\?v=17&amp;width=240/);
  assert.doesNotMatch(shopperEmail({ ...req, image_url: null }, {}).html, /<img[^>]+caverra/);
});

test('the store’s reply draft leaves only the price and date to fill in, and its link is safe to open', () => {
  const draft = replyDraft(req);
  assert.equal(draft.subject, 'Your special order: Caverra Sofa - Snow - BHF');
  assert.match(draft.body, /^Hi Pat,/);
  assert.match(draft.body, /Best Home Furnishings can make the Caverra Sofa/);
  assert.match(draft.body, /Price: \$\nArrives at our showroom around: \n/);
  const link = mailto('pat+home@example.com', draft);
  assert.match(link, /^mailto:pat%2Bhome%40example\.com\?subject=Your%20special%20order/);
  assert.doesNotMatch(link, /[\s"<>]/);
});

test('a phone-only request: the store gets a Call button, not a Reply', () => {
  const m = storeEmail({ ...req, email: null, phone: '(770) 555-0142' }, 'staci@sunnyandranney.com');
  assert.match(m.html, /href="tel:7705550142"/);
  assert.match(m.html, />Call Pat</);
  assert.equal(m.replyTo, undefined);
});

test('the shopper hears the day saved on the request, and the steps that follow', () => {
  const m = shopperEmail(req, { storeTo: 'staci@sunnyandranney.com' });
  assert.equal(m.subject, 'We got your request for Caverra Sofa - Snow - BHF');
  assert.match(m.text, /email you by Tuesday, November 17 with the price/);
  assert.match(m.text, /1\. We check with the maker/);
  assert.match(m.text, /reply yes and we’ll send a secure payment link/);
  assert.match(m.text, /or reply to this email/);
  assert.doesNotMatch(shopperEmail(req, {}).text, /reply to this email/, 'no reply offer until the store has an address');
});
