/**
 * Sending the weekly email through Kit, from the admin
 * ===========================================================================
 * Kit sends both the tests and the email itself, so a test is exactly what subscribers get. Kit's
 * API has no "send test" (its broadcasts endpoints only list, create, read, update, delete and
 * report), so a test is a small broadcast of its own, to just the people asked for: each is a Kit
 * subscriber with a tag of their own ("Weekly email test: <email>"), and the test goes to those
 * tags. The real email is a broadcast to the store's subscribers (STORE_SEGMENT), at the time
 * Staci picks.
 *
 * Every broadcast goes to the people it's for and no one else. The Kit account is the charity's
 * too, and a broadcast with no filter goes to all of it: about 10,000 people on Nov 17, 2026,
 * against the store's 2,841.
 *
 * Neither is ever published to the web. Kit's docs disagree on whether sending needs "public"
 * (create: a send_at alone schedules; update: it takes public too), so every broadcast is made
 * with public off and read back at once: if Kit published it, it's taken off the web; if Kit
 * didn't keep it to the people asked for, or didn't schedule it, it's deleted and the admin says
 * so. Nothing is left half-sent, public or going to the wrong people.
 *
 * Kit API v4 with the site's KIT_API_KEY; KIT_API_BASE points it at a stand-in for local tests.
 * The email goes on a Kit "Starting point" template, where the content is the whole email:
 * KIT_TEMPLATE_ID picks one, or the account's first is used.
 */

export const KIT = 'https://api.kit.com/v4';
export const broadcastUrl = (id) => `https://app.kit.com/campaigns/${id}/draft`;
export const testerTagName = (email) => `Weekly email test: ${email}`;
/** A test goes out a minute after it's asked for: Kit wants a time ahead. */
const TEST_LEAD_MS = 60 * 1000;

/** @typedef {{ call: (path: string, init?: { method?: string, body?: unknown }) => Promise<any> }} Kit */

