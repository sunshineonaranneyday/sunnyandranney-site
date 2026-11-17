/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NEW_DAYS, NO_PHOTO_WHY, SHOWS, SORTS, haystack, matches, needsShortName, unpickable } from '@/lib/sunny-side/catalog.mjs';
import { NAME_MAX } from '@/lib/sunny-side/product.mjs';
import { PICKS, ROWS, WALL_DEFAULTS, WALL_LIMITS, arrange, tileNames } from '@/lib/sunny-side/wall.mjs';
import { type Catalog, type Pick, type Product, type Wall, fieldId, thumb, usd } from './model';
import { useCollageDrag } from './drag';
import { Counter, FieldError, useFlip } from './parts';
import { X } from './Sale';

type Show = keyof typeof SHOWS;
type Sort = keyof typeof SORTS;

interface Props {
  wall: Wall;
  setWall: (w: Wall) => void;
  catalog: Map<string, Product> | null;
  collections: Catalog['collections'];
  catalogProblem: string | null;
  shown: (key: string) => string | undefined;
  /** Products whose name runs past two lines on a small phone, as the preview measured it. */
  longNames: Set<string>;
  today: string;
}

/** Spot k of n products in words, by the email's rows (ROWS): "spot 1 of 5, the wide one", "spot 4 of 6, row 2, on the right". */
const spotWords = (k: number, n: number) => {
  const rows = ROWS[n as keyof typeof ROWS] as number[] | undefined;
  let start = 0;
  for (const [row, size] of (rows ?? []).entries()) {
    if (k < start + size) {
      const side = size === 1 ? 'the wide one' : `${row === 0 ? 'the top row' : `row ${row + 1}`}, ${k === start ? 'on the left' : k === start + size - 1 ? 'on the right' : 'in the middle'}`;
      return `spot ${k + 1} of ${n}, ${side}`;
    }
    start += size;
  }
  return `spot ${k + 1} of ${n}`;
};
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A product she picked up by tapping it or with the keyboard, waiting to be put down. */
interface Held {
  id: string;
  how: 'tap' | 'key';
  /** Where it would be if put down now (keys move it before it's put down). */
  order: string[];
}

/**
 * The products the email shows, laid out the way the email lays them out, and arranged the same way
 * as the story's collage (drag.ts): drag a product to its spot (press and hold on a phone), or tap it
 * and then its new spot, or use the keys; take one out with its ×; every change says what it did,
 * with Undo.
 */
