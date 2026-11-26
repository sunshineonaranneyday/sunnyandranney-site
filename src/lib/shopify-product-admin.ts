/**
 * The admin's few changes to a product in Shopify, through the store's Admin API token
 * (SHOPIFY_ADMIN_TOKEN, which has write_products): mark it one of a kind or a special
 * order, or archive it. Shopify's products/update webhook then rebuilds the website.
 */
import { ONE_OF_A_KIND_TAG, SPECIAL_ORDER_TAG } from '@/lib/availability.mjs';

const API_VERSION = '2025-01';

export interface ProductAdminEnv {
  PUBLIC_SHOPIFY_STORE_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

export type Mark = 'one-of-a-kind' | 'special-order' | 'clear';

async function admin<T>(env: ProductAdminEnv, query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.SHOPIFY_ADMIN_TOKEN) throw new Error('The admin can’t change Shopify products: SHOPIFY_ADMIN_TOKEN isn’t set.');
  const domain = env.PUBLIC_SHOPIFY_STORE_DOMAIN || 'sunnyandranney.myshopify.com';
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: Array<{ message: string }> } | null;
  // Shopify answers 200 with `errors` for a refused call: never treat that as done.
  if (!res.ok || !body || body.errors?.length) throw new Error(`Shopify refused the change: ${body?.errors?.map((e) => e.message).join('; ') || res.status}`);
  return body.data as T;
}

function userErrors(result: { userErrors?: Array<{ message: string }> } | undefined) {
  const errs = result?.userErrors ?? [];
  if (errs.length) throw new Error(`Shopify refused the change: ${errs.map((e) => e.message).join('; ')}`);
}

async function productId(env: ProductAdminEnv, handle: string): Promise<string> {
  const data = await admin<{ productByHandle: { id: string } | null }>(env, 'query($h: String!) { productByHandle(handle: $h) { id } }', { h: handle });
  if (!data.productByHandle) throw new Error('Shopify has no product by that name any more.');
  return data.productByHandle.id;
}

/** One of a kind (gone once sold), a special order (requestable even with no vendor lead time), or neither. */
export async function markProduct(env: ProductAdminEnv, handle: string, mark: Mark): Promise<void> {
  const id = await productId(env, handle);
  const add = mark === 'one-of-a-kind' ? [ONE_OF_A_KIND_TAG] : mark === 'special-order' ? [SPECIAL_ORDER_TAG] : [];
  const remove = [ONE_OF_A_KIND_TAG, SPECIAL_ORDER_TAG].filter((t) => !add.includes(t));
  const removed = await admin<{ tagsRemove: { userErrors: Array<{ message: string }> } }>(
    env, 'mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }', { id, tags: remove });
  userErrors(removed.tagsRemove);
  if (add.length) {
    const added = await admin<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(
      env, 'mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }', { id, tags: add });
    userErrors(added.tagsAdd);
  }
}

/** Archive a duplicate or a mistake: off every channel, kept in Shopify's history. */
export async function archiveProduct(env: ProductAdminEnv, handle: string): Promise<void> {
  const id = await productId(env, handle);
  const data = await admin<{ productUpdate: { userErrors: Array<{ message: string }> } }>(
    env, 'mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { message } } }', { p: { id, status: 'ARCHIVED' } });
  userErrors(data.productUpdate);
}
