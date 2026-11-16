/**
 * Keeps every Active product on the sales channels it belongs on, whatever was ticked
 * when it was created or made Active:
 *
 * - Point of Sale, always, so it can be rung up.
 * - The website's channel (Sunny & Ranney Headless), always, unless tagged `hide-online`.
 *   Only products in the website's collections get a page; the channel costs the rest
 *   nothing, and a category switched on later fills itself.
 * - Google & YouTube only for a product with a page on the website (in an enabled
 *   collection): a listing links to that page, and one without a page sent shoppers to
 *   a "page not found" (2,374 listings on 2026-11-16; the owner had them taken off).
 * - Online Store off for a product with a page, since a theme page there stops
 *   store.sunnyandranney.com redirecting to the website. Products without a page keep
 *   whatever Online Store they have.
 * - Tagged `hide-online`: off the website, Google and Online Store; still on Point of Sale.
 *
 * Runs on every products/create and products/update webhook, and as a sweep in each full
 * sync, so a product made Active later (created as a Draft, say from a wholesale app) is
 * covered too. Before this, only products/create published, and a Shopify Flow that
 * drafted and unpublished new products (2026-08-17 to 2026-11-13) undid it: 92 website
 * products went missing from the site, and 294 products from Google, before anyone saw.
 */

export const HEADLESS = 'gid://shopify/Publication/284019392796';
export const POS = 'gid://shopify/Publication/270874607900';
export const GOOGLE = 'gid://shopify/Publication/280934121756';
export const ONLINE_STORE = 'gid://shopify/Publication/270874575132';
export const HIDE_TAG = 'hide-online';

const isHidden = (tags) => (tags ?? []).some((t) => String(t).trim().toLowerCase() === HIDE_TAG);

/**
 * What to change for one product.
 * @param {{ status: string, tags?: string[], inWebsite: boolean,
 *   onHeadless: boolean, onPos: boolean, onGoogle: boolean, onOnlineStore: boolean }} p
 * @returns {{ publish: string[], unpublish: string[] }}
 */
export function channelChanges(p) {
  const out = { publish: [], unpublish: [] };
  if (String(p.status).toUpperCase() !== 'ACTIVE') return out;
  const want = (on, id, should) => {
    if (should === true && !on) out.publish.push(id);
    if (should === false && on) out.unpublish.push(id);
  };
  const hidden = isHidden(p.tags);
  want(p.onPos, POS, true);
  want(p.onHeadless, HEADLESS, !hidden);
  want(p.onGoogle, GOOGLE, !hidden && p.inWebsite);
  // undefined: left as it is.
  want(p.onOnlineStore, ONLINE_STORE, hidden || p.inWebsite ? false : undefined);
  return out;
}

const CHANNEL_FIELDS = `status tags totalInventory
  onHeadless: publishedOnPublication(publicationId: "${HEADLESS}")
  onPos: publishedOnPublication(publicationId: "${POS}")
  onGoogle: publishedOnPublication(publicationId: "${GOOGLE}")
  onOnlineStore: publishedOnPublication(publicationId: "${ONLINE_STORE}")`;

/**
 * One Admin GraphQL mutation. A refusal (top-level `errors`, or `userErrors`) throws:
 * the old auto-publish read a refusal as success, which is how misses went unseen.
 * "Already published" isn't a refusal: the product is where it should be.
 * @param {(query: string, variables?: object) => Promise<any>} gql
 */
async function mutate(gql, name, variables) {
  const body = await gql(`mutation($id: ID!, $input: [PublicationInput!]!) { ${name}(id: $id, input: $input) { userErrors { message } } }`, variables);
  const errors = [...(body?.errors ?? []), ...(body?.data?.[name]?.userErrors ?? [])]
    .map((e) => e.message)
    .filter((m) => !/already (been )?(published|unpublished)/i.test(m));
  if (errors.length || !body?.data?.[name]) throw new Error(`${name}: ${errors.join('; ') || 'no answer'}`);
}

/** Sends the changes for one product: at most one publish and one unpublish. */
async function applyChanges(gql, id, { publish, unpublish }) {
  const input = (ids) => ids.map((publicationId) => ({ publicationId }));
  if (publish.length) await mutate(gql, 'publishablePublish', { id, input: input(publish) });
  if (unpublish.length) await mutate(gql, 'publishableUnpublish', { id, input: input(unpublish) });
}

