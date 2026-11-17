/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { photoPath } from '@/lib/sunny-side/addresses.mjs';
import { heightAt, layoutFor, layoutOf, place, ratioOf } from '@/lib/sunny-side/collage-layouts.mjs';
import { insertAt, moveTo, spotWords, swapAt } from '@/lib/sunny-side/collage.mjs';
import { Email } from '@/lib/sunny-side/email.mjs';
import { COLLAGE_MAX, DEFAULT_HERO } from '@/lib/sunny-side/parts.mjs';
import { ALT_DEFAULT, PHOTO_MAX_SIDE, withFocus } from '@/lib/sunny-side/photo-store.mjs';
import { type Landed, useCollageDrag } from './drag';
import { FocusPicker, objectPosition } from './FocusPicker';
import { LayoutChoices } from './Layouts';
import { type Parts, type Photo, send as call, toast } from './model';
import { FieldError, useFlip } from './parts';
import { X } from './Sale';

/**
 * A photo as the page shows it, cropped the way the email crops it: through the resizing around its
 * focus point on the live site, or straight from the site and cropped by the browser around the same
 * point on a developer's machine (objectPosition, which places a crop as the resizing does).
 */
export const photoThumb = (photo: Pick<Photo, 'id' | 'focus'>, w: number, h: number, local: boolean) => (local ? photoPath(photo.id) : Email.photo(withFocus(`photo:${photo.id}`, photo.focus), w, h));

/** Shrinks a photo in the browser to a JPEG at most PHOTO_MAX_SIDE across, turned the way it was taken. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name} is in a format this browser can’t open. On an iPhone, pick it in Safari; on a computer, save it as a JPEG first.`);
  }
  const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
  if (!blob) throw new Error(`${file.name} couldn’t be made ready to upload.`);
  return { blob, w, h };
}

type Layout = NonNullable<ReturnType<typeof layoutFor>>;
/** A spot on a side under this, in pixels on the page, has no room for both 44px buttons. */
const SMALL = 92;
const pct = (x: number, of: number) => `${((100 * x) / of).toFixed(4)}%`;

interface Props {
  photos: Photo[];
  setPhotos: (p: Photo[]) => void;
  parts: Parts;
  setParts: (change: (p: Parts) => Parts) => void;
  error?: string;
  local: boolean;
  /** The charity reveal in the story spot this week, which leaves the collage out of the email */
  reveal?: { name: string } | null;
}

/** True when what's being dragged holds files (not text or a link from the page). */
const holdsFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));

/** The viewfinder on a photo's "what part shows" button; a teal dot once she's chosen a part. */
function Viewfinder({ set }: { set: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <circle cx="12" cy="12" r={set ? 3 : 2} fill={set ? 'var(--teal)' : 'currentColor'} stroke="none" />
    </svg>
  );
}

/** A photo she picked up by tapping it or with the keyboard, waiting to be put down. */
interface Held {
  id: string;
  /** Tapped: the next tap on a spot moves it there. Keys: the arrow keys move it, Space or Enter puts it down. */
  how: 'tap' | 'key';
  /** Where it would be if put down now (keys move it before it's put down). */
  order: string[];
}

/**
 * The week's photos: uploaded from a phone or computer (the button, or dragged onto the section),
 * kept in the store's library, and used as the email's top photo and the story's collage. The
 * collage is drawn the way the email lays it out, and is rearranged by dragging a photo (or tapping
 * it, then its new spot, or with the keyboard); photos come in from the library by dragging them up
 * or ticking them, and go out with their ×. Each photo has a part every crop keeps in view and a
 * few words for people who can't see it.
 */
