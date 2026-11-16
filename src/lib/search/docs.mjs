/**
 * The website's products as the search index carries them (/shop/search-index.json),
 * built with the site. Each piece is worked out here once, from its whole description
 * (its kinds, colors, materials, features, sizes: enrich()), so the browser downloads only
 * short fields (about 35KB gzipped for 830 pieces) and builds its index in milliseconds.
 */
import { enrich } from './engine.mjs';

/** Shopify's image folder for this store: kept out of every URL in the index. */
const IMAGE_ROOT = 'https://cdn.shopify.com/s/files/1/0930/2117/6092/files/';

/**
 * @param {Array<any>} products  the shop's products, best sellers first (fetchShopData)
 * @param {Record<string, string[]>} productCollections  handle → the enabled collections it's in
 */
export function toSearchDocs(products, productCollections) {
  return products.map((p, r) => {
    const collections = productCollections[p.handle] ?? [];
    const image = p.images?.edges?.[0]?.node?.url ?? '';
    const price = parseFloat(p.priceRange?.minVariantPrice?.amount ?? '0');
    const compare = parseFloat(p.compareAtPriceRange?.minVariantPrice?.amount ?? '0');
    const doc = {
      h: p.handle,
      t: p.title,
      y: p.productType || undefined,
      c: p.category?.name || undefined,
      g: p.tags?.length ? p.tags : undefined,
      v: p.vendor || undefined,
      p: price,
      s: p.availableForSale ? 1 : 0,
      col: collections,
      r,
      i: image ? (image.startsWith(IMAGE_ROOT) ? `~${image.slice(IMAGE_ROOT.length)}` : image) : undefined,
      ...enrich({ title: p.title, description: p.description, tags: p.tags, productType: p.productType, category: p.category, collections }),
    };
    if (compare > price) doc.cp = compare;
    return doc;
  });
}

/** A product's image URL from the index, at a width (Shopify's CDN resizes). */
export function imageUrl(i, width) {
  if (!i) return '';
  const url = i.startsWith('~') ? IMAGE_ROOT + i.slice(1) : i;
  if (!url.includes('cdn.shopify.com')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}width=${width}&height=${width}&crop=center&quality=70&format=webp`;
}
