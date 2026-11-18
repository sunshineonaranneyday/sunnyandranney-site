/** @jsxImportSource preact */
import { Email } from '@/lib/sunny-side/email.mjs';
import { Check } from './Charity';
import { type Parts, type Reveal } from './model';
import { FieldError } from './parts';

type SetParts = (change: (p: Parts) => Parts) => void;

/**
 * The reveal: a charity reveal still ahead, or none. It's its own section of the email, right after
 * the products: the charity's invite to watch it live, in its own words, photo, day and time
 * (kids.mjs), so there's nothing to write. Picking one never takes the photos out of the email.
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
            The charity’s words, photo, day and time, right after the products. Readers can add it to their calendar (just the day and the link to watch, never the family’s address) or get an email when it starts.{' '}
            <a href={picked.live} target="_blank" rel="noopener">
              The reveal page&nbsp;→
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
