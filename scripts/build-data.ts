// build-data: merges source data and manual files into the JSON the site reads.
//
// Inputs (all in data/):
//   raw/wikipedia/pbs-extracted.json   ← npm run fetch-wikipedia
//   raw/station-sites/app-links.json   ← npm run fetch-station-app-pages (optional; needs a prior build)
//   manual/national.yaml               national PBS/NPR fallback apps
//   manual/station-app-pages.yaml      each station's own "get our app" page
//   manual/station-apps.yaml           hand-checked app links (win over scraped ones)
//   manual/merges.yaml                 stations to fold into another (relays, satellites)
//   manual/overrides.yaml              corrections to any station field (always win)
//
// Outputs (public/data/): organizations.json, facilities.json, national.json, search.json,
//   zip/<3-digit prefix>.json
//
// Manual files are applied last, so a re-run never undoes a manual fix. Safe to re-run:
// it only reads data/ and overwrites its own output files.
// Run with: npm run build-data

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ExtractedRow, InfoboxFields } from './fetch-wikipedia.ts';
import type { StationAppLinks } from './fetch-station-app-pages.ts';
import { monogram } from '../src/lib/monogram.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MANUAL = join(ROOT, 'data', 'manual');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'public', 'data');

const PLATFORMS = ['ios', 'android', 'appletv', 'firetv', 'androidtv', 'roku', 'samsung', 'lg', 'web'] as const;
type Platform = (typeof PLATFORMS)[number];

const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', 'American Samoa': 'AS', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL',
  Georgia: 'GA', Guam: 'GU', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA',
  Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Northern Mariana Islands': 'MP', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', 'U.S. Virgin Islands': 'VI', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY',
};

// --- Output shapes (see SPEC §3) -------------------------------------------------

interface Provenance { source: string; retrievedAt: string }

interface App {
  platform: Platform;
  url: string;
  source: string;
  retrievedAt: string;
  verified: boolean;
  // A station can have more than one app per platform (e.g. KET's main app plus KET
  // Legislative Coverage). The first one is its main app; the rest are extra apps,
  // shown under "More apps from …" with a name.
  extra?: boolean;
  name?: string;
  // "instructions": the station's own page says its app is on this platform but has no
  // store link; url is that page ("how to get it").
  kind?: 'instructions';
}