export function Photos({ photos, setPhotos, parts, setParts, error, local, reveal = null }: Props) {
  const [uploading, setUploading] = useState<{ done: number; of: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  // Files held over the section: counted, since dragging over each photo inside enters and leaves it
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
  // The photo whose "what part shows" is open
  const [focusing, setFocusing] = useState<string | null>(null);
  // The last change to the collage, which Undo puts back
  const [undo, setUndo] = useState<{ text: string; story: string[]; layout: string; at: number } | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  // A library photo ticked while the collage is full, waiting for her to tap the one it replaces
  const [swapping, setSwapping] = useState<string | null>(null);
  // What a screen reader hears as photos move
  const [said, setSaid] = useState('');
  const focusAfter = useRef<string | null>(null);

  // A photo let go anywhere else on the page would open in its place and lose unsaved work
  useEffect(() => {
    const hold = (e: DragEvent) => {
      if (holdsFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragover', hold);
    window.addEventListener('drop', hold);
    return () => {
      window.removeEventListener('dragover', hold);
      window.removeEventListener('drop', hold);
    };
  }, []);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const story = parts.story.photos;
  const setStory = (change: (ids: string[]) => string[]) => setParts((p) => ({ ...p, story: { ...p.story, photos: change(p.story.photos) } }));

  const collage = useRef<HTMLOListElement>(null);
  const panel = useRef<HTMLFieldSetElement>(null);
  const addZone = useRef<HTMLDivElement>(null);

  /** The layout the email draws these photos in: the one she picked while it's made for that many, else the one that keeps the most of them. */
  const layoutOfIds = (ids: string[]): Layout | undefined =>
    ids.length
      ? layoutFor(
          parts.story.layout,
          ids.map((id) => ratioOf(byId.get(id))),
        )
      : undefined;
  const layout = layoutOfIds(story);
  // While a photo is held, the layout for each number of photos stays the one it started as: worked out
  // for the best fit again at every spot she passes, it could change the spots under her finger
  const frozen = useRef(new Map<number, Layout>());
  const layoutWhile = (ids: string[]): Layout | undefined => {
    if (!ids.length) return undefined;
    if (!frozen.current.has(ids.length)) frozen.current.set(ids.length, ids.length === story.length && layout ? layout : layoutOfIds(ids)!);
    return frozen.current.get(ids.length);
  };
  /** Spot k of the collage these photos make, in words: "spot 2 of 3, top right, wide". */
  const where = (ids: string[], k: number) => {
    const l = layoutWhile(ids);
    return l ? spotWords(l.tree, k) : '';
  };
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // The strip's width on the page, so a spot too small for two buttons gets just its ×
  const [stripW, setStripW] = useState(0);

  const say = (text: string) => setSaid(text);

  // The collage stays where it is on the screen when a change reflows the page above it. After a drag,
  // iPhone Safari put a page that had moved back only at the next touch, and so swallowed that tap
  // (Undo took two taps). The page's own Save bar no longer moves anything (mount.ts); this keeps any
  // other reflow above from doing the same: the browser's anchoring sits out the one frame of the
  // change, and the page scrolls back by exactly what it moved.
  const steady = useRef<number | null>(null);
  const holdPlace = () => {
    const top = panel.current?.getBoundingClientRect().top;
    if (top === undefined) return;
    steady.current = top;
    for (const el of [document.documentElement, document.body]) el.style.overflowAnchor = 'none';
  };
  useLayoutEffect(() => {
    if (steady.current === null) return;
    const was = steady.current;
    steady.current = null;
    const now = panel.current?.getBoundingClientRect().top ?? was;
    if (Math.abs(now - was) >= 1) window.scrollBy(0, now - was);
    requestAnimationFrame(() => {
      for (const el of [document.documentElement, document.body]) el.style.overflowAnchor = '';
    });
  });

  /**
   * Changes the collage, with words for what changed and an Undo. An arrangement she makes by hand keeps
   * the layout she made it in (`keep`): left to the best fit, the layout could change as she let go.
   */
  const change = (next: string[], text: string, keep?: Layout) => {
    const nextLayout = keep ? keep.id : parts.story.layout;
    if (next.join('|') === story.join('|') && nextLayout === parts.story.layout) return;
    holdPlace();
    setUndo({ text, story, layout: parts.story.layout, at: Date.now() });
    setParts((p) => ({ ...p, story: { ...p.story, photos: next, layout: nextLayout } }));
    say(text);
  };
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(t);
  }, [undo?.at]);

  const landed = (order: string[], l: Landed) => {
    const at = where(order, l.at);
    const text = l.kind === 'move' ? `Moved to ${at}.` : l.kind === 'add' ? `Added to the collage at ${at}.` : `Swapped in at ${at}; the one that was there is back in the library.`;
    change(order, text, layoutWhile(order));
  };
  const drag = useCollageDrag({ story, list: collage, zone: panel, addZone, onLand: landed, disabled: Boolean(uploading) });
  const view = drag.view;
  if (!view && !held) frozen.current.clear();

  // What the collage shows: where a held photo would land, else the collage as it is
  const shown = view?.order ?? (held?.how === 'key' ? held.order : story);
  useFlip(collage, shown);
  useEffect(() => {
    const el = collage.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(([entry]) => setStripW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown.length > 0]);
  // Keyboard focus stays on a photo as it moves, and goes to its neighbor when it's taken out
  useLayoutEffect(() => {
    const id = focusAfter.current ?? (held?.how === 'key' ? held.id : null);
    focusAfter.current = null;
    if (!id) return;
    const button = collage.current?.querySelector<HTMLElement>(`[data-pick="${CSS.escape(id)}"]`);
    if (button && document.activeElement !== button) button.focus({ preventScroll: false });
  });

  const nameOf = (id: string, k: number) => `photo ${k + 1}${byId.get(id)?.alt && byId.get(id)!.alt !== ALT_DEFAULT ? ` (${byId.get(id)!.alt})` : ''}`;

  const remove = (id: string, fromKeys = false) => {
    const k = story.indexOf(id);
    if (k < 0) return;
    const next = story.filter((x) => x !== id);
    if (fromKeys) focusAfter.current = next[Math.min(k, next.length - 1)] ?? null;
    setHeld(null);
    change(next, `Took ${nameOf(id, k)} out of the collage. It’s still in the library below.`);
  };

  const swapIn = (id: string, at: number) => {
    setSwapping(null);
    change(swapAt(story, id, at), `Swapped in at ${where(story, at)}; the one that was there is back in the library.`, layout);
    focusAfter.current = id;
  };

  /** A photo in the collage tapped or clicked, or Space/Enter pressed on it. */
  const tap = (e: MouseEvent, id: string) => {
    if (drag.justDragged()) return;
    const k = story.indexOf(id);
    if (swapping) return swapIn(swapping, k);
    const keys = e.detail === 0;
    if (!held) {
      setHeld({ id, how: keys ? 'key' : 'tap', order: story });
      say(keys ? `Picked up ${nameOf(id, k)}, in ${where(story, k)}. The arrow keys move it; Space or Enter puts it down; Escape puts it back.` : `Picked up ${nameOf(id, k)}. Tap the spot where it goes.`);
      return;
    }
    if (held.id === id) {
      setHeld(null);
      if (held.how === 'key' && held.order.join('|') !== story.join('|')) change(held.order, `Put down in ${where(held.order, held.order.indexOf(id))}.`, layoutWhile(held.order));
      else say('Put back.');
      return;
    }
    // A tap on another spot: the held photo moves there
    const to = k;
    setHeld(null);
    change(moveTo(story, story.indexOf(held.id), to), `Moved to ${where(story, to)}.`, layout);
  };

  const keys = (e: KeyboardEvent, id: string) => {
    if (held?.how === 'key' && held.id === id) {
      const k = held.order.indexOf(id);
      const last = held.order.length - 1;
      const to = { ArrowLeft: k - 1, ArrowUp: k - 1, ArrowRight: k + 1, ArrowDown: k + 1, Home: 0, End: last }[e.key];
      if (e.key === 'Escape') {
        e.preventDefault();
        setHeld(null);
        return say('Put back where it was.');
      }
      if (to === undefined) return;
      e.preventDefault();
      const at = Math.max(0, Math.min(last, to));
      if (at === k) return say(at === 0 ? 'It’s already first.' : 'It’s already last.');
      const next = moveTo(held.order, k, at);
      setHeld({ ...held, order: next });
      return say(`${cap(where(next, at))}.`);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !held && !swapping) {
      e.preventDefault();
      remove(id, true);
    } else if (e.key === 'Escape' && (held || swapping)) {
      e.preventDefault();
      setHeld(null);
      setSwapping(null);
      say('Cancelled.');
    }
  };

  // Keyboard focus leaving a photo held with the keys puts it back, as Escape does
  const leave = (e: FocusEvent) => {
    if (held?.how !== 'key') return;
    const to = e.relatedTarget as HTMLElement | null;
    if (to && to.dataset.pick !== held.id) {
      setHeld(null);
      say('Put back where it was.');
    }
  };

  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setProblem(null);
    const all = [...files];
    const list = all.filter((f) => f.type.startsWith('image/'));
    const skipped = all.length - list.length;
    if (skipped) setProblem(`${skipped === 1 ? `${all.find((f) => !f.type.startsWith('image/'))!.name} isn’t a photo` : `${skipped} of those aren’t photos`}, so ${skipped === 1 ? 'it was' : 'they were'} left out.`);
    if (!list.length) return;
    let added: Photo[] = [];
    setUploading({ done: 0, of: list.length });
    for (const [k, file] of list.entries()) {
      try {
        const { blob, w, h } = await shrink(file);
        const form = new FormData();
        form.append('photo', blob, 'photo.jpg');
        form.append('w', String(w));
        form.append('h', String(h));
        form.append('alt', ALT_DEFAULT);
        const res = await fetch('/api/admin/email/photos/', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
        if (!res.ok || !data.photo) throw new Error(data.error || `${file.name} didn’t upload. Try again.`);
        added = [data.photo, ...added];
      } catch (err) {
        setProblem(err instanceof Error ? err.message : String(err));
      }
      setUploading({ done: k + 1, of: list.length });
    }
    setUploading(null);
    if (added.length) {
      setPhotos([...added, ...photos]);
      // New photos go into the story while it has room
      setStory((ids) => [...ids, ...added.map((p) => p.id)].slice(0, Math.max(ids.length, COLLAGE_MAX)));
      toast(`Added ${added.length} photo${added.length === 1 ? '' : 's'}`);
    }
  }

  async function saveAlt(p: Photo) {
    const alt = (alts[p.id] ?? p.alt).trim();
    if (alt === p.alt) return;
    const res = await call<{ alt: string }>('/api/admin/email/photos/', 'PUT', { id: p.id, alt });
    if (!res.ok) return setProblem(res.error);
    setPhotos(photos.map((x) => (x.id === p.id ? { ...x, alt: res.body.alt } : x)));
  }

  const toggleStory = (id: string) => {
    if (story.includes(id)) return remove(id);
    if (story.length < COLLAGE_MAX) {
      const next = insertAt(story, id, story.length);
      change(next, `Added to the collage at ${where(next, story.length)}.`);
      return;
    }
    // Full: she picks the photo it replaces
    setHeld(null);
    setSwapping(id);
    say(`The collage holds ${COLLAGE_MAX}. Choose the photo this one replaces.`);
    panel.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    focusAfter.current = story[0];
  };
  const shownLibrary = showAll ? photos : photos.slice(0, 12);

  const files = {
    onDragEnter: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDropping(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDropping(false);
      if (uploading) return toast('Wait for these photos to finish, then add more.');
      void upload(e.dataTransfer ? [...e.dataTransfer.files] : null);
    },
  };

  const n = shown.length;
  const shownLayout = n ? (view || held ? layoutWhile(shown) : layout) : undefined;
  const cells = shownLayout ? place(shownLayout.tree) : [];
  const H = shownLayout ? heightAt(shownLayout.tree) : 1;
  const room = COLLAGE_MAX - story.length;
  // A charity reveal has the story spot: the email leaves the collage out, so it's kept as it is, faded
  const off = Boolean(parts.story.reveal);
  const fromLibrary = view?.source === 'library';
  const focusPhoto = focusing ? byId.get(focusing) : undefined;
  const usesOf = (id: string) => [...(parts.hero === id ? ['the top photo'] : []), ...(story.includes(id) ? [`spot ${story.indexOf(id) + 1} in the collage`] : [])];
  /** The crops the email makes of a photo, for "what part shows": the top photo's, and its spot in the collage (or a square one). */
  const cropsOf = (id: string) => {
    const k = story.indexOf(id);
    const c = k >= 0 && layout ? place(layout.tree)[k] : null;
    return [{ label: parts.hero === id ? 'The top photo' : 'As the top photo', w: 600, h: 300 }, c ? { label: `Spot ${k + 1} in the collage`, w: c.w, h: c.h } : { label: 'A square spot in the collage', w: 1, h: 1 }];
  };
  const chooseLayout = (id: string) => {
    const l = layoutOf(id, story.length);
    if (l) change(story, `The collage is now “${l.name}”.`, l);
  };
  const stage = swapping ? 'swap' : held ? held.how : view ? 'drag' : 'rest';

  return (
    <div class={`em-photos${dropping ? ' is-dropping' : ''}`} {...files}>
      {dropping && (
        <div class="em-drop" aria-hidden="true">
          <span class="em-drop-label">{uploading ? 'Wait for these photos to finish' : 'Drop to add these photos'}</span>
        </div>
      )}
      {/* Where photos go, in plain sight (Shopify's drop zone: a dashed box, its button, "or drop files"):
          drag them onto it, or anywhere on the section, or click anywhere in it to choose them */}
      <label class={`em-dropzone${uploading ? ' is-busy' : ''}`}>
        <input type="file" accept="image/*" multiple disabled={Boolean(uploading)} onChange={(e) => void upload((e.target as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = ''))} />
        <span class="btn btn-dark">{uploading ? `Uploading ${uploading.done + 1 > uploading.of ? uploading.of : uploading.done + 1} of ${uploading.of}…` : 'Add photos'}</span>
        <span class="em-dropzone-or">or drag them here</span>
        <span class="em-dropzone-hint">For the top photo and the story’s collage. Photos from a phone are made smaller before they go up.</span>
      </label>
      {problem && (
        <p class="em-error" role="alert">
          {problem}
        </p>
      )}
      <FieldError id="em-photos-error" message={error} />

      <fieldset class={`em-collage is-${stage}${fromLibrary ? ' is-taking' : ''}${off ? ' is-off' : ''}`} ref={panel}>
        <legend>The story’s collage{off ? ' · Not in this email' : shownLayout ? ` · ${shownLayout.name}` : ''}</legend>
        {off && (
          <p class="em-off-note">
            <span>
              This week the story spot is {reveal ? `${reveal.name}’s reveal` : 'the charity’s reveal'}, so the collage isn’t in the email. Its photos and layout stay saved for the showroom story.
            </span>
            <a class="btn btn-small" href="#em-story">
              Change the story spot
            </a>
          </p>
        )}
        {/* The collage's one status line: what to do, what a held photo will do, or the last change and its Undo.
            At the top of the collage, where the page's floating buttons on a phone can't cover it. */}
        {!off && (n > 0 || stage !== 'rest' || undo) && (
          <p class={`em-collage-hint${stage === 'rest' && undo ? ' is-undo' : ''}`}>
            {stage === 'swap' ? (
              <>
                <img class="em-collage-hint-photo" src={photoThumb(byId.get(swapping!) ?? { id: swapping!, focus: '' }, 96, 96, local)} alt="" />
                <span>Tap the photo this one replaces.</span>
              </>
            ) : stage === 'tap' ? (
              <>
                <span>Tap the spot where it goes.</span>
                {/* Its own buttons, here too: a small spot has no room for them */}
                <button type="button" class="btn btn-small" onClick={() => remove(held!.id)}>
                  Take out
                </button>
                <button
                  type="button"
                  class="btn btn-small"
                  onClick={() => {
                    const id = held!.id;
                    setHeld(null);
                    setFocusing(id);
                  }}
                >
                  What part shows
                </button>
              </>
            ) : stage === 'key' ? (
              <span>Arrow keys move it. Space or Enter puts it down; Escape puts it back.</span>
            ) : view?.swapping ? (
              <span>Let go to swap it in. The one there goes back to the library.</span>
            ) : view ? (
              <span>{view.away ? 'Let go here and it goes back.' : 'Let go to put it here.'}</span>
            ) : undo ? (
              <>
                <span>{undo.text}</span>
                <button
                  type="button"
                  class="btn btn-small em-undo-button"
                  onClick={() => {
                    holdPlace();
                    setParts((p) => ({ ...p, story: { ...p.story, photos: undo.story, layout: undo.layout } }));
                    setUndo(null);
                    setHeld(null);
                    say('Undone.');
                  }}
                >
                  Undo
                </button>
              </>
            ) : n ? (
              <span>
                Drag a photo to move it<span class="em-touch-only">: press and hold, then drag</span>. Or tap one, then tap its new spot.
              </span>
            ) : null}
            {(stage === 'swap' || stage === 'tap' || stage === 'key') && (
              <button
                type="button"
                class="btn btn-small btn-ghost em-collage-cancel"
                onClick={() => {
                  setHeld(null);
                  setSwapping(null);
                  say('Cancelled.');
                }}
              >
                Cancel
              </button>
            )}
          </p>
        )}
        <p class="visually-hidden" id="em-collage-keys">
          Space or Enter picks this photo up. The arrow keys then move it, and Space or Enter puts it down; Escape puts it back. Delete takes it out of the collage.
        </p>
        {n > 0 && (
          <ol class="em-collage-list" ref={collage} inert={off || undefined} style={{ aspectRatio: `600 / ${H.toFixed(3)}` }} aria-label={`The collage, in the email’s order: ${shownLayout?.name ?? ''}`}>
            {shown.map((id, k) => {
              const c = cells[k] ?? { x: 0, y: 0, w: 600, h: H };
              const small = stripW > 0 && (Math.min(c.w, c.h) * stripW) / 600 < SMALL;
              const photo = byId.get(id) ?? { id, focus: '', alt: '', w: 1, h: 1, uploadedAt: '', uploadedBy: '' };
              const isHeld = (view && view.id === id) || (held && held.id === id);
              const incoming = Boolean(view?.swapping) && view!.id === id;
              const choice = (held?.how === 'tap' && held.id !== id) || Boolean(swapping);
              return (
                <li
                  data-id={id}
                  data-flip={id}
                  key={id}
                  style={{ left: pct(c.x, 600), top: pct(c.y, H), width: pct(c.w, 600), height: pct(c.h, H) }}
                  class={`em-collage-item${small ? ' is-small' : ''}${view && view.id === id ? ' is-placeholder' : ''}${held?.id === id ? ' is-held' : ''}${incoming ? ' is-incoming' : ''}${choice ? ' is-choice' : ''}`}
                >
                  <button
                    type="button"
                    class="em-collage-pick"
                    data-pick={id}
                    aria-label={`${cap(nameOf(id, k))}, ${shownLayout ? spotWords(shownLayout.tree, k) : ''}${held?.id === id ? ', picked up' : ''}`}
                    aria-describedby="em-collage-keys"
                    aria-pressed={isHeld ? 'true' : undefined}
                    onPointerDown={(e) => drag.startPress(e, id, 'collage')}
                    onTouchMove={drag.touchGuard}
                    onClick={(e) => tap(e, id)}
                    onKeyDown={(e) => keys(e, id)}
                    onBlur={leave}
                  >
                    {/* Cropped to its spot the way the email crops it, at the email's own size */}
                    <img src={photoThumb(photo, Math.round(c.w * 2), Math.round(c.h * 2), local)} alt="" draggable={false} style={{ objectPosition: objectPosition(photo.focus) }} />
                    {choice && <span class="em-collage-here">{swapping ? 'Swap' : 'Here'}</span>}
                  </button>
                  <span class="em-collage-n" aria-hidden="true">
                    {k + 1}
                  </span>
                  {!view && !off && (
                    <>
                      <button type="button" class="em-collage-x" data-nodrag aria-label={`Take ${nameOf(id, k)} out of the collage`} title="Take it out of the collage" onClick={() => remove(id)}>
                        <X />
                      </button>
                      <button type="button" class="em-collage-focus" data-nodrag aria-label={`Choose what part of ${nameOf(id, k)} shows`} title="Choose what part shows" onClick={() => setFocusing(id)}>
                        <Viewfinder set={Boolean(photo.focus)} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {!off && (room > 0 || (fromLibrary && !view?.swapping && story.length < COLLAGE_MAX)) && (
          <div class={`em-collage-add${n ? '' : ' is-empty'}`} ref={addZone}>
            {fromLibrary ? (
              <span>{n > story.length ? 'Let go to add it here.' : 'Drop it here to add it at the end.'}</span>
            ) : n ? (
              <span>Room for {room} more. Drag one up from the library, or tick “In the story”.</span>
            ) : (
              <span>
                <strong>No photos in the story yet.</strong> Drag photos up from the library, or tick “In the story” on up to {COLLAGE_MAX}.
              </span>
            )}
          </div>
        )}
        {layout && story.length > 0 && !view && !off && (
          <LayoutChoices ids={story} byId={byId} current={layout} setChosen={chooseLayout} fit={(ids) => change(ids, 'Moved the photos to the spots that keep the most of them.', layout)} local={local} />
        )}
        <p class="visually-hidden" aria-live="assertive" aria-atomic="true">
          {said}
        </p>
      </fieldset>

      <ul class="em-library" aria-label="The store’s photos">
        <li class={`em-photo${parts.hero ? '' : ' is-hero'}`}>
          <span class="em-photo-img">
            <img src={Email.photo(DEFAULT_HERO.src, 480, 480)} alt="" loading="lazy" />
          </span>
          <span class="em-photo-name">The store’s wide shot</span>
          <label class="check">
            <input type="radio" name="em-hero" checked={!parts.hero} onChange={() => setParts((x) => ({ ...x, hero: '' }))} /> Top photo
          </label>
        </li>
        {shownLibrary.map((p) => (
          <li class={`em-photo${parts.hero === p.id ? ' is-hero' : ''}${story.includes(p.id) ? ' is-story' : ''}${view?.id === p.id ? ' is-lifted' : ''}${swapping === p.id ? ' is-waiting' : ''}`} key={p.id}>
            <span class="em-photo-img" onPointerDown={off ? undefined : (e) => drag.startPress(e, p.id, 'library')} onTouchMove={drag.touchGuard}>
              <img src={photoThumb(p, 480, 480, local)} alt="" loading="lazy" draggable={false} style={{ objectPosition: objectPosition(p.focus) }} />
              {story.includes(p.id) && <span class="em-collage-n">{story.indexOf(p.id) + 1}</span>}
              <button type="button" class="em-photo-focus" data-nodrag aria-label="Choose what part of this photo shows" title="Choose what part shows" onClick={() => setFocusing(p.id)}>
                <Viewfinder set={Boolean(p.focus)} />
              </button>
            </span>
            <input
              class="em-photo-alt"
              aria-label="What’s in this photo, for people who can’t see it"
              value={alts[p.id] ?? p.alt}
              maxLength={120}
              onInput={(e) => setAlts({ ...alts, [p.id]: (e.target as HTMLInputElement).value })}
              onBlur={() => void saveAlt(p)}
            />
            <label class="check">
              <input type="radio" name="em-hero" checked={parts.hero === p.id} onChange={() => setParts((x) => ({ ...x, hero: p.id }))} /> Top photo
            </label>
            <label class="check">
              <input type="checkbox" checked={story.includes(p.id)} onChange={() => toggleStory(p.id)} /> In the story
            </label>
          </li>
        ))}
      </ul>
      {photos.length > 12 && (
        <button type="button" class="btn btn-small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${photos.length} photos`}
        </button>
      )}
      {focusPhoto && (
        <FocusPicker
          photo={focusPhoto}
          local={local}
          uses={usesOf(focusPhoto.id)}
          crops={cropsOf(focusPhoto.id)}
          onSaved={(focus) => setPhotos(photos.map((x) => (x.id === focusPhoto.id ? { ...x, focus } : x)))}
          onClose={() => setFocusing(null)}
        />
      )}
    </div>
  );
}
