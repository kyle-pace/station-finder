// Device-aware calls to action, run in the browser. Detects only the broad platform
// (iPhone/iPad, Android, or computer) from the user agent; nothing is stored or sent.
//
// - Station pages: highlights the app link for this device ("For your iPhone") and
//   moves its group to the top. This marks the visitor's platform, never a station.
// - National apps block: swaps the button to the right store for phones.

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

function apply(): void {
  const device = detectDevice();

  // Station page app links.
  const match = document.querySelector<HTMLElement>(`.app-link[data-platform="${PLATFORM_FOR[device]}"]`);
  if (match) {
    match.classList.add('your-device');
    const tag = match.querySelector('[data-tag]');
    if (tag) tag.textContent = TAGS[device];
    const group = match.closest<HTMLElement>('[data-app-group]');
    const groups = group?.parentElement;
    if (group && groups && groups.firstElementChild !== group) groups.prepend(group);
  }

  // National apps buttons.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-national]')) {
    const store = device === 'ios' ? a.dataset.ios : device === 'android' ? a.dataset.android : '';
    if (store) a.href = store;
    else {
      const label = a.querySelector('span');
      if (label) label.textContent = `Visit ${new URL(a.href).host.replace(/^www\./, '')}`;
    }
  }
}

apply();