// A readable app name from a store link: Apple's URL slug ("ket-legislative-coverage"
// → "KET Legislative Coverage"). Words that appear in capitals in the station's name or
// call letters stay in capitals.
function appNameFromUrl(url: string, org: { name: string }): string | undefined {
  const slug = url.match(/apple\.com\/[a-z]{2}\/app\/([^/]+)\/id\d+/)?.[1];
  if (!slug) return undefined;
  const words = org.name.split(/\W+/).filter(Boolean);
  const initials = words.filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join(''); // Kentucky Educational Television → KET
  const caps = new Set(words.filter((w) => w.length > 1 && w === w.toUpperCase()).concat([initials, 'PBS', 'NPR', 'TV', 'FM']));
  return decodeURIComponent(slug).split('-').filter(Boolean)
    .map((w) => (caps.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

interface Organization {
  id: string;
  name: string;
  networks: string[];
  mediaTypes: ('tv' | 'radio')[];
  city: string | null; // null for statewide/regional networks
  state: string;
  owner?: string;
  website?: string;
  livestreamUrl?: string;
  apps: App[];
  facilityIds: string[];
  sources: Record<string, Provenance>;
}

interface Facility {
  id: string;
  callSign: string;
  service: 'tv' | 'fm' | 'am';
  city: string | null;
  state: string;
  lat: number;
  lng: number;
  organizationId: string;
  source: string;
  retrievedAt: string;
}

// --- Helpers -----------------------------------------------------------------------

const errors: string[] = [];
const report: { title: string; lines: string[] }[] = [];
const section = (title: string) => { const s = { title, lines: [] as string[] }; report.push(s); return s.lines; };

function readYaml(dir: string, file: string): unknown {
  try {
    return parse(readFileSync(join(dir, file), 'utf8')) ?? [];
  } catch (err) {
    errors.push(`${file}: could not read or parse (${(err as Error).message})`);
    return [];
  }
}

function checkList(file: string, value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    errors.push(`${file}: expected a list of entries`);
    return [];
  }
  return value as Record<string, unknown>[];
}

function isUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

// Project rule: never link to PBS KIDS apps or content (see CLAUDE.md).
// Matches pbskids.org, the org.pbskids.* Android apps, and "pbs-kids" store slugs.
function isPbsKids(value: unknown): boolean {
  return typeof value === 'string' && /pbs[-_.]?kids/i.test(value);
}

function isDate(value: unknown): boolean {
  // YAML may parse 2026-10-18 as a Date, or leave it as a string.
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const toDateString = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));
const today = () => new Date().toISOString().slice(0, 10);

function checkApp(where: string, app: Record<string, unknown>, needsKind: boolean): void {
  if (!PLATFORMS.includes(app.platform as Platform)) {
    errors.push(`${where}: unknown platform "${app.platform}" (use one of: ${PLATFORMS.join(', ')})`);
  }
  if (needsKind && app.kind !== 'store' && app.kind !== 'help') errors.push(`${where}: kind must be "store" or "help"`);
  if (!isUrl(app.url)) errors.push(`${where}: url must be a full https:// link`);
  if (isPbsKids(app.url)) errors.push(`${where}: PBS KIDS links are not allowed (${app.url})`);
  if (typeof app.source !== 'string' || !app.source) errors.push(`${where}: missing source`);
  if (!isDate(app.retrievedAt)) errors.push(`${where}: retrievedAt must be a date like 2026-10-18`);
}

function checkFields(where: string, entry: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(entry)) {
    if (!allowed.includes(key)) errors.push(`${where}: unexpected field "${key}" (allowed: ${allowed.join(', ')})`);
  }
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CALLSIGN = /^([KW][A-Z]{2,3}(?:-(?:TV|DT|CD|LD))?)/;
const callSignOf = (title: string) => title.replace(/ \((TV|TV station)\)$/, '').match(CALLSIGN)?.[1];

// "Alaska Public Media (KAKM)" → "Alaska Public Media"; "WETA-TV" → "WETA"
function displayName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\b([KW][A-Z]{2,3})-TV\b/g, '$1').trim();
}

// ==================================================================================
// 1. Validate manual files
// ==================================================================================

const national = checkList('national.yaml', readYaml(MANUAL, 'national.yaml'));
for (const brand of national) {
  const where = `national.yaml [${brand.id ?? '?'}]`;
  if (typeof brand.id !== 'string' || typeof brand.name !== 'string') errors.push(`${where}: needs an id and a name`);
  const apps = Array.isArray(brand.apps) ? brand.apps : [];
  if (apps.length === 0) errors.push(`${where}: has no apps`);
  apps.forEach((app, i) => checkApp(`${where} app ${i + 1}`, app, true));
}

const stationApps = checkList('station-apps.yaml', readYaml(MANUAL, 'station-apps.yaml'));
for (const entry of stationApps) {
  const where = `station-apps.yaml [${entry.id ?? '?'}]`;
  if (typeof entry.id !== 'string') errors.push(`${where}: needs an id`);
  // Neutrality: this file is public and must not record partner status.
  checkFields(where, entry, ['id', 'name', 'apps', 'exclude']);
  for (const [i, app] of (Array.isArray(entry.apps) ? entry.apps : []).entries()) {
    checkFields(`${where} app ${i + 1}`, app as Record<string, unknown>, ['platform', 'url', 'source', 'retrievedAt', 'extra', 'name']);
  }
  if (entry.exclude !== undefined && (!Array.isArray(entry.exclude) || !entry.exclude.every(isUrl))) {
    errors.push(`${where}: exclude must be a list of full https:// links`);
  }
  const apps = Array.isArray(entry.apps) ? entry.apps : [];
  apps.forEach((app, i) => checkApp(`${where} app ${i + 1}`, app, false));
}

