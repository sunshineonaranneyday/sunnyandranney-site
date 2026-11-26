/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { photoPath } from '@/lib/sunny-side/addresses.mjs';
import { Email } from '@/lib/sunny-side/email.mjs';
import { cleanFocus, focusPoint } from '@/lib/sunny-side/photo-store.mjs';
import { type Photo, send as call, toast } from './model';

/**
 * How a crop of the photo sits around its focus point: the point lands at the same place in the
 * crop as in the whole photo. That's CSS's object-position in percent, and it's how Cloudflare's
 * resizing places a crop for gravity=XxY, so the page shows each crop exactly as the email gets it.
 */
export const objectPosition = (focus: string) => {
  const p = focusPoint(focus);
  return p ? `${Math.round(p.x * 1000) / 10}% ${Math.round(p.y * 1000) / 10}%` : '50% 50%';
};

/** The whole photo, uncropped, at most `side` pixels on its long side. */
export function wholePhoto(photo: Photo, local: boolean, side = 1200) {
  if (local) return photoPath(photo.id);
  const k = Math.min(1, side / Math.max(photo.w, photo.h));
  // Cropped to its own shape, which is no crop at all
  return Email.photo(`photo:${photo.id}`, Math.max(1, Math.round(photo.w * k)), Math.max(1, Math.round(photo.h * k)));
}

interface Props {
  photo: Photo;
  local: boolean;
  /** Where the email uses it now, in words ("the top photo", "spot 3 in the collage"). */
  uses: string[];
  /** The crops to show beside it, each a shape the email cuts it to (width and height in any units). */
  crops: { label: string; w: number; h: number }[];
  onSaved: (focus: string) => void;
  onClose: () => void;
}

const STEP = 0.02;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Choosing the part of a photo every crop keeps in view: tap or drag on the whole photo, or move the
 * point with the arrow keys, and the email's two shapes (the wide top photo and first collage photo,
 * and the square ones) change as it moves. Like Squarespace's focal point and Sanity's hotspot, with
 * the crops shown beside it as the email will draw them. "Automatic" goes back to the resizing's own
 * choice of what stands out.
 */
export function FocusPicker({ photo, local, uses, crops, onSaved, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(photo.focus);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const point = focusPoint(focus);
  const whole = wholePhoto(photo, local);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const at = (e: PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    setFocus(cleanFocus({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
    setProblem('');
  };
  const keys = (e: KeyboardEvent) => {
    const from = point ?? { x: 0.5, y: 0.5 };
    const step = e.shiftKey ? STEP * 5 : STEP;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (by[e.key]) {
      e.preventDefault();
      setFocus(cleanFocus({ x: from.x + by[e.key][0], y: from.y + by[e.key][1] }));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocus(cleanFocus({ x: 0.5, y: 0.5 }));
    }
  };

  async function save() {
    if (focus === photo.focus) return dialog.current?.close();
    setSaving(true);
    const res = await call<{ focus: string }>('/api/admin/email/photos/', 'PUT', { id: photo.id, focus });
    setSaving(false);
    if (!res.ok) return setProblem(res.error);
    onSaved(res.body.focus);
    toast(res.body.focus ? 'Saved. Every crop keeps that part in view.' : 'Saved. The email picks what stands out.');
    dialog.current?.close();
  }

  // Automatic shows the resizing's own crops on the live site; on a developer's machine, the middle
  const auto = !point;
  // The resizing's own crop at that shape, 600px on its long side
  const cropOf = (w: number, h: number) => {
    const k = 600 / Math.max(w, h);
    return auto && !local ? Email.photo(`photo:${photo.id}`, Math.round(w * k), Math.round(h * k)) : whole;
  };
  const ratio = photo.w / photo.h;

  return (
    <dialog
      class="em-dialog em-focus"
      ref={dialog}
      aria-labelledby="em-focus-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <h2 id="em-focus-title">What part of the photo shows</h2>
      <p class="em-hint" id="em-focus-hint">
        Tap or drag to the part that matters most. Every crop in the email keeps it in view.
        {uses.length ? ` This photo is ${uses.join(' and ')}.` : ''}
      </p>
      <div class="em-focus-body">
        <div class="em-focus-stage">
          <div
            class={`em-focus-frame${auto ? ' is-auto' : ''}`}
            ref={frame}
            style={{ aspectRatio: `${photo.w} / ${photo.h}`, width: `min(100%, calc(var(--em-focus-h) * ${ratio.toFixed(4)}))` }}
            role="slider"
            tabIndex={0}
            aria-label="The part of the photo to keep in view"
            aria-describedby="em-focus-hint"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={point ? Math.round(point.x * 100) : 50}
            aria-valuetext={point ? `${pct(point.x)} across, ${pct(point.y)} down` : 'Automatic: the email picks what stands out'}
            onKeyDown={keys}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              at(e);
            }}
            onPointerMove={(e) => {
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) at(e);
            }}
          >
            <img src={whole} alt="" draggable={false} />
            {point ? (
              <span class="em-focus-dot" style={{ left: pct(point.x), top: pct(point.y) }} aria-hidden="true" />
            ) : (
              <span class="em-focus-tap" aria-hidden="true">
                Tap the part that matters most
              </span>
            )}
          </div>
        </div>
        <div class="em-focus-crops" aria-label="How the email crops it">
          {crops.map((c) => (
            <figure class="em-focus-crop" key={c.label}>
              <span class="em-focus-crop-box" style={{ aspectRatio: `${c.w} / ${c.h}`, width: `min(100%, calc(var(--em-crop-h) * ${(c.w / c.h).toFixed(4)}))` }}>
                <img src={cropOf(c.w, c.h)} alt="" style={{ objectPosition: objectPosition(focus) }} />
              </span>
              <figcaption>
                <strong>{c.label}</strong>
              </figcaption>
            </figure>
          ))}
          <p class="em-focus-now" aria-live="polite">
            {auto ? 'Automatic: the email crops around what stands out.' : `Kept in view: ${pct(point!.x)} across, ${pct(point!.y)} down.`}
          </p>
        </div>
      </div>
      {problem && (
        <p class="em-error" role="alert">
          {problem}
        </p>
      )}
      <div class="em-dialog-actions em-focus-actions">
        <button type="button" class="btn btn-ghost em-focus-auto" disabled={auto} onClick={() => setFocus('')}>
          Automatic
        </button>
        <button type="button" class="btn" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </dialog>
  );
}
