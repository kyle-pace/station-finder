// Finds where each station is based, for the map: one dot per station at its home city.
//
// Home city: the station's city (from the Wikipedia lists). Statewide networks have no
// city in the lists, so we read "Headquarters" (or "City") from the station's own
// Wikipedia article, which is already cached, or else use the city of its main
// transmitter. The city's coordinates come from that city's Wikipedia article (an
// ordinary /wiki/ page, e.g. /wiki/Seattle,_Washington).
//
// Reads public/data/organizations.json (run build-data first) and writes
// data/raw/wikipedia/places.json. Safe to re-run: every page is cached.
//
//   npm run fetch-wikipedia-places            (use cached pages where we have them)
//   npm run fetch-wikipedia-places -- --refresh

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { fetchCached } from './lib/fetch.ts';
import { WIKI, clean, titleFromUrl, parseGeo, fileFor, type Coords } from './lib/wikipedia.ts';
import { STATE_NAMES } from '../src/lib/states.ts';

interface Org { id: string; name: string; city: string | null; state: string; facilityIds: string[]; sources: Record<string, { source: string }> }
interface Fac { id: string; callSign: string; city: string | null; state: string }

const RAW = join(process.cwd(), 'data', 'raw', 'wikipedia');
const orgs = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'organizations.json'), 'utf8')) as Org[];
const facilityById = new Map((JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'facilities.json'), 'utf8')) as Fac[]).map((f) => [f.id, f]));

// "Montgomery(Selma)" → "Montgomery"; "Sneedville–Johnson City" → "Sneedville".
const firstCity = (s: string) => clean(s).split(/[(/–—;]|\band\b/)[0].replace(/,.*$/, '').trim();

// The station's own article (not the list it came from).
function articleFor(org: Org): string | undefined {
  const urls = Object.values(org.sources).map((s) => s.source).filter((u) => u.startsWith(WIKI) && !u.includes('/List_of_'));
  for (const u of urls) {
    const f = join(RAW, fileFor(titleFromUrl(u)));
    if (existsSync(f)) return f;
  }
  return undefined;
}

function headquarters(org: Org): string | undefined {
  const file = articleFor(org);
  if (!file) return undefined;
  const $ = cheerio.load(readFileSync(file, 'utf8'));
  let found: string | undefined;
  const stateNames = new Set(Object.values(STATE_NAMES));
  $('table.infobox').first().find('tr').each((_, tr) => {
    const label = clean($(tr).children('th').first().text()).toLowerCase();
    if (found || !(label === 'headquarters' || label === 'city' || label === 'studios')) return;
    const td = $(tr).children('td').first().clone();
    td.find('style, sup').remove();
    td.find('br').replaceWith('|');
    // "260 14th Street NW|Atlanta, Georgia" → "Atlanta": the first part without a
    // street number that isn't the state's name.
    const parts = clean(td.text()).split(/[|,(/–—;]/).map((x) => x.trim());
    const v = parts.find((x) => x && !/\d/.test(x) && !stateNames.has(x) && x !== 'U.S.' && x !== 'United States');
    if (v && v.length < 40) found = v;
  });
  return found;
}

// The station's flagship transmitter: the one named like its article, else its first.
function flagshipCity(org: Org): string | undefined {
  const tx = org.facilityIds.map((id) => facilityById.get(id)).filter((f): f is Fac => !!f && !!f.city);
  const article = articleFor(org);
  const title = article ? article.split('/').pop()!.replace(/\.html$/, '').replace(/_/g, ' ') : '';
  const main = tx.find((f) => title.startsWith(f.callSign.replace(/-.*$/, ''))) ?? tx[0];
  return main?.city ? firstCity(main.city) : undefined;
}

const homes: Record<string, { city: string; state: string; from: string }> = {};
for (const org of orgs) {
  if (org.city && !/statewide/i.test(org.city)) homes[org.id] = { city: firstCity(org.city), state: org.state, from: 'city of license' };
  else {
    const hq = headquarters(org);
    const flag = hq ? undefined : flagshipCity(org);
    if (hq) homes[org.id] = { city: hq, state: org.state, from: 'headquarters' };
    else if (flag) homes[org.id] = { city: flag, state: org.state, from: 'main transmitter city' };
  }
}

const places: Record<string, { title: string; url: string; coords: Coords; retrievedAt: string } | { error: string }> = {};
const keys = [...new Set(Object.values(homes).map((h) => `${h.city}|${h.state}`))].sort();
let done = 0;
for (const key of keys) {
  const [city, st] = key.split('|');
  const stateName = STATE_NAMES[st] ?? st;
  // Metro names like "Albany-Schenectady-Troy" have no article; try the first city then.
  const candidates = [...new Set([city, city.split('-')[0].trim()])];
  for (const name of candidates) {
    const title = `${name}, ${stateName}`;
    try {
      const page = await fetchCached('wikipedia', `places/${fileFor(title).replace('articles/', '')}`, `${WIKI}${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2C/g, ',')}`);
      const $ = cheerio.load(page.body);
      const canonical = $('link[rel="canonical"]').attr('href') ?? page.url;
      const coords = parseGeo($('#coordinates .geo').first().text()) ?? parseGeo($('table.infobox .geo').first().text());
      places[key] = coords ? { title: titleFromUrl(canonical), url: canonical, coords, retrievedAt: page.retrievedAt } : { error: 'no coordinates on page' };
    } catch (e) {
      places[key] = { error: (e as Error).message };
    }
    if ('coords' in places[key]) break;
  }
  if (++done % 50 === 0) console.log(`fetch-wikipedia-places: ${done}/${keys.length}`);
}

writeFileSync(join(RAW, 'places.json'), JSON.stringify({ homes, places }, null, 1) + '\n');
const missing = Object.entries(places).filter(([, p]) => 'error' in p);
console.log(`fetch-wikipedia-places: ${Object.keys(homes).length}/${orgs.length} stations have a home city; ${keys.length - missing.length}/${keys.length} cities placed.`);
for (const [k, p] of missing) console.log(`  not placed: ${k} (${(p as { error: string }).error})`);
for (const o of orgs.filter((o) => !homes[o.id])) console.log(`  no home city: ${o.id}`);
