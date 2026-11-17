/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { photoPath } from '@/lib/sunny-side/addresses.mjs';
import { layoutFor, ratioOf } from '@/lib/sunny-side/collage-layouts.mjs';
import { Email } from '@/lib/sunny-side/email.mjs';
import { COLLAGE_MAX, DEFAULT_HERO } from '@/lib/sunny-side/parts.mjs';
import { ALT_DEFAULT, PHOTO_MAX_SIDE } from '@/lib/sunny-side/photo-store.mjs';
import { type Parts, type Photo, send as call, toast } from './model';
import { CollageLayouts } from './Layouts';
import { FieldError } from './parts';

/** A photo as the page shows it: straight from the site on a developer's machine, else cropped by the resizing. */
export const photoThumb = (id: string, w: number, h: number, local: boolean) => (local ? photoPath(id) : Email.photo(`photo:${id}`, w, h));

/** Shrinks a photo in the browser to a JPEG at most PHOTO_MAX_SIDE across, turned the way it was taken. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${file.name} is in a format this browser can’t open. On an iPhone, pick it in Safari; on a computer, save it as a JPEG first.`);
  }
  const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
  if (!blob) throw new Error(`${file.name} couldn’t be made ready to upload.`);
  return { blob, w, h };
}

interface Props {
  photos: Photo[];
  setPhotos: (p: Photo[]) => void;
  parts: Parts;
  setParts: (change: (p: Parts) => Parts) => void;
  error?: string;
  local: boolean;
}

/** True when what's being dragged holds files (not text or a link from the page). */
const holdsFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));

/**
 * The week's photos: uploaded from a phone or computer (the button, or dragged onto the section),
 * kept in the store's library, and used as the email's top photo and the story's collage. Each has
 * a few words for people who can't see it.
 */
