/** @jsxImportSource preact */
import { photoPath } from '@/lib/sunny-side/addresses.mjs';
import { Email } from '@/lib/sunny-side/email.mjs';
import { LAYOUTS, bestFit, fitOf, fitPhotos, heightAt, place, ratioOf } from '@/lib/sunny-side/collage-layouts.mjs';
import { objectPosition } from './FocusPicker';
import type { Photo } from './model';

/**
 * A photo for the page, uncropped (its own shape), so one copy serves every layout and the browser
 * crops it to each spot. Straight from the site on a developer's machine.
 */
export const whole = (p: Photo | undefined, id: string, width: number, local: boolean) => (local ? photoPath(id) : Email.photo(`photo:${id}`, width, Math.round((width * (p?.h || 1)) / (p?.w || 1))));

type Layout = { id: string; name: string; tree: unknown };

interface Props {
  ids: string[];
  byId: Map<string, Photo>;
  /** The layout the collage is drawn in now. */
  current: Layout;
  setChosen: (id: string) => void;
  /** Her photos moved to the spots that keep the most of them. */
  fit: (ids: string[]) => void;
  local: boolean;
}

/**
 * The other layouts for this many photos, each drawn with her own photos so she can see which suits
 * them, the way Instagram's Layout app showed its layouts; the one that keeps the most of her photos is
 * marked "Best fit". Above them, when moving her photos to other spots in this layout keeps a good deal
 * more of them, the offer to. The collage itself, which she arranges by hand, is drawn by Photos.tsx.
 */
export function LayoutChoices({ ids, byId, current, setChosen, fit, local }: Props) {
  const n = ids.length;
  const ratios = ids.map((id) => ratioOf(byId.get(id)));
  const best = bestFit(ratios);
  const list = LAYOUTS[n] ?? [];
  // Moving her photos to the spots that suit their shapes, offered only when it keeps a good deal more
  const fitted = fitPhotos(current, ids, (id) => ratioOf(byId.get(id)));
  const gain = Math.round(100 * (fitted.fit - fitOf(current, ratios)));

  return (
    <>
      {gain >= 3 && (
        <p class="em-fit">
          <span>Some photos are cropped more than they need to be.</span>
          <button type="button" class="btn" onClick={() => fit(fitted.items)}>
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
                        style={{ left: `${c.x.toFixed(2)}px`, top: `${c.y.toFixed(2)}px`, width: `${c.w.toFixed(2)}px`, height: `${c.h.toFixed(2)}px`, objectPosition: objectPosition(byId.get(ids[k])?.focus ?? '') }}
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
    </>
  );
}
