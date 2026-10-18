# Station App Finder — Prototype Spec

**Owner:** Kyle Pace, Local Public · **Status:** Draft v0.1 · **Site name/domain:** TBD (working name "Station App Finder")

## 1. Goal
Help anyone in the US find their local public media station and every way to watch and listen to it, in under 30 seconds.

**For viewers:** one search (ZIP, city, station name, or call letters) → their stations → the right app for their device.
**For stations:** more traffic to their own apps, site, livestream, and donate page, with proof (UTM-tagged links).
**For Local Public:** credibility as public media infrastructure, aggregate audience insight (which markets, which platforms), and warm signals about stations without apps.

## 2. v1 scope
In:
- Search by ZIP, city/state, station name, call letters
- Results: nearby stations sorted by distance, plus a national fallback block (PBS and NPR apps) on every result
- Station page with apps by platform, website, livestream, donate, and "suggest a correction"
- State browse pages (also good for SEO)
- Device-aware calls to action
- About page (who built it, why, data sources, how to correct)
- Cookieless analytics

Out (later): station claim/edit accounts, embeddable badge/widget, FCC coverage contours, NPR/PBS API integrations, multilingual.

## 3. Data model
Model **organizations** (the station people know, e.g. a statewide network) separately from **facilities** (individual transmitters/licenses). One organization often has many transmitters; ZIP search finds nearby facilities, then rolls up to their organizations.

`public/data/organizations.json`
```json
{
  "id": "kxyz",
  "name": "KXYZ",
  "networks": ["PBS"],
  "mediaTypes": ["tv"],
  "city": "Exampleville",
  "state": "OR",
  "website": "https://...",
  "donateUrl": "https://...",
  "livestreamUrl": "https://...",
  "apps": [
    { "platform": "ios", "url": "https://apps.apple.com/...", "source": "manual", "verified": true }
  ],
  "facilityIds": ["fcc-12345"],
  "sources": { "website": { "source": "wikipedia", "retrievedAt": "2026-10-18" } }
}
```
`platform` values: `ios`, `android`, `appletv`, `firetv`, `androidtv`, `roku`, `samsung`, `lg`, `web`.

`public/data/facilities.json`: `{ id, callSign, service: "tv"|"fm"|"am", city, state, lat, lng, organizationId, source }`

ZIP lookup: Census ZCTA centroids, sharded by 3-digit ZIP prefix (`public/data/zip/981.json`) so the browser only loads a few KB per search.

**No partner flag anywhere in the repo.** The repo is public, so Local Public partner status is not stored in it at all. Hand-verified app links for any station go in `data/manual/station-apps.yaml`, which records apps only. Kyle's private partner notes live in `data/private/` (git-ignored, never read by the build).

## 4. Data sources and pipeline
| Data | Source | Notes |
|---|---|---|
| Transmitters, call letters, coordinates | FCC licensing data (noncommercial educational TV and FM) | Public domain. Verify the current download location. |
| Network affiliation, station names, websites | Wikipedia lists of PBS member stations and NPR member stations | CC BY-SA; attribute in footer. |
| ZIP → lat/lng | Census ZCTA Gazetteer file | Public domain. |
| iOS apps (stations not in station-apps.yaml) | Apple iTunes Search API (no key) | Keep only matches that pass a name/developer check; mark `verified: false` until reviewed. |
| Hand-verified station apps (all 9 platforms) | `data/manual/station-apps.yaml` | Hand-maintained by Kyle; any station, no partner flag. |
| Other stores (Play, TV platforms) | Manual, or the station's own website | Do not scrape the stores. |
| Corrections | `data/manual/overrides.yaml` | Always wins. |
| National fallbacks | `data/manual/national.yaml` | PBS and NPR app links. No PBS KIDS. |

Pipeline: `scripts/fetch-fcc`, `fetch-wikipedia`, `fetch-zcta`, `match-ios-apps` → `data/raw/` → `scripts/build-data` merges, applies manual files last, validates, and writes `public/data/`. `build-data` prints a report covering counts, organizations with no apps, unmatched facilities, and low-confidence matches.

Refresh: a monthly GitHub Action runs the pipeline and opens a pull request with the data diff for Kyle to review. It never auto-publishes.

## 5. Search logic
1. Input looks like 5 digits → ZIP: load the shard, get the centroid, find facilities within 75 mi (TV) / 50 mi (radio), roll up to organizations, and sort by nearest facility.
2. Call letters (e.g. "KCTS", "KUOW-FM") → exact facility match → its organization.
3. Otherwise → fuzzy match on organization name, city, state.
4. Always show the national fallback block below results.
5. Empty state: suggest nearby states and the national apps.

Search runs client-side over static JSON (e.g. a small fuzzy-search library).

## 6. Pages
- `/` Hero search plus a short explanation
- `/search?q=` Results
- `/station/[id]` Station page: app buttons grouped by Phone & tablet / TV / Web, plus website, livestream, donate, and correction link
- `/state/[st]` All stations in a state
- `/about` Who built it (Local Public, a public benefit corporation), why, data sources and licenses, neutrality principles, how to correct

**Device-aware calls to action:** detect iOS/Android client-side and promote the matching store button first. For TV platforms, show "Search for [station] on your Roku/Fire TV/…" with the store link when known.

## 7. Station benefit and measurement
- UTM-tag outbound links to station websites, livestreams, and donate pages: `utm_source=<site>&utm_medium=referral&utm_campaign=station-finder`. Don't tag app store links.
- Correction link opens a simple form (a Google Form is fine for v1) prefilled with the station id.

## 8. Analytics (cookieless)
Use Plausible or Fathom (ask Kyle which). Custom events:
- `search`: input type (zip/name/callsign), result count, ZIP **3-digit prefix only**
- `outbound_click`: organization id, link type (app/web/donate/livestream), platform
- `no_results`

No IPs, full ZIPs, or identifiers stored by us.

## 9. Tech
- Astro (static output) + TypeScript; minimal CSS, accessible (WCAG AA), fast on mobile
- Node/TypeScript scripts for the data pipeline
- GitHub for the repo; GitHub Pages for hosting the prototype (static, deploys on push via GitHub Actions)

## 10. Phases
1. **Scaffold:** Astro project, README, folder structure, manual data files, deploy a "hello" page.
2. **TV data:** FCC TV facilities + Wikipedia PBS list + station-apps.yaml → organizations/facilities JSON with a build report.
3. **Search and pages:** ZIP shards, search, results, station and state pages, national fallback.
4. **Ship v0:** about page, analytics, UTM tagging, correction form, deploy publicly.
5. **Radio:** FCC FM + Wikipedia NPR list.
6. **iOS matching:** iTunes Search API with review report.
7. **Refresh automation:** monthly GitHub Action PR.

## 11. Open questions for Kyle
- Site name and domain (neutral brand vs Local Public-branded)?
- Analytics: Plausible or Fathom?
- Correction intake: Google Form, or email to start?
- Include independent/non-network public stations in v1, or PBS + NPR only?
- PBS KIDS block: should it also cover stations' own PBS KIDS pages, or only national PBS KIDS (pbskids.org and its apps)? For now the build blocks anything with "pbs-kids"/"pbskids" in the link.
