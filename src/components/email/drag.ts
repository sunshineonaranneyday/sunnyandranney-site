/**
 * Dragging photos into place in the story's collage, by mouse, finger or pen
 * ===========================================================================
 * A photo lifts out of its spot and follows the pointer; the collage lays itself out the way it
 * would be if she let go there, so she sees which photo becomes the wide one before she drops it
 * (the way Shopify, Squarespace and Google Photos reorder photos). A mouse or pen lifts a photo as
 * soon as it moves a few pixels. A finger has to rest on it for a moment first, the way iOS lifts
 * an app icon or a photo in an album: a quick swipe over the collage still scrolls the page.
 *
 * Photos come from the collage (moved to a new spot) or from the library below (put in at a spot
 * while the collage has room, else swapped for the one there). Letting go outside the collage, or
 * pressing Escape, puts everything back. Near the top or bottom of the screen the page scrolls, so
 * a photo can be carried from the library up to the collage on a phone.
 *
 * Plain pointer events, and a touchmove listener on each photo that stops the page scrolling only
 * once a finger has lifted one (touchGuard): no library, and nothing re-renders as the pointer moves
 * except when the photo it's over changes. Checked in real iOS Safari (an Xcode UI test pressing,
 * holding and dragging in the simulator), where a listener added later let the page scroll instead.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { insertAt, moveTo, swapAt } from '@/lib/sunny-side/collage.mjs';
import { COLLAGE_MAX } from '@/lib/sunny-side/parts.mjs';

export type Source = 'collage' | 'library';

/** What the collage shows while a photo is held. */
export interface DragView {
  id: string;
  source: Source;
  /** The thumbnail the held photo shows while it follows the pointer. */
  src: string;
  /** The collage as it would be if she let go here. */
  order: string[];
  /** The photo a library photo would take the place of (the collage is full), or ''. */
  swapping: string;
  /** Outside the collage: letting go puts everything back. */
  away: boolean;
  /** Let go, and flying to its spot. */
  landing: boolean;
}

/** What letting go did. */
export interface Landed {
  kind: 'move' | 'add' | 'swap';
  id: string;
  /** The spot it landed in. */
  at: number;
  /** The photo a swap took out. */
  out: string;
}

interface Options {
  story: string[];
  /** The grid the photos sit in: each spot carries data-id, inside a positioned grid (homeRect). */
  list: RefObject<HTMLElement>;
  /** The whole collage panel: letting go anywhere on it counts. */
  zone: RefObject<HTMLElement>;
  /** The strip under the grid that adds a library photo at the end, while there's room. */
  addZone: RefObject<HTMLElement>;
  onLand: (order: string[], landed: Landed) => void;
  disabled: boolean;
}

interface Press {
  id: string;
  source: Source;
  src: string;
  pointerId: number;
  touch: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  el: HTMLElement;
  timer: number;
  active: boolean;
  base: string[];
  offX: number;
  offY: number;
  top: number;
  raf: number;
  scroll: number;
}

