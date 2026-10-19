// Results as you type, under every search box. Uses the same rules as the results page
// (src/lib/search-core.ts). Keyboard: ↑/↓ to move, Enter to open, Esc to close.
// Nothing typed leaves the browser except the one small ZIP file request.

import { search, loadIndex, metaLine, formatMiles, stationUrl, type Result } from '../lib/search-core';

const MAX = 6;

for (const form of document.querySelectorAll<HTMLFormElement>('[data-search-form]')) {
  const input = form.querySelector<HTMLInputElement>('input[name="q"]')!;
  const list = form.querySelector<HTMLUListElement>('.suggest')!;
  let active = -1;
  let seq = 0;
  let timer: number | undefined;

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

  const note = (text: string) => { const li = document.createElement('li'); li.className = 's-note'; li.textContent = text; return li; };
  const row = ({ entry, miles }: Result, i: number) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.id = `${list.id}-${i}`;
    const a = document.createElement('a');
    a.href = stationUrl(entry.id);
    a.tabIndex = -1;
    const mono = document.createElement('span');
    mono.className = 'monogram';
    mono.ariaHidden = 'true';
    mono.textContent = entry.mono;
    const text = document.createElement('span');
    text.className = 's-text';
    const name = document.createElement('span');
    name.className = 's-name';
    name.textContent = entry.name;
    const meta = document.createElement('span');
    meta.className = 's-meta';
    meta.textContent = metaLine(entry);
    text.append(name, meta);
    a.append(mono, text);
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
    if (q.length < 2) { close(); return; }
    if (/^\d{1,4}$/.test(q)) {
      list.replaceChildren(note('Keep typing your 5-digit ZIP code…'));
      open();
      return;
    }
    const r = await search(q);
    if (mine !== seq) return; // a newer keystroke already won
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
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(update, 120); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      location.href = options()[active].querySelector('a')!.href;
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150)); // let a click on a result land first
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus while clicking
}
