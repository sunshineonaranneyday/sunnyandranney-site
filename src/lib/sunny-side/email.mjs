/**
 * The Sunny Side: the store's weekly email (production design: "Sunny", option B)
 * ===========================================================================
 * One weekly brief in, one Kit-ready email out. The same code builds the email
 * for sending (scripts/sunny-side/build.mjs) and draws the live preview Staci
 * sees while she types the week's special in the admin, so the preview is the
 * email. No Node or browser APIs, so it runs in both.
 *
 *   the photographer's photos -> brief.hero, brief.story.photo
 *   the store's products      -> brief.wall.photos (4-9), read live from their pages by the build
 *   Staci's special           -> brief.sale    kind: "tiers" (2-4) | "percent" | "headline"
 *   Staci's events            -> brief.events  each with dated items; past dates drop out, and the
 *                                                line under the title is written from the dates left
 *   a reveal still ahead      -> brief.reveal  the charity's invite to watch it live, under the story
 *   the latest reveal         -> brief.mission
 *
 * Design: bold color blocks and edge-to-edge photos, like a bright weekly flyer.
 *   Rhythm: a photo always sits directly on top of the block it belongs to (the hero on the gold
 *           offer), and white space separates a photo from any block it doesn't belong to, so
 *           nothing reads as part of its neighbor.
 *   Color:  only colors the live sunnyandranney.com shows. One color, one job:
 *           gold = buy, teal = events, charcoal for words. The one exception is the charity section,
 *           which wears Sunshine on a Ranney Day's own identity (Peter, 2026-11-11), taken from
 *           sunshineonaranneyday.com and its brand guide at /branding/, laid out like the charity's
 *           own emails (Peter, 2026-11-16): a Dark Deep top with its logo and a Libre Baskerville
 *           headline whose key words are yellow italic, the family's photo, a cream story, and its
 *           impact strip (Dark Deep with Sunshine Yellow numbers).
 *   Type:   DM Sans (the site's font). Outlook falls back to Arial, Gmail to Helvetica.
 *   Space:  8 / 16 / 24 / 32 / 40 px; 40 becomes 32 on phones. Radius: 8 buttons, 12 cards. Photos square.
 *   Grid:   words and cards sit on one 536px column (32px sides; 20px on phones). Photos run the full
 *           600px. The photo wall's 4px gutters live inside its cells, split so the outer tiles touch
 *           both edges, because Gmail strips the negative margins that would otherwise do it.
 *   Phones first: every size written inline is a phone's (type, padding, gaps), and a computer's
 *           comes from the style block (min-width:621px) and from Outlook's own block. Some mail apps
 *           throw the style block away (the Gmail app with a Yahoo, Outlook or iCloud account), so
 *           whatever must fit a 320px phone can't depend on it: without it the email reads as it
 *           does on a phone, at any width. Rows that sit side by side on a computer (the visit
 *           row, the charity's numbers) wrap by their own widths, with no media query (FAB_FOUR,
 *           statColumns). verify.mjs renders every email with the style block and without it, at
 *           every width from 320 to 700px.
 *   First screen: on a phone, the sale button lands within the first 600px (verify.mjs fails it otherwise).
 *   Contrast (WCAG AA): charcoal on white 14.0, on gold 9.9; white on teal 4.9; SOARD Dark on Warm
 *                       Gray 10.6, Muted on it 6.2; Sunshine Yellow on Dark Deep 12 -> all any size.
 * Every store link carries its own utm_content, so Kit's click report shows which slot was tapped.
 */

import { icsUrl, photoPath } from './addresses.mjs';
import { CLASSIC, LAYOUTS, layoutOf, paddings, solve } from './collage-layouts.mjs';
import { photoSource } from './photo-store.mjs';
import { money } from './product.mjs';

// ── Tokens ──────────────────────────────────────────────────────────────────
export const GOLD = '#FFD400', TEAL = '#2B7A96';
export const CHARCOAL = '#2C2C2C', STONE = '#6B6B68', WHITE = '#FFFFFF';
const SANS = "'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const S1 = 8, S2 = 16, S3 = 24, S4 = 32, S5 = 40; // spacing scale
const PHONE_SIDE = 20; // the column's sides on a phone (32 on a computer)
/** The email's full width and its column on a computer: 600px less 32px each side. */
const WIDTH = 600, COLUMN = WIDTH - 2 * S4;
/** Wider than this, the style block's computer sizes apply (min-width); this wide or narrower, a phone's. */
const DESKTOP = 621;
/** Each of the charity's numbers: three fit across the smallest phone's 280px column, and a computer's 536. */
const STAT_PHONE = 93, STAT_DESKTOP = 178;
/** The visit row's button column, beside the address on a computer. */
const VISIT_BUTTON = 210;
const R_BTN = 8, R_CARD = 12;
const LABEL_LH = 16; // line height of the small uppercase labels
const GUTTER = 4; // between photo wall tiles

export const SITE = 'https://sunnyandranney.com';
const MAP = 'https://maps.app.goo.gl/QXwgPyiX93HkwjwDA';
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
// The store's own files on Shopify's CDN: the only source the domain's image resizing accepts.
export const SHOP_FILES = 'https://cdn.shopify.com/s/files/1/0930/2117/6092/';
// Cloudflare's image resizing for the domain (on since Nov 12, 2026). It runs only on hostnames
// Cloudflare proxies, and sunnyandranney.com itself is DNS-only to the Pages site, so it's served
// from shop.sunnyandranney.com, the proxied hostname that redirects old shop links.
export const RESIZE = 'https://shop.sunnyandranney.com/cdn-cgi/image';
// The store's own uploads (the week's top photo, the story's collage) live on the site, at
// /media/email/<id>.jpg/ (photoPath), and go out through the same resizing, cropped around what's in them.
let photoOrigin = SITE;
let photoDirect = false;
/** For the admin run locally, whose uploads aren't on the live site: show them as they are. */
export function usePhotoOrigin(origin, { direct = false } = {}) {
  photoOrigin = origin;
  photoDirect = direct;
}
const isPng = (url) => /\.png(\?|$)/i.test(url);
const LOGO = `${CF}/logo-tagline-light-bg/w=360,h=144,fit=scale-down,format=png`; // 1000x400 original, 2.5:1
const PIG = `${CF}/logo-tagline-light-bg/trim=2;300;192;230,w=192,format=png`; // the flying pig, 192x84
const GREG = `${CF}/team/greg-ranney/w=88,h=88,fit=cover,gravity=auto,quality=70,format=jpeg`;

// ── The charity's identity, for its section only ────────────────────────────
// Values as sunshineonaranneyday.com renders them (its CSS variables), which its brand guide
// (/branding/) also lists: Sunshine Yellow for buttons and accents, SOARD Dark for words, Warm Gray
// for section backgrounds, Dark Deep for its impact strip, and its muted text.
export const SOARD_YELLOW = '#FFDA24', SOARD_DARK = '#373A36', SOARD_DEEP = '#1E1F25';
export const SOARD_WARM = '#F5F4F0', SOARD_MUTED = '#5A5B61';
// Two more as the charity's own emails draw them (its reveal invite, measured in Gmail on Nov 16, 2026):
// the cream its story sections sit on, and the soft white of the italic line over its headline.
export const SOARD_CREAM = '#FEFCF5', SOARD_SOFT = '#E4E4E5';
const SERIF = "'Libre Baskerville', Georgia, 'Times New Roman', serif";
// Numbers fall back to Times New Roman, not Georgia: Georgia's figures are old-style, so in Gmail
// (no web fonts) "$0" read as "$o" and "295" dropped below the line.
const NUMERALS = "'Libre Baskerville', 'Times New Roman', Times, serif";
const OUTFIT = "'Outfit', 'Helvetica Neue', Helvetica, Arial, sans-serif";
// The logo the charity's own emails open with on their Dark Deep (its reveal invite, Nov 16, 2026):
// the guide's display logo for dark backgrounds with "Dreams Built Here", the 600x600 file's logo
// (102-499 by 98-470) cut with 10px of its own margin to 417x392, shown at 96x90 on a computer, as
// the charity shows it, and 80 on a phone (its brand guide's smallest digital size is 75). Its
// artwork is yellow and white, so it stays readable when a mail app darkens the page.
const SOARD_LOGO_DARK = `${CF}/brand-logo-dark-bg-tagline-display/trim=88;91;120;92,w=192,format=png`;
const SOARD_LOGO_DARK_W = 96, SOARD_LOGO_DARK_H = 90;
const SOARD_HOME = 'https://sunshineonaranneyday.com/';

/** The phone width the first-screen rule is measured at, and how far down the sale button may sit. */
export const FIRST_SCREEN = 600;

