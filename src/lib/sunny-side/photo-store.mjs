/**
 * The store's own photos for the weekly email, kept in R2 with a row in D1
 * ===========================================================================
 * Staff upload the week's photos on the email page; the browser shrinks each to a JPEG of at
 * most PHOTO_MAX_SIDE pixels first, so a phone's 5MB shot goes up as a few hundred KB. The file
 * sits in the PHOTOS bucket at email/<id>.jpg and the site serves it at /media/email/<id>.jpg/ (photoPath);
 * the email asks for it through Cloudflare's resizing, cropped to each spot. Here: the row that
 * says what the photo is (its size, the words for people who can't see it, and the part of it every
 * crop keeps in view), and the library.
 */

export const PHOTO_MAX_SIDE = 2400;
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export const ALT_MAX = 120;
export const ALT_DEFAULT = 'Inside the Sunny & Ranney showroom';
export const keyOf = (id) => `email/${id}.jpg`;

const SCHEMA = `CREATE TABLE IF NOT EXISTS email_photos (
  id TEXT PRIMARY KEY, w INTEGER NOT NULL, h INTEGER NOT NULL, bytes INTEGER NOT NULL,
  alt TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL, focus TEXT NOT NULL DEFAULT '')`;

const _ready = new WeakSet();
async function ensureTable(db) {
  if (_ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  // Added since the table was first made: the part of the photo every crop keeps in view
  const { results: cols } = await db.prepare('PRAGMA table_info(email_photos)').all();
  if (!(cols || []).some((c) => c.name === 'focus')) {
    try {
      await db.prepare("ALTER TABLE email_photos ADD COLUMN focus TEXT NOT NULL DEFAULT ''").run();
    } catch (err) {
      // Another request added it first
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }
  _ready.add(db);
}

/**
 * Where a photo's crops center their attention, as Cloudflare's resizing takes it ("gravity=XxY"):
 * X across from the left edge, Y down from the top, each 0 to 1. The point sits at the same place in
 * every crop as in the whole photo, so it always stays in view (CSS's object-position works the same
 * way, which is how the page shows each crop while the point moves). '' leaves it to the resizing,
 * which crops around what it finds most interesting (gravity=auto).
 */
const AXIS = String.raw`(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)`;
export const FOCUS = new RegExp(`^${AXIS}x${AXIS}$`);
/** A focus point as stored: "0.42x0.31", or '' for none. Two places each way is finer than a phone's finger. */
export function cleanFocus(v) {
  if (typeof v === 'string' && FOCUS.test(v)) return v.split('x').map((n) => String(Math.round(Number(n) * 100) / 100)).join('x');
  if (v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y)) {
    const k = (n) => String(Math.round(Math.min(1, Math.max(0, n)) * 100) / 100);
    return `${k(v.x)}x${k(v.y)}`;
  }
  return '';
}
/** A stored focus point as numbers, or null for none. */
export function focusPoint(focus) {
  if (!focus || !FOCUS.test(focus)) return null;
  const [x, y] = focus.split('x').map(Number);
  return { x, y };
}

/**
 * A store photo's source in an email brief, with its focus point when it has one: "photo:<id>",
 * or "photo:<id>@0.42x0.31". Email.photo reads it back with photoSource.
 */
export const withFocus = (src, focus) => (src.startsWith('photo:') && focus && FOCUS.test(focus) ? `${src}@${focus}` : src);
/** The photo's id and how its crops are placed ("0.42x0.31", or "auto" without a point), from a "photo:" source. */
export function photoSource(src) {
  const [id, focus = ''] = src.replace(/^photo:/, '').split('@');
  return { id, gravity: FOCUS.test(focus) ? focus : 'auto' };
}

/** @typedef {{ id: string, w: number, h: number, alt: string, focus: string, uploadedBy: string, uploadedAt: string }} Photo */

/** @returns {Photo} */
const fromRow = (r) => ({ id: r.id, w: r.w, h: r.h, alt: r.alt, focus: cleanFocus(r.focus), uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at });

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

/** Changes the part of a photo every crop keeps in view ('' to leave it to the resizing). True when the photo is there. */
export async function setFocus(db, id, focus) {
  await ensureTable(db);
  return (await db.prepare('UPDATE email_photos SET focus = ? WHERE id = ?').bind(cleanFocus(focus), id).run()).meta.changes === 1;
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
