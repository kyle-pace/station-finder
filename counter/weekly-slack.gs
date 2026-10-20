/**
 * Find My Station: weekly Slack summary (Google Apps Script, same project as the counter).
 *
 * Every Monday morning, posts a short summary of the last 7 days from the `counts` tab to
 * Slack, compared with the 7 days before. It only reads the daily totals the counter
 * already keeps; it adds nothing new to what's collected. Any number under 10 is shown as
 * "fewer than 10" (the reporting rule in counter/SETUP.md).
 *
 * The Slack webhook URL is kept in Project Settings → Script Properties as
 * SLACK_WEBHOOK_URL, never in this file (the repo is public).
 *
 * Setup: see "Weekly Slack summary" in counter/SETUP.md.
 */

var POST_DAY = ScriptApp.WeekDay.MONDAY;
var POST_HOUR = 8; // in the script's time zone (Project Settings)
var TOP_N = 5;

// Run once from the editor to turn the weekly post on. Safe to run again.
function installWeeklySlack() {
  removeWeeklySlack();
  ScriptApp.newTrigger('sendWeeklySlack').timeBased().onWeekDay(POST_DAY).atHour(POST_HOUR).create();
}

// Run from the editor to turn it off.
function removeWeeklySlack() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklySlack') ScriptApp.deleteTrigger(t);
  });
}

function sendWeeklySlack() {
  var webhook = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!webhook) throw new Error('Add SLACK_WEBHOOK_URL in Project Settings → Script Properties first.');
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName('counts');
  if (!sheet) return;
  var rows = sheet.getDataRange().getValues().slice(1);

  var tz = Session.getScriptTimeZone();
  var dayKey = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var now = new Date();
  var daysAgo = function (n) { return dayKey(new Date(now.getTime() - n * 86400000)); };
  // "This week" is the 7 full days before today; "last week" the 7 before that.
  var thisStart = daysAgo(7), lastStart = daysAgo(14), end = daysAgo(0);

  var week = { pageview: 0, search: 0, no_results: 0, outbound_click: 0 };
  var prev = { pageview: 0, search: 0, no_results: 0, outbound_click: 0 };
  var stations = {}, platforms = {}, areas = {};
  rows.forEach(function (r) {
    var date = r[0] instanceof Date ? dayKey(r[0]) : String(r[0]);
    var event = r[1], n = Number(r[10]) || 0;
    if (date >= thisStart && date < end) {
      if (event in week) week[event] += n;
      if (event === 'outbound_click') { add_(stations, r[3], n); add_(platforms, r[5], n); }
      if (event === 'no_results' && r[8]) add_(areas, r[8], n);
    } else if (date >= lastStart && date < thisStart) {
      if (event in prev) prev[event] += n;
    }
  });

  var label = Utilities.formatDate(new Date(now.getTime() - 7 * 86400000), tz, 'MMM d') + ' to ' +
              Utilities.formatDate(new Date(now.getTime() - 86400000), tz, 'MMM d');
  var kpis = [
    ['Page views', 'pageview'], ['Searches', 'search'],
    ['Searches with no stations', 'no_results'], ['Clicks to station apps & sites', 'outbound_click'],
  ];

  var lines = ['*Find My Station: weekly summary* (' + label + ')', '_Counts events, never people._', ''];
  kpis.forEach(function (k) {
    var c = change_(week[k[1]], prev[k[1]]);
    lines.push('• ' + k[0] + ': *' + show_(week[k[1]]) + '*' + (c ? '  (' + c + ')' : ''));
  });
  [['Most-clicked stations', stations], ['Clicks by platform', platforms],
   ['Searches that found no station (ZIP3 or state)', areas]].forEach(function (s) {
    var l = list_(s[0], s[1]);
    if (l) lines.push('', l);
  });
  lines.push('', '<' + book.getUrl() + '|Open the dashboard>');

  UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: lines.join('\n') }),
  });
}

function add_(map, key, n) { if (key) map[key] = (map[key] || 0) + n; }

function show_(n) { return n === 0 ? '0' : n < 10 ? 'fewer than 10' : String(n); }

// Week-over-week change, only when both weeks are big enough to report.
function change_(now, before) {
  if (now < 10 || before < 10) return '';
  var pct = Math.round((now - before) / before * 100);
  return (pct >= 0 ? '+' : '') + pct + '% vs last week';
}

function list_(title, map) {
  var top = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, TOP_N);
  if (!top.length) return '';
  return '*' + title + '*\n' + top.map(function (k) { return '• ' + k + ': ' + show_(map[k]); }).join('\n');
}
