/** @jsxImportSource preact */
import { LIMITS, USUAL_PERCENT, isDiscount, termsLine } from '@/lib/sunny-side/special.mjs';
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
}

const money = (n: number) => n.toLocaleString('en-US');
const filled = (tiers: SaleForm['tiers']) => tiers.some((t) => t.spend.trim() || t.percent.trim());

/**
 * The week's sale: three ready-made sales, already filled in. She taps one and changes a number
 * if she needs to; the last day comes set to the week's Sunday. Spend more, save more starts on the
 * last amounts saved here, else the store's own from its Nov 3 email (Peter, 2026-11-16: "why
 * doesn't this have info already filled in"). Nothing to write: the label, the
 * words, the button and the fine print are the store's for each (special.mjs, defaults), and the
 * preview beside it shows them. (Peter, 2026-11-16: "pick a ready-made sale".)
 */
export function Sale({ form, special, errors, shown, set, touch, presets }: Props) {
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
    else set({ kind: k });
  };

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

          <div class="field em-ends">
            <label for={fieldId('ends')}>Ends</label>
            <input id={fieldId('ends')} type="date" value={form.ends} onInput={(e) => set({ ends: (e.target as HTMLInputElement).value })} onBlur={() => touch('ends')} {...invalid('ends')} />
            <FieldError id={`${fieldId('ends')}-error`} message={shown('ends')} />
            {!shown('ends') && <p class="em-hint">{`Under the button: “${terms}”`}</p>}
          </div>
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
