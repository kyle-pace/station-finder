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

## Weekly Slack summary (optional, about 5 minutes)

Every Monday at 8am a Slack message sums up the last 7 days: page views, searches,
no-station searches and clicks (with the change from the week before), plus the top
stations, platforms and no-station areas. Numbers under 10 show as "fewer than 10".

1. **Make a Slack webhook.** Go to https://api.slack.com/apps → **Create New App** →
   **From scratch**, name it `Find My Station`, pick your workspace. Open
   **Incoming Webhooks**, switch it on, click **Add New Webhook**, and pick where it posts
   (your own name for a DM to yourself, or a channel). Copy the URL
   (`https://hooks.slack.com/services/...`). Your workspace may need an admin to approve
   the app. Keep the URL private: anyone with it can post there.
2. **Give it to the script.** In the Apps Script editor: **Project Settings** (gear) →
   **Script Properties** → **Add script property**: name `SLACK_WEBHOOK_URL`, value the
   URL. Save. (It lives there, never in the repo.)
3. **Add the code.** Click **+** next to Files → **Script**, name it `weekly-slack`, paste
   the whole of `counter/weekly-slack.gs`. Save.
4. **Test.** In the function menu at the top pick `sendWeeklySlack` → **Run**. Approve the
   one new permission (connect to an external service). A message should appear in Slack.
5. **Turn it on.** Pick `installWeeklySlack` → **Run**. It now posts every Monday.

To stop it, run `removeWeeklySlack`. No redeploy is needed: it doesn't touch the web app
URL.

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
