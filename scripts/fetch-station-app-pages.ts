// fetch-station-app-pages: finds each station's app store links on the station's OWN
// website and saves them to data/raw/station-sites/app-links.json.
//
// Every station is treated the same way:
//   1. If data/manual/station-app-pages.yaml lists a known "get our app" page, read it.
//   2. Read the station's homepage (website from the last build) and any store links on it.
//   3. Follow up to two homepage links that look like an apps page ("/apps", "Get the app").
//
// We never scrape the app stores themselves. Links to the national PBS/NPR apps and to
// PBS KIDS are ignored: they aren't the station's own apps. Same politeness rules as
// every fetch (robots.txt, 1.5s between requests to a host, cached copies).
//
// Needs public/data/organizations.json from a previous build (for ids and websites).
// Run with: npm run fetch-station-app-pages   (see README: refresh order)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { parse } from 'yaml';
import { fetchCached, RobotsDisallowed } from './lib/fetch.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MANUAL = join(ROOT, 'data', 'manual');
const ORGS = join(ROOT, 'public', 'data', 'organizations.json');
const OUT = join(ROOT, 'data', 'raw', 'station-sites', 'app-links.json');

export type Platform = 'ios' | 'android' | 'appletv' | 'firetv' | 'androidtv' | 'roku' | 'samsung' | 'lg' | 'web';

export interface FoundLink {
  platform: Platform;
  url: string;
  linkText: string;
  foundOn: string;
  how: 'manual-page' | 'homepage' | 'discovered-page';
  confidence: 'high' | 'low'; // low = TV platform guessed from the link's surrounding text
  // "instructions": the station's own page says the app is on this platform but gives no
  // store link (e.g. "search 'PBS Charlotte' in your app store"); url is that page.
  kind?: 'store' | 'instructions';
}

export interface StationAppLinks {
  id: string;
  retrievedAt: string;
  homepage?: { requested: string; final: string }; // final differs when the site redirected
  donate?: { url: string; text: string };     // best "Donate" link on the homepage
  livestream?: { url: string; text: string }; // best "Watch live" link on the homepage
  pagesRead: string[];
  links: FoundLink[];
  problems: string[];
}

// Store URL patterns → platform. Apple and Google links serve both phones and TVs, so
// the TV platforms are guessed from the link's text (low confidence).
const STORES: { platform: Platform; test: RegExp }[] = [
  { platform: 'ios', test: /^https:\/\/(apps|itunes)\.apple\.com\/.*\/id\d+/ },
  { platform: 'android', test: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=/ },
  { platform: 'roku', test: /^https:\/\/(channelstore\.roku\.com\/details\/|my\.roku\.com\/account\/add\/)/ },
  { platform: 'firetv', test: /^https:\/\/www\.amazon\.com\/(.*\/)?(dp|gp\/product)\/B0[A-Z0-9]{8}/ },
  { platform: 'samsung', test: /^https:\/\/(www\.)?apps\.samsung\.com\// },
  { platform: 'lg', test: /^https:\/\/(us\.)?lgappstv\.com\/|^https:\/\/www\.lg\.com\/.*\/apps\// },
];

// National apps (from national.yaml) and PBS KIDS are not a station's own apps.
const nationalIds = new Set<string>();
for (const brand of (parse(readFileSync(join(MANUAL, 'national.yaml'), 'utf8')) ?? []) as { apps: { url: string }[]; otherStoreLinks?: { url: string }[] }[]) {
  for (const a of [...brand.apps, ...(brand.otherStoreLinks ?? [])]) nationalIds.add(storeKey(a.url));
}
// Device makers' own apps (e.g. the Fire TV remote) sometimes appear on "how to watch" pages.
const DEVICE_MAKER_APP = /[?&]id=(com\.(amazon|google|roku|samsung|lge|apple)\.)/;
const isExcluded = (url: string) => /pbs[-_.]?kids/i.test(url) || nationalIds.has(storeKey(url)) || DEVICE_MAKER_APP.test(url);

// A store link's identity, ignoring country, tracking params, and slug text.
function storeKey(url: string): string {
  return (
    url.match(/apple\.com\/.*\/(id\d+)/)?.[1] ??
    url.match(/[?&]id=([\w.]+)/)?.[1] ??
    url.match(/roku\.com\/details\/([0-9a-f]+)/)?.[1] ??
    url.match(/\/(B0[A-Z0-9]{8})/)?.[1] ??
    url.match(/[?&]appId=(\w+)/)?.[1] ??            // LG (digits) and Samsung's older app.do form
    url.match(/samsung\.com\/.*\/app\/(G\d+)/)?.[1] ??
    url
  );
}

function cleanUrl(href: string): string {
  const u = new URL(href);
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|pt$|ct$|mt$|ref|referrer|hl$|gl$|pli$|showAllReviews$)/.test(k)) u.searchParams.delete(k);
  }
  u.hash = '';
  return u.href;
}

