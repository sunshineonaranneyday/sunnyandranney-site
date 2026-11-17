// The email-only login: someone who helps with the weekly email and must reach nothing else.
// Two locks hold it, and these tests walk every page and call under src/pages against both:
//  1. The front door (middleware.ts, with inScope from admin-host.mjs) refuses anything but the
//     weekly email to that login, and refuses everything else on the email address, before a page runs.
//  2. Every other admin page and call checks the role itself, and none lets that login in.
// A third lock is Cloudflare's: the email address has its own Access application, and the admin's
// address never accepts its sign-ins (admin-auth.ts picks the audience by address).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { verifyAccessJwt } from './access-jwt.mjs';
import { ADMIN_HOST, EMAIL_HOST, adminHostRedirect, inScope, isEmailPath } from './admin-host.mjs';
import { audienceFor, identityFrom } from './admin-identity.mjs';
import { allLinks, navFor, viewFor } from './admin/nav.mjs';

const PAGES = new URL('../pages/', import.meta.url);
const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/i;

/** A file name as the part of the path it serves: [id] is x, [...rest] is a/b. */
const segment = (name) => name.replace(/\[\.\.\.[^\]]*\]/g, 'a/b').replace(/\[[^\]]*\]/g, 'x');

/** Every page and call under src/pages: its file, a path it serves, and its source. */
function routes(dir = PAGES, base = '/') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return routes(new URL(`${entry.name}/`, dir), `${base}${segment(entry.name)}/`);
    if (!/\.(astro|ts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return [];
    const name = segment(entry.name.replace(/\.(astro|ts)$/, ''));
    const source = readFileSync(new URL(entry.name, dir), 'utf8');
    return [{ file: `src/pages${base}${entry.name}`, path: name === 'index' ? base : `${base}${name}/`, source }];
  });
}

const ALL = routes();
const ADMIN = ALL.filter((r) => ADMIN_PATH.test(r.path));
const SERVER = ALL.filter((r) => /export const prerender = false/.test(r.source));
const HOSTS = [ADMIN_HOST, EMAIL_HOST, 'sunnyandranney-site.pages.dev', 'sunnyandranney.com', 'localhost'];

/** What the email-only login may use. A new page or call here is one more thing it can do: add it on purpose. */
const EMAIL_ROUTES = [
  '/admin/email/',
  '/admin/email/sent/',
  '/admin/email/sent/x/',
  '/api/admin/email/event/',
  // The preview's report of a problem in the email's own layout, which only the owner is shown (and may clear)
  '/api/admin/email/layout/',
  '/api/admin/email/photos/',
  '/api/admin/email/send/',
  '/api/admin/email/test-people/',
  '/api/admin/email/test/',
  '/api/admin/email/week/',
];

test('the walk finds the whole admin, so nothing below is passed by finding nothing', () => {
  assert.ok(ADMIN.length >= 45, `only ${ADMIN.length} admin pages and calls found`);
  for (const path of ['/admin/payroll/', '/admin/hours/', '/admin/staff/x/', '/api/admin/gusto/send/', '/api/admin/medusa/a/b/', '/api/admin/people/']) {
    assert.ok(ADMIN.some((r) => r.path === path), `${path} wasn't found`);
  }
});

test('the email-only login reaches the weekly email and no other admin page or call, at any address', () => {
  for (const host of HOSTS) {
    const reached = ADMIN.filter((r) => inScope({ role: 'email' }, host, r.path)).map((r) => r.path).sort();
    assert.deepEqual(reached, [...EMAIL_ROUTES].sort(), `at ${host}`);
  }
});

test('at the email address, even a manager reaches only the weekly email', () => {
  for (const r of ADMIN) assert.equal(inScope({ role: 'manager' }, EMAIL_HOST, r.path), EMAIL_ROUTES.includes(r.path), r.path);
});

test('at the admin address, managers and the store tablet are as they were', () => {
  for (const r of ADMIN) {
    assert.equal(inScope({ role: 'manager' }, ADMIN_HOST, r.path), true, r.path);
    assert.equal(inScope({ role: 'kiosk' }, ADMIN_HOST, r.path), true, r.path);
  }
});

test('the email address refuses the store’s own server code too (cart, chat, syncs, calendars)', () => {
  const outside = SERVER.filter((r) => !ADMIN_PATH.test(r.path));
  assert.ok(outside.length >= 5, 'the walk found the store’s server routes');
  for (const r of outside) assert.equal(isEmailPath(r.path), false, `${r.path} would run on the email address`);
});

test('the front door checks before any page runs', () => {
  const mw = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  const hostCheck = mw.indexOf('host === EMAIL_HOST && !isEmailPath(path)');
  const scope = mw.indexOf('if (!inScope(identity, host, path)) return deny(');
  const handOff = mw.indexOf('context.locals.admin = identity');
  assert.ok(hostCheck > 0 && hostCheck < mw.indexOf('if (!ADMIN_PATH.test(path)) return next();'), 'the email address is closed before non-admin paths are let through');
  assert.ok(scope > 0 && scope < handOff, 'the scope is checked before the page gets the sign-in');
});

