# Anonymous counter: setup (about 10 minutes)

The site counts a few anonymous events (SPEC.md section 8) into a Google Sheet. It's off
until the Sheet's web app URL is pasted into `src/lib/site.ts`.

1. Create a new Google Sheet (any name, e.g. "Station App Finder counts").
2. In the Sheet: **Extensions → Apps Script**. Delete what's there and paste the whole of
   `counter/google-apps-script.gs`. Save.
3. **Project Settings** (gear icon): set the time zone you want days counted in.
4. **Deploy → New deployment** → type **Web app**:
   - Description: `counter`
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click Deploy, approve the permissions (it only edits this Sheet), and copy the
   **Web app URL** (ends in `/exec`).
5. Paste that URL into `COUNTER_URL` in `src/lib/site.ts`, commit, push.
6. Check: open the site, search a ZIP, click an app link. Within a minute the Sheet gets a
   `counts` tab with rows like `2026-10-20 · search · zip · 4+ · 981 · phone · 1`.

## Weekly email (optional, about 3 minutes)

Every Monday at 8am you get an email summing up the last 7 days: page views, searches,
no-station searches and clicks (with the change from the week before), plus the top
stations, platforms and no-station areas. It goes to whoever owns the script. Numbers
under 10 show as "fewer than 10", so it's safe to forward.

1. In the Apps Script editor, click **+** next to Files → **Script**, name it
   `weekly-email`, and paste the whole of `counter/weekly-email.gs`. Save.
2. In the function menu at the top, pick `sendWeeklyEmail` and click **Run**. Google asks
   for one new permission (send email as you); approve it. You should get a test email.
3. Pick `installWeeklyEmail` and click **Run**. That's it; it now runs every Monday.

To stop it, run `removeWeeklyEmail`. No redeploy is needed: the email doesn't touch the
web app URL.

## What's stored

One row per day per combination of allowed fields, with a count. Never individual events,
IP addresses, cookies, IDs, search text, full ZIP codes, or precise times. Visitors with
Do Not Track or Global Privacy Control on send nothing.

## Reporting rule

Never show, export, or share a number under 10 (small-number suppression). Totals per
station are fine; drill-downs below 10 get reported as "fewer than 10".

## Caveats

- Ad blockers stop some events, so counts are a floor, not exact.
- The endpoint is public: anyone could send fake counts. Fine for a prototype; production
  moves this to the production platform.
- Google hosts the script, so its servers see requests like any web host; the script itself
  never receives or stores IP addresses.
- After editing the script, use **Deploy → Manage deployments → Edit → New version** so the
  same URL keeps working.
