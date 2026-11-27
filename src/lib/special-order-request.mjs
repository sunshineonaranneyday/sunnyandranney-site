/**
 * A shopper's request for a special-order piece, from the product page's form.
 * The same checks run in the browser (instant feedback) and on the server (the record).
 */

export const LIMITS = { name: 80, email: 120, phone: 30, note: 1000 };
export const STORE_PHONE = '(678) 888-5140';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The form's one "Email or phone" box: an @ makes it an email, anything else a phone
 * number. One box, not two, so a shopper never wonders whether both are needed.
 * @param {string} raw
 * @returns {{ email: string | null, phone: string | null }}
 */
export function splitContact(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { email: null, phone: null };
  return value.includes('@') ? { email: value.toLowerCase(), phone: null } : { email: null, phone: value };
}

const DOMAIN_FIXES = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmaill.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com',
  'bellsouth.ent': 'bellsouth.net', 'comcast.ent': 'comcast.net',
};

/**
 * A likely slip in an email's domain, the corrected address or null: a known misspelling
 * (gmial.com) or a typed-over ending (.con, .cmo). Offered to the shopper, never applied for them.
 * @param {string} raw
 * @returns {string | null}
 */
export function emailSuggestion(raw) {
  const m = String(raw ?? '').trim().toLowerCase().match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  if (!m) return null;
  const [, user, domain] = m;
  const fixed = DOMAIN_FIXES[domain] ?? domain.replace(/\.(con|cmo|ocm|comm|vom|xom|cm)$/, '.com').replace(/\.(nte|ner)$/, '.net');
  const again = DOMAIN_FIXES[fixed] ?? fixed;
  return again !== domain ? `${user}@${again}` : null;
}

/**
 * The error for one field, or null. Worded the GOV.UK way: say what to do, in the
 * field's own words, with an example where one helps.
 * @param {'name' | 'contact' | 'note'} field
 * @param {unknown} raw
 * @returns {string | null}
 */
export function fieldError(field, raw) {
  const value = String(raw ?? '').trim();
  if (field === 'name') {
    if (!value) return 'Enter your name';
    if (value.replace(/\s+/g, ' ').length > LIMITS.name) return `Name must be ${LIMITS.name} characters or fewer`;
    return null;
  }
  if (field === 'contact') {
    if (!value) return 'Enter an email address or a phone number';
    const { email, phone } = splitContact(value);
    if (email && (email.length > LIMITS.email || !EMAIL.test(email))) return 'Enter an email address like name@example.com';
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (/[a-z]/i.test(phone) && !email) return 'Enter an email address like name@example.com, or a phone number';
      // The example is a made-up 555 number, so no one types in the store's own.
      if (phone.length > LIMITS.phone || digits.length < 10 || digits.length > 15) return 'Enter a phone number with the area code, like (770) 555-0123';
    }
    return null;
  }
  if (field === 'note') return value.length > LIMITS.note ? `Note must be ${LIMITS.note.toLocaleString('en-US')} characters or fewer` : null;
  return null;
}

/**
 * @param {Record<string, unknown>} input  the form's fields: handle, name, contact (or email and phone), note, website
 * @returns {{ ok: true, value: { handle: string, name: string, email: string | null, phone: string | null, note: string | null } }
 *         | { ok: false, field: string | null, error: string, bot?: boolean }}
 */
export function checkRequest(input) {
  const text = (k) => String(input?.[k] ?? '').trim();
  // The hidden "website" box: people never see it, bots fill it in.
  if (text('website')) return { ok: false, field: null, error: 'Thanks.', bot: true };

  const handle = text('handle');
  if (!/^[a-z0-9][a-z0-9-]{0,254}$/.test(handle)) return { ok: false, field: null, error: `We couldn’t find this piece. Call us at ${STORE_PHONE} and we’ll help.` };

  const nameError = fieldError('name', text('name'));
  if (nameError) return { ok: false, field: 'name', error: nameError };
  const name = text('name').replace(/\s+/g, ' ');

  // The page sends one "contact" box; email and phone separately are still understood.
  const contact = text('contact') || text('email') || text('phone');
  const contactError = fieldError('contact', contact);
  if (contactError) return { ok: false, field: 'contact', error: contactError };
  const { email, phone } = splitContact(contact);

  const note = text('note');
  const noteError = fieldError('note', note);
  if (noteError) return { ok: false, field: 'note', error: noteError };

  return { ok: true, value: { handle, name, email, phone, note: note || null } };
}

export const STORE_TIME_ZONE = 'America/New_York';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The store's calendar date (YYYY-MM-DD) at an instant. */
export function storeDate(now, timeZone = STORE_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/**
 * The day a shopper can expect a reply: the next day the store is open after `now`,
 * in the store's time zone. `openDays` uses Sunday = 0; with none known, tomorrow.
 * Worked out once, when the request arrives, and saved on it, so the page and the
 * email always name the same day.
 * @returns {string} YYYY-MM-DD
 */
export function replyByDate(now, openDays, timeZone = STORE_TIME_ZONE) {
  const today = storeDate(now, timeZone);
  if (!openDays?.length) return addDays(today, 1);
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, i);
    if (openDays.includes(weekday(day))) return day;
  }
  return addDays(today, 1);
}

/** For the page, right after sending: "tomorrow" or the weekday. */
export function replyByShort(dateIso, now, timeZone = STORE_TIME_ZONE) {
  return dateIso === addDays(storeDate(now, timeZone), 1) ? 'tomorrow' : WEEKDAYS[weekday(dateIso)];
}

/** For the email, which may be read days later: "Tuesday, November 17". */
export function replyByLong(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Open days (Sunday = 0) from the store's hours: { days: [{ day: 'Monday', closed: true }, …] }. */
export function openDaysOf(hours) {
  return (hours?.days ?? []).filter((d) => d && !d.closed).map((d) => WEEKDAYS.indexOf(d.day)).filter((n) => n >= 0);
}
