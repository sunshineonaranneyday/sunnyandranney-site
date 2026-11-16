/**
 * The email's font in the admin. The email links Google Fonts, which the admin's
 * Content-Security-Policy keeps out, so wherever the admin draws an email (the preview, a sent
 * email) the link is swapped for the admin's own copy of DM Sans.
 */

/** The email's own font, served by the admin. */
export const FONT = "<style>@font-face{font-family:'DM Sans';src:url('/fonts/DMSans-Variable.woff2') format('woff2');font-weight:100 1000;font-style:normal;}</style>";

/** The font link as email.mjs writes it, hidden from Outlook. */
export const FONT_LINK = /<!--\[if !mso\]><!--><link href="https:\/\/fonts\.googleapis\.com[^>]*><!--<!\[endif\]-->/;

/**
 * Any email's HTML with every Google Fonts link taken out and the admin's copy put in: an email sent
 * before the font link took its current form still draws in its own font, and nothing is blocked.
 */
export function withAdminFont(html: string): string {
  const out = html.replace(/(<!--\[if !mso\]><!-->)?<link\b[^>]*fonts\.googleapis\.com[^>]*>(<!--<!\[endif\]-->)?/gi, '');
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (h) => h + FONT) : FONT + out;
}
