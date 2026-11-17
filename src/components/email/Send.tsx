/** @jsxImportSource preact */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { sendLabel } from '@/lib/sunny-side/special.mjs';
import { checkPerson, cleanPerson, namesOf } from '@/lib/sunny-side/testers.mjs';
import { type KitSend, type TestPerson, type TestSent, at, send as call, toast, who } from './model';
import { FieldError } from './parts';
import { X } from './Sale';

const KEY = 'em-test-to';
function remembered(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Array.isArray(v) ? v.filter((e) => typeof e === 'string') : null;
  } catch {
    return null;
  }
}
function remember(emails: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(emails));
  } catch {
    // Private windows: the ticks just aren't remembered
  }
}

/** Every quarter hour from 6 AM to 8 PM, as "HH:MM", with how it reads. */
const TIMES = Array.from({ length: (20 - 6) * 4 + 1 }, (_, k) => {
  const m = 6 * 60 + k * 15;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  const h12 = ((Math.floor(m / 60) + 11) % 12) + 1;
  return { value: `${hh}:${mm}`, label: `${h12}:${mm} ${m < 12 * 60 ? 'AM' : 'PM'}` };
});
const timeLabel = (v: string) => TIMES.find((t) => t.value === v)?.label ?? v;
const minutesOf = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
/** The server takes a send at least this far ahead (send.ts), so today's list starts there. */
const LEAD_MIN = 10;
const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The times a day offers: all of them, or today's still at least LEAD_MIN away. */
const timesFor = (d: string, today: string) => {
  if (d !== today) return TIMES;
  const now = minutesOf(eastern.format(new Date()));
  return TIMES.filter((t) => minutesOf(t.value) >= now + LEAD_MIN);
};
/**
 * The times a tap away, besides the store's usual once it has one: early morning, when the showroom
 * opens (10 AM, the time picked until the store has a usual), lunch and evening. Every other quarter
 * hour is under "Other time". (Peter, 2026-11-16: 57 times in one list buried the usual one.)
 */
const OPENS = '10:00';
const QUICK = ['08:00', OPENS, '12:00', '18:00'];
const OTHER = 'other';
/** "Tue" and "Nov 17", the two lines of a day's button */
const dayParts = (d: string) => {
  const [wd, md] = sendLabel(d).split(', ');
  return { wd, md };
};
const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const count = (n: number | null) => (n === null || Number.isNaN(n) ? 'the store’s subscribers' : `${n.toLocaleString('en-US')} subscriber${n === 1 ? '' : 's'}`);

interface Props {
  send: string;
  label: string;
  /** The day it goes, the days it can (its week, from today on), and today. */
  day: string;
  days: string[];
  setDay: (d: string) => void;
  today: string;
  /** What still has to be done first, each with the section that does it. */
  todo: { text: string; section: string }[];
  dirty: boolean;
  saving: boolean;
  saveFirst: () => Promise<boolean>;
  me: string;
  people: TestPerson[];
  tests: TestSent[];
  onTest: (t: TestSent) => void;
  kitSend: KitSend | null;
  setKitSend: (k: KitSend | null) => void;
  usualTime: string | null;
  subscribers: number | null;
  subject: string;
  preheader: string;
}

/**
 * Sends the week's email from here, through Kit: a test to whoever's ticked (Kit sends it a minute
 * later, exactly as subscribers get it, as of the day picked), then the email itself to the store's
 * subscribers on the day and at the time picked. Once it's scheduled the email is locked until the
 * send is cancelled.
 */
/** An address that breaks, when it must, only after its "@" or before a ".": "holly@" over "soardcharity.com", never "soardcharit" over "y.com". */
function breakable(email: string) {
  return email.split(/(?<=@)|(?=\.)/).flatMap((part, k) => (k ? [<wbr />, part] : [part]));
}

