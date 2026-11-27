import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availabilityLine, availabilityOf, isListed, isOneOff, leadDaysByVendor, leadTimeLabel, loadLeadTimes,
  schemaAvailability, unitsByLocation, vendorKey,
} from './availability.mjs';

/** A product shaped like the Storefront API returns it, as the build reads it. */
function product({ available, vendor = 'Best Home Furnishings', tags = [], showroom = 0, warehouse = 0 }) {
  return {
    availableForSale: available,
    vendor,
    tags,
    variants: {
      edges: [{
        node: {
          storeAvailability: {
            nodes: [
              { quantityAvailable: showroom, location: { name: '109 Oak Street' } },
              { quantityAvailable: warehouse, location: { name: 'Warehouse' } },
            ],
          },
        },
      }],
    },
  };
}

// Vendors as Medusa's purchasing/vendors returns them, built from Shopify's vendor names.
const VENDORS = [
  { name: 'Best Home Furnishings', lead_days: 42 },
  { name: 'Jofran', lead_days: 10 },
  { name: 'Elements', lead_days: null },
  { name: 'Coaster Furniture', lead_days: 0 },
];
const LEAD = leadDaysByVendor(VENDORS);

test('in stock is on the floor first, then the warehouse (the Maverly: 0 on the floor, 1 at the warehouse)', () => {
  const maverly = availabilityOf(product({ available: true, showroom: 0, warehouse: 1 }), LEAD);
  assert.deepEqual(maverly, { state: 'warehouse', showroom: 0, warehouse: 1, leadDays: null, why: 'stock' });
  assert.equal(availabilityLine(maverly), 'At our warehouse');

  const both = availabilityOf(product({ available: true, showroom: 2, warehouse: 3 }), LEAD);
  assert.equal(both.state, 'showroom');
  assert.equal(availabilityLine(both), 'On the showroom floor');
});

test('buyable with no stock at either location (untracked, or sold past zero) is plain in stock', () => {
  const a = availabilityOf(product({ available: true }), LEAD);
  assert.equal(a.state, 'in-stock');
  assert.equal(schemaAvailability(a), 'https://schema.org/InStock');
});

test('sold out from a vendor with a lead time is a special order, timed in weeks', () => {
  const a = availabilityOf(product({ available: false }), LEAD);
  assert.deepEqual(a, { state: 'special', showroom: 0, warehouse: 0, leadDays: 42, why: 'vendor' });
  assert.equal(availabilityLine(a), 'Special order · about 6 weeks');
  assert.equal(schemaAvailability(a), 'https://schema.org/BackOrder');
  assert.equal(isListed(a), true);
});

test('sold out from a vendor with no lead time on file is gone, and leaves the grid', () => {
  const a = availabilityOf(product({ available: false, vendor: 'Elements' }), LEAD);
  assert.equal(a.state, 'gone');
  assert.equal(a.why, 'no-lead-time');
  assert.equal(isListed(a), false);
  assert.equal(availabilityLine(a), 'Sold');
  assert.equal(schemaAvailability(a), 'https://schema.org/SoldOut');
  // A vendor the admin has never heard of is the same.
  assert.equal(availabilityOf(product({ available: false, vendor: 'Nobody Co' }), LEAD).state, 'gone');
});

test('one of a kind beats the vendor; special-order forces a request even with no lead time', () => {
  assert.equal(availabilityOf(product({ available: false, tags: ['one-of-a-kind'] }), LEAD).why, 'one-of-a-kind');
  assert.equal(availabilityOf(product({ available: false, tags: ['One-Of-A-Kind '] }), LEAD).state, 'gone');
  const forced = availabilityOf(product({ available: false, vendor: 'Elements', tags: ['special-order'] }), LEAD);
  assert.deepEqual(forced, { state: 'special', showroom: 0, warehouse: 0, leadDays: null, why: 'tag' });
  assert.equal(availabilityLine(forced), 'Special order');
  // In stock always wins: the tag only matters once it's sold out.
  assert.equal(availabilityOf(product({ available: true, showroom: 1, tags: ['one-of-a-kind'] }), LEAD).state, 'showroom');
});

test('vendor names match however they are typed', () => {
  assert.equal(vendorKey('  Best   Home Furnishings '), vendorKey('best home furnishings'));
  assert.equal(vendorKey('Jofran, Inc.'), 'jofran inc');
  assert.equal(vendorKey('Lamps & Co'), vendorKey('Lamps and Co'));
  assert.equal(availabilityOf(product({ available: false, vendor: 'JOFRAN' }), LEAD).leadDays, 10);
});

test('lead days read as rounded-up weeks, never "0 weeks"', () => {
  assert.equal(leadTimeLabel(null), null);
  assert.equal(leadTimeLabel(0), 'about 1 week');
  assert.equal(leadTimeLabel(7), 'about 1 week');
  assert.equal(leadTimeLabel(10), 'about 2 weeks');
  assert.equal(leadTimeLabel(42), 'about 6 weeks');
  assert.equal(availabilityOf(product({ available: false, vendor: 'Coaster Furniture' }), LEAD).leadDays, 0);
});

