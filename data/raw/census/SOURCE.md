# Census ZCTA Gazetteer (manual download)

- File: 2026_Gaz_zcta_national.zip (ZIP Code Tabulation Areas, internal point lat/lng)
- URL: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_zcta_national.zip
- Downloaded by hand once on 2026-10-18 (single request), per Kyle's decision: the
  www2.census.gov robots.txt, read strictly, groups "User-agent: *" with blocked bots,
  so no script ever fetches it. Refresh by hand when a new year's Gazetteer is out.
- License: U.S. Census Bureau data, public domain.
- The raw .zip/.txt are not committed (gitignored); scripts/build-zcta.ts turns the
  local copy into data/raw/census/zcta.json, which is committed.
