/** @jsxImportSource preact */
import { Email } from '@/lib/sunny-side/email.mjs';
import { kidFor } from '@/lib/sunny-side/kids.mjs';
import { type Kid, type Parts, fieldId } from './model';
import { FieldError } from './parts';

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** A recorded reveal by its day; one dated by its photos only by month, since that's all the photos say. */
const when = (k: Kid) => {
  if (!k.revealedOn) return '';
  const d = new Date(`${k.revealedOn}T12:00:00Z`);
  return k.dated === 'recorded' ? `revealed ${day.format(d)}` : month.format(d);
};

/**
 * The charity's section: one family's makeover, in the charity's own words and photo, picked from
 * its kids. It starts on the most recent reveal; nobody at the store writes any of it.
 */
export function Charity({ parts, setParts, kids, error }: { parts: Parts; setParts: (change: (p: Parts) => Parts) => void; kids: Kid[]; error?: string }) {
  const kid = kidFor(parts.kid, kids) as Kid | null;
  const id = fieldId('kid');
  if (!kids.length) return <FieldError id={`${id}-error`} message={error || 'The charity’s kids didn’t load. Reload the page to try again.'} />;
  return (
    <div class="em-charity">
      <div class="field">
        <label for={id}>Family</label>
        <select id={id} value={parts.kid} onChange={(e) => setParts((p) => ({ ...p, kid: (e.target as HTMLSelectElement).value }))} {...(error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {})}>
          <option value="">Most recent reveal: {kids[0].name}</option>
          {kids.map((k) => (
            <option value={k.slug}>
              {k.name}
              {k.revealedOn ? ` · ${when(k)}` : ''}
            </option>
          ))}
        </select>
        <FieldError id={`${id}-error`} message={error} />
      </div>
      {kid && (
        <figure class="em-kid" key={kid.slug}>
          <img src={Email.photo(kid.photo.src, 560, 316)} alt="" width={280} height={158} />
          <figcaption>
            <span class="em-kid-caption">{kid.caption}</span>
            <span class="em-kid-story">{kid.story}</span>
            <a href={kid.page} target="_blank" rel="noopener" class="em-kid-link">
              Their page on the charity’s site →
            </a>
          </figcaption>
        </figure>
      )}
      <p class="em-hint">The photo and words come from the charity’s site, as they appear there.</p>
    </div>
  );
}
