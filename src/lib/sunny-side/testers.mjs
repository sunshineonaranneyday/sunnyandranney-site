/**
 * Who checks the weekly email before it goes: the store's list of testers
 * ===========================================================================
 * Tests go out from Kit's own "Send test" (kit.mjs), and the page keeps the people who check each
 * email (the photographer, the manager, whoever approves) so their addresses are a click away.
 * The list lives in D1 (test-store.mjs), never in this public repo. The person signed in is always
 * on it, as "You". No Node or browser APIs.
 */

export const NAME_MAX = 40;
export const TEST_MAX = 10;
export const TESTS_PER_DAY = 20;

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s);

/** A person as typed: a name (or the start of the email when there's none) and a lowercase email. */
export function cleanPerson(p) {
  const email = String(p?.email ?? '').trim().toLowerCase();
  const name = String(p?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  return { name: name || email.split('@')[0].replace(/^./, (c) => c.toUpperCase()), email };
}

/** What's wrong with a person about to be added, keyed by field, or {}. */
export function checkPerson(p, list = []) {
  if (!p.email) return { email: 'Type their email.' };
  if (!isEmail(p.email)) return { email: `“${p.email}” isn’t an email address.` };
  const same = list.find((x) => x.email === p.email);
  if (same?.you) return { email: 'That’s your own email: you’re always on the list.' };
  if (same) return { email: `${same.name} is already on the list with that email.` };
  return {};
}

/**
 * The list as the page shows it: the person signed in first, as "You", then everyone else by name.
 * @param {{ name: string, email: string }[]} saved
 * @returns {{ name: string, email: string, you?: boolean }[]}
 */
export function testPeople(saved, me) {
  const mine = String(me || '').toLowerCase();
  const others = saved.filter((p) => p.email !== mine).sort((a, b) => a.name.localeCompare(b.name));
  return [...(mine ? [{ name: 'You', email: mine, you: true }] : []), ...others];
}

/**
 * Whom a test may go to, or why not: 1 to TEST_MAX people, each on the list.
 * @returns {{ to: string[] } | { error: string }}
 */
export function testRecipients(asked, people) {
  if (!Array.isArray(asked) || !asked.length) return { error: 'Pick who the test goes to.' };
  const to = [...new Set(asked.map((e) => String(e).trim().toLowerCase()))];
  if (to.length > TEST_MAX) return { error: `A test can go to ${TEST_MAX} people at most.` };
  const known = new Set(people.map((p) => p.email));
  const stranger = to.find((e) => !known.has(e));
  if (stranger) return { error: `${isEmail(stranger) ? stranger : 'That address'} isn’t on the list. Add them first.` };
  return { to };
}

/** "Staci and Holly", "Staci, Holly and Mike", or "you" for the sender alone. */
export function namesOf(emails, people) {
  const name = (e) => {
    const p = people.find((x) => x.email === e);
    return p ? (p.you ? 'you' : p.name.trim().split(/\s+/)[0]) : e;
  };
  const names = emails.map(name);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
