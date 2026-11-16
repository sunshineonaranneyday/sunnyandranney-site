import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { CADENCE, ICONS, PHONE_TABS, SIDEBAR, allLinks, currentHref, navFor, phoneNav, sidebarHeight } from './nav.mjs';

const PAGES = new URL('../../pages/', import.meta.url);
const LAYOUT = readFileSync(new URL('../../layouts/AdminBase.astro', import.meta.url), 'utf8');

/** Every page file under src/pages/admin, as the path it serves ([id] becomes x). */
function adminRoutes(dir = new URL('admin/', PAGES), base = '/admin/') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return adminRoutes(new URL(`${entry.name}/`, dir), `${base}${entry.name.replace(/\[.*\]/, 'x')}/`);
    if (!entry.name.endsWith('.astro')) return [];
    const source = readFileSync(new URL(entry.name, dir), 'utf8');
    const name = entry.name.replace(/\.astro$/, '').replace(/\[.*\]/, 'x');
    return [{ route: name === 'index' ? base : `${base}${name}/`, redirect: source.includes('Astro.redirect(') && !source.includes('<AdminBase') }];
  });
}

const PEOPLE = {
  owner: { role: 'manager', owner: true },
  manager: { role: 'manager', owner: false },
  'store tablet': { role: 'kiosk', owner: false },
  'email-only login': { role: 'email', owner: false },
};

for (const [who, signIn] of Object.entries(PEOPLE)) {
  const nav = navFor(signIn);
  const links = allLinks(nav);

  test(`${who}: every link fits the sidebar on one screen, sub-pages open`, () => {
    const height = sidebarHeight(nav);
    assert.ok(
      height <= SIDEBAR.budget,
      `the ${who}'s sidebar needs ${height}px, over the ${SIDEBAR.budget}px budget. Put the new page under the page it belongs to, or merge a section.`,
    );
  });

  test(`${who}: every link has its own icon, so the phone's More sheet never shows two alike`, () => {
    for (const link of links) assert.ok(ICONS[link.icon], `${link.label} uses "${link.icon}", which isn't an icon`);
    const icons = links.map((link) => link.icon);
    assert.deepEqual(icons, [...new Set(icons)], `two of the ${who}'s links share an icon`);
  });

  test(`${who}: no page is listed twice`, () => {
    const hrefs = links.map((link) => link.href);
    assert.deepEqual(hrefs, [...new Set(hrefs)]);
  });

  test(`${who}: every link goes to a page that exists`, () => {
    for (const { href } of links) {
      const file = href.replace(/^\//, '').replace(/\/$/, '');
      assert.ok(existsSync(new URL(`${file}.astro`, PAGES)) || existsSync(new URL(`${file}/index.astro`, PAGES)), `${href} has no page`);
    }
  });

  test(`${who}: pages run from the most used to the least, in each section and down the sidebar`, () => {
    const rank = (link) => CADENCE.indexOf(link.cadence);
    for (const section of nav.sections) {
      for (const link of section.links) assert.ok(rank(link) >= 0, `${link.label} doesn't say how often it's used`);
      const ranks = section.links.map(rank);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${section.heading || 'The top'} isn't in order of use: ${section.links.map((l) => `${l.label} (${l.cadence})`).join(', ')}`);
    }
    const firsts = nav.sections.map((section) => rank(section.links[0]));
    assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b), 'a section used less often sits above one used more');
  });

  test(`${who}: no more than two levels, and every page is in a section, none pinned apart`, () => {
    assert.deepEqual(Object.keys(nav), ['sections']);
    for (const link of links) for (const child of link.children ?? []) assert.equal(child.children, undefined, `${child.label} has sub-pages`);
  });

  test(`${who}: the phone has at most ${PHONE_TABS} tabs plus More, and every page is on it`, () => {
    const phone = phoneNav(nav, undefined);
    assert.ok(phone.tabs.length <= PHONE_TABS, `${phone.tabs.length} tabs`);
    assert.equal(phone.tabs.length + phone.groups.flat().length, links.length);
  });
}

test('every admin page lights up a link in the manager’s navigation', () => {
  const links = allLinks(navFor(PEOPLE.owner));
  for (const { route, redirect } of adminRoutes()) {
    if (!redirect) assert.ok(currentHref(route, links), `${route} has no link, so nothing in the sidebar shows where you are`);
  }
});

test('the layout sizes the sidebar from SIDEBAR, so the height model holds', () => {
  for (const name of ['--row', '--heading', '--section-gap', '--touch-row']) {
    assert.ok(LAYOUT.includes(`${name}:\${`), `the layout doesn't set ${name} from SIDEBAR`);
    assert.ok(LAYOUT.includes(`var(${name})`), `the layout's CSS doesn't use ${name}`);
  }
});

