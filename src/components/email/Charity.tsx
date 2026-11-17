/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { Email } from '@/lib/sunny-side/email.mjs';
import { kidFor, kidPhotoFor } from '@/lib/sunny-side/kids.mjs';
import { type Kid, type KidPhoto, type Parts, fieldId } from './model';
import { FieldError } from './parts';

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** A recorded reveal by its day; one dated by its photos only by month, since that's all the photos say. */
const when = (k: Kid) => {
  if (!k.revealedOn) return '';
  const d = new Date(`${k.revealedOn}T12:00:00Z`);
  return k.dated === 'recorded' ? `Revealed ${day.format(d)}` : month.format(d);
};

/** How many families and photos show before "Show all": two rows of each at desktop. */
const FAMILIES = 6;
const PHOTOS = 8;

/**
 * The charity's section: one family's makeover, in the charity's own words and photos. She taps a
 * family, then a photo of theirs; it starts on the most recent reveal and its finished room, and
 * nobody at the store writes any of it. Families and photos are pictures to tap, not a list of
 * names (Peter, 2026-11-16: the 19-name dropdown wasn't good enough). Each photo shows the way the
 * email crops it, so what she picks is what goes out.
 */
export function Charity({ parts, setParts, kids, error }: { parts: Parts; setParts: (change: (p: Parts) => Parts) => void; kids: Kid[]; error?: string }) {
  const kid = kidFor(parts.kid, kids) as Kid | null;
  const at = kid ? kids.indexOf(kid) : 0;
  const photo = kid ? (kidPhotoFor(parts.kidPhoto, kid) as KidPhoto) : null;
  const photoAt = kid && photo ? kid.photos.findIndex((p) => p.src === photo.src) : 0;
  const [allFamilies, setAllFamilies] = useState(at >= FAMILIES);
  const [allPhotos, setAllPhotos] = useState(photoAt >= PHOTOS);
  const id = fieldId('kid');
  if (!kids.length) return <FieldError id={`${id}-error`} message={error || 'The charity’s kids didn’t load. Reload the page to try again.'} />;

  const pickFamily = (k: Kid) => {
    setParts((p) => ({ ...p, kid: k.slug, kidPhoto: '' }));
    setAllPhotos(false);
  };
  // Picking a photo keeps that family, even if a newer reveal comes along before the email goes
  const pickPhoto = (k: Kid, src: string) => setParts((p) => ({ ...p, kid: k.slug, kidPhoto: src === k.photo.src ? '' : src }));

  const families = allFamilies ? kids : kids.slice(0, FAMILIES);
  const photos = kid ? (allPhotos ? kid.photos : kid.photos.slice(0, PHOTOS)) : [];

  return (
    <div class="em-charity">
      <fieldset class="em-pick" id={id} {...(error ? { "aria-describedby": `${id}-error` } : {})}>
        <legend>Family</legend>
        <FieldError id={`${id}-error`} message={error} />
        <ul class="em-families">
          {families.map((k, i) => (
            <li key={k.slug}>
              <button type="button" class="em-family" aria-pressed={k === kid} onClick={() => pickFamily(k)}>
                <span class="em-family-photo">
                  <img src={Email.photo(k.photo.src, 400, 200)} alt="" width={200} height={100} loading="lazy" decoding="async" />
                  {k === kid && <Check />}
                </span>
                <span class="em-family-name">{k.name}</span>
                <span class="em-family-when">{i === 0 ? `Most recent · ${when(k)}` : when(k)}</span>
              </button>
            </li>
          ))}
        </ul>
        {kids.length > FAMILIES && (
          <button type="button" class="btn btn-small em-pick-more" aria-expanded={allFamilies} onClick={() => setAllFamilies(!allFamilies)}>
            {allFamilies ? 'Show fewer' : `Show all ${kids.length} families`}
          </button>
        )}
      </fieldset>

      {kid && photo && (
        <fieldset class="em-pick" key={kid.slug}>
          <legend>Photo</legend>
          <p class="em-hint em-pick-hint">{kid.photo.after ? 'It starts on their finished room. Tap another photo to use it.' : 'Tap a photo to use it.'}</p>
          <ul class="em-kid-pics">
            {photos.map((p, i) => (
              <li key={p.src}>
                <button type="button" class="em-kid-pic" aria-pressed={p.src === photo.src} aria-label={`Photo ${i + 1} of ${kid.photos.length}${p.after ? ', the finished room' : ''}`} onClick={() => pickPhoto(kid, p.src)}>
                  <img src={Email.photo(p.src, 320, 160)} alt="" width={160} height={80} loading="lazy" decoding="async" />
                  {p.src === photo.src && <Check />}
                </button>
              </li>
            ))}
          </ul>
          {kid.photos.length > PHOTOS && (
            <button type="button" class="btn btn-small em-pick-more" aria-expanded={allPhotos} onClick={() => setAllPhotos(!allPhotos)}>
              {allPhotos ? 'Show fewer' : `Show all ${kid.photos.length} photos`}
            </button>
          )}
        </fieldset>
      )}

      {kid && (
        <div class="em-kid-words">
          <p>
            <strong>{kid.caption}</strong> {kid.story}
          </p>
          <p class="em-hint">
            Their words, from the charity’s site.{' '}
            <a href={kid.page} target="_blank" rel="noopener">
              Their page&nbsp;→
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

function Check() {
  return (
    <span class="em-pick-check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
