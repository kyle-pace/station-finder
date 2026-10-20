// The broad platform only (iPhone/iPad, Android, or computer), from the user agent. Nothing
// is stored or sent. Shared by the station page buttons and the /go/ links.
export type Device = 'ios' | 'android' | 'desktop';

export function detectDevice(): Device {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}
