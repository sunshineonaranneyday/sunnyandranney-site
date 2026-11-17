/**
 * What the weekly email page edits, and the small rules the browser needs on top of the shared
 * ones (src/lib/sunny-side/special.mjs, wall.mjs, events.mjs, catalog.mjs).
 */
import { Email } from '@/lib/sunny-side/email.mjs';
import { KINDS, clean, isDiscount, whole } from '@/lib/sunny-side/special.mjs';

export type Kind = keyof typeof KINDS;

export interface Special {
  kind: Kind | '';
  tiers: { spend: number | null; percent: number | null }[];
  percent: number | null;
  ends: string;
}

/** The sale as typed: numbers stay text until they're read, so "1,0" isn't fought while typing. */
export interface SaleForm {
  kind: Kind | '';
  tiers: { spend: string; percent: string }[];
  percent: string;
  ends: string;
}

export interface Pick {
  handle: string;
  photo: string;
  name: string;
}
export interface Wall {
  label: string;
  headline: string;
  picks: Pick[];
  arranged: 'auto' | 'hand';
}

/** One product in the shop's catalog (/shop/catalog.json). */
export interface Product {
  handle: string;
  name: string;
  title: string;
  price: number;
  was: number | null;
  qty: number;
  added: string;
  kind: string;
  type: string;
  collections: string[];
  photos: { url: string; w: number; h: number }[];
  rank: number | null;
  staffPick: boolean;
}
export interface Catalog {
  built: string;
  collections: { handle: string; title: string }[];
  products: Product[];
}

export interface EventDate {
  date: string;
  what: string;
  note: string;
  greg: boolean;
}
export interface StoreEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  when: string;
  dates: EventDate[];
}
export interface EventRecord {
  event: StoreEvent;
  updatedAt: string;
  updatedBy: string;
}

/**
 * What each ready-made sale opens with: the store's last of that kind, else the usual (20% off
 * everything; a spend-more sale's amounts are the store's to set the first time).
 */
export interface SalePresets {
  percent: number;
  /** The last spend-more tiers saved here, else the store's own from its Nov 3 email (special.mjs, STORE_TIERS). */
  tiers: { spend: number; percent: number }[];
  /** The last day a sale runs unless she changes it (usualEnds). */
  ends: string;
}

export interface AppProps {
  /** The one email being worked on (weekToWorkOn): this week's until it goes out, then next week's. */
  send: string;
  label: string;
  today: string;
  record: { special: Special | null; wall: Wall | null; updatedAt: string; updatedBy: string } | null;
  presets: SalePresets;
  events: EventRecord[];
  test: { people: TestPerson[]; me: string };
  /** The rest of the email (parts.mjs), as saved, or blank. */
  parts: Parts;
  /** The store's own photos, newest first. */
  photos: Photo[];
  /** The week's send, once it's scheduled in Kit, with where it stands there. */
  kitSend: KitSend | null;
  /** The last tests of this email. */
  tests: TestSent[];
  /** The charity's kids, most recent reveal first (kids.mjs). */
  kids: Kid[];
  /** The charity's reveals still ahead, soonest first, that the story spot can show (kids.mjs). */
  reveals: Reveal[];
  /** When the store's emails usually go ("HH:MM" Eastern), from Kit, or null. */
  usualTime: string | null;
  /** The store's active subscribers in Kit (STORE_SEGMENT), or null if Kit didn't say. */
  subscribers: number | null;
  /** The charity's numbers, read from its site when the page loaded, or null if it didn't answer. */
  impact: { rooms: string; children: string } | null;
  /** True on a developer's machine, whose uploads aren't on the live site. */
  local: boolean;
  /** The signed-in login is the owner's, the one shown problems in the email's own layout. */
  owner: boolean;
  /** Problems in the email's own layout the preview reported (layout-store.mjs); the owner's only, else empty. */
  layoutReports: LayoutReport[];
}

/** A word in the email's own layout the preview measured too wide for a phone (layout-store.mjs). */
export interface LayoutReport {
  word: string;
  over: number;
  width: number;
  send: string;
  seenBy: string;
  firstSeen: string;
  lastSeen: string;
  times: number;
}