/**
 * Puts one product right, after reading its channels and collections fresh from Shopify.
 * @param {(query: string, variables?: object) => Promise<any>} gql  POSTs to the Admin GraphQL API, returns the JSON body
 * @param {string} productGid
 * @param {string[]} websiteCollections  the enabled collection handles
 * @returns {Promise<{ handle: string, published: string[], unpublished: string[] }>}
 */
export async function ensureWebsiteChannels(gql, productGid, websiteCollections) {
  const body = await gql(`query($id: ID!) { product(id: $id) { id handle title ${CHANNEL_FIELDS}
    collections(first: 100) { nodes { handle } } } }`, { id: productGid });
  if (body?.errors?.length) throw new Error(`product: ${body.errors.map((e) => e.message).join('; ')}`);
  const p = body?.data?.product;
  if (!p) return { handle: '', published: [], unpublished: [] };
  const enabled = new Set(websiteCollections);
  const changes = channelChanges({ ...p, inWebsite: p.collections.nodes.some((c) => enabled.has(c.handle)) });
  await applyChanges(gql, p.id, changes);
  return { handle: p.handle, published: changes.publish, unpublished: changes.unpublish };
}

/**
 * The sweep: every product in the website's collections put right where needed, and
 * the in-stock ones that still aren't on the live site (as of its last build).
 * Fixing stops at `deadline` (ms since epoch) so a sweep inside a webhook's spare time
 * never runs long; what's left is counted in `pending` and done by the next sweep.
 * @param {(query: string, variables?: object) => Promise<any>} gql
 * @param {string[]} collections  the enabled collection handles
 * @param {Set<string>} onSite    handles in the live site's /shop/data.json
 * @param {{ deadline?: number, now?: () => number }} [options]
 * @returns {Promise<{ checked: number, fixed: Array<{ handle: string, published: string[], unpublished: string[] }>, failed: Array<{ handle: string, error: string }>, pending: number, missing: Array<{ handle: string, title: string }> }>}
 */
export async function sweepWebsiteChannels(gql, collections, onSite, { deadline = Infinity, now = Date.now } = {}) {
  const seen = new Map();
  for (const handle of collections) {
    let after = null;
    do {
      const body = await gql(`query($h: String!, $a: String) { collectionByHandle(handle: $h) { products(first: 100, after: $a) {
        pageInfo { hasNextPage endCursor }
        nodes { id handle title ${CHANNEL_FIELDS} } } } }`, { h: handle, a: after });
      if (body?.errors?.length) throw new Error(`collection ${handle}: ${body.errors.map((e) => e.message).join('; ')}`);
      const page = body?.data?.collectionByHandle?.products;
      if (!page) throw new Error(`collection ${handle}: not found in Shopify`);
      for (const p of page.nodes) seen.set(p.id, p);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  }

  const fixed = [];
  const failed = [];
  const missing = [];
  let pending = 0;
  for (const p of seen.values()) {
    const changes = channelChanges({ ...p, inWebsite: true });
    if (changes.publish.length || changes.unpublish.length) {
      if (now() >= deadline) {
        pending++;
      } else {
        try {
          await applyChanges(gql, p.id, changes);
          fixed.push({ handle: p.handle, published: changes.publish, unpublished: changes.unpublish });
        } catch (err) {
          failed.push({ handle: p.handle, error: err?.message || String(err) });
        }
      }
    }
    if (String(p.status).toUpperCase() === 'ACTIVE' && !isHidden(p.tags) && (p.totalInventory ?? 0) > 0 && !onSite.has(p.handle)) {
      missing.push({ handle: p.handle, title: p.title });
    }
  }
  return { checked: seen.size, fixed, failed, pending, missing };
}

/**
 * Pieces missing from the site for over two hours. A fresh publish takes a rebuild (15
 * to 30 minutes) to show, so a piece only counts once it has been missing longer.
 * @param {Array<{ handle: string, title: string }>} missing  from this sweep
 * @param {Record<string, string>} firstSeen  handle → when it was first seen missing (ISO), from the last check
 * @param {Date} now
 */
export function coverage(missing, firstSeen, now) {
  const since = {};
  const late = [];
  for (const m of missing) {
    since[m.handle] = firstSeen?.[m.handle] ?? new Date(now).toISOString();
    if (new Date(now).getTime() - Date.parse(since[m.handle]) >= 2 * 3_600_000) late.push({ ...m, since: since[m.handle] });
  }
  return { checkedAt: new Date(now).toISOString(), firstSeen: since, late };
}
