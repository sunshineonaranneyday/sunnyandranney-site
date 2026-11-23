/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { day, monthShort, weekday } from '@/lib/sunny-side/email.mjs';
import { EVENT_LIMITS, blankEvent, checkEvent, cleanEvent, eventSummary, isMixed, isWeekly, sortedDates } from '@/lib/sunny-side/events.mjs';
import { type EventRecord, type StoreEvent, at, fieldId, send as call, toast, who } from './model';
import { Counter, FieldError } from './parts';
import { X } from './Sale';

/** The event being edited: which saved one (or a new one), and the version it started from. */
export interface Draft {
  id: string | null;
  event: StoreEvent;
  since: string | null;
}

interface Props {
  events: EventRecord[];
  setEvents: (next: EventRecord[]) => void;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  sendDate: string;
  sendLabel: string;
  today: string;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (iso: string) => {
  const d = day(iso);
  return `${weekday(d).slice(0, 3)}, ${monthShort(d)} ${d.getUTCDate()}`;
};

export function Events({ events, setEvents, draft, setDraft, sendDate, sendLabel, today }: Props) {
  const ahead = (r: EventRecord) => sortedDates(r.event).some((d: { date: string }) => d.date >= sendDate);
  return (
    <>
      <div class="em-section-tools">
        {!draft && (
          <button type="button" class="btn btn-small btn-dark" onClick={() => setDraft({ id: null, event: blankEvent(), since: null })}>
            + Add an event
          </button>
        )}
      </div>
      <p class="em-hint em-events-hint">Events are the store’s, not one email’s. Each email shows the dates still ahead on its send day, and each calendar link adds only those.</p>

      {events.length === 0 && !draft && <p class="em-none">No events coming up. The email leaves the events section out.</p>}

      <ul class="em-events">
        {events.map((r) =>
          draft?.id === r.event.id ? (
            <li>
              <Editor draft={draft} setDraft={setDraft} events={events} setEvents={setEvents} today={today} />
            </li>
          ) : (
            <li class="em-event">
              <div class="em-event-main">
                <p class="em-event-title">{r.event.title}</p>
                <p class="em-event-when">{eventSummary(r.event, today)}</p>
                <p class="em-event-tags">
                  <span class={`badge ${ahead(r) ? 'badge-open' : ''}`}>{ahead(r) ? `In the ${sendLabel} email` : `Over before ${sendLabel}`}</span>
                  {isWeekly(sortedDates(r.event)) && <span class="badge">Calendar links</span>}
                </p>
              </div>
              <button type="button" class="btn btn-small" disabled={Boolean(draft)} onClick={() => setDraft({ id: r.event.id, event: structuredClone(r.event), since: r.updatedAt })}>
                Edit
              </button>
            </li>
          ),
        )}
        {draft && draft.id === null && (
          <li>
            <Editor draft={draft} setDraft={setDraft} events={events} setEvents={setEvents} today={today} />
          </li>
        )}
      </ul>
    </>
  );
}

function Editor({ draft, setDraft, events, setEvents, today }: { draft: Draft; setDraft: (d: Draft | null) => void; events: EventRecord[]; setEvents: (e: EventRecord[]) => void; today: string }) {
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const ev = draft.event;
  const errors = checkEvent(cleanEvent(ev));
  const shown = (key: string) => (attempted || touched[key] ? errors[key] : undefined);
  const invalid = (key: string) => (shown(key) ? { 'aria-invalid': true, 'aria-describedby': `${fieldId(`ev.${key}`)}-error` } : {});
  const touch = (key: string) => setTouched((t) => ({ ...t, [key]: true }));
  const set = (patch: Partial<StoreEvent>) => {
    setDraft({ ...draft, event: { ...ev, ...patch } });
    setProblem(null);
  };
  const setDate = (k: number, patch: Partial<StoreEvent['dates'][number]>) => set({ dates: ev.dates.map((d, i) => (i === k ? { ...d, ...patch } : d)) });
  const filled = sortedDates(ev);
  const nextDate = filled.length ? addDays(filled[filled.length - 1].date, 7) : '';
  const mixed = filled.length > 1 && isMixed(filled);
  const weekly = filled.length > 0 && isWeekly(filled);
  const id = (key: string) => fieldId(`ev.${key}`);

  async function save() {
    setAttempted(true);
    if (Object.keys(errors).length) {
      window.setTimeout(() => document.querySelector<HTMLElement>('.em-editor [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setBusy(true);
    const res = await call<{ event: StoreEvent; updatedAt: string; updatedBy: string }>('/api/admin/email/event/', 'PUT', { event: ev, since: draft.since });
    setBusy(false);
    if (!res.ok) return setProblem(res.error);
    const record = { event: res.body.event, updatedAt: res.body.updatedAt, updatedBy: res.body.updatedBy };
    const rest = events.filter((r) => r.event.id !== record.event.id);
    setEvents([...rest, record].sort((a, b) => (sortedDates(a.event)[0]?.date ?? '').localeCompare(sortedDates(b.event)[0]?.date ?? '')));
    setDraft(null);
    toast(`Saved “${record.event.title}”`);
  }

  async function remove() {
    if (!draft.id || !draft.since) return;
    setBusy(true);
    const res = await call('/api/admin/email/event/', 'DELETE', { id: draft.id, since: draft.since });
    setBusy(false);
    if (!res.ok) return setProblem(res.error);
    setEvents(events.filter((r) => r.event.id !== draft.id));
    setDraft(null);
    toast(`Deleted “${ev.title}”`);
  }

  const saved = draft.id ? events.find((r) => r.event.id === draft.id) : null;

  return (
    <form
      class="em-editor"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(null);
      }}
    >
      <p class="em-editor-title">{draft.id ? `Editing “${saved?.event.title ?? ev.title}”` : 'A new event'}</p>
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
      <div class="field">
        <label for={id('title')}>
          Name <Counter value={ev.title} limit={EVENT_LIMITS.title} />
        </label>
        <input id={id('title')} value={ev.title} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} onBlur={() => touch('title')} {...invalid('title')} />
        <FieldError id={`${id('title')}-error`} message={shown('title')} />
        {!shown('title') && <p class="em-hint">Like “Kids’ Christmas Saturdays”.</p>}
      </div>
      <fieldset class="em-hours">
        <legend>Hours</legend>
        <div class="em-hours-row">
          <input id={id('start')} type="time" aria-label="Starts at" value={ev.start} onInput={(e) => set({ start: (e.target as HTMLInputElement).value })} onBlur={() => touch('start')} {...invalid('start')} />
          <span aria-hidden="true">to</span>
          <input id={id('end')} type="time" aria-label="Ends at" value={ev.end} onInput={(e) => set({ end: (e.target as HTMLInputElement).value })} onBlur={() => touch('end')} {...invalid('end')} />
        </div>
        <FieldError id={`${id('start')}-error`} message={shown('start')} />
        <FieldError id={`${id('end')}-error`} message={shown('end')} />
      </fieldset>

      <fieldset class="em-dates" id={id('dates')}>
        <legend>Dates, and what’s on each one</legend>
        <ol class="em-date-list">
          {ev.dates.map((d, k) => (
            <li class={`em-date${d.date && d.date < today ? ' is-past' : ''}`}>
              <div class="em-date-day">
                <input id={id(`dates.${k}.date`)} type="date" aria-label={`Date ${k + 1}`} value={d.date} onInput={(e) => setDate(k, { date: (e.target as HTMLInputElement).value })} onBlur={() => touch(`dates.${k}.date`)} {...invalid(`dates.${k}.date`)} />
                <span class="em-date-label">{d.date ? (d.date < today ? `${dayLabel(d.date)} · past` : dayLabel(d.date)) : ''}</span>
              </div>
              <div class="em-date-what">
                <input
                  id={id(`dates.${k}.what`)}
                  aria-label={`What’s on ${d.date ? dayLabel(d.date) : `date ${k + 1}`}`}
                  placeholder="What’s on"
                  value={d.what}
                  onInput={(e) => setDate(k, { what: (e.target as HTMLInputElement).value })}
                  onBlur={() => touch(`dates.${k}.what`)}
                  {...invalid(`dates.${k}.what`)}
                />
                <input
                  id={id(`dates.${k}.note`)}
                  class="em-date-note"
                  aria-label={`A note for ${d.date ? dayLabel(d.date) : `date ${k + 1}`}, if there is one`}
                  placeholder="Note, if any"
                  value={d.note}
                  onInput={(e) => setDate(k, { note: (e.target as HTMLInputElement).value })}
                  onBlur={() => touch(`dates.${k}.note`)}
                  {...invalid(`dates.${k}.note`)}
                />
                <label class="check em-greg">
                  <input type="checkbox" checked={d.greg} onChange={(e) => setDate(k, { greg: (e.target as HTMLInputElement).checked })} /> Greg’s photo
                </label>
                <FieldError id={`${id(`dates.${k}.date`)}-error`} message={shown(`dates.${k}.date`)} />
                <FieldError id={`${id(`dates.${k}.what`)}-error`} message={shown(`dates.${k}.what`)} />
                <FieldError id={`${id(`dates.${k}.note`)}-error`} message={shown(`dates.${k}.note`)} />
              </div>
              <button type="button" class="btn btn-ghost btn-icon em-remove" aria-label={`Remove date ${k + 1}`} disabled={ev.dates.length <= 1} onClick={() => set({ dates: ev.dates.filter((_, i) => i !== k) })}>
                <X />
              </button>
            </li>
          ))}
        </ol>
        {ev.dates.length < EVENT_LIMITS.dates && (
          <button
            type="button"
            class="btn btn-small"
            onClick={() => {
              set({ dates: [...ev.dates, { date: nextDate, what: '', note: '', greg: false }] });
              window.setTimeout(() => document.getElementById(id(`dates.${ev.dates.length}.what`))?.focus(), 0);
            }}
          >
            + Add {nextDate ? dayLabel(nextDate) : 'a date'}
          </button>
        )}
        <FieldError id={`${id('dates')}-error`} message={shown('dates')} />
        <p class="em-hint">{weekly ? (filled.length > 1 ? 'A week apart, so the email offers Google, Apple and Outlook calendar links for every date.' : 'The email offers calendar links for it.') : 'The dates aren’t a week apart, so the email lists them without calendar links.'}</p>
      </fieldset>

      {mixed && (
        <div class="field">
          <label for={id('when')}>
            What’s on, in a few words <Counter value={ev.when} limit={EVENT_LIMITS.when} />
          </label>
          <input id={id('when')} value={ev.when} onInput={(e) => set({ when: (e.target as HTMLInputElement).value })} onBlur={() => touch('when')} {...invalid('when')} />
          <FieldError id={`${id('when')}-error`} message={shown('when')} />
          {!shown('when') && <p class="em-hint">The dates fall on different days of the week, so the email says this before them. Like “Late shopping nights and Saturday crafts for kids”.</p>}
        </div>
      )}

      <div class="em-editor-actions">
        {draft.id &&
          (confirm ? (
            <span class="em-confirm" role="group" aria-label="Delete the event">
              Delete it from every email?
              <button type="button" class="btn btn-small" onClick={() => setConfirm(false)}>
                Keep it
              </button>
              <button type="button" class="btn btn-small btn-danger" onClick={() => void remove()} disabled={busy}>
                Delete
              </button>
            </span>
          ) : (
            <button type="button" class="btn btn-ghost btn-small btn-danger" onClick={() => setConfirm(true)}>
              Delete event
            </button>
          ))}
        <span class="em-editor-saved">{saved ? `Saved ${at.format(new Date(saved.updatedAt))} by ${who(saved.updatedBy)}` : ''}</span>
        <button type="button" class="btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save event'}
        </button>
      </div>
    </form>
  );
}
