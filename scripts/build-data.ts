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
// Outputs (public/data/): organizations.json, facilities.json, national.json
//
// Manual files are applied last, so a re-run never undoes a manual fix. Safe to re-run:
// it only reads data/ and overwrites its own output files.
// Run with: npm run build-data

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ExtractedRow, InfoboxFields } from './fetch-wikipedia.ts';
import type { StationAppLinks } from './fetch-station-app-pages.ts';

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
}

interface Organization {
  id: string;
  name: string;
  networks: string[];
  mediaTypes: ('tv' | 'radio')[];
  city: string | null; // null for statewide/regional networks
  state: string;
  owner?: string;
  website?: string;
  donateUrl?: string;
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
  checkFields(where, entry, ['id', 'name', 'apps']);
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

const OVERRIDABLE = ['id', 'name', 'city', 'website', 'donateUrl', 'livestreamUrl', 'owner'];
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
  for (const k of ['website', 'donateUrl', 'livestreamUrl'] as const) {
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
for (const site of scraped) {
  const d = byId.get(site.id);
  if (!d) continue; // station no longer in the data (renamed or removed since the fetch)
  const links = [...site.links].sort((a, b) => howRank[a.how] - howRank[b.how]);
  for (const l of links) {
    if (isPbsKids(l.url)) continue;
    const existing = d.org.apps.find((a) => a.platform === l.platform);
    if (existing) {
      if (existing.url !== l.url) lowConfidence.push(`${d.org.id}: more than one ${l.platform} link on its site; using ${existing.url}, not ${l.url}`);
      continue;
    }
    d.org.apps.push({ platform: l.platform, url: l.url, source: l.foundOn, retrievedAt: site.retrievedAt, verified: l.how === 'manual-page' && l.confidence === 'high' });
    if (l.confidence === 'low') lowConfidence.push(`${d.org.id}: ${l.platform} guessed from link text "${l.linkText}" — ${l.url}`);
    else if (l.how !== 'manual-page') lowConfidence.push(`${d.org.id}: ${l.platform} link found on ${l.foundOn} — check it's the station's own app`);
  }
}

// Hand-checked app links win over everything else for their platform.
for (const entry of stationApps) {
  const d = byId.get(entry.id as string);
  if (!d) { unknownIds.push(`station-apps.yaml: ${entry.id}`); continue; }
  for (const a of entry.apps as Record<string, unknown>[]) {
    d.org.apps = d.org.apps.filter((x) => x.platform !== a.platform);
    d.org.apps.push({ platform: a.platform as Platform, url: a.url as string, source: a.source as string, retrievedAt: toDateString(a.retrievedAt), verified: true });
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

// --- Report ----------------------------------------------------------------------
const noApps = organizations.filter((o) => o.apps.length === 0);
const noWebsite = organizations.filter((o) => !o.website);
console.log('\nbuild-data report');
console.log(`  organizations:  ${organizations.length} (${organizations.filter((o) => o.facilityIds.length).length} with transmitter coordinates)`);
console.log(`  facilities:     ${facilities.length}`);
console.log(`  with apps:      ${organizations.length - noApps.length}   without apps: ${noApps.length}`);
console.log(`  without website: ${noWebsite.length}${noWebsite.length ? ' (' + noWebsite.map((o) => o.id).join(', ') + ')' : ''}`);
console.log(`  manual: ${overrides.length} overrides, ${appPages.length} app pages, ${stationApps.length} station-apps entries`);
for (const s of report) {
  if (!s.lines.length) continue;
  console.log(`\n  ${s.title}: ${s.lines.length}`);
  for (const l of s.lines) console.log(`    - ${l}`);
}
if (process.argv.includes('--ids')) {
  console.log('\n  Station ids:');
  for (const o of organizations) console.log(`    ${o.state}  ${o.id.padEnd(44)} ${o.name}`);
}
console.log('\n  wrote public/data/organizations.json, facilities.json, national.json\n');