/** How long a finger rests on a photo before it lifts (iOS lifts a photo in an album after about this). */
export const LIFT_MS = 260;
/** How far a mouse moves before a press is a drag, and how far a resting finger may wander before it's a scroll. */
const SLOP_MOUSE = 4;
const SLOP_TOUCH = 10;
/** The band at the top and bottom of the screen that scrolls the page while a photo is held, and the fastest it scrolls. */
const EDGE = 72;
const SPEED = 18;
/** How far a held photo has to have moved toward an edge before the page scrolls that way. */
const TOWARD = 12;

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const inside = (r: DOMRect, x: number, y: number, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

/** An item's place in the grid, leaving out any slide it's in the middle of (offsets ignore transforms). */
export function homeRect(item: HTMLElement): DOMRect {
  const parent = item.offsetParent as HTMLElement | null;
  if (!parent) return item.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  return new DOMRect(p.left + parent.clientLeft + item.offsetLeft, p.top + parent.clientTop + item.offsetTop, item.offsetWidth, item.offsetHeight);
}

/** The id of the collage photo whose spot holds the point, or ''. */
function idAt(list: HTMLElement | null, x: number, y: number): string {
  if (!list) return '';
  for (const item of list.querySelectorAll<HTMLElement>('[data-id]')) {
    if (inside(homeRect(item), x, y)) return item.dataset.id!;
  }
  return '';
}

/** How far down the screen the page's own bars reach, so the page scrolls before a photo goes under them. */
function topOfView(): number {
  const bar = document.querySelector<HTMLElement>('.em-bar');
  const sticky = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom : 0;
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 0;
  return Math.max(0, sticky, topbar);
}

export function useCollageDrag(options: Options) {
  const [view, setView] = useState<DragView | null>(null);
  const o = useRef(options);
  o.current = options;
  const press = useRef<Press | null>(null);
  const current = useRef<DragView | null>(null);
  const lastDrag = useRef(0);
  // The photo that follows the pointer: on the page's body, since the email page's layout
  // containment (its container query) would hold a fixed box inside it
  const ghost = useRef<HTMLDivElement | null>(null);
  const show = (v: DragView | null) => {
    current.current = v;
    setView(v);
    if (!v) {
      ghost.current?.remove();
      ghost.current = null;
    }
  };

  /** Puts the held photo under the pointer, where it was picked up from it. */
  const place = () => {
    const p = press.current;
    const g = ghost.current;
    if (p && g) g.style.transform = `translate3d(${p.x - p.offX}px, ${p.y - p.offY}px, 0)`;
  };

  /** Works out where the photo would land if she let go now, and lays the collage out that way. */
  const retarget = () => {
    const p = press.current;
    const v = current.current;
    if (!p?.active || !v || v.landing) return;
    const { list, zone, addZone } = o.current;
    const panel = zone.current?.getBoundingClientRect();
    let next: DragView;
    if (!panel || !inside(panel, p.x, p.y, 16)) {
      next = { ...v, order: p.base, swapping: '', away: true };
    } else {
      const over = idAt(list.current, p.x, p.y);
      const slot = over ? v.order.indexOf(over) : -1;
      const onAdd = Boolean(addZone.current && inside(addZone.current.getBoundingClientRect(), p.x, p.y, 8));
      const has = v.order.includes(v.id);
      if (v.source === 'collage') {
        next = { ...v, away: false, order: slot >= 0 ? moveTo(v.order, v.order.indexOf(v.id), slot) : v.away ? p.base : v.order };
      } else if (p.base.length >= COLLAGE_MAX) {
        // A full collage: the photo it's over would go back to the library. Over itself or a gap, it stays put.
        const at = over ? p.base.indexOf(over) : -1;
        next = at >= 0 ? { ...v, away: false, order: swapAt(p.base, v.id, at), swapping: p.base[at] } : { ...v, away: false };
      } else if (slot >= 0) {
        next = { ...v, away: false, swapping: '', order: has ? moveTo(v.order, v.order.indexOf(v.id), slot) : insertAt(p.base, v.id, slot) };
      } else if (onAdd) {
        next = { ...v, away: false, swapping: '', order: has ? moveTo(v.order, v.order.indexOf(v.id), v.order.length - 1) : [...p.base, v.id] };
      } else {
        next = { ...v, away: false };
      }
    }
    if (next.away !== v.away || next.swapping !== v.swapping || next.order.join('|') !== v.order.join('|')) show(next);
  };

  const schedule = () => {
    const p = press.current;
    if (!p || p.raf) return;
    p.raf = requestAnimationFrame(() => {
      if (press.current) press.current.raf = 0;
      retarget();
    });
  };

  /** Scrolls the page while the photo is held near the top or bottom of the screen. */
  const autoScroll = () => {
    const p = press.current;
    if (!p?.active) return;
    const v = current.current;
    if (v && !v.landing) {
      // Only toward an edge she's carrying it to: a photo lifted near the bottom and dragged up doesn't scroll the page down
      let dy = 0;
      if (p.y < p.top + EDGE && p.y < p.y0 - TOWARD) dy = -Math.min(SPEED, Math.ceil(((p.top + EDGE - p.y) / EDGE) * SPEED));
      else if (p.y > innerHeight - EDGE && p.y > p.y0 + TOWARD) dy = Math.min(SPEED, Math.ceil(((p.y - (innerHeight - EDGE)) / EDGE) * SPEED));
      const before = scrollY;
      if (dy) window.scrollBy(0, dy);
      if (scrollY !== before) retarget();
    }
    p.scroll = requestAnimationFrame(autoScroll);
  };

  const lift = () => {
    const p = press.current;
    if (!p || p.active) return;
    clearTimeout(p.timer);
    p.active = true;
    const r = p.el.getBoundingClientRect();
    p.offX = Math.min(Math.max(p.x0 - r.left, 0), r.width);
    p.offY = Math.min(Math.max(p.y0 - r.top, 0), r.height);
    p.base = o.current.story;
    p.top = topOfView();
    ghost.current?.remove();
    const g = document.createElement('div');
    g.className = 'em-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.style.width = `${r.width}px`;
    g.style.height = `${r.height}px`;
    const from = p.el.querySelector('img');
    const img = document.createElement('img');
    img.alt = '';
    img.src = p.src;
    if (from) img.style.objectPosition = getComputedStyle(from).objectPosition;
    g.appendChild(img);
    document.body.appendChild(g);
    ghost.current = g;
    place();
    // Lifts on the next frame, so the shadow and the slight grow animate in
    requestAnimationFrame(() => g.classList.add('is-lifted'));
    // The collage keeps its height while a photo is held, so a layout one photo shorter can't pull it out from under the pointer
    const list = o.current.list.current;
    if (list) list.style.minHeight = `${list.offsetHeight}px`;
    document.documentElement.classList.add('em-holding');
    if (p.touch) navigator.vibrate?.(8);
    show({ id: p.id, source: p.source, src: p.src, order: p.base, swapping: '', away: p.source === 'library', landing: false });
    p.scroll = requestAnimationFrame(autoScroll);
    schedule();
  };

  /** Ends a press, held or not, and takes away everything it put on the page. */
  const release = () => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    cancelAnimationFrame(p.raf);
    cancelAnimationFrame(p.scroll);
    press.current = null;
    window.removeEventListener('contextmenu', noMenu);
    document.documentElement.classList.remove('em-holding');
    const list = o.current.list.current;
    if (list) list.style.minHeight = '';
  };

  /** Flies the held photo to a spot on the page, then calls done. */
  const fly = (to: DOMRect | null, done: () => void) => {
    const g = ghost.current;
    if (!g || !to || still() || typeof g.animate !== 'function') return done();
    const from = g.getBoundingClientRect();
    const a = g.animate(
      [
        { transform: `translate3d(${from.left}px, ${from.top}px, 0)`, width: `${from.width}px`, height: `${from.height}px` },
        { transform: `translate3d(${to.left}px, ${to.top}px, 0)`, width: `${to.width}px`, height: `${to.height}px` },
      ],
      { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    );
    g.classList.remove('is-lifted');
    a.finished.then(done, done);
  };

  /** The spot a photo sits in now, or the place it was picked up from. */
  const spotOf = (id: string) => o.current.list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? null;

  const drop = (cancel: boolean) => {
    const p = press.current;
    if (!p) return;
    if (p.active && !cancel) {
      // Where it is let go, not where the last frame saw it: a release right after reaching a spot lands there
      cancelAnimationFrame(p.raf);
      p.raf = 0;
      retarget();
    }
    const v = current.current;
    if (!p.active || !v) return release();
    lastDrag.current = performance.now();
    const moved = !cancel && !v.away && v.order.join('|') !== p.base.join('|');
    const base = p.base;
    const from = p.el;
    release();
    if (moved) {
      show({ ...v, landing: true });
      // The collage draws that last layout first, so the photo flies to the spot it lands in
      requestAnimationFrame(() => {
        const spot = spotOf(v.id);
        fly(spot ? homeRect(spot) : null, () => {
          // The collage takes the new order before the held view goes, so it never shows the old one in between
          o.current.onLand(v.order, { kind: v.source === 'collage' ? 'move' : v.swapping ? 'swap' : 'add', id: v.id, at: v.order.indexOf(v.id), out: v.swapping });
          show(null);
        });
      });
    } else {
      // Back where it came from: the collage lays itself out as it was, then the photo settles into its place
      show({ ...v, order: base, swapping: '', away: true, landing: true });
      requestAnimationFrame(() => {
        const spot = v.source === 'collage' ? spotOf(v.id) : null;
        fly(spot ? homeRect(spot) : from.isConnected ? from.getBoundingClientRect() : null, () => show(null));
      });
    }
  };

  // They read the press from the ref, so they never go stale
  const holdStill = (e: TouchEvent) => {
    // Once a finger has lifted a photo, its moves carry the photo instead of scrolling the page
    if (press.current?.active && e.cancelable) e.preventDefault();
  };
  const noMenu = (e: Event) => {
    if (press.current) e.preventDefault();
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!p.active) {
        const far = Math.hypot(p.x - p.x0, p.y - p.y0);
        // A finger that moves before the photo lifts is scrolling the page
        if (p.touch) {
          if (far > SLOP_TOUCH) release();
          return;
        }
        if (far <= SLOP_MOUSE) return;
        lift();
        return;
      }
      place();
      schedule();
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      drop(false);
    };
    const cancel = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointerId) drop(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current?.active) {
        e.preventDefault();
        drop(true);
      }
    };
    const away = () => press.current && drop(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', away);
      release();
      ghost.current?.remove();
    };
  }, []);

  /** Starts a press on a photo: a mouse lifts it once it moves, a finger once it rests (LIFT_MS). */
  const startPress = (e: PointerEvent, id: string, source: Source) => {
    if (o.current.disabled || press.current || current.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('[data-nodrag]')) return;
    const el = e.currentTarget as HTMLElement;
    const touch = e.pointerType === 'touch';
    const src = el.querySelector('img')?.currentSrc || el.querySelector('img')?.src || '';
    press.current = {
      id,
      // A library photo already in the collage moves within it
      source: source === 'library' && o.current.story.includes(id) ? 'collage' : source,
      src,
      pointerId: e.pointerId,
      touch,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      el,
      timer: touch ? window.setTimeout(lift, LIFT_MS) : 0,
      active: false,
      base: o.current.story,
      offX: 0,
      offY: 0,
      top: 0,
      raf: 0,
      scroll: 0,
    };
    if (touch) {
      window.addEventListener('contextmenu', noMenu);
    } else {
      // Keeps the browser from starting its own drag of the image or selecting text
      e.preventDefault();
    }
  };

  /** True just after a drag ended, so the click that follows it isn't taken as a tap. */
  const justDragged = () => performance.now() - lastDrag.current < 500;

  /**
   * Goes on each photo that can be dragged, as its onTouchMove, from the start. Safari on iPhone and
   * iPad decides when a finger lands whether the page may scroll under it, by whether what's under
   * the finger already listens for touch moves; a listener added once the photo lifts (260ms later)
   * is too late, and the page scrolled instead of the photo moving (seen in iOS Safari, 2026-11-17).
   * It does nothing until a photo is held, so scrolling over the photos is untouched.
   */
  const touchGuard = holdStill;

  return { view, startPress, justDragged, touchGuard };
}
