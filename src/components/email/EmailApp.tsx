/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FIRST_SCREEN, SITE } from '@/lib/sunny-side/email.mjs';
import { checkEvent, cleanEvent, sortedDates, toBriefEvent } from '@/lib/sunny-side/events.mjs';
import { check, draftSale, sendDays, sendLabel, summary } from '@/lib/sunny-side/special.mjs';
import { kitProblems, pageEmail } from '@/lib/sunny-side/page-email.mjs';
import { blankParts, checkParts, linesOf } from '@/lib/sunny-side/parts.mjs';
import { PICKS, checkWall } from '@/lib/sunny-side/wall.mjs';
import { Charity } from './Charity';
import { type Draft, Events } from './Events';
import {
  type AppProps,
  type Catalog,
  type EventRecord,
  type KitSend,
  type Parts,
  type Photo,
  type Product,
  type SaleForm,
  type StoreEvent,
  type Wall,
  type WeekTab,
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
import { type Fit, type Focus, Preview } from './Preview';
import { Products } from './Products';
import { Sale } from './Sale';
import { Send } from './Send';
import { Story } from './Story';
import { Subject } from './Subject';

const blankWall = (): Wall => ({ label: '', headline: '', picks: [], arranged: 'auto' });
/** The order errors are listed in: the page's order, top to bottom. */
const ORDER = ['kind', 'headline', 'tiers', 'percent', 'what', 'ends', 'cta', 'link', 'label', 'details', 'picks', 'wall', 'photos', 'story', 'mission', 'subject', 'preheader'];

/** An event as the preview draws it while it's still being typed: what's missing is filled in or left out. */
function draftEvent(ev: StoreEvent): StoreEvent | null {
  if (!ev.start || !ev.end || ev.end <= ev.start) return null;
  const dates = ev.dates.filter((d) => d.date).map((d) => ({ ...d, what: d.what || 'What’s on' }));
  if (!dates.length) return null;
  return { ...ev, id: ev.id || 'new-event', title: ev.title || 'Your event', when: ev.when || 'What’s on', dates };
}

/** A week tab's line: where its email stands in Kit, else what's set. */
function weekState(w: WeekTab) {
  if (w.kitAt) return Date.parse(w.kitAt) <= Date.now() ? 'Sent' : `Scheduled ${tabWhen.format(new Date(w.kitAt))}`;
  return w.sale || w.products ? [w.sale ? 'Sale' : '', w.products ? `${w.products} products` : ''].filter(Boolean).join(' · ') : 'Not started';
}

/** "YYYY-MM-DD" in the store's time zone. */
const easternDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
const tabWhen = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function EmailApp(props: AppProps) {
  const { send, label, today, others } = props;
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
  const [tabs, setTabs] = useState(props.weeks);
  // ── The shop's products and the store's events ──
  const [catalog, setCatalog] = useState<Map<string, Product> | null>(null);
  const [collections, setCollections] = useState<Catalog['collections']>([]);
  const [catalogProblem, setCatalogProblem] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>(props.events);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fit, setFit] = useState<{ small: Fit | null; phone: Fit | null }>({ small: null, phone: null });
  const [focus, setFocus] = useState<Focus>('offer');
  /** The part of the email Staci is working on, from where her focus or tap is. */
  const follow = (e: Event) => {
    const section = (e.target as HTMLElement).closest('.em-section')?.id;
    const part: Focus | null =
      ({ 'em-sale': 'offer', 'em-products': 'wall', 'em-photos': 'photos', 'em-story': 'story', 'em-events': 'events', 'em-charity': 'mission', 'em-lines': 'offer', 'em-send': 'offer' } as Record<string, Focus>)[section ?? ''] ?? null;
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
  const partsErrors = useMemo(() => checkParts(parts, { sale: saleOk ? sale : null, photos: photosById, kids: props.kids }), [parts, saleOk, sale, photosById]);

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
    () => pageEmail({ sale, wall, parts, photos: photosById, kids: props.kids, catalog, events: shownEvents, impact: props.impact, send: day, site: SITE }),
    [sale, wall, parts, photosById, catalog, shownEvents, day],
  );

  const fold = fit.small && fit.phone ? Math.max(fit.small.buttonAt, fit.phone.buttonAt) : null;
  const spill = Boolean(fit.small?.spill || fit.phone?.spill);
  const longNames = useMemo(() => new Set([...(fit.small?.longNames ?? []), ...(fit.phone?.longNames ?? [])]), [fit]);
  const layoutProblem =
    fold !== null && fold > FIRST_SCREEN
      ? `On a phone the sale button lands ${fold - FIRST_SCREEN} px below the first screen. Shorten the headline${form.kind === 'tiers' ? ' or use fewer tiers' : ''}.`
      : spill
        ? 'Something is too wide for a small phone. Shorten the longest words.'
        : longNames.size
          ? `${longNames.size === 1 ? 'A product name runs' : `${longNames.size} product names run`} past two lines on a small phone. Give ${longNames.size === 1 ? 'it' : 'them'} a shorter name.`
          : null;

  // ── Saving ──
  const errors = { ...saleErrors, ...wallErrors, ...partsErrors };
  const errorList = Object.entries(errors).sort(([a], [b]) => ORDER.indexOf(a.split('.')[0]) - ORDER.indexOf(b.split('.')[0]));
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
    setTabs((t) => t.map((w) => (w.send === send ? { ...w, sale: form.kind ? summary(special) : '', products: wall.picks.length } : w)));
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
    setTabs((t) => t.map((w) => (w.send === send ? { ...w, sale: '', products: 0 } : w)));
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

  const startFrom = (other: string) => {
    const o = others.find((x) => x.send === other);
    if (!o) return;
    set({ ...saleFormOf(o.special), ends: '' });
    setTouched({});
    setAttempted(false);
    toast(`Copied the ${o.label} special. Set its last day, then save.`);
  };

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

  // The phone's "See the preview" button steps aside once the preview itself is on screen
  const [seesPreview, setSeesPreview] = useState(false);
  useEffect(() => {
    const preview = document.getElementById('em-preview');
    if (!preview || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(([entry]) => setSeesPreview(entry.isIntersecting), { rootMargin: '0px 0px -25% 0px' });
    watch.observe(preview);
    return () => watch.disconnect();
  }, []);

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
    catalog,
    send: day,
    check,
    checkWall,
    checkParts,
    sale: savedSpecial && !Object.keys(check(savedSpecial, day)).length ? draftSale(savedSpecial) : null,
  });
  // Unsaved changes are saved first, so what counts is what's on the page once it saves
  const kitTodo = dirty
    ? kitProblems({ special: form.kind ? special : null, wall: wall.picks.length ? wall : null, parts, photos: photosById, kids: props.kids, catalog, send: day, check, checkWall, checkParts, sale: saleOk ? sale : null })
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
  const plainLine = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, '’');
  const inbox = { subject: plainLine(lines.subject), preheader: plainLine(lines.preheader) };
  const storyState = story.headline && story.body ? { state: story.photos.length ? `Ready · ${story.photos.length} photo${story.photos.length === 1 ? '' : 's'}` : 'Ready, no photos', tone: 'ok' as const } : { state: 'Not written', tone: 'todo' as const };
  const checks = [
    { ok: fold === null ? null : fold <= FIRST_SCREEN, text: fold === null ? 'Checking the fit…' : fold <= FIRST_SCREEN ? `The sale button is on a phone’s first screen (${fold} of ${FIRST_SCREEN} px).` : `The sale button lands ${fold - FIRST_SCREEN} px below a phone’s first screen.` },
    { ok: fold === null ? null : !spill, text: spill ? 'Something is too wide for a small phone.' : 'Everything fits a small phone (320 px).' },
    ...(wallReady && fold !== null ? [{ ok: !longNames.size, text: longNames.size ? `${longNames.size} product name${longNames.size === 1 ? '' : 's'} run past two lines.` : 'Every product name fits two lines.' }] : []),
    ...(!wallReady ? [{ ok: null, text: n ? `Pick ${Math.max(PICKS[0] - n, 0) || 'no more than 9'} more to see the products here.` : `The products show here once ${PICKS[0]} are picked.` }] : []),
  ];

  return (
    <div class={`em${dirty ? ' is-dirty' : ''}${seesPreview ? ' sees-preview' : ''}`}>
      <div class="em-bar">
        <div class="em-bar-title">
          <h1>Weekly email</h1>
          <nav class="em-weeks" aria-label="Which email">
            {tabs.map((w) => (
              <a class="em-week" href={`/admin/email/?send=${w.send}`} aria-current={w.send === send ? 'page' : undefined}>
                <span class="em-week-day">{w.label}</span>
                <span class="em-week-state">{weekState(w.send === send ? { ...w, kitAt: kitSend?.sendAt ?? null } : w)}</span>
              </a>
            ))}
          </nav>
        </div>
        <div class="em-bar-save">
          <span class="em-status" aria-live="polite">
            {locked
              ? kitSend?.status === 'completed'
                ? 'Sent'
                : 'Scheduled: cancel the send to change it'
              : dirty
                ? 'Unsaved changes'
                : version
                  ? `Saved ${at.format(new Date(version.updatedAt))} by ${who(version.updatedBy)}`
                  : 'Nothing saved yet'}
          </span>
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
        <div class="em-edit" onFocusCapture={follow} onPointerDown={follow}>
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
                {layoutProblem && <li>{layoutProblem}</li>}
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

          <Section n={1} id="em-sale" locked={locked} title="The sale" state={saleState.state} tone={saleState.tone}>
            <Sale form={form} special={special} errors={saleErrors} shown={shownSale} set={set} touch={touch} others={others} startFrom={startFrom} />
          </Section>

          <Section n={2} id="em-products" locked={locked} title="The products" state={wallState.state} tone={wallState.tone}>
            <Products wall={wall} setWall={setWall} catalog={catalog} collections={collections} catalogProblem={catalogProblem} shown={shownWall} longNames={longNames} today={today} />
          </Section>

          <Section n={3} id="em-photos" locked={locked} title="Photos" state={`${parts.hero ? 'Top photo set' : 'Store’s wide shot'} · ${story.photos.length} in the story`} tone={partsErrors.photos || partsErrors['story.photos'] ? 'bad' : 'ok'}>
            <Photos photos={photos} setPhotos={setPhotos} parts={parts} setParts={setParts} error={partsErrors.photos || partsErrors['story.photos']} local={props.local} />
          </Section>

          <Section n={4} id="em-story" locked={locked} title="The story" state={storyState.state} tone={storyState.tone}>
            <Story parts={parts} setParts={setParts} shown={shownParts} />
          </Section>

          <Section n={5} id="em-events" locked={locked} title="Events" state={inEmail ? `${inEmail} in this email` : 'None'} tone={inEmail ? 'ok' : 'todo'}>
            <Events events={events} setEvents={setEvents} draft={draft} setDraft={setDraft} sendDate={day} sendLabel={sendLabel(day)} today={today} />
          </Section>

          <Section n={6} id="em-charity" locked={locked} title="The charity" state={charityState.state} tone={charityState.tone}>
            <Charity parts={parts} setParts={setParts} kids={props.kids} error={partsErrors.kid} />
          </Section>

          <Section n={7} id="em-lines" locked={locked} title="Subject line" state={parts.subject ? 'Written' : 'Not written'} tone={partsErrors.subject || partsErrors.preheader ? 'bad' : parts.subject ? 'ok' : 'todo'}>
            <Subject parts={parts} setParts={setParts} sale={saleOk ? sale : null} shown={shownParts} />
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

        <div class="em-side" id="em-preview">
          <Preview focus={focus} brief={brief} sections={sections} problem={null} checks={checks} onFit={setFit} />
        </div>
      </div>
      <a class="em-jump btn btn-dark" href="#em-preview">
        See the preview
      </a>
    </div>
  );
}
