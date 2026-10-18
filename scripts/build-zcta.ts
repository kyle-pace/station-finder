// build-zcta: converts the hand-downloaded Census ZCTA Gazetteer file into
// data/raw/census/zcta.json ({ "98101": [lat, lng], ... }).
//
// This script never downloads anything: see data/raw/census/SOURCE.md for why the file
// is fetched by hand and where it came from. Re-run after replacing the file.
// Run with: npm run build-zcta

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../data/raw/census/', import.meta.url).pathname;
const file = readdirSync(DIR).filter((f) => /^\d{4}_Gaz_zcta_national\.txt$/.test(f)).sort().pop();
if (!file) {
  console.error('build-zcta: no *_Gaz_zcta_national.txt in data/raw/census/ (see SOURCE.md)');
  process.exit(1);
}
const [header, ...rows] = readFileSync(join(DIR, file), 'utf8').trim().split(/\r?\n/);
const cols = header.split('|').map((c) => c.trim());
const iZip = cols.indexOf('GEOID');
const iLat = cols.indexOf('INTPTLAT');
const iLng = cols.indexOf('INTPTLONG');
if (iZip < 0 || iLat < 0 || iLng < 0) throw new Error(`unexpected columns: ${cols.join(', ')}`);

const zips: Record<string, [number, number]> = {};
for (const row of rows) {
  const c = row.split('|');
  const lat = Number(c[iLat]);
  const lng = Number(c[iLng]);
  if (!/^\d{5}$/.test(c[iZip]) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  zips[c[iZip]] = [Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4];
}
const out = {
  source: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${file.slice(0, 4)}_Gazetteer/${file.replace('.txt', '.zip')}`,
  retrievedAt: statSync(join(DIR, file.replace('.txt', '.zip'))).mtime.toISOString().slice(0, 10),
  license: 'Public domain (U.S. Census Bureau)',
  zips,
};
writeFileSync(join(DIR, 'zcta.json'), JSON.stringify(out) + '\n');
console.log(`build-zcta: ${Object.keys(zips).length} ZIP codes → data/raw/census/zcta.json`);
