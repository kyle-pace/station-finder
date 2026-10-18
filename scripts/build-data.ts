// build-data: merges source data and manual files into public/data/*.json.
//
// Phase 1: validates the hand-maintained files in data/manual/ and writes
// public/data/national.json. Station data (FCC, Wikipedia) arrives in Phase 2.
//
// Safe to re-run: it only reads data/ and overwrites its own output files.
// Run with: npm run build-data

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const MANUAL = join(ROOT, 'data', 'manual');
const OUT = join(ROOT, 'public', 'data');

const PLATFORMS = [
  'ios', 'android', 'appletv', 'firetv', 'androidtv', 'roku', 'samsung', 'lg', 'web',
] as const;
type Platform = (typeof PLATFORMS)[number];

interface NationalApp {
  platform: Platform;
  kind: 'store' | 'help';
  url: string;
  source: string;
  retrievedAt: string;
}
interface NationalBrand {
  id: string;
  name: string;
  description: string;
  apps: NationalApp[];
}

const errors: string[] = [];

function readYaml(file: string): unknown {
  const path = join(MANUAL, file);
  try {
    return parse(readFileSync(path, 'utf8')) ?? [];
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

function isUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
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

function toDateString(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function checkApp(where: string, app: Record<string, unknown>, needsKind: boolean): void {
  if (!PLATFORMS.includes(app.platform as Platform)) {
    errors.push(`${where}: unknown platform "${app.platform}" (use one of: ${PLATFORMS.join(', ')})`);
  }
  if (needsKind && app.kind !== 'store' && app.kind !== 'help') {
    errors.push(`${where}: kind must be "store" or "help"`);
  }
  if (!isUrl(app.url)) errors.push(`${where}: url must be a full https:// link`);
  if (isPbsKids(app.url)) errors.push(`${where}: PBS KIDS links are not allowed (${app.url})`);
  if (typeof app.source !== 'string' || !app.source) errors.push(`${where}: missing source`);
  if (!isDate(app.retrievedAt)) errors.push(`${where}: retrievedAt must be a date like 2026-10-18`);
}

// --- national.yaml -----------------------------------------------------------
const national = checkList('national.yaml', readYaml('national.yaml'));
for (const brand of national) {
  const where = `national.yaml [${brand.id ?? '?'}]`;
  if (typeof brand.id !== 'string' || typeof brand.name !== 'string') {
    errors.push(`${where}: needs an id and a name`);
  }
  const apps = Array.isArray(brand.apps) ? brand.apps : [];
  if (apps.length === 0) errors.push(`${where}: has no apps`);
  apps.forEach((app, i) => checkApp(`${where} app ${i + 1}`, app, true));
}

// --- station-apps.yaml -------------------------------------------------------
const stationApps = checkList('station-apps.yaml', readYaml('station-apps.yaml'));
for (const entry of stationApps) {
  const where = `station-apps.yaml [${entry.id ?? '?'}]`;
  if (typeof entry.id !== 'string') errors.push(`${where}: needs an id`);
  // Neutrality: this file is public and must not record partner status.
  for (const key of Object.keys(entry)) {
    if (!['id', 'name', 'apps'].includes(key)) {
      errors.push(`${where}: unexpected field "${key}" (only id, name, apps are allowed)`);
    }
  }
  const apps = Array.isArray(entry.apps) ? entry.apps : [];
  apps.forEach((app, i) => checkApp(`${where} app ${i + 1}`, app, false));
}

// --- overrides.yaml ----------------------------------------------------------
const overrides = checkList('overrides.yaml', readYaml('overrides.yaml'));
for (const entry of overrides) {
  const where = `overrides.yaml [${entry.id ?? '?'}]`;
  if (typeof entry.id !== 'string') errors.push(`${where}: needs an id`);
  if (typeof entry.set !== 'object' || entry.set === null) errors.push(`${where}: needs a "set" block`);
}

// --- Report and write ----------------------------------------------------------
if (errors.length > 0) {
  console.error(`\nbuild-data: ${errors.length} problem(s) in data/manual/:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}

const nationalOut: NationalBrand[] = (national as unknown as NationalBrand[]).map((b) => ({
  id: b.id,
  name: b.name,
  description: b.description,
  apps: b.apps.map((a) => ({ ...a, retrievedAt: toDateString(a.retrievedAt) })),
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'national.json'), JSON.stringify(nationalOut, null, 2) + '\n');

const appCount = nationalOut.reduce((n, b) => n + b.apps.length, 0);
console.log('\nbuild-data report');
console.log(`  national apps:     ${nationalOut.length} brands, ${appCount} links`);
console.log(`  station-apps.yaml: ${stationApps.length} stations`);
console.log(`  overrides.yaml:    ${overrides.length} corrections`);
console.log('  wrote public/data/national.json\n');
