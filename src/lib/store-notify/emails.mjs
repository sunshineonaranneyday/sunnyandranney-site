/**
 * The two special-order emails: the shopper's confirmation and the store's notice.
 * Built the way the Sunny Side email is (src/lib/sunny-side/email.mjs), which is tested
 * in Gmail, Apple Mail and Outlook: a 600px table, inline styles, a button Outlook can
 * draw, light mode only, DM Sans with system fallbacks, and a plain-text part that
 * says everything the HTML does.
 */
import { replyByLong } from '../special-order-request.mjs';
import { leadTimeLabel } from '../availability.mjs';

const GOLD = '#FFD400';
const CHARCOAL = '#2C2C2C';
const SLATE = '#5A5A58'; // 6.9:1 on white
const CREAM = '#FAF7F2';
const RULE = '#EAE4DA';
const WHITE = '#FFFFFF';
const SANS = "'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const SITE = 'https://sunnyandranney.com';
const CF = 'https://imagedelivery.net/ROYFuPmfN2vPS6mt5sCkZQ';
const LOGO = `${CF}/logo-tagline-light-bg/w=360,h=144,fit=scale-down,format=png`; // 2.5:1
export const STORE_PHONE = '(678) 888-5140';
const STORE_TEL = 'tel:+16788885140';
const ADDRESS = '109A Oak Street, Roswell, GA 30075';
const MAP = 'https://maps.app.goo.gl/QXwgPyiX93HkwjwDA';
export const ADMIN_URL = 'https://admin.sunnyandranney.com/admin/vendors/special-orders/';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (cents) => (cents == null ? null : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';
/** Keeps the last two words together, so a line never ends on one word alone. */
const noWidow = (t) => t.replace(/ (\S+)$/, '&nbsp;$1');
/** A Shopify CDN photo at a set width (its `width` parameter), or null. */
function photo(url, width) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'cdn.shopify.com') u.searchParams.set('width', String(width));
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * The reply the store sends once the vendor has answered: the blanks are the only
 * typing left. Used by the store's email and the admin's Reply button.
 */
export function replyDraft(req) {
  const piece = req.title;
  return {
    subject: `Your special order: ${piece}`,
    body: [
      `Hi ${firstName(req.name)},`,
      '',
      `Thanks for your patience. ${req.vendor || 'The maker'} can make the ${piece} for you.`,
      '',
      'Price: $',
      'Arrives at our showroom around: ',
      '',
      'If you’d like to go ahead, just reply yes and we’ll send you a secure payment link. When it arrives, we’ll call you to set up pickup.',
      '',
      'Sunny & Ranney',
      STORE_PHONE,
    ].join('\n'),
  };
}

export function mailto(to, { subject, body }) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ── building blocks ──
const T = (inner, attrs = 'width="100%"') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs}>${inner}</table>`;
const text = (t, { size = 17, lh = 26, weight = 400, color = CHARCOAL, mb = 0, tag = 'p', cls = '' } = {}) =>
  `<${tag}${cls ? ` class="${cls}"` : ''} style="margin:0 0 ${mb}px;font-family:${SANS};font-size:${size}px;line-height:${lh}px;font-weight:${weight};color:${color};mso-line-height-rule:exactly;">${t}</${tag}>`;
const label = (t, mb = 8) =>
  `<p style="margin:0 0 ${mb}px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${SLATE};">${t}</p>`;
/** One row of the card. Transparent by default: the card's own white, with its rounded corners, shows through. */
const band = (inner, { bg = null, top = 32, bottom = 32, side = 32 } = {}) =>
  `<tr><td class="px"${bg ? ` bgcolor="${bg}"` : ''} style="${bg ? `background-color:${bg};` : ''}padding:${top}px ${side}px ${bottom}px;">${inner}</td></tr>`;
const link = (t, href, color = CHARCOAL) => `<a href="${esc(href)}" target="_blank" style="color:${color};text-decoration:underline;text-underline-offset:3px;">${t}</a>`;

/** Bulletproof: VML for Outlook, a padded link elsewhere; full width on phones. */
function button(t, href, { bg = GOLD, fg = CHARCOAL } = {}) {
  const u = esc(href);
  const width = 56 + 9 * t.replace(/&[a-z#0-9]+;/g, 'x').length;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="border-collapse:separate;"><tr><td bgcolor="${bg}" style="border-radius:8px;background-color:${bg};">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${u}" style="height:52px;v-text-anchor:middle;width:${width}px;" arcsize="15%" stroke="f" fillcolor="${bg}">` +
    `<w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${t}</center></v:roundrect><![endif]--><!--[if !mso]><!-->` +
    `<a href="${u}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:700;color:${fg};text-decoration:none;border-radius:8px;border:2px solid ${bg};">${t}</a>` +
    `<!--<![endif]--></td></tr></table>`
  );
}

