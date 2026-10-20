// Device-aware calls to action, run in the browser. Detects only the broad platform
// (iPhone/iPad, Android, or computer) from the user agent; nothing is stored or sent.
//
// - Station pages: highlights the app link for this device ("For your iPhone") and
//   moves its group to the top. This marks the visitor's platform, never a station.

import { detectDevice, type Device } from './device-detect';

const TAGS: Record<Device, string> = { ios: 'For your iPhone or iPad', android: 'For your Android device', desktop: 'For your computer' };
const PLATFORM_FOR: Record<Device, string> = { ios: 'ios', android: 'android', desktop: 'web' };

const DEVICE_WORDS: Record<Device, string> = { ios: 'iPhone & iPad', android: 'Android', desktop: 'your computer' };

// The big button at the top of a station page: the one link most visitors need.
function smartCta(link: HTMLAnchorElement, device: Device): void {
  const cta = document.querySelector<HTMLAnchorElement>('[data-smart-cta]');
  if (!cta) return;
  const name = cta.dataset.name ?? '';
  const isFallback = link.hasAttribute('data-fallback');
  // Station first: only lead with the network's app when the station has no apps or
  // livestream of its own to offer.
  if (isFallback && cta.dataset.hasOwn === 'true') return;
  const label = cta.querySelector('[data-cta-label]')!;
  cta.querySelector<HTMLElement>('[data-cta-icon="mobile"]')!.hidden = device === 'desktop';
  cta.querySelector<HTMLElement>('[data-cta-icon="desktop"]')!.hidden = device !== 'desktop';
  if (device === 'desktop') label.textContent = isFallback ? `${cta.dataset.fallbackVerb} with the ${cta.dataset.fallback} app` : `${cta.dataset.verb} ${name} in your browser`;
  else label.textContent = isFallback ? `Get the ${cta.dataset.fallback} app` : `Get ${name} on ${DEVICE_WORDS[device]}`;
  cta.href = link.href;
  cta.dataset.platform = link.dataset.platform; // for anonymous click counting
  if (link.rel) cta.rel = link.rel;
  cta.hidden = false;
}

function apply(): void {
  const device = detectDevice();

  // On a computer, show the "scan to get the app" QR code (it's for moving to a phone).
  if (device === 'desktop') document.querySelectorAll<HTMLElement>('[data-qr]').forEach((q) => { q.hidden = false; });

  // On a computer with no web app to offer, the station's website is the main action:
  // make the hero's Website button the primary one (no duplicate button or card).
  const site = document.querySelector<HTMLAnchorElement>('[data-website-btn]');
  if (device === 'desktop' && site && !document.querySelector('.app-link[data-platform="web"]')) {
    site.classList.replace('btn-secondary', 'btn-primary');
    site.querySelector('span')!.textContent = `Visit ${site.dataset.name}'s website`;
  }

  // Station page app links.
  const match = document.querySelector<HTMLElement>(`.app-link[data-platform="${PLATFORM_FOR[device]}"]`);
  if (match) {
    smartCta(match as HTMLAnchorElement, device);
    match.classList.add('your-device');
    const tag = match.querySelector('[data-tag]');
    if (tag) tag.textContent = TAGS[device];
    // Station first: never move the network's fallback app above the station's own apps.
    const stationHasApps = !!document.querySelector('.app-link:not([data-fallback])');
    if (match.hasAttribute('data-fallback') && stationHasApps) return;
    const group = match.closest<HTMLElement>('[data-app-group]');
    const groups = group?.parentElement;
    if (group && groups && groups.firstElementChild !== group) groups.prepend(group);
  }
}

apply();
