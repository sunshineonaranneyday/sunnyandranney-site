/**
 * What shoppers type, mapped to what the catalog says. Built from the catalog's own
 * words (2026-11-16: 830 products, Shopify's categories, tags and titles) and the
 * query types Baymard finds sites fail most: synonyms, misspellings, colors, sizes,
 * prices, non-product questions. Add to it from the admin's Search page: the
 * searches that found nothing are listed there.
 */

/**
 * Kinds of furniture. Each has the words shoppers use (`say`) and what marks a
 * product as one (`find`: whole words or phrases, matched in the title, the
 * category, the tags and the type). A shopper's word finds every product that any
 * of the `find` words marks.
 */
export const KINDS = [
  { id: 'sofa', label: 'Sofas', say: ['sofa', 'couch', 'settee', 'davenport'], find: ['sofa', 'sofas', 'sectional', 'loveseat', 'love seat', 'chaise sofa'] },
  { id: 'sectional', label: 'Sectionals', say: ['sectional', 'sectional sofa', 'sectional couch', 'modular sofa', 'l shaped couch', 'l shaped sofa'], find: ['sectional', 'sectional sofas', 'modular'] },
  { id: 'loveseat', label: 'Loveseats', say: ['loveseat', 'love seat'], find: ['loveseat', 'love seat', 'loveseat sofas'] },
  { id: 'chaise', label: 'Chaises', say: ['chaise', 'chaise lounge', 'chaise longue', 'fainting couch'], find: ['chaise', 'chaise longue sofas'] },
  { id: 'recliner', label: 'Recliners', say: ['recliner', 'reclining chair', 'lazy boy', 'la z boy', 'power recliner', 'rocker recliner'], find: ['recliner', 'recliners', 'rocker', 'recl'] },
  { id: 'glider', label: 'Gliders and rockers', say: ['glider', 'rocker', 'rocking chair', 'nursery chair', 'nursing chair', 'nursery', 'chair that rocks'], find: ['glider', 'rocker', 'rocking'] },
  { id: 'armchair', label: 'Accent chairs', say: ['accent chair', 'armchair', 'arm chair', 'club chair', 'lounge chair', 'reading chair', 'reading nook', 'reading corner', 'living room chair', 'occasional chair', 'barrel chair', 'chair and a half'], find: ['armchairs', 'accent chair', 'arm chair', 'armchair', 'club chair', 'swivel', 'glider', 'chair and 1/2'] },
  { id: 'chair', label: 'Chairs', say: ['chair'], find: ['chair', 'armchairs', 'dining chairs', 'kitchen & dining room chairs', 'recliner', 'recliners', 'glider', 'rocker', 'swivel'] },
  { id: 'dining-chair', label: 'Dining chairs', say: ['dining chair', 'kitchen chair', 'dinner chair'], find: ['dining chair', 'dining chairs', 'kitchen & dining room chairs', 'side chair', 'arm chair'] },
  { id: 'stool', label: 'Bar and counter stools', say: ['stool', 'bar stool', 'barstool', 'counter stool', 'counter height stool', 'bar chair'], find: ['stool', 'stools', 'bar stools', 'counter stools'] },
  { id: 'bench', label: 'Benches', say: ['bench', 'entryway bench', 'upholstered bench', 'end of bed bench'], find: ['bench', 'benches', 'upholstered benches'] },
  { id: 'ottoman', label: 'Ottomans', say: ['ottoman', 'pouf', 'pouffe', 'footstool', 'foot stool', 'footrest', 'hassock'], find: ['ottoman', 'ottomans', 'pouf'] },
  { id: 'coffee-table', label: 'Coffee tables', say: ['coffee table', 'cocktail table', 'center table', 'centre table'], find: ['coffee table', 'coffee tables', 'cocktail table'] },
  { id: 'end-table', label: 'End and side tables', say: ['end table', 'side table', 'accent table', 'lamp table', 'nesting tables', 'nesting table', 'drink table', 'chairside table'], find: ['end table', 'end tables', 'side table', 'accent table', 'accent tables', 'nesting', 'nesting tables', 'chairside'] },
  { id: 'console', label: 'Console and sofa tables', say: ['console', 'console table', 'sofa table', 'entry table', 'entryway table', 'hall table', 'foyer table'], find: ['console', 'console tables', 'sofa table', 'sofa tables', 'entry table'] },
  { id: 'dining-table', label: 'Dining tables', say: ['dining table', 'kitchen table', 'dinner table', 'dining room table', 'counter height table', 'pub table', 'table for 4', 'table for 6', 'table for 8'], find: ['dining table', 'dining tables', 'kitchen & dining room tables', 'counter table', 'pub table', 'drop leaf'] },
  { id: 'sideboard', label: 'Sideboards and buffets', say: ['sideboard', 'buffet', 'credenza', 'server', 'hutch'], find: ['sideboard', 'sideboards', 'buffet', 'buffets', 'credenza', 'server'] },
  { id: 'cabinet', label: 'Cabinets', say: ['cabinet', 'storage cabinet', 'accent cabinet', 'curio', 'display cabinet', 'armoire'], find: ['cabinet', 'cabinets', 'storage cabinets', 'tall display cabinets', 'curio'] },
  { id: 'tv', label: 'TV stands and media consoles', say: ['tv stand', 'tv console', 'media console', 'media cabinet', 'entertainment center', 'entertainment unit', 'tv table'], find: ['media', 'tv stand', 'tv stands', 'entertainment centers', 'entertainment'] },
  { id: 'bookcase', label: 'Bookcases and shelves', say: ['bookcase', 'bookshelf', 'book shelf', 'shelf', 'shelves', 'shelving', 'etagere', 'shelving unit'], find: ['bookcase', 'bookcases', 'shelf', 'shelves', 'shelving', 'etagere', 'bookcases & standing shelves', 'rack bookcases & shelves'] },
  { id: 'desk', label: 'Desks', say: ['desk', 'writing desk', 'office desk', 'vanity'], find: ['desk', 'vanity', 'writing desk'] },
  { id: 'nightstand', label: 'Nightstands', say: ['nightstand', 'night stand', 'bedside table', 'night table', 'bedside cabinet'], find: ['nightstand', 'nightstands', 'night stand'] },
  { id: 'dresser', label: 'Dressers and chests', say: ['dresser', 'chest', 'chest of drawers', 'bureau', 'tallboy', 'drawers'], find: ['dresser', 'dressers', 'chest'] },
  { id: 'bed', label: 'Beds', say: ['bed', 'bed frame', 'platform bed', 'headboard'], find: ['bed', 'beds', 'bed frames', 'platform beds & bed frames', 'headboard', 'headboards'] },
  { id: 'rug', label: 'Rugs', say: ['rug', 'area rug', 'carpet', 'runner', 'floor rug'], find: ['rug', 'rugs', 'runner'] },
  { id: 'mirror', label: 'Mirrors', say: ['mirror', 'wall mirror', 'floor mirror', 'standing mirror', 'vanity mirror'], find: ['mirror', 'mirrors'] },
  { id: 'art', label: 'Wall art', say: ['wall art', 'art', 'artwork', 'painting', 'paintings', 'print', 'prints', 'canvas', 'wall decor', 'picture', 'pictures', 'framed art', 'tapestry', 'wall hanging'], find: ['art', 'wall art', 'paintings', 'prints', 'visual artwork', 'artwork', 'canvas', 'painting', 'print', 'tapestry', 'decorative tapestries', 'wall decor'] },
  { id: 'sculpture', label: 'Sculptures', say: ['sculpture', 'statue', 'figurine', 'object', 'decorative object'], find: ['sculpture', 'sculptures', 'sculptures & statues', 'statue'] },
  { id: 'outdoor', label: 'Outdoor furniture', say: ['outdoor', 'outdoor furniture', 'patio', 'patio furniture', 'patio set', 'porch', 'deck', 'garden', 'lawn'], find: ['outdoor', 'outdoor furniture sets', 'patio'], collection: 'outdoor' },
];