/** The piece: its photo, name, price and lead time, linked to its page. */
function pieceCard(req, { showVendor = false } = {}) {
  const url = `${SITE}/shop/${req.handle}/`;
  const img = photo(req.image_url, 240);
  const lead = leadTimeLabel(req.lead_days);
  const facts = [money(req.price_cents), lead ? `special order, ${lead}` : 'special order'].filter(Boolean).join(' · ');
  const left = img
    ? `<td width="112" valign="top" style="width:112px;padding:0 20px 0 0;"><a href="${esc(url)}" target="_blank"><img src="${esc(img)}" width="112" height="112" alt="${esc(req.title)}" style="display:block;width:112px;height:112px;object-fit:cover;border-radius:8px;border:1px solid ${RULE};background:${WHITE};"></a></td>`
    : '';
  return T(
    `<tr>${left}<td valign="middle">` +
      text(`<a href="${esc(url)}" target="_blank" style="color:${CHARCOAL};text-decoration:none;">${esc(req.title)}</a>`, { size: 17, lh: 24, weight: 700, mb: 4 }) +
      (showVendor && req.vendor ? text(esc(req.vendor), { size: 15, lh: 22, color: SLATE, mb: 2 }) : '') +
      text(esc(facts), { size: 15, lh: 22, color: SLATE, mb: 6 }) +
      text(link('See the piece', url), { size: 15, lh: 22 }) +
      `</td></tr>`,
  );
}

