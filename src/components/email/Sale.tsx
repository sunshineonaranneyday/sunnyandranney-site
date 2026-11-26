/** @jsxImportSource preact */
import { LIMITS, USUAL_PERCENT, clock, isDiscount, sendLabel, summary, termsLine } from '@/lib/sunny-side/special.mjs';
import { type Kind, type SaleForm, type SalePresets, type Special, fieldId, tidyMoney, tidyPercent } from './model';
import { FieldError } from './parts';

interface Props {
  form: SaleForm;
  special: Special;
  errors: Record<string, string>;
  shown: (key: string) => string | undefined;
  set: (patch: Partial<SaleForm>) => void;
  touch: (key: string) => void;
  presets: SalePresets;
  /** The day the email goes: a sale by the hour's days start there. */
  day: string;
}

/** "YYYY-MM-DD" plus `n` days. */
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** The hours a sale by the hour can start or end on: every half hour from 6 AM to 10 PM. */
const CLOCKS = Array.from({ length: 33 }, (_, k) => `${String(6 + Math.floor(k / 2)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`);
/** Three hours on, or the last of the day. */
const laterOf = (t: string) => CLOCKS[Math.min(CLOCKS.indexOf(t) + 6, CLOCKS.length - 1)];
/** A sale by the hour to start from: the store's morning and afternoon on the email's day (10am–1pm, 1–5pm), its percents to fill. */
const startWindows = (day: string): SaleForm['windows'] => [
  { day, from: '10:00', to: '13:00', percent: '' },
  { day, from: '13:00', to: '17:00', percent: '' },
];

const money = (n: number) => n.toLocaleString('en-US');
const filled = (tiers: SaleForm['tiers']) => tiers.some((t) => t.spend.trim() || t.percent.trim());

/**
 * The week's sale: four ready-made sales, already filled in. She taps one and changes a number
 * if she needs to; the last day comes set to the week's Sunday. Spend more, save more starts on the
 * last amounts saved here, else the store's own from its Nov 3 email (Peter, 2026-11-16: "why
 * doesn't this have info already filled in"). Nothing to write: the label, the
 * words, the button and the fine print are the store's for each (special.mjs, defaults), and the
 * preview beside it shows them. (Peter, 2026-11-16: "pick a ready-made sale".) A sale by the hour
 * (Black Friday, Nov 27, 2026) has a name to write, the big line over its percents, and its rows.
 */