test('on the phone, a sub-page lights up its page’s tab, or More', () => {
  const nav = navFor(PEOPLE.owner);
  assert.deepEqual(pick(phoneNav(nav, '/admin/hours/history/')), { activeTab: '/admin/hours/', moreActive: false });
  assert.deepEqual(pick(phoneNav(nav, '/admin/payroll/gusto/')), { activeTab: '/admin/payroll/', moreActive: false });
  assert.deepEqual(pick(phoneNav(nav, '/admin/buying/costs/')), { activeTab: undefined, moreActive: true });
  assert.deepEqual(pick(phoneNav(nav, '/admin/')), { activeTab: '/admin/', moreActive: false });
});

const pick = ({ activeTab, moreActive }) => ({ activeTab, moreActive });

test('a sub-page lives under its parent, so the parent opens on it', () => {
  for (const section of navFor(PEOPLE.owner).sections) {
    for (const link of section.links) {
      for (const child of link.children ?? []) assert.ok(child.href.startsWith(link.href), `${child.label} isn't under ${link.label}`);
    }
  }
});

test('the sidebar fits with room to spare: one more page still fits on a 13-inch laptop', () => {
  assert.ok(sidebarHeight(navFor(PEOPLE.owner)) + SIDEBAR.row <= SIDEBAR.budget);
});

test('the old flat sidebar fails the budget, which is how it grew a scrollbar', () => {
  const nav = navFor(PEOPLE.owner);
  const flat = { ...nav, sections: nav.sections.map((s) => ({ ...s, links: s.links.flatMap((l) => [{ ...l, children: undefined }, ...(l.children ?? [])]) })) };
  assert.ok(sidebarHeight(flat) > SIDEBAR.budget);
});

test('the current page is the deepest link the path starts with', () => {
  const links = allLinks(navFor(PEOPLE.owner));
  assert.equal(currentHref('/admin/', links), '/admin/');
  assert.equal(currentHref('/admin', links), '/admin/');
  assert.equal(currentHref('/admin/buying/', links), '/admin/buying/');
  assert.equal(currentHref('/admin/buying/po_123', links), '/admin/buying/');
  assert.equal(currentHref('/admin/buying/costs/', links), '/admin/buying/costs/');
  assert.equal(currentHref('/admin/hours/send', links), '/admin/hours/');
  assert.equal(currentHref('/admin/hours/history/', links), '/admin/hours/history/');
  assert.equal(currentHref('/admin/payroll/', links), '/admin/payroll/');
  assert.equal(currentHref('/admin/payroll/gusto/', links), '/admin/payroll/gusto/');
  assert.equal(currentHref('/admin/staff/abc', links), '/admin/staff/');
  assert.equal(currentHref('/admin/nowhere/', links), undefined);
});

test('Today is first, with no heading: home, and the list of what needs you', () => {
  const [top] = navFor(PEOPLE.manager).sections;
  assert.equal(top.heading, '');
  assert.deepEqual(top.links.map((link) => link.href), ['/admin/']);
});

test('Gusto’s connection is under Payroll, the owner’s alone, not pinned to the foot', () => {
  const under = (signIn) => allLinks(navFor(signIn)).find((link) => link.href === '/admin/payroll/')?.children?.map((child) => child.href);
  assert.deepEqual(under(PEOPLE.owner), ['/admin/payroll/gusto/']);
  assert.equal(under(PEOPLE.manager), undefined);
  assert.ok(!LAYOUT.includes('settingsLink'), 'the layout still draws a pinned settings link');
  // The old address still lands there, for bookmarks and Gusto's sign-in coming back.
  assert.match(readFileSync(new URL('admin/gusto.astro', PAGES), 'utf8'), /Astro\.redirect\(`\/admin\/payroll\/gusto\/\$\{Astro\.url\.search\}`, 301\)/);
});

test('search lists a page by its label, never with the work waiting beside it', () => {
  const shell = readFileSync(new URL('./shell.ts', import.meta.url), 'utf8');
  assert.match(shell, /querySelector\("\.side-label"\)/);
  assert.equal((LAYOUT.match(/class="side-label"/g) ?? []).length, 3, 'the sidebar page, sub-page and More rows each wrap their label');
});

test('an email-only login sees the weekly email and nothing else', () => {
  assert.deepEqual(allLinks(navFor(PEOPLE['email-only login'])).map((link) => link.href), ['/admin/email/']);
});

test('someone without a role gets no navigation', () => {
  assert.equal(allLinks(navFor({})).length, 0);
});
