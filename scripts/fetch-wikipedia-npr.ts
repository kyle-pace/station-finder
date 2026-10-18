// fetch-wikipedia-npr: downloads Wikipedia's "List of NPR stations" and each station's
// article, then extracts the fields we use into data/raw/wikipedia/npr-extracted.json.
//
// Same rules as fetch-wikipedia: only /wiki/ article pages, one request at a time, 1.5s
// apart, cached in data/raw/ (re-runs are fast; --refresh downloads again). The first
// full run reads about 1,000 articles, so it takes roughly 25–30 minutes.
//
// Run with: npm run fetch-wikipedia-npr

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { fetchCached, RobotsDisallowed } from './lib/fetch.ts';
import { WIKI, clean, titleFromUrl, fetchArticle, type InfoboxFields } from './lib/wikipedia.ts';

const LIST_TITLE = 'List_of_NPR_stations';
const OUT = new URL('../data/raw/wikipedia/npr-extracted.json', import.meta.url).pathname;

export interface NprRow {
  callSign: string;
  frequency: string; // "90.3"
  band: 'FM' | 'AM' | string;
  city: string;      // city of license
  state: string;
  link?: { title: string; url: string };
  station?: InfoboxFields;
  problems: string[];
}

// The article has one table per state; the state name is in the table's first row.
function parseList($: cheerio.CheerioAPI): NprRow[] {
  const rows: NprRow[] = [];
  $('table.wikitable').each((_, table) => {
    const trs = $(table).find('tr').toArray();
    const state = clean($(trs[0]).text()).replace(/\[edit\]$/i, '').trim();
    for (const tr of trs.slice(1)) {
      const cells = $(tr).children('td, th').toArray();
      const th = cells.find((c) => c.tagName === 'th');
      if (!th || cells.length < 4) continue;
      const tds = cells.filter((c) => c !== th);
      const a = $(th).find('a[href]').first();
      let link: NprRow['link'];
      if (a.length) {
        const url = new URL(a.attr('href')!, WIKI).href.replace(/#.*$/, '');
        if (url.startsWith(WIKI)) link = { title: titleFromUrl(url), url }; // skip red links (/w/index.php)
      }
      rows.push({
        callSign: clean($(th).text()).split(' ')[0],
        frequency: clean($(tds[0]).text()),
        band: clean($(tds[1]).text()).toUpperCase(),
        city: clean($(tds[2]).text()),
        state,
        link,
        problems: link ? [] : ['no article link'],
      });
    }
  });
  return rows;
}

const list = await fetchCached('wikipedia', `${LIST_TITLE}.html`, WIKI + LIST_TITLE);
const rows = parseList(cheerio.load(list.body));
const titles = new Set(rows.flatMap((r) => (r.link ? [r.link.title] : [])));
console.log(`List: ${rows.length} stations, ${titles.size} articles (${list.fromCache ? 'cached' : 'downloaded'} ${list.retrievedAt})`);

// Fetch each article once (several rows can share one), then attach it to its rows.
const byTitle = new Map<string, InfoboxFields>();
const failed = new Map<string, string>();
let done = 0;
for (const row of rows) {
  if (!row.link || byTitle.has(row.link.title) || failed.has(row.link.title)) continue;
  try {
    const { info } = await fetchArticle(row.link.title, row.link.url);
    byTitle.set(row.link.title, info);
  } catch (err) {
    failed.set(row.link.title, err instanceof RobotsDisallowed ? err.message : `fetch failed: ${(err as Error).message}`);
  }
  if (++done % 50 === 0) console.log(`  ${done}/${titles.size} articles`);
}
for (const row of rows) {
  if (!row.link) continue;
  row.station = byTitle.get(row.link.title);
  const problem = failed.get(row.link.title);
  if (problem) row.problems.push(problem);
}

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: WIKI + LIST_TITLE, retrievedAt: list.retrievedAt, license: 'CC BY-SA 4.0', rows }, null, 2) + '\n');

const withCoords = rows.filter((r) => r.station?.coords).length;
console.log(`\nfetch-wikipedia-npr: ${rows.length} stations → data/raw/wikipedia/npr-extracted.json`);
console.log(`  with coordinates: ${withCoords}   with website: ${rows.filter((r) => r.station?.website).length}`);
console.log(`  with a problem: ${rows.filter((r) => r.problems.length).length}`);
