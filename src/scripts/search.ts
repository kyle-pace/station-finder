// Search, run entirely in the browser over static files. Nothing typed is sent anywhere
// except the request for one small ZIP file (public/data/zip/<first 3 digits>.json).
//
// 1. 5 digits → ZIP: look up its center point, list stations with a transmitter within
//    RADIUS_MI, nearest first.
// 2. ?near=lat,lng ("Use my location") → same, from the device's location.
// 3. Call letters (KVIE, WETA-TV) → that station.
// 4. Anything else → match words against station name, city, state, and call letters.
//
// Order is distance or match quality only. Every station is shown the same way.

import { STATE_NAMES } from '../lib/states';

interface Entry {
  id: string;
  name: string;
  city: string | null;
  state: string;
  calls: string[];
  tx: [number, number][];
  network: string;
  media: ('tv' | 'radio')[];
  hasApps: boolean;
  live: string | null;
  donate: string | null;
}
interface Result { entry: Entry; miles?: number }

const RADIUS_MI = 75;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function milesBetween([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearby(index: Entry[], point: [number, number]): { inRange: Result[]; nearest: Result[] } {
  const all = index
    .filter((e) => e.tx.length)
    .map((entry) => ({ entry, miles: Math.min(...entry.tx.map((t) => milesBetween(point, t))) }))
    .sort((a, b) => a.miles - b.miles);
  return { inRange: all.filter((r) => r.miles <= RADIUS_MI), nearest: all.slice(0, 3) };
}

const baseCall = (c: string) => c.toUpperCase().replace(/-(TV|DT|CD|LD|FM)$/, '');

function byCallSign(index: Entry[], q: string): Result[] {
  const want = baseCall(q.replace(/\s+/g, ''));
  return index.filter((e) => e.calls.some((c) => baseCall(c) === want)).map((entry) => ({ entry }));
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Every query word must match the start of a word in the station's name, city, state
// (code or full name), or call letters. Name matches rank above city/state matches.
function byText(index: Entry[], q: string): Result[] {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of index) {
    const fields = {
      name: norm(entry.name).split(' '),
      place: [...norm(entry.city ?? '').split(' '), entry.state.toLowerCase(), ...norm(STATE_NAMES[entry.state] ?? '').split(' ')],
      calls: entry.calls.map((c) => norm(c).replace(/ /g, '')),
    };
    let score = 0;
    let all = true;
    for (const w of words) {
      const hit = (list: string[]) => list.some((x) => x === w || (w.length >= 2 && x.startsWith(w)));
      if (hit(fields.name)) score += 3;
      else if (hit(fields.calls)) score += 3;
      else if (hit(fields.place)) score += 1;
      else { all = false; break; }
    }
    if (all) scored.push({ entry, score: score + (norm(entry.name) === norm(q) ? 10 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).map(({ entry }) => ({ entry }));
}

function metaLine(e: Entry): string {
  const media = e.media.map((m) => (m === 'tv' ? 'TV' : 'Radio')).join(' & ');
  return [e.network, media, e.city ? `${e.city}, ${e.state}` : `Statewide, ${e.state}`].join(' · ');
}

const formatMiles = (m: number) => (m < 1 ? 'under 1 mi' : `${Math.round(m)} mi`);

function renderCards(container: HTMLElement, results: Result[]): void {
  const tpl = $<HTMLTemplateElement>('#card-template');
  container.replaceChildren();
  for (const { entry, miles } of results) {
    const card = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const link = card.querySelector<HTMLAnchorElement>('[data-link]')!;
    link.href = `${BASE}/station/${entry.id}/`;
    card.querySelector('[data-name]')!.textContent = entry.name;
    card.querySelector('[data-meta]')!.textContent = metaLine(entry);
    const dist = card.querySelector<HTMLElement>('[data-dist]')!;
    if (miles !== undefined) dist.textContent = formatMiles(miles);
    else dist.remove();
    const live = card.querySelector<HTMLAnchorElement>('[data-live]')!;
    if (entry.live) live.href = entry.live; else live.remove();
    const app = card.querySelector<HTMLAnchorElement>('[data-app]')!;
    if (entry.hasApps) app.href = `${BASE}/station/${entry.id}/#apps`; else app.remove();
    const donate = card.querySelector<HTMLAnchorElement>('[data-donate]')!;
    if (entry.donate) donate.href = entry.donate; else donate.remove();
    const site = card.querySelector<HTMLAnchorElement>('[data-site]')!;
    site.href = `${BASE}/station/${entry.id}/`;
    if (entry.live || entry.hasApps || entry.donate) site.remove();
    container.append(card);
  }
}

function show(id: string, on: boolean) { $(id).hidden = !on; }

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') ?? '').trim();
  const near = params.get('near');
  const input = document.querySelector<HTMLInputElement>('#q');
  if (input && q) input.value = q;

  const heading = $('#results-heading');
  const sub = $('#results-sub');
  const list = $('#results');
  const status = $('#search-status');

  if (!q && !near) { heading.textContent = 'Search for your station'; sub.textContent = 'Enter a ZIP code, city, station name, or call letters.'; return; }

  const index = (await (await fetch(`${BASE}/data/search.json`)).json()) as Entry[];
  let results: Result[] = [];
  let label = '';
  let fallback: Result[] = [];

  const zip = q.match(/^(\d{5})(-\d{4})?$/)?.[1];
  const point = near?.split(',').map(Number);
  if (point && point.length === 2 && point.every(Number.isFinite)) {
    const r = nearby(index, [point[0], point[1]]);
    results = r.inRange; fallback = r.nearest; label = 'near you';
  } else if (zip) {
    const shard = await fetch(`${BASE}/data/zip/${zip.slice(0, 3)}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const center = (shard as Record<string, [number, number]>)[zip];
    if (!center) {
      heading.textContent = `We couldn't find ZIP code ${zip}`;
      sub.textContent = 'Check the number, or try a city or station name.';
      show('#empty', true);
      return;
    }
    const r = nearby(index, center);
    results = r.inRange; fallback = r.nearest; label = `near ${zip}`;
  } else {
    results = /^[KW][A-Z]{2,3}(-?(TV|DT|FM|CD|LD))?$/i.test(q) ? byCallSign(index, q) : [];
    if (!results.length) results = byText(index, q);
    label = `for "${q}"`;
  }

  if (results.length) {
    const n = results.length;
    heading.textContent = `${n} station${n === 1 ? '' : 's'} ${label}`;
    sub.textContent = label.startsWith('near') ? 'Nearest first. Every station is listed the same way.' : 'Every station is listed the same way.';
    renderCards(list, results);
  } else if (fallback.length) {
    heading.textContent = `No stations within ${RADIUS_MI} miles ${label === 'near you' ? 'of you' : `of ${zip}`}`;
    sub.textContent = 'These are the closest stations we know of.';
    renderCards(list, fallback);
  } else {
    heading.textContent = `No stations found ${label}`;
    sub.textContent = 'Try a 5-digit ZIP code, a city and state (like "Spokane, WA"), or call letters (like "KVIE").';
    show('#empty', true);
  }
  status.textContent = heading.textContent;
}

run().catch(() => {
  $('#results-heading').textContent = 'Search is unavailable right now';
  $('#results-sub').textContent = 'Please try again, or browse stations by state.';
  show('#empty', true);
});
