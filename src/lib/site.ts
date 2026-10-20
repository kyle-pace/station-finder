// Site-wide helpers usable from pages and components.

// The site lives under /station-finder on GitHub Pages. Every internal link goes through
// url() so changing `base` in astro.config.mjs is the only thing needed after a move.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path: string) => `${BASE}${path.startsWith('/') ? path : `/${path}`}`;

export const SITE_NAME = 'Find My Station';
export const REPO = 'https://github.com/kyle-pace/station-finder';

// The anonymous counter's web app URL (see counter/SETUP.md). Empty = counting is off.
export const COUNTER_URL = 'https://script.google.com/macros/s/AKfycby9rqKTrUDpa_FnbRkpJf2ZR45hx_tRtyZuS5-qNTKhfra0_CK0F6AdOh0vXQya-VTN/exec';

// "Suggest a correction" opens a prefilled public GitHub issue for now (Phase 4 replaces
// this with a simple form). Station id and name are prefilled so we know what it's about.
export function correctionUrl(id?: string, name?: string): string {
  const title = name ? `Correction: ${name}` : 'Correction';
  const body = [
    id ? `Station id: ${id}` : '',
    '',
    "What's wrong or missing? (A link to the station's own page helps.)",
    '',
  ].join('\n');
  return `${REPO}/issues/new?${new URLSearchParams({ title, body, labels: 'correction' })}`;
}