/** Families of kinds: a category can add a kind to a piece, but not one from another family
 * (Shopify files one dining table under Dressers; its title says what it is). */
export const FAMILIES = {
  seating: ['sofa', 'sectional', 'loveseat', 'chaise', 'recliner', 'glider', 'armchair', 'chair', 'dining-chair', 'stool', 'bench', 'ottoman'],
  tables: ['coffee-table', 'end-table', 'console', 'dining-table', 'desk'],
  storage: ['sideboard', 'cabinet', 'tv', 'bookcase', 'nightstand', 'dresser'],
  beds: ['bed'],
  decor: ['rug', 'mirror', 'art', 'sculpture'],
};

/** Rooms: a shopper's room finds its collection on the site. */
export const ROOMS = [
  { id: 'living', label: 'Living room', say: ['living room', 'living', 'family room', 'den', 'lounge'], collection: 'living' },
  { id: 'dining', label: 'Dining room', say: ['dining room', 'dining', 'kitchen', 'breakfast nook', 'dining set', 'dining room set'], collection: 'dining' },
  { id: 'bedroom', label: 'Bedroom', say: ['bedroom', 'bedroom furniture', 'bedroom set', 'master bedroom', 'guest room', 'guest bedroom'], collection: 'bedroom' },
  { id: 'outdoor-room', label: 'Outdoor', say: ['outdoor', 'patio', 'porch', 'deck'], collection: 'outdoor' },
  { id: 'art-room', label: 'Art and mirrors', say: ['art and mirrors', 'wall decor', 'decor'], collection: 'art-mirrors' },
];

