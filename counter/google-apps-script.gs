/**
 * Station App Finder: anonymous event counter (Google Apps Script, bound to a Google Sheet).
 *
 * Counts events, never people. The site sends a tiny note like
 *   {"event":"outbound_click","station":"kuow","link_type":"app","platform":"ios","device":"phone"}
 * and this script adds 1 to that day's matching row. No individual event, IP address,
 * cookie, ID, search text, or precise time is ever stored. Every field is checked against
 * the allowed list below (SPEC.md section 8); anything else is dropped.
 *
 * Setup: see counter/SETUP.md in the repo.
 */

var SHEET_NAME = 'counts';
var COLUMNS = ['date', 'event', 'page', 'station', 'link_type', 'platform', 'input_type', 'results', 'area', 'device', 'count', 'key'];

// The complete allowlist (SPEC.md section 8). Changing it needs Kyle's approval.
var EVENTS = {
  pageview: ['page', 'device'],
  search: ['input_type', 'results', 'area', 'device'],
  no_results: ['input_type', 'area', 'device'],
  outbound_click: ['station', 'link_type', 'platform', 'device'],
};
var VALID = {
  page: /^(home|search|station|state|about)$/,
  station: /^[a-z0-9-]{1,80}$/,
  link_type: /^(app|web|livestream)$/,
  platform: /^(ios|android|appletv|firetv|androidtv|roku|samsung|lg|web)$/,
  input_type: /^(zip|name|callsign|state)$/,
  results: /^(none|1-3|4\+)$/,
  area: /^(\d{3}|[A-Z]{2}|)$/, // ZIP 3-digit prefix, state code, or empty; never a full ZIP
  device: /^(phone|tablet|desktop|other)$/,
};

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var fields = EVENTS[data.event];
    if (!fields) return ok_();
    var row = { date: today_(), event: data.event };
    for (var i = 0; i < fields.length; i++) {
      var name = fields[i];
      var value = String(data[name] == null ? '' : data[name]);
      if (!VALID[name].test(value)) return ok_(); // anything unexpected: count nothing
      row[name] = value;
    }
    increment_(row);
  } catch (err) {
    // Malformed input: ignore. Nothing about the request is kept.
  }
  return ok_();
}

function doGet() {
  return ContentService.createTextOutput('Station App Finder counter is running.');
}

function increment_(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = sheet_();
    var key = COLUMNS.slice(0, 10).map(function (c) { return row[c] || ''; }).join('|');
    var found = sheet.getRange('L:L').createTextFinder(key).matchEntireCell(true).findNext();
    if (found) {
      var cell = sheet.getRange(found.getRow(), 11);
      cell.setValue(Number(cell.getValue()) + 1);
    } else {
      sheet.appendRow(COLUMNS.slice(0, 10).map(function (c) { return row[c] || ''; }).concat([1, key]));
    }
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.hideColumns(12); // the lookup key
  }
  return sheet;
}

// Daily granularity only (the script's time zone, set in Project Settings).
function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function ok_() {
  return ContentService.createTextOutput('ok');
}