/** "AB" for Ann Banks, "C" for Cal; you, by your email ("dana.r@" is "DR"). */
const initials = (p: TestPerson) => {
  const words = (p.you ? p.email.split('@')[0] : p.name).split(/[\s._-]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
};
const Tick = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export function Send(props: Props) {
  const { send, label, day, days, setDay, today, todo, dirty, saving, saveFirst, me, kitSend, setKitSend, subscribers } = props;
  const [people, setPeople] = useState(props.people);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([me]));
  const [busy, setBusy] = useState<'test' | 'schedule' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', email: '' });
  const [addError, setAddError] = useState<string | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  /** Who was just taken off, held in their place with an Undo until the list changes again. */
  const [gone, setGone] = useState<{ person: TestPerson; at: number; was: boolean; done: Promise<boolean> } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const addCard = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  /**
   * Where focus goes once the render that draws it lands: a person's card (by email), the Undo,
   * the Add card or the form's Name, in the same frame. Not autofocus, which a browser honors once
   * per page load (the form then opened with nothing focused, so Esc did nothing), and not a
   * paint later, which on a busy page left the first keys typed going nowhere.
   */
  const focusNext = useRef<string | null>(null);
  useLayoutEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    const el =
      want === 'undo' ? undoButton.current : want === 'add' ? addCard.current : want === 'name' ? nameInput.current : list.current?.querySelector<HTMLInputElement>(`input[value="${CSS.escape(want)}"]`);
    if (el) {
      el.focus();
      focusNext.current = null;
    }
  });
  const [wanted, setTime] = useState(props.usualTime && TIMES.some((t) => t.value === props.usualTime) ? props.usualTime : OPENS);
  // Today offers only the times still ahead, and a day with none left isn't offered
  const open = days.filter((d) => timesFor(d, today).length);
  const times = timesFor(day, today);
  // Today, once the time wanted has passed: the usual or the opening time if still ahead, else the next one
  const time = times.some((t) => t.value === wanted) ? wanted : (times.find((t) => t.value === props.usualTime) ?? times.find((t) => t.value === OPENS) ?? times[0])?.value ?? wanted;
  // The usual time and the common ones still open that day, in order through the day
  const quick = [...new Set([props.usualTime, ...QUICK])].filter((v): v is string => Boolean(v) && times.some((t) => t.value === v)).sort((a, b) => minutesOf(a) - minutesOf(b));
  const [other, setOther] = useState(false);
  const otherOn = other || !quick.includes(time);
  const otherSelect = useRef<HTMLSelectElement>(null);
  const pickTime = (v: string) => {
    if (v === OTHER) {
      setOther(true);
      window.setTimeout(() => otherSelect.current?.focus(), 0);
    } else {
      setOther(false);
      setTime(v);
    }
  };
  useEffect(() => {
    if (!kitSend && open.length && !open.includes(day)) setDay(open[0]);
  }, [open.join(), day, kitSend]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const last = remembered()?.filter((e) => props.people.some((p) => p.email === e));
    if (last?.length) setChosen(new Set(last));
  }, []);

  const ready = !todo.length;
  const to = people.filter((p) => chosen.has(p.email)).map((p) => p.email);
  const choose = (email: string, on: boolean) =>
    setChosen((was) => {
      const next = new Set(was);
      if (on) next.add(email);
      else next.delete(email);
      remember([...next]);
      return next;
    });
  const last = props.tests[0];

  async function test() {
    if (busy || saving || !to.length || !ready) return;
    setProblem(null);
    setSent(null);
    if (dirty && !(await saveFirst())) return;
    setBusy('test');
    const res = await call<{ test: TestSent; names: string }>('/api/admin/email/test/', 'POST', { send, day, to });
    setBusy(null);
    if (!res.ok) return setProblem(res.error);
    props.onTest(res.body.test);
    setSent(res.body.names);
    toast(`Kit is sending the test to ${res.body.names}`);
  }

  async function openSchedule() {
    if (busy || saving || !ready) return;
    setProblem(null);
    if (dirty && !(await saveFirst())) return;
    dialog.current?.showModal();
  }

  async function schedule() {
    setBusy('schedule');
    const res = await call<{ kit: KitSend }>('/api/admin/email/send/', 'PUT', { send, day, time });
    setBusy(null);
    dialog.current?.close();
    if (!res.ok) return setProblem(res.error);
    setKitSend(res.body.kit);
    toast(`Scheduled for ${when.format(new Date(res.body.kit.sendAt))}`);
  }

  async function cancelSend() {
    setBusy('cancel');
    const res = await call('/api/admin/email/send/', 'DELETE', { send });
    setBusy(null);
    setConfirmCancel(false);
    if (!res.ok) return setProblem(res.error);
    setKitSend(null);
    toast('Cancelled. Nothing was sent.');
  }

  async function add(e: Event) {
    e.preventDefault();
    const person = cleanPerson(adding);
    const errors = checkPerson(person, people);
    if (errors.email) return setAddError(errors.email);
    const res = await call<{ people: TestPerson[] }>('/api/admin/email/test-people/', 'PUT', person);
    if (!res.ok) return setAddError(res.error);
    setPeople(res.body.people);
    choose(person.email, true);
    setAdding({ name: '', email: '' });
    setAddError(undefined);
    setShowAdd(false);
    setGone(null);
    focusNext.current = person.email;
    toast(`Added ${person.name}`);
  }

  function openAdd() {
    focusNext.current = 'name';
    setShowAdd(true);
  }

  function closeAdd() {
    focusNext.current = 'add';
    setShowAdd(false);
    setAdding({ name: '', email: '' });
    setAddError(undefined);
  }

  /** Takes them off at once, leaving an Undo where their card was; if the server says no, they come back. */
  function remove(p: TestPerson) {
    const at = people.findIndex((x) => x.email === p.email);
    const was = chosen.has(p.email);
    setProblem(null);
    setPeople((list) => list.filter((x) => x.email !== p.email));
    choose(p.email, false);
    const done = call<{ people: TestPerson[] }>('/api/admin/email/test-people/', 'DELETE', { email: p.email }).then((res) => {
      if (res.ok) return true;
      setPeople((list) => (list.some((x) => x.email === p.email) ? list : [...list.slice(0, at), p, ...list.slice(at)]));
      setGone((g) => (g?.person.email === p.email ? null : g));
      if (was) choose(p.email, true);
      setProblem(res.error);
      return false;
    });
    focusNext.current = 'undo';
    setGone({ person: p, at, was, done });
  }

  /** Puts them back where they were, ticked if they were. Waits for the take-off to land first, so it can't undo the undo. */
  async function undo() {
    if (!gone) return;
    const { person, at, was, done } = gone;
    setGone(null);
    if (!(await done)) return;
    setPeople((list) => [...list.slice(0, at), person, ...list.slice(at)]);
    if (was) choose(person.email, true);
    focusNext.current = person.email;
    const res = await call<{ people: TestPerson[] }>('/api/admin/email/test-people/', 'PUT', { name: person.name, email: person.email });
    if (!res.ok) {
      // Still off on the server: the Undo card comes back, so it can be tried again
      setPeople((list) => list.filter((x) => x.email !== person.email));
      if (was) choose(person.email, false);
      setGone({ person, at, was, done: Promise.resolve(true) });
      return setProblem(res.error);
    }
    setPeople(res.body.people);
  }

  const goes = kitSend && (kitSend.status === 'sending' || kitSend.status === 'completed');
  const goneCard = gone && (
    <li class="em-person em-person-gone" key="gone">
      <span role="status">
        <b>{gone.person.name}</b> is off the list.
      </span>
      <button type="button" class="btn btn-ghost btn-small" ref={undoButton} aria-label={`Undo, put ${gone.person.name} back on the list`} onClick={() => void undo()}>
        Undo
      </button>
    </li>
  );

  return (
    <div class="em-send">
      {!ready && (
        <div class="em-todo" role="status">
          <p>Before it can go:</p>
          <ul>
            {todo.map((t) => (
              <li>
                <a href={`#${t.section}`}>{t.text}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {problem && (
        <p class="em-error em-send-problem" role="alert">
          {problem}
        </p>
      )}

      <div class="em-send-card">
        <h3>Send a test</h3>
        <p class="em-hint">Pick who gets it. Kit sends it about a minute later, exactly as subscribers will get it, with “[Test]” before the subject.</p>
        <div class="em-people" ref={list}>
          <ul class="em-test-list" aria-label="Who gets the test">
            {people.flatMap((p, i) => {
              const card = (
                <li class="em-person" key={p.email}>
                  <label class="em-person-card">
                    <input type="checkbox" class="visually-hidden" value={p.email} checked={chosen.has(p.email)} onChange={(e) => choose(p.email, (e.target as HTMLInputElement).checked)} />
                    <span class="em-avatar" aria-hidden="true">
                      <span class="em-avatar-face">{initials(p)}</span>
                      <span class="em-avatar-back">
                        <Tick />
                      </span>
                    </span>
                    <span class="em-person-text">
                      <span class="em-person-name">{p.you ? 'You' : p.name}</span>
                      <span class="em-person-email">
                        {p.email.slice(0, p.email.indexOf('@') + 1)}
                        <span class="em-person-domain">{breakable(p.email.slice(p.email.indexOf('@') + 1))}</span>
                      </span>
                    </span>
                  </label>
                  {!p.you && (
                    <button type="button" class="btn btn-ghost btn-icon em-person-remove" aria-label={`Take ${p.name} off the list`} onClick={() => remove(p)}>
                      <X />
                    </button>
                  )}
                </li>
              );
              return gone && gone.at === i ? [goneCard, card] : [card];
            })}
            {gone && gone.at >= people.length && goneCard}
            <li class={`em-person em-person-add${showAdd ? ' is-open' : ''}`} key="add">
              {showAdd ? (
                <form
                  class="em-test-add"
                  onSubmit={add}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeAdd();
                    }
                  }}
                  noValidate
                >
                  <div class="em-test-add-row">
                    <input ref={nameInput} aria-label="Their name" placeholder="Name" autocomplete="off" value={adding.name} maxLength={40} onInput={(e) => setAdding({ ...adding, name: (e.target as HTMLInputElement).value })} />
                    <input
                      type="email"
                      aria-label="Their email"
                      placeholder="Email"
                      autocomplete="off"
                      value={adding.email}
                      onInput={(e) => {
                        setAdding({ ...adding, email: (e.target as HTMLInputElement).value });
                        setAddError(undefined);
                      }}
                      {...(addError ? { 'aria-invalid': true, 'aria-describedby': 'em-test-add-error' } : {})}
                    />
                    <FieldError id="em-test-add-error" message={addError} />
                    <div class="em-test-add-actions">
                      <button type="button" class="btn btn-ghost" onClick={closeAdd}>
                        Cancel
                      </button>
                      <button type="submit" class="btn btn-dark">
                        Add
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <button type="button" class="em-person-card em-add-card" ref={addCard} onClick={openAdd}>
                  <span class="em-avatar" aria-hidden="true">
                    <span class="em-avatar-face">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </span>
                  <span class="em-person-text">
                    <span class="em-person-name">Add someone</span>
                    <span class="em-person-email">Anyone who checks the email</span>
                  </span>
                </button>
              )}
            </li>
          </ul>
        </div>
        <div class="em-send-row">
          <button type="button" class="btn btn-dark" onClick={() => void test()} disabled={!ready || !to.length || Boolean(busy) || saving || Boolean(goes)}>
            {busy === 'test' ? 'Sending the test…' : `${dirty ? 'Save and send' : 'Send'} test to ${to.length === 1 && to[0] === me ? 'you' : `${to.length} ${to.length === 1 ? 'person' : 'people'}`}`}
          </button>
          {sent ? (
            <span class="em-done" role="status">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              On its way to {sent}. It arrives in a minute or two.
            </span>
          ) : last ? (
            <span class="em-hint">
              Last test {at.format(new Date(last.at))}
              {last.by === me ? '' : ` by ${who(last.by)}`} to {namesOf(last.to, people)}.
            </span>
          ) : null}
        </div>
      </div>

      <div class={`em-send-card em-send-real${kitSend ? ' is-set' : ''}`}>
        <h3>Send to subscribers</h3>
        {kitSend ? (
          <div class="em-scheduled" key={kitSend.id}>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="em-scheduled-icon">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <div>
              <p class="em-scheduled-when">
                {kitSend.status === 'completed' ? 'Sent' : kitSend.status === 'sending' ? 'Sending now' : 'Scheduled for'} {when.format(new Date(kitSend.sendAt))}
              </p>
              <p class="em-hint">
                To {count(subscribers)}. {kitSend.status === 'scheduled' ? 'The email is locked while it waits; cancel to change anything.' : ''}
              </p>
              <div class="em-send-row">
                <a class="btn btn-small" href={kitSend.url} target="_blank" rel="noopener">
                  See it in Kit →
                </a>
                {!goes &&
                  (confirmCancel ? (
                    <span class="em-confirm" role="group" aria-label="Cancel the send">
                      Cancel it? Nothing will be sent.
                      <button type="button" class="btn btn-small" onClick={() => setConfirmCancel(false)}>
                        Keep it
                      </button>
                      <button type="button" class="btn btn-small btn-danger" onClick={() => void cancelSend()} disabled={busy === 'cancel'}>
                        {busy === 'cancel' ? 'Cancelling…' : 'Cancel the send'}
                      </button>
                    </span>
                  ) : (
                    <button type="button" class="btn btn-ghost btn-small btn-danger" onClick={() => setConfirmCancel(true)}>
                      Cancel the send
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {open.length ? (
              <div class="em-when">
                <fieldset class="em-seg em-days" id="em-send-day">
                  <legend>Day</legend>
                  <div class="em-seg-row">
                    {open.map((d) => {
                      const { wd, md } = dayParts(d);
                      return (
                        <label class="em-seg-option">
                          <input type="radio" name="em-send-day" value={d} checked={d === day} onChange={() => setDay(d)} />
                          <span>
                            <strong>{d === today ? 'Today' : wd}</strong>
                            <small>{md}</small>
                            <em>{d === send ? 'Usual' : '\u00a0'}</em>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <fieldset class="em-seg em-times" id="em-send-time">
                  <legend>Time, Eastern</legend>
                  {quick.length > 0 && (
                    <div class="em-seg-row">
                      {[...quick, OTHER].map((v) => (
                        <label class="em-seg-option">
                          <input type="radio" name="em-send-time" value={v} checked={v === OTHER ? otherOn : !otherOn && v === time} onChange={() => pickTime(v)} />
                          <span>
                            <strong>{v === OTHER ? 'Other time' : timeLabel(v)}</strong>
                            <em>{v === props.usualTime ? 'Usual' : v === OPENS && !props.usualTime ? 'Store opens' : '\u00a0'}</em>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {(otherOn || !quick.length) && (
                    <div class="em-other-time">
                      <label for="em-send-other">{quick.length ? 'Pick the time' : 'Time'}</label>
                      <select id="em-send-other" ref={otherSelect} value={time} onChange={(e) => setTime((e.target as HTMLSelectElement).value)}>
                        {times.map((t) => (
                          <option value={t.value}>
                            {t.label}
                            {t.value === props.usualTime ? ' (usual)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </fieldset>
                <p class="em-hint">To {count(subscribers)}.</p>
              </div>
            ) : (
              <p class="em-hint">This email’s week is over, so it can’t be scheduled.</p>
            )}
            <div class="em-send-row">
              <button type="button" class="btn btn-primary" onClick={() => void openSchedule()} disabled={!ready || !open.length || Boolean(busy) || saving}>
                {dirty ? 'Save and schedule…' : 'Schedule…'}
              </button>
              {day !== send && open.length > 0 && <span class="em-hint">The sale, events and date in the email go by {sendLabel(day)}.</span>}
            </div>
          </>
        )}
      </div>

      <dialog class="em-dialog" ref={dialog} aria-labelledby="em-dialog-title" onClose={() => setBusy((b) => (b === 'schedule' ? b : null))}>
        <h2 id="em-dialog-title">Send the {label} email?</h2>
        <dl class="em-dialog-facts">
          <dt>When</dt>
          <dd>
            {day === today ? 'Today, ' : ''}
            {sendLabel(day)}, {timeLabel(time)} Eastern
          </dd>
          <dt>To</dt>
          <dd>{count(subscribers)}</dd>
          <dt>Subject</dt>
          <dd>{props.subject}</dd>
          <dt>Preview</dt>
          <dd>{props.preheader}</dd>
        </dl>
        <p class="em-hint">You can cancel it here until it goes.</p>
        <div class="em-dialog-actions">
          <button type="button" class="btn" onClick={() => dialog.current?.close()} disabled={busy === 'schedule'}>
            Not yet
          </button>
          <button type="button" class="btn btn-primary" onClick={() => void schedule()} disabled={busy === 'schedule'}>
            {busy === 'schedule' ? 'Scheduling…' : 'Schedule it'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