export interface Parts {
  subject: string;
  preheader: string;
  /** A library photo's id, or '' for the store's wide shot. */
  hero: string;
  story: { label: string; headline: string; body: string; cta: string; link: string; photos: string[]; reveal: string };
  /** The charity kid's slug, or '' for the most recent reveal. */
  kid: string;
  /** One of that family's photos ("cf:" id), or '' for their finished room. */
  kidPhoto: string;
}
export interface KidPhoto {
  src: string;
  alt: string;
  /** The charity's own photo of the finished room. */
  after?: true;
}
/** A charity reveal still ahead, with the day and time the charity publishes (kids.mjs, upcomingReveals). */
export interface Reveal {
  slug: string;
  name: string;
  start: string;
  day: string;
  long: string;
  short: string;
  time: string;
  room: string;
  photo: KidPhoto;
  story: string;
  page: string;
  live: string;
}
export interface Kid {
  slug: string;
  name: string;
  page: string;
  /** The photo the email starts on: the finished room, when the charity has one. */
  photo: KidPhoto;
  /** Their photos, that one first (kids.mjs, photosOf). */
  photos: KidPhoto[];
  caption: string;
  story: string;
  revealedOn: string | null;
  dated: 'recorded' | 'photos' | null;
}
export interface TestSent {
  at: string;
  by: string;
  to: string[];
}
export interface Photo {
  id: string;
  w: number;
  h: number;
  alt: string;
  uploadedBy: string;
  uploadedAt: string;
}
export interface KitSend {
  id: string;
  url: string;
  at: string;
  by: string;
  sendAt: string;
  status: string;
}
export const partsSnapshot = (p: Parts) => JSON.stringify(p);

/** Someone a test can go to; the person signed in comes first, as "You". */
export interface TestPerson {
  name: string;
  email: string;
  you?: boolean;
}

// ── The sale form ──────────────────────────────────────────────────────────
/** Leaving a number field tidies it to what will be saved: "1000" becomes "1,000", "20%" becomes "20". */
export const tidyMoney = (v: string) => {
  const n = whole(v);
  return n === null ? v : n.toLocaleString('en-US');
};
export const tidyPercent = (v: string) => {
  const n = whole(v);
  return n === null ? v : String(n);
};
const num = (n: number | null) => (n === null ? '' : String(n));
const money = (n: number | null) => (n === null ? '' : n.toLocaleString('en-US'));
const twoTiers = () => [
  { spend: '', percent: '' },
  { spend: '', percent: '' },
];

export function saleFormOf(s: Special | null): SaleForm {
  if (!s) return { kind: '', tiers: twoTiers(), percent: '', ends: '' };
  return {
    kind: s.kind,
    tiers: s.tiers?.length ? s.tiers.map((t) => ({ spend: money(t.spend), percent: num(t.percent) })) : twoTiers(),
    percent: num(s.percent ?? null),
    ends: s.ends ?? '',
  };
}

export const specialOf = (f: SaleForm): Special => clean(f) as Special;

/** Only what saving keeps, so switching kinds and back doesn't count as a change. */
export function saleSnapshot(f: SaleForm): string {
  const s = specialOf(f);
  if (!s.kind) return '';
  const keep: Record<string, unknown> = { kind: s.kind };
  if (isDiscount(s.kind)) keep.ends = s.ends;
  if (s.kind === 'tiers') keep.tiers = s.tiers;
  if (s.kind === 'percent') keep.percent = s.percent;
  return JSON.stringify(keep);
}

export const wallSnapshot = (w: Wall) => (w.picks.length ? JSON.stringify({ l: w.label, h: w.headline, p: w.picks, a: w.arranged }) : '');

// ── Small helpers ──────────────────────────────────────────────────────────
export const fieldId = (key: string) => `em-${key.replace(/[.]/g, '-')}`;
export const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
export const at = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const toast = (message: string, tone?: 'ok' | 'error') => document.dispatchEvent(new CustomEvent('admin:toast', { detail: { message, tone } }));
export const usd = (n: number) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** A photo at a size and crop, as a thumbnail, sent the way the email sends it (a JPEG). */
export const thumb = (url: string, w: number, h = w): string => Email.photo(url, w, h);

/** Fetches JSON from the admin's API, saying what went wrong in words fit to show. */
export async function send<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown): Promise<{ ok: true; body: T } | { ok: false; error: string; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) || 'That didn’t save. Try again.', body: data };
    return { ok: true, body: data as T };
  } catch {
    return { ok: false, error: 'That didn’t save: the connection dropped. Try again.', body: {} };
  }
}
