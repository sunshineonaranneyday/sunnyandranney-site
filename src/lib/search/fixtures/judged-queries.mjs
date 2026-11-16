// The judged query set: what shoppers type, by Baymard's query types, and what a right
// answer is for each, as a rule over the catalog's own fields. Built on 2026-11-16 from the
// catalog's vocabulary (catalog-2026-11-16.json), before the store had any search logs; the
// admin's Site search page now lists real searches, and the ones that found nothing belong here.
// A product p: { title, productType, vendor, tags[], description, category: { name, ancestors[] }, collections[], availableForSale, price }

const cat = (p) => (p.category?.name ?? '').toLowerCase();
const t = (p) => p.title.toLowerCase();
const tags = (p) => p.tags.map((x) => x.toLowerCase());
const all = (p) => `${t(p)} | ${cat(p)} | ${tags(p).join(' ')} | ${(p.productType || '').toLowerCase()} | ${(p.description || '').toLowerCase()}`;
const inCat = (...names) => (p) => names.some((n) => cat(p).includes(n));
const titleHas = (...words) => (p) => words.every((w) => (w instanceof RegExp ? w.test(t(p)) : t(p).includes(w)));
const and = (...fs) => (p) => fs.every((f) => f(p));
const or = (...fs) => (p) => fs.some((f) => f(p));
const anyText = (re) => (p) => re.test(all(p));
const price = (p) => parseFloat(p.priceRange?.minVariantPrice?.amount ?? '0');

// A sofa table is a console table, not a sofa.
const SOFA = or(inCat('sofas', 'sectional', 'loveseat', 'chaise longue'), titleHas(/\bsofa\b(?!\s*tables?\b)/));
const SECTIONAL = or(inCat('sectional'), titleHas(/sectional|modular/));
const ARMCHAIR = or(inCat('armchairs'), titleHas(/accent chair|arm chair|armchair|swivel|glider/));
const RECLINER = or(inCat('recliners'), titleHas(/recliner|rocker/));
const DINING_CHAIR = or(inCat('dining room chairs', 'dining chairs'), titleHas(/dining chair|side chair/));
const STOOL = or(inCat('bar stools', 'counter stools'), titleHas(/stool/));
const COFFEE = or(inCat('coffee tables'), titleHas(/coffee table|cocktail table/));
const END_TABLE = or(inCat('end tables', 'accent tables', 'nesting tables'), titleHas(/end table|side table|accent table|nesting/));
const CONSOLE = or(inCat('sofa tables', 'console tables'), titleHas(/console|sofa table/));
const DINING_TABLE = or(inCat('dining room tables', 'dining tables'), titleHas(/dining table|counter table|pub table/));
const NIGHTSTAND = or(inCat('nightstands'), titleHas(/nightstand|night stand/));
const DRESSER = or(inCat('dressers'), titleHas(/dresser|chest/));
const BED = or(inCat('beds', 'bed frames', 'headboards'), titleHas(/\bbed\b|headboard/));
const BENCH = or(inCat('benches'), titleHas(/bench/));
const OTTOMAN = or(inCat('ottomans'), titleHas(/ottoman|pouf/));
const RUG = or(inCat('rugs'), titleHas(/\brug\b/));
const MIRROR = or(inCat('mirrors'), titleHas(/mirror/));
const ART = or(inCat('paintings', 'prints', 'visual artwork', 'artwork', 'tapestries', 'wall art'), titleHas(/canvas|print|wall art|painting/));
const SCULPTURE = or(inCat('sculptures'), titleHas(/sculpture|statue/));
const BOOKCASE = or(inCat('bookcases', 'shelves'), titleHas(/bookcase|shelf|etagere/));
const CABINET = or(inCat('cabinets', 'sideboards', 'buffets', 'display cabinets'), titleHas(/cabinet|sideboard|buffet|credenza/));
const SIDEBOARD = or(inCat('sideboards', 'buffets'), titleHas(/sideboard|buffet|credenza/));
const TV = or(inCat('entertainment centers', 'tv stands'), titleHas(/media|tv |entertainment/));
const OUTDOOR = or((p) => p.collections.includes('outdoor'), inCat('outdoor'), titleHas(/outdoor|patio/));
const BEDROOM = or((p) => p.collections.includes('bedroom'), BED, NIGHTSTAND, DRESSER);
const DINING = or((p) => p.collections.includes('dining'), DINING_TABLE, DINING_CHAIR, SIDEBOARD, STOOL);
const LIVING = or((p) => p.collections.includes('living'), SOFA, ARMCHAIR, COFFEE, END_TABLE);
const color = (re) => anyText(re);

