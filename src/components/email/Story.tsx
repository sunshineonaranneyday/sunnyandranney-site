/** @jsxImportSource preact */
import { Email } from '@/lib/sunny-side/email.mjs';
import { PART_LIMITS, STORY_DEFAULTS } from '@/lib/sunny-side/parts.mjs';
import { Check } from './Charity';
import { type Parts, type Reveal, fieldId } from './model';
import { FieldError, TextField } from './parts';

/**
 * The story spot, under the products: what's new in the showroom this week (its photos are the
 * collage, picked in Photos), or, in a week with a charity reveal coming, the charity's invite to watch it live.
 * The invite is the charity's own words, photo, day and time (kids.mjs), so there's nothing to write.
 */
export function Story({ parts, setParts, shown, reveals }: { parts: Parts; setParts: (change: (p: Parts) => Parts) => void; shown: (key: string) => string | undefined; reveals: Reveal[] }) {
  const s = parts.story;
  const set = (patch: Partial<Parts['story']>) => setParts((p) => ({ ...p, story: { ...p.story, ...patch } }));
  const picked = s.reveal ? (reveals.find((r) => r.slug === s.reveal) ?? null) : null;
  const pickId = fieldId('story.reveal');
  const pickError = shown('story.reveal');
  return (
    <div class="em-story">
      {(reveals.length > 0 || s.reveal) && (
        <fieldset class="em-pick" id={pickId} {...(pickError ? { 'aria-describedby': `${pickId}-error` } : {})}>
          <legend>In this spot</legend>
          <FieldError id={`${pickId}-error`} message={pickError} />
          <ul class="em-families">
            <li>
              <button type="button" class="em-family" aria-pressed={!s.reveal} onClick={() => set({ reveal: '' })}>
                <span class="em-family-photo">
                  <span class="em-story-own">Your words and photos</span>
                  {!s.reveal && <Check />}
                </span>
                <span class="em-family-name">The showroom story</span>
                <span class="em-family-when">What’s new on the floor</span>
              </button>
            </li>
            {reveals.map((r) => (
              <li key={r.slug}>
                <button type="button" class="em-family" aria-pressed={s.reveal === r.slug} onClick={() => set({ reveal: r.slug })}>
                  <span class="em-family-photo">
                    <img src={Email.photo(r.photo.src, 400, 200)} alt="" width={200} height={100} loading="lazy" decoding="async" />
                    {s.reveal === r.slug && <Check />}
                  </span>
                  <span class="em-family-name">{r.name}’s reveal</span>
                  <span class="em-family-when">
                    {r.short}, {r.time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {picked ? (
        <div class="em-kid-words">
          <p>
            <strong>Join us live for {picked.name}’s Reveal Day.</strong> {picked.long} at {picked.time}, live on the charity’s website. {picked.story}
          </p>
          <p class="em-hint">
            The charity’s words, photo, day and time. Readers can add it to their calendar (just the day and the link to watch, never the family’s address) or get an email when it starts. The showroom story stays saved for another week.{' '}
            <a href={picked.live} target="_blank" rel="noopener">
              The reveal page&nbsp;→
            </a>
          </p>
        </div>
      ) : (
        <>
          <TextField id={fieldId('story.label')} label="Small label" value={s.label} limit={PART_LIMITS.label} placeholder={STORY_DEFAULTS.label} onInput={(v) => set({ label: v })} error={shown('story.label')} />
          <TextField id={fieldId('story.headline')} label="Headline" value={s.headline} limit={PART_LIMITS.headline} onInput={(v) => set({ headline: v })} error={shown('story.headline')} hint="Like “Christmas is here.”" />
          <TextField id={fieldId('story.body')} label="The story" value={s.body} limit={PART_LIMITS.body} rows={4} onInput={(v) => set({ body: v })} error={shown('story.body')} hint="Two or three sentences about what’s new on the floor." />
          <div class="field-row">
            <TextField id={fieldId('story.cta')} label="Link’s words" value={s.cta} limit={PART_LIMITS.cta} placeholder={STORY_DEFAULTS.cta} onInput={(v) => set({ cta: v })} error={shown('story.cta')} />
            <TextField id={fieldId('story.link')} label="Goes to" value={s.link} placeholder={STORY_DEFAULTS.link} onInput={(v) => set({ link: v })} error={shown('story.link')} hint="A page on sunnyandranney.com." />
          </div>
        </>
      )}
    </div>
  );
}
