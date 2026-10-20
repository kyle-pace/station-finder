/**
 * Find My Station: weekly summary email (Google Apps Script, same project as the counter).
 *
 * Every Monday morning, emails the script's owner a short summary of the last 7 days from
 * the `counts` tab, compared with the 7 days before. It only reads the daily totals the
 * counter already keeps; it adds nothing new to what's collected. Any number under 10 is
 * shown as "fewer than 10" (the reporting rule in counter/SETUP.md), so the email is safe
 * to forward.
 *
 * Setup: see "Weekly email" in counter/SETUP.md.
 */

var EMAIL_DAY = ScriptApp.WeekDay.MONDAY;
var EMAIL_HOUR = 8; // in the script's time zone (Project Settings)
var TOP_N = 5;

// Run once from the editor to turn the weekly email on. Safe to run again.
function installWeeklyEmail() {
  removeWeeklyEmail();
  ScriptApp.newTrigger('sendWeeklyEmail').timeBased().onWeekDay(EMAIL_DAY).atHour(EMAIL_HOUR).create();
}

// Run from the editor to turn it off.
function removeWeeklyEmail() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyEmail') ScriptApp.deleteTrigger(t);
  });
}

function sendWeeklyEmail() {
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

  var html = '<div style="font-family:system-ui,sans-serif;color:#121826;max-width:560px">' +
    '<h2 style="margin:0 0 4px">Find My Station: weekly summary</h2>' +
    '<p style="margin:0 0 16px;color:#525a6b">' + label + '. Counts events, never people.</p>' +
    '<table cellpadding="8" style="border-collapse:collapse;width:100%;margin-bottom:16px">' +
    kpis.map(function (k) {
      return '<tr style="border-bottom:1px solid #dde2ea"><td>' + k[0] + '</td>' +
        '<td style="text-align:right;font-weight:700">' + show_(week[k[1]]) + '</td>' +
        '<td style="text-align:right;color:#525a6b">' + change_(week[k[1]], prev[k[1]]) + '</td></tr>';
    }).join('') + '</table>' +
    list_('Most-clicked stations', stations) +
    list_('Clicks by platform', platforms) +
    list_('Searches that found no station (ZIP3 or state)', areas) +
    '<p style="color:#525a6b;font-size:13px">Numbers under 10 show as "fewer than 10". ' +
    '<a href="' + book.getUrl() + '">Open the dashboard</a></p></div>';

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Find My Station: ' + show_(week.pageview) + ' page views, ' +
             show_(week.outbound_click) + ' clicks (' + label + ')',
    htmlBody: html,
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
  return '<h3 style="margin:16px 0 6px;font-size:15px">' + title + '</h3><ul style="margin:0;padding-left:18px">' +
    top.map(function (k) { return '<li>' + k + ': ' + show_(map[k]) + '</li>'; }).join('') + '</ul>';
}
