/**
 * The admin's navigation: which pages each role sees, in what order, and how
 * tall the desktop sidebar is. AdminBase draws the sidebar from it, on every
 * screen, nav-status.mjs puts the work waiting on its links, and nav.test.mjs
 * holds these rules as pages are added:
 *
 *  1. Today comes first, with no heading. It's home and the list of what needs
 *     you, like Stripe's Home and Linear's Inbox.
 *  2. Sections are the store's jobs, ordered by how often the store does them:
 *     the daily ones at the top, and the rarely used last in each section
 *     (Material: "Put the most frequent destinations at the top"; NN/g:
 *     "place less-important ones at the bottom"). Each page says how often in
 *     `cadence`. The order never changes by itself, so it can be learned
 *     (NN/g: reordering on its own "break[s] users' ability to build spatial memory").
 *  3. A setting lives under the page it sets, as in Lightspeed (Sell > Settings)
 *     and Toast (setup "shouldn't need to be accessed on a regular basis"), not
 *     pinned at the foot: Gusto's connection is under Payroll.
 *  4. Work waiting shows on the link where it's done (nav-status.mjs), instead
 *     of on a bell or only on the home page as Gusto and Stripe do.
 *  5. No more than two levels (Apple, GitLab), and every link on one screen
 *     (SIDEBAR.budget).
 *  6. One menu on every screen. On a phone or an upright iPad the same sidebar
 *     slides in from a menu button in the top bar, as Shopify's Polaris Frame
 *     does for web admins on small screens, so the pages sit in the same order
 *     under the same headings everywhere. The button carries a dot while work
 *     waits on a page in it (rule 4), so the closed menu never hides it.
 */

import { EMAIL_HOST } from '../admin-host.mjs';

/** @typedef {'manager' | 'kiosk' | 'email'} NavRole */

/**
 * How often the store does each job, most often first, from its own rhythm on
 * 2026-11-16: shifts and the clock every day, orders and receiving as
 * deliveries come, the email every Tuesday, payroll every other Friday (Aug 14
 * to Nov 6 in Gusto), sales tax by the 20th, and staff, vendors, donations and
 * the Gusto connection now and then.
 */
export const CADENCE = /** @type {const} */ (['daily', 'deliveries', 'weekly', 'biweekly', 'monthly', 'rarely']);

/**
 * @typedef {object} NavLink
 * @property {string} href
 * @property {string} label
 * @property {string} [icon] A key of ICONS. Every page has one; a sub-page has none and lines up under its page's label.
 * @property {typeof CADENCE[number]} [cadence] How often it's used; every page in a section has one.
 * @property {NavLink[]} [children] Pages under this one, listed beneath it while you're in it.
 */

/** @typedef {{ heading: string, links: NavLink[] }} NavSection An empty heading draws none. */
/** @typedef {{ sections: NavSection[] }} Nav */

/**
 * Feather line icons (MIT), drawn inline so the page needs no image requests.
 * @type {Record<string, string>}
 */
export const ICONS = {
  today: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  schedule: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  hours: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  staff: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  buying: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  receive: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  vendors: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  email: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  payroll: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  tax: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  giving: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};

/**
 * Who the sidebar is drawn for at this address. Only the weekly email opens on
 * the email address, for anyone (inScope in admin-host.mjs), so everyone there
 * gets the email-only view; a sidebar never lists a page its address won't open.
 * @param {{ role?: NavRole, owner?: boolean } | undefined} who
 * @param {string} host lower case
 * @returns {{ role?: NavRole, owner: boolean }}
 */
export function viewFor(who, host) {
  if (!who?.role) return { role: undefined, owner: false };
  return host === EMAIL_HOST ? { role: 'email', owner: false } : { role: who.role, owner: Boolean(who.owner) };
}

/**
 * The pages a signed-in person sees. Managers get the whole admin, the owner
 * also gets Gusto's connection under Payroll, the store tablet gets the clock
 * and schedule, and an email-only login gets the weekly email alone.
 * @param {{ role?: NavRole, owner?: boolean }} who
 * @returns {Nav}
 */
