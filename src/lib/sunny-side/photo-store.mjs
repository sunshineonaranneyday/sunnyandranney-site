/**
 * The store's own photos for the weekly email, kept in R2 with a row in D1
 * ===========================================================================
 * Staff upload the week's photos on the email page; the browser shrinks each to a JPEG of at
 * most PHOTO_MAX_SIDE pixels first, so a phone's 5MB shot goes up as a few hundred KB. The file
 * sits in the PHOTOS bucket at email/<id>.jpg and the site serves it at /media/email/<id>.jpg;
 * the email asks for it through Cloudflare's resizing, cropped to each spot. Here: the row that
 * says what the photo is (its size and the words for people who can't see it), and the library.
 */

export const PHOTO_MAX_SIDE = 2400;
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export const ALT_MAX = 120;
export const ALT_DEFAULT = 'Inside the Sunny & Ranney showroom';
export const keyOf = (id) => `email/${id}.jpg`;

const SCHEMA = `CREATE TABLE IF NOT EXISTS email_photos (
  id TEXT PRIMARY KEY, w INTEGER NOT NULL, h INTEGER NOT NULL, bytes INTEGER NOT NULL,
  alt TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL)`;

const _ready = new WeakSet();
async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  _ready.add(db);
}

/** @typedef {{ id: string, w: number, h: number, alt: string, uploadedBy: string, uploadedAt: string }} Photo */

/** @returns {Photo} */
const fromRow = (r) => ({ id: r.id, w: r.w, h: r.h, alt: r.alt, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at });

/** The newest photos first. @returns {Promise<Photo[]>} */
export async function listPhotos(db, limit = 80) {
  await ensureTable(db);
  const { results } = await db.prepare('SELECT * FROM email_photos ORDER BY uploaded_at DESC, id LIMIT ?').bind(limit).all();
  return (results || []).map(fromRow);
}

/** Particular photos, whatever their age. @returns {Promise<Photo[]>} */
export async function photosByIds(db, ids) {
  await ensureTable(db);
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return [];
  const { results } = await db.prepare(`SELECT * FROM email_photos WHERE id IN (${want.map(() => '?').join(',')})`).bind(...want).all();
  return (results || []).map(fromRow);
}

export async function addPhoto(db, { id, w, h, bytes, alt, by, now }) {
  await ensureTable(db);
  await db.prepare('INSERT INTO email_photos (id, w, h, bytes, alt, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, w, h, bytes, alt, by, now).run();
}

/** Changes what a photo's alt text says. True when the photo is there. */
export async function setAlt(db, id, alt) {
  await ensureTable(db);
  return (await db.prepare('UPDATE email_photos SET alt = ? WHERE id = ?').bind(alt, id).run()).meta.changes === 1;
}

/** A tidy alt text: one line, at most ALT_MAX characters. */
export const cleanAlt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, ALT_MAX);

/** True for the bytes of a JPEG: what the browser makes, and the only thing the bucket takes. */
export const isJpeg = (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** A new photo's id: 20 random lowercase letters and digits. */
export function newPhotoId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const r = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(r, (b) => abc[b % 36]).join('');
}