const appPages = checkList('station-app-pages.yaml', readYaml(MANUAL, 'station-app-pages.yaml'));
for (const entry of appPages) {
  const where = `station-app-pages.yaml [${entry.id ?? '?'}]`;
  if (typeof entry.id !== 'string') errors.push(`${where}: needs an id`);
  checkFields(where, entry, ['id', 'appsPage', 'webApp', 'note']);
  for (const k of ['appsPage', 'webApp']) {
    if (entry[k] !== undefined && !isUrl(entry[k])) errors.push(`${where}: ${k} must be a full https:// link`);
    if (isPbsKids(entry[k])) errors.push(`${where}: PBS KIDS links are not allowed (${entry[k]})`);
  }
}

const mergesFile = checkList('merges.yaml', readYaml(MANUAL, 'merges.yaml'));
for (const entry of mergesFile) {
  const where = `merges.yaml [${entry.id ?? '?'}]`;
  checkFields(where, entry, ['id', 'into', 'note']);
  if (typeof entry.id !== 'string' || typeof entry.into !== 'string') errors.push(`${where}: needs an id and an into`);
  if (entry.id === entry.into) errors.push(`${where}: can't merge a station into itself`);
}

const OVERRIDABLE = ['id', 'name', 'city', 'website', 'livestreamUrl', 'owner'];
const overrides = checkList('overrides.yaml', readYaml(MANUAL, 'overrides.yaml'));
for (const entry of overrides) {
  const where = `overrides.yaml [${entry.id ?? '?'}]`;
  if (typeof entry.id !== 'string') errors.push(`${where}: needs an id`);
  checkFields(where, entry, ['id', 'note', 'set']);
  if (typeof entry.set !== 'object' || entry.set === null) {
    errors.push(`${where}: needs a "set" block`);
    continue;
  }
  checkFields(`${where} set`, entry.set as Record<string, unknown>, OVERRIDABLE);
  for (const k of ['website', 'livestreamUrl'] as const) {
    const v = (entry.set as Record<string, unknown>)[k];
    if (v !== undefined && !isUrl(v)) errors.push(`${where}: ${k} must be a full https:// link`);
    if (isPbsKids(v)) errors.push(`${where}: PBS KIDS links are not allowed (${v})`);
  }
}