/** A Kit client. Each call throws in words fit to show. @returns {Kit} */
export function kitClient({ key, base = KIT, get = fetch }) {
  return {
    async call(path, { method = 'GET', body } = {}) {
      let res;
      try {
        res = await get(`${base}${path}`, {
          method,
          headers: { 'X-Kit-Api-Key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new Error('Kit didn’t answer. Try again in a minute.');
      }
      if (res.status === 204) return {};
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = Array.isArray(data?.errors) ? data.errors.join(' ') : '';
        throw Object.assign(new Error(`Kit said no (${res.status})${why ? `: ${why}` : '.'}`), { status: res.status });
      }
      return data;
    },
  };
}

/** The template the email goes on: the one in KIT_TEMPLATE_ID, or the account's first Starting point. */
export async function templateFor(kit, wanted) {
  if (wanted) return Number(wanted);
  const { email_templates: list = [] } = await kit.call('/email_templates?per_page=100');
  const pick = list.find((t) => t.category === 'Starting point');
  if (!pick) throw new Error('Kit has no “Starting point” email template for the email to go on. Add one in Kit, or set KIT_TEMPLATE_ID.');
  return pick.id;
}

/**
 * Makes sure a tester can get tests: a subscriber (made if new; someone who unsubscribed stays
 * unsubscribed) with their own test tag. Returns the tag's id.
 */
export async function readyTester(kit, { email, name }) {
  const { subscriber } = await kit.call('/subscribers', { method: 'POST', body: { email_address: email, first_name: name } });
  if (subscriber?.state && subscriber.state !== 'active') {
    throw new Error(`${name} (${email}) is ${subscriber.state === 'cancelled' ? 'unsubscribed from' : subscriber.state === 'bounced' ? 'bouncing from' : 'not getting'} the store’s emails in Kit, so Kit won’t send them a test.`);
  }
  const { tag } = await kit.call('/tags', { method: 'POST', body: { name: testerTagName(email) } });
  await kit.call(`/tags/${tag.id}/subscribers`, { method: 'POST', body: { email_address: email } });
  return tag.id;
}

/**
 * The store's signup tag in Kit: the site's signup form adds it (api/subscribe.ts), and the store's
 * hand-sent emails went to everyone with it (Nov 10, 2026: 3,135 people, the tag's whole count).
 */
export const STORE_TAG = 'Sunny & Ranney';
/**
 * A tag on 424 active subscribers on Nov 17, 2026, 274 of them on the store tag. They're left out (Peter 2026-11-17),
 * until they sign up on the site: its form takes the tag off (signUp).
 */
export const NO_MARKETING_TAG = 'Shopify: no marketing';
/**
 * Who the weekly email goes to: a segment in Kit, made Nov 17, 2026 as everyone with STORE_TAG
 * and not NO_MARKETING_TAG (2,841 people that day). Kit's API takes one filter group per
 * broadcast, so it can't leave a tag out by itself; the segment does. Kept up to date by Kit.
 */
export const STORE_SEGMENT = 'Sunny & Ranney weekly email';

/** The id of the Kit tag or segment with exactly this name, or null. */
async function idNamed(kit, kind, name) {
  let after = '';
  for (let page = 0; page < 20; page++) {
    const data = await kit.call(`/${kind}?per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    const found = (data?.[kind] ?? []).find((t) => t.name === name);
    if (found) return Number(found.id);
    const { pagination } = data ?? {};
    if (!pagination?.has_next_page || !pagination.end_cursor) break;
    after = pagination.end_cursor;
  }
  return null;
}

/** The store segment's id in Kit. Throws when Kit has no such segment, so nothing goes to anyone else. */
export async function storeSegmentId(kit) {
  const id = await idNamed(kit, 'segments', STORE_SEGMENT);
  if (!id) throw new Error(`Kit has no “${STORE_SEGMENT}” segment, the store’s subscribers, so there’s no one to send it to. Nothing was sent.`);
  return id;
}

/** @typedef {{ type: 'tag' | 'segment', ids: number[] }} Audience */

/**
 * Who a Kit subscriber_filter sends to: one kind (tags or segments) and its ids, sorted, or null
 * when it reaches anyone else: everyone (Kit reads an unfiltered broadcast back as
 * { all: [{ type: 'all_subscribers' }] }), a mix, an exclusion, or several someone must be in all of.
 * @returns {Audience | null}
 */
export function audienceOf(filter) {
  if (!Array.isArray(filter) || filter.length !== 1 || !filter[0] || typeof filter[0] !== 'object') return null;
  const group = filter[0];
  const used = Object.keys(group).filter((k) => group[k] != null && !(Array.isArray(group[k]) && group[k].length === 0));
  if (used.length !== 1) return null;
  const [key] = used;
  const conds = group[key];
  if (!Array.isArray(conds) || conds.length === 0) return null;
  const type = conds[0]?.type;
  if (type !== 'tag' && type !== 'segment') return null;
  if (!conds.every((c) => c?.type === type && Array.isArray(c.ids) && c.ids.length > 0)) return null;
  // Within one condition a subscriber needs any of its ids; "all" across several needs every one
  if (key !== 'any' && !(key === 'all' && conds.length === 1)) return null;
  const ids = [...new Set(conds.flatMap((c) => c.ids.map(Number)))].sort((a, b) => a - b);
  return ids.every((n) => Number.isInteger(n) && n > 0) ? { type, ids } : null;
}

const sameAudience = (a, b) => !!a && !!b && a.type === b.type && a.ids.length === b.ids.length && a.ids.every((n, i) => n === b.ids[i]);

/**
 * Schedules a broadcast to an audience (testers' tags, or the store's segment), kept off the web,
 * and checks with Kit that it's scheduled, and to just them.
 * @param {Kit} kit
 * @param {{ subject: string, preheader: string, html: string, description: string, templateId: number, sendAt: string, from: string | undefined, audience: Audience }} msg
 * @returns {Promise<{ id: number, status: string, sendAt: string }>}
 */
export async function schedule(kit, { subject, preheader, html, description, templateId, sendAt, from, audience }) {
  // From the store's own sender (KIT_SENDER: Staci, Peter 2026-11-16). Kit's account is the charity's
  // too, and a broadcast that names no sender goes from the account's default: a test came from
  // linzi@soardcharity.com as "Sunshine on a Ranney Day". The address is a confirmed sending
  // address in Kit, from name "Sunny & Ranney".
  if (!from) throw new Error('The store’s sending address isn’t set (KIT_SENDER), so Kit would send it as the charity. Nothing was sent.');
  // To the people it's for only: with no filter Kit sends to the whole account, the charity's list too (Peter 2026-11-17)
  const filter = [{ any: [{ type: audience?.type, ids: audience?.ids }] }];
  const wanted = audienceOf(filter);
  if (!wanted) throw new Error('No one to send it to was picked, and Kit would send it to the whole account, the charity’s list too. Nothing was sent.');
  const body = { subject, preview_text: preheader, content: html, description, email_template_id: templateId, email_address: from, public: false, send_at: sendAt, subscriber_filter: filter };
  const { broadcast } = await kit.call('/broadcasts', { method: 'POST', body });
  const id = broadcast.id;
  // From here until it's checked, any failure (Kit busy or down, a check failing) takes it back out of
  // Kit: a broadcast nobody checked, or that the admin has no record of, must never be left to go
  try {
    let now = (await kit.call(`/broadcasts/${id}`)).broadcast;
    if (!sameAudience(audienceOf(now.subscriber_filter), wanted)) throw new Error('Kit didn’t keep it to just the people it was for, so it was deleted before it could go. Nothing was sent.');
    if (now.public) {
      await kit.call(`/broadcasts/${id}`, { method: 'PUT', body: { public: false } });
      now = (await kit.call(`/broadcasts/${id}`)).broadcast;
      if (now.public) throw new Error('Kit put the email on the web and wouldn’t take it off, so it was deleted. Nothing was sent.');
    }
    if (!now.send_at || now.status === 'draft') throw new Error('Kit kept it as a draft instead of scheduling it, so it was deleted. Nothing was sent.');
    return { id, status: now.status ?? 'scheduled', sendAt: now.send_at };
  } catch (err) {
    await kit.call(`/broadcasts/${id}`, { method: 'DELETE' }).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(/Nothing was sent\.$/.test(message) ? message : `Kit didn’t confirm it (${message}), so it was taken back out of Kit. Nothing was sent. Try again.`);
  }
}

/**
 * Takes out of Kit any broadcast still waiting to go whose description is this one (or passes this
 * test) and isn't `keep`: one made by a try that failed before it was noted here. Run before making
 * one, so a try after a failure can't send it twice. Returns how many it took out.
 * @param {Kit} kit @param {string | ((description: string) => boolean)} matches @param {string | number | null} [keep]
 */
export async function dropStrays(kit, matches, keep = null) {
  const is = typeof matches === 'string' ? (d) => d === matches : matches;
  const { broadcasts = [] } = await kit.call('/broadcasts?status=scheduled&per_page=1000');
  // Kit's own status filter, and again here: one that has started sending or gone is never touched
  // (Kit doesn't promise a status on each; without one, only one whose time is still ahead counts)
  const waiting = (b) => (b.status ? ['scheduled', 'draft'].includes(b.status) : Boolean(b.send_at) && Date.parse(b.send_at) > Date.now());
  const strays = broadcasts.filter((b) => is(b.description || '') && waiting(b) && String(b.id) !== String(keep));
  for (const b of strays) await kit.call(`/broadcasts/${b.id}`, { method: 'DELETE' });
  return strays.length;
}

/**
 * "[Test 3:32 PM]": a test's tag, with the store's time it goes out. Every test of a week had the same
 * "[Test] …" subject, so Gmail threaded them, and showed the later ones with whatever matched the one
 * before folded away under "•••": a reveal looked missing from a test on Nov 17, 2026. A subject of
 * its own starts a thread of its own.
 */
export const testTag = (at) => `[Test ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(at)}]`;

/** Sends a test now-ish, to these testers' tags. @returns {Promise<{ id: number, status: string, sendAt: string }>} */
export function sendTest(kit, { subject, preheader, html, templateId, tagIds, description, from, now = Date.now() }) {
  return schedule(kit, {
    from,
    subject: `${testTag(new Date(now + TEST_LEAD_MS))} ${subject}`,
    preheader,
    html,
    description,
    templateId,
    sendAt: new Date(now + TEST_LEAD_MS).toISOString(),
    audience: { type: 'tag', ids: tagIds },
  });
}

/** Where a broadcast stands now. */
export async function statusOf(kit, id) {
  try {
    const { broadcast } = await kit.call(`/broadcasts/${id}`);
    return { status: broadcast.status ?? (broadcast.send_at ? 'scheduled' : 'draft'), sendAt: broadcast.send_at };
  } catch (err) {
    // Deleted in Kit's own app: there's nothing scheduled any more
    if (/** @type {{ status?: number }} */ (err).status === 404) return { status: 'gone', sendAt: null };
    throw err;
  }
}

/** Stops a scheduled send before it goes. One that's sending or sent can't be stopped; one deleted in Kit is already stopped. */
export async function cancel(kit, id) {
  const { status } = await statusOf(kit, id);
  if (status === 'gone') return;
  if (status === 'sending' || status === 'completed') throw new Error(status === 'sending' ? 'It’s sending now, so it can’t be stopped.' : 'It’s already gone out.');
  await kit.call(`/broadcasts/${id}`, { method: 'DELETE' });
}

/** A tag's active subscribers, from the tag's own list (live Nov 17, 2026: the store tag read 3,115, as Kit's app does). */
async function activeOnTag(kit, tagId) {
  const data = await kit.call(`/tags/${tagId}/subscribers?status=active&include_total_count=true&per_page=1`);
  return Number(data?.pagination?.total_count ?? NaN);
}

/**
 * Kit's count of active subscribers with every one of these tags, from its subscriber filter: its
 * total when it gives one, else the people it returned when they all fit on one page. Live on Nov
 * 17, 2026 the filter answered with no total when not asked for one (include_total_count, as Kit's
 * other lists take). Otherwise NaN, with what Kit sent noted for the log.
 * @returns {Promise<{ n: number, seen: string }>}
 */
async function activeWithTags(kit, tagIds) {
  const all = [...tagIds.map((id) => ({ type: 'tags', any: [{ type: 'ids', matching: [id] }] })), { type: 'subscriber_state', states: ['active'] }];
  const data = await kit.call('/subscribers/filter?include_total_count=true&per_page=1000', { method: 'POST', body: { all } });
  const page = data?.pagination ?? {};
  const listed = Array.isArray(data?.subscribers) ? data.subscribers.length : NaN;
  const seen = `total ${page.total_count ?? 'none'}, ${listed} listed, per page ${page.per_page ?? '?'}, more ${page.has_next_page ?? '?'}`;
  if (Number.isInteger(page.total_count)) return { n: page.total_count, seen };
  if (page.has_next_page === false && Number.isInteger(listed)) return { n: listed, seen };
  return { n: NaN, seen };
}

/**
 * How many people the email would go to: the store segment's active subscribers. Kit's API has no
 * count for a segment, so it's counted the way the segment is made (STORE_SEGMENT): the store tag's
 * active subscribers, less those also on NO_MARKETING_TAG. Kit's filter must first count the
 * no-marketing tag the same as that tag's own list does, or it throws, saying what Kit counted,
 * rather than give a wrong number.
 */
export async function subscriberCount(kit) {
  const [store, noMarketing] = await Promise.all([idNamed(kit, 'tags', STORE_TAG), idNamed(kit, 'tags', NO_MARKETING_TAG)]);
  if (!store || !noMarketing) throw new Error(`Kit has no “${store ? NO_MARKETING_TAG : STORE_TAG}” tag, so the store segment can’t be counted.`);
  const [onStore, onNoMarketing, viaFilter, both] = await Promise.all([
    activeOnTag(kit, store),
    activeOnTag(kit, noMarketing),
    activeWithTags(kit, [noMarketing]),
    activeWithTags(kit, [store, noMarketing]),
  ]);
  const n = both.n;
  if (!Number.isInteger(onStore) || !Number.isInteger(onNoMarketing) || viaFilter.n !== onNoMarketing || !Number.isInteger(n) || n < 0 || n > Math.min(onStore, onNoMarketing)) {
    throw new Error(`The store segment can’t be counted: the store tag’s list has ${onStore} active and the no-marketing tag’s ${onNoMarketing}; Kit’s filter found ${viaFilter.n} on the no-marketing tag (${viaFilter.seen}) and ${n} on both (${both.seen}).`);
  }
  return onStore - n;
}

/** A test, not a real send: the admin's tests go out with "[Test]", or "[Test 3:32 PM]", before the subject (sendTest). */
const isTest = (b) => /^\[Test( [^\]]*)?\]/.test(b?.subject || '');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ id: number, subject: string, preheader: string, sentAt: string }} SentEmail
 */

/**
 * The store's weekly emails that have gone out, newest first: Kit's completed broadcasts from the
 * last year that are the store's (isStoreEmail), tests left out. The Kit account is the charity's
 * too, and most of what it sends is the charity's, so the year is read with each email's HTML (one
 * request, up to Kit's 1,000; a year was 21 emails and 0.5 MB on Nov 16, 2026) and sorted here,
 * since Kit's list has no stated order.
 * @returns {Promise<SentEmail[]>}
 */
export async function sentEmails(kit, { limit = 52, now = Date.now() } = {}) {
  return (await completed(kit, now, { bodies: true }))
    .filter((b) => isStoreEmail(b) && !isAgainEmail(b))
    .slice(0, limit)
    .map((b) => ({ id: b.id, subject: b.subject || '', preheader: b.preview_text || '', sentAt: b.send_at }));
}

/** Kit's completed broadcasts from the last year, tests left out, newest first; with their HTML if asked. */
async function completed(kit, now, { bodies = false } = {}) {
  const since = new Date(now - 366 * DAY_MS).toISOString().slice(0, 10);
  const { broadcasts = [] } = await kit.call(`/broadcasts?status=completed&sent_after=${since}&per_page=1000${bodies ? '' : '&slim=true'}`);
  return broadcasts.filter((b) => b.send_at && !isTest(b)).sort((a, b) => Date.parse(b.send_at) - Date.parse(a.send_at));
}

const STORE_HOST = /(^|\.)sunnyandranney\.com$/i;
const CHARITY_HOST = /(^|\.)sunshineonaranneyday\.com$/i;
/** The hosts an email's links go to, one per link. */
function linkHosts(html) {
  const hosts = [];
  for (const [, href] of String(html || '').matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      hosts.push(new URL(href.replace(/&amp;/g, '&')).hostname);
    } catch {
      // mailto:, tel:, Kit's {{ }} tags: not a site
    }
  }
  return hosts;
}

/**
 * Whether a sent email is the store's: one this admin scheduled, or one that links to the store's
 * site more than to the charity's. Checked against every email the account sent in the year to Nov
 * 16, 2026: the store's two hand-sent emails linked to the store 2 and 6 times (the charity 1 and 3),
 * and none of the charity's 19 linked to the store at all.
 */
export function isStoreEmail(b) {
  if (fromThisAdmin(b)) return true;
  const hosts = linkHosts(b?.content);
  return hosts.filter((h) => STORE_HOST.test(h)).length > hosts.filter((h) => CHARITY_HOST.test(h)).length;
}

/**
 * The weekly emails this admin scheduled: it labels each one in Kit (send.ts, "The Sunny Side for
 * Tue, Nov 17, from the store admin"). The Kit account is the charity's too, so its reveal days and
 * newsletters go out from it at their own times, and the store's emails before this admin were sent
 * by hand whenever they were ready (Nov 3 at 5:29 PM, Nov 10 at 9:52 PM).
 */
export const fromThisAdmin = (b) => /^The Sunny Side for .*, from the store admin$/.test(b?.description || '');

/**
 * A week's email sent again to the people who didn't open it (again-run.mjs againDescription). It
 * shows on its email's page in Sent emails, not as an email of its own, and its time isn't the
 * store's usual one.
 */
export const isAgainEmail = (b) => /^The Sunny Side for .*, again to the people who didn’t open it$/.test(b?.description || '');

/**
 * One of the store's emails as Kit sent it, with its HTML, or null when it isn't one that went to
 * subscribers (a draft, one still scheduled, a test, one deleted in Kit) or isn't the store's.
 * @returns {Promise<(SentEmail & { html: string, status: string }) | null>}
 */
export async function sentEmail(kit, id) {
  let b;
  try {
    ({ broadcast: b } = await kit.call(`/broadcasts/${id}`));
  } catch (err) {
    if (/** @type {{ status?: number }} */ (err).status === 404) return null;
    throw err;
  }
  if (!b?.send_at || isTest(b) || !['completed', 'sending'].includes(b.status) || !isStoreEmail(b)) return null;
  return { id: b.id, subject: b.subject || '', preheader: b.preview_text || '', sentAt: b.send_at, html: b.content || '', status: b.status };
}

/**
 * The time of day the store's weekly email usually goes, as "HH:MM" Eastern: the most common time of
 * the ones this admin scheduled, or null before it has scheduled any. (Counting every send in the
 * account, the charity's too, it came out 3:31 PM on Nov 16, 2026: the charity's last email's time.)
 */
export async function usualTime(kit, now = Date.now()) {
  const sent = (await completed(kit, now)).filter(fromThisAdmin).slice(0, 30).map((b) => ({ sentAt: b.send_at }));
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const counts = new Map();
  for (const b of sent) {
    const t = fmt.format(new Date(b.sentAt));
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/*
 * For sending the email again to the people who didn't open it (again-run.mjs)
 * ---------------------------------------------------------------------------
 * Kit's API sends a broadcast to tags or segments only, and can't make a segment, so the people it
 * goes to are found with Kit's subscriber filter and given a tag of their own, one at a time (the
 * bulk endpoints are OAuth-only, and the site uses an API key).
 */

/** A Kit subscriber filter condition on one tag. */
export const onTag = (id) => ({ type: 'tags', any: [{ type: 'ids', matching: [id] }] });
/** A Kit subscriber filter condition: did `what` ('sent', 'opens', 'clicks') with any of these broadcasts, optionally since a day. */
export const didWith = (what, ids, after) => ({ type: what, count_greater_than_or_equal: 1, ...(after ? { after } : {}), any: [{ type: 'broadcasts', ids }] });
export const ACTIVE = { type: 'subscriber_state', states: ['active'] };

/**
 * Everyone Kit's subscriber filter finds (every condition in `all`), as ids, every page of them. Throws
 * rather than give part of a list: a page that says there's more with no way to get it, or one
 * that repeats.
 * @returns {Promise<Set<string>>}
 */
export async function filterIds(kit, all) {
  const ids = new Set();
  const seen = new Set();
  let after = '';
  for (let page = 0; page < 100; page++) {
    const data = await kit.call(`/subscribers/filter?per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`, { method: 'POST', body: { all } });
    if (!Array.isArray(data?.subscribers)) throw new Error('Kit’s subscriber filter answered without a list.');
    for (const s of data.subscribers) ids.add(String(s.id));
    const p = data.pagination ?? {};
    if (!p.has_next_page) return ids;
    if (!p.end_cursor || seen.has(p.end_cursor)) throw new Error('Kit’s subscriber filter said there were more but gave no next page.');
    seen.add(p.end_cursor);
    after = p.end_cursor;
  }
  throw new Error('Kit’s subscriber filter went on for 100 pages.');
}

/** Everyone with a tag, in any state (subscribed or not), as ids. @returns {Promise<Set<string>>} */
export async function tagMembers(kit, tagId) {
  const ids = new Set();
  const seen = new Set();
  let after = '';
  for (let page = 0; page < 100; page++) {
    const data = await kit.call(`/tags/${tagId}/subscribers?status=all&per_page=1000${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (!Array.isArray(data?.subscribers)) throw new Error('Kit answered a tag’s list without one.');
    for (const s of data.subscribers) ids.add(String(s.id));
    const p = data.pagination ?? {};
    if (!p.has_next_page) return ids;
    if (!p.end_cursor || seen.has(p.end_cursor)) throw new Error('Kit said a tag’s list had more but gave no next page.');
    seen.add(p.end_cursor);
    after = p.end_cursor;
  }
  throw new Error('A tag’s list went on for 100 pages.');
}

/** The id of the tag with this name, made if Kit has none (Kit's create answers with the one it has). */
export async function tagNamed(kit, name) {
  const { tag } = await kit.call('/tags', { method: 'POST', body: { name } });
  if (!tag?.id || tag.name !== name) throw new Error(`Kit didn’t make the “${name}” tag.`);
  return Number(tag.id);
}

/** The ids of the store's tag and its no-marketing tag (STORE_TAG, NO_MARKETING_TAG). */
export async function storeTags(kit) {
  const [store, noMarketing] = await Promise.all([idNamed(kit, 'tags', STORE_TAG), idNamed(kit, 'tags', NO_MARKETING_TAG)]);
  if (!store || !noMarketing) throw new Error(`Kit has no “${store ? NO_MARKETING_TAG : STORE_TAG}” tag.`);
  return { store, noMarketing };
}

/** Tags someone; false if Kit no longer has them. */
export async function addTag(kit, tagId, id) {
  try {
    await kit.call(`/tags/${tagId}/subscribers/${id}`, { method: 'POST', body: {} });
    return true;
  } catch (err) {
    if (/** @type {{ status?: number }} */ (err).status === 404) return false;
    throw err;
  }
}
export async function removeTag(kit, tagId, id) {
  try {
    await kit.call(`/tags/${tagId}/subscribers/${id}`, { method: 'DELETE' });
  } catch (err) {
    // Already off it, or no longer in Kit
    if (/** @type {{ status?: number }} */ (err).status !== 404) throw err;
  }
}

/**
 * Someone signing up on the site's form (api/subscribe.ts): a Kit subscriber (made if new) with the
 * store's tag, and off NO_MARKETING_TAG. Signing up here is them asking for the store's emails, so
 * it outweighs an earlier "no" to marketing at Shopify's checkout. Before Nov 25, 2026 the form only
 * added the tag, and a Shopify customer who had said no there and then signed up here stayed out of
 * the weekly email (STORE_SEGMENT) with no sign of it. Someone who unsubscribed in Kit stays
 * unsubscribed: Kit doesn't sign them back up.
 */
export async function signUp(kit, email) {
  const [{ subscriber }, store, noMarketing] = await Promise.all([
    kit.call('/subscribers', { method: 'POST', body: { email_address: email, state: 'active' } }),
    tagNamed(kit, STORE_TAG),
    tagNamed(kit, NO_MARKETING_TAG),
  ]);
  if (!subscriber?.id) throw new Error('Kit made no subscriber.');
  await kit.call(`/tags/${store}/subscribers/${subscriber.id}`, { method: 'POST', body: {} });
  await removeTag(kit, noMarketing, subscriber.id);
  return { id: Number(subscriber.id), state: subscriber.state };
}

/**
 * Kit's completed broadcasts since a day (YYYY-MM-DD), tests left out, as { id, sentAt, store }:
 * store is true for the store's own emails (isStoreEmail), read with their HTML.
 */
export async function sentSince(kit, since) {
  const { broadcasts = [] } = await kit.call(`/broadcasts?status=completed&sent_after=${since}&per_page=1000`);
  return broadcasts.filter((b) => b.send_at && !isTest(b)).map((b) => ({ id: Number(b.id), sentAt: b.send_at, store: isStoreEmail(b) }));
}

/** A broadcast's numbers from Kit: who it went to, opened and clicked it, and who unsubscribed. */
export async function statsOf(kit, id) {
  const { broadcast } = await kit.call(`/broadcasts/${id}/stats`);
  const s = broadcast?.stats ?? {};
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return { recipients: n(s.recipients), opened: n(s.emails_opened), openRate: n(s.open_rate), clickRate: n(s.click_rate), unsubscribes: n(s.unsubscribes), status: s.status ?? null };
}