// ── Text helpers ────────────────────────────────────────────────────────────
/** HTML-escapes text for an attribute or element: & < > " and ' */
export function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const UTF8 = new TextEncoder();
/** Percent-encodes like a URL query value: letters, digits and _.-~ stay, everything else is %XX (UTF-8). */
function encode(s, keep) {
  let out = '';
  for (const ch of String(s)) {
    if (/[A-Za-z0-9_.\-~]/.test(ch) || keep.includes(ch)) out += ch;
    else for (const byte of UTF8.encode(ch)) out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
/**
 * Brief text as plain text, for anything that isn't HTML: calendar notes, and the subject and preview
 * line Kit takes as plain text (an inbox shows "Santa&#8217;s" as it's written). No tags, every entity
 * the email writes decoded, &amp; last so nothing is decoded twice.
 */
export const plain = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
/** A form-encoded query string: spaces become +. */
function formEncode(params) {
  return Object.entries(params).map(([k, v]) => `${encode(k, ' ').replace(/ /g, '+')}=${encode(v, ' ').replace(/ /g, '+')}`).join('&');
}

/**
 * Joins the last two words, so a wide line (headlines, the "when" line) never ends with one word
 * alone. Not for narrow columns, where the joined pair would force an earlier, worse break.
 */
export function noWidow(t) {
  let inside = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === '>') inside++;
    else if (t[i] === '<') inside--;
    else if (t[i] === ' ' && !inside) return t.slice(0, i) + '&nbsp;' + t.slice(i + 1);
  }
  return t;
}

