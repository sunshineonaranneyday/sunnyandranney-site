import type { APIRoute } from 'astro';
import { dbOf, json, readJson, requireRole } from '@/lib/admin-http';
import { PHOTO_ID } from '@/lib/sunny-side/parts.mjs';
import { ALT_DEFAULT, FOCUS, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, addPhoto, cleanAlt, cleanFocus, deletePhoto, isJpeg, keyOf, newPhotoId, setAlt, setFocus } from '@/lib/sunny-side/photo-store.mjs';
import { photoInKitEmail } from '@/lib/sunny-side/week-store.mjs';

export const prerender = false;

/**
 * Takes one photo for the weekly email: a JPEG the page has already shrunk to PHOTO_MAX_SIDE
 * pixels or less, with its width and height. Managers and email-only logins. Goes into the PHOTOS bucket and the
 * library, ready to be the top photo or part of the story's collage.
 */
export const POST: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const bucket = context.locals.runtime.env.PHOTOS;
  if (!bucket) return json({ error: 'Photo uploads aren’t set up yet: the site has no PHOTOS bucket.' }, 503);

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'That upload didn’t come through. Try again.' }, 400);
  }
  const file = form.get('photo');
  const w = Number(form.get('w'));
  const h = Number(form.get('h'));
  if (!(file instanceof File) || !file.size) return json({ error: 'No photo came with that upload.' }, 400);
  if (file.size > PHOTO_MAX_BYTES) return json({ error: 'That photo is too big. Try it again: the page shrinks photos before they go up.' }, 413);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 200 || h < 200 || w > PHOTO_MAX_SIDE || h > PHOTO_MAX_SIDE) {
    return json({ error: 'That photo is too small to use: it needs to be at least 200 pixels on each side.' }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return json({ error: 'Only photos can go up here.' }, 415);

  const id = newPhotoId();
  await bucket.put(keyOf(id), bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
  const now = new Date().toISOString();
  const alt = cleanAlt(form.get('alt')) || ALT_DEFAULT;
  await addPhoto(dbOf(context), { id, w, h, bytes: bytes.length, alt, by: admin.email, now });
  return json({ ok: true, photo: { id, w, h, alt, focus: '', uploadedBy: admin.email, uploadedAt: now } });
};

/**
 * Changes what the library says about a photo: the words saying what's in it, for people who can't
 * see images ({ id, alt }), or the part of it every crop keeps in view ({ id, focus: "0.42x0.31", or
 * '' to leave it to the resizing }). Managers and email-only logins.
 */
export const PUT: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const body = await readJson(context.request);
  const id = typeof body?.id === 'string' ? body.id : '';
  const db = dbOf(context);
  if (body && 'focus' in body) {
    const focus = body.focus === '' ? '' : typeof body.focus === 'string' && FOCUS.test(body.focus) ? cleanFocus(body.focus) : null;
    if (focus === null) return json({ error: 'That spot isn’t on the photo. Tap the photo again.' }, 422);
    if (!(await setFocus(db, id, focus))) return json({ error: 'That photo isn’t in the library anymore.' }, 404);
    return json({ ok: true, id, focus });
  }
  const alt = cleanAlt(body?.alt);
  if (!alt) return json({ error: 'Say in a few words what’s in the photo.' }, 422);
  if (!(await setAlt(db, id, alt))) return json({ error: 'That photo isn’t in the library anymore.' }, 404);
  return json({ ok: true, id, alt });
};

/**
 * Deletes a photo the store doesn't need ({ id }): it leaves the library, so the page never shows it
 * again. Its file goes too, unless an email scheduled or sent through Kit uses it: that email asks the
 * site for the photo whenever someone opens it, so the file stays for the inboxes that have it.
 * The week being worked on drops it on the page, and its next Save leaves it out; until then the
 * send checks refuse an email whose photo is gone (checkParts). Managers and email-only logins.
 */
export const DELETE: APIRoute = async (context) => {
  const admin = requireRole(context.locals, 'manager', 'email');
  if (admin instanceof Response) return admin;
  const body = await readJson(context.request);
  const id = typeof body?.id === 'string' && PHOTO_ID.test(body.id) ? body.id : '';
  // `gone` tells the page it's out of the library already (deleted on another page), as it would be now
  const gone = () => json({ error: 'That photo isn’t in the library anymore.', gone: true }, 404);
  if (!id) return gone();
  const db = dbOf(context);
  const kept = await photoInKitEmail(db, id);
  if (!(await deletePhoto(db, id))) return gone();
  if (!kept) await context.locals.runtime.env.PHOTOS?.delete(keyOf(id));
  return json({ ok: true, id, kept });
};