/** Color families: a shopper's color finds every shade the catalog names for it. */
export const COLORS = [
  { id: 'gray', say: ['gray', 'grey', 'charcoal', 'slate', 'pebble', 'granite', 'graphite', 'ash', 'silver', 'pewter', 'smoke', 'stone', 'anthracite', 'platinum', 'heather'] },
  { id: 'blue', say: ['blue', 'navy', 'denim', 'indigo', 'cobalt', 'teal', 'aqua', 'sky', 'sapphire', 'beamer blue', 'ocean'] },
  { id: 'green', say: ['green', 'olive', 'sage', 'forest', 'emerald', 'hunter green', 'moss', 'jade', 'mint', 'pine'] },
  { id: 'white', say: ['white', 'ivory', 'cream', 'off white', 'snow', 'alabaster', 'pearl', 'chalk', 'bone'] },
  { id: 'beige', say: ['beige', 'sand', 'natural', 'oat', 'oatmeal', 'linen', 'khaki', 'taupe', 'wheat', 'flax', 'pashimina', 'pashmina', 'bisque', 'tan', 'camel', 'putty', 'mushroom'] },
  { id: 'brown', say: ['brown', 'walnut', 'chestnut', 'espresso', 'mocha', 'chocolate', 'choco', 'cognac', 'caramel', 'tobacco', 'whiskey', 'rust', 'cinnamon', 'pecan', 'mahogany', 'cherry'] },
  { id: 'black', say: ['black', 'ebony', 'onyx', 'jet', 'blk', 'midnight'] },
  { id: 'gold', say: ['gold', 'brass', 'champagne', 'gilded', 'bronze'] },
  { id: 'red', say: ['red', 'burgundy', 'maroon', 'brick', 'terracotta', 'coral', 'blush', 'pink', 'rose', 'mauve'] },
  { id: 'yellow', say: ['yellow', 'mustard', 'gold yellow', 'ochre', 'saffron'] },
  { id: 'orange', say: ['orange', 'rust', 'amber', 'copper', 'pumpkin'] },
];

