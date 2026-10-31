'use strict';

// Local full-day aggregates from the app's v2/places response. The graph feed
// remains the source for current conditions and the richer hourly forecast.
var distanceKm = require('./weather').distanceKm;
var DAY_MS = 86400000;
var MAX_ROWS = 128;
var MAX_AGE_MS = 6 * 3600000;
var MAX_FUTURE_MS = 10 * 60000;

function finite(value) { return typeof value === 'number' && isFinite(value); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function temperature(value) { return finite(value) && value >= -100 && value <= 100; }

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

// The issue time includes a timezone offset. Bare local times and impossible
// dates must not acquire freshness through Date.parse's normalization.
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

// Czech forecast dates are Prague calendar days, independent of the phone's
// timezone. EU daylight saving changes at 01:00 UTC on the last Sunday.
function todayMs(now) {
  var year = new Date(now).getUTCFullYear();
  var march = new Date(Date.UTC(year, 2, 31, 1));
  var october = new Date(Date.UTC(year, 9, 31, 1));
  var start = march.getTime() - march.getUTCDay() * DAY_MS;
  var end = october.getTime() - october.getUTCDay() * DAY_MS;
  var offset = now >= start && now < end ? 7200000 : 3600000;
  return calendarDate(new Date(now + offset).toISOString().slice(0, 10));
}

// These are the app's WeatherConditionType.fromApiValue IDs, not the public
// website's SVG filenames. Daily icons encode no precipitation intensity.
// Pebble has no hail/thunder code: retain unknown for those hazards rather
// than interpreting a whole-day precipitation total as an hourly rate.
var CONDITIONS = {
  1: 'sun', 2: 'sun', 3: 'partly_cloudy',
  6: 'cloudy', 16: 'cloudy', 22: 'cloudy', 30: 'cloudy',
  4: 'light_rain', 7: 'light_rain', 8: 'light_rain',
  17: 'light_rain', 18: 'light_rain', 23: 'light_rain', 24: 'light_rain',
  5: 'light_snow', 9: 'light_snow', 12: 'light_snow', 14: 'light_snow',
  15: 'light_snow', 28: 'light_snow', 29: 'light_snow',
  11: 'rain_and_snow', 20: 'rain_and_snow', 26: 'rain_and_snow', 31: 'rain_and_snow'
};

function conditionCode(value) {
  return finite(value) && Math.floor(value) === value &&
    Object.prototype.hasOwnProperty.call(CONDITIONS, value) ? CONDITIONS[value] : 'unknown';
}

/**
 * Parse decoded local-place JSON into at most three date-keyed daily ranges.
 * aladin_clstemperature is the app aggregate's maximum and min_temperature
 * is its minimum, both Celsius. Invalid/incomplete dates remain absent; later
 * dates keep their original keys. Never derive today's range from remaining
 * hours, top-level values, national forecasts, or a different place.
 */
function parseWeather(raw, nowMs, point) {
  if (!object(raw) || !finite(nowMs) || nowMs <= 0 ||
      !finite(new Date(nowMs).getTime()) || new Date(nowMs).getUTCFullYear() > 9998 ||
      !object(point) || !Array.isArray(raw.forecast_weather_cumulative) ||
      !raw.forecast_weather_cumulative.length || raw.forecast_weather_cumulative.length > MAX_ROWS) { return null; }
  var distance = distanceKm(point.latitude, point.longitude, raw.lat, raw.lng);
  var updated = timestampMs(raw.updated_at);
  if (distance === null || distance > 30 || updated === null ||
      updated < nowMs - MAX_AGE_MS || updated > nowMs + MAX_FUTURE_MS) { return null; }
  var today = todayMs(nowMs);
  var end = today + 2 * DAY_MS;
  var byDate = Object.create(null);
  raw.forecast_weather_cumulative.forEach(function(row) {
    if (!object(row) || typeof row.category !== 'string' || !row.category || row.category.length > 100) { return; }
    var date = calendarDate(row.time_at);
    if (date === null || date < today || date > end) { return; }
    var entry = byDate[row.time_at];
    if (!entry) {
      entry = byDate[row.time_at] = {values: Object.create(null), ambiguous: false};
    }
    if (Object.prototype.hasOwnProperty.call(entry.values, row.category)) { entry.ambiguous = true; }
    entry.values[row.category] = row.value;
  });
  var days = [];
  Object.keys(byDate).sort().forEach(function(date) {
    var entry = byDate[date];
    var values = entry.values;
    var high = values.aladin_clstemperature;
    var low = values.min_temperature;
    if (entry.ambiguous || !temperature(high) || !temperature(low) || high < low) { return; }
    // A single daily condition represents daytime. A night icon can fill a
    // missing day category, but cannot turn an invalid/unknown day into clear.
    var icon = Object.prototype.hasOwnProperty.call(values, 'weather_icon_day')
      ? values.weather_icon_day : values.weather_icon_night;
    days.push({date: date, highC: high, lowC: low, conditionCode: conditionCode(icon)});
  });
  return days.length ? {days: days, updatedAt: Math.floor(updated / 1000),
    latitude: raw.lat, longitude: raw.lng} : null;
}

module.exports = {parseWeather: parseWeather, conditionCode: conditionCode};