// The shortest stable form of a store link: no search/tracking parameters.
function canonicalStoreUrl(url: string): string {
  const u = new URL(url);
  const asin = url.match(/\/(B0[A-Z0-9]{8})/)?.[1];
  if (u.host.endsWith('amazon.com') && asin) return `https://www.amazon.com/dp/${asin}`;
  if (u.host.endsWith('apple.com')) return `https://apps.apple.com${u.pathname}`;
  if (u.host === 'play.google.com') return `https://play.google.com/store/apps/details?id=${u.searchParams.get('id')}`;
  if (u.host.endsWith('lgappstv.com') && u.searchParams.get('appId')) return `https://us.lgappstv.com/main/tvapp/detail?appId=${u.searchParams.get('appId')}`;
  return u.origin + u.pathname + u.search;
}

function guessTv(platform: Platform, context: string): { platform: Platform; confidence: FoundLink['confidence'] } {
  if (platform === 'ios' && /apple ?tv|tvos/i.test(context)) return { platform: 'appletv', confidence: 'low' };
  if (platform === 'android' && /\b(android tv|google tv)\b/i.test(context)) return { platform: 'androidtv', confidence: 'low' };
  return { platform, confidence: 'high' };
}

// "Donate" and "Watch live" links on a homepage, best match first. Text patterns are
// ordered by how specific they are; the first pattern that matches any link wins.
const DONATE = [/^donate( now| today)?$/i, /\bdonate\b/i, /^give( now)?$/i, /\b(become a member|join|support us)\b/i];
const LIVESTREAM = [/^(watch )?live( tv| stream)?$/i, /\b(live ?stream|watch live|live tv)\b/i];
function bestLink($: cheerio.CheerioAPI, base: string, patterns: RegExp[]): { url: string; text: string } | undefined {
  const links = $('a[href]').toArray().map((a) => ({ text: $(a).text().replace(/\s+/g, ' ').trim(), href: $(a).attr('href')! }));
  for (const p of patterns) {
    for (const l of links) {
      if (!l.text || l.text.length > 40 || !p.test(l.text)) continue;
      try {
        const u = new URL(l.href, base);
        if (u.protocol !== 'https:' || /pbs[-_.]?kids/i.test(u.href)) continue;
        u.hash = '';
        return { url: u.href, text: l.text };
      } catch { /* bad href */ }
    }
  }
  return undefined;
}