/** How much of a family's summary the email shows, in letters, before "Read more" (the charity's run 180–220). */
export const LEAD = 140;
const SENTENCE_END = /(?<!\b(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|Mt|Ft))[.!?](?:&#8221;|&#8217;)?(?=(?:\s|&nbsp;)+(?:[A-Z0-9]|&#8220;|&#8216;))/g;
/**
 * The start of a summary the charity wrote (HTML text, as typeset): its whole sentences while they fit
 * in LEAD letters, and at least the first. A first sentence longer than that (two of the charity's 18,
 * Nov 17, 2026, are one 205-letter sentence) is cut at a word, with an ellipsis.
 */
export function lead(t, max = LEAD) {
  const s = String(t).trim();
  const letters = (x) => x.replace(/&#?\w+;/g, '_').length;
  let out = '';
  for (const m of s.matchAll(SENTENCE_END)) {
    const next = s.slice(0, m.index + m[0].length);
    if (out && letters(next) > max) break;
    out = next;
  }
  // The last sentence has no sentence after it to find it by: the whole summary, when it all fits
  if (!out || letters(s) <= max) out = s;
  if (letters(out) <= max) return out;
  // Too long: up to the last word that fits, without the comma or dash it ended on
  const bits = out.match(/&#?\w+;|[\s\S]/g);
  let n = 0;
  let cut = 0;
  for (let i = 0; i < bits.length && n < max; i++, n++) if (bits[i] === ' ' || bits[i] === '&nbsp;') cut = i;
  return bits.slice(0, cut).join('').replace(/(?:[,;:–—-]|&#8212;|&#8211;|&mdash;|&ndash;)+$/, '') + '&#8230;';
}

/** A CSS pixel length, keeping fractions (the wall's split gutters) and dropping trailing zeros. */
function px(x) {
  return x ? x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'px' : '0';
}

/** A percentage width as the table cells write it: 50.0, 33.33, 25.0 */
function pct(x) {
  const r = Math.round(x * 100) / 100;
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
}

/** Whole dollars with thousands separators: 1,000 */
const dollars = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── Dates (all calendar dates, no time zone) ────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A 'YYYY-MM-DD' calendar date as a UTC-midnight Date. */
export function day(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Not a date: ${iso}`);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Not a date: ${iso}`);
  return d;
}
export const monthShort = (d) => MONTHS[d.getUTCMonth()];
export const weekday = (d) => DAYS[d.getUTCDay()];
const weekdayShort = (d) => DAYS[d.getUTCDay()].slice(0, 3);
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

// ── The tiers' sizes ────────────────────────────────────────────────────────
/**
 * The tiers sit in one row, as many columns as tiers, with a charcoal rule between them. Every
 * column but the last keeps 8px clear before the next rule. A two-digit percent in bold DM Sans is
 * 2.08 times its size wide, so the number size by count is the largest that fits the narrowest
 * column at each width: (desktop 536px, phones 335px+, phones under 375px down to 280px).
 * Four tiers, or any tier from $10,000 up, write every amount in the row short ($2.5k+, $10k+),
 * since "$2,500+" can't break and is wider than a quarter of a small phone, and "$10,000+" is
 * wider than a third of one. Spend comes in multiples of $50, so the short form is always exact.
 * Under 375px no three- or four-tier caption fits on one line, so every caption in the row
 * stacks ("off" over the amount) and the columns stay even.
 */
export const TIER_SIZE = { 2: [80, 56, 56], 3: [64, 40, 32], 4: [52, 28, 22] };
export const amount = (spend, short) => (short && spend >= 1000 ? `$${String(spend / 1000)}k+` : `$${dollars(spend)}+`);

// ── What the subject and preheader promise ───────────────────────────────────
/**
 * The offer comes from the admin, where Staci sets it, but the subject and preheader are written
 * in the brief. So they can name it without typing its numbers: "{offer}" becomes the offer in a
 * line ("Spend $250, save 10%. Spend $1,000, save 20%." or "20% off everything.") and "{upto}"
 * its biggest percent ("20%"). Anything either line says about the discount is then checked
 * against the offer: every percent off must be one the sale gives, "up to" must be its biggest,
 * and in a tiered sale every dollar amount must be a tier, with that tier's own percent beside
 * it. "100% of our profits" is a share, not a discount.
 */
export function offerLine(sale) {
  if (sale?.kind === 'tiers') {
    const shown = sale.tiers.length > 2 ? [sale.tiers[0], sale.tiers[sale.tiers.length - 1]] : sale.tiers;
    return shown.map(([spend, off]) => `Spend $${dollars(spend)}, save ${off}%.`).join(' ');
  }
  if (sale?.kind === 'percent') return `${sale.percent}% off ${plain(sale.what)}`;
  throw new Error('The brief asks for {offer}, but this week has no discount.');
}

function mostOff(sale) {
  if (sale?.kind === 'tiers') return `${Math.max(...sale.tiers.map(([, off]) => off))}%`;
  if (sale?.kind === 'percent') return `${sale.percent}%`;
  throw new Error('The brief asks for {upto}, but this week has no discount.');
}

/** The subject and preheader as they go out, with {offer} and {upto} written from the offer. Throws if either promises what the offer doesn't give. */
/** A subject or preheader with {offer} and {upto} written from the sale. */
export const fillLine = (t, sale) => String(t || '').replace('{offer}', () => offerLine(sale)).replace('{upto}', () => mostOff(sale));

export function lines(brief) {
  const fill = (t) => fillLine(t, brief.sale);
  const subject = fill(brief.subject);
  const preheader = fill(brief.preheader);
  const claims = [...offerClaims(subject, brief.sale, 'subject'), ...offerClaims(preheader, brief.sale, 'preheader')];
  if (claims.length) throw new Error(`The subject or preheader doesn't match the offer: ${claims.join(' ')}`);
  return { subject, preheader };
}

const spendOf = (digits, k) => Number(digits.replace(/,/g, '')) * (k ? 1000 : 1);
const MONEY = String.raw`\$(\d[\d,]*(?:\.\d+)?)(k)?`;

/** @returns {string[]} what the line says that the offer doesn't give, in words */
export function offerClaims(line, sale, where) {
  const text = plain(String(line || ''));
  const offs = sale?.kind === 'tiers' ? sale.tiers.map(([, off]) => off) : sale?.kind === 'percent' ? [sale.percent] : [];
  const gives = offs.length ? `the sale gives ${offs.map((o) => `${o}%`).join(', ')}` : 'this week has no discount';
  const problems = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%(?!\s+of\b)/gi)) {
    if (!offs.includes(Number(m[1]))) problems.push(`The ${where} says ${m[1]}%, but ${gives}.`);
  }
  for (const m of text.matchAll(/up to\s+(\d+)\s?%/gi)) {
    const most = Math.max(...offs);
    if (offs.length && Number(m[1]) !== most) problems.push(`The ${where} says up to ${m[1]}%, but the most the sale gives is ${most}%.`);
  }
  if (sale?.kind === 'tiers') {
    const tier = new Map(sale.tiers.map(([spend, off]) => [spend, off]));
    const list = sale.tiers.map(([spend]) => `$${dollars(spend)}`).join(', ');
    for (const m of text.matchAll(new RegExp(MONEY, 'gi'))) {
      if (!tier.has(spendOf(m[1], m[2]))) problems.push(`The ${where} says $${m[1].replace(/,$/, '')}${m[2] || ''}, but the tiers are ${list}.`);
    }
    // "Spend $250, save 10%" and "10% on $250"
    const pairs = [
      ...[...text.matchAll(new RegExp(String.raw`spend\s+${MONEY}[^$%]{0,12}?save\s+(\d+)\s?%`, 'gi'))].map((m) => [spendOf(m[1], m[2]), Number(m[3])]),
      ...[...text.matchAll(new RegExp(String.raw`(\d+)\s?%\s+(?:off\s+)?(?:on|over)\s+${MONEY}`, 'gi'))].map((m) => [spendOf(m[2], m[3]), Number(m[1])]),
    ];
    for (const [spend, off] of pairs) {
      if (tier.has(spend) && tier.get(spend) !== off) problems.push(`The ${where} pairs $${dollars(spend)} with ${off}%, but that tier gives ${tier.get(spend)}%.`);
    }
  }
  return problems;
}

// Products sit at most two to a row: three across leaves about 95px a tile on a small phone, too narrow
// for a name and price, and too small to tap. An odd count leads with one big product.
const WALL_ROWS = { 4: [2, 2], 5: [1, 2, 2], 6: [2, 2, 2], 7: [1, 2, 2, 2], 8: [2, 2, 2, 2], 9: [1, 2, 2, 2, 2] };
/** What each photo shows at 600px with the gutters taken out (3:2 for the lead, square for pairs). Outlook sizes images by these. */
const SHAPE = { 1: [600, 400], 2: [298, 298] };
/**
 * The story's classic collage, by how many photos: one wide, then rows of two or three. It's the first
 * of each count's layouts (collage-layouts.mjs), which the brief's story.layout picks from.
 * @type {Record<number, number[]>}
 */
export const COLLAGE_ROWS = { 1: [1], 2: [2], 3: [1, 2], 4: [1, 3], 5: [1, 2, 2] };

/**
 * The parts of the email Staci writes or picks, each band tagged with its own (Email.band's `part`), so
 * the admin's preview knows which section a too-wide word is in. Untagged bands (the masthead, the top
 * photo, the visit row, the footer) are the email's own layout.
 */
export const PARTS = ['offer', 'wall', 'story', 'reveal', 'events', 'mission'];

/** The web-font link as the email writes it, hidden from Outlook. */
export const FONT_LINK = /<!--\[if !mso\]><!--><link href="https:\/\/fonts\.googleapis\.com[^>]*><!--<!\[endif\]-->/;

/**
 * The email as a mail app that drops its styling shows it (the Gmail app with a Yahoo, Outlook or
 * iCloud address): no style block and no web fonts, only the inline styles. The email is written
 * phones first, so it still fits. What "bare" means wherever it's checked: verify.mjs, the admin's
 * preview and the tests, so they can't drift apart.
 */
export const bareEmail = (html) => html.replace(FONT_LINK, '').replace(/<style[\s\S]*?<\/style>/g, '');

/** Every section, top to bottom. A preview can ask for just the first few. */
export const SECTIONS = ['masthead', 'hero', 'offer', 'wall', 'story', 'reveal', 'events', 'mission', 'visit', 'footer'];

/** Builds one issue. Holds the brief so every link can be tagged for its slot. */
export class Email {
  constructor(brief) {
    this.b = brief;
    this.campaign = 'sunny-side-' + brief.send_date;
  }

  // ── links and images ──
  /** Tag store and charity links with their slot; leave maps, social and calendars alone. */
  url(href, slot) {
    if (!(href.startsWith(SITE) || href.startsWith('https://sunshineonaranneyday.com'))) return href;
    const tag = formEncode({ utm_source: 'kit', utm_medium: 'email', utm_campaign: this.campaign, utm_content: slot });
    return `${href}${href.includes('?') ? '&' : '?'}${tag}`;
  }

  static photo(src, w, h) {
    if (src.startsWith('photo:')) {
      // "photo:<id>", or "photo:<id>@0.42x0.31" with the part every crop keeps in view (photo-store.mjs)
      const { id, gravity } = photoSource(src);
      const file = `${photoOrigin}${photoPath(id)}`;
      return photoDirect ? file : `${RESIZE}/width=${w},height=${h},fit=cover,gravity=${gravity},quality=64,format=jpeg/${file}`;
    }
    if (src.startsWith('cf:')) return `${CF}/${src.slice(3)}/w=${w},h=${h},fit=cover,gravity=auto,quality=64,format=jpeg`;
    // Shopify won't send a PNG saved with a transparency channel as a JPEG, even when nothing in it is
    // see-through, and Mac screenshots all save one (49 of the 51 PNG-only products in stock on Nov 12,
    // 2026 were screenshots), so the store's PNGs go through Cloudflare's resizing on its own domain
    // (RESIZE), which sends every one as a JPEG, on white if anything is see-through. It accepts only
    // the store's own Shopify files (SHOP_FILES). Shopify resizes the rest itself, and sends its WebP,
    // AVIF and HEIC photos as JPEGs too, which Outlook can show. verify.mjs fetches every image as sent.
    if (isPng(src) && src.startsWith(SHOP_FILES)) return `${RESIZE}/width=${w},height=${h},fit=cover,gravity=center,quality=64,format=jpeg,background=white/${src}`;
    return `${src}${src.includes('?') ? '&' : '?'}width=${w}&height=${h}&crop=center&quality=64&format=jpg`;
  }

  /** A photo `w` by `h` (Outlook's size), as wide as its cell up to `max`: its own width, or the column's for a photo on the column. */
  img(src, w, h, alt, href, slot, radius = 0, cls = '', max = w, shape = [w, h]) {
    const c = cls ? ` class="${cls}"` : '';
    // A store photo shown straight from the site (the admin, run locally) isn't cropped by the
    // resizing, so the browser crops it to the same shape, keeping the preview's measurements true
    const crop = photoDirect && src.includes('/media/email/') ? `aspect-ratio:${shape[0]}/${shape[1]};object-fit:cover;` : '';
    const tag =
      `<img${c} src="${escape(src)}" width="${w}" height="${h}" alt="${escape(alt)}" style="display:block;width:100%;` +
      `max-width:${typeof max === 'number' && !Number.isInteger(max) ? px(max) : `${max}px`};height:auto;${crop}border:0;border-radius:${radius}px;">`;
    if (!href) return tag;
    return `<a href="${escape(this.url(href, slot))}" target="_blank" style="display:block;color:${CHARCOAL};">${tag}</a>`;
  }

  /** An edge-to-edge photo band. */
  fullPhoto(p, w, h, href, slot, part = '') {
    return this.band(this.img(Email.photo(p.src, w * 2, h * 2), w, h, p.alt, href, slot), { top: 0, side: 0, bottom: 0, part });
  }

  link(text, href, slot, color = CHARCOAL, size = 15) {
    return (
      `<a href="${escape(this.url(href, slot))}" target="_blank" style="display:inline-block;padding:12px 0;` +
      `font-family:${SANS};font-size:${size}px;line-height:20px;font-weight:700;color:${color};` +
      `text-decoration:underline;text-underline-offset:3px;">${text}</a>`
    );
  }

  /**
   * Bulletproof: VML for Outlook, a padded link everywhere else. Full width on phones.
   * `pill` rounds the ends fully, the way the charity's site draws its buttons.
   */
  button(text, href, slot, bg, fg, align = 'left', { pill = false, font = SANS } = {}) {
    const u = escape(this.url(href, slot));
    const width = 56 + 9 * [...text.replace(/&#8594;/g, 'x').replace(/&#8217;/g, "'").replace(/&amp;/g, '&')].length;
    const radius = pill ? 999 : R_BTN;
    // In a full-width row of its own: a table with align= floats, and whatever came after it (the
    // sale's fine print) sat beside the button on a computer instead of under it.
    // Phones first: inline the button fills its row, so it does on a phone even when the mail app
    // throws the style block away; the computer's rules (.btn) give it its own width back. Outlook,
    // whose button is the VML shape, gets a table of its own width: a full-width one would paint
    // the color across the whole row around the shape.
    const attrs = `role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" class="btn"`;
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${align}">` +
      `<!--[if mso]><table ${attrs} style="border-collapse:separate;"><![endif]-->` +
      `<!--[if !mso]><!--><table ${attrs} style="border-collapse:separate;width:100%;"><!--<![endif]-->` +
      `<tr><td bgcolor="${bg}" style="border-radius:${radius}px;background-color:${bg};">` +
      `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
      `href="${u}" style="height:52px;v-text-anchor:middle;width:${width}px;" arcsize="${pill ? '50%' : '15%'}" stroke="f" fillcolor="${bg}">` +
      `<w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center>` +
      `</v:roundrect><![endif]--><!--[if !mso]><!-->` +
      `<a href="${u}" target="_blank" style="display:block;text-align:center;padding:16px 28px;font-family:${font};font-size:16px;` +
      `line-height:20px;font-weight:700;color:${fg};text-decoration:none;border-radius:${radius}px;border:2px solid ${bg};">${text}</a>` +
      `<!--<![endif]--></td></tr></table></td></tr></table>`
    );
  }

  // ── layout primitives ──
  static T(inner, attrs = 'width="100%"') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>${inner}</table>`;
  }

  /**
   * One full-width row of the email, padded as asked on a computer. Inline it's padded as on a phone,
   * phones first: 40 top/bottom -> 32 (pt, pb), 32 sides -> 20 (px); anything else stays as is. The
   * style block gives the computer its 40s and 32s back.
   */
  band(inner, { bg = WHITE, top = S5, side = S4, bottom = S5, cls = '', part = '' } = {}) {
    const c = [side === S4 ? 'px' : '', top === S5 ? 'pt' : '', bottom === S5 ? 'pb' : '', cls].filter(Boolean).join(' ');
    // The part of the email a band holds (PARTS), so the admin's preview can say which section a word
    // that's too wide is in, and send Staci there, instead of guessing from the page's structure
    const attr = (c ? ` class="${c}"` : '') + (part ? ` data-part="${part}"` : '');
    const phone = { top: top === S5 ? S4 : top, side: side === S4 ? PHONE_SIDE : side, bottom: bottom === S5 ? S4 : bottom };
    return (
      `<tr><td${attr} bgcolor="${bg}" style="background-color:${bg};color:${CHARCOAL};` +
      `padding:${phone.top}px ${phone.side}px ${phone.bottom}px;">${inner}</td></tr>`
    );
  }

  static gap(h, cls = '') {
    const c = cls ? ` class="${cls}"` : '';
    return `<div${c} style="height:${h}px;line-height:${h}px;font-size:${h}px;">&nbsp;</div>`;
  }

  /** White space between a photo and a block it doesn't belong to (40px, 32 on phones: 32 inline, phones first). */
  breather() {
    return this.band(Email.gap(S4, 'g40'), { top: 0, side: 0, bottom: 0 });
  }

  /** A paragraph. `size` and `lh` are a phone's (phones first); a class in the style block gives a computer bigger ones. */
  static text(t, { size = 17, lh = 26, weight = 400, color = CHARCOAL, mb = 0, align = 'left', tag = 'p', cls = '', track = '', font = SANS, css = '' } = {}) {
    const c = cls ? ` class="${cls}"` : '';
    const ls = track ? `letter-spacing:${track};` : '';
    return (
      `<${tag}${c} style="margin:0 0 ${mb}px;font-family:${font};font-size:${size}px;line-height:${lh}px;` +
      `font-weight:${weight};${ls}color:${color};text-align:${align};${css}mso-line-height-rule:exactly;">${t}</${tag}>`
    );
  }

  static label(t, { color = CHARCOAL, mb = S1, align = 'left', font = SANS, track = '0.14em' } = {}) {
    return (
      `<p style="margin:0 0 ${mb}px;font-family:${font};font-size:12px;line-height:${LABEL_LH}px;font-weight:700;` +
      `letter-spacing:${track};text-transform:uppercase;color:${color};text-align:${align};">${t}</p>`
    );
  }

  /** A section headline: 26/30 on a phone, 30/34 on a computer (.h2). */
  static h2(t, { color = CHARCOAL, mb = 12 } = {}) {
    return Email.text(noWidow(t), { size: 26, lh: 30, weight: 700, color, mb, tag: 'h2', cls: 'h2', track: '-0.015em' });
  }

  // ── sections, top to bottom ──
  /** Slim, like a magazine masthead: the logo left, the newsletter's name and issue date right. */
  masthead() {
    const d = day(this.b.send_date);
    // 120px on a phone, 150 on a computer (.logo); the width attribute is Outlook's
    const logo =
      `<a href="${escape(this.url(SITE + '/', 'masthead'))}" target="_blank" class="logo" ` +
      `style="display:block;width:120px;color:${CHARCOAL};">` +
      `<img class="logo" src="${LOGO}" width="150" height="60" alt="Sunny &amp; Ranney" ` +
      `style="display:block;width:120px;height:auto;border:0;"></a>`;
    const name =
      Email.label('The Sunny Side', { mb: 2, align: 'right' }) +
      Email.text(`${monthShort(d)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`, { size: 13, lh: 18, align: 'right' });
    return this.band(
      Email.T(`<tr><td valign="middle">${logo}</td>` + `<td align="right" valign="middle" style="padding-left:${S2}px;">${name}</td></tr>`),
      { top: S2, bottom: S2 },
    );
  }

  hero() {
    return this.fullPhoto(this.b.hero, 600, 300, SITE + this.b.sale.url, 'hero-photo');
  }

  tiers(tiers) {
    const n = tiers.length;
    if (!(n >= 2 && n <= 4)) throw new Error(`sale.tiers: the offer shows 2 to 4 tiers, not ${n}`);
    // Phones first: inline, the size that fits the smallest phone; the style block grows it from 375px and again on a computer
    const size = TIER_SIZE[n][2];
    const short = n === 4 || tiers.some(([spend]) => typeof spend === 'number' && spend >= 10000);
    let tds = '';
    tiers.forEach(([spend, percent], k) => {
      const rule = k ? `border-left:2px solid ${CHARCOAL};padding-left:14px;` : '';
      const clear = k < n - 1 ? `padding-right:${S1}px;` : '';
      const cap = [n >= 3 ? 'cap' : '', n === 4 ? 'cap4' : ''].filter(Boolean).join(' ');
      // Under 375px "off" sits over the amount in every column (min-content), so the columns stay even
      const caption = n === 4 ? { size: 13, lh: 18 } : { size: 15, lh: 20 };
      tds +=
        `<td width="${pct(100 / n)}%" valign="top" style="${rule}${clear}">` +
        Email.text(`${percent}%`, { size, lh: size, weight: 700, cls: `tier${n}`, track: '-0.04em', mb: 4 }) +
        Email.text(`off ${amount(spend, short)}`, { ...caption, weight: 700, cls: cap, css: n >= 3 ? 'width:min-content;' : '' }) +
        '</td>';
    });
    return Email.T(`<tr>${tds}</tr>`, 'width="100%" style="table-layout:fixed;"');
  }

  offer() {
    const s = this.b.sale;
    let out = Email.label(s.name);
    if (s.kind === 'percent') {
      // 76/74 on a phone, 92/88 on a computer (.mega); "what" 32/36, 40/44 (.mega2)
      out +=
        `<h1 class="mega" style="margin:0;font-family:${SANS};font-size:76px;line-height:74px;font-weight:700;` +
        `letter-spacing:-0.045em;color:${CHARCOAL};mso-line-height-rule:exactly;">${s.percent}%&nbsp;off</h1>` +
        Email.text(s.what, { size: 32, lh: 36, weight: 700, mb: S3, cls: 'mega2', track: '-0.025em' });
    } else {
      // 26/30 on a phone, 32/36 on a computer (.h1)
      out += Email.text(noWidow(s.headline), { size: 26, lh: 30, weight: 700, mb: s.kind === 'tiers' ? S3 : S2, tag: 'h1', cls: 'h1', track: '-0.015em' });
      if (s.kind === 'tiers') out += this.tiers(s.tiers) + Email.gap(S3);
    }
    out += this.button(`${s.cta} &#8594;`, SITE + s.url, 'offer-button', CHARCOAL, WHITE);
    // fine print after the button, so it never pushes the button down
    if (s.details) out += Email.gap(S2) + Email.text(s.details, { size: 15, lh: 22, cls: 'fine' });
    return this.band(out, { bg: GOLD, top: S4, part: 'offer' });
  }

  /**
   * One product: its photo, its name and its price, all one link to its page on sunnyandranney.com.
   * The photo runs edge to edge like the rest of the wall; the words sit inset by the column's margin
   * from the tile's own edge, so the first tile's words line up with the rest of the email.
   */
  tile(ph, cw, ch, slot) {
    if (!ph.name || !(ph.price > 0)) throw new Error(`wall: every product needs its name and price (${slot}).`);
    return (
      `<a href="${escape(this.url(ph.url, slot))}" target="_blank" style="display:block;color:${CHARCOAL};text-decoration:none;">` +
      `<img src="${escape(Email.photo(ph.src, cw * 2, ch * 2))}" width="${cw}" height="${ch}" alt="" ` +
      `style="display:block;width:100%;max-width:${cw}px;height:auto;border:0;">` +
      // Inset by the column's side: 20px on a phone, 32 on a computer (.tile-cap)
      `<span class="tile-cap" style="display:block;padding:10px ${S1}px ${S3}px ${PHONE_SIDE}px;">` +
      `<span class="tile-name" style="display:block;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;color:${CHARCOAL};">${ph.name}</span>` +
      `<span class="tile-price" style="display:block;font-family:${SANS};font-size:15px;line-height:20px;font-weight:400;color:${CHARCOAL};">${money(ph.price)}</span>` +
      `</span></a>`
    );
  }

  wall() {
    const w = this.b.wall;
    const shop = SITE + (w.more || '/shop/'); // "Shop all" goes where the brief says the products come from
    const head =
      Email.T(
        `<tr><td valign="middle">${Email.label(w.label, { mb: 0 })}</td>` +
          `<td align="right" valign="middle" style="white-space:nowrap;padding-left:${S2}px;">` +
          `${this.link('Shop all &#8594;', shop, 'wall-shop-all')}</td></tr>`,
      ) + Email.h2(w.headline, { mb: 0 });
    let rows = '';
    let i = 0;
    WALL_ROWS[w.photos.length].forEach((n) => {
      const [cw, ch] = SHAPE[n];
      let tds = '';
      w.photos.slice(i, i + n).forEach((ph, k) => {
        // Split each gutter between its two tiles so every tile is the same width and the
        // outer tiles touch the edges: tile k pads GUTTER*k/n on the left, the rest on the right.
        const left = (GUTTER * k) / n, right = (GUTTER * (n - 1 - k)) / n;
        tds +=
          `<td width="${pct(100 / n)}%" valign="top" style="padding:0 ${px(right)} 0 ${px(left)};">` +
          this.tile(ph, cw, ch, `wall-${i + k + 1}`) +
          '</td>';
      });
      rows += '<tr><td>' + Email.T(`<tr>${tds}</tr>`, 'width="100%" style="table-layout:fixed;"') + '</td></tr>';
      i += n;
    });
    return this.band(head, { top: S5, bottom: S2, part: 'wall' }) + this.band(Email.T(rows), { top: 0, side: 0, bottom: 0, part: 'wall' });
  }

  story() {
    const s = this.b.story;
    if (!s) return '';
    const href = SITE + s.cta[1];
    return (
      this.band(Email.label(s.label) + Email.h2(s.headline) + Email.text(s.body, { mb: S1 }) + this.link(`${s.cta[0]} &#8594;`, href, 'story-link'), {
        top: S5,
        bottom: S2,
        part: 'story',
      }) + (s.photos?.length ? this.collage(s.photos, href, s.layout) : s.photo ? this.fullPhoto(s.photo, 600, 240, href, 'story-photo', 'story') : '')
    );
  }

  /**
   * A charity reveal still ahead, its own section under the story: the charity's invite to watch it live, built like its own
   * reveal email ("Join Us Live for Dylan’s Reveal Day!", Nov 16, 2026) in its identity: Dark Deep,
   * its logo over a centered top, a Sunshine Yellow date, the Libre Baskerville line with the key words in yellow italic, the family's
   * photo, When and Where side by side, the start of the family's story (lead()), and its calendar
   * links, which hold the day, the time and the link to watch, never the family's address. "Get an
   * email" goes to the reveal page's own sign-up (the charity emails the day before, an hour before
   * and when it goes live). Tightened 2026-11-17 (Peter: "tigheting up the section about the reveal"):
   * 1105px tall on a 390px phone with Dylan before.
   */
  reveal() {
    const r = this.b.reveal;
    if (!r) return '';
    // When and where side by side, half the column each: the charity's invite stacks When, Where and
    // Room (Peter, 2026-11-17: tighter; the room is in the family's words). The day leads on its own
    // line, so the cells' text starts level with the link's, which is padded to the 44px a thumb needs.
    const value = `font-family:${OUTFIT};font-size:17px;line-height:24px;font-weight:700;color:${WHITE};`;
    const cell = (what, inner, pad) =>
      `<td width="50%" valign="top" style="padding:${pad};">${Email.label(what, { color: SOARD_YELLOW, mb: 0, font: OUTFIT, track: '0.12em' })}${inner}</td>`;
    const details = Email.T(
      `<tr>${cell('When', `<div style="padding-top:10px;${value}">${r.short}<br>${r.time}</div>`, '0 8px 0 0')}` +
        cell(
          'Where',
          `<div style="${value}"><a href="${escape(this.url(r.live, 'reveal-where'))}" target="_blank" style="display:inline-block;padding:10px 0;${value}` +
            `text-decoration:underline;text-underline-offset:3px;">Live online</a></div>`,
          '0 0 0 8px',
        ) +
        '</tr>',
      'width="100%" style="table-layout:fixed;"',
    );
    // Three yellow pills sharing the column's width, so the row shrinks with a small phone instead of spilling off it.
    // The charity's own calendar links, as they are (no tracking added: the file is the invite).
    const pill = (text, href, pad) =>
      `<td width="33.33%" style="padding:${pad};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">` +
      `<tr><td align="center" bgcolor="${SOARD_YELLOW}" style="background-color:${SOARD_YELLOW};border-radius:999px;">` +
      `<a href="${escape(href)}" target="_blank" style="display:block;padding:12px 4px;font-family:${OUTFIT};font-size:15px;line-height:20px;font-weight:700;` +
      `color:${SOARD_DARK};text-decoration:none;border-radius:999px;white-space:nowrap;">${text}</a></td></tr></table></td>`;
    const pills = Email.T(
      `<tr>${pill('Google', r.calendar.google, '0 4px 0 0')}${pill('Apple', r.calendar.apple, '0 2px')}${pill('Outlook', r.calendar.outlook, '0 0 0 4px')}</tr>`,
      'width="100%" style="table-layout:fixed;"',
    );
    const remind =
      `<a href="${escape(this.url(r.live, 'reveal-remind') + '#remind')}" target="_blank" style="display:inline-block;padding:12px 0;` +
      `font-family:${OUTFIT};font-size:16px;line-height:20px;font-weight:700;color:${SOARD_YELLOW};text-decoration:underline;text-underline-offset:3px;">` +
      `Email me when it starts&nbsp;&#8594;</a>`;
    // 26/32 on a phone, 30/36 on a computer (.soard-h)
    const headline =
      `<h2 class="soard-h soard-serif" style="margin:0;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.02em;color:${WHITE};text-align:center;mso-line-height-rule:exactly;">` +
      `<span style="display:block;margin-bottom:6px;font-size:20px;line-height:26px;font-weight:400;font-style:italic;color:${SOARD_SOFT};">Join us live for</span>` +
      `${r.name}&#8217;s <em style="font-family:${SERIF};font-style:italic;font-weight:700;color:${SOARD_YELLOW};">Reveal&nbsp;Day</em>.</h2>`;
    // The top centered under the charity's logo, as its own invite opens (Peter, 2026-11-17: "there
    // needs to be the sunshine on a ranney day logo"; the invite in Gmail: 28px over the logo, 32 under it)
    const top =
      this.soardLogo('reveal-logo') +
      Email.gap(S4) +
      Email.label(`Reveal Day &middot; ${r.short}`, { color: SOARD_YELLOW, mb: 12, font: OUTFIT, track: '0.16em', align: 'center' }) +
      headline;
    const body =
      `<div style="text-align:center;">${top}</div>` +
      Email.gap(S3) +
      // On the column, rounded like the charity's: 536 on a computer, up to 560 where the style block is gone
      // 2:1, as the charity section's photo (Peter, 2026-11-17: tighter; it was 3:2)
      this.img(Email.photo(r.photo.src, 1072, 536), COLUMN, COLUMN / 2, r.photo.alt, r.live, 'reveal-photo', 16, '', WIDTH - 2 * PHONE_SIDE) +
      Email.gap(S2) +
      details +
      Email.gap(S2) +
      Email.text(noWidow(lead(r.story)), { size: 16, lh: 24, color: WHITE, mb: S3, font: OUTFIT }) +
      Email.text('Save it to your calendar', { size: 15, lh: 20, weight: 700, color: WHITE, mb: 12, font: OUTFIT }) +
      pills +
      Email.gap(S1) +
      `<p style="margin:0;font-family:${OUTFIT};font-size:16px;line-height:20px;">${remind}</p>`;
    // As much under the link as over the logo; the link's own padding makes up the rest
    return this.breather() + this.band(body, { bg: SOARD_DEEP, top: S3 + 4, bottom: S3, cls: 'soard', part: 'reveal' });
  }

  /**
   * The story's photos, edge to edge, in the layout the brief names (story.layout, one of
   * collage-layouts.mjs's for that many photos; the classic one when it names none): photos side by
   * side are cells of one row, stacked photos rows of one table, each cut its own table. Every cell's
   * share of the width and its padding come from solve(), so the photos on each side of a cut end
   * level at every width, with the same 4px gutters as the wall, split inside the cells so the outer
   * photos touch the edges. Each photo is cropped to its cell around what's in it, asked for at
   * twice its size in its cell's exact shape, so it fills its cell to the pixel.
   */
  collage(photos, href, layout = CLASSIC) {
    const n = photos.length;
    if (!LAYOUTS[n]) throw new Error(`story.photos: the collage takes 1 to 5 photos, not ${n}`);
    const chosen = layoutOf(layout, n);
    if (!chosen) throw new Error(`story.layout: "${layout}" isn't a layout for ${n} photos (${LAYOUTS[n].map((l) => l.id).join(', ')})`);
    let i = 0;
    const fixed = 'width="100%" style="table-layout:fixed;"';
    const draw = (t, s, w) => {
      if (Array.isArray(t)) {
        const ph = photos[i++];
        const h = s.A * w;
        const k = Math.max(1, Math.round((2 * w) / t[0]));
        return this.img(Email.photo(ph.src, k * t[0], k * t[1]), Math.round(w), Math.round(h), ph.alt, href, `story-photo-${i}`, 0, '', w, t);
      }
      if (t.down) {
        return Email.T(t.down.map((c, k) => `<tr><td${k ? ` style="padding-top:${GUTTER}px;"` : ''}>${draw(c, s.kids[k], w)}</td></tr>`).join(''), fixed);
      }
      // The gutter goes inside a cell of its own table, never on the shared row's cells: given a fixed
      // row whose cells are padded unevenly, Chromium takes each cell's share of the row less all the
      // padding, and WebKit takes the cell's own padding from its share, so a big photo beside a stack
      // came out 1.3px narrower in Chromium than in WebKit. Inside a table of one cell, they agree.
      const pads = paddings(s.c, GUTTER);
      const tds = t.across.map((c, k) => {
        const [left, right] = pads[k];
        const inner = draw(c, s.kids[k], s.f[k] * w + s.c[k]);
        const padded = left || right ? Email.T(`<tr><td style="padding:0 ${px(right)} 0 ${px(left)};">${inner}</td></tr>`, fixed) : inner;
        return `<td width="${pct(100 * s.f[k])}%" valign="top">${padded}</td>`;
      });
      return Email.T(`<tr>${tds.join('')}</tr>`, fixed);
    };
    const tree = chosen.tree;
    return this.band(Email.T(`<tr><td>${draw(tree, solve(tree, GUTTER), 600)}</td></tr>`), { top: 0, side: 0, bottom: 0, part: 'story' });
  }

  /** The dates still ahead on send day, in order. Month, day and weekday all come from "date". */
  upcoming(e) {
    const sent = day(this.b.send_date);
    const items = e.items
      .map((it) => ({ ...it, d: day(it.date) }))
      .sort((a, b) => a.d - b.d)
      .filter((it) => it.d >= sent);
    if (!items.length) return [null, [], ''];
    const first = items[0];
    const when = daysBetween(sent, first.d) <= 6 ? `This ${weekday(first.d)}` : 'Up next';
    return [first, items.slice(1), `${when} &middot; ${monthShort(first.d)} ${first.d.getUTCDate()}`];
  }

  /** The line over the list, true to the dates: weekly only when they really are a week apart. */
  /**
   * The line under the event title, written from the dates still ahead so it can't go stale:
   * "Saturdays, 11am–2pm, Nov 21 to Dec 19". With one date left the card already says it all, so
   * there's no line. Events on different weekdays lead with the brief's "when", which says what's
   * on but never when: a date typed into it would go stale the week it passed.
   */
  static span(e, dates) {
    if (e.when && new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+\\d`).test(e.when)) {
      throw new Error(`events: "when" can't name dates ("${e.when}"). The email writes them from the dates still ahead.`);
    }
    const mixed = new Set(dates.map((d) => d.getUTCDay())).size > 1;
    if (mixed && !e.when) throw new Error(`events: "${e.title}" falls on different weekdays, so it needs a "when" saying what's on.`);
    if (!mixed && e.when) throw new Error(`events: leave out "when" for "${e.title}". It's all on ${weekday(dates[0])}s, so the email writes the line.`);
    if (dates.length === 1) return '';
    const md = (d) => `${monthShort(d)} ${d.getUTCDate()}`;
    const range = `${md(dates[0])} to ${md(dates[dates.length - 1])}`;
    if (mixed) return `${e.when}, ${range}`;
    // "Kids' Christmas Saturdays" already says the day, so the line doesn't say it again
    const days = `${weekday(dates[0])}s`;
    return new RegExp(`\\b${days}\\b`, 'i').test(e.title) ? `${e.time}, ${range}` : `${days}, ${e.time}, ${range}`;
  }

  static leadIn(rest) {
    if (rest.length === 1) return 'One more date:';
    if (new Set(rest.map((it) => it.d.getUTCDay())).size > 1) return 'More dates:';
    const weekly = rest.slice(1).every((it, k) => daysBetween(rest[k].d, it.d) === 7);
    return weekly ? `Then every ${weekday(rest[0].d)}:` : `More ${weekday(rest[0].d)}s:`;
  }

  /**
   * Calendar links for a weekly series, written from the dates still ahead so no one adds one that
   * has passed: Google gets them as a weekly event with each date's activity in its notes, Apple and
   * Outlook the series' calendar file. The brief gives the title, the hours ("start", "end" as
   * HH:MM), a line about the series ("intro") and the file ("ics").
   */
  calendar(e, items) {
    const c = e.calendar;
    if (!items.slice(1).every((it, k) => daysBetween(items[k].d, it.d) === 7)) {
      throw new Error(`events: "${e.title}" has calendar links, but its dates aren't a week apart.`);
    }
    const google = Email.google({
      title: c.title,
      start: c.start,
      end: c.end,
      day: items[0].d,
      details: [c.intro, ...items.map((it) => `${monthShort(it.d)} ${it.d.getUTCDate()}: ${plain(it.what)}${it.note ? `. ${plain(it.note)}` : ''}`)].join('\n'),
      weeks: items.length,
    });
    return Email.text(items.length > 1 ? 'Add every date to your calendar:' : 'Add it to your calendar:', { size: 15, lh: 20, color: WHITE }) + this.calendarLinks(google, c.ics, 'cal', WHITE);
  }

  /** Google Calendar's "add this event" link: one date, or `weeks` dates a week apart. */
  static google({ title, start, end, day, details, weeks = 1 }) {
    const hms = (t) => {
      if (!/^\d{2}:\d{2}$/.test(t || '')) throw new Error(`events: the calendar's "start" and "end" are HH:MM, like "11:00".`);
      return t.replace(':', '') + '00';
    };
    const d = day.toISOString().slice(0, 10).replace(/-/g, '');
    const q = {
      action: 'TEMPLATE',
      text: title,
      dates: `${d}T${hms(start)}/${d}T${hms(end)}`,
      ctz: 'America/New_York',
      location: 'Sunny & Ranney, 109A Oak Street, Roswell, GA',
      details,
    };
    if (weeks > 1) q.recur = `RRULE:FREQ=WEEKLY;COUNT=${weeks}`;
    return 'https://calendar.google.com/calendar/render?' + Object.entries(q).map(([k, v]) => `${k}=${encode(v, '/')}`).join('&');
  }

  /** Google, Apple and Outlook, the last two opening the calendar file. */
  calendarLinks(google, ics, slot, color) {
    const dot = `<span style="font-family:${SANS};color:${color};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`;
    return (
      this.link('Google', google, `${slot}-google`, color) + dot + this.link('Apple', ics, `${slot}-apple`, color) + dot + this.link('Outlook', ics, `${slot}-outlook`, color)
    );
  }

  /**
   * The event's next date on its own, in the card that leads the event: the date people are
   * deciding on now, for any event (a weekly series also gets "every date" below, once there's
   * more than one). Apple and Outlook get a file with just that date (icsUrl).
   */
  addOne(e, it) {
    const c = e.one;
    const date = it.d.toISOString().slice(0, 10);
    const google = Email.google({ title: c.title, start: c.start, end: c.end, day: it.d, details: `${plain(it.what)}${it.note ? `. ${plain(it.note)}` : ''}` });
    return (
      Email.gap(S1) +
      Email.text(`Add ${monthShort(it.d)} ${it.d.getUTCDate()} to your calendar:`, { size: 14, lh: 20 }) +
      this.calendarLinks(google, icsUrl(c.site, c.id, date), 'next', CHARCOAL)
    );
  }

  static greg(it) {
    if (!it.greg) return '';
    return (
      `<td width="52" align="right" valign="middle"><img src="${GREG}" width="44" height="44" ` +
      `alt="Greg, the store&#8217;s French bulldog" style="display:block;width:44px;height:44px;` +
      `border-radius:22px;border:0;"></td>`
    );
  }

  events() {
    let out = '';
    for (const e of this.b.events || []) {
      const [first, rest, when] = this.upcoming(e);
      if (!first) continue;
      const spot = Email.T(
        `<tr><td valign="top" bgcolor="${WHITE}" style="background-color:${WHITE};border-radius:${R_CARD}px;padding:${S2}px;">` +
          Email.T(
            `<tr><td valign="middle">` +
              Email.label(when, { mb: 6 }) +
              // 21/26 on a phone, 24/29 on a computer (.spot)
              Email.text(noWidow(first.what), { size: 21, lh: 26, weight: 700, cls: 'spot' }) +
              (first.note ? Email.text(first.note, { size: 15, lh: 21 }) : '') +
              Email.text(`${first.time || e.time} at the showroom`, { size: 15, lh: 21, weight: 700 }) +
              (e.one ? this.addOne(e, first) : '') +
              `</td>${Email.greg(first)}</tr>`,
          ) +
          '</td></tr>',
        'width="100%" style="border-collapse:separate;"',
      );
      let agenda = '';
      if (rest.length) {
        // The rest as a list on the teal: the date, then what's on, white rules between rows.
        // The weekday shows only when the dates fall on different days.
        const days = new Set(rest.map((it) => it.d.getUTCDay())).size > 1;
        let rows = '';
        rest.forEach((it, k) => {
          const rule = k ? `border-top:1px solid ${WHITE};` : '';
          const dateCell =
            (days ? Email.label(weekdayShort(it.d), { color: WHITE, mb: 2 }) : '') +
            Email.text(monthShort(it.d).toUpperCase() + `&nbsp;${it.d.getUTCDate()}`, { size: 15, lh: 22, weight: 700, color: WHITE, track: '0.06em' });
          const ownTime = it.time !== e.time ? it.time : undefined; // the series time is in "when"
          const whatCell =
            Email.text(it.what, { size: 16, lh: 22, weight: 700, color: WHITE }) + // narrow column: no widow joins
            (ownTime ? Email.text(ownTime, { size: 14, lh: 20, weight: 700, color: WHITE }) : '') +
            (it.note ? Email.text(it.note, { size: 14, lh: 20, color: WHITE }) : '');
          const level = days ? ` style="padding-top:${LABEL_LH + 2}px;"` : ''; // level with the date
          rows +=
            `<tr><td style="${rule}padding:12px 0;">` +
            Email.T(
              `<tr><td width="76" valign="top" style="padding-right:${S1}px;">${dateCell}</td>` + `<td valign="top"${level}>${whatCell}</td>${Email.greg(it)}</tr>`,
            ) +
            '</td></tr>';
        });
        agenda = Email.gap(S3) + Email.text(Email.leadIn(rest), { size: 16, lh: 22, weight: 700, color: WHITE, mb: 4 }) + Email.T(rows);
      }
      const line = Email.span(e, [first, ...rest].map((it) => it.d));
      const head =
        Email.label(e.label ?? 'Coming up', { color: WHITE }) +
        Email.h2(e.title, { color: WHITE, mb: line ? 6 : S2 }) +
        (line ? Email.text(noWidow(line), { size: 16, lh: 24, color: WHITE, mb: S2 }) : '');
      // Every date, once there's more than the one the card already offers
      const series = e.calendar && (rest.length || !e.one);
      const foot = Email.gap(S2) + (series ? this.calendar(e, [first, ...rest]) : '');
      out += this.breather() + this.band(head + spot + agenda + foot, { bg: TEAL, bottom: S4, part: 'events' });
    }
    return out;
  }

  /** The charity's logo for its Dark Deep tops, linked to its site: 80px on a phone, 96 on a computer (.soard-mark); the width attribute is Outlook's. */
  soardLogo(content) {
    return (
      `<a href="${escape(this.url(SOARD_HOME, content))}" target="_blank" class="soard-mark" style="display:inline-block;width:80px;color:${WHITE};">` +
      `<img class="soard-logo soard-mark" src="${SOARD_LOGO_DARK}" width="${SOARD_LOGO_DARK_W}" height="${SOARD_LOGO_DARK_H}" alt="Sunshine on a Ranney Day" ` +
      `style="display:block;width:80px;height:auto;border:0;margin:0 auto;font-family:${OUTFIT};font-size:14px;font-weight:700;color:${WHITE};"></a>`
    );
  }

  /**
   * The charity's section, one Dark Deep band (Peter, 2026-11-17: "the story is too long, would like to
   * have a read more about them type thing and blend in the numbers with the section. overall id like
   * to shorten this section", headed "see where your money goes"). It was three bands (a dark top, a
   * cream story and a numbers strip), 903px tall on a 390px phone with Remi & Nico (Nov 17, 2026).
   *   - centered, as the charity's own emails open: its logo, "100% of our profits" in Sunshine Yellow,
   *     and "See where your *money goes*." in Libre Baskerville with the key words in yellow italic;
   *   - the family's photo, the one picked, rounded on the column;
   *   - the charity's caption and the start of its summary (lead()), then "Read more about <name>" to
   *     their page on its site;
   *   - under a muted rule, its numbers three across (impact()), in the same band.
   * Phones first: every size inline is a phone's; the computer's come from the style block. The
   * `soard` class lets verify.mjs hold the section to the charity's palette and the rest of the email
   * to the store's.
   */
  mission() {
    const m = this.b.mission;
    // 32/36 on a phone, 38/42 on a computer (.soard-h)
    const headline =
      `<h2 class="soard-h soard-serif" style="margin:0;font-family:${SERIF};font-size:32px;line-height:36px;font-weight:700;` +
      `letter-spacing:-0.01em;color:${WHITE};text-align:center;mso-line-height-rule:exactly;">See where your ` +
      `<em style="font-family:${SERIF};font-style:italic;font-weight:700;color:${SOARD_YELLOW};">money&nbsp;goes</em>.</h2>`;
    const top =
      this.soardLogo('charity-logo') +
      Email.gap(S2) +
      Email.label('100% of our profits', { color: SOARD_YELLOW, font: OUTFIT, track: '0.18em', align: 'center', mb: S1 }) +
      headline;
    // The caption leads, in white, as the admin shows the family's words
    const words = (m.caption ? `<strong style="font-weight:700;color:${WHITE};">${m.caption}</strong> ` : '') + noWidow(lead(m.story));
    const link =
      `<p style="margin:0;font-family:${OUTFIT};font-size:16px;line-height:24px;">` +
      // A text link, padded to the 44px a thumb needs
      `<a href="${escape(this.url(m.url, 'mission-link'))}" target="_blank" style="display:inline-block;padding:10px 0;font-family:${OUTFIT};font-weight:700;` +
      `color:${SOARD_YELLOW};text-decoration:underline;text-underline-offset:3px;">Read more about ${m.name || 'them'}&nbsp;&#8594;</a></p>`;
    const body =
      `<div style="text-align:center;">${top}</div>` +
      Email.gap(20) +
      // On the column: 536px on a computer, and up to 560 where the style block is gone (20px sides at any width)
      this.img(Email.photo(m.photo.src, 1120, 560), COLUMN, COLUMN / 2, m.photo.alt, m.url, 'mission-photo', 20, '', WIDTH - 2 * PHONE_SIDE) +
      Email.gap(S2) +
      Email.text(words, { size: 16, lh: 24, color: SOARD_SOFT, font: OUTFIT }) +
      link +
      (m.impact ? this.impact(m.impact) : '');
    // No white strip before it (Peter, 2026-11-16: "remove the white gap"): the charity's own emails
    // stack their bands edge to edge.
    return this.band(body, { bg: SOARD_DEEP, top: S3 + 4, bottom: S3 + 4, cls: 'soard', part: 'mission' });
  }

  /**
   * The charity's numbers, as its site shows them, Sunshine Yellow on Dark Deep, centered, under a
   * muted rule at the foot of its section: three across at any width from 320px up. Each is a block of
   * its own (statColumns), at most a third of the smallest phone's 280px column; a label too long for
   * one line breaks between its words ("Room / makeovers"), never inside one.
   */
  impact(n) {
    const stats = [
      [n.rooms, 'Room makeovers'],
      [n.children, 'Children served'],
      ['$0', 'Cost to families'],
    ];
    const cells = stats.map(
      ([num, what]) =>
        // 24/28 on a phone, 32/36 on a computer (.soard-stat)
        Email.text(num, { size: 24, lh: 28, weight: 700, color: SOARD_YELLOW, font: NUMERALS, cls: 'soard-stat soard-serif', track: '-0.02em', mb: 4, align: 'center' }) +
        Email.label(what, { color: WHITE, mb: 0, font: OUTFIT, track: '0.06em', align: 'center' }),
    );
    return Email.gap(12) + Email.T(`<tr><td style="padding-top:${S3}px;border-top:1px solid ${SOARD_MUTED};">${Email.statColumns(cells)}</td></tr>`);
  }

  /** Markup only Outlook for Windows reads: the table it lays side by side columns out with (the "ghost table"). */
  static ghost(s) {
    return `<!--[if mso]>${s}<![endif]-->`;
  }

  /**
   * Blocks that sit side by side while they fit and wrap to the next line, centered, when they don't:
   * inline blocks, each at most STAT_PHONE wide (STAT_DESKTOP on a computer, .stat), so two fit across
   * the smallest phone (280px of column) and three across a computer's 536. No media query decides it,
   * so it holds in a mail app that throws the style block away. Outlook, which ignores max-width, gets
   * a table of its own (the "ghost table").
   */
  static statColumns(cells) {
    const { ghost } = Email;
    const w = Math.floor(COLUMN / cells.length);
    return (
      `<div style="font-size:0;line-height:0;text-align:center;">` +
      ghost(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`) +
      cells
        .map(
          (c) =>
            ghost(`<td width="${w}" valign="top" align="center">`) +
            `<div class="stat" style="display:inline-block;vertical-align:top;width:100%;max-width:${STAT_PHONE}px;font-size:16px;line-height:24px;">${c}</div>` +
            ghost('</td>'),
        )
        .join('') +
      ghost('</tr></table>') +
      '</div>'
    );
  }

  /**
   * Columns side by side on a computer and stacked, each the full width, on a phone, with no media
   * query: Rémi Parmentier's "Fab Four" (min-width, max-width, width, calc). With less than `at` px of
   * room, each column's width works out huge and max-width:100% holds it to the whole width; with `at`
   * or more it works out below zero and min-width holds it to its own. The calc is written expanded,
   * (at - 100%) * at as at²px - (at × 100)%, without the parentheses some mail apps reject; one that
   * drops it keeps width:100%, so the columns stack, which still fits. Outlook gets a ghost table.
   * min-width is a share of the row, not pixels: min-width beats max-width, so a 326px minimum held
   * the address column at 326 on a 280px phone and pushed the email off the screen.
   * `gap` px go between the columns while they're stacked, and none once they're side by side: a
   * spacer as tall as the gap whose width works out the same way, the whole row while they stack and
   * nothing beside them. A gap hidden by a media query showed from 576 to 620px, where the columns
   * already sit side by side, and always with the style block gone, and pushed the button off the
   * address's middle.
   * @param {{ html: string, width: number, align?: string }[]} cols widths summing to `at`
   */
  static fabFour(cols, at = COLUMN, { gap = 0 } = {}) {
    const { ghost } = Email;
    // Rounded down, so the shares never add up to more than the row
    const share = (w) => Math.floor((w / at) * 10000) / 100;
    const spacer = gap
      ? `<!--[if !mso]><!--><div class="fab-gap" style="display:inline-block;vertical-align:middle;min-width:0;max-width:100%;width:100%;` +
        `width:calc(${at * at}px - ${at * 100}%);height:${gap}px;font-size:0;line-height:0;"></div><!--<![endif]-->`
      : '';
    return (
      `<div style="font-size:0;line-height:0;">` +
      ghost(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`) +
      cols
        .map(
          ({ html, width, align = 'left' }) =>
            ghost(`<td width="${width}" valign="middle" align="${align}">`) +
            `<div style="display:inline-block;vertical-align:middle;min-width:${share(width)}%;max-width:100%;width:100%;` +
            `width:calc(${at * at}px - ${at * 100}%);font-size:16px;line-height:24px;text-align:${align};">${html}</div>` +
            ghost('</td>'),
        )
        .join(spacer) +
      ghost('</tr></table>') +
      '</div>'
    );
  }

  visit() {
    const left =
      Email.label('Visit the showroom') +
      Email.h2('109A Oak Street', { mb: 4 }) +
      Email.text('Roswell, GA', { size: 16, lh: 24, weight: 700, mb: S1 }) +
      Email.text('Tue&#8211;Sat, 10am&#8211;5pm<br>Closed Sun&nbsp;&amp;&nbsp;Mon', { size: 16, lh: 24 }) +
      Email.text(
        `<a href="tel:+16788885140" style="display:inline-block;padding:10px 0;color:${CHARCOAL};` +
          `text-decoration:underline;text-underline-offset:3px;">678.888.5140</a>`,
        { size: 16, lh: 24 },
      );
    // The address beside the button on a computer; on a phone the button goes under it, full width,
    // whether or not the mail app keeps the style block (fabFour, button)
    const button = this.button('Get directions &#8594;', MAP, 'directions', GOLD, CHARCOAL, 'right');
    return this.band(
      Email.fabFour(
        [
          { html: left, width: COLUMN - VISIT_BUTTON },
          { html: button, width: VISIT_BUTTON, align: 'right' },
        ],
        COLUMN,
        { gap: S3 },
      ),
    );
  }

  footer() {
    const links = [
      ['Instagram', 'https://instagram.com/sunnyandranney', 'ig'],
      ['Facebook', 'https://facebook.com/sunnyandranney', 'fb'],
      ['Shop online', SITE + '/shop/', 'footer-shop'],
    ]
      .map(
        ([t, h, slot]) =>
          `<a href="${escape(this.url(h, slot))}" target="_blank" style="display:inline-block;padding:12px 2px;` +
          `color:${CHARCOAL};text-decoration:underline;">${t}</a>`,
      )
      .join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;');
    return this.band(
      `<div style="height:1px;line-height:1px;font-size:1px;background-color:${STONE};margin:0 0 ${S3}px;">&nbsp;</div>` +
        `<img src="${PIG}" width="96" height="42" alt="" style="display:block;width:96px;height:auto;border:0;margin:0 auto ${S2}px;">` +
        Email.text('Designer finds. Better prices. A&nbsp;really&nbsp;good&nbsp;cause.', { size: 15, lh: 22, weight: 700, align: 'center', mb: 4 }) +
        Email.text('100% of our profits fund dream rooms for kids with special&nbsp;needs.', { size: 14, lh: 20, align: 'center', mb: 4 }) +
        Email.text(links, { size: 14, lh: 22, align: 'center', mb: 4 }) +
        // The store's mailing address, written in, as the site publishes it (SEO.astro): not Kit's
        // {{ address }}, which showed as those words in any email Kit didn't send (a test, the
        // preview) and would be the shared Kit account's (the charity's) when it did. A link keeps
        // Gmail from turning it into a blue map link. Only the unsubscribe link is Kit's to fill.
        Email.text(
          `<a href="${escape(this.url(`${SITE}/visit/`, 'footer-address'))}" target="_blank" ` +
            `style="display:inline-block;padding:12px 0;color:${CHARCOAL};text-decoration:none;">` +
            `Sunny &amp; Ranney &middot; 109A Oak Street, Roswell, GA&nbsp;30075</a><br>` +
            `<a href="{{ unsubscribe_url }}" style="display:inline-block;padding:12px 4px;color:${CHARCOAL};` +
            `text-decoration:underline;">Unsubscribe</a>`,
          { size: 13, lh: 20, align: 'center' },
        ),
      { top: 0, bottom: S4 },
    );
  }

  // ── page ──
  /** The whole email, or (for the admin's preview) just the sections asked for, as a complete document. */
  html(sections = SECTIONS) {
    const b = this.b;
    const { subject, preheader } = lines(b);
    const body = sections.map((name) => this[name]()).join('');
    const spacer = '&#847;&zwnj;&nbsp;'.repeat(60);
    const tierRules = (k) =>
      Object.entries(TIER_SIZE)
        .map(([n, sizes]) => `    .tier${n} { font-size:${sizes[k]}px !important; line-height:${sizes[k]}px !important; }`)
        .join('\n');
    // Phones first: everything inline is a phone's, so the style block only makes things bigger, from
    // 375px (the tiers, the charity's numbers) and on a computer. Outlook for Windows reads no media
    // query, so it gets the computer's rules in a block of its own.
    const computer = [
      `    .px { padding-left:${S4}px !important; padding-right:${S4}px !important; }`,
      `    .pt { padding-top:${S5}px !important; }`,
      `    .pb { padding-bottom:${S5}px !important; }`,
      `    .g40 { height:${S5}px !important; line-height:${S5}px !important; font-size:${S5}px !important; }`,
      '    .logo { width:150px !important; }',
      '    .h1 { font-size:32px !important; line-height:36px !important; }',
      '    .h2 { font-size:30px !important; line-height:34px !important; }',
      '    .mega { font-size:92px !important; line-height:88px !important; }',
      '    .mega2 { font-size:40px !important; line-height:44px !important; }',
      tierRules(0),
      '    .cap4 { font-size:15px !important; line-height:20px !important; }',
      '    .spot { font-size:24px !important; line-height:29px !important; }',
      '    .soard-h { font-size:38px !important; line-height:42px !important; }',
      '    .soard-lead { font-size:24px !important; line-height:31px !important; }',
      '    .soard-body { font-size:17px !important; line-height:29px !important; }',
      '    .soard-mark { width:96px !important; }',
      `    .tile-cap { padding-left:${S4}px !important; padding-right:12px !important; }`,
      '    .soard-stat { font-size:32px !important; line-height:36px !important; }',
    ].join('\n');
    return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escape(subject)}</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400;1,700&family=Outfit:wght@400;700&display=swap" rel="stylesheet"><!--<![endif]-->
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<!--[if mso]><style>body, table, td, p, a, h1, h2, span { font-family: Arial, Helvetica, sans-serif !important; } .soard-serif, .soard-serif em { font-family: Georgia, serif !important; } .soard-stat { font-family: 'Times New Roman', serif !important; }
${computer}
</style><![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media (min-width:375px) {
${tierRules(1)}
    .cap { width:auto !important; }
  }
  @media (min-width:${DESKTOP}px) {
${computer}
    .stat { max-width:${STAT_DESKTOP}px !important; }
    .btn { width:auto !important; }
    .btn a { display:inline-block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${WHITE};color:${CHARCOAL};">
<div role="article" aria-roledescription="email" aria-label="${escape(subject)}" lang="en" dir="ltr">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(preheader)}${spacer}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${WHITE}" style="background-color:${WHITE};">
<tr><td align="center" style="padding:0;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:${WHITE};">
${body}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>
`;
  }
}

/** The email for one brief. */
export const render = (brief, sections) => new Email(brief).html(sections);
