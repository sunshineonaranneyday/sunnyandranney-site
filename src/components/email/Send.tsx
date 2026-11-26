/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
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
const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const count = (n: number | null) => (n === null || Number.isNaN(n) ? 'every subscriber' : `${n.toLocaleString('en-US')} subscriber${n === 1 ? '' : 's'}`);

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
  /** May add or take people off the list (managers). */
  managesList: boolean;
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
 * later, exactly as subscribers get it, as of the day picked), then the email itself to every
 * subscriber on the day and at the time picked. Once it's scheduled the email is locked until the
 * send is cancelled.
 */
/** An address that breaks, when it must, only after its "@" or before a ".": "holly@" over "soardcharity.com", never "soardcharit" over "y.com". */
function breakable(email: string) {
  return email.split(/(?<=@)|(?=\.)/).flatMap((part, k) => (k ? [<wbr />, part] : [part]));
}

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
  const [wanted, setTime] = useState(props.usualTime && TIMES.some((t) => t.value === props.usualTime) ? props.usualTime : '10:00');
  // Today offers only the times still ahead, and a day with none left isn't offered
  const open = days.filter((d) => timesFor(d, today).length);
  const times = timesFor(day, today);
  const time = times.some((t) => t.value === wanted) ? wanted : (times.find((t) => t.value === props.usualTime) ?? times[0])?.value ?? wanted;
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
  const choose = (email: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(email);
    else next.delete(email);
    setChosen(next);
    remember([...next]);
  };
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
    toast(`Added ${person.name}`);
  }

  async function remove(p: TestPerson) {
    const res = await call<{ people: TestPerson[] }>('/api/admin/email/test-people/', 'DELETE', { email: p.email });
    if (!res.ok) return setProblem(res.error);
    setPeople(res.body.people);
    choose(p.email, false);
  }

  const goes = kitSend && (kitSend.status === 'sending' || kitSend.status === 'completed');

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
        <p class="em-hint">Kit sends it about a minute later, exactly as subscribers will get it, with “[Test]” before the subject.</p>
        <ul class="em-test-list">
          {people.map((p) => (
            <li class="em-test-person" key={p.email}>
              <label class="check">
                <input type="checkbox" checked={chosen.has(p.email)} onChange={(e) => choose(p.email, (e.target as HTMLInputElement).checked)} />
                <span class="em-test-name">{p.you ? 'You' : p.name}</span>
                <span class="em-test-email">{breakable(p.email)}</span>
              </label>
              {!p.you && props.managesList && (
                <button type="button" class="btn btn-ghost btn-icon em-remove" aria-label={`Take ${p.name} off the list`} onClick={() => void remove(p)}>
                  <X />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!props.managesList ? null : showAdd ? (
          <form class="em-test-add" onSubmit={add} noValidate>
            <div class="em-test-add-row">
              <input aria-label="Their name" placeholder="Name" autocomplete="off" value={adding.name} maxLength={40} onInput={(e) => setAdding({ ...adding, name: (e.target as HTMLInputElement).value })} />
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
              <button type="submit" class="btn">
                Add
              </button>
            </div>
            <FieldError id="em-test-add-error" message={addError} />
          </form>
        ) : (
          <button type="button" class="btn btn-ghost btn-small em-add-person" onClick={() => setShowAdd(true)}>
            + Add someone
          </button>
        )}
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
                <label class="visually-hidden" for="em-send-day">
                  Day
                </label>
                <select id="em-send-day" value={day} onChange={(e) => setDay((e.target as HTMLSelectElement).value)}>
                  {open.map((d) => (
                    <option value={d}>
                      {d === today ? 'Today, ' : ''}
                      {sendLabel(d)}
                      {d === send ? ' (usual)' : ''}
                    </option>
                  ))}
                </select>
                <label class="visually-hidden" for="em-send-time">
                  Time
                </label>
                <select id="em-send-time" value={time} onChange={(e) => setTime((e.target as HTMLSelectElement).value)}>
                  {times.map((t) => (
                    <option value={t.value}>
                      {t.label}
                      {t.value === props.usualTime ? ' (usual)' : ''}
                    </option>
                  ))}
                </select>
                <span class="em-hint">Eastern, to {count(subscribers)}.</span>
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