export function Products({ wall, setWall, catalog, collections, catalogProblem, shown, longNames, today }: Props) {
  const [picking, setPicking] = useState(false);
  const picks = wall.picks;
  const n = picks.length;
  // What each tile says: hers, else the store's, else shortened for her, never two alike (wall.mjs)
  const names = tileNames(picks, catalog ?? undefined);
  const rows = ROWS[n as keyof typeof ROWS] as number[] | undefined;
  const handles = picks.map((p) => p.handle);
  const byHandle = new Map(picks.map((p) => [p.handle, p]));
  const nameOf = (handle: string) => names[handles.indexOf(handle)] || catalog?.get(handle)?.name || handle;

  const [held, setHeld] = useState<Held | null>(null);
  // The last change to the products, which Undo puts back
  const [undo, setUndo] = useState<{ text: string; wall: Wall; at: number } | null>(null);
  // What a screen reader hears as products move
  const [said, setSaid] = useState('');
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(t);
  }, [undo?.at]);

  /** Changes the products, with words for what changed and an Undo. */
  const commit = (next: Wall, text: string) => {
    setUndo({ text, wall, at: Date.now() });
    setWall(next);
    setSaid(text);
  };
  /** Changes the picks; while the wall is arranged for her, it's arranged again. */
  const change = (next: Pick[], arranged: Wall['arranged'] = wall.arranged) => setWall({ ...wall, picks: arranged === 'auto' && catalog ? (arrange(next, catalog) as Pick[]) : next, arranged });
  const toggle = (p: Product) => {
    const k = picks.findIndex((x) => x.handle === p.handle);
    if (k >= 0) return change(picks.filter((_, i) => i !== k));
    if (n >= PICKS[1]) return;
    // No name stored: every tile's name is worked out from all the picks together (tileNames), shortened for her
    change([...picks, { handle: p.handle, photo: p.photos[0].url, name: '' }]);
  };
  /** Her own order: arranged by hand from here on. */
  const reorder = (ids: string[], text: string) => {
    if (ids.join('|') === handles.join('|')) return;
    commit({ ...wall, picks: ids.map((h) => byHandle.get(h)!), arranged: 'hand' }, text);
  };
  const remove = (handle: string, fromKeys = false) => {
    const k = handles.indexOf(handle);
    const rest = picks.filter((p) => p.handle !== handle);
    if (fromKeys) focusAfter.current = rest[Math.min(k, rest.length - 1)]?.handle ?? null;
    setHeld(null);
    commit({ ...wall, picks: wall.arranged === 'auto' && catalog ? (arrange(rest, catalog) as Pick[]) : rest }, `Took ${nameOf(handle)} out of the email. Add it back with “Add or remove products”.`);
  };
  const setPick = (k: number, patch: Partial<Pick>) => setWall({ ...wall, picks: picks.map((p, i) => (i === k ? { ...p, ...patch } : p)) });

  // ── Moving products: dragged (drag.ts), tapped then tapped, or with the keys ──
  const grid = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const noAdd = useRef<HTMLElement>(null);
  const drag = useCollageDrag({ story: handles, list: grid, zone: panel, addZone: noAdd, onLand: (order, l) => reorder(order, `Moved to ${spotWords(l.at, order.length)}.`), disabled: false });
  const view = drag.view;
  // What the wall shows: where a held product would land, else the products as they are
  const order = view?.order ?? (held?.how === 'key' ? held.order : handles);
  // Tiles slide to their new places when the order changes (a drop, the keys, or "Arrange for me")
  useFlip(grid, order);
  // Keyboard focus stays on a product as it moves, and goes to its neighbor when it's taken out
  useLayoutEffect(() => {
    const id = focusAfter.current ?? (held?.how === 'key' ? held.id : null);
    focusAfter.current = null;
    if (!id) return;
    const button = grid.current?.querySelector<HTMLElement>(`[data-pick="${CSS.escape(id)}"]`);
    if (button && document.activeElement !== button) button.focus();
  });

  /** A product tapped or clicked, or Space/Enter pressed on it. */
  const tap = (e: MouseEvent, id: string) => {
    if (drag.justDragged()) return;
    const k = handles.indexOf(id);
    const keys = e.detail === 0;
    if (!held) {
      setHeld({ id, how: keys ? 'key' : 'tap', order: handles });
      setSaid(keys ? `Picked up ${nameOf(id)}, in ${spotWords(k, n)}. The arrow keys move it; Space or Enter puts it down; Escape puts it back.` : `Picked up ${nameOf(id)}. Tap the spot where it goes.`);
      return;
    }
    setHeld(null);
    if (held.id === id) {
      if (held.how === 'key' && held.order.join('|') !== handles.join('|')) reorder(held.order, `Put down in ${spotWords(held.order.indexOf(id), n)}.`);
      else setSaid('Put back.');
      return;
    }
    const next = [...handles];
    next.splice(k, 0, ...next.splice(handles.indexOf(held.id), 1));
    reorder(next, `Moved to ${spotWords(k, n)}.`);
  };
  const keys = (e: KeyboardEvent, id: string) => {
    if (held?.how === 'key' && held.id === id) {
      const k = held.order.indexOf(id);
      const last = held.order.length - 1;
      const to = { ArrowLeft: k - 1, ArrowUp: k - 1, ArrowRight: k + 1, ArrowDown: k + 1, Home: 0, End: last }[e.key];
      if (e.key === 'Escape') {
        e.preventDefault();
        setHeld(null);
        return setSaid('Put back where it was.');
      }
      if (to === undefined) return;
      e.preventDefault();
      const at = Math.max(0, Math.min(last, to));
      if (at === k) return setSaid(at === 0 ? 'It’s already first.' : 'It’s already last.');
      const next = [...held.order];
      next.splice(at, 0, ...next.splice(k, 1));
      setHeld({ ...held, order: next });
      return setSaid(`${cap(spotWords(at, n))}.`);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !held) {
      e.preventDefault();
      remove(id, true);
    } else if (e.key === 'Escape' && held) {
      e.preventDefault();
      setHeld(null);
      setSaid('Cancelled.');
    }
  };
  // Keyboard focus leaving a product held with the keys puts it back, as Escape does
  const leave = (e: FocusEvent) => {
    if (held?.how !== 'key') return;
    const to = e.relatedTarget as HTMLElement | null;
    if (to && to.dataset.pick !== held.id) {
      setHeld(null);
      setSaid('Put back where it was.');
    }
  };
  const stage = held ? held.how : view ? 'drag' : 'rest';

  let k = 0;
  const layout = rows ? rows.map((count) => Array.from({ length: count }, () => k++)) : [order.map((_, i) => i)];

  return (
    <>
      <div class="em-section-tools">
        {n > 1 && catalog && (
          <button
            type="button"
            class="btn btn-small"
            onClick={() => commit({ ...wall, picks: arrange(picks, catalog) as Pick[], arranged: 'auto' }, 'Arranged for you: best sellers first, the widest photo leading.')}
            disabled={wall.arranged === 'auto'}
            title="Best sellers first, the widest photo leading, two of a kind never side by side"
          >
            {wall.arranged === 'auto' ? 'Arranged for you' : 'Arrange for me'}
          </button>
        )}
        <button type="button" class="btn btn-small btn-dark" onClick={() => setPicking(true)} disabled={!catalog}>
          {n ? 'Add or remove products' : 'Pick products'}
        </button>
      </div>

      {catalogProblem && (
        <div class="notice" role="alert">
          <div>{catalogProblem}</div>
        </div>
      )}

      {n === 0 ? (
        <button type="button" class="em-empty" onClick={() => setPicking(true)} disabled={!catalog}>
          <strong>{catalog ? `Pick ${PICKS[0]} to ${PICKS[1]} products from the shop` : catalogProblem ? 'The shop’s products didn’t load' : 'Loading the shop’s products…'}</strong>
          <span>{catalog ? `${[...catalog.values()].filter((p) => !unpickable(p)).length} are in stock. Search, browse by room, or start from the best sellers.` : ''}</span>
        </button>
      ) : (
        <div class={`em-wall-panel is-${stage}`} ref={panel}>
          {/* The wall's one status line, as the collage has: what to do, what a held product will do, or the last change and its Undo */}
          <p class={`em-collage-hint em-wall-line${stage === 'rest' && undo ? ' is-undo' : ''}`}>
            {stage === 'tap' ? (
              <span>Tap the spot where it goes.</span>
            ) : stage === 'key' ? (
              <span>Arrow keys move it. Space or Enter puts it down; Escape puts it back.</span>
            ) : view ? (
              <span>{view.away ? 'Let go here and it goes back.' : 'Let go to put it here.'}</span>
            ) : undo ? (
              <>
                <span>{undo.text}</span>
                <button
                  type="button"
                  class="btn btn-small em-undo-button"
                  onClick={() => {
                    setWall(undo.wall);
                    setUndo(null);
                    setHeld(null);
                    setSaid('Undone.');
                  }}
                >
                  Undo
                </button>
              </>
            ) : (
              <span>
                {wall.arranged === 'auto' ? 'Arranged for you: best sellers first, the widest photo leading. ' : 'In your order. '}
                Drag a product to move it<span class="em-touch-only">: press and hold, then drag</span>. Or tap one, then its new spot.
              </span>
            )}
            {(stage === 'tap' || stage === 'key') && (
              <button
                type="button"
                class="btn btn-small btn-ghost em-collage-cancel"
                onClick={() => {
                  setHeld(null);
                  setSaid('Cancelled.');
                }}
              >
                Cancel
              </button>
            )}
          </p>
          <p class="visually-hidden" id="em-wall-keys">
            Space or Enter picks this product up. The arrow keys then move it, and Space or Enter puts it down; Escape puts it back. Delete takes it out of the email.
          </p>
          <div class={`em-wall${view ? ' is-dragging' : ''}`} ref={grid}>
            {layout.map((row) => (
              <div class={`em-wall-row em-wall-row-${rows ? row.length : 'free'}`}>
                {row.map((i) => {
                  const handle = order[i];
                  const pick = byHandle.get(handle)!;
                  const at = handles.indexOf(handle);
                  return (
                    <Tile
                      key={handle}
                      pick={pick}
                      shownName={names[at]}
                      index={i}
                      count={n}
                      wide={Boolean(rows) && row.length === 1}
                      product={catalog?.get(handle)}
                      loading={!catalog && !catalogProblem}
                      error={shown(`picks.${handle}`)}
                      longName={longNames.has(handle)}
                      state={view?.id === handle ? 'placeholder' : held?.id === handle ? 'held' : held?.how === 'tap' ? 'choice' : ''}
                      onPress={(e) => drag.startPress(e, handle, 'collage')}
                      onTouchMove={drag.touchGuard}
                      onTap={(e) => tap(e, handle)}
                      onKeys={(e) => keys(e, handle)}
                      onLeave={leave}
                      onRemove={() => remove(handle)}
                      onPhoto={(photo) => setPick(at, { photo })}
                      onName={(name) => setPick(at, { name })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p class="visually-hidden" aria-live="assertive" aria-atomic="true">
            {said}
          </p>
        </div>
      )}
      <FieldError id={`${fieldId('picks')}-error`} message={shown('picks')} />

      {n > 0 && (
        <details class="em-extras" open={Boolean(wall.label || wall.headline || shown('headline') || shown('label'))}>
          <summary>
            <span class="em-extras-title">Words over the products</span>
            <span class="em-extras-now">
              {wall.label || WALL_DEFAULTS.label} · {wall.headline || WALL_DEFAULTS.headline}
            </span>
          </summary>
          <div class="em-extras-body field-row">
            <div class="field">
              <label for={fieldId('wall-label')}>
                Small label <Counter value={wall.label} limit={WALL_LIMITS.label} />
              </label>
              <input id={fieldId('wall-label')} value={wall.label} placeholder={WALL_DEFAULTS.label} onInput={(e) => setWall({ ...wall, label: (e.target as HTMLInputElement).value })} />
              <FieldError id={`${fieldId('wall-label')}-error`} message={shown('label')} />
            </div>
            <div class="field">
              <label for={fieldId('wall-headline')}>
                Title <Counter value={wall.headline} limit={WALL_LIMITS.headline} />
              </label>
              <input id={fieldId('wall-headline')} value={wall.headline} placeholder={WALL_DEFAULTS.headline} onInput={(e) => setWall({ ...wall, headline: (e.target as HTMLInputElement).value })} />
              <FieldError id={`${fieldId('wall-headline')}-error`} message={shown('headline')} />
              {!shown('headline') && <p class="em-hint">Say only what’s true of every product: “new” means added in the last {NEW_DAYS} days.</p>}
            </div>
          </div>
        </details>
      )}

      {picking && catalog && <Picker catalog={catalog} collections={collections} picks={picks} toggle={toggle} close={() => setPicking(false)} today={today} />}
    </>
  );
}

interface TileProps {
  pick: Pick;
  /** The name the tile shows (tileNames): hers, the store's, or shortened for her. */
  shownName: string;
  index: number;
  count: number;
  wide: boolean;
  product: Product | undefined;
  loading: boolean;
  error?: string;
  longName: boolean;
  /** Where the held product would land (placeholder), the one picked up (held), or a spot it can go (choice). */
  state: '' | 'placeholder' | 'held' | 'choice';
  onPress: (e: PointerEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTap: (e: MouseEvent) => void;
  onKeys: (e: KeyboardEvent) => void;
  onLeave: (e: FocusEvent) => void;
  onRemove: () => void;
  onPhoto: (url: string) => void;
  onName: (name: string) => void;
}

/** One product as the email shows it: the photo cropped the email's way (dragged or tapped to move it), the name and price, and its controls. */
function Tile({ pick, shownName, index, count, wide, product, loading, error, longName, state, onPress, onTouchMove, onTap, onKeys, onLeave, onRemove, onPhoto, onName }: TileProps) {
  const name = shownName || product?.name || (loading ? 'Loading…' : pick.handle);
  const photos = product?.photos ?? [];
  const at = photos.findIndex((p) => p.url === pick.photo);
  const step = (d: number) => photos.length > 1 && onPhoto(photos[(Math.max(at, 0) + d + photos.length) % photos.length].url);
  const askName = Boolean(pick.name) || (product ? needsShortName(product) : false) || longName;
  const nameId = fieldId(`pick.${pick.handle}.name`);
  return (
    <div class={`em-tile${wide ? ' em-tile-wide' : ''}${state ? ` is-${state}` : ''}${error ? ' is-bad' : ''}`} data-id={pick.handle} data-flip={pick.handle} id={fieldId(`picks.${pick.handle}`)}>
      <div class="em-tile-photo">
        <button
          type="button"
          class="em-tile-pick"
          data-pick={pick.handle}
          aria-label={`${name}, ${spotWords(index, count)}${state === 'held' ? ', picked up' : ''}`}
          aria-describedby="em-wall-keys"
          aria-pressed={state === 'held' || state === 'placeholder' ? 'true' : undefined}
          onPointerDown={onPress}
          onTouchMove={onTouchMove}
          onClick={onTap}
          onKeyDown={onKeys}
          onBlur={onLeave}
        >
          <img src={thumb(pick.photo, wide ? 600 : 400, wide ? 400 : 400)} alt="" loading="lazy" draggable={false} />
          {state === 'choice' && <span class="em-collage-here">Here</span>}
        </button>
        <span class="em-collage-n" aria-hidden="true">
          {index + 1}
        </span>
        {state !== 'placeholder' && (
          <button type="button" class="em-tile-remove" data-nodrag aria-label={`Take ${name} out`} title="Take it out of the email" onClick={onRemove}>
            <X />
          </button>
        )}
        {photos.length > 1 && state !== 'placeholder' && (
          <div class="em-tile-photos" data-nodrag>
            <button type="button" aria-label={`${name}: the photo before`} onClick={() => step(-1)}>
              ‹
            </button>
            <span>
              <span class="em-wide-only">Photo </span>
              {Math.max(at, 0) + 1} of {photos.length}
            </span>
            <button type="button" aria-label={`${name}: the next photo`} onClick={() => step(1)}>
              ›
            </button>
          </div>
        )}
      </div>
      <div class="em-tile-body">
        <p class="em-tile-name">{name}</p>
        <p class="em-tile-meta">
          {product ? usd(product.price) : '…'}
          {product && <span class={product.qty > 2 ? '' : 'em-low'}> · {product.qty > 0 ? `${product.qty} in stock` : 'sold out'}</span>}
        </p>
        {askName && (
          <div class="em-tile-rename">
            <label for={nameId}>
              Name on the tile <Counter value={pick.name} limit={NAME_MAX} />
            </label>
            <input id={nameId} value={pick.name} placeholder={shownName || product?.name} onInput={(e) => onName((e.target as HTMLInputElement).value)} />
            {!pick.name && shownName && shownName !== product?.name && !longName && !error && <p class="em-hint">Shortened for the tile. Type to change it.</p>}
            {longName && !error && <p class="em-error">Runs past two lines on a small phone. Shorten it.</p>}
          </div>
        )}
        {error && <p class="em-error">{error}</p>}
      </div>
    </div>
  );
}

// ── Picking products ───────────────────────────────────────────────────────

interface PickerProps {
  catalog: Map<string, Product>;
  collections: Catalog['collections'];
  picks: Pick[];
  toggle: (p: Product) => void;
  close: () => void;
  today: string;
}

/**
 * The shop's products to browse and search, like Shopify's own product picker: type to search,
 * narrow by room or by what's new, on sale or a staff pick, sort, and tap to add or take out.
 * Sold-out products and ones with no usable photo show only when asked, with the reason.
 */
function Picker({ catalog, collections, picks, toggle, close, today }: PickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [room, setRoom] = useState('');
  const [sort, setSort] = useState<Sort>('best');
  const [all, setAll] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const titles = useMemo(() => Object.fromEntries(collections.map((c) => [c.handle, c.title])), [collections]);
  const products = useMemo(() => [...catalog.values()].map((p) => ({ p, hay: haystack(p, titles) })), [catalog, titles]);
  const picked = new Map(picks.map((p, k) => [p.handle, k + 1]));
  // Sold-out products show only when asked; one in stock without a usable photo shows, with what it needs
  const pool = products.filter(({ p }) => all || p.qty > 0);
  const narrowed = pool.filter(({ p, hay }) => (!room || p.collections.includes(room)) && matches(hay, query));
  const counts = Object.fromEntries((Object.keys(SHOWS) as Show[]).map((s) => [s, narrowed.filter(({ p }) => SHOWS[s].test(p, today)).length]));
  const results = narrowed
    .filter(({ p }) => SHOWS[show].test(p, today))
    .map(({ p }) => p)
    .sort(SORTS[sort].compare);
  const full = picks.length >= PICKS[1];

  // A new search or filter starts from the top of the list
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => body.current?.scrollTo({ top: 0 }), [query, show, room, sort, all]);

  return (
    <dialog
      class="em-picker"
      ref={dialog}
      aria-labelledby="em-picker-title"
      onClose={close}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
    >
      <header class="em-picker-head">
        <div class="em-picker-top">
          <h2 id="em-picker-title">Products for the email</h2>
          <span class={`em-picker-count${picks.length >= PICKS[0] ? ' is-ok' : ''}`} aria-live="polite">
            {picks.length} picked · {PICKS[0]} to {PICKS[1]}
          </span>
          <button type="button" class="btn btn-primary" onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
        <input
          type="search"
          class="em-search"
          placeholder={`Search ${pool.length} ${all ? '' : 'in-stock '}products by name, room or kind`}
          aria-label="Search the products"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          autoFocus
        />
        <div class="em-picker-filters">
          <div class="em-chips" role="group" aria-label="Show">
            {(Object.keys(SHOWS) as Show[]).map((s) => (
              <button type="button" class="em-chip" aria-pressed={show === s} onClick={() => setShow(s)}>
                {SHOWS[s].label} <span class="em-chip-n">{counts[s]}</span>
              </button>
            ))}
          </div>
          <select aria-label="Room" value={room} onChange={(e) => setRoom((e.target as HTMLSelectElement).value)}>
            <option value="">Every room</option>
            {collections.map((c) => (
              <option value={c.handle}>{c.title}</option>
            ))}
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <option value={s}>{SORTS[s].label}</option>
            ))}
          </select>
          <label class="check em-all">
            <input type="checkbox" checked={all} onChange={(e) => setAll((e.target as HTMLInputElement).checked)} /> Show sold out
          </label>
        </div>
        {full && <p class="em-hint em-full">{PICKS[1]} is the most the email shows. Take one out to add another.</p>}
      </header>

      <div class="em-picker-body" ref={body}>
        {results.length === 0 ? (
          <p class="em-none">
            Nothing matches{query ? ` “${query}”` : ''}
            {show !== 'all' ? ` in ${SHOWS[show].label.toLowerCase()}` : ''}
            {room ? ` in ${titles[room]}` : ''}.{' '}
            <button
              type="button"
              class="btn btn-small"
              onClick={() => {
                setQuery('');
                setShow('all');
                setRoom('');
              }}
            >
              Show everything
            </button>
          </p>
        ) : (
          <ul class="em-results">
            {results.map((p) => {
              const why = unpickable(p);
              const at = picked.get(p.handle);
              return (
                <li>
                  <button type="button" class="em-card" aria-pressed={Boolean(at)} disabled={Boolean(why) || (full && !at)} title={why && p.qty > 0 ? NO_PHOTO_WHY : undefined} onClick={() => toggle(p)}>
                    <span class="em-card-photo">
                      {p.photos[0] ? <img src={thumb(p.photos[0].url, 320)} alt="" loading="lazy" /> : <span class="em-card-nophoto">No photo</span>}
                      {at && <span class="em-card-at">{at}</span>}
                    </span>
                    <span class="em-card-name">{p.name}</span>
                    <span class="em-card-meta">
                      {usd(p.price)}
                      {p.was && <s> {usd(p.was)}</s>}
                    </span>
                    <span class={`em-card-stock${why ? ' is-out' : p.qty <= 2 ? ' is-low' : ''}`}>{why || `${p.qty} in stock`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