/** Materials, matched like colors. */
export const MATERIALS = [
  { id: 'leather', say: ['leather', 'top grain', 'faux leather', 'vegan leather', 'leatherette'] },
  { id: 'wood', say: ['wood', 'wooden', 'solid wood', 'natural wood', 'wood tone', 'light wood', 'dark wood', 'oak', 'walnut', 'pine', 'mango', 'acacia', 'teak', 'reclaimed', 'wood top'] },
  { id: 'marble', say: ['marble', 'faux marble', 'stone top', 'travertine'] },
  { id: 'glass', say: ['glass', 'glass top', 'tempered glass'] },
  { id: 'metal', say: ['metal', 'iron', 'steel', 'chrome', 'aluminum'] },
  { id: 'velvet', say: ['velvet', 'velour'] },
  { id: 'linen', say: ['linen', 'linen blend'] },
  { id: 'rattan', say: ['rattan', 'wicker', 'cane', 'woven', 'jute', 'seagrass'] },
  { id: 'boucle', say: ['boucle', 'bouclé', 'sherpa', 'faux fur'] },
];

/** Features that are words in titles and descriptions. */
export const FEATURES = [
  { id: 'swivel', say: ['swivel', 'swiveling', 'spinning', 'rotating'] },
  { id: 'round', say: ['round', 'circular', 'circle'] },
  { id: 'square', say: ['square'] },
  { id: 'rectangle', say: ['rectangle', 'rectangular', 'oblong'] },
  { id: 'oval', say: ['oval'] },
  { id: 'storage', say: ['storage', 'with storage', 'drawers', 'drawer', 'lift top'] },
  { id: 'upholstered', say: ['upholstered', 'uph', 'padded', 'fabric'] },
  { id: 'extendable', say: ['extendable', 'extending', 'expandable', 'leaf', 'drop leaf', 'butterfly leaf'] },
  { id: 'power', say: ['power', 'electric', 'motion'] },
  { id: 'rocking', say: ['rocking', 'rocker', 'rock'] },
  { id: 'nesting', say: ['nesting', 'nest of tables', 'set of 2', 'set of 3'] },
  { id: 'performance', say: ['performance fabric', 'performance', 'stain resistant', 'stain-resistant', 'easy clean', 'easy to clean', 'cleanable', 'pet friendly', 'pet-friendly', 'kid friendly', 'kid-friendly', 'family friendly', 'durable fabric', 'crypton', 'sunbrella'] },
  { id: 'usb', say: ['usb', 'usb port', 'charging', 'outlet', 'power outlet'] },
  { id: 'reversible', say: ['reversible', 'reversible chaise', 'reversible cushion'] },
  { id: 'removable', say: ['removable cover', 'removable cushion', 'removable cushions', 'washable', 'slipcover', 'slipcovered'] },
  { id: 'armless', say: ['armless', 'no arms', 'without arms'] },
  { id: 'tufted', say: ['tufted', 'tufting', 'button tufted', 'channel tufted', 'channel'] },
  { id: 'nailhead', say: ['nailhead', 'nail head', 'nailheads'] },
  { id: 'wingback', say: ['wingback', 'wing back', 'wing chair'] },
  { id: 'curved', say: ['curved', 'curve', 'rounded'] },
  { id: 'feather', say: ['feather', 'down filled', 'down blend', 'feather blend'] },
  { id: 'foam', say: ['memory foam', 'high density foam', 'foam cushions'] },
  { id: 'lift-top', say: ['lift top', 'lift-top', 'liftop'] },
  { id: 'counter-height', say: ['counter height', 'counter-height'] },
  { id: 'bar-height', say: ['bar height', 'bar-height', 'pub height'] },
  { id: 'queen', say: ['queen', 'qn', 'qu'] },
  { id: 'king', say: ['king', 'kg', 'cal king', 'california king'] },
  { id: 'full', say: ['full', 'double'] },
  { id: 'twin', say: ['twin', 'single'] },
];

/** Style words: they raise a match but never rule a product out (few products are tagged with a style). */
export const STYLES = ['modern', 'contemporary', 'mid century', 'midcentury', 'mid-century', 'farmhouse', 'rustic', 'industrial', 'traditional', 'transitional', 'coastal', 'boho', 'bohemian', 'glam', 'scandinavian', 'minimalist', 'vintage', 'classic', 'cozy', 'comfortable', 'comfy', 'small', 'large', 'big', 'oversized', 'compact', 'apartment', 'small space', 'luxury', 'elegant', 'cute', 'unique'];

