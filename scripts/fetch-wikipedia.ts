// fetch-wikipedia: downloads the Wikipedia "List of PBS member stations" article and
// every station/network article it links to, then extracts the fields we use into
// data/raw/wikipedia/pbs-extracted.json.
//
// Only ordinary /wiki/ article pages are read: Wikipedia's robots.txt disallows the
// /w/ and /api/ paths. Requests go one at a time, 1.5s apart (see lib/fetch.ts), so a
// full run takes a few minutes. Re-runs reuse the cached pages; pass --refresh to
// download them again.
//
// Run with: npm run fetch-wikipedia

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { fetchCached, RobotsDisallowed } from './lib/fetch.ts';
import { WIKI, clean, titleFromUrl, fetchArticle, parseTransmitterTable, type InfoboxFields, type NetworkTransmitter } from './lib/wikipedia.ts';

export type { InfoboxFields, NetworkTransmitter } from './lib/wikipedia.ts';

const LIST_TITLE = 'List_of_PBS_member_stations';
const OUT = new URL('../data/raw/wikipedia/pbs-extracted.json', import.meta.url).pathname;

// Call sign article titles look like "KUAC-TV", "WSIU-TV", "KQED (TV)", "WGBH-TV".
const CALLSIGN_TITLE = /^([KW][A-Z]{2,3}(?:-(?:TV|DT|CD|LD))?)(?: \((?:TV|TV station)\))?$/;

export interface ExtractedRow {
  label: string;             // text of the station cell, e.g. "Alaska Public Media (KAKM)"
  city: string;              // "City or region served"
  state: string;
  channel: string;
  notes: string;
  links: { title: string; url: string; isCallSign: boolean }[];
  primary?: InfoboxFields;   // network article, or the first station article
  stations: InfoboxFields[]; // one per linked call-sign article
  transmitters: NetworkTransmitter[]; // from a network article's station table
  problems: string[];
}

// --- The list article ------------------------------------------------------------

function parseList($: CheerioAPI): Omit<ExtractedRow, 'primary' | 'stations' | 'transmitters'>[] {
  const table = $('table.wikitable').first();
  const rows: Omit<ExtractedRow, 'primary' | 'stations' | 'transmitters'>[] = [];
  // City and state cells can span several rows (rowspan), so a row may have 0, 1, or 2
  // cells before the station cell. Track how many rows each span still covers.
  let city = '';
  let cityRowsLeft = 0;
  let state = '';
  let stateRowsLeft = 0;
  table.find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).children('td, th').toArray();
    const thIndex = cells.findIndex((c) => c.tagName === 'th');
    if (thIndex < 0) return;
    const before = cells.slice(0, thIndex);
    const after = cells.slice(thIndex + 1);
    const take = (cell: (typeof cells)[number]) => ({ text: clean($(cell).text()), span: Number($(cell).attr('rowspan') ?? 1) });
    const needCity = cityRowsLeft <= 0;
    const needState = stateRowsLeft <= 0;
    const problems: string[] = [];
    const queue = [...before];
    if (needCity && queue.length) ({ text: city, span: cityRowsLeft } = take(queue.shift()!));
    if (needState && queue.length) ({ text: state, span: stateRowsLeft } = take(queue.shift()!));
    if (queue.length) problems.push(`unexpected extra cell before station: ${clean($(queue[0]).text())}`);
    cityRowsLeft--;
    stateRowsLeft--;
    const th = $(cells[thIndex]);
    const links = th.find('a[href]').toArray().flatMap((a) => {
      const href = $(a).attr('href') ?? '';
      const url = new URL(href, WIKI).href.replace(/#.*$/, '');
      if (!url.startsWith(WIKI)) return []; // red links point at /w/index.php — skip
      const title = titleFromUrl(url);
      return [{ title, url, isCallSign: CALLSIGN_TITLE.test(title) }];
    });
    rows.push({
      label: clean(th.text()),
      city,
      state,
      channel: after[0] ? clean($(after[0]).text()) : '',
      notes: after[1] ? clean($(after[1]).text()) : '',
      links,
      problems,
    });
  });
  return rows;
}

// --- Main ------------------------------------------------------------------------

const list = await fetchCached('wikipedia', `${LIST_TITLE}.html`, WIKI + LIST_TITLE);
const listRows = parseList(cheerio.load(list.body));
console.log(`List: ${listRows.length} rows (${list.fromCache ? 'cached' : 'downloaded'} ${list.retrievedAt})`);

const results: ExtractedRow[] = [];
let done = 0;
for (const row of listRows) {
  const out: ExtractedRow = { ...row, stations: [], transmitters: [] };
  const network = row.links.find((l) => !l.isCallSign);
  try {
    if (network) {
      const { $, info } = await fetchArticle(network.title, network.url);
      out.primary = info;
      out.transmitters = parseTransmitterTable($);
    }
    for (const link of row.links.filter((l) => l.isCallSign)) {
      const { $, info } = await fetchArticle(link.title, link.url);
      // A "network" link and a call-sign link can redirect to the same article.
      if (!out.stations.some((s) => s.url === info.url)) out.stations.push(info);
      // Some station articles cover several transmitters in a table (e.g. WSEC/WMEC/WQEC).
      for (const t of parseTransmitterTable($)) {
        if (!out.transmitters.some((x) => x.callSign === t.callSign)) out.transmitters.push(t);
      }
    }
    if (!out.primary) out.primary = out.stations[0];
    if (!out.primary) out.problems.push('no linked article');
  } catch (err) {
    if (err instanceof RobotsDisallowed) out.problems.push(err.message);
    else out.problems.push(`fetch failed: ${(err as Error).message}`);
  }
  results.push(out);
  if (++done % 20 === 0) console.log(`  ${done}/${listRows.length} rows`);
}

mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    { source: WIKI + LIST_TITLE, retrievedAt: list.retrievedAt, license: 'CC BY-SA 4.0', rows: results },
    null,
    2,
  ) + '\n',
);

const problems = results.filter((r) => r.problems.length);
console.log(`\nfetch-wikipedia: ${results.length} rows extracted to data/raw/wikipedia/pbs-extracted.json`);
console.log(`  rows with a problem: ${problems.length}`);
for (const r of problems) console.log(`    - ${r.label}: ${r.problems.join('; ')}`);