test('a vendor is found by any of its aliases; an inactive vendor offers no special orders', () => {
  const map = leadDaysByVendor([
    { name: 'Elements International', aliases: ['Elements', 'ELMT'], active: true, lead_days: 21 },
    { name: 'Old Supplier', aliases: [], active: false, lead_days: 14 },
  ]);
  assert.equal(availabilityOf(product({ available: false, vendor: 'Elements' }), map).leadDays, 21);
  assert.equal(availabilityOf(product({ available: false, vendor: 'Old Supplier' }), map).state, 'gone');
});

test('bad lead times from Medusa are ignored, not trusted', () => {
  const map = leadDaysByVendor([{ name: 'A', lead_days: -3 }, { name: 'B', lead_days: Number.NaN }, { name: '', lead_days: 5 }, null]);
  assert.equal(map.size, 0);
});

test('negative stock at a location never cancels stock at another', () => {
  const p = product({ available: true, showroom: -2, warehouse: 1 });
  assert.deepEqual(unitsByLocation(p), { showroom: 0, warehouse: 1 });
});

const quiet = { warn: () => {} };
const NOW = new Date('2026-11-16T20:00:00Z');
const vendors = [{ name: 'Best Home Furnishings', aliases: ['BHF'], active: true, lead_days: 42 }];
const down = async () => { throw new Error('fetch failed'); };

test('lead times come from the admin when it answers', async () => {
  const lt = await loadLeadTimes({ fromAdmin: async () => vendors, fromLiveSite: down, strict: true, now: NOW, log: quiet });
  assert.equal(lt.source, 'admin');
  assert.equal(lt.asOf, NOW.toISOString());
  assert.equal(lt.days.get('bhf'), 42);
  assert.equal(lt.problem, null);
});

test('with the admin down, the live site’s lead times stand in, dated when they were read', async () => {
  const live = async () => ({ asOf: '2026-11-15T08:20:00.000Z', source: 'admin', vendors: { 'best home furnishings': 42, bhf: 42, bad: -1, worse: 'x' } });
  for (const fromAdmin of [down, null]) {
    const lt = await loadLeadTimes({ fromAdmin, fromLiveSite: live, strict: true, now: NOW, log: quiet });
    assert.equal(lt.source, 'live-site');
    assert.equal(lt.asOf, '2026-11-15T08:20:00.000Z', 'the original date travels with them');
    assert.deepEqual([...lt.days], [['best home furnishings', 42], ['bhf', 42]]);
    assert.match(lt.problem, /admin \(.+\); using the live site’s/);
  }
});

test('with neither, a Cloudflare build stops; a laptop build goes on with none', async () => {
  const notOurs = async () => ({ hello: 'world' });
  await assert.rejects(loadLeadTimes({ fromAdmin: down, fromLiveSite: down, strict: true, now: NOW, log: quiet }), /fetch failed\) or the live site \(fetch failed\).+last good site stays up/);
  await assert.rejects(loadLeadTimes({ fromAdmin: down, fromLiveSite: notOurs, strict: true, now: NOW, log: quiet }), /isn’t what this build writes/);
  const lt = await loadLeadTimes({ fromAdmin: null, fromLiveSite: down, strict: false, now: NOW, log: quiet });
  assert.equal(lt.source, 'none');
  assert.equal(lt.days.size, 0);
});

test('a damaged, display or customer-order piece is one of a kind even untagged; "Denton" is not "dent"', () => {
  for (const [title, handle] of [
    ['60" Ryder Media Console - Walnut - JFN (Slight Damage)', 'ryder-media-console'],
    ['Natures Edge Bookcase - JFN', 'display-natures-edge-bookcase-jfn'],
    ['Arin Cane Floor Length Mirror - CFC', 'customer-order-arin-cane-floor-length-mirror-cfc'],
    ['Cooper 2 Door Cabinet - CVC DAMAGE', 'cooper-2-door-cabinet'],
    ['Floor model sofa', 'x'],
  ]) assert.equal(isOneOff({ title, handle }), true, title);
  for (const [title, handle] of [
    ['Denton Ottoman - Hamstead Dove - LLH', 'denton-ottoman-hamstead-dove-llh'],
    ['Brayden Accent Chair - OLX', 'brayden-accent-chair-olx'],
    ['Display Cabinet - Walnut', 'display-cabinet-walnut'],
    ['Curio Display Cabinet', 'curio-display-cabinet'],
  ]) assert.equal(isOneOff({ title, handle }), false, title);
  const lead = new Map([['jofran', 21]]);
  const damaged = product({ available: false, vendor: 'Jofran' });
  damaged.title = '60" Ryder Media Console - Walnut - JFN (Slight Damage)';
  assert.deepEqual([availabilityOf(damaged, lead).state, availabilityOf(damaged, lead).why], ['gone', 'one-of-a-kind']);
});
