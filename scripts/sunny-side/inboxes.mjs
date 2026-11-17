// How each kind of inbox gets the email, for the checks that render it (verify.mjs, collages.mjs).

/** Declarations Gmail removes from inline styles: negative margins, positioning, flex and grid. */
export const GMAIL_STRIPS = /(?:margin[a-z-]*\s*:[^;"]*-\d[^;"]*|position\s*:[^;"]*|display\s*:\s*(?:inline-)?(?:flex|grid)[^;"]*);?/gi;

/** The email as each kind of inbox gets it: as sent; as Gmail serves it; bare, with no style block either. */
export const MODES = {
  sent: (src) => src,
  gmail: (src) => src.replace(GMAIL_STRIPS, ''),
  bare: (src) => src.replace(GMAIL_STRIPS, '').replace(/<style[\s\S]*?<\/style>/g, ''),
};

/** Every width a sweep lays an email out at: 320 to 700 in 10s, and both sides of each media query. */
export const SWEEP = [...new Set([...Array.from({ length: 39 }, (_, k) => 320 + 10 * k), 374, 375, 620, 621])].sort((a, b) => a - b);
