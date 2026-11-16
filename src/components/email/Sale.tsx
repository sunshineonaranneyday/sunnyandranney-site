/** @jsxImportSource preact */
import { KINDS, LIMITS, LINKS, defaults, isDiscount, termsLine } from '@/lib/sunny-side/special.mjs';
import { type Kind, type Other, type SaleForm, type Special, fieldId, tidyMoney, tidyPercent } from './model';
import { Counter, FieldError, Segmented } from './parts';

const OTHER = '__other';
/** The kinds as the switch names them: short enough for one row on a phone. */
const KIND_NAMES: Record<Kind, string> = { tiers: 'Spend more, save more', percent: 'Percent off', headline: 'No discount' };

interface Props {
  form: SaleForm;
  special: Special;
  errors: Record<string, string>;
  shown: (key: string) => string | undefined;
  set: (patch: Partial<SaleForm>) => void;
  touch: (key: string) => void;
  others: Other[];
  startFrom: (send: string) => void;
}

export function Sale({ form, special, errors, shown, set, touch, others, startFrom }: Props) {
  const kind = form.kind;
  const d = defaults(kind || 'tiers', special.what);
  const terms = termsLine({ ...special, ends: errors.ends ? '' : special.ends });
  const invalid = (key: string) => (shown(key) ? { 'aria-invalid': true, 'aria-describedby': `${fieldId(key)}-error` } : {});
  const setTier = (k: number, patch: Partial<SaleForm['tiers'][number]>) => set({ tiers: form.tiers.map((t, i) => (i === k ? { ...t, ...patch } : t)) });
  const addTier = () => {
    set({ tiers: [...form.tiers, { spend: '', percent: '' }] });
    window.setTimeout(() => document.getElementById(fieldId(`tiers.${form.tiers.length}.spend`))?.focus(), 0);
  };
  const linkChoice = form.linkOther ? OTHER : form.link;
  const linkName = form.linkOther ? form.link || 'another page' : (LINKS.find((l) => l.path === (form.link || d.link))?.label ?? form.link);
  // The extras open by themselves when anything in them was changed or needs fixing.
  const extrasChanged = Boolean(form.cta || form.link || form.linkOther || form.label || form.details);
  const extrasWrong = ['details', 'cta', 'link', 'label'].some((k) => shown(k));

  return (
    <>
      <div class="em-section-tools">
        {others.length > 0 && (
          <select
            class="em-copy"
            aria-label="Start from another week’s special"
            value=""
            onChange={(e) => {
              startFrom((e.target as HTMLSelectElement).value);
              (e.target as HTMLSelectElement).value = '';
            }}
          >
            <option value="">Copy another week’s…</option>
            {others.map((o) => (
              <option value={o.send}>
                {o.label}: {o.summary}
              </option>
            ))}
          </select>
        )}
      </div>

      <Segmented
        id={fieldId('kind')}
        legend="What kind of special?"
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
            <div class="em-percent">
              <div class="field">
                <label for={fieldId('percent')}>Percent off</label>
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
              <div class="field">
                <label for={fieldId('what')}>
                  Off what <Counter value={form.what} limit={LIMITS.what} />
                </label>
                <input id={fieldId('what')} value={form.what} onInput={(e) => set({ what: (e.target as HTMLInputElement).value })} onBlur={() => touch('what')} {...invalid('what')} />
                <FieldError id={`${fieldId('what')}-error`} message={shown('what')} />
                {!shown('what') && <p class="em-hint">Like everything, all rugs, or lighting.</p>}
              </div>
            </div>
          )}

          {isDiscount(kind) && (
            <div class="em-terms">
              <div class="field em-ends">
                <label for={fieldId('ends')}>Last day</label>
                <input id={fieldId('ends')} type="date" value={form.ends} onInput={(e) => set({ ends: (e.target as HTMLInputElement).value })} onBlur={() => touch('ends')} {...invalid('ends')} />
                <FieldError id={`${fieldId('ends')}-error`} message={shown('ends')} />
              </div>
              <p class="em-hint em-terms-line">{`Under the button: “${terms}”`}</p>
            </div>
          )}

          <details class="em-extras" open={extrasChanged || extrasWrong}>
            <summary>
              <span class="em-extras-title">Button, label and fine print</span>
              <span class="em-extras-now">
                “{form.cta || d.cta}” → {linkName}
                {form.details ? ' · fine print added' : ''}
              </span>
            </summary>
            <div class="em-extras-body">
              <div class="field-row">
                <div class="field">
                  <label for={fieldId('cta')}>
                    Button says <Counter value={form.cta} limit={LIMITS.cta} />
                  </label>
                  <input id={fieldId('cta')} value={form.cta} placeholder={d.cta} onInput={(e) => set({ cta: (e.target as HTMLInputElement).value })} onBlur={() => touch('cta')} {...invalid('cta')} />
                  <FieldError id={`${fieldId('cta')}-error`} message={shown('cta')} />
                </div>
                <div class="field">
                  <label for={fieldId('link')}>Button goes to</label>
                  <select
                    id={fieldId('link')}
                    value={linkChoice}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      set(v === OTHER ? { linkOther: true, link: '' } : { linkOther: false, link: v });
                      if (v === OTHER) window.setTimeout(() => document.getElementById(fieldId('link-path'))?.focus(), 0);
                    }}
                    {...(form.linkOther ? {} : invalid('link'))}
                  >
                    <option value="">Usual: {LINKS.find((l) => l.path === d.link)?.label}</option>
                    {LINKS.map((l) => (
                      <option value={l.path}>{l.label}</option>
                    ))}
                    <option value={OTHER}>Another page on the site…</option>
                  </select>
                  {form.linkOther && (
                    <input
                      id={fieldId('link-path')}
                      class="em-path"
                      aria-label="The page’s address on sunnyandranney.com"
                      value={form.link}
                      placeholder="/shop/?collection=rugs"
                      onInput={(e) => set({ link: (e.target as HTMLInputElement).value })}
                      onBlur={() => touch('link')}
                      {...invalid('link')}
                    />
                  )}
                  <FieldError id={`${fieldId('link')}-error`} message={shown('link')} />
                </div>
              </div>
              <div class="field">
                <label for={fieldId('label')}>
                  Small label over the headline <Counter value={form.label} limit={LIMITS.label} />
                </label>
                <input id={fieldId('label')} value={form.label} placeholder={d.label} onInput={(e) => set({ label: (e.target as HTMLInputElement).value })} onBlur={() => touch('label')} {...invalid('label')} />
                <FieldError id={`${fieldId('label')}-error`} message={shown('label')} />
              </div>
              <div class="field">
                <label for={fieldId('details')}>
                  {isDiscount(kind) ? 'More fine print' : 'Fine print'} <Counter value={form.details} limit={LIMITS.details} />
                </label>
                <input id={fieldId('details')} value={form.details} onInput={(e) => set({ details: (e.target as HTMLInputElement).value })} onBlur={() => touch('details')} {...invalid('details')} />
                <FieldError id={`${fieldId('details')}-error`} message={shown('details')} />
                {!shown('details') && <p class="em-hint">{isDiscount(kind) ? 'Anything else customers should know, after the terms. Like “Can’t be combined with other offers.”' : 'Like “Free gift wrap all week.”'}</p>}
              </div>
            </div>
          </details>
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