export function Photos({ photos, setPhotos, parts, setParts, error, local }: Props) {
  const [uploading, setUploading] = useState<{ done: number; of: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  // Files held over the section: counted, since dragging over each photo inside enters and leaves it
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
  // A photo let go anywhere else on the page would open in its place and lose unsaved work
  useEffect(() => {
    const hold = (e: DragEvent) => {
      if (holdsFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragover', hold);
    window.addEventListener('drop', hold);
    return () => {
      window.removeEventListener('dragover', hold);
      window.removeEventListener('drop', hold);
    };
  }, []);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const story = parts.story.photos;
  // The layout the email draws the collage in: hers, or the one that keeps the most of these photos
  const layout = story.length ? layoutFor(parts.story.layout, story.map((id) => ratioOf(byId.get(id)))) : undefined;
  const setStory = (change: (ids: string[]) => string[]) => setParts((p) => ({ ...p, story: { ...p.story, photos: change(p.story.photos) } }));

  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setProblem(null);
    const all = [...files];
    const list = all.filter((f) => f.type.startsWith('image/'));
    const skipped = all.length - list.length;
    if (skipped) setProblem(`${skipped === 1 ? `${all.find((f) => !f.type.startsWith('image/'))!.name} isn’t a photo` : `${skipped} of those aren’t photos`}, so ${skipped === 1 ? 'it was' : 'they were'} left out.`);
    if (!list.length) return;
    let added: Photo[] = [];
    setUploading({ done: 0, of: list.length });
    for (const [k, file] of list.entries()) {
      try {
        const { blob, w, h } = await shrink(file);
        const form = new FormData();
        form.append('photo', blob, 'photo.jpg');
        form.append('w', String(w));
        form.append('h', String(h));
        form.append('alt', ALT_DEFAULT);
        const res = await fetch('/api/admin/email/photos/', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as { photo?: Photo; error?: string };
        if (!res.ok || !data.photo) throw new Error(data.error || `${file.name} didn’t upload. Try again.`);
        added = [data.photo, ...added];
      } catch (err) {
        setProblem(err instanceof Error ? err.message : String(err));
      }
      setUploading({ done: k + 1, of: list.length });
    }
    setUploading(null);
    if (added.length) {
      setPhotos([...added, ...photos]);
      // New photos go into the story while it has room
      setStory((ids) => [...ids, ...added.map((p) => p.id)].slice(0, Math.max(ids.length, COLLAGE_MAX)));
      toast(`Added ${added.length} photo${added.length === 1 ? '' : 's'}`);
    }
  }

  async function saveAlt(p: Photo) {
    const alt = (alts[p.id] ?? p.alt).trim();
    if (alt === p.alt) return;
    const res = await call<{ alt: string }>('/api/admin/email/photos/', 'PUT', { id: p.id, alt });
    if (!res.ok) return setProblem(res.error);
    setPhotos(photos.map((x) => (x.id === p.id ? { ...x, alt: res.body.alt } : x)));
  }

  const toggleStory = (id: string) => {
    if (story.includes(id)) setStory((ids) => ids.filter((x) => x !== id));
    else if (story.length < COLLAGE_MAX) setStory((ids) => [...ids, id]);
    else toast(`The collage holds ${COLLAGE_MAX} photos. Take one out first.`);
  };
  const move = (k: number, by: number) =>
    setStory((ids) => {
      const next = [...ids];
      const [it] = next.splice(k, 1);
      next.splice(k + by, 0, it);
      return next;
    });
  const shown = showAll ? photos : photos.slice(0, 12);

  const drag = {
    onDragEnter: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDropping(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDropping(false);
    },
    onDrop: (e: DragEvent) => {
      if (!holdsFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDropping(false);
      if (uploading) return toast('Wait for these photos to finish, then add more.');
      void upload(e.dataTransfer ? [...e.dataTransfer.files] : null);
    },
  };

  return (
    <div class={`em-photos${dropping ? ' is-dropping' : ''}`} {...drag}>
      {dropping && (
        <div class="em-drop" aria-hidden="true">
          <span class="em-drop-label">{uploading ? 'Wait for these photos to finish' : 'Drop to add these photos'}</span>
        </div>
      )}
      {/* Where photos go, in plain sight (Shopify's drop zone: a dashed box, its button, "or drop files"):
          drag them onto it, or anywhere on the section, or click anywhere in it to choose them */}
      <label class={`em-dropzone${uploading ? ' is-busy' : ''}`}>
        <input type="file" accept="image/*" multiple disabled={Boolean(uploading)} onChange={(e) => void upload((e.target as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = ''))} />
        <span class="btn btn-dark">{uploading ? `Uploading ${uploading.done + 1 > uploading.of ? uploading.of : uploading.done + 1} of ${uploading.of}…` : 'Add photos'}</span>
        <span class="em-dropzone-or">or drag them here</span>
        <span class="em-dropzone-hint">For the top photo and the story’s collage. Photos from a phone are made smaller before they go up.</span>
      </label>
      {problem && (
        <p class="em-error" role="alert">
          {problem}
        </p>
      )}
      <FieldError id="em-photos-error" message={error} />

      <fieldset class="em-collage">
        <legend>The story’s collage{layout ? ` · ${layout.name}` : ''}</legend>
        {story.length ? (
          <CollageLayouts
            ids={story}
            byId={byId}
            chosen={parts.story.layout}
            setChosen={(id) => setParts((p) => ({ ...p, story: { ...p.story, layout: id } }))}
            setOrder={(ids) => setStory(() => ids)}
            move={move}
            local={local}
          />
        ) : (
          <p class="em-hint">Tick “In the story” on up to {COLLAGE_MAX} photos below.</p>
        )}
      </fieldset>

      <ul class="em-library" aria-label="The store’s photos">
        <li class={`em-photo${parts.hero ? '' : ' is-hero'}`}>
          <span class="em-photo-img">
            <img src={Email.photo(DEFAULT_HERO.src, 480, 480)} alt="" loading="lazy" />
          </span>
          <span class="em-photo-name">The store’s wide shot</span>
          <label class="check">
            <input type="radio" name="em-hero" checked={!parts.hero} onChange={() => setParts((x) => ({ ...x, hero: '' }))} /> Top photo
          </label>
        </li>
        {shown.map((p) => (
          <li class={`em-photo${parts.hero === p.id ? ' is-hero' : ''}${story.includes(p.id) ? ' is-story' : ''}`}>
            <span class="em-photo-img">
              <img src={photoThumb(p.id, 480, 480, local)} alt="" loading="lazy" />
              {story.includes(p.id) && <span class="em-collage-n">{story.indexOf(p.id) + 1}</span>}
            </span>
            <input
              class="em-photo-alt"
              aria-label="What’s in this photo, for people who can’t see it"
              value={alts[p.id] ?? p.alt}
              maxLength={120}
              onInput={(e) => setAlts({ ...alts, [p.id]: (e.target as HTMLInputElement).value })}
              onBlur={() => void saveAlt(p)}
            />
            <label class="check">
              <input type="radio" name="em-hero" checked={parts.hero === p.id} onChange={() => setParts((x) => ({ ...x, hero: p.id }))} /> Top photo
            </label>
            <label class="check">
              <input type="checkbox" checked={story.includes(p.id)} onChange={() => toggleStory(p.id)} /> In the story
            </label>
          </li>
        ))}
      </ul>
      {photos.length > 12 && (
        <button type="button" class="btn btn-small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${photos.length} photos`}
        </button>
      )}
    </div>
  );
}
