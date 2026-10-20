// Results as you type, under every search box. Uses the same rules as the results page
// (src/lib/search-core.ts). Keyboard: ↑/↓ to move, Enter to open, Esc to close.
// Nothing typed leaves the browser except the one small ZIP file request.
//
// "Use my location": the pin button in the box, and the first option when the box is
// empty. Only offered when the browser supports it. The coordinates are rounded (~1 km)
// and only go into this site's own search URL; they're never sent anywhere else.
//
// Picking a station here counts as one search, the same anonymous count the results page
// makes (src/scripts/count-search.ts). "See all results" leaves the count to that page.

import { search, loadIndex, metaLine, formatMiles, stationUrl, type Result, type Search } from '../lib/search-core';
import { countSearch } from './count-search';

const MAX = 6;
const canLocate = 'geolocation' in navigator;
const searchUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/search/`;

for (const form of document.querySelectorAll<HTMLFormElement>('[data-search-form]')) {
  const input = form.querySelector<HTMLInputElement>('input[name="q"]')!;
  const list = form.querySelector<HTMLUListElement>('.suggest')!;
  let active = -1;
  let seq = 0;
  let timer: number | undefined;
  let last: { q: string; r: Search } | undefined; // what the dropdown is showing

  const options = () => [...list.querySelectorAll<HTMLLIElement>('li[role="option"]')];
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const select = (i: number) => {
    const opts = options();
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    input.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  };

  const locateBtn = form.querySelector<HTMLButtonElement>('[data-locate]');
  const placeholder = input.placeholder;
  const locate = () => {
    close();
    input.value = '';
    input.placeholder = 'Finding stations near you…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { location.href = `${searchUrl}?near=${pos.coords.latitude.toFixed(2)},${pos.coords.longitude.toFixed(2)}`; },
      () => { input.placeholder = "Couldn't get your location. Try a ZIP code"; setTimeout(() => { input.placeholder = placeholder; }, 5000); },
      { maximumAge: 600000, timeout: 10000 },
    );
  };
  if (locateBtn && canLocate) {
    locateBtn.hidden = false;
    locateBtn.addEventListener('click', locate);
  }
  const locateOption = () => {
    const li = document.createElement('li');
    li.role = 'option';
    li.id = `${list.id}-locate`;
    const a = document.createElement('a');
    a.href = '#';
    a.tabIndex = -1;
    a.dataset.locate = '';
    a.className = 's-locate';
    a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    const text = document.createElement('span');
    text.className = 's-text';
    const name = document.createElement('span');
    name.className = 's-name';
    name.textContent = 'Use my current location';
    const meta = document.createElement('span');
    meta.className = 's-meta';
    meta.textContent = 'Stays on this device. Never sent to us.';
    text.append(name, meta);
    a.append(text);
    li.append(a);
    return li;
  };
  const note = (text: string) => { const li = document.createElement('li'); li.className = 's-note'; li.textContent = text; return li; };
  const row = ({ entry, miles }: Result, i: number) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.id = `${list.id}-${i}`;
    const a = document.createElement('a');
    a.href = stationUrl(entry.id);
    a.tabIndex = -1;
    const text = document.createElement('span');
    text.className = 's-text';
    const name = document.createElement('span');
    name.className = 's-name';
    name.textContent = entry.name;
    const meta = document.createElement('span');
    meta.className = 's-meta';
    meta.textContent = metaLine(entry);
    text.append(name, meta);
    a.append(text);
    if (miles !== undefined) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = formatMiles(miles);
      a.append(pill);
    }
    li.append(a);
    return li;
  };

  async function update() {
    const q = input.value.trim();
    const mine = ++seq;
    last = undefined;
    if (q.length < 2) {
      if (canLocate && document.activeElement === input) { list.replaceChildren(locateOption()); active = -1; open(); }
      else close();
      return;
    }
    if (/^\d{1,4}$/.test(q)) {
      list.replaceChildren(note('Keep typing your 5-digit ZIP code…'));
      open();
      return;
    }
    const r = await search(q);
    if (mine !== seq) return; // a newer keystroke already won
    last = { q, r };
    const items: HTMLLIElement[] = [];
    if (r.kind === 'zip-unknown') items.push(note(`We couldn't find ZIP code ${r.zip}`));
    else {
      const results = r.results.length ? r.results : r.kind === 'zip' ? r.nearest : [];
      if (r.kind === 'zip' && !r.results.length && results.length) items.push(note(`Nearest stations to ${r.zip}`));
      results.slice(0, MAX).forEach((res, i) => items.push(row(res, i)));
      if (!results.length) items.push(note('No matching stations. Try a ZIP code or call letters.'));
      if (results.length > MAX) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 's-all';
        a.href = `${form.action}?${new URLSearchParams({ q })}`;
        a.textContent = `See all ${results.length} results →`;
        li.append(a);
        items.push(li);
      }
    }
    list.replaceChildren(...items);
    active = -1;
    open();
  }

  input.addEventListener('focus', () => { loadIndex(); }, { once: true }); // warm the index
  input.addEventListener('focus', () => { if (input.value.trim().length < 2) update(); });
  const picked = (a: Element) => { if (last && !a.classList.contains('s-all')) countSearch(last.q, last.r); };
  list.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-locate]')) { e.preventDefault(); locate(); return; }
    const a = (e.target as Element).closest('a');
    if (a) picked(a);
  });
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(update, 120); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const a = options()[active].querySelector('a')!;
      if (a.dataset.locate !== undefined) locate(); else { picked(a); location.href = a.href; }
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150)); // let a click on a result land first
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus while clicking
}