export function navFor({ role, owner }) {
  if (role === 'kiosk') {
    return {
      sections: [
        {
          heading: 'Store',
          links: [
            { href: '/admin/clock/', label: 'Time clock', icon: 'clock', cadence: 'daily' },
            { href: '/admin/schedule/', label: 'Schedule', icon: 'schedule', cadence: 'daily' },
          ],
        },
      ],
    };
  }
  if (role === 'email') {
    return {
      sections: [{ heading: '', links: [{ href: '/admin/email/', label: 'Weekly email', icon: 'email', cadence: 'weekly' }] }],
    };
  }
  if (role !== 'manager') return { sections: [] };
  return {
    sections: [
      {
        heading: '',
        links: [
          {
            href: '/admin/',
            label: 'Today',
            icon: 'today',
            cadence: 'daily',
            // What shoppers search the website for. It opens beneath Today on the home page,
            // so it takes none of the sidebar's spare row; checked now and then.
            children: [{ href: '/admin/search/', label: 'Site search' }],
          },
        ],
      },
      {
        heading: 'Team',
        links: [
          { href: '/admin/schedule/', label: 'Schedule', icon: 'schedule', cadence: 'daily' },
          {
            href: '/admin/hours/',
            label: 'Hours',
            icon: 'hours',
            cadence: 'daily',
            children: [{ href: '/admin/hours/history/', label: 'Gusto history' }],
          },
          { href: '/admin/clock/', label: 'Time clock', icon: 'clock', cadence: 'daily' },
          { href: '/admin/staff/', label: 'Staff', icon: 'staff', cadence: 'rarely' },
        ],
      },
      {
        heading: 'Stock',
        links: [
          {
            href: '/admin/buying/',
            label: 'Purchase orders',
            icon: 'buying',
            cadence: 'deliveries',
            children: [{ href: '/admin/buying/costs/', label: 'Costs to match' }],
          },
          { href: '/admin/receiving/', label: 'Receiving', icon: 'receive', cadence: 'deliveries' },
          {
            href: '/admin/vendors/',
            label: 'Vendors',
            icon: 'vendors',
            cadence: 'rarely',
            // Special orders hang on vendor lead times: a vendor with one makes its sold-out pieces requestable.
            children: [{ href: '/admin/vendors/special-orders/', label: 'Special orders' }],
          },
        ],
      },
      {
        // What customers see and give: the email they read, the round-ups they add at checkout.
        heading: 'Customers',
        links: [
          { href: '/admin/email/', label: 'Weekly email', icon: 'email', cadence: 'weekly' },
          { href: '/admin/donations/', label: 'Donations', icon: 'giving', cadence: 'rarely' },
        ],
      },
      {
        heading: 'Pay',
        links: [
          {
            href: '/admin/payroll/',
            label: 'Payroll',
            icon: 'payroll',
            cadence: 'biweekly',
            children: owner ? [{ href: '/admin/payroll/gusto/', label: 'Gusto connection' }] : undefined,
          },
          { href: '/admin/sales-tax/', label: 'Sales tax', icon: 'tax', cadence: 'monthly' },
        ],
      },
    ],
  };
}

/**
 * Every link in sidebar order: each page followed by its sub-pages.
 * @param {Nav} nav
 * @returns {NavLink[]}
 */
export function allLinks(nav) {
  return nav.sections.flatMap((section) => section.links.flatMap((link) => [link, ...(link.children ?? [])]));
}

/**
 * The link for the page at this path: the longest href it starts with, so a
 * purchase order's own page lights up Purchase orders. Today is /admin/ only.
 * @param {string} path
 * @param {NavLink[]} links
 * @returns {string | undefined}
 */
export function currentHref(path, links) {
  return links
    .filter((link) => (link.href === '/admin/' ? path === '/admin/' || path === '/admin' : path.startsWith(link.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/**
 * Desktop sidebar sizes in CSS px. AdminBase's CSS takes row, heading, gap and
 * touch row from here, so this model and the page can't drift apart. The frame
 * (padding, logo, search, signed-in row) was measured in Chrome on 2026-11-12
 * and again on 2026-11-16, when the model matched the page to the pixel; a
 * change to the logo, search or footer needs it measured again.
 */
export const SIDEBAR = {
  /** One link with a mouse. Shopify's admin uses 30. */
  row: 30,
  /**
   * One link on a touch screen (the phone's slide-in menu, an iPad in
   * landscape), Apple's minimum target. The list can scroll there, so the shell
   * scrolls the current page into view and fades the edge that has more.
   */
  touchRow: 44,
  /** A section label such as TEAM. */
  heading: 18,
  /** Space between sections. */
  gap: 12,
  /** Everything that isn't the link list. */
  frame: 156,
  /**
   * The shortest window every link must fit in, with no scrollbar. A 13-inch
   * MacBook Air shows about 747px of page in Chrome with the Dock; the
   * bookmarks bar takes about 28px more. Shorter windows scroll the list.
   */
  budget: 700,
};

/**
 * Height the desktop sidebar needs, with its longest list of sub-pages open.
 * @param {Nav} nav
 * @returns {number}
 */
export function sidebarHeight(nav) {
  const { sections } = nav;
  if (sections.length === 0) return SIDEBAR.frame;
  const rows = sections.reduce((sum, section) => sum + section.links.length, 0);
  const mostChildren = Math.max(...sections.flatMap((section) => section.links.map((link) => link.children?.length ?? 0)));
  const headings = sections.filter((section) => section.heading).length;
  return SIDEBAR.frame + (rows + mostChildren) * SIDEBAR.row + headings * SIDEBAR.heading + (sections.length - 1) * SIDEBAR.gap;
}