function page({ subject, preheader, rows, foot = '' }) {
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(40);
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
<title>${esc(subject)}</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,700&display=swap" rel="stylesheet"><!--<![endif]-->
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<!--[if mso]><style>body, table, td, p, a, h1, h2, span { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media (max-width:620px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
    .btn { width:100% !important; }
    .btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};color:${CHARCOAL};">
<div role="article" aria-roledescription="email" aria-label="${esc(subject)}" lang="en" dir="ltr">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}${spacer}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CREAM}" style="background-color:${CREAM};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${WHITE}" style="max-width:600px;margin:0 auto;background-color:${WHITE};border-radius:12px;border-collapse:separate;">
<tr><td class="px" style="padding:28px 32px 20px;border-bottom:1px solid ${RULE};"><a href="${SITE}/" target="_blank"><img src="${LOGO}" width="140" height="56" alt="Sunny &amp; Ranney" style="display:block;width:140px;height:56px;border:0;"></a></td></tr>
${rows.join('\n')}
</table>
${foot ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;"><tr><td class="px" style="padding:20px 32px 8px;">${foot}</td></tr></table>` : ''}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>
`;
}

const footer = () =>
  text(`Sunny &amp; Ranney · ${link(ADDRESS, MAP, SLATE)} · ${link(STORE_PHONE, STORE_TEL, SLATE)}`, { size: 13, lh: 20, color: SLATE, mb: 4 }) +
  text('100% of our profits fund home makeovers for kids with special needs.', { size: 13, lh: 20, color: SLATE });

/** The shopper's confirmation: what they asked for, what happens next, and by when. */
export function shopperEmail(req, { storeTo }) {
  const by = req.reply_by ? replyByLong(req.reply_by) : 'the next business day';
  const maker = req.vendor || 'the maker';
  const url = `${SITE}/shop/${req.handle}/`;
  const subject = `We got your request for ${req.title}`;
  const steps = [
    ['We check with the maker', `${esc(maker)} confirms the price and when it can arrive.`],
    [`We email you by ${esc(by)}`, 'With the price and the arrival date. If you’d like it, reply yes and we’ll send a secure payment link.'],
    ['It comes to our showroom', 'We call you to set up a free pickup in Roswell.'],
  ];
  const stepRows = steps.map(([head, body], i) =>
    `<tr><td width="40" valign="top" style="width:40px;padding:0 14px ${i < steps.length - 1 ? 20 : 0}px 0;">` +
    `<div style="width:28px;height:28px;line-height:28px;border-radius:14px;background-color:${GOLD};color:${CHARCOAL};font-family:${SANS};font-size:14px;font-weight:700;text-align:center;">${i + 1}</div></td>` +
    `<td valign="top" style="padding:3px 0 ${i < steps.length - 1 ? 20 : 0}px;">${text(head, { size: 16, lh: 22, weight: 700, mb: 2 })}${text(body, { size: 15, lh: 22, color: SLATE })}</td></tr>`,
  ).join('');
  const rows = [
    band(
      label('Special order request') +
        text(noWidow(`We got your request, ${esc(firstName(req.name))}`), { size: 30, lh: 36, weight: 700, tag: 'h1', mb: 12, cls: 'h1' }) +
        text(noWidow(`We’ll check with ${esc(maker)} and email you by <strong>${esc(by)}</strong> with the price and the date it would arrive. Nothing to pay until you say yes.`), { size: 17, lh: 26 }),
      { top: 32, bottom: 24 },
    ),
    band(`<div style="padding:16px;border:1px solid ${RULE};border-radius:12px;">${pieceCard(req)}</div>`, { top: 0, bottom: req.note ? 20 : 28 }),
    req.note
      ? band(label('Your note', 6) + text(`“${esc(req.note)}”`, { size: 15, lh: 22, color: CHARCOAL }), { top: 0, bottom: 28 })
      : '',
    band(`<div style="border-top:1px solid ${RULE};padding-top:28px;">${label('What happens next', 16)}${T(stepRows)}</div>`, { top: 0, bottom: 28 }),
    band(
      text(`Questions? Call us at ${link(STORE_PHONE, STORE_TEL)}${storeTo ? ', or reply to this email' : ''}.`, { size: 15, lh: 22, color: SLATE }),
      { top: 0, bottom: 32 },
    ),
  ].filter(Boolean);
  return {
    to: req.email,
    ...(storeTo ? { replyTo: storeTo } : {}),
    subject,
    html: page({ subject, preheader: `We’ll email you by ${by} with the price and arrival date. Nothing to pay until you say yes.`, rows, foot: footer() }),
    text: [
      `Hi ${firstName(req.name)},`,
      '',
      `We got your request for ${req.title}. We’ll check with ${maker} and email you by ${by} with the price and the date it would arrive. Nothing to pay until you say yes.`,
      '',
      `The piece: ${url}`,
      ...(req.note ? ['', `Your note: “${req.note}”`] : []),
      '',
      'What happens next',
      ...steps.map(([h, b], i) => `${i + 1}. ${h.replace(/&amp;/g, '&')}: ${b.replace(/&amp;/g, '&')}`),
      '',
      `Questions? Call us at ${STORE_PHONE}${storeTo ? ', or reply to this email' : ''}.`,
      '',
      `Sunny & Ranney · ${ADDRESS}`,
      '100% of our profits fund home makeovers for kids with special needs.',
    ].join('\n'),
  };
}

/** The store's notice: everything needed to call the vendor and answer, and the reply ready to send. */
export function storeEmail(req, to) {
  const by = req.reply_by ? replyByLong(req.reply_by) : 'the next business day';
  const who = firstName(req.name);
  const subject = `Special-order request: ${req.title} (${req.name})`;
  const reach = [
    ['Name', esc(req.name)],
    req.email ? ['Email', link(esc(req.email), `mailto:${req.email}`)] : null,
    req.phone ? ['Phone', link(esc(req.phone), `tel:${req.phone.replace(/[^\d+]/g, '')}`)] : null,
  ].filter(Boolean);
  const reachRows = reach.map(([k, v]) =>
    `<tr><td width="72" valign="top" style="width:72px;padding:0 12px 8px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${SLATE};">${k}</td>` +
    `<td valign="top" style="padding:0 0 8px;font-family:${SANS};font-size:15px;line-height:22px;color:${CHARCOAL};">${v}</td></tr>`).join('');
  const primary = req.email
    ? button(`Reply to ${esc(who)}`, mailto(req.email, replyDraft(req)))
    : button(`Call ${esc(who)}`, `tel:${String(req.phone).replace(/[^\d+]/g, '')}`);
  const rows = [
    band(
      label('New special-order request') +
        text(noWidow(`${esc(req.name)} would like this piece`), { size: 26, lh: 32, weight: 700, tag: 'h1', mb: 10, cls: 'h1' }) +
        text(noWidow(`They were told to expect an answer by <strong>${esc(by)}</strong>.`), { size: 17, lh: 26 }),
      { top: 32, bottom: 24 },
    ),
    band(`<div style="padding:16px;border:1px solid ${RULE};border-radius:12px;">${pieceCard(req, { showVendor: true })}</div>`, { top: 0, bottom: 24 }),
    band(
      label('Reach them', 10) + T(reachRows) +
        (req.note ? `<div style="margin-top:8px;padding:14px 16px;background-color:${CREAM};border-radius:8px;">${text(`“${esc(req.note)}”`, { size: 15, lh: 22 })}</div>` : ''),
      { top: 0, bottom: 28 },
    ),
    band(
      primary +
        `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>` +
        text(`${req.email ? 'The reply opens with the price and date to fill in. ' : ''}Then ${link('mark it answered in the admin', ADMIN_URL)}.`, { size: 15, lh: 22, color: SLATE }),
      { top: 0, bottom: 32 },
    ),
  ];
  const draft = req.email ? replyDraft(req) : null;
  return {
    to,
    ...(req.email ? { replyTo: req.email } : {}),
    subject,
    html: page({ subject, preheader: `${req.name} · answer by ${by}${req.note ? ` · “${req.note.slice(0, 60)}”` : ''}`, rows,
      // An explicit link in the footer's gray: Gmail turns a bare domain into its own blue link.
      foot: text(`Sent by the Request this piece form on ${link('sunnyandranney.com', `${SITE}/`, SLATE)}.`, { size: 13, lh: 20, color: SLATE }) }),
    text: [
      `${req.name} would like the ${req.title}. They were told to expect an answer by ${by}.`,
      '',
      `Piece: ${req.title}${req.vendor ? ` (${req.vendor})` : ''}`,
      ...[money(req.price_cents) && `Price on the site: ${money(req.price_cents)}`, leadTimeLabel(req.lead_days) && `Lead time shown: ${leadTimeLabel(req.lead_days)}`].filter(Boolean),
      `${SITE}/shop/${req.handle}/`,
      '',
      ...(req.email ? [`Email: ${req.email}`] : []),
      ...(req.phone ? [`Phone: ${req.phone}`] : []),
      ...(req.note ? [`Their note: “${req.note}”`] : []),
      '',
      ...(draft ? ['Replying to this email goes to them. A reply to start from:', '', draft.body, ''] : []),
      `Mark it answered: ${ADMIN_URL}`,
    ].join('\n'),
  };
}