// Stop before building anything if a manual file is broken.
if (errors.length > 0) {
  console.error(`\nbuild-data: ${errors.length} problem(s) in data/manual/:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}

// ==================================================================================
// 2. Build organizations and facilities from Wikipedia
// ==================================================================================

const wikiPath = join(RAW, 'wikipedia', 'pbs-extracted.json');
if (!existsSync(wikiPath)) {
  console.error('build-data: data/raw/wikipedia/pbs-extracted.json is missing. Run: npm run fetch-wikipedia');
  process.exit(1);
}
const wiki = JSON.parse(readFileSync(wikiPath, 'utf8')) as { source: string; retrievedAt: string; rows: ExtractedRow[] };

interface Draft {
  org: Organization;
  facilities: Omit<Facility, 'organizationId'>[];
  callSigns: Set<string>;
  satelliteOf?: string;
}

const drafts: Draft[] = [];
const unmatched = section('Rows with no transmitter coordinates (not findable by ZIP until fixed)');
const lowConfidence = section('Low-confidence matches to review');

for (const row of wiki.rows) {
  const state = STATES[row.state];
  if (!state) {
    lowConfidence.push(`${row.label}: unknown state "${row.state}" — skipped`);
    continue;
  }
  const name = displayName(row.label);
  const info: InfoboxFields | undefined = row.primary ?? row.stations[0];
  const listSource: Provenance = { source: wiki.source, retrievedAt: wiki.retrievedAt };
  const articleSource = (i?: InfoboxFields): Provenance =>
    i ? { source: i.url, retrievedAt: i.retrievedAt } : listSource;

  // Call signs this row stands for: linked call-sign articles, plus any in the label.
  const callSigns = new Set<string>();
  for (const l of row.links) if (l.isCallSign) { const c = callSignOf(l.title); if (c) callSigns.add(c); }
  for (const m of row.label.matchAll(/\b[KW][A-Z]{2,3}(?:-(?:TV|DT|CD|LD))?\b/g)) callSigns.add(m[0]);

  const city = /^(statewide|regional)/i.test(row.city) ? null : row.city || null;
  const facilities: Draft['facilities'] = [];
  const addFacility = (callSign: string | undefined, coords: { lat: number; lng: number } | undefined, facilityId: number | undefined, fCity: string | null, src: Provenance) => {
    if (!coords || !callSign) return;
    const id = facilityId ? `fcc-${facilityId}` : `wp-${callSign.toLowerCase()}`;
    if (facilities.some((f) => f.id === id || f.callSign === callSign)) return;
    facilities.push({ id, callSign, service: 'tv', city: fCity, state, lat: coords.lat, lng: coords.lng, source: src.source, retrievedAt: src.retrievedAt });
  };

  // a) Station articles' own infobox (the main transmitter). If Wikipedia redirected this
  //    row's call sign to a different station's article (e.g. KQET → KQED), this row is a
  //    satellite of that station: don't claim its transmitter, merge into it below.
  let redirectedTo: string | undefined;
  for (const s of row.stations) {
    const articleCalls = s.callSigns ?? [callSignOf(s.title)].filter((c): c is string => !!c);
    const linked = s.requested ? callSignOf(s.requested) : undefined;
    const base = (c: string) => c.replace(/-TV$/, '');
    if (linked && articleCalls.length && base(articleCalls[0]) !== base(linked)) { redirectedTo = articleCalls[0]; continue; }
    addFacility(articleCalls[0] ?? [...callSigns][0], s.coords, s.facilityId, city, articleSource(s));
  }
  // b) Network article infobox (network articles are sometimes really one station's article).
  if (row.primary && !row.stations.some((s) => s.url === row.primary!.url)) {
    const c = row.primary.callSigns?.[0] ?? [...callSigns][0] ?? callSignOf(row.primary.title);
    addFacility(c, row.primary.coords, row.primary.facilityId, city, articleSource(row.primary));
    for (const x of row.primary.callSigns ?? []) callSigns.add(x);
  }
  // c) Transmitter tables. A network row takes all of them; a call-sign row takes only its own
  //    (several satellites can share one article that lists all of them).
  const isNetworkRow = row.links.some((l) => !l.isCallSign);
  const tableSource = articleSource(row.primary);
  for (const t of row.transmitters) {
    if (isNetworkRow || callSigns.has(t.callSign)) {
      addFacility(t.callSign, t.coords, t.facilityId, t.city ?? null, tableSource);
      callSigns.add(t.callSign);
    }
  }

  const org: Organization = {
    id: slug(name),
    name,
    networks: ['PBS'],
    mediaTypes: ['tv'],
    city,
    state,
    owner: info?.owner,
    // Wikipedia often still lists http:// sites; every station site we link serves https.
    website: info?.website?.replace(/^http:/, 'https:'),
    apps: [],
    facilityIds: [],
    sources: { name: listSource, city: listSource, state: listSource },
  };
  if (org.owner) org.sources.owner = articleSource(info);
  if (org.website) org.sources.website = articleSource(info);
  if (org.website && !isUrl(org.website)) delete org.website;

  const satelliteOf = row.notes.match(/satellite of ([KW][A-Z]{2,3}(?:-TV)?)/i)?.[1]?.toUpperCase() ?? (facilities.length ? undefined : redirectedTo);
  drafts.push({ org, facilities, callSigns, satelliteOf });
  if (facilities.length === 0 && !satelliteOf) unmatched.push(`${org.id} (${row.label}, ${state})${row.notes ? ' — ' + row.notes : ''}`);
}

// Merge rows that are the same organization: same display name in the same state
// (e.g. "Cascade PBS (KCTS-TV)" + "Cascade PBS (KYVE)"), and satellites into their parent.
const merges = section('Merged rows');
function mergeInto(target: Draft, from: Draft, why: string) {
  for (const f of from.facilities) if (!target.facilities.some((x) => x.id === f.id)) target.facilities.push(f);
  for (const c of from.callSigns) target.callSigns.add(c);
  merges.push(`${from.org.name} (${from.org.state}) → ${target.org.id}: ${why}`);
  drafts.splice(drafts.indexOf(from), 1);
}
for (const d of [...drafts]) {
  const twin = drafts.find((x) => x !== d && x.org.state === d.org.state && x.org.name === d.org.name && drafts.indexOf(x) < drafts.indexOf(d));
  if (twin) mergeInto(twin, d, 'same name');
}
for (const d of [...drafts]) {
  if (!d.satelliteOf) continue;
  const base = d.satelliteOf.replace(/-TV$/, '');
  const parent = drafts.find((x) => x !== d && (x.callSigns.has(base) || x.callSigns.has(`${base}-TV`)));
  if (parent) mergeInto(parent, d, `satellite of ${d.satelliteOf}`);
  else lowConfidence.push(`${d.org.id}: Wikipedia says satellite of ${d.satelliteOf}, but no row has that call sign; kept separate`);
}

// Hand-listed merges (data/manual/merges.yaml), by automatic id.
const unknownMerge = section('merges.yaml entries whose id matches no station');
for (const m of mergesFile) {
  const from = drafts.find((d) => d.org.id === m.id);
  const into = drafts.find((d) => d.org.id === m.into);
  if (!from || !into) { unknownMerge.push(`${m.id} → ${m.into}`); continue; }
  mergeInto(into, from, `merges.yaml${m.note ? ` (${m.note})` : ''}`);
}

// Unique ids: add the state when two stations share a name.
for (const d of drafts) {
  if (drafts.filter((x) => x.org.id === d.org.id).length > 1) d.org.id = `${d.org.id}-${d.org.state.toLowerCase()}`;
}

// ==================================================================================
// 3. Apply manual files (last, so they always win)
// ==================================================================================

const byId = new Map(drafts.map((d) => [d.org.id, d]));
const unknownIds = section('Manual entries whose id matches no station (check spelling, or see the ids below)');

// Overrides first, because they can rename an id that the other manual files then use.
for (const o of overrides) {
  const d = byId.get(o.id as string);
  if (!d) { unknownIds.push(`overrides.yaml: ${o.id}`); continue; }
  const set = o.set as Record<string, string>;
  const prov: Provenance = { source: `manual: overrides.yaml${o.note ? ` (${o.note})` : ''}`, retrievedAt: today() };
  for (const [k, v] of Object.entries(set)) {
    if (k === 'id') { byId.delete(d.org.id); d.org.id = v; byId.set(v, d); continue; }
    (d.org as unknown as Record<string, unknown>)[k] = v;
    d.org.sources[k] = prov;
  }
}

// Web apps listed in station-app-pages.yaml.
for (const page of appPages) {
  const d = byId.get(page.id as string);
  if (!d) { unknownIds.push(`station-app-pages.yaml: ${page.id}`); continue; }
  if (isUrl(page.webApp)) {
    d.org.apps.push({ platform: 'web', url: page.webApp, source: 'manual: station-app-pages.yaml', retrievedAt: today(), verified: true });
  }
}

// Store links found on stations' own websites (fetch-station-app-pages). Links from a
// known apps page come first; homepage/discovered links fill the remaining platforms.
const appLinksPath = join(RAW, 'station-sites', 'app-links.json');
const scraped = existsSync(appLinksPath) ? (JSON.parse(readFileSync(appLinksPath, 'utf8')) as StationAppLinks[]) : [];
const howRank = { 'manual-page': 0, homepage: 1, 'discovered-page': 2 } as const;
// Wikipedia sometimes lists a station's old domain. If the station's own homepage now
// redirects to a different domain (e.g. kcts9.org → cascadepbs.org), use where it lands.
const redirected = section('Websites updated because the old address redirects');
const hostOf = (u: string) => new URL(u).host.replace(/^www\./, '');
for (const site of scraped) {
  const d = byId.get(site.id);
  if (!d?.org.website || !site.homepage || d.org.sources.website?.source.startsWith('manual')) continue;
  if (site.homepage.requested !== d.org.website) continue; // website changed since the fetch
  if (hostOf(site.homepage.final) !== hostOf(site.homepage.requested) && isUrl(site.homepage.final)) {
    redirected.push(`${d.org.id}: ${d.org.website} → ${site.homepage.final}`);
    d.org.website = site.homepage.final;
    d.org.sources.website = { source: `redirect from ${site.homepage.requested} (station website)`, retrievedAt: site.retrievedAt };
  }
}

// Livestream links found on station homepages (unverified until reviewed; overrides.yaml
// can set or correct them). Donate links are also noted by the fetch, but not published
// for now (decided 2026-10-18).
const foundLinks = section('Livestream links found on homepages (check they are right)');
for (const site of scraped) {
  const d = byId.get(site.id);
  if (!d) continue;
  for (const [field, link] of [['livestreamUrl', site.livestream]] as const) {
    if (!link || d.org[field] || !isUrl(link.url)) continue;
    d.org[field] = link.url;
    d.org.sources[field] = { source: `${site.homepage?.final ?? 'homepage'} (link "${link.text}")`, retrievedAt: site.retrievedAt };
    foundLinks.push(`${d.org.id}: livestream "${link.text}" → ${link.url}`);
  }
}

const extras = section('Extra apps (a second app for the same platform; set extra/name in station-apps.yaml if wrong)');
const excluded = new Set(stationApps.flatMap((e) => (Array.isArray(e.exclude) ? (e.exclude as string[]) : [])));
for (const site of scraped) {
  const d = byId.get(site.id);
  if (!d) continue; // station no longer in the data (renamed or removed since the fetch)
  const links = [...site.links].sort((a, b) => howRank[a.how] - howRank[b.how]);
  for (const l of links) {
    if (isPbsKids(l.url) || excluded.has(l.url)) continue;
    if (/[?&]id=com\.(amazon|google|roku|samsung|lge|apple)\./.test(l.url)) continue; // device makers' apps
    if (d.org.apps.some((a) => a.url === l.url && a.platform === l.platform)) continue;
    const main = d.org.apps.find((a) => a.platform === l.platform && !a.extra);
    if (main?.kind === 'instructions' && l.kind !== 'instructions') {
      // A real store link beats a "how to get it" link for the same platform.
      d.org.apps.splice(d.org.apps.indexOf(main), 1);
    } else if (main) {
      if (l.kind === 'instructions') continue;
      // A second app for the same platform: keep it as an extra app.
      d.org.apps.push({ platform: l.platform, url: l.url, source: l.foundOn, retrievedAt: site.retrievedAt, verified: false, extra: true });
      extras.push(`${d.org.id}: extra ${l.platform} app ${l.url} (main: ${main.url})`);
      continue;
    }
    d.org.apps.push({ platform: l.platform, url: l.url, source: l.foundOn, retrievedAt: site.retrievedAt, verified: false, ...(l.kind === 'instructions' ? { kind: 'instructions' as const } : {}) }); // scraped: unverified until a person adds it to station-apps.yaml
    if (l.kind === 'instructions') { lowConfidence.push(`${d.org.id}: its apps page names ${l.platform} but has no store link; linking the page`); continue; }
    if (l.confidence === 'low') lowConfidence.push(`${d.org.id}: ${l.platform} guessed from link text "${l.linkText}" — ${l.url}`);
    else if (l.how !== 'manual-page') lowConfidence.push(`${d.org.id}: ${l.platform} link found on ${l.foundOn} — check it's the station's own app`);
  }
}

// Hand-checked app links win over everything else: a main app replaces the platform's
// main app; an `extra: true` app is added (or corrected) as an extra app.
for (const entry of stationApps) {
  const d = byId.get(entry.id as string);
  if (!d) { unknownIds.push(`station-apps.yaml: ${entry.id}`); continue; }
  for (const a of (entry.apps ?? []) as Record<string, unknown>[]) {
    const isExtra = a.extra === true;
    d.org.apps = d.org.apps.filter((x) => x.url !== a.url && (isExtra || x.platform !== a.platform || x.extra));
    d.org.apps.push({
      platform: a.platform as Platform, url: a.url as string, source: a.source as string, retrievedAt: toDateString(a.retrievedAt), verified: true,
      ...(isExtra ? { extra: true } : {}), ...(typeof a.name === 'string' ? { name: a.name } : {}),
    });
  }
}

// Name the extra apps. Apple links carry a name in their address; a Google Play extra is
// paired with an Apple extra whose name matches its package id (org.ket.legislativecoverage
// ↔ "KET Legislative Coverage"), otherwise it gets a generic name.
for (const d of drafts) {
  const extrasHere = d.org.apps.filter((a) => a.extra);
  for (const a of extrasHere) if (!a.name) a.name = appNameFromUrl(a.url, d.org);
  const paired = new Set<string>();
  const unnamed = extrasHere.filter((x) => !x.name);
  for (const a of unnamed) {
    const pkg = a.url.match(/[?&]id=([\w.]+)/)?.[1]?.split('.').pop() ?? '';
    const twin = extrasHere.find((x) => x.name && !paired.has(x.name) && pkg.length > 3 && letters(x.name).endsWith(letters(pkg)));
    if (twin?.name) { a.name = twin.name; paired.add(twin.name); }
  }
  // Still unnamed: pair with the next named app that has no other-platform twin yet, in
  // the order the station's page lists them (stations usually list an app's links together).
  for (const a of unnamed.filter((x) => !x.name)) {
    const twin = extrasHere.find((x) => x.name && x.platform !== a.platform && !paired.has(x.name) &&
      !extrasHere.some((y) => y !== x && y.name === x.name && y.platform === a.platform));
    if (twin?.name) { a.name = twin.name; paired.add(twin.name); lowConfidence.push(`${d.org.id}: paired ${a.url} with "${twin.name}" by position on the page`); }
    else a.name = 'Another app';
  }
}

// ==================================================================================
// 4. Final checks and output
// ==================================================================================

const organizations: Organization[] = [];
const facilities: Facility[] = [];
const seenIds = new Set<string>();
for (const d of drafts) {
  if (seenIds.has(d.org.id)) errors.push(`duplicate station id "${d.org.id}" (an override may have renamed two stations to the same id)`);
  seenIds.add(d.org.id);
  d.org.apps.sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform));
  for (const f of d.facilities) {
    if (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) { errors.push(`${d.org.id}: bad coordinates for ${f.callSign}`); continue; }
    if (facilities.some((x) => x.id === f.id)) {
      lowConfidence.push(`${f.callSign} (${f.id}) appears under two stations; kept under the first, not ${d.org.id}`);
      continue;
    }
    facilities.push({ ...f, organizationId: d.org.id });
    d.org.facilityIds.push(f.id);
  }
  organizations.push(d.org);
}
if (errors.length > 0) {
  console.error(`\nbuild-data: ${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
organizations.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
facilities.sort((a, b) => a.id.localeCompare(b.id));

const nationalOut = national.map((b) => ({
  id: b.id,
  name: b.name,
  description: b.description,
  apps: (b.apps as Record<string, unknown>[]).map((a) => ({ ...a, retrievedAt: toDateString(a.retrievedAt) })),
}));

mkdirSync(OUT, { recursive: true });
const write = (file: string, data: unknown) => writeFileSync(join(OUT, file), JSON.stringify(data, null, 2) + '\n');
write('organizations.json', organizations);
write('facilities.json', facilities);
write('national.json', nationalOut);

// --- ZIP shards and search index for the browser ---------------------------------
// ZIP centroids are split by 3-digit prefix (public/data/zip/981.json) so a search
// downloads only a few KB. The search index is everything search needs in one small file.
const zctaPath = join(RAW, 'census', 'zcta.json');
if (existsSync(zctaPath)) {
  const zcta = JSON.parse(readFileSync(zctaPath, 'utf8')) as { zips: Record<string, [number, number]> };
  const shards = new Map<string, Record<string, [number, number]>>();
  for (const [zip, ll] of Object.entries(zcta.zips)) {
    const k = zip.slice(0, 3);
    if (!shards.has(k)) shards.set(k, {});
    shards.get(k)![zip] = ll;
  }
  rmSync(join(OUT, 'zip'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'zip'), { recursive: true });
  for (const [k, zips] of shards) writeFileSync(join(OUT, 'zip', `${k}.json`), JSON.stringify(zips));
} else {
  console.warn('build-data: data/raw/census/zcta.json missing — ZIP search files not written (npm run build-zcta)');
}
const facById = new Map(facilities.map((f) => [f.id, f]));
// Search radius per transmitter, as in SPEC §5: TV reaches farther than radio.
const RADIUS_MI = { tv: 75, fm: 50, am: 50 } as const;
const ownGroup = (o: Organization, platforms: Platform[]) => o.apps.some((a) => !a.extra && platforms.includes(a.platform));
const searchIndex = organizations.map((o) => ({
  id: o.id,
  name: o.name,
  mono: monogram(o.name),
  city: o.city,
  state: o.state,
  calls: o.facilityIds.map((id) => facById.get(id)!.callSign),
  tx: o.facilityIds.map((id) => { const f = facById.get(id)!; return [f.lat, f.lng, RADIUS_MI[f.service]]; }),
  // Which kinds of devices the station's own apps cover (for the icons on result cards).
  devices: {
    mobile: ownGroup(o, ['ios', 'android']),
    tv: ownGroup(o, ['appletv', 'roku', 'firetv', 'androidtv', 'samsung', 'lg']),
    web: ownGroup(o, ['web']),
  },
  network: o.networks.join(', '),
  media: o.mediaTypes,
  hasApps: o.apps.some((a) => !a.extra),
  live: o.livestreamUrl ?? null,
}));
writeFileSync(join(OUT, 'search.json'), JSON.stringify(searchIndex));

// --- Report (printed, and saved to data/build-report.txt for review in PRs) ----
const noApps = organizations.filter((o) => o.apps.length === 0);
const noWebsite = organizations.filter((o) => !o.website);
const lines: string[] = [
  'build-data report',
  `  organizations:  ${organizations.length} (${organizations.filter((o) => o.facilityIds.length).length} with transmitter coordinates)`,
  `  facilities:     ${facilities.length}`,
  `  with apps:      ${organizations.length - noApps.length} (${organizations.filter((o) => o.apps.some((a) => a.verified)).length} with a verified app)   without apps: ${noApps.length}`,
  `  without website: ${noWebsite.length}${noWebsite.length ? ' (' + noWebsite.map((o) => o.id).join(', ') + ')' : ''}`,
  `  manual: ${overrides.length} overrides, ${mergesFile.length} merges, ${appPages.length} app pages, ${stationApps.length} station-apps entries`,
];
for (const s of report) {
  if (!s.lines.length) continue;
  lines.push('', `  ${s.title}: ${s.lines.length}`, ...s.lines.map((l) => `    - ${l}`));
}
lines.push('', '  Station ids:', ...organizations.map((o) => `    ${o.state}  ${o.id.padEnd(44)} ${o.name}`));
writeFileSync(join(ROOT, 'data', 'build-report.txt'), lines.join('\n') + '\n');
const full = process.argv.includes('--ids') || process.argv.includes('--full');
console.log('\n' + (full ? lines : lines.slice(0, 6)).join('\n'));
for (const s of report) if (s.lines.length && !full) console.log(`  ${s.title}: ${s.lines.length}`);
console.log('\n  full report: data/build-report.txt');
console.log('\n  wrote public/data/organizations.json, facilities.json, national.json, search.json, zip/*.json\n');
