// Build-time access to the generated data in public/data/ (written by scripts/build-data).
// Pages import from here; the browser loads the same files directly (search.json, zip/).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Platform = 'ios' | 'android' | 'appletv' | 'firetv' | 'androidtv' | 'roku' | 'samsung' | 'lg' | 'web';

export interface Provenance { source: string; retrievedAt: string }
export interface App { platform: Platform; url: string; source: string; retrievedAt: string; verified: boolean; extra?: boolean; name?: string; kind?: 'instructions' }
export interface Organization {
  id: string;
  name: string;
  networks: string[];
  mediaTypes: ('tv' | 'radio')[];
  city: string | null;
  state: string;
  owner?: string;
  website?: string;
  livestreamUrl?: string;
  apps: App[];
  facilityIds: string[];
  sources: Record<string, Provenance>;
}
export interface Facility {
  id: string;
  callSign: string;
  service: 'tv' | 'fm' | 'am';
  frequency?: string;
  city: string | null;
  state: string;
  lat: number;
  lng: number;
  organizationId: string;
  source: string;
  retrievedAt: string;
}
export interface NationalApp { platform: Platform; kind: 'store' | 'help'; url: string; source: string; retrievedAt: string }
export interface NationalBrand { id: string; name: string; description: string; apps: NationalApp[] }

// Paths are relative to the project root: Astro bundles this file elsewhere at build time.
const read = <T>(file: string): T => JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', file), 'utf8')) as T;

export const organizations = read<Organization[]>('organizations.json');
export const facilities = read<Facility[]>('facilities.json');
export const national = read<NationalBrand[]>('national.json');

import { STATE_NAMES } from './states';
export { STATE_NAMES };
// Every state an organization broadcasts in: its home state plus its transmitters' states
// (a regional network like High Plains Public Radio appears on each of its states' pages).
const facilityState = new Map(facilities.map((f) => [f.id, f.state]));
export const statesOf = (o: Organization) => [...new Set([o.state, ...o.facilityIds.map((id) => facilityState.get(id)!).filter(Boolean)])];
export const stationsIn = (code: string) => organizations.filter((o) => statesOf(o).includes(code));

// States (and territories) that have at least one station, A–Z by name.
export const statesWithStations = [...new Set(organizations.flatMap(statesOf))]
  .map((code) => ({ code, name: STATE_NAMES[code] ?? code, count: stationsIn(code).length }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const facilitiesFor = (org: Organization) => org.facilityIds.map((id) => facilities.find((f) => f.id === id)!).filter(Boolean);

// "PBS · TV · Sacramento, CA"
export function metaLine(org: Pick<Organization, 'networks' | 'mediaTypes' | 'city' | 'state'>): string {
  const media = org.mediaTypes.map((m) => (m === 'tv' ? 'TV' : 'Radio')).join(' & ');
  const where = org.city ? `${org.city}, ${org.state}` : `Statewide, ${org.state}`;
  return [org.networks.join(', '), media, where].filter(Boolean).join(' · ');
}

// Platform labels and grouping for app buttons (station page and national block).
export const PLATFORM_INFO: Record<Platform, { label: string; detail: string; icon: 'phone' | 'tv' | 'web'; group: 'mobile' | 'tv' | 'web' }> = {
  ios: { label: 'App Store', detail: 'iPhone & iPad', icon: 'phone', group: 'mobile' },
  android: { label: 'Google Play', detail: 'Android phones & tablets', icon: 'phone', group: 'mobile' },
  appletv: { label: 'Apple TV', detail: 'App Store on Apple TV', icon: 'tv', group: 'tv' },
  roku: { label: 'Roku', detail: 'Roku Channel Store', icon: 'tv', group: 'tv' },
  firetv: { label: 'Fire TV', detail: 'Amazon Appstore', icon: 'tv', group: 'tv' },
  androidtv: { label: 'Android TV & Google TV', detail: 'Google Play on your TV', icon: 'tv', group: 'tv' },
  samsung: { label: 'Samsung TV', detail: 'Samsung Smart TV apps', icon: 'tv', group: 'tv' },
  lg: { label: 'LG TV', detail: 'LG Content Store', icon: 'tv', group: 'tv' },
  web: { label: 'Watch on the web', detail: 'In your browser', icon: 'web', group: 'web' },
};
export const PLATFORM_ORDER: Platform[] = ['ios', 'android', 'appletv', 'roku', 'firetv', 'androidtv', 'samsung', 'lg', 'web'];

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const host = (url: string) => new URL(url).host.replace(/^www\./, '');
