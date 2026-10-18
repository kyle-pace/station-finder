// Polite, cached HTTP fetching for the data scripts.
//
// Every request:
//   - identifies us with a descriptive User-Agent and a contact link
//   - is checked against the host's robots.txt first (refused if disallowed)
//   - waits at least MIN_DELAY_MS since the previous request to the same host
//   - is saved under data/raw/<source>/ with a .meta.json recording url + retrievedAt
//
// Cached files are reused on re-runs, so scripts are safe to re-run. Pass --refresh
// on the command line to download everything again.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const USER_AGENT =
  'StationAppFinder/0.1 (+https://github.com/kyle-pace/station-finder/issues)';
const MIN_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RAW_DIR = new URL('../../data/raw/', import.meta.url).pathname;
export const REFRESH = process.argv.includes('--refresh');

export interface Fetched {
  body: string;
  url: string;
  retrievedAt: string; // YYYY-MM-DD
  fromCache: boolean;
}

interface Meta {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  retrievedAt: string;
}

const lastRequestAt = new Map<string, number>();
const robotsCache = new Map<string, RobotsRules>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

async function waitForHost(host: string): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + MIN_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

async function rawGet(url: string): Promise<Response> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    await waitForHost(host);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return res;
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
  }
}

// --- robots.txt -----------------------------------------------------------------

interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
}

// Parses the rules that apply to us: a group naming "StationAppFinder" if one exists,
// otherwise the "*" group. Matching follows RFC 9309: the longest matching rule wins,
// and Allow wins a tie.
export function parseRobots(text: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules['rules'] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if ((key === 'allow' || key === 'disallow') && value) {
        current.rules.push({ allow: key === 'allow', pattern: value });
      }
    }
  }
  const ours = groups.find((g) => g.agents.includes('stationappfinder'));
  const star = groups.filter((g) => g.agents.includes('*'));
  return { rules: ours ? ours.rules : star.flatMap((g) => g.rules) };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + regex + (anchored ? '$' : '')).test(path);
}

export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const r of rules.rules) {
    if (!patternMatches(r.pattern, pathAndQuery)) continue;
    const length = r.pattern.length;
    if (!best || length > best.length || (length === best.length && r.allow)) {
      best = { allow: r.allow, length };
    }
  }
  return best ? best.allow : true;
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const res = await rawGet(`${origin}/robots.txt`);
  // No robots.txt (4xx) means everything is allowed. A server error means we can't
  // tell, so treat the whole site as off-limits for this run (RFC 9309 §2.3.1.4).
  const rules: RobotsRules =
    res.ok ? parseRobots(await res.text())
    : res.status >= 500 ? { rules: [{ allow: false, pattern: '/' }] }
    : { rules: [] };
  robotsCache.set(origin, rules);
  return rules;
}

export class RobotsDisallowed extends Error {}

// --- Cached fetch -------------------------------------------------------------

// Fetches `url` (or reuses the cached copy) and saves it as data/raw/<source>/<name>.
export async function fetchCached(source: string, name: string, url: string): Promise<Fetched> {
  const file = join(RAW_DIR, source, name);
  const metaFile = `${file}.meta.json`;
  if (!REFRESH && existsSync(file) && existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as Meta;
    return { body: readFileSync(file, 'utf8'), url: meta.finalUrl, retrievedAt: meta.retrievedAt, fromCache: true };
  }

  const u = new URL(url);
  const rules = await robotsFor(u.origin);
  if (!isAllowed(rules, u.pathname + u.search)) {
    throw new RobotsDisallowed(`robots.txt disallows ${url}`);
  }
  const res = await rawGet(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // A redirect may land somewhere robots.txt doesn't allow; don't keep that content.
  const final = new URL(res.url);
  if (final.href !== u.href && !isAllowed(await robotsFor(final.origin), final.pathname + final.search)) {
    throw new RobotsDisallowed(`robots.txt disallows ${res.url} (redirected from ${url})`);
  }
  const body = await res.text();
  const meta: Meta = {
    url,
    finalUrl: res.url,
    status: res.status,
    contentType: res.headers.get('content-type'),
    retrievedAt: today(),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  return { body, url: res.url, retrievedAt: meta.retrievedAt, fromCache: false };
}
