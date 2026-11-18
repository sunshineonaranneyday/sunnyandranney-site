/** @jsxImportSource preact */
/** Small pieces the weekly email page's sections share. */
import { type RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Slides items to their new places when a list is reordered, instead of jumping (FLIP: note where
 * each [data-flip] item was, then animate from there to where it is). Off when someone asks the
 * system for less motion.
 */
export function useFlip(list: RefObject<HTMLElement>, order: string[]) {
  const before = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = new Map<string, DOMRect>();
    for (const item of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = item.dataset.flip!;
      const box = item.getBoundingClientRect();
      now.set(key, box);
      const was = before.current.get(key);
      if (!was || still || typeof item.animate !== 'function') continue;
      const dx = was.left - box.left;
      const dy = was.top - box.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
    before.current = now;
  }, [order.join('|')]);
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p class="em-error" id={id}>
      {message}
    </p>
  ) : null;
}

/** "41 of 70" once a field is most of the way to its limit. */
export function Counter({ value, limit }: { value: string; limit: number }) {
  const n = value.trim().length;
  return n > limit * 0.7 ? <span class={`em-count${n > limit ? ' em-over' : ''}`}>{n} of {limit}</span> : null;
}

/**
 * A row of choices that reads like a switch: real radio buttons inside a fieldset, so arrow keys
 * and screen readers work as they do for any radio group. Wraps onto more rows when narrow.
 */
export function Segmented({
  id,
  legend,
  name,
  value,
  options,
  onChange,
  error,
}: {
  id: string;
  legend: string;
  name: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <fieldset class="em-seg" id={id} {...(error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {})}>
      <legend>{legend}</legend>
      <div class="em-seg-row">
        {options.map((o) => (
          <label class="em-seg-option" title={o.hint}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}

/**
 * A section of the page: a numbered heading, its state, and its body. With `onToggle` its heading
 * opens and folds it (a button inside the heading, as WAI-ARIA's accordion pattern has it); folded,
 * it shows a one-line `summary` of what's set, the way Mailchimp's campaign checklist shows each
 * finished part as a line to open.
 */
export function Section({
  n,
  id,
  title,
  state,
  tone,
  locked = false,
  open = true,
  summary,
  onToggle,
  children,
}: {
  n: number;
  id: string;
  title: string;
  state: string;
  tone: 'ok' | 'todo' | 'bad';
  /** Scheduled to send: shown, but nothing in it can change until the send is cancelled. */
  locked?: boolean;
  open?: boolean;
  /** What's set, in a line, shown while it's folded. */
  summary?: string;
  onToggle?: () => void;
  children: preact.ComponentChildren;
}) {
  const folded = Boolean(onToggle) && !open;
  return (
    <section class={`em-section card${locked ? ' is-locked' : ''}${folded ? ' is-folded' : ''}${onToggle ? ' is-foldable' : ''}`} aria-labelledby={`${id}-title`} id={id} {...(locked ? { inert: true } : {})}>
      <header class="em-section-head">
        <span class="em-step" aria-hidden="true">
          {n}
        </span>
        <h2 id={`${id}-title`}>
          {onToggle ? (
            <button type="button" class="em-section-toggle" aria-expanded={open} aria-describedby={folded && summary ? `${id}-summary` : undefined} onClick={onToggle}>
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <span class={`badge ${tone === 'ok' ? 'badge-approved' : tone === 'bad' ? 'badge-alert' : 'badge-pending'}`}>{state}</span>
        {onToggle && <span class="em-section-chevron" aria-hidden="true" />}
        {folded && summary && (
          <p class="em-section-summary" id={`${id}-summary`}>
            {summary}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

/** A labelled text field (or a few lines, with `rows`), its counter, its error and its hint. */
export function TextField({
  id,
  label,
  value,
  limit,
  onInput,
  error,
  hint,
  placeholder,
  rows,
}: {
  id: string;
  label: string;
  value: string;
  limit?: number;
  onInput: (v: string) => void;
  error?: string;
  hint?: preact.ComponentChildren;
  placeholder?: string;
  rows?: number;
}) {
  const a11y = error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : hint ? { 'aria-describedby': `${id}-hint` } : {};
  return (
    <div class="field">
      <label for={id}>
        {label} {limit ? <Counter value={value} limit={limit} /> : null}
      </label>
      {rows ? (
        <textarea id={id} rows={rows} value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} {...a11y} />
      ) : (
        <input id={id} value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLInputElement).value)} {...a11y} />
      )}
      <FieldError id={`${id}-error`} message={error} />
      {!error && hint ? (
        <p class="em-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
