/** @jsxImportSource preact */
import { Email } from '@/lib/sunny-side/email.mjs';
import { PART_LIMITS, STORY_DEFAULTS } from '@/lib/sunny-side/parts.mjs';
import { Check } from './Charity';
import { type Parts, type Reveal, fieldId } from './model';
import { FieldError, TextField } from './parts';

type SetParts = (change: (p: Parts) => Parts) => void;

/**
 * The reveal: a charity reveal still ahead, or none. It's its own section of the email, under the
 * story: the charity's invite to watch it live, in its own words, photo, day and time (kids.mjs), so
 * there's nothing to write. Picking one never takes the story or its photos out of the email.
 */
export function RevealPick({ parts, setParts, shown, reveals }: { parts: Parts; setParts: SetParts; shown: (key: string) => string | undefined; reveals: Reveal[] }) {
  const set = (reveal: string) => setParts((p) => ({ ...p, reveal }));
  const picked = parts.reveal ? (reveals.find((r) => r.slug === parts.reveal) ?? null) : null;
  // Its error's link goes to the section itself (em-reveal), as Photos' does: a field here with that id would be a second one
  const errorId = 'em-reveal-error';
  const pickError = shown('reveal');
  if (!reveals.length && !parts.reveal) return <p class="em-hint">The charity has no reveals coming up, so this email goes without one.</p>;
  return (
    <div class="em-story">
      <fieldset class="em-pick" {...(pickError ? { 'aria-describedby': errorId } : {})}>
        <legend>Invite readers to watch a reveal live</legend>
        <FieldError id={errorId} message={pickError} />
        <ul class="em-families">
          <li>
            <button type="button" class="em-family" aria-pressed={!parts.reveal} onClick={() => set('')}>
              <span class="em-family-photo">
                <span class="em-story-own">No reveal</span>
                {!parts.reveal && <Check />}
              </span>
              <span class="em-family-name">None this week</span>
              <span class="em-family-when">The email goes without one</span>
            </button>
          </li>
          {reveals.map((r) => (
            <li key={r.slug}>
              <button type="button" class="em-family" aria-pressed={parts.reveal === r.slug} onClick={() => set(r.slug)}>
                <span class="em-family-photo">
                  <img src={Email.photo(r.photo.src, 400, 200)} alt="" width={200} height={100} loading="lazy" decoding="async" />
                  {parts.reveal === r.slug && <Check />}
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
      {picked && (
        <div class="em-kid-words">
          <p>
            <strong>Join us live for {picked.name}’s Reveal Day.</strong> {picked.long} at {picked.time}, live on the charity’s website. {picked.story}
          </p>
          <p class="em-hint">
            The charity’s words, photo, day and time, under the story. Readers can add it to their calendar (just the day and the link to watch, never the family’s address) or get an email when it starts.{' '}
            <a href={picked.live} target="_blank" rel="noopener">
              The reveal page&nbsp;→
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

/** The story: what's new in the showroom this week. Its photos are the collage, in Photos. */
export function Story({ parts, setParts, shown }: { parts: Parts; setParts: SetParts; shown: (key: string) => string | undefined }) {
  const s = parts.story;
  const set = (patch: Partial<Parts['story']>) => setParts((p) => ({ ...p, story: { ...p.story, ...patch } }));
  return (
    <div class="em-story">
      <TextField id={fieldId('story.label')} label="Small label" value={s.label} limit={PART_LIMITS.label} placeholder={STORY_DEFAULTS.label} onInput={(v) => set({ label: v })} error={shown('story.label')} />
      <TextField id={fieldId('story.headline')} label="Headline" value={s.headline} limit={PART_LIMITS.headline} onInput={(v) => set({ headline: v })} error={shown('story.headline')} hint="Like “Christmas is here.”" />
      <TextField id={fieldId('story.body')} label="The story" value={s.body} limit={PART_LIMITS.body} rows={4} onInput={(v) => set({ body: v })} error={shown('story.body')} hint="Two or three sentences about what’s new on the floor. Its photos are the collage, in Photos." />
      <div class="field-row">
        <TextField id={fieldId('story.cta')} label="Link’s words" value={s.cta} limit={PART_LIMITS.cta} placeholder={STORY_DEFAULTS.cta} onInput={(v) => set({ cta: v })} error={shown('story.cta')} />
        <TextField id={fieldId('story.link')} label="Goes to" value={s.link} placeholder={STORY_DEFAULTS.link} onInput={(v) => set({ link: v })} error={shown('story.link')} hint="A page on sunnyandranney.com." />
      </div>
    </div>
  );
}
