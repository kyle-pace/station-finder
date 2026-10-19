// Results page: reads ?q= (or ?near=lat,lng from "Use my location") and renders station
// cards from the <template> in search.astro. Search rules live in src/lib/search-core.ts.

import { search, metaLine, formatMiles, stationUrl, type Result } from '../lib/search-core';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function renderCards(container: HTMLElement, results: Result[]): void {
  const tpl = $<HTMLTemplateElement>('#card-template');
  container.replaceChildren();
  results.forEach(({ entry, miles }, i) => {
    const card = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
    card.style.setProperty('--i', String(Math.min(i, 8)));
    card.querySelector<HTMLAnchorElement>('[data-link]')!.href = stationUrl(entry.id);
    card.querySelector('[data-name]')!.textContent = entry.name;
    card.querySelector('[data-meta]')!.textContent = metaLine(entry);
    const dist = card.querySelector<HTMLElement>('[data-dist]')!;
    if (miles !== undefined) dist.textContent = formatMiles(miles); else dist.remove();
    // Show only the device types the station's own apps cover; otherwise point to the
    // network's app (we never say what a station lacks).
    let anyOwn = false;
    for (const kind of ['mobile', 'tv', 'web'] as const) {
      const el = card.querySelector<HTMLElement>(`[data-device="${kind}"]`)!;
      el.classList.add('on');
      if (entry.devices[kind]) anyOwn = true; else el.remove();
    }
    const fb = card.querySelector<HTMLElement>('[data-device="fallback"]')!;
    if (anyOwn) fb.remove();
    else fb.textContent = [
      entry.network.includes('PBS') && 'Watch with the PBS app',
      entry.network.includes('NPR') && 'Listen with the NPR app',
    ].filter(Boolean).join(' · ');
    const live = card.querySelector<HTMLAnchorElement>('[data-live]')!;
    if (entry.live) { live.href = entry.live; live.querySelector('span')!.textContent = entry.media.includes('tv') ? 'Watch live' : 'Listen live'; } else live.remove();
    card.querySelector<HTMLAnchorElement>('[data-app]')!.href = `${stationUrl(entry.id)}#apps`;
    container.append(card);
  });
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') ?? '').trim();
  const nearParam = params.get('near')?.split(',').map(Number);
  const near = nearParam?.length === 2 && nearParam.every(Number.isFinite) ? (nearParam as [number, number]) : undefined;
  const input = document.querySelector<HTMLInputElement>('#q');
  if (input && q) input.value = q;

  const heading = $('#results-heading');
  const sub = $('#results-sub');
  const list = $('#results');
  const empty = $('#empty');
  const status = $('#search-status');

  if (!q && !near) {
    list.replaceChildren();
    heading.textContent = 'Search for your station';
    sub.textContent = 'Enter a ZIP code, city, station name, or call letters.';
    return;
  }

  const r = await search(q, near);
  if (r.kind === 'zip-unknown') {
    list.replaceChildren();
    heading.textContent = `We couldn't find ZIP code ${r.zip}`;
    sub.textContent = 'Check the number, or try a city or station name.';
    empty.hidden = false;
  } else if (r.results.length) {
    const n = r.results.length;
    const where = r.kind === 'zip' ? `near ${r.zip}` : r.kind === 'near' ? 'near you' : `for “${r.q}”`;
    heading.textContent = `${n} station${n === 1 ? '' : 's'} ${where}`;
    sub.textContent = r.kind === 'text' ? 'Every station is listed the same way.' : 'Nearest first. Every station is listed the same way.';
    renderCards(list, r.results);
  } else if (r.kind !== 'text' && r.nearest.length) {
    heading.textContent = r.kind === 'zip' ? `No stations close to ${r.zip}` : 'No stations close to you';
    sub.textContent = 'These are the nearest stations we know of.';
    renderCards(list, r.nearest);
  } else {
    list.replaceChildren();
    heading.textContent = `No stations found for “${q}”`;
    sub.textContent = 'Try a 5-digit ZIP code, a city and state (like “Spokane, WA”), or call letters (like “KVIE”).';
    empty.hidden = false;
  }
  status.textContent = heading.textContent;
}

run().catch(() => {
  $('#results').replaceChildren();
  $('#results-heading').textContent = 'Search is unavailable right now';
  $('#results-sub').textContent = 'Please try again, or browse stations by state.';
  $('#empty').hidden = false;
});
