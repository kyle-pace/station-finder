# Station App Finder — Claude Code instructions

Read `SPEC.md` before doing any work. It is the source of truth for what we're building and in what order.

## What this is
A public, neutral directory that helps anyone find their local public media station (PBS, NPR, independent) and every way to watch and listen: the station's own apps, website, livestream, and donate page, with national PBS/NPR apps as a fallback. Built and run by Local Public (a public benefit corporation) as a prototype.

The owner is Kyle (Director of Product, not a full-time engineer). Explain decisions in plain language, keep the codebase simple, and prefer boring, well-documented tools.

## Non-negotiable principles
- **Neutral.** Never rank, feature, or style Local Public partner stations differently in results. Order is relevance and distance only. Show every station's apps, whoever built them.
- **Station-first.** A station's own links come before national apps.
- **Privacy-first.** No cookies, no personal data, no third-party trackers. Analytics are cookieless and aggregate only (see SPEC).
- **No PBS KIDS.** Never link to PBS KIDS apps or content (pbskids.org, PBS KIDS store listings), in national fallbacks or station data.
- **No endorsement implied.** Use network names (PBS, NPR) as text only. No PBS/NPR logos.
- **Provenance.** Every data field records where it came from (`source`) and when (`retrievedAt`).

## Architecture rules
- Fully static site. No server, no database, no API keys at runtime.
- Data collection happens in scripts under `scripts/`, run at build time or by a scheduled GitHub Action, never in the browser.
- Pipeline: `scripts/fetch-*` → `data/raw/` (cached source dumps) → `scripts/build-data` → `public/data/*.json` (what the site reads).
- Hand-maintained files in `data/manual/` always win over scraped data. A pipeline re-run must never undo a manual fix.
- The repo is public. Never commit Local Public partner status. `data/private/` is git-ignored and must never be read by scripts.
- Scripts must be idempotent and safe to re-run.

## Scraping rules
- Prefer official/public-domain sources (FCC, Census) and openly licensed ones (Wikipedia, CC BY-SA, attribute in the footer).
- Respect robots.txt, rate-limit (≥1s between requests to the same host), set a descriptive User-Agent, and cache raw responses in `data/raw/`.
- Do not scrape Google Play or the Roku/Amazon/Samsung/LG stores. Those links come from `data/manual/` or the station's own website.
- Before relying on a source URL or file format, verify it is current. Don't hardcode download locations from memory.

## Working style
- Plan before building each phase; show the plan and wait for approval.
- Work in small steps and commit after each working step with a clear message.
- Ask before adding a new dependency or service.
- After changes, run the build and check the result in the browser before saying a step is done.
- Keep `README.md` current: how to run the site, refresh data, and edit manual files.
