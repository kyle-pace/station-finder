// Search rules shared by the results page and the as-you-type dropdown. Runs in the
// browser over static files; nothing typed is sent anywhere except the request for one
// small ZIP file (public/data/zip/<first 3 digits>.json).
//
// Order is distance or match quality only. Every station is treated the same way.

import { STATE_NAMES } from './states';

export interface Entry {
  id: string;
  name: string;
  city: string | null;
  state: string;
  calls: string[];
  tx: [number, number, number][]; // lat, lng, search radius in miles (TV 75, radio 50)
  network: string;
  media: ('tv' | 'radio')[];
  devices: { mobile: boolean; tv: boolean; web: boolean };
  hasApps: boolean;
  live: string | null;
}
export interface Result { entry: Entry; miles?: number }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
declare const __DATA_VERSION__: string;
const V = `?v=${__DATA_VERSION__}`;
export const stationUrl = (id: string) => `${BASE}/station/${id}/`;

let indexPromise: Promise<Entry[]> | null = null;
export function loadIndex(): Promise<Entry[]> {
  indexPromise ??= fetch(`${BASE}/data/search.json${V}`)
    .then((r) => r.json() as Promise<Entry[]>)
    // Tolerate entries from an older data format rather than failing the whole search.
    .then((list) => list.map((e) => ({
      ...e,
      devices: e.devices ?? { mobile: false, tv: false, web: false },
      tx: (e.tx ?? []).map((t) => [t[0], t[1], t[2] ?? 75] as [number, number, number]),
    })));
  return indexPromise;
}

const zipCache = new Map<string, Promise<Record<string, [number, number]>>>();
export async function zipCenter(zip: string): Promise<[number, number] | undefined> {
  const prefix = zip.slice(0, 3);
  if (!zipCache.has(prefix)) {
    zipCache.set(prefix, fetch(`${BASE}/data/zip/${prefix}.json${V}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return (await zipCache.get(prefix)!)[zip];
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Stations with a transmitter within that transmitter's radius, nearest first; plus the
// three nearest overall, for when nothing is in range.
export function nearby(index: Entry[], [lat, lng]: [number, number]): { inRange: Result[]; nearest: Result[] } {
  const scored = index
    .filter((e) => e.tx.length)
    .map((entry) => {
      let miles = Infinity;
      let inRange = false;
      for (const [tlat, tlng, radius] of entry.tx) {
        const m = milesBetween(lat, lng, tlat, tlng);
        miles = Math.min(miles, m);
        if (m <= radius) inRange = true;
      }
      return { entry, miles, inRange };
    })
    .sort((a, b) => a.miles - b.miles);
  return {
    inRange: scored.filter((r) => r.inRange).map(({ entry, miles }) => ({ entry, miles })),
    nearest: scored.slice(0, 3).map(({ entry, miles }) => ({ entry, miles })),
  };
}

const baseCall = (c: string) => c.toUpperCase().replace(/\s+/g, '').replace(/-(TV|DT|CD|LD|FM|AM)$/, '');
export const looksLikeCallSign = (q: string) => /^[KW][A-Z]{2,3}(-?(TV|DT|FM|AM|CD|LD))?$/i.test(q.trim());

export function byCallSign(index: Entry[], q: string): Result[] {
  const want = baseCall(q);
  return index.filter((e) => e.calls.some((c) => baseCall(c) === want)).map((entry) => ({ entry }));
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Every query word must match the start of a word in the station's name, city, state
// (code or full name), or call letters. Name matches rank above city/state matches.
export function byText(index: Entry[], q: string): Result[] {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of index) {
    const name = norm(entry.name).split(' ');
    const place = [...norm(entry.city ?? '').split(' '), entry.state.toLowerCase(), ...norm(STATE_NAMES[entry.state] ?? '').split(' ')];
    const calls = entry.calls.map((c) => norm(c).replace(/ /g, ''));
    let score = 0;
    let all = true;
    for (const w of words) {
      const hit = (list: string[]) => list.some((x) => x === w || (w.length >= 2 && x.startsWith(w)));
      if (hit(name) || hit(calls)) score += 3;
      else if (hit(place)) score += 1;
      else { all = false; break; }
    }
    if (all) scored.push({ entry, score: score + (norm(entry.name) === norm(q) ? 10 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).map(({ entry }) => ({ entry }));
}

// One entry point for both the dropdown and the results page.
export type Search =
  | { kind: 'zip'; zip: string; results: Result[]; nearest: Result[] }
  | { kind: 'zip-unknown'; zip: string }
  | { kind: 'near'; results: Result[]; nearest: Result[] }
  | { kind: 'text'; q: string; results: Result[] };

export async function search(q: string, near?: [number, number]): Promise<Search> {
  const index = await loadIndex();
  if (near) {
    const r = nearby(index, near);
    return { kind: 'near', results: r.inRange, nearest: r.nearest };
  }
  const zip = q.trim().match(/^(\d{5})(-\d{4})?$/)?.[1];
  if (zip) {
    const center = await zipCenter(zip);
    if (!center) return { kind: 'zip-unknown', zip };
    const r = nearby(index, center);
    return { kind: 'zip', zip, results: r.inRange, nearest: r.nearest };
  }
  let results = looksLikeCallSign(q) ? byCallSign(index, q) : [];
  if (!results.length) results = byText(index, q);
  return { kind: 'text', q, results };
}

export function metaLine(e: Entry): string {
  const media = e.media.map((m) => (m === 'tv' ? 'TV' : 'Radio')).join(' & ');
  return [e.network, media, e.city ? `${e.city}, ${e.state}` : `Statewide, ${e.state}`].join(' · ');
}

export const formatMiles = (m: number) => (m < 1 ? '< 1 mi' : `${Math.round(m)} mi`);
