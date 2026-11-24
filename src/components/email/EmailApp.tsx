/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FIRST_SCREEN, SITE, plain } from '@/lib/sunny-side/email.mjs';
import { checkEvent, cleanEvent, sortedDates, toBriefEvent } from '@/lib/sunny-side/events.mjs';
import { check, draftSale, sendDays, sendLabel } from '@/lib/sunny-side/special.mjs';
import { kitProblems, pageEmail, pagePlace, sectionOf } from '@/lib/sunny-side/page-email.mjs';
import { blankParts, checkParts, linesOf } from '@/lib/sunny-side/parts.mjs';
import { PICKS, checkWall } from '@/lib/sunny-side/wall.mjs';
import { layoutFor, ratioOf } from '@/lib/sunny-side/collage-layouts.mjs';
import { Charity } from './Charity';
import { type Draft, Events } from './Events';
import {
  type AppProps,
  type Catalog,
  type EventRecord,
  type KitSend,
  type LayoutReport,
  type Parts,
  type Photo,
  type Product,
  type SaleForm,
  type StoreEvent,
  type Wall,
  at,
  fieldId,
  partsSnapshot,
  saleFormOf,
  saleSnapshot,
  send as call,
  specialOf,
  toast,
  wallSnapshot,
  who,
} from './model';
import { Section } from './parts';
import { Photos } from './Photos';
import { type Fits, type Focus, type Spill, Preview } from './Preview';
import { Products } from './Products';
import { Sale } from './Sale';
import { Send } from './Send';
import { RevealPick } from './Story';
import { Subject } from './Subject';

const blankWall = (): Wall => ({ label: '', headline: '', picks: [], arranged: 'auto' });

/** An event as the preview draws it while it's still being typed: what's missing is filled in or left out. */
function draftEvent(ev: StoreEvent): StoreEvent | null {
  if (!ev.start || !ev.end || ev.end <= ev.start) return null;
  const dates = ev.dates.filter((d) => d.date).map((d) => ({ ...d, what: d.what || 'What’s on' }));
  if (!dates.length) return null;
  return { ...ev, id: ev.id || 'new-event', title: ev.title || 'Your event', when: ev.when || 'What’s on', dates };
}

/**
 * Where too-wide words are, in the page's words, and what to do: always what and where, never
 * "something". Only what can be fixed here: a word in the email's own layout is code, so it's
 * reported to the owner (layout.ts) and never shown to whoever is setting up the email.
 */
type Fixable = Exclude<Spill['part'], 'layout'>;
const SPILL_WHERE: Record<Fixable, [string, string]> = {
  offer: ['the sale', 'Shorten it.'],
  wall: ['a product’s name', 'Give it a shorter name on its tile.'],
  story: ['the photos', 'Shorten it, or break it with a space.'],
  photos: ['the photos', 'Shorten it, or break it with a space.'],
  reveal: ['the reveal', 'Those words come from the charity’s site: pick another reveal, or fix them there.'],
  events: ['the events', 'Shorten it in the event.'],
  mission: ['the charity section', 'Those words come from the charity’s site: pick another family, or fix them there.'],
};
/** Each measuring frame's phone width (Preview: the smallest phone, a phone, the smallest phone bare). */
const FRAME_WIDTH = { small: 320, phone: 390, bare: 320 } as const;
type Frame = keyof typeof FRAME_WIDTH;
/**
 * The phone a spill was found on, by the frame that measured it. The bare frame is the email with its
 * styles dropped, which the preview doesn't show, so it says where that happens: otherwise she'd be
 * told a word is too wide while the preview shows it fitting.
 */
const SPILL_ON: Record<Frame, string> = {
  small: 'a small phone (320 px)',
  phone: 'a phone (390 px)',
  bare: 'a small phone (320 px) in some mail apps, like the Gmail app with a Yahoo or iCloud address',
};
const spillMessage = (s: Spill & { part: Fixable; frame: Frame }) =>
  `“${s.word}” in ${SPILL_WHERE[s.part][0]} is ${s.over} px too wide for ${SPILL_ON[s.frame]}. ${SPILL_WHERE[s.part][1]}`;
/** How many times a layout report that didn't go through is sent again, and how far apart. */
const REPORT_TRIES = 3;
const REPORT_RETRY_MS = 20_000;

