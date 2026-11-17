/** @jsxImportSource preact */
import { useRef, useState } from 'preact/hooks';
import { photoPath } from '@/lib/sunny-side/addresses.mjs';
import { Email } from '@/lib/sunny-side/email.mjs';
import { LAYOUTS, bestFit, cellWords, fitOf, fitPhotos, heightAt, layoutFor, place, ratioOf } from '@/lib/sunny-side/collage-layouts.mjs';
import type { Photo } from './model';
import { useFlip } from './parts';

/**
 * A photo for the page, uncropped (its own shape), so one copy serves every layout and the browser
 * crops it to each spot. Straight from the site on a developer's machine.
 */
const whole = (p: Photo | undefined, id: string, width: number, local: boolean) =>
  local ? photoPath(id) : Email.photo(`photo:${id}`, width, Math.round((width * (p?.h || 1)) / (p?.w || 1)));

const pctOf = (x: number, of: number) => `${((100 * x) / of).toFixed(4)}%`;

interface Props {
  ids: string[];
  byId: Map<string, Photo>;
  /** The saved choice: a layout id, or '' for the one that fits best */
  chosen: string;
  setChosen: (id: string) => void;
  setOrder: (ids: string[]) => void;
  move: (k: number, by: number) => void;
  local: boolean;
}

/**
 * The story's collage as the email will draw it, and the other layouts for that many photos beside it,
 * each drawn with her own photos so she can see which suits them. The one that keeps the most of her
 * photos is marked "Best fit"; nothing picked means that one.
 */
export function CollageLayouts({ ids, byId, chosen, setChosen, setOrder, move, local }: Props) {
  const n = ids.length;
  const ratios = ids.map((id) => ratioOf(byId.get(id)));
  const current = layoutFor(chosen, ratios);
  const best = bestFit(ratios);
  const list = LAYOUTS[n] ?? [];
  const box = useRef<HTMLOListElement>(null);
  useFlip(box, ids);
  // The photo she tapped, by id so it stays picked as it moves
  const [picked, setPicked] = useState<string | null>(null);
  if (!current) return null;
  const at = picked ? ids.indexOf(picked) : -1;

  // Moving her photos to the spots that suit their shapes, offered only when it keeps a good deal more
  const fitted = fitPhotos(current, ids, (id) => ratioOf(byId.get(id)));
  const gain = Math.round(100 * (fitted.fit - fitOf(current, ratios)));
  const H = heightAt(current.tree);
  const cells = place(current.tree);

  return (
    <div class="em-layouts">
      <ol class="em-bento" ref={box} style={{ aspectRatio: `600 / ${H.toFixed(3)}` }} aria-label={`The collage: ${current.name}`}>
        {ids.map((id, k) => {
          const c = cells[k];
          const p = byId.get(id);
          return (
            <li
              data-flip={id}
              key={id}
              class="em-bento-cell"
              style={{ left: pctOf(c.x, 600), top: pctOf(c.y, H), width: pctOf(c.w, 600), height: pctOf(c.h, H) }}
            >
              <button
                type="button"
                class="em-bento-photo"
                aria-pressed={picked === id}
                aria-label={`${cellWords(current.tree, k)}${p?.alt ? `: ${p.alt}` : ''}`}
                onClick={() => setPicked(picked === id ? null : id)}
              >
                <img src={whole(p, id, 640, local)} alt="" />
                <span class="em-collage-n">{k + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {n > 1 && (
        <div class="em-bento-bar" aria-live="polite">
          {at >= 0 ? (
            <>
              <span class="em-bento-which">Photo {at + 1}</span>
              <button type="button" class="btn" disabled={at === 0} onClick={() => move(at, -1)}>
                ← Earlier
              </button>
              <button type="button" class="btn" disabled={at === n - 1} onClick={() => move(at, 1)}>
                Later →
              </button>
              <button type="button" class="btn btn-ghost" onClick={() => setPicked(null)}>
                Done
              </button>
            </>
          ) : (
            <span class="em-hint">Tap a photo to move it.</span>
          )}
        </div>
      )}
      {gain >= 3 && (
        <p class="em-fit">
          <span>Some photos are cropped more than they need to be.</span>
          <button type="button" class="btn" onClick={() => setOrder(fitted.items)}>
            Move them to fit
          </button>
        </p>
      )}

      {list.length > 1 && (
        <div class="em-layout-pick" role="radiogroup" aria-label={`Layouts for ${n} photos`}>
          {list.map((l) => {
            const on = l.id === current.id;
            // Drawn small with 2px gutters, sized to fit an 88 by 72 box whatever its height
            const h = heightAt(l.tree, 600, 4);
            const scale = Math.min(88 / 600, 72 / h);
            const w = 600 * scale;
            const mini = place(l.tree, w, 2);
            const mh = heightAt(l.tree, w, 2);
            const keeps = Math.round(100 * fitOf(l, ratios));
            return (
              <label class={`em-layout${on ? ' is-on' : ''}`} key={l.id}>
                <input type="radio" name="em-layout" class="visually-hidden" checked={on} onChange={() => setChosen(l.id)} />
                <span class="em-layout-frame" aria-hidden="true">
                  <span class="em-layout-mini" style={{ width: `${w.toFixed(2)}px`, height: `${mh.toFixed(2)}px` }}>
                    {mini.map((c, k) => (
                      <img
                        key={k}
                        src={whole(byId.get(ids[k]), ids[k], 160, local)}
                        alt=""
                        loading="lazy"
                        style={{ left: `${c.x.toFixed(2)}px`, top: `${c.y.toFixed(2)}px`, width: `${c.w.toFixed(2)}px`, height: `${c.h.toFixed(2)}px` }}
                      />
                    ))}
                  </span>
                </span>
                <span class="em-layout-name">{l.name}</span>
                {l.id === best.id && <span class="em-layout-best">Best fit</span>}
                <span class="visually-hidden">{`, keeps ${keeps}% of your photos`}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
