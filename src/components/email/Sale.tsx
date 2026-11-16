/** @jsxImportSource preact */
import { KINDS, LIMITS, isDiscount, termsLine } from '@/lib/sunny-side/special.mjs';
import { type Kind, type LastSale, type SaleForm, type Special, fieldId, tidyMoney, tidyPercent } from './model';
import { Counter, FieldError, Segmented } from './parts';

/** The kinds as the switch names them: short enough for one row on a phone. */
const KIND_NAMES: Record<Kind, string> = { tiers: 'Spend more, save more', percent: 'Percent off', headline: 'No sale' };

interface Props {
  form: SaleForm;
  special: Special;
  errors: Record<string, string>;
  shown: (key: string) => string | undefined;
  set: (patch: Partial<SaleForm>) => void;
  touch: (key: string) => void;
  last: LastSale | null;
  startFromLast: () => void;
}

/**
 * The week's sale: the deal, a headline, the last day, and nothing else. The small label, the
 * button and the fine print are the store's own for each kind (special.mjs, defaults), and the
 * preview beside it shows them.
 */
export function Sale({ form, special, errors, shown, set, touch, last, startFromLast }: Props) {
  const kind = form.kind;
  const terms = termsLine({ ...special, ends: errors.ends ? '' : special.ends });
  const invalid = (key: string) => (shown(key) ? { 'aria-invalid': true, 'aria-describedby': `${fieldId(key)}-error` } : {});
  const setTier = (k: number, patch: Partial<SaleForm['tiers'][number]>) => set({ tiers: form.tiers.map((t, i) => (i === k ? { ...t, ...patch } : t)) });
  const addTier = () => {
    set({ tiers: [...form.tiers, { spend: '', percent: '' }] });
    window.setTimeout(() => document.getElementById(fieldId(`tiers.${form.tiers.length}.spend`))?.focus(), 0);
  };

  return (
    <>
      {kind === '' && last && (
        <div class="em-last">
          <p class="em-last-what">
            <strong>{last.label}:</strong> {last.summary}
          </p>
          <button type="button" class="btn btn-small" aria-label={`Use the ${last.label} sale again`} onClick={startFromLast}>
            Use it again
          </button>
        </div>
      )}

      <Segmented
        id={fieldId('kind')}
        legend="This week’s sale"
        name="kind"
        value={kind}
        options={(Object.keys(KINDS) as Kind[]).map((k) => ({ value: k, label: KIND_NAMES[k], hint: KINDS[k].hint }))}
        onChange={(k) => set({ kind: k as Kind })}
        error={shown('kind')}
      />

      {kind !== '' && (
        <div class="em-sale-body">
          {kind !== 'percent' && (
            <div class="field">
              <label for={fieldId('headline')}>
                Headline <Counter value={form.headline} limit={LIMITS.headline} />
              </label>
              <input
                id={fieldId('headline')}
                value={form.headline}
                onInput={(e) => set({ headline: (e.target as HTMLInputElement).value })}
                onBlur={() => touch('headline')}
                {...invalid('headline')}
              />
              <FieldError id={`${fieldId('headline')}-error`} message={shown('headline')} />
              {!shown('headline') && <p class="em-hint">{kind === 'tiers' ? 'Like “The holidays are here. So are the savings.”' : 'Like “Black Friday sneak peeks start this Friday.”'}</p>}
            </div>
          )}

          {kind === 'tiers' && (
            <fieldset class="em-tiers" id={fieldId('tiers')}>
              <legend>The tiers</legend>
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
              <span class="em-hint em-inline">
                {form.tiers.length >= LIMITS.tiers[1] ? `${LIMITS.tiers[1]} tiers is the most the email shows.` : `${LIMITS.tiers[0]} to ${LIMITS.tiers[1]} tiers, smallest first.`}
              </span>
              <FieldError id={`${fieldId('tiers')}-error`} message={shown('tiers')} />
            </fieldset>
          )}

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

          {isDiscount(kind) && (
            <div class="field em-ends">
              <label for={fieldId('ends')}>Last day</label>
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