/** "YYYY-MM-DD" in the store's time zone. */
const easternDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

export default function EmailApp(props: AppProps) {
  const { send, label, today, presets } = props;
  // ── The week: sale and products, saved together ──
  const [form, setForm] = useState<SaleForm>(() => saleFormOf(props.record?.special ?? null));
  const [wall, setWallState] = useState<Wall>(() => props.record?.wall ?? blankWall());
  const [parts, setPartsState] = useState<Parts>(props.parts);
  const [photos, setPhotos] = useState<Photo[]>(props.photos);
  const [kitSend, setKitSend] = useState<KitSend | null>(props.kitSend);
  const [tests, setTests] = useState(props.tests);
  // Scheduled (or gone): the email can't change until the send is cancelled
  const locked = Boolean(kitSend);
  // The day it goes: any day of its week from today on (sendDays), its Tuesday unless that's
  // passed; once scheduled, Kit's day. The sale's end, the events and the date in the email go by it.
  const days = useMemo(() => sendDays(send).filter((d: string) => d >= today), [send, today]);
  const [pickedDay, setDay] = useState(send >= today ? send : today);
  const day = kitSend ? easternDay(kitSend.sendAt) : pickedDay;
  const [version, setVersion] = useState(props.record ? { updatedAt: props.record.updatedAt, updatedBy: props.record.updatedBy } : null);
  // The week as last saved, to tell changes from it and to go back to it
  const [saved, setSaved] = useState(() => ({ form: saleFormOf(props.record?.special ?? null), wall: props.record?.wall ?? blankWall(), parts: props.parts }));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // ── The shop's products and the store's events ──
  const [catalog, setCatalog] = useState<Map<string, Product> | null>(null);
  const [collections, setCollections] = useState<Catalog['collections']>([]);
  const [catalogProblem, setCatalogProblem] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>(props.events);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fit, setFit] = useState<Fits>({ small: null, phone: null, bare: null });
  // The owner's view of problems in the email's own layout: those reported from this page before (layout-store.mjs)
  const [layoutReports, setLayoutReports] = useState(props.layoutReports);
  const reported = useRef(new Set<string>());
  // Times each word's report didn't go through, and a tick that sends the ones still waiting again
  const tries = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const [focus, setFocus] = useState<Focus>('offer');
  /** The part of the email Staci is working on, from where her focus or tap is. */
  const follow = (e: Event) => {
    const target = e.target as HTMLElement;
    const section = target.closest('.em-section')?.id;
    // Picking the top photo shows the top of the email, where it goes ("offer" is the top: the
    // preview has no mark for the masthead); the rest of Photos is the collage
    const topPhoto = section === 'em-photos' && Boolean(target.closest('label')?.querySelector('input[name="em-hero"]'));
    const part: Focus | null = topPhoto
      ? 'offer'
      : (({ 'em-sale': 'offer', 'em-products': 'wall', 'em-photos': 'photos', 'em-reveal': 'reveal', 'em-events': 'events', 'em-charity': 'mission', 'em-lines': 'offer', 'em-send': 'offer' } as Record<string, Focus>)[section ?? ''] ?? null);
    if (part && part !== focus) setFocus(part);
  };

  useEffect(() => {
    fetch('/shop/catalog.json', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : Promise.reject(new Error(`it answered ${r.status}`))))
      .then((c: Catalog) => {
        setCatalog(new Map(c.products.map((p) => [p.handle, p])));
        setCollections(c.collections);
      })
      .catch((err: Error) => setCatalogProblem(`The shop’s products didn’t load (${err.message}). Reload the page to try again.`));
  }, []);

  const special = useMemo(() => specialOf(form), [form]);
  const saleErrors = useMemo(() => (form.kind ? check(special, day) : {}), [special, form.kind, day]);
  const wallErrors = useMemo(() => (wall.picks.length ? checkWall(wall, { catalog: catalog ?? undefined, send: day }) : {}), [wall, catalog, day]);
  const dirtySale = saleSnapshot(form) !== saleSnapshot(saved.form);
  const dirtyWall = wallSnapshot(wall) !== wallSnapshot(saved.wall);
  const dirtyParts = partsSnapshot(parts) !== partsSnapshot(saved.parts);
  const dirty = dirtySale || dirtyWall || dirtyParts;
  const photosById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const saleOk = Boolean(form.kind) && !Object.keys(saleErrors).length;
  const sale = useMemo(() => draftSale(form.kind ? special : { ...special, kind: 'tiers' }), [special, form.kind]);
  const partsErrors = useMemo(() => checkParts(parts, { sale: saleOk ? sale : null, photos: photosById, kids: props.kids, reveals: props.reveals }), [parts, saleOk, sale, photosById]);

  const set = (patch: Partial<SaleForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };
  const setWall = (w: Wall) => {
    setWallState(w);
    setProblem(null);
  };
  /** Changes the parts from what they are now, so an upload that finishes while she types can't undo her typing. */
  const setParts = (change: (p: Parts) => Parts) => {
    setPartsState(change);
    setProblem(null);
  };
  const shownParts = (key: string) => partsErrors[key];
  const touch = (key: string) => setTouched((t) => ({ ...t, [key]: true }));
  const shownSale = (key: string) => (attempted || touched[key.split('.').slice(0, key.startsWith('tiers.') ? 2 : 1).join('.')] ? saleErrors[key] : undefined);
  // A product's problem shows as soon as it's picked: it's about the store, not about typing
  const shownWall = (key: string) => (key === 'picks' && !attempted ? undefined : wallErrors[key]);

  // ── The preview ──
  const shownEvents = useMemo(() => {
    const list = events.map((r) => (draft?.id === r.event.id ? draft.event : r.event));
    if (draft && draft.id === null) list.push(draft.event);
    return list
      .map((ev) => (Object.keys(checkEvent(cleanEvent(ev))).length ? draftEvent(ev) : cleanEvent(ev)))
      .filter((ev): ev is StoreEvent => Boolean(ev))
      .sort((a, b) => (sortedDates(a)[0]?.date ?? '').localeCompare(sortedDates(b)[0]?.date ?? ''))
      .map((ev) => toBriefEvent(ev, day, SITE))
      .filter(Boolean);
  }, [events, draft, day]);
  const wallReady = Boolean(catalog) && wall.picks.length >= PICKS[0] && wall.picks.length <= PICKS[1];
  // The same email the Kit draft is made from (page-email.mjs), so Kit gets what the page shows
  const { brief, sections } = useMemo(
    () => pageEmail({ sale, wall, parts, photos: photosById, kids: props.kids, reveals: props.reveals, catalog, events: shownEvents, impact: props.impact, hours: props.hours, send: day, site: SITE }),
    [sale, wall, parts, photosById, catalog, shownEvents, day],
  );

  const frames = (['small', 'phone', 'bare'] as const).map((k) => [k, fit[k]] as const);
  const fold = fit.small && fit.phone ? Math.max(...frames.map(([, f]) => f?.buttonAt ?? 0)) : null;
  // What's too wide for a small phone, named, with where to fix it (the 320 px phone first: it's the
  // tightest). Words in the email's own layout aren't hers to fix: they go to the owner instead.
  const spills = frames.flatMap(([k, f]) => (f?.spills ?? []).map((s) => ({ ...s, width: FRAME_WIDTH[k], frame: k })));
  const spillAt = (spills.find((s) => s.part !== 'layout') as (Spill & { part: Fixable; frame: Frame }) | undefined) ?? null;
  const layoutSpills = spills.filter((s) => s.part === 'layout');
  const spill = Boolean(spillAt);
  const spillWords = spillAt ? spillMessage(spillAt) : null;
  const longNames = useMemo(() => new Set(frames.flatMap(([, f]) => f?.longNames ?? [])), [fit]);
  // A layout problem is reported once per word for each page load: the owner sees it on this page, as
  // the server now has it (how often, since when). One that doesn't go through (the connection
  // dropped) is sent again a few times, or the owner would never hear of it from this page.
  useEffect(() => {
    for (const s of layoutSpills) {
      if (reported.current.has(s.word) || (tries.current.get(s.word) ?? 0) >= REPORT_TRIES) continue;
      reported.current.add(s.word);
      void call<{ report?: LayoutReport }>('/api/admin/email/layout/', 'POST', { word: s.word, over: s.over, width: s.width, send }).then((res) => {
        if (res.ok) {
          const saved = res.body.report;
          if (props.owner && saved) setLayoutReports((list) => [saved, ...list.filter((r) => r.word !== saved.word)]);
          return;
        }
        reported.current.delete(s.word);
        const n = (tries.current.get(s.word) ?? 0) + 1;
        tries.current.set(s.word, n);
        if (n < REPORT_TRIES) setTimeout(() => setRetry((t) => t + 1), REPORT_RETRY_MS);
      });
    }
  }, [layoutSpills.map((s) => s.word).join('|'), retry]);
  async function clearLayoutReports() {
    const res = await call('/api/admin/email/layout/', 'DELETE', {});
    if (res.ok) {
      setLayoutReports([]);
      reported.current.clear();
      tries.current.clear();
    } else toast(res.error, 'error');
  }
  const layoutProblem =
    fold !== null && fold > FIRST_SCREEN
      ? `On a phone the sale button lands ${fold - FIRST_SCREEN} px below the first screen.${form.kind === 'tiers' ? ' Use fewer tiers.' : ''}`
      : spillWords
        ? spillWords
        : longNames.size
          ? `${longNames.size === 1 ? 'A product name runs' : `${longNames.size} product names run`} past two lines on a small phone. Give ${longNames.size === 1 ? 'it' : 'them'} a shorter name.`
          : null;

  // The section that fixes it, for the error list's link
  const SECTION: Record<Fixable, string> = { offer: 'em-sale', wall: 'em-products', reveal: 'em-reveal', story: 'em-photos', photos: 'em-photos', events: 'em-events', mission: 'em-charity' };
  const layoutSection = layoutProblem === spillWords && spillAt ? SECTION[spillAt.part] : longNames.size && layoutProblem && !(fold !== null && fold > FIRST_SCREEN) ? 'em-products' : 'em-sale';

  // ── Saving ──
  const errors = { ...saleErrors, ...wallErrors, ...partsErrors };
  // In the page's order, top to bottom (PAGE_SECTIONS)
  const errorList = Object.entries(errors).sort(([a], [b]) => pagePlace(sectionOf(a)) - pagePlace(sectionOf(b)));
  const summaryRef = useRef<HTMLDivElement>(null);

  /** Saves the week. True once it's saved (or there was nothing to save), false when it can't be yet. */
  async function save(): Promise<boolean> {
    if (saving || locked) return false;
    if (!dirty) return true;
    setAttempted(true);
    if (errorList.length || layoutProblem) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
      return false;
    }
    setSaving(true);
    setProblem(null);
    const res = await call<{ updatedAt: string; updatedBy: string }>('/api/admin/email/week/', 'PUT', {
      send,
      special: form.kind ? form : null,
      wall: wall.picks.length ? wall : null,
      parts,
      since: version?.updatedAt ?? null,
    });
    setSaving(false);
    if (!res.ok) {
      setProblem(res.error);
      return false;
    }
    setVersion({ updatedAt: res.body.updatedAt, updatedBy: res.body.updatedBy });
    setSaved({ form, wall, parts });
    toast(`Saved the ${label} email`);
    return true;
  }

  async function clear() {
    if (!version) return;
    setSaving(true);
    const res = await call('/api/admin/email/week/', 'DELETE', { send, since: version.updatedAt });
    setSaving(false);
    if (!res.ok) return setProblem(res.error);
    setVersion(null);
    setForm(saleFormOf(null));
    setWallState(blankWall());
    setPartsState(blankParts() as Parts);
    setSaved({ form: saleFormOf(null), wall: blankWall(), parts: blankParts() as Parts });
    setTouched({});
    setAttempted(false);
    setConfirmClear(false);
    toast(`Cleared the ${label} email`);
  }

  function discard() {
    setForm(saved.form);
    setWallState(saved.wall);
    setPartsState(saved.parts);
    setTouched({});
    setAttempted(false);
    setProblem(null);
  }


  // Leaving with unsaved changes asks first; ⌘S / Ctrl+S saves
  const leaving = dirty || Boolean(draft);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [leaving]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // On a phone or upright iPad the preview is a sheet over the page: Preview opens it at the
  // part she's working on, and "Back to editing" closes it with the page just where she left it (as
  // Shopify's and Canva's phone editors keep editing and preview a tap apart). It was 11 screens down
  // the page, below Send. While it's open the page under it is out of reach, and Escape closes it.
  const [previewing, setPreviewing] = useState(false);
  const jump = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  // Whatever opened the preview gets focus back when it closes: the button, or, if it isn't showing, what had focus
  const opener = useRef<HTMLElement | null>(null);
  const openPreview = () => {
    opener.current = document.activeElement as HTMLElement | null;
    setPreviewing(true);
  };
  const closePreview = () => {
    setPreviewing(false);
    requestAnimationFrame(() => {
      const to = [jump.current, opener.current].find((el) => el?.isConnected && getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).display !== 'none');
      to?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (!previewing) return;
    back.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closePreview();
    // Wide enough for the preview beside the form again (the button isn't drawn there): no sheet
    const wide = () => jump.current && getComputedStyle(jump.current).display === 'none' && setPreviewing(false);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', wide);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', wide);
    };
  }, [previewing]);

  // ── Where each part stands ──
  const saleState = !form.kind ? { state: 'Not set', tone: 'todo' as const } : Object.keys(saleErrors).length ? { state: 'Needs fixing', tone: 'bad' as const } : { state: 'Ready', tone: 'ok' as const };
  const n = wall.picks.length;
  const wallState =
    n === 0
      ? { state: 'None picked', tone: 'todo' as const }
      : Object.keys(wallErrors).length || longNames.size
        ? { state: n < PICKS[0] ? `${n} picked, ${PICKS[0] - n} to go` : 'Needs fixing', tone: n < PICKS[0] ? ('todo' as const) : ('bad' as const) }
        : { state: `${n} picked`, tone: 'ok' as const };
  const inEmail = shownEvents.length;
  const savedSpecial = saved.form.kind ? specialOf(saved.form) : null;
  const toKit = kitProblems({
    special: savedSpecial,
    wall: saved.wall.picks.length ? saved.wall : null,
    parts: saved.parts,
    photos: photosById,
    kids: props.kids,
    reveals: props.reveals,
    catalog,
    send: day,
    check,
    checkWall,
    checkParts,
    sale: savedSpecial && !Object.keys(check(savedSpecial, day)).length ? draftSale(savedSpecial) : null,
  });
  // Unsaved changes are saved first, so what counts is what's on the page once it saves
  const kitTodo = dirty
    ? kitProblems({ special: form.kind ? special : null, wall: wall.picks.length ? wall : null, parts, photos: photosById, kids: props.kids, reveals: props.reveals, catalog, send: day, check, checkWall, checkParts, sale: saleOk ? sale : null })
    : toKit;
  const story = parts.story;
  const kid = props.kids.find((k) => k.slug === parts.kid) ?? props.kids[0];
  const charityState = !props.kids.length
    ? { state: 'Didn’t load', tone: 'bad' as const }
    : { state: parts.kid ? (kid?.name ?? 'Pick a family') : `${props.kids[0].name}, most recent`, tone: (partsErrors.kid ? 'bad' : 'ok') as 'bad' | 'ok' };
  const sendState = kitSend
    ? { state: kitSend.status === 'completed' ? 'Sent' : kitSend.status === 'sending' ? 'Sending' : 'Scheduled', tone: 'ok' as const }
    : kitTodo.length
      ? { state: `${kitTodo.length} to do`, tone: 'todo' as const }
      : { state: 'Ready', tone: 'ok' as const };
  const lines = saleOk ? linesOf(parts, sale) : { subject: parts.subject, preheader: parts.preheader };
  // Exactly what Kit gets (week-email.ts): the same plain text
  const inbox = { subject: plain(lines.subject), preheader: plain(lines.preheader) };
  const reveal = parts.reveal ? props.reveals.find((r) => r.slug === parts.reveal) : null;
  const revealState = parts.reveal
    ? reveal
      ? { state: `${reveal.name}’s reveal · ${reveal.short}`, tone: 'ok' as const }
      : { state: 'Pick again', tone: 'bad' as const }
    : { state: 'None this week', tone: 'ok' as const };
  // ── Folding: a finished section shows as a line to open, the way Mailchimp's campaign checklist
  // shows each finished part; an unfinished one stays open, and one with a problem can't be folded.
  // Whether a section starts open is settled when the page opens, so finishing one never folds it
  // under her fingers. ──
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const startsOpen = useRef<Record<string, boolean>>({});
  const folding = (id: string, tone: 'ok' | 'todo' | 'bad') => {
    if (!(id in startsOpen.current)) startsOpen.current[id] = tone !== 'ok';
    const open = tone === 'bad' || (opened[id] ?? startsOpen.current[id]);
    return { open, onToggle: tone === 'bad' && open ? undefined : () => setOpened((o) => ({ ...o, [id]: !open })) };
  };
  // A link to a part of a folded section (the list of what to fix, Send's list of what's left, the
  // Today page) opens it first, then goes there
  useEffect(() => {
    const unfold = (el: Element | null) => {
      const section = el?.closest<HTMLElement>('.em-section');
      if (!section?.classList.contains('is-folded')) return false;
      setOpened((o) => ({ ...o, [section.id]: true }));
      return true;
    };
    const go = (el: HTMLElement) =>
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'start' });
        el.focus?.({ preventScroll: true });
      });
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (!a) return;
      const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
      const el = document.getElementById(id);
      if (!el || !unfold(el)) return;
      e.preventDefault();
      history.replaceState(null, '', `#${id}`);
      go(el);
    };
    document.addEventListener('click', click, true);
    const arrived = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (arrived && unfold(arrived)) go(arrived);
    return () => document.removeEventListener('click', click, true);
  }, []);
  const shortDay = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  const ends = form.ends ? ` · ends ${shortDay(form.ends)}` : '';
  const summaries: Record<string, string> = {
    'em-lines': inbox.subject ? `“${inbox.subject}”` : '',
    'em-sale':
      form.kind === 'percent'
        ? `${special.percent}% off everything${ends}`
        : form.kind === 'tiers'
          ? `Spend more, save more: ${special.tiers.map((t) => `$${(t.spend ?? 0).toLocaleString('en-US')} → ${t.percent}%`).join(', ')}${ends}`
          : form.kind === 'headline'
            ? 'No sale this week'
            : '',
    'em-products': n ? `${n} products, ${wall.arranged === 'auto' ? 'arranged for you' : 'in your order'}` : '',
    'em-reveal': reveal ? `${reveal.name}’s reveal, ${reveal.short}` : 'No reveal this week',
    'em-photos': story.photos.length
      ? `${layoutFor(story.layout, story.photos.map((id) => ratioOf(photosById.get(id)))).name}, ${story.photos.length} photo${story.photos.length === 1 ? '' : 's'}`
      : 'No photos in the collage',
    'em-events': shownEvents.length ? shownEvents.map((e) => e?.title).filter(Boolean).join(', ') : 'No events this week',
    'em-charity': kid ? `${kid.name}, ${parts.kidPhoto ? 'one of their photos' : 'their finished room'}` : '',
  };
  const linesTone: 'ok' | 'todo' | 'bad' = partsErrors.subject || partsErrors.preheader ? 'bad' : parts.subject ? 'ok' : 'todo';
  const photosTone: 'ok' | 'bad' = partsErrors.photos || partsErrors['story.photos'] ? 'bad' : 'ok';
  const eventsTone: 'ok' | 'todo' = inEmail ? 'ok' : 'todo';

  const checks = [
    { ok: fold === null ? null : fold <= FIRST_SCREEN, text: fold === null ? 'Checking the fit…' : fold <= FIRST_SCREEN ? `The sale button is on a phone’s first screen, above the teal marks (${fold} of ${FIRST_SCREEN} px).` : `The sale button lands ${fold - FIRST_SCREEN} px below a phone’s first screen, the teal marks.` },
    // Measured as sent and bare (no style block, no web fonts, as the Gmail app shows it to other accounts).
    // A word in the email's own layout isn't hers, so it never makes this untrue for her: it goes to the owner.
    { ok: fold === null ? null : !spill, text: spillWords ?? (layoutSpills.length ? 'Everything set up here fits a small phone (320 px).' : 'Everything fits a small phone (320 px), even in the Gmail app.') },
    ...(wallReady && fold !== null ? [{ ok: !longNames.size, text: longNames.size ? `${longNames.size} product name${longNames.size === 1 ? '' : 's'} run past two lines.` : 'Every product name fits two lines.' }] : []),
    ...(!wallReady ? [{ ok: null, text: n ? `Pick ${Math.max(PICKS[0] - n, 0) || 'no more than 9'} more to see the products here.` : `The products show here once ${PICKS[0]} are picked.` }] : []),
  ];

  const status = locked
    ? kitSend?.status === 'completed'
      ? 'Sent'
      : 'Scheduled: cancel the send to change it'
    : dirty
      ? 'Unsaved changes'
      : version
        ? `Saved ${at.format(new Date(version.updatedAt))} by ${who(version.updatedBy)}`
        : 'Nothing saved yet';

  return (
    <div class={`em${dirty ? ' is-dirty' : ''}${previewing ? ' is-previewing' : ''}`}>
      <div class="em-bar" {...(previewing ? { inert: true } : {})}>
        <div class="em-bar-title">
          <h1>Weekly email</h1>
          <p class="em-which">
            <span>
              The <strong>{label}</strong> email
            </span>
            <a href="/admin/email/sent/">Sent emails</a>
          </p>
          <p class="em-status-top" aria-hidden="true">
            {status}
          </p>
        </div>
        <div class="em-bar-save">
          <span class="em-status" aria-live="polite">
            {status}
          </span>
          {/* Beside Save, where Kit and Mailchimp keep Preview: in the top bar on an upright iPad, in the
              toolbar at the foot of a phone's screen (email.css). Not drawn once the preview is beside the form. */}
          <button type="button" class="em-jump btn" ref={jump} aria-haspopup="dialog" onClick={openPreview}>
            Preview
          </button>
          {dirty && (
            <button type="button" class="btn" onClick={discard} disabled={saving}>
              Discard
            </button>
          )}
          <button type="button" class="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty || locked}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div class="em-grid">
        <div class="em-edit" onFocusCapture={follow} onPointerDown={follow} {...(previewing ? { inert: true } : {})}>
          {attempted && (errorList.length > 0 || layoutProblem) && (
            <div class="em-summary" role="alert" tabIndex={-1} ref={summaryRef}>
              <p>
                <strong>{errorList.length + (layoutProblem ? 1 : 0) === 1 ? 'One thing needs fixing' : `${errorList.length + (layoutProblem ? 1 : 0)} things need fixing`} before the {label} email can be saved:</strong>
              </p>
              <ul>
                {errorList.map(([key, message]) => (
                  <li>
                    <a href={`#${fieldId(key)}`}>{message}</a>
                  </li>
                ))}
                {layoutProblem && (
                  <li>
                    <a href={`#${layoutSection}`}>{layoutProblem}</a>
                  </li>
                )}
              </ul>
            </div>
          )}
          {problem && (
            <div class="notice" role="alert">
              <div>
                <strong>{problem}</strong>{' '}
                {/reload/i.test(problem) && (
                  <button type="button" class="btn btn-small" onClick={() => location.reload()}>
                    Reload
                  </button>
                )}
              </div>
            </div>
          )}

          {/* In Peter's order (PAGE_SECTIONS in page-email.mjs, 2026-11-17): the subject line, the sale, the
              products, the reveal, the photos, the events and the charity, Send last. No story: it's gone. */}
          <Section n={1} id="em-lines" locked={locked} title="Subject line" state={parts.subject ? 'Written' : 'Not written'} tone={linesTone} summary={summaries['em-lines']} {...folding('em-lines', linesTone)}>
            <Subject parts={parts} setParts={setParts} sale={saleOk ? sale : null} shown={shownParts} />
          </Section>

          <Section n={2} id="em-sale" locked={locked} title="The sale" state={saleState.state} tone={saleState.tone} summary={summaries['em-sale']} {...folding('em-sale', saleState.tone)}>
            <Sale form={form} special={special} errors={saleErrors} shown={shownSale} set={set} touch={touch} presets={presets} />
          </Section>

          <Section n={3} id="em-products" locked={locked} title="The products" state={wallState.state} tone={wallState.tone} summary={summaries['em-products']} {...folding('em-products', wallState.tone)}>
            <Products wall={wall} setWall={setWall} catalog={catalog} collections={collections} catalogProblem={catalogProblem} shown={shownWall} longNames={longNames} today={today} />
          </Section>

          <Section n={4} id="em-reveal" locked={locked} title="The reveal" state={revealState.state} tone={revealState.tone} summary={summaries['em-reveal']} {...folding('em-reveal', revealState.tone)}>
            <RevealPick parts={parts} setParts={setParts} shown={shownParts} reveals={props.reveals} />
          </Section>

          <Section n={5} id="em-photos" locked={locked} title="Photos" state={`${parts.hero ? 'Top photo set' : 'Store’s wide shot'} · ${story.photos.length} in the collage`} tone={photosTone} summary={summaries['em-photos']} {...folding('em-photos', photosTone)}>
            <Photos photos={photos} setPhotos={setPhotos} parts={parts} setParts={setParts} error={partsErrors.photos || partsErrors['story.photos']} local={props.local} />
          </Section>

          <Section n={6} id="em-events" locked={locked} title="Events" state={inEmail ? `${inEmail} in this email` : 'None'} tone={eventsTone} summary={summaries['em-events']} {...folding('em-events', eventsTone)}>
            <Events events={events} setEvents={setEvents} draft={draft} setDraft={setDraft} sendDate={day} sendLabel={sendLabel(day)} today={today} />
          </Section>

          <Section n={7} id="em-charity" locked={locked} title="The charity" state={charityState.state} tone={charityState.tone} summary={summaries['em-charity']} {...folding('em-charity', charityState.tone)}>
            <Charity parts={parts} setParts={setParts} kids={props.kids} error={partsErrors.kid} />
          </Section>

          <Section n={8} id="em-send" title="Send" state={sendState.state} tone={sendState.tone}>
            <Send
              send={send}
              label={label}
              day={day}
              days={days}
              setDay={setDay}
              today={today}
              todo={kitTodo}
              dirty={dirty}
              saving={saving}
              saveFirst={save}
              me={props.test.me}
              people={props.test.people}
              tests={tests}
              onTest={(t) => setTests((r) => [t, ...r].slice(0, 3))}
              kitSend={kitSend}
              setKitSend={setKitSend}
              usualTime={props.usualTime}
              subscribers={props.subscribers}
              subject={inbox.subject}
              preheader={inbox.preheader}
              saleEnds={saleOk && special.ends ? special.ends : null}
              revealStart={reveal?.start ?? null}
            />
          </Section>

          {version && (
            <div class="em-danger">
              {confirmClear ? (
                <span class="em-confirm" role="group" aria-label="Clear this email">
                  Clear the sale and products for {label}?
                  <button type="button" class="btn btn-small" onClick={() => setConfirmClear(false)}>
                    Keep them
                  </button>
                  <button type="button" class="btn btn-small btn-danger" onClick={() => void clear()} disabled={saving}>
                    Clear
                  </button>
                </span>
              ) : (
                <button type="button" class="btn btn-ghost btn-small btn-danger" onClick={() => setConfirmClear(true)}>
                  Clear the {label} email
                </button>
              )}
            </div>
          )}
        </div>

        <div class="em-side" id="em-preview" {...(previewing ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Preview of the email' } : {})}>
          <div class="em-side-bar">
            <button type="button" class="btn em-side-back" ref={back} onClick={closePreview}>
              ← Back to editing
            </button>
          </div>
          {props.owner && layoutReports.length > 0 && (
            <section class="em-owner card" aria-labelledby="em-owner-title">
              <h2 id="em-owner-title">Only you see this: the email’s own layout</h2>
              <ul>
                {layoutReports.map((r) => (
                  <li key={r.word}>
                    “{r.word}” was {r.over} px too wide at {r.width} px, seen by {who(r.seenBy)} on {at.format(new Date(r.lastSeen))}
                    {r.times > 1 ? ` (${r.times} times)` : ''}.
                  </li>
                ))}
              </ul>
              <p class="em-hint">Nothing typed on this page fixes it, so no one else is shown it. It’s a fix to the email’s code, which verify.mjs checks at every width from 320 to 700 px on every pull request.</p>
              <button type="button" class="btn btn-small" onClick={() => void clearLayoutReports()}>
                Clear, it’s fixed
              </button>
            </section>
          )}
          <Preview focus={focus} brief={brief} sections={sections} problem={null} checks={checks} onFit={setFit} />
        </div>
      </div>
    </div>
  );
}