test('every other admin page and call checks the role itself, and none lets the email login in', () => {
  for (const r of ADMIN.filter((x) => !EMAIL_ROUTES.includes(x.path))) {
    const redirectOnly = /Astro\.redirect\(/.test(r.source) && !/<AdminBase/.test(r.source) && !/runtime\.env/.test(r.source);
    if (redirectOnly) continue;
    if (r.file.endsWith('.ts')) {
      const handlers = (r.source.match(/^export (const|async function) (GET|POST|PUT|PATCH|DELETE|ALL)\b/gm) ?? []).length;
      const checks = (r.source.match(/require(Role|Owner)\(/g) ?? []).length;
      assert.ok(handlers > 0 && checks >= handlers, `${r.file}: ${handlers} handlers, ${checks} role checks`);
    } else {
      assert.match(r.source, /role !== 'manager'|require(Role|Owner)\(|if \(!Astro\.locals\.admin\?\.owner\)/, `${r.file} has no role check of its own`);
    }
    for (const line of r.source.split('\n')) {
      if (/role|require(Role|Owner)/.test(line)) assert.doesNotMatch(line, /'email'/, `${r.file} lets the email login in: ${line.trim()}`);
    }
  }
});

test('the weekly email’s own page and calls let the email login in, and say so', () => {
  for (const r of ADMIN.filter((x) => EMAIL_ROUTES.includes(x.path))) {
    assert.match(r.source, /'manager', 'email'|role !== 'email'/, `${r.file} doesn't let the email login in`);
  }
});

test('a path that climbs out of the email is cleaned up before it’s checked', () => {
  for (const sneaky of ['/admin/email/../payroll/', '/admin/email/%2e%2e/payroll/', '/admin/email/.%2E/payroll/', '/api/admin/email/../../admin/hours/']) {
    const { pathname } = new URL(`https://${EMAIL_HOST}${sneaky}`);
    assert.equal(isEmailPath(pathname), false, `${sneaky} became ${pathname}`);
  }
  for (const near of ['/admin/emails/', '/admin/email-old/', '/admin/emailer', '/api/admin/emailing/']) assert.equal(isEmailPath(near), false, near);
  assert.equal(isEmailPath('/ADMIN/EMAIL/'), true);
  assert.equal(isEmailPath('/admin/email'), true);
});

test('the email address opens on the weekly email, from anywhere else', () => {
  const at = (href, method = 'GET') => adminHostRedirect(new URL(href), method);
  const home = `https://${EMAIL_HOST}/admin/email/`;
  assert.equal(at(`https://${EMAIL_HOST}/`), home);
  assert.equal(at(`https://${EMAIL_HOST}/admin/`), home);
  assert.equal(at(`https://${EMAIL_HOST}/admin/payroll/`), home);
  assert.equal(at(`https://${EMAIL_HOST}/shop/`), home);
  assert.equal(at(`https://${EMAIL_HOST}/admin/email/?send=2026-11-24`), null);
  // Calls and posts aren't moved: the front door refuses them.
  assert.equal(at(`https://${EMAIL_HOST}/api/admin/people/`), null);
  assert.equal(at(`https://${EMAIL_HOST}/admin/payroll/`, 'POST'), null);
});

// Real tokens, signed as Cloudflare Access signs them, run through the admin's own checks:
// verifyAccessJwt with the audience the address takes, then the role, then the front door.
const TEAM = 'soard.cloudflareaccess.com';
const NOW = 1_800_000_000;
const ENV = {
  CF_ACCESS_AUD: 'admin-app-aud',
  CF_ACCESS_EMAIL_AUD: 'email-app-aud',
  ADMIN_MANAGER_EMAILS: 'staci@sunnyandranney.com',
  ADMIN_EMAIL_EMAILS: 'mike@mikethomasgroup.com',
  ADMIN_KIOSK_SERVICE_TOKENS: 'tablet-client-id',
};
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'access-key' };
const b64 = (v) => Buffer.from(v).toString('base64url');
async function token(claims) {
  const head = b64(JSON.stringify({ alg: 'RS256', kid: 'access-key' }));
  const body = b64(JSON.stringify({ iss: `https://${TEAM}`, exp: NOW + 600, nbf: NOW - 60, ...claims }));
  const sig = await crypto.subtle.sign(RSA, pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(new Uint8Array(sig))}`;
}
/** Who the admin says this token is at this address, or null: the same steps as authenticate(). */
async function signIn(jwt, host, env = ENV) {
  const verified = await verifyAccessJwt(jwt, { teamDomain: TEAM, audience: audienceFor(host, env), nowSeconds: NOW, getKeys: async () => [publicJwk] });
  return verified && identityFrom(verified, host, env);
}
/** Every admin page and call this token opens at this address. */
async function opens(jwt, host, env) {
  const who = await signIn(jwt, host, env);
  return who ? ADMIN.filter((r) => inScope(who, host, r.path)).map((r) => r.path).sort() : [];
}

const mike = await token({ aud: [ENV.CF_ACCESS_EMAIL_AUD], email: 'mike@mikethomasgroup.com' });
const staci = await token({ aud: [ENV.CF_ACCESS_AUD], email: 'staci@sunnyandranney.com' });

test('Mike’s sign-in opens the weekly email at its own address, and nothing at any other', async () => {
  assert.deepEqual(await signIn(mike, EMAIL_HOST), { email: 'mike@mikethomasgroup.com', role: 'email', owner: false });
  assert.deepEqual(await opens(mike, EMAIL_HOST), [...EMAIL_ROUTES].sort());
  for (const host of HOSTS.filter((h) => h !== EMAIL_HOST)) assert.deepEqual(await opens(mike, host), [], `at ${host}`);
});

test('a manager’s admin sign-in is refused at the email address, and works as before at the admin', async () => {
  assert.equal(await signIn(staci, EMAIL_HOST), null);
  assert.equal((await opens(staci, ADMIN_HOST)).length, ADMIN.length);
});

test('if Mike were ever put on the admin’s Access rule by mistake, the front door still holds him to the email', async () => {
  const slipped = await token({ aud: [ENV.CF_ACCESS_AUD], email: 'mike@mikethomasgroup.com' });
  for (const host of [ADMIN_HOST, 'sunnyandranney-site.pages.dev']) assert.deepEqual(await opens(slipped, host), [...EMAIL_ROUTES].sort(), `at ${host}`);
});

test('a manager on the email address’s rule still sees only the weekly email there', async () => {
  const staciThere = await token({ aud: [ENV.CF_ACCESS_EMAIL_AUD], email: 'staci@sunnyandranney.com' });
  assert.deepEqual(await opens(staciThere, EMAIL_HOST), [...EMAIL_ROUTES].sort());
});

test('the store tablet’s token is no good at the email address', async () => {
  for (const aud of [ENV.CF_ACCESS_AUD, ENV.CF_ACCESS_EMAIL_AUD]) {
    assert.equal(await signIn(await token({ aud: [aud], common_name: 'tablet-client-id' }), EMAIL_HOST), null);
  }
  assert.equal((await signIn(await token({ aud: [ENV.CF_ACCESS_AUD], common_name: 'tablet-client-id' }), ADMIN_HOST)).role, 'kiosk');
});

test('someone on no list gets nothing, at either address', async () => {
  const stranger = await token({ aud: [ENV.CF_ACCESS_EMAIL_AUD], email: 'someone@example.com' });
  assert.equal(await signIn(stranger, EMAIL_HOST), null);
});

test('with the email rule’s ID unset, the email address refuses everyone, Mike included', async () => {
  const { CF_ACCESS_EMAIL_AUD, ...unset } = ENV;
  assert.equal(await signIn(mike, EMAIL_HOST, unset), null);
  assert.equal(await signIn(staci, EMAIL_HOST, unset), null);
});

test('the admin’s sign-in code uses these same steps', () => {
  const auth = readFileSync(new URL('./admin-auth.ts', import.meta.url), 'utf8');
  assert.match(auth, /const audience = audienceFor\(host, env\);/);
  assert.match(auth, /return identityFrom\(verified, host, env\);/);
});

test('the sidebar never lists a page its address won’t open, for any login at any address', () => {
  const logins = { owner: { role: 'manager', owner: true }, manager: { role: 'manager', owner: false }, tablet: { role: 'kiosk', owner: false }, email: { role: 'email', owner: false } };
  for (const [name, who] of Object.entries(logins)) {
    for (const host of HOSTS) {
      const links = allLinks(navFor(viewFor(who, host))).flatMap((l) => [l, ...(l.children ?? [])]);
      for (const link of links) assert.ok(inScope(who, host, link.href), `${name} at ${host} is shown ${link.href}, which won’t open there`);
    }
    // At the email address everyone sees exactly what Mike sees
    assert.deepEqual(navFor(viewFor(who, EMAIL_HOST)), navFor({ role: 'email' }), `${name} at the email address`);
    assert.equal(viewFor(who, EMAIL_HOST).owner, false);
  }
});

test('the layout draws the sidebar for the address, not just the role', () => {
  const layout = readFileSync(new URL('../layouts/AdminBase.astro', import.meta.url), 'utf8');
  assert.match(layout, /const view = viewFor\(admin, Astro\.url\.hostname\.toLowerCase\(\)\);/);
  assert.match(layout, /const nav = navFor\(view\);/);
  assert.match(layout, /const role: AdminRole \| undefined = view\.role;/);
});