/** Words that carry no meaning in a product search. */
export const STOPWORDS = new Set(['a', 'an', 'the', 'for', 'of', 'and', 'or', 'with', 'to', 'in', 'on', 'my', 'me', 'i', 'im', "i'm", 'need', 'needs', 'want', 'wanted', 'looking', 'look', 'find', 'some', 'something', 'anything', 'piece', 'pieces', 'that', 'which', 'this', 'is', 'are', 'it', 'its', 'do', 'you', 'have', 'has', 'any', 'nice', 'good', 'great', 'best', 'new', 'please', 'show', 'buy', 'shop', 'furniture', 'store', 'people', 'person', 'seats', 'seat', 'seating', 'nook', 'corner', 'room', 'space', 'like', 'by', 'from', 'at', 'can', 'could']);

/** Questions that aren't products: they lead to the page that answers them. */
export const PAGES = [
  { href: '/visit/', title: 'Visit the showroom', blurb: 'Hours, address, parking, pickup and delivery', say: ['hours', 'open', 'opening', 'closing', 'closed', 'when are you open', 'address', 'location', 'locations', 'where', 'directions', 'map', 'parking', 'pickup', 'pick up', 'delivery', 'deliver', 'shipping', 'ship', 'showroom', 'visit', 'store hours', 'phone', 'contact', 'call'] },
  { href: '/about/', title: 'Our mission', blurb: '100% of profits fund home makeovers for kids with special needs', say: ['mission', 'about', 'charity', 'nonprofit', 'non profit', 'sunshine', 'soard', 'kids', 'donate', 'donation', 'donations', 'donating', 'donate furniture', 'volunteer', 'volunteering', 'tax deductible'] },
  { href: '/return-policy/', title: 'Return policy', blurb: 'What we can take back, and how', say: ['return', 'returns', 'return policy', 'refund', 'refunds', 'exchange', 'exchanges', 'warranty', 'damaged', 'cancel', 'cancellation'] },
  { href: '/join/', title: 'Join the email list', blurb: 'New arrivals and sales first', say: ['newsletter', 'email list', 'email', 'mailing list', 'sign up', 'signup', 'subscribe', 'coupon', 'discount', 'promo', 'promo code', 'sale alerts'] },
];

/**
 * Real words for things a home store might sell that this one doesn't (2026-11-16: no lamps,
 * pillows or vases in the catalog). A typo fix would turn them into a word the catalog has
 * ("card" into "cart", "vase" into "base") and show pieces nobody asked for; left alone, they
 * find nothing and the shopper is offered what the store does have.
 */
export const REAL_WORDS = ['card', 'gift', 'gift card', 'lamp', 'light', 'lighting', 'chandelier', 'pendant', 'sconce', 'vase', 'candle', 'candlestick', 'pillow', 'cushion', 'throw', 'blanket', 'quilt', 'duvet', 'comforter', 'sheet', 'bedding', 'curtain', 'drape', 'blind', 'plant', 'planter', 'pot', 'basket', 'clock', 'frame', 'picture frame', 'tray', 'bowl', 'book', 'towel', 'crib', 'toy', 'dish', 'plate', 'mug', 'cup', 'wreath', 'ornament', 'christmas', 'holiday', 'garland', 'lantern', 'hook', 'umbrella', 'hammock', 'grill', 'fan', 'heater', 'appliance', 'tv', 'television', 'piano', 'treadmill', 'bike', 'safe', 'mat', 'doormat', 'flower', 'faux plant', 'diffuser', 'soap', 'jewelry', 'bag', 'hat', 'shirt', 'clothes', 'shoe'];

/** Price words: "under 500", "less than $1,000", "over 800", "between 200 and 400", "cheap". */
export const CHEAP = ['cheap', 'inexpensive', 'affordable', 'budget', 'bargain', 'deal', 'deals', 'low price', 'clearance'];
