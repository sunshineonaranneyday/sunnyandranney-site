/**
 * The story's collage, as the email page changes it
 * ===========================================================================
 * The collage is the week's story photos in the order they fill its layout (collage-layouts.mjs). On
 * the page, Staci drags a photo to a new spot, drags one in from the library, taps one and then the spot
 * it goes to, or uses the keyboard. Every one of those ends in one of the changes here, and the words a
 * screen reader hears say where a spot is in the layout ("spot 2 of 3, top right, wide"), since
 * "earlier" and "later" don't say which way a photo moves in a bento box. No Node or browser APIs.
 */

import { cellWords } from './collage-layouts.mjs';
import { COLLAGE_MAX } from './parts.mjs';

/** The photo at `from` moved to spot `to`; the ones between shift over one. */
export function moveTo(ids, from, to) {
  if (from === to || from < 0 || from >= ids.length) return ids;
  const next = [...ids];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, it);
  return next;
}

/** A photo from the library put in at spot `at` while the collage has room; the rest shift over one. */
export function insertAt(ids, id, at) {
  if (ids.includes(id) || ids.length >= COLLAGE_MAX) return ids;
  const next = [...ids];
  next.splice(Math.max(0, Math.min(at, next.length)), 0, id);
  return next;
}

/** A photo from the library in place of the one at spot `at`, which goes back to just the library. */
export function swapAt(ids, id, at) {
  if (ids.includes(id) || at < 0 || at >= ids.length) return ids;
  const next = [...ids];
  next[at] = id;
  return next;
}

/** Spot k of a layout in words: "spot 2 of 3, top right, wide" (cellWords, said as a spot). */
export const spotWords = (tree, k) => cellWords(tree, k).replace(/^photo /, 'spot ');
