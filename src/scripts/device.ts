// Device-aware calls to action, run in the browser. Detects only the broad platform
// (iPhone/iPad, Android, or computer) from the user agent; nothing is stored or sent.
//
// - Station pages: highlights the app link for this device ("For your iPhone") and
//   moves its group to the top. This marks the visitor's platform, never a station.

export type Device = 'ios' | 'android' | 'desktop';

export function detectDevice(): Device {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

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
  if (device === 'desktop') label.textContent = isFallback ? `Watch with the ${cta.dataset.fallback} app` : `Watch ${name} in your browser`;
  else label.textContent = isFallback ? `Get the ${cta.dataset.fallback} app` : `Get ${name} on ${DEVICE_WORDS[device]}`;
  cta.href = link.href;
  if (link.rel) cta.rel = link.rel;
  cta.hidden = false;
}

function apply(): void {
  const device = detectDevice();

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
