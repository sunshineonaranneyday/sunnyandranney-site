/**
 * Kit's wrapper, as it reaches the inbox
 * ======================================
 * Kit doesn't send the email's HTML as it is: its template wraps it in a few tables of its own and adds
 * three style blocks ahead of the email's own. Copied from a test Kit delivered to Gmail on Nov 17,
 * 2026 ("Show original"). Two of its rules reach into the email's layout:
 *
 *   table td { vertical-align:top; }       a cell's valign="middle" alone is beaten by it, in every inbox
 *                                          that reads a style block (the masthead's issue date, "Shop all"
 *                                          and the visit row sat at the top of their rows, not the middle)
 *   html,body,table { line-height:1.5; }   any words without their own line height in a table get 1.5
 *   p, h2, h3 { margin:1em 0; }            any paragraph or heading without its own margin gets 1em
 *
 * verify.mjs renders every email inside this wrapper too ("kit"), and fails if it lays out any
 * differently from the email on its own: the email has to hold its own against the wrapper. If Kit
 * changes its template, copy its blocks here again from a test's original.
 */

/** Kit's first style block, word for word. */
const BASE =
  'html,body,table { line-height:1.5; } body { margin:0;padding:0; } h1,h2,h3,h4,h5,h6 { font-weight:bold;font-style:normal;font-size:1em;margin:0; } ' +
  'h2 { margin:1em 0; } h3 { margin:1em 0; } h5 { font-style:italic; } h6 { font-weight:normal;font-style:italic; } ' +
  'p,ol,ul,figure,blockquote,.spaced-block { margin:1em 0; } img { border:0;height:auto;line-height:100%;outline:none;-webkit-text-decoration:none;text-decoration:none; } ' +
  'body,table,td,a { -webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; } table,td { border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt; } ' +
  'table td { vertical-align:top; } img { -ms-interpolation-mode:bicubic;max-width:100%; } * { -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale; } ' +
  'hr { margin:36px 0;border:0;height:1px;background:#eee; } ul,ol { margin-left:1em;padding:0;list-style-position:outside; } ol ol,ul ul,ol ul,ul ol { padding:0 0 0 1em; } ' +
  'li { padding:0 0 0 1em;margin:0 0 0 1em; } .email-button { border:0 none; } .built-with { width:100%;max-width:640px;margin-left:auto;margin-right:auto; }';
const LINKS = '.ck-link { text-decoration: underline; }';
/** The start of its third block, which it puts ahead of the email's own style block. */
const MEDIA =
  '@media only screen and (max-width:600px) { .email-container { padding:0 !important; }  }\n' +
  '@media only screen { .email * { word-break: break-word; } }\n' +
  '@media screen and (max-width: 384px) { .mail-message-content { width: 414px !important; } }\n' +
  '@media only screen and (max-width:600px) { .ck-padding-left-none { padding-left:0px !important; } .ck-padding-right-none { padding-right:0px !important; } ' +
  '.ck-padding-left-mobile-friendly { padding-left:18px !important; } .ck-padding-right-mobile-friendly { padding-right:18px !important; }  }\n';

/** The email as Kit delivers it: its style blocks first, its body inside Kit's tables (640px at most, no padding on a phone). */
export function inKit(src) {
  const head = `<style>${BASE}</style><style>${LINKS}</style><style>${MEDIA}</style>`;
  const withHead = src.replace(/<head([^>]*)>/i, (m) => `${m}${head}`);
  return withHead
    .replace(/<body([^>]*)>/i, (m) => `${m}<div class="email"><table class="email-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;"><tr><td class="ck-section"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ck-inner-section ck-padding-left-none ck-padding-right-none">`)
    .replace(/<\/body>/i, '</td></tr></table></td></tr></table></div></body>');
}
