// Anonymous event counting (SPEC.md section 8): count events, never people.
//
// Sends a tiny note per event to the counter (counter/google-apps-script.gs), which only
// adds 1 to that day's row. Only these events and fields, nothing else:
//   pageview        page type, device class
//   search          input type, result bucket, ZIP 3-digit prefix or state, device class
//   no_results      input type, ZIP 3-digit prefix or state, device class
//   outbound_click  station id, link type, platform, device class
// Never search text, full ZIPs, location, IDs, cookies, or anything tying two events to
// one person. Nothing is sent when the counter is off (no URL) or the visitor has Do Not
// Track or Global Privacy Control on.
import { COUNTER_URL } from '../lib/site';

type DeviceClass = 'phone' | 'tablet' | 'desktop' | 'other';

function deviceClass(): DeviceClass {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Mobile/.test(ua)) return 'phone';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'other';
}

const optedOut = () =>
  navigator.doNotTrack === '1' ||
  (window as unknown as { doNotTrack?: string }).doNotTrack === '1' ||
  (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

export function count(event: 'pageview' | 'search' | 'no_results' | 'outbound_click', fields: Record<string, string>): void {
  if (!COUNTER_URL || optedOut()) return;
  const body = JSON.stringify({ event, ...fields, device: deviceClass() });
  try {
    navigator.sendBeacon(COUNTER_URL, new Blob([body], { type: 'text/plain' }));
  } catch {
    // Counting must never get in anyone's way.
  }
}

// --- Page views: only the page types SPEC section 8 lists -----------------------------
const path = location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ''), '');
const page = path === '/' || path === '' ? 'home'
  : path.startsWith('/search') ? 'search'
  : path.startsWith('/station/') ? 'station'
  : path.startsWith('/state/') ? 'state'
  : path.startsWith('/about') ? 'about'
  : null;
if (page) count('pageview', { page });

// --- Clicks out to a station's app or site -----------------------------------------------
// Marked links carry data-platform (and data-link-type when it isn't an app store link);
// the station comes from the page's data-station.
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[data-platform]');
  const station = document.querySelector<HTMLElement>('[data-station]')?.dataset.station;
  if (!a || !station) return;
  const platform = a.dataset.platform!;
  const linkType = a.dataset.linkType ?? (platform === 'web' ? 'web' : 'app');
  count('outbound_click', { station, link_type: linkType, platform });
}, { capture: true });