export function Sale({ form, special, errors, shown, set, touch, presets, day }: Props) {
  const kind = form.kind;
  const terms = termsLine({ ...special, ends: errors.ends ? '' : special.ends });
  const invalid = (key: string) => (shown(key) ? { 'aria-invalid': true, 'aria-describedby': `${fieldId(key)}-error` } : {});
  const setTier = (k: number, patch: Partial<SaleForm['tiers'][number]>) => set({ tiers: form.tiers.map((t, i) => (i === k ? { ...t, ...patch } : t)) });
  const addTier = () => {
    set({ tiers: [...form.tiers, { spend: '', percent: '' }] });
    window.setTimeout(() => document.getElementById(fieldId(`tiers.${form.tiers.length}.spend`))?.focus(), 0);
  };
  const presetTiers = presets.tiers.map((t) => ({ spend: money(t.spend), percent: String(t.percent) }));

  /** Taps a ready-made sale: it comes filled in, keeping anything already typed for it this week. */
  const choose = (k: Kind) => {
    if (k === 'percent') set({ kind: k, percent: form.percent.trim() || String(presets.percent), ends: form.ends || presets.ends });
    else if (k === 'tiers') set({ kind: k, tiers: filled(form.tiers) ? form.tiers : presetTiers, ends: form.ends || presets.ends });
    else if (k === 'times') set({ kind: k, windows: form.windows.length ? form.windows : startWindows(day) });
    else set({ kind: k });
  };
  // ── A sale by the hour's rows ──
  const setWindow = (k: number, patch: Partial<SaleForm['windows'][number]>) => set({ windows: form.windows.map((w, i) => (i === k ? { ...w, ...patch } : w)) });
  const addWindow = () => {
    const last = form.windows[form.windows.length - 1];
    // The next one starts where the last ends, while that's before the store closes (5pm); else it's the next day, all day
    const next =
      last?.to && last.to < '17:00' ? { day: last.day, from: last.to, to: laterOf(last.to), percent: '' } : { day: last?.day ? plusDays(last.day, 1) : day, from: '', to: '', percent: '' };
    set({ windows: [...form.windows, next] });
    window.setTimeout(() => document.getElementById(fieldId(`windows.${form.windows.length}.percent`))?.focus(), 0);
  };
  // The days a row can be: the email's day and the two weeks after, and any day already picked
  const dayChoices = [...new Set([...Array.from({ length: 14 }, (_, k) => plusDays(day, k)), ...form.windows.map((w) => w.day).filter(Boolean)])].sort();

  const percentShown = kind === 'percent' ? form.percent.trim() || '?' : String(presets.percent);
  const tiersShown = kind === 'tiers' && filled(form.tiers) ? form.tiers : presetTiers;

  return (
    <>
      <div class="em-sale-cards" role="group" aria-label="This week’s sale" id={fieldId('kind')}>
        <button type="button" class="em-sale-card" aria-pressed={kind === 'percent'} onClick={() => choose('percent')}>
          <span class="em-sale-card-title">{percentShown}% off everything</span>
          <span class="em-sale-card-sub">{Number(percentShown) === USUAL_PERCENT ? 'The store’s usual' : 'Like last time'}</span>
        </button>
        <button type="button" class="em-sale-card" aria-pressed={kind === 'tiers'} onClick={() => choose('tiers')}>
          <span class="em-sale-card-title">Spend more, save more</span>
          <span class="em-sale-card-sub">
            {tiersShown
              .filter((t) => t.spend || t.percent)
              .map((t) => (
                <span class="em-sale-card-line">
                  ${t.spend || '?'} → {t.percent || '?'}% off
                </span>
              ))}
          </span>
        </button>
        <button type="button" class="em-sale-card" aria-pressed={kind === 'times'} onClick={() => choose('times')}>
          <span class="em-sale-card-title">By the hour</span>
          <span class="em-sale-card-sub">
            {kind === 'times' && form.windows.length ? (
              summary(special)
                .split(' · ')
                .map((line) => <span class="em-sale-card-line">{line}</span>)
            ) : (
              'A different percent by day or hour, like Black Friday'
            )}
          </span>
        </button>
        <button type="button" class="em-sale-card" aria-pressed={kind === 'headline'} onClick={() => choose('headline')}>
          <span class="em-sale-card-title">No sale this week</span>
          <span class="em-sale-card-sub">Shows what’s new instead</span>
        </button>
      </div>
      <FieldError id={`${fieldId('kind')}-error`} message={shown('kind')} />

      {isDiscount(kind) && (
        <div class="em-sale-edit">
          {kind === 'percent' && (
            <div class="field em-percent">
              <label for={fieldId('percent')}>Percent off everything</label>
              <span class="em-affix em-affix-end">
                <input
                  id={fieldId('percent')}
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.percent}
                  onInput={(e) => set({ percent: (e.target as HTMLInputElement).value })}
                  onBlur={() => {
                    set({ percent: tidyPercent(form.percent) });
                    touch('percent');
                  }}
                  {...invalid('percent')}
                />
                <span aria-hidden="true">% off</span>
              </span>
              <FieldError id={`${fieldId('percent')}-error`} message={shown('percent')} />
            </div>
          )}

          {kind === 'tiers' && (
            <fieldset class="em-tiers" id={fieldId('tiers')}>
              <legend>The amounts</legend>
              <div class="em-tier-head" aria-hidden="true">
                <span>Spend at least</span>
                <span>Save</span>
              </div>
              <ol class="em-tier-list">
                {form.tiers.map((t, k) => (
                  <li class="em-tier">
                    <span class="em-affix">
                      <span aria-hidden="true">$</span>
                      <input
                        id={fieldId(`tiers.${k}.spend`)}
                        aria-label={`Tier ${k + 1}: spend at least, in dollars`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={t.spend}
                        onInput={(e) => setTier(k, { spend: (e.target as HTMLInputElement).value })}
                        onBlur={() => {
                          setTier(k, { spend: tidyMoney(t.spend) });
                          touch(`tiers.${k}`);
                        }}
                        {...invalid(`tiers.${k}.spend`)}
                      />
                    </span>
                    <span class="em-arrow" aria-hidden="true">
                      →
                    </span>
                    <span class="em-affix em-affix-end">
                      <input
                        id={fieldId(`tiers.${k}.percent`)}
                        aria-label={`Tier ${k + 1}: percent off`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={t.percent}
                        onInput={(e) => setTier(k, { percent: (e.target as HTMLInputElement).value })}
                        onBlur={() => {
                          setTier(k, { percent: tidyPercent(t.percent) });
                          touch(`tiers.${k}`);
                        }}
                        {...invalid(`tiers.${k}.percent`)}
                      />
                      <span aria-hidden="true">% off</span>
                    </span>
                    <button
                      type="button"
                      class="btn btn-ghost btn-icon em-remove"
                      aria-label={`Remove tier ${k + 1}`}
                      disabled={form.tiers.length <= LIMITS.tiers[0]}
                      onClick={() => set({ tiers: form.tiers.filter((_, i) => i !== k) })}
                    >
                      <X />
                    </button>
                    <FieldError id={`${fieldId(`tiers.${k}.spend`)}-error`} message={shown(`tiers.${k}.spend`)} />
                    <FieldError id={`${fieldId(`tiers.${k}.percent`)}-error`} message={shown(`tiers.${k}.percent`)} />
                  </li>
                ))}
              </ol>
              {form.tiers.length < LIMITS.tiers[1] && (
                <button type="button" class="btn btn-small" onClick={addTier}>
                  + Add a tier
                </button>
              )}
              <FieldError id={`${fieldId('tiers')}-error`} message={shown('tiers')} />
            </fieldset>
          )}

          {kind === 'times' && (
            <>
              <div class="field em-sale-name">
                <label for={fieldId('name')}>Name of the sale</label>
                <input
                  id={fieldId('name')}
                  value={form.name}
                  placeholder="Black Friday weekend"
                  maxLength={LIMITS.name + 20}
                  onInput={(e) => set({ name: (e.target as HTMLInputElement).value })}
                  onBlur={() => touch('name')}
                  {...invalid('name')}
                />
                <FieldError id={`${fieldId('name')}-error`} message={shown('name')} />
                {!shown('name') && <p class="em-hint">The big line over the percents.</p>}
              </div>
              <fieldset class="em-windows" id={fieldId('windows')}>
                <legend>When, and how much off everything</legend>
                <ol class="em-window-list">
                  {form.windows.map((w, k) => (
                    <li class="em-window">
                      <select id={fieldId(`windows.${k}.day`)} aria-label={`Time ${k + 1}: day`} value={w.day} onChange={(e) => setWindow(k, { day: (e.target as HTMLSelectElement).value })} onBlur={() => touch(`windows.${k}`)} {...invalid(`windows.${k}.day`)}>
                        {!w.day && <option value="">Pick a day</option>}
                        {dayChoices.map((d) => (
                          <option value={d}>{sendLabel(d)}</option>
                        ))}
                      </select>
                      <select
                        id={fieldId(`windows.${k}.hours`)}
                        aria-label={`Time ${k + 1}: starts`}
                        value={w.from}
                        onChange={(e) => {
                          const from = (e.target as HTMLSelectElement).value;
                          setWindow(k, { from, to: !from ? '' : w.to && w.to > from ? w.to : laterOf(from) });
                        }}
                        onBlur={() => touch(`windows.${k}`)}
                        {...invalid(`windows.${k}.hours`)}
                      >
                        <option value="">All day</option>
                        {CLOCKS.slice(0, -1).map((t) => (
                          <option value={t}>{clock(t)}</option>
                        ))}
                      </select>
                      {w.from ? (
                        <select id={fieldId(`windows.${k}.to`)} aria-label={`Time ${k + 1}: ends`} value={w.to} onChange={(e) => setWindow(k, { to: (e.target as HTMLSelectElement).value })} onBlur={() => touch(`windows.${k}`)}>
                          {!w.to && <option value="">Ends</option>}
                          {CLOCKS.filter((t) => t > w.from).map((t) => (
                            <option value={t}>to {clock(t)}</option>
                          ))}
                        </select>
                      ) : (
                        <span class="em-window-allday" aria-hidden="true">
                          open to close
                        </span>
                      )}
                      <span class="em-affix em-affix-end">
                        <input
                          id={fieldId(`windows.${k}.percent`)}
                          aria-label={`Time ${k + 1}: percent off`}
                          inputMode="numeric"
                          autoComplete="off"
                          value={w.percent}
                          onInput={(e) => setWindow(k, { percent: (e.target as HTMLInputElement).value })}
                          onBlur={() => {
                            setWindow(k, { percent: tidyPercent(w.percent) });
                            touch(`windows.${k}`);
                          }}
                          {...invalid(`windows.${k}.percent`)}
                        />
                        <span aria-hidden="true">% off</span>
                      </span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-icon em-remove"
                        aria-label={`Remove time ${k + 1}`}
                        disabled={form.windows.length <= LIMITS.windows[0]}
                        onClick={() => set({ windows: form.windows.filter((_, i) => i !== k) })}
                      >
                        <X />
                      </button>
                      <FieldError id={`${fieldId(`windows.${k}.day`)}-error`} message={shown(`windows.${k}.day`)} />
                      <FieldError id={`${fieldId(`windows.${k}.hours`)}-error`} message={shown(`windows.${k}.hours`)} />
                      <FieldError id={`${fieldId(`windows.${k}.percent`)}-error`} message={shown(`windows.${k}.percent`)} />
                    </li>
                  ))}
                </ol>
                {form.windows.length < LIMITS.windows[1] && (
                  <button type="button" class="btn btn-small" onClick={addWindow}>
                    + Add a time
                  </button>
                )}
                <FieldError id={`${fieldId('windows')}-error`} message={shown('windows')} />
                {!shown('windows') && <p class="em-hint">{`Under the button: “${terms}” Times are the store’s, Eastern.`}</p>}
              </fieldset>
            </>
          )}

          {kind !== 'times' && (
            <div class="field em-ends">
              <label for={fieldId('ends')}>Ends</label>
              <input id={fieldId('ends')} type="date" value={form.ends} onInput={(e) => set({ ends: (e.target as HTMLInputElement).value })} onBlur={() => touch('ends')} {...invalid('ends')} />
              <FieldError id={`${fieldId('ends')}-error`} message={shown('ends')} />
              {!shown('ends') && <p class="em-hint">{`Under the button: “${terms}”`}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function X() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
