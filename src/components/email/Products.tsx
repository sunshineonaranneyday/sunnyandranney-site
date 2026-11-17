/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NEW_DAYS, NO_PHOTO_WHY, SHOWS, SORTS, haystack, matches, needsShortName, unpickable } from '@/lib/sunny-side/catalog.mjs';
import { NAME_MAX } from '@/lib/sunny-side/product.mjs';
import { PICKS, ROWS, WALL_DEFAULTS, WALL_LIMITS, arrange, tileNames } from '@/lib/sunny-side/wall.mjs';
import { type Catalog, type Pick, type Product, type Wall, fieldId, thumb, usd } from './model';
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

/** The picks in the order given, laid out by the order the email shows them in. */
const moveTo = (picks: Pick[], from: number, to: number) => {
  const next = [...picks];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

export function Products({ wall, setWall, catalog, collections, catalogProblem, shown, longNames, today }: Props) {
  const [picking, setPicking] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const picks = wall.picks;
  const n = picks.length;
  // What each tile says: hers, else the store's, else shortened for her, never two alike (wall.mjs)
  const names = tileNames(picks, catalog ?? undefined);
  const rows = ROWS[n as keyof typeof ROWS] as number[] | undefined;

  /** Changes the picks; while the wall is arranged for her, it's arranged again. */
  const change = (next: Pick[], arranged: Wall['arranged'] = wall.arranged) =>
    setWall({ ...wall, picks: arranged === 'auto' && catalog ? (arrange(next, catalog) as Pick[]) : next, arranged });
  const toggle = (p: Product) => {
    const k = picks.findIndex((x) => x.handle === p.handle);
    if (k >= 0) return change(picks.filter((_, i) => i !== k));
    if (n >= PICKS[1]) return;
    // No name stored: every tile's name is worked out from all the picks together (tileNames), shortened for her
    change([...picks, { handle: p.handle, photo: p.photos[0].url, name: '' }]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= n || from === to) return;
    setWall({ ...wall, picks: moveTo(picks, from, to), arranged: 'hand' });
  };
  const setPick = (k: number, patch: Partial<Pick>) => setWall({ ...wall, picks: picks.map((p, i) => (i === k ? { ...p, ...patch } : p)) });

  // ── Dragging a tile to a new place, by pointer (mouse, finger or pen) ──
  const grid = useRef<HTMLDivElement>(null);
  // Tiles slide to their new places when the order changes (arrows, a drop, or "Arrange for me")
  useFlip(grid, picks.map((p) => p.handle));
  const overAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pick]');
    return el && grid.current?.contains(el) ? Number(el.dataset.pick) : null;
  };
  const startDrag = (e: PointerEvent, k: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: k, over: k });
  };
  const moveDrag = (e: PointerEvent) => drag && setDrag({ ...drag, over: overAt(e.clientX, e.clientY) });
  const endDrag = () => {
    if (drag && drag.over !== null) move(drag.from, drag.over);
    setDrag(null);
  };

  let k = 0;
  const layout = rows ? rows.map((count) => Array.from({ length: count }, () => k++)) : [picks.map((_, i) => i)];

  return (
    <>
      <div class="em-section-tools">
        {n > 1 && catalog && (
          <button type="button" class="btn btn-small" onClick={() => change(picks, 'auto')} disabled={wall.arranged === 'auto'} title="Best sellers first, the widest photo leading, two of a kind never side by side">
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
        <>
          <p class="em-hint em-wall-hint">
            {wall.arranged === 'auto' ? 'Arranged for you: best sellers first, the widest photo leading. ' : 'In your order. '}
            Drag a product, or use its arrows, to move it.
          </p>
          <div class={`em-wall${drag ? ' is-dragging' : ''}`} ref={grid} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
            {layout.map((row) => (
              <div class={`em-wall-row em-wall-row-${rows ? row.length : 'free'}`}>
                {row.map((i) => (
                  <Tile
                    key={picks[i].handle}
                    pick={picks[i]}
                    shownName={names[i]}
                    index={i}
                    count={n}
                    wide={Boolean(rows) && row.length === 1}
                    product={catalog?.get(picks[i].handle)}
                    loading={!catalog && !catalogProblem}
                    error={shown(`picks.${picks[i].handle}`)}
                    longName={longNames.has(picks[i].handle)}
                    dragging={drag?.from === i}
                    target={Boolean(drag) && drag!.over === i && drag!.from !== i}
                    onDragStart={(e) => startDrag(e, i)}
                    onMove={(to) => move(i, to)}
                    onRemove={() => change(picks.filter((_, j) => j !== i))}
                    onPhoto={(photo) => setPick(i, { photo })}
                    onName={(name) => setPick(i, { name })}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
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
  dragging: boolean;
  target: boolean;
  onDragStart: (e: PointerEvent) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onPhoto: (url: string) => void;
  onName: (name: string) => void;
}

/** One product as the email shows it: the photo cropped the email's way, the name and price, and its controls. */
function Tile({ pick, shownName, index, count, wide, product, loading, error, longName, dragging, target, onDragStart, onMove, onRemove, onPhoto, onName }: TileProps) {
  const name = shownName || product?.name || (loading ? 'Loading…' : pick.handle);
  const photos = product?.photos ?? [];
  const at = photos.findIndex((p) => p.url === pick.photo);
  const step = (d: number) => photos.length > 1 && onPhoto(photos[(Math.max(at, 0) + d + photos.length) % photos.length].url);
  const askName = Boolean(pick.name) || (product ? needsShortName(product) : false) || longName;
  const nameId = fieldId(`pick.${pick.handle}.name`);
  return (
    <div class={`em-tile${wide ? ' em-tile-wide' : ''}${dragging ? ' is-dragged' : ''}${target ? ' is-target' : ''}${error ? ' is-bad' : ''}`} data-pick={index} data-flip={pick.handle} id={fieldId(`picks.${pick.handle}`)}>
      <div class="em-tile-photo">
        <img src={thumb(pick.photo, wide ? 600 : 400, wide ? 400 : 400)} alt="" loading="lazy" draggable={false} />
        <button type="button" class="em-tile-grip" aria-label={`Drag ${name} to move it`} onPointerDown={onDragStart}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </button>
        <button type="button" class="em-tile-remove" aria-label={`Take ${name} out`} onClick={onRemove}>
          <X />
        </button>
        {photos.length > 1 && (
          <div class="em-tile-photos">
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
        <div class="em-tile-move">
          <button type="button" class="btn btn-ghost btn-small" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`Move ${name} earlier`}>
            ←<span class="em-wide-only" aria-hidden="true"> Earlier</span>
          </button>
          <span class="em-tile-place">
            {index + 1} of {count}
          </span>
          <button type="button" class="btn btn-ghost btn-small" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label={`Move ${name} later`}>
            <span class="em-wide-only" aria-hidden="true">Later </span>→
          </button>
        </div>
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
