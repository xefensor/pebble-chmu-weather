'use strict';

var DAY_MS = 86400000;
var MAX_ISSUE_AGE_MS = 7 * DAY_MS;
var MAX_FUTURE_ISSUE_MS = 10 * 60000;
var SOURCE = 'ČHMÚ app clear-sky noon UV';

function finite(value) { return typeof value === 'number' && isFinite(value); }
function validUV(value) { return finite(value) && value >= 0 && value <= 30; }

// Validate calendar dates before Date can silently normalize an impossible day.
function calendarDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) { return null; }
  var year = Number(text.slice(0, 4));
  var month = Number(text.slice(5, 7));
  var day = Number(text.slice(8, 10));
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) { return null; }
  var time = Date.UTC(year, month - 1, day);
  var date = new Date(time);
  return finite(time) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? time : null;
}

// The app supplies updated_at with an explicit offset. Never interpret a bare
// timestamp in the phone's local zone; reject impossible times and offsets too.
function timestampMs(text) {
  if (typeof text !== 'string') { return null; }
  var match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) { return null; }
  var date = calendarDate(match[1]);
  var hour = Number(match[2]);
  var minute = Number(match[3]);
  var second = Number(match[4]);
  if (date === null || hour > 23 || minute > 59 || second > 59) { return null; }
  var zone = match[6];
  var offset = 0;
  if (zone !== 'Z') {
    var zoneHours = Number(zone.slice(1, 3));
    var zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 14 || zoneMinutes > 59 || (zoneHours === 14 && zoneMinutes !== 0) || zone === '-00:00') { return null; }
    offset = (zoneHours * 60 + zoneMinutes) * (zone[0] === '-' ? -1 : 1);
  }
  var fraction = match[5] ? Number('0.' + match[5]) * 1000 : 0;
  var time = date + ((hour * 60 + minute - offset) * 60 + second) * 1000 + fraction;
  return finite(time) ? time : null;
}

// Europe/Prague uses EU DST: the last Sundays of March/October at 01:00 UTC.
// Compute date keys without relying on the phone host's Intl/time-zone support.
function pragueDate(now) {
  var year = new Date(now).getUTCFullYear();
  var march = new Date(Date.UTC(year, 2, 31, 1));
  var october = new Date(Date.UTC(year, 9, 31, 1));
  var summerStart = march.getTime() - march.getUTCDay() * DAY_MS;
  var summerEnd = october.getTime() - october.getUTCDay() * DAY_MS;
  var offsetMs = now >= summerStart && now < summerEnd ? 7200000 : 3600000;
  return new Date(now + offsetMs).toISOString().slice(0, 10);
}

/**
 * Parse the app's UV response, already decoded from JSON.
 * `value` is clear-sky solar-noon UV, not an instantaneous/all-sky reading.
 * `updated_at` is the source's issue/update time, never the download time.
 * Invalid rows are omitted; missing calendar days remain absent. Snow-adjusted
 * UV is retained separately only when valid, and never replaces normal UV.
 */
function parseUV(body, nowMs) {
  if (!Array.isArray(body) || body.length === 0 || body.length > 16 ||
      !finite(nowMs) || nowMs <= 0 || !finite(new Date(nowMs).getTime()) ||
      new Date(nowMs).getUTCFullYear() > 9998) { return null; }
  var today = calendarDate(pragueDate(nowMs));
  var end = today + 6 * DAY_MS;
  var byDate = {};
  body.forEach(function(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { return; }
    var date = calendarDate(row.date_at);
    var updated = timestampMs(row.updated_at);
    if (date === null || date < today || date > end || !validUV(row.value) ||
        updated === null || updated < nowMs - MAX_ISSUE_AGE_MS || updated > nowMs + MAX_FUTURE_ISSUE_MS) { return; }
    var previous = byDate[row.date_at];
    if (previous && updated <= previous.updatedMs) { return; }
    var day = {date: row.date_at, uvIndex: row.value, updatedAt: Math.floor(updated / 1000)};
    if (validUV(row.value_snow)) { day.valueSnow = row.value_snow; }
    byDate[row.date_at] = {day: day, updatedMs: updated};
  });
  var days = Object.keys(byDate).sort().map(function(date) { return byDate[date].day; });
  return days.length ? {days: days, source: SOURCE} : null;
}

module.exports = {parseUV: parseUV};
