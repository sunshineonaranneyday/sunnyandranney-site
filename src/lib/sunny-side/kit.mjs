/**
 * Sending the weekly email through Kit, from the admin
 * ===========================================================================
 * Kit sends both the tests and the email itself, so a test is exactly what subscribers get. Kit's
 * API has no "send test" (its broadcasts endpoints only list, create, read, update, delete and
 * report), so a test is a small broadcast of its own, to just the people asked for: each is a Kit
 * subscriber with a tag of their own ("Weekly email test: <email>"), and the test goes to those
 * tags. The real email is a broadcast to every subscriber, at the time Staci picks.
 *
 * Neither is ever published to the web. Kit's docs disagree on whether sending needs "public"
 * (create: a send_at alone schedules; update: it takes public too), so every broadcast is made
 * with public off and read back at once: if Kit published it, it's taken off the web; if Kit
 * didn't schedule it, it's deleted and the admin says so. Nothing is left half-sent or public.
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
 * Schedules a broadcast, kept off the web, and checks with Kit that it's scheduled. `filter` is
 * Kit's subscriber_filter, or null for every subscriber.
 * @returns {Promise<{ id: number, status: string, sendAt: string }>}
 */
export async function schedule(kit, { subject, preheader, html, description, templateId, sendAt, filter = null }) {
  const body = { subject, preview_text: preheader, content: html, description, email_template_id: templateId, public: false, send_at: sendAt, ...(filter ? { subscriber_filter: filter } : {}) };
  const { broadcast } = await kit.call('/broadcasts', { method: 'POST', body });
  const id = broadcast.id;
  let now = (await kit.call(`/broadcasts/${id}`)).broadcast;
  if (now.public) {
    await kit.call(`/broadcasts/${id}`, { method: 'PUT', body: { public: false } });
    now = (await kit.call(`/broadcasts/${id}`)).broadcast;
    if (now.public) throw new Error('Kit put the email on the web, and wouldn’t take it off. It’s still scheduled: unpublish it in Kit.');
  }
  if (!now.send_at || now.status === 'draft') {
    await kit.call(`/broadcasts/${id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('Kit kept it as a draft instead of scheduling it, so nothing was sent.');
  }
  return { id, status: now.status ?? 'scheduled', sendAt: now.send_at };
}

/** Sends a test now-ish, to these testers' tags. @returns {Promise<{ id: number, status: string, sendAt: string }>} */
export function sendTest(kit, { subject, preheader, html, templateId, tagIds, description, now = Date.now() }) {
  return schedule(kit, {
    subject: `[Test] ${subject}`,
    preheader,
    html,
    description,
    templateId,
    sendAt: new Date(now + TEST_LEAD_MS).toISOString(),
    filter: [{ any: [{ type: 'tag', ids: tagIds }] }],
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

/** How many people the email would go to: the account's active subscribers. */
export async function subscriberCount(kit) {
  const data = await kit.call('/subscribers?status=active&include_total_count=true&per_page=1&slim=true');
  return Number(data?.pagination?.total_count ?? NaN);
}

/** A test, not a real send: the admin's tests go out with "[Test]" before the subject (sendTest). */
const isTest = (b) => /^\[Test\]/.test(b?.subject || '');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ id: number, subject: string, preheader: string, sentAt: string }} SentEmail
 */

/**
 * What has gone out to subscribers, newest first: Kit's completed broadcasts from the last year,
 * tests left out. Kit's list has no stated order, so the year is read whole (up to Kit's 1,000 a
 * page, slim: no bodies) and sorted here.
 * @returns {Promise<SentEmail[]>}
 */
export async function sentEmails(kit, { limit = 52, now = Date.now() } = {}) {
  return (await completed(kit, now)).slice(0, limit).map((b) => ({ id: b.id, subject: b.subject || '', preheader: b.preview_text || '', sentAt: b.send_at }));
}

/** Kit's completed broadcasts from the last year, tests left out, newest first (slim: no bodies). */
async function completed(kit, now) {
  const since = new Date(now - 366 * DAY_MS).toISOString().slice(0, 10);
  const { broadcasts = [] } = await kit.call(`/broadcasts?status=completed&sent_after=${since}&per_page=1000&slim=true`);
  return broadcasts.filter((b) => b.send_at && !isTest(b)).sort((a, b) => Date.parse(b.send_at) - Date.parse(a.send_at));
}

/**
 * The weekly emails this admin scheduled: it labels each one in Kit (send.ts, "The Sunny Side for
 * Tue, Nov 17, from the store admin"). The Kit account is the charity's too, so its reveal days and
 * newsletters go out from it at their own times, and the store's emails before this admin were sent
 * by hand whenever they were ready (Nov 3 at 5:29 PM, Nov 10 at 9:52 PM).
 */
export const fromThisAdmin = (b) => /^The Sunny Side for .*, from the store admin$/.test(b?.description || '');

/**
 * One email as Kit sent it, with its HTML, or null when it isn't one that went to subscribers: a
 * draft, one still scheduled, a test, or one deleted in Kit.
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
  if (!b?.send_at || isTest(b) || !['completed', 'sending'].includes(b.status)) return null;
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
