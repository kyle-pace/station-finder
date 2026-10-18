// Shared helpers for reading Wikipedia article pages (station infoboxes and network
// transmitter tables). Only ordinary /wiki/ pages are fetched; robots.txt disallows
// Wikipedia's /w/ and /api/ paths. Used by fetch-wikipedia (PBS) and fetch-wikipedia-npr.

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { fetchCached } from './fetch.ts';

export const WIKI = 'https://en.wikipedia.org/wiki/';

export interface Coords { lat: number; lng: number }

export interface InfoboxFields {
  title: string;          // article title after redirects
  requested?: string;     // the title we linked to (differs when Wikipedia redirected)
  url: string;
  callSigns?: string[];   // from the infobox caption, e.g. "KAWE and KAWB"
  retrievedAt: string;
  branding?: string;
  owner?: string;
  website?: string;
  facilityId?: number;
  coords?: Coords;
  frequency?: string;     // radio, e.g. "94.9 MHz"
}

export interface NetworkTransmitter {
  callSign: string;
  city?: string;
  facilityId?: number;
  coords?: Coords;
}


export const clean = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

export function titleFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
}

export function parseGeo(text: string): Coords | undefined {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

// --- Article pages ---------------------------------------------------------------

export function parseInfobox($: CheerioAPI, url: string, retrievedAt: string): InfoboxFields {
  // Wikipedia serves redirects in place (no HTTP redirect), so the canonical link is the
  // only reliable way to know which article we actually got (e.g. KQET → KQED).
  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical?.startsWith(WIKI)) url = canonical;
  const fields: InfoboxFields = { title: titleFromUrl(url), url, retrievedAt };
  const box = $('table.infobox').first();
  const captionCalls = [...clean(box.find('caption').first().text()).matchAll(/\b[KW][A-Z]{2,3}(?:-(?:TV|DT|CD|LD|FM|AM))?\b/g)].map((m) => m[0]);
  if (captionCalls.length) fields.callSigns = captionCalls;
  box.find('tr').each((_, tr) => {
    const label = clean($(tr).children('th').first().text()).toLowerCase();
    const td = $(tr).children('td').first();
    if (!label || !td.length) return;
    const value = clean(td.text());
    if (label === 'branding' && value) fields.branding = value;
    else if (label === 'frequency' && value) fields.frequency = value;
    else if ((label === 'owner' || label === 'licensee') && value && !fields.owner) fields.owner = value;
    else if (label.includes('website')) {
      const href = td.find('a.external, a[href^="http"]').first().attr('href');
      if (href) fields.website = href;
    } else if (label.startsWith('facility id')) {
      const id = Number(value.match(/\d+/)?.[0]);
      if (id) fields.facilityId = id;
    } else if (label.includes('coordinates')) {
      const geo = td.find('.geo').first().text();
      const c = parseGeo(geo);
      if (c) fields.coords = c;
    }
  });
  return fields;
}

// A network article's transmitter table has "Facility ID" and "coordinates" columns.
export function parseTransmitterTable($: CheerioAPI): NetworkTransmitter[] {
  const out: NetworkTransmitter[] = [];
  $('table.wikitable').each((_, table) => {
    const header = $(table).find('tr').first().children().toArray().map((c) => clean($(c).text()).toLowerCase());
    // Header wording varies: "Facility ID", "FID", "FIDTooltip Facility ID", "FCCFacility ID".
    const idCol = header.findIndex((h) => /^(fcc\s*)?(facility id|fid)/.test(h));
    const geoCol = header.findIndex((h) => h.includes('coordinates'));
    const cityCol = header.findIndex((h) => h.startsWith('city'));
    const callCol = Math.max(0, header.findIndex((h) => /^(station|call ?sign)/.test(h)));
    if (idCol < 0 || geoCol < 0) return;
    // Main TV transmitters only: skip radio tables ("Frequency") and translator tables.
    if (header.some((h) => h.startsWith('frequency') || h.startsWith('translating'))) return;
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).children('td, th').toArray();
      // Rows with rowspan'd cells are shorter than the header; skip rather than misread.
      if (cells.length !== header.length) return;
      const callSign = clean($(cells[callCol]).text()).split(' ')[0];
      if (!/^[KW][A-Z0-9-]{2,}/.test(callSign)) return;
      out.push({
        callSign,
        city: cityCol >= 0 ? clean($(cells[cityCol]).text()) : undefined,
        facilityId: Number(clean($(cells[idCol]).text()).match(/\d+/)?.[0]) || undefined,
        coords: parseGeo($(cells[geoCol]).find('.geo').first().text()),
      });
    });
  });
  return out;
}

export const fileFor = (title: string) => `articles/${title.replace(/[^A-Za-z0-9._()-]+/g, '_')}.html`;

export async function fetchArticle(title: string, url: string) {
  const page = await fetchCached('wikipedia', fileFor(title), url);
  const $ = cheerio.load(page.body);
  return { $, info: { ...parseInfobox($, page.url, page.retrievedAt), requested: title } };
}

