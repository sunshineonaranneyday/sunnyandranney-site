/**
 * One small line icon per availability state, so the state reads at a glance and never
 * by color alone (WCAG 1.4.1): a storefront for the showroom floor, a box for the
 * warehouse, a check for in stock, a calendar for a special order, a tag for sold.
 * Drawn on a 24px grid at the site's 1.5px stroke, like the page's other icons.
 */

const PATHS = {
  showroom: '<path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M3.5 9.5h17v.6a2.83 2.83 0 0 1-5.67 0 2.83 2.83 0 0 1-5.66 0 2.83 2.83 0 0 1-5.67 0z"/><path d="M5 12.7V20h14v-7.3"/><path d="M10 20v-4.5h4V20"/>',
  warehouse: '<path d="M12 3.2 3.8 7.6v8.8L12 20.8l8.2-4.4V7.6z"/><path d="M3.8 7.6 12 12l8.2-4.4"/><path d="M12 12v8.8"/><path d="m7.9 5.4 8.2 4.4"/>',
  'in-stock': '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.7-5.1"/>',
  special: '<rect x="3.8" y="5.2" width="16.4" height="15" rx="2"/><path d="M8.2 3.2v3.6M15.8 3.2v3.6M3.8 10h16.4"/><path d="M8 14h2.5M8 17h5"/>',
  gone: '<path d="M20.2 13.4 13.4 20.2a1.6 1.6 0 0 1-2.3 0L3.8 12.9V3.8h9.1l7.3 7.3a1.6 1.6 0 0 1 0 2.3z"/><circle cx="8.3" cy="8.3" r="1.3"/>',
};

/**
 * @param {'showroom' | 'warehouse' | 'in-stock' | 'special' | 'gone'} state
 * @param {number} [size]
 * @returns {string} an inline SVG, decorative (the words beside it carry the meaning)
 */
export function availabilityIcon(state, size = 20) {
  const paths = PATHS[state] ?? PATHS['in-stock'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