// Links on a homepage that probably lead to the station's apps page.
function appPageCandidates($: cheerio.CheerioAPI, base: string): string[] {
  const host = new URL(base).host.replace(/^www\./, '');
  const scored: { url: string; score: number }[] = [];
  $('a[href]').each((_, a) => {
    let u: URL;
    try { u = new URL($(a).attr('href')!, base); } catch { return; }
    if (u.host.replace(/^www\./, '') !== host || !/^https?:$/.test(u.protocol)) return;
    const text = $(a).text().replace(/\s+/g, ' ').trim().toLowerCase();
    const path = u.pathname.toLowerCase();
    let score = 0;
    // "app" anywhere in the address (e.g. /pbscltapp/, /apps/, /get-the-app), but not
    // "apple"/"application"; station streaming apps are often called "<station> Plus".
    if (/app(?![a-z])|apps(?![a-z])/.test(path) && !/appl/.test(path)) score += 3;
    if (/(^|\/)download/.test(path)) score += 2;
    if (/\bapps?\b/.test(text)) score += 2;
    if ((text.length <= 25 && /\bplus\b|\+$/.test(text)) || /plus(\/|$)/.test(path)) score += 2;
    if (/\bon the go\b|\bmobile\b/.test(text)) score += 2;
    if (/ways to (watch|stream)|watch anywhere|streaming|how to watch/.test(text)) score += 1;
    // Pages about the national PBS app, PBS KIDS, and unrelated sections.
    if (/getting-started|pbs-?app|pbs[-_ ]?kids|podcast|careers|privacy|apply|job/.test(path)) score -= 4;
    // News stories and blog posts aren't apps pages, even when they mention streaming.
    if (/\/(news|blogs?|articles?|stories|story)\/|\/20\d\d\//.test(path)) score -= 6;
    if (score <= 0) return;
    scored.push({ url: (u.hash = '', u.href), score });
  });
  return [...new Map(scored.sort((x, y) => y.score - x.score).map((s) => [s.url, s])).values()].slice(0, 4).map((s) => s.url);
}

function collectLinks($: cheerio.CheerioAPI, pageUrl: string, how: FoundLink['how'], into: FoundLink[]): void {
  $('a[href]').each((_, a) => {
    let href: string;
    try { href = cleanUrl(new URL($(a).attr('href')!, pageUrl).href); } catch { return; }
    const store = STORES.find((s) => s.test.test(href));
    if (!store || isExcluded(href)) return;
    href = canonicalStoreUrl(href);
    const own = [$(a).text(), $(a).attr('aria-label'), $(a).attr('title'), $(a).find('img').attr('alt')].filter(Boolean).join(' ');
    const near = $(a).closest('li, p, div').first().text().slice(0, 200);
    const { platform, confidence } = guessTv(store.platform, `${own} ${near}`);
    if (into.some((l) => storeKey(l.url) === storeKey(href) && l.platform === platform)) return;
    into.push({ platform, url: href, linkText: own.replace(/\s+/g, ' ').trim().slice(0, 80), foundOn: pageUrl, how, confidence });
  });
}

// Platforms a station's apps page names in its text, for pages with no store links.
// Only used on hand-listed apps pages, where the text is about the station's own app.
const MENTIONS: [Platform, RegExp][] = [
  ['ios', /\b(iphone|ipad|ios)\b/i],
  ['android', /\bandroid (phones?|tablets?|devices?|mobile)\b|google play/i],
  ['appletv', /\bapple ?tv\b/i],
  ['roku', /\broku\b/i],
  ['firetv', /\bfire ?tv\b|\bfire ?stick\b/i],
  ['androidtv', /\b(android|google) ?tv\b/i],
  ['samsung', /\bsamsung\b/i],
  ['lg', /\blg\b/i],
];
function mentionedPlatforms($: cheerio.CheerioAPI): Platform[] {
  const body = $('main').length ? $('main').first() : $('body');
  const copy = body.clone();
  copy.find('script, style, nav, header, footer').remove();
  const text = copy.text().replace(/\s+/g, ' ');
  return MENTIONS.filter(([, re]) => re.test(text)).map(([p]) => p);
}

// --- Main ------------------------------------------------------------------------

if (!existsSync(ORGS)) {
  console.error('fetch-station-app-pages: run npm run build-data first (needs organizations.json)');
  process.exit(1);
}
const orgs = JSON.parse(readFileSync(ORGS, 'utf8')) as { id: string; website?: string }[];
const manualPages = new Map(
  ((parse(readFileSync(join(MANUAL, 'station-app-pages.yaml'), 'utf8')) ?? []) as { id: string; appsPage?: string }[])
    .filter((p) => p.appsPage)
    .map((p) => [p.id, p.appsPage!]),
);

const results: StationAppLinks[] = [];
let n = 0;
for (const org of orgs) {
  const r: StationAppLinks = { id: org.id, retrievedAt: '', pagesRead: [], links: [], problems: [] };
  const read = async (url: string, file: string, how: FoundLink['how']) => {
    try {
      const page = await fetchCached('station-sites', `${org.id}/${file}.html`, url);
      r.retrievedAt = page.retrievedAt;
      r.pagesRead.push(page.url);
      const $ = cheerio.load(page.body);
      collectLinks($, page.url, how, r.links);
      return { $, url: page.url };
    } catch (err) {
      r.problems.push(err instanceof RobotsDisallowed ? `${url}: robots.txt disallows` : `${url}: ${(err as Error).message}`);
      return null;
    }
  };

  const manual = manualPages.get(org.id);
  if (manual) {
    const page = await read(manual, 'manual-page', 'manual-page');
    if (page && !r.links.some((l) => l.how === 'manual-page')) {
      for (const platform of mentionedPlatforms(page.$)) {
        r.links.push({ platform, url: page.url, linkText: '', foundOn: page.url, how: 'manual-page', confidence: 'high', kind: 'instructions' });
      }
    }
  }
  if (org.website) {
    const home = await read(org.website, 'home', 'homepage');
    if (home) {
      r.homepage = { requested: org.website, final: home.url };
      r.donate = bestLink(home.$, home.url, DONATE);
      r.livestream = bestLink(home.$, home.url, LIVESTREAM);
      const candidates = appPageCandidates(home.$, home.url).filter((u) => u !== manual);
      // Cached by address, so a re-run never reuses a different page's copy.
      for (const url of candidates) await read(url, `page-${new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}`, 'discovered-page');
    }
  }
  results.push(r);
  if (++n % 25 === 0) console.log(`  ${n}/${orgs.length} stations`);
}

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');

const withLinks = results.filter((r) => r.links.length);
console.log(`\nfetch-station-app-pages: ${results.length} stations, ${withLinks.length} with store links on their own site`);
for (const r of withLinks) {
  console.log(`  ${r.id.padEnd(40)} ${r.links.map((l) => l.platform + (l.confidence === 'low' ? '?' : '')).join(', ')}`);
}
const failed = results.filter((r) => r.problems.length);
if (failed.length) {
  console.log(`\n  pages that could not be read: ${failed.length}`);
  for (const r of failed) console.log(`    - ${r.id}: ${r.problems.join('; ')}`);
}