/** [query, type, rule]. A rule of null means "no product answer": the query should lead to a page instead (non-product) or is judged by hand. */
export const QUERIES = [
  // Exact names (the Maverly rocker started this whole thing)
  ['maverly rocker', 'exact', titleHas('maverly')],
  ['dovely sofa', 'exact', titleHas('dovely')],
  ['casimere', 'exact', titleHas('casimere')],
  ['portland end table', 'exact', and(titleHas('portland'), titleHas(/end table|side table/))],
  ['sylvie', 'exact', titleHas('sylvie')],
  ['brisbane', 'exact', titleHas('brisbane')],
  ['bucktown', 'exact', titleHas('bucktown')],
  ['caverra', 'exact', titleHas('caverra')],
  ['palmer', 'exact', titleHas('palmer')],
  ['926 sofa', 'exact', titleHas('926')],
  // Product types
  ['sofa', 'type', SOFA], ['sofas', 'type', SOFA], ['sectional', 'type', SECTIONAL], ['loveseat', 'type', or(inCat('loveseat'), titleHas(/loveseat|love seat/))],
  ['recliner', 'type', RECLINER], ['accent chair', 'type', ARMCHAIR], ['armchair', 'type', ARMCHAIR], ['swivel chair', 'type', and(ARMCHAIR, anyText(/swivel/))],
  ['dining chair', 'type', DINING_CHAIR], ['bar stool', 'type', STOOL], ['counter stool', 'type', STOOL], ['coffee table', 'type', COFFEE],
  ['end table', 'type', END_TABLE], ['side table', 'type', END_TABLE], ['console table', 'type', CONSOLE], ['dining table', 'type', DINING_TABLE],
  ['nightstand', 'type', NIGHTSTAND], ['dresser', 'type', DRESSER], ['bed', 'type', BED], ['queen bed', 'type', and(BED, anyText(/\bqn\b|queen/))],
  ['king bed', 'type', and(BED, anyText(/\bkg\b|\bking\b/))], ['bench', 'type', BENCH], ['ottoman', 'type', OTTOMAN], ['rug', 'type', RUG],
  ['area rug', 'type', RUG], ['mirror', 'type', MIRROR], ['wall art', 'type', ART], ['painting', 'type', ART], ['sculpture', 'type', SCULPTURE],
  ['bookcase', 'type', BOOKCASE], ['cabinet', 'type', CABINET], ['sideboard', 'type', SIDEBOARD], ['buffet', 'type', SIDEBOARD],
  ['tv stand', 'type', TV], ['outdoor furniture', 'type', OUTDOOR], ['chaise', 'type', or(inCat('chaise'), titleHas(/chaise/))],
  // Synonyms and slang: the shopper's word isn't the catalog's
  ['couch', 'synonym', SOFA], ['sectional couch', 'synonym', SECTIONAL], ['night stand', 'synonym', NIGHTSTAND], ['bedside table', 'synonym', NIGHTSTAND],
  ['cocktail table', 'synonym', COFFEE], ['credenza', 'synonym', SIDEBOARD], ['media console', 'synonym', TV], ['entertainment center', 'synonym', TV],
  ['chest of drawers', 'synonym', DRESSER], ['barstool', 'synonym', STOOL], ['pouf', 'synonym', OTTOMAN], ['settee', 'synonym', SOFA],
  ['sofa table', 'synonym', CONSOLE], ['kitchen table', 'synonym', DINING_TABLE], ['bookshelf', 'synonym', BOOKCASE], ['artwork', 'synonym', ART],
  ['patio furniture', 'synonym', OUTDOOR], ['reading chair', 'synonym', or(ARMCHAIR, RECLINER)], ['nursery glider', 'synonym', titleHas(/glider|rocker/)],
  ['lounge chair', 'synonym', or(ARMCHAIR, RECLINER)],
  // Misspellings and typos
  ['sectinal', 'typo', SECTIONAL], ['dinning table', 'typo', DINING_TABLE], ['coffe table', 'typo', COFFEE], ['recliner chiar', 'typo', RECLINER],
  ['otoman', 'typo', OTTOMAN], ['nightstnd', 'typo', NIGHTSTAND], ['drsser', 'typo', DRESSER], ['chaise lounge', 'typo', or(inCat('chaise'), titleHas(/chaise/))],
  ['sofaa', 'typo', SOFA], ['mirorr', 'typo', MIRROR], ['swivle chair', 'typo', and(ARMCHAIR, anyText(/swivel/))], ['cabnet', 'typo', CABINET],
  // Features, materials, colors
  ['leather sofa', 'feature', and(SOFA, anyText(/leather/))], ['round dining table', 'feature', and(DINING_TABLE, anyText(/round/))],
  ['marble coffee table', 'feature', and(COFFEE, anyText(/marble/))], ['storage ottoman', 'feature', and(OTTOMAN, anyText(/storage/))],
  ['nesting tables', 'feature', anyText(/nesting/)], ['swivel glider', 'feature', and(titleHas(/glider/), anyText(/swivel/))], ['upholstered bed', 'feature', and(BED, anyText(/uph/))],
  ['rocking recliner', 'feature', and(RECLINER, anyText(/rock/))], ['round mirror', 'feature', and(MIRROR, anyText(/round/))],
  ['blue sofa', 'color', and(SOFA, color(/blue|navy|denim/))], ['grey sectional', 'color', and(SECTIONAL, color(/grey|gray|slate|pebble|granite/))],
  ['gray sectional', 'color', and(SECTIONAL, color(/grey|gray|slate|pebble|granite/))], ['white dresser', 'color', and(DRESSER, color(/white|ivory|cream/))],
  ['black end table', 'color', and(END_TABLE, color(/black|blk/))], ['navy chair', 'color', and(or(ARMCHAIR, DINING_CHAIR), color(/navy|blue/))],
  ['green chair', 'color', and(or(ARMCHAIR, DINING_CHAIR, RECLINER), color(/green|olive|sage|forest/))], ['walnut table', 'color', and(or(COFFEE, END_TABLE, DINING_TABLE, CONSOLE), color(/walnut/))],
  ['cream rug', 'color', and(RUG, color(/cream|ivory|white|beige/))], ['natural wood coffee table', 'color', and(COFFEE, color(/natural|wood|oak|walnut/))],
  // Sizes and units
  ['72 inch console', 'size', and(CONSOLE, titleHas(/\b72\s*("|''|”|in)/))], ['72" console', 'size', and(CONSOLE, titleHas(/\b72\s*("|''|”)/))],
  ['36 inch coffee table', 'size', and(COFFEE, titleHas(/\b36\s*("|''|”|in)/))], ['5x8 rug', 'size', and(RUG, anyText(/\b5\s*'?\s*\d*"?\s*x\s*[78]/))],
  ['8x10 rug', 'size', and(RUG, anyText(/\b[78]\s*'?\s*\d*"?\s*x\s*1[01]/))], ['60 inch dining table', 'size', and(DINING_TABLE, titleHas(/\b60\s*("|''|”|in)/))],
  // Price
  ['sofa under 1000', 'price', and(SOFA, (p) => price(p) > 0 && price(p) < 1000)], ['chairs under 500', 'price', and(or(ARMCHAIR, DINING_CHAIR), (p) => price(p) > 0 && price(p) < 500)],
  ['cheap coffee table', 'price', and(COFFEE, (p) => price(p) > 0 && price(p) < 400)],
  // Vendors
  ['jofran', 'vendor', (p) => /jofran/i.test(p.vendor)], ['catnapper', 'vendor', (p) => /catnapper/i.test(p.vendor)], ['best home furnishings', 'vendor', (p) => /best home/i.test(p.vendor)],
  ['liberty furniture', 'vendor', (p) => /liberty/i.test(p.vendor)], ['coaster', 'vendor', (p) => /coaster/i.test(p.vendor)],
  // Rooms and themes
  ['living room', 'thematic', LIVING], ['bedroom furniture', 'thematic', BEDROOM], ['dining room', 'thematic', DINING], ['patio', 'thematic', OUTDOOR],
  ['modern', 'thematic', null], ['farmhouse', 'thematic', null], ['mid century', 'thematic', null], ['something cozy for a reading nook', 'natural', or(ARMCHAIR, RECLINER)],
  ['a table for 6 people', 'natural', DINING_TABLE], ['chair that rocks for a nursery', 'natural', titleHas(/glider|rocker/)],
  // Case and punctuation
  ['SOFA', 'case', SOFA], ['Coffee Tables', 'case', COFFEE], ['end-table', 'case', END_TABLE], ['bar-stool', 'case', STOOL],
  // Not a product: should lead to the right page
  ['hours', 'non-product', null], ['delivery', 'non-product', null], ['return policy', 'non-product', null], ['location', 'non-product', null],
  ['donate furniture', 'non-product', null], ['gift card', 'non-product', null],
];

/** Questions that aren't products, and the page each should offer (null: none fits, and no piece should show). */
export const NON_PRODUCT_PAGES = { hours: '/visit/', delivery: '/visit/', 'return policy': '/return-policy/', location: '/visit/', 'donate furniture': '/about/', 'gift card': null };
