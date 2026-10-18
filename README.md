# Station App Finder

A public, neutral directory that helps anyone in the US find their local public media
station (PBS, NPR, and independent) and every way to watch and listen: the station's own
apps, website, livestream, and donate page, with national PBS/NPR apps as a fallback.

A prototype by [Local Public](https://localpublic.tv), a public benefit corporation.
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
| `npm run build-data` | Checks the files in `data/manual/` and regenerates `public/data/` |
| `npm run build` | Runs `build-data`, type-checks, and builds the finished site into `dist/` |
| `npm run preview` | Serves the built `dist/` site locally, exactly as it will be published |

## Publishing

Every push to `main` builds the site and publishes it to GitHub Pages
(see `.github/workflows/deploy.yml`). Progress and errors show in the repo's **Actions** tab.
If a build fails, nothing is published and the previous version stays live.

## How the data works

```
scripts/fetch-*   →  data/raw/        cached copies of public sources (FCC, Wikipedia, Census)
data/manual/      →                   hand-maintained files; always win over scraped data
scripts/build-data → public/data/     the JSON the site reads
```

Today (Phase 1) only the manual files exist. Station data (FCC + Wikipedia) arrives in
Phase 2; the fetch scripts and data-refresh instructions will be added here then.

## Editing the manual files

All three files live in `data/manual/`. Each has instructions and an example at the top.
After editing, run `npm run build-data`: it lists any problems in plain English and
stops before anything broken is published.

| File | What goes in it |
|---|---|
| `national.yaml` | The PBS and NPR app links shown below every result. |
| `station-apps.yaml` | Hand-checked app links for any station (all 9 platforms). |
| `overrides.yaml` | Corrections to any station field. Always wins, even after a data refresh. |

Every link needs a `source` (where you found it) and a `retrievedAt` date.

**This repo is public.** Don't record which stations work with Local Public anywhere in it.
`station-apps.yaml` lists apps only, for any station. Private notes can go in
`data/private/`, which git ignores and the build never reads.

## Principles

Neutral (no station is ranked or styled differently), station-first, privacy-first (no
cookies, no personal data, no third-party trackers), no PBS/NPR logos, and every data field
records its source. Details in [CLAUDE.md](CLAUDE.md).

## Data sources and licenses

- FCC licensing data and U.S. Census ZCTA files: public domain.
- Wikipedia station lists: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/),
  attributed in the site footer.
