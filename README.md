# Station App Finder

A public, neutral directory that helps anyone in the US find their local public media
station (PBS, NPR, and independent) and every way to watch and listen: the station's own
apps, website, livestream, and donate page, with national PBS/NPR apps as a fallback.

An independent prototype.
See [SPEC.md](SPEC.md) for what we're building and in what order.

**Live prototype:** https://kyle-pace.github.io/station-finder/

## Run it on your computer

You need [Node.js](https://nodejs.org/) 26 (see `.nvmrc`).

```sh
npm install        # once, or after pulling changes to package.json
npm run dev        # starts a local site at http://localhost:4321/station-finder/
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build-data` | Checks the files in `data/manual/` and regenerates `public/data/` from the cached sources |
| `npm run refresh-data` | Downloads fresh source data, then rebuilds (see below) |
| `npm run build` | Runs `build-data`, type-checks, and builds the finished site into `dist/` |
| `npm run preview` | Serves the built `dist/` site locally, exactly as it will be published |

## What's on the site

| Page | What it shows |
|---|---|
| `/` | Search box, "Use my location", how it works, all states |
| `/search/?q=…` | Results: ZIP (stations within 75 miles, nearest first), call letters, or name/city/state |
| `/station/<id>/` | One station: watch live, donate, website, apps by Phone & tablet / TV / Web, correction link |
| `/state/` and `/state/<st>/` | Every station in a state, A–Z |
| `/about/` | Who built it, principles, data sources and licenses, privacy |

Search runs in the visitor's browser over `public/data/search.json` and one small ZIP
file per search (`public/data/zip/981.json`); nothing typed is sent to a server. The
browser picks out the visitor's device (iPhone/iPad, Android, or computer) to highlight
the matching app link. All stations look the same, whoever built their apps.

## Publishing

Every push to `main` builds the site and publishes it to GitHub Pages
(see `.github/workflows/deploy.yml`). Progress and errors show in the repo's **Actions** tab.
If a build fails, nothing is published and the previous version stays live.

## How the data works

```
scripts/fetch-wikipedia          →  data/raw/wikipedia/pbs-extracted.json
scripts/fetch-station-app-pages  →  data/raw/station-sites/app-links.json
data/manual/*.yaml                  hand-maintained; always applied last, so they win
scripts/build-data               →  public/data/organizations.json, facilities.json, national.json
                                    + data/build-report.txt (what to review)
```

- **Stations (PBS only for now)** come from Wikipedia's "List of PBS member stations"
  and each station's article: name, owner, website, and transmitter coordinates.
  We read only ordinary article pages; Wikipedia's robots.txt disallows its API paths.
  We do not download FCC files (the FCC site's robots.txt disallows it).
- **App links** come only from each station's own website: its homepage, any page it
  links to that looks like an apps page, and known pages in `station-app-pages.yaml`.
  We never scrape the app stores. Links found automatically are marked unverified
  until a person checks them.
- Every value records where it came from (`source`) and when (`retrievedAt`).

### Refreshing the data

```sh
npm run refresh-data   # about 10 minutes; downloads politely, one request at a time
```

This runs, in order: `fetch-wikipedia`, `build-data`, `fetch-station-app-pages`,
`build-data`. Downloaded pages are cached in `data/raw/` (not committed), so re-runs are
fast. Add `-- --refresh` to a fetch script to download fresh copies.

ZIP-code locations come from a Census file that is downloaded **by hand** (see
`data/raw/census/SOURCE.md` for why); after replacing it, run `npm run build-zcta`.

Then read `data/build-report.txt`. It lists stations with no coordinates, merged rows,
websites that moved, and app links that need a human check. `npm run build-data -- --full`
prints the whole report, including every station's id.

## Editing the manual files

All manual files live in `data/manual/`. Each has instructions and an example at the top.
After editing, run `npm run build-data`: it lists any problems in plain English and
stops before anything broken is published.

| File | What goes in it |
|---|---|
| `national.yaml` | The PBS and NPR app links shown below every result. |
| `station-app-pages.yaml` | A station's own "get our app" page (when the automatic search misses it) and its web app. |
| `station-apps.yaml` | Hand-checked app links for any station (all 9 platforms), and `exclude:` for wrong links. |
| `merges.yaml` | Fold a relay/satellite station into the station viewers know. |
| `overrides.yaml` | Corrections to any station field, including its id. Always wins, even after a refresh. |

Every link needs a `source` (where you found it) and a `retrievedAt` date.

**This repo is public.** Don't record partner relationships or the publishing organization's name anywhere in it.
Manual files list apps and pages only, for any station. Private notes can go in
`data/private/`, which git ignores and the build never reads.

## Principles

Neutral (no station is ranked or styled differently), station-first, privacy-first (no
cookies, no personal data, no third-party trackers), no PBS/NPR logos, and every data field
records its source. Details in [CLAUDE.md](CLAUDE.md).

## Data sources and licenses

- U.S. Census ZCTA files (Phase 3): public domain.
- Wikipedia station lists: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),
  attributed in the site footer.
