'use strict';

// Retrospective ALADIN forecast context, never observations or a replacement
// for a usable current forecast. Pass raw parsed ALADIN hours before blending.
var KEY = 'chmu.forecast-history.v1';
var HOUR = 3600;
var DAY_MS = 86400000;
var MAX_POINTS = 16;
var MAX_SAMPLES = 25;
var MAX_FORECAST_HOURS = 73;
var MAX_TEXT_LENGTH = 100000;
var CODES = ['sun', 'partly_cloudy', 'cloudy', 'light_rain', 'heavy_rain',
  'light_snow', 'heavy_snow', 'rain_and_snow', 'unknown'];

function finite(value) { return typeof value === 'number' && isFinite(value); }
function integer(value) { return finite(value) && Math.floor(value) === value; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function validPoint(point) {
  return object(point) && typeof point.id === 'string' && point.id.length > 0 && point.id.length <= 128 &&
    point.id.trim() === point.id && finite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    finite(point.longitude) && Math.abs(point.longitude) <= 180;
}
function validTime(time) { return integer(time) && time > 0 && time % HOUR === 0; }
function validValue(hour) {
  return object(hour) && finite(hour.temperatureC) && hour.temperatureC >= -100 && hour.temperatureC <= 100 &&
    typeof hour.conditionCode === 'string' && CODES.indexOf(hour.conditionCode) >= 0;
}
function validFetch(time, now) { return integer(time) && time > 0 && time <= now + 300; }
function rawForecastHour(hour) {
  if (Object.prototype.hasOwnProperty.call(hour, 'observedAt') ||
      hour.isForecast === false || hour.retainedForecast === true) { return false; }
  if (hour.source !== undefined && hour.source !== 'ALADIN' && hour.source !== 'ČHMÚ ALADIN forecast') { return false; }
  if (hour.sources !== undefined && (!object(hour.sources) || hour.sources.temperatureC !== 'ALADIN' ||
      (hour.sources.conditionCode !== undefined && hour.sources.conditionCode !== 'ALADIN'))) { return false; }
  return true;
}

// Prague dates are independent of the phone's host timezone, including the
// repeated/skipped UTC hours at EU daylight-saving transitions.
function offsetAt(ms) {
  var year = new Date(ms).getUTCFullYear();
  var march = new Date(Date.UTC(year, 2, 31, 1));
  var october = new Date(Date.UTC(year, 9, 31, 1));
  var start = march.getTime() - march.getUTCDay() * DAY_MS;
  var end = october.getTime() - october.getUTCDay() * DAY_MS;
  return ms >= start && ms < end ? 7200000 : 3600000;
}
function context(nowMs) {
  if (!finite(nowMs) || nowMs <= 0 || !finite(new Date(nowMs).getTime()) ||
      new Date(nowMs).getUTCFullYear() > 9998) { return null; }
  var local = new Date(nowMs + offsetAt(nowMs));
  var utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  var next = utc + DAY_MS;
  return {date:local.toISOString().slice(0, 10), now:Math.floor(nowMs / 1000),
    start:(utc - offsetAt(utc)) / 1000, end:(next - offsetAt(next)) / 1000,
    cutoff:Math.floor(nowMs / (HOUR * 1000)) * HOUR};
}
function past(time, day) { return validTime(time) && time >= day.start && time < day.end && time < day.cutoff; }
function identity(point, date) { return JSON.stringify([point.id, point.latitude, point.longitude, date]); }
function sample(hour, fetchedAt) {
  return {time:hour.time, temperatureC:hour.temperatureC, conditionCode:hour.conditionCode,
    fetchedAt:fetchedAt, source:'ALADIN'};
}
function unchanged(hours) { return {hours:hours.slice(), historicalTimes:[], historicalFetchedAt:{}}; }

/**
 * createHistory({storage, now}).merge(publicForecastPoint, rawForecast, fetchedAt, policy)
 *
 * now() returns milliseconds; fetchedAt and all returned times use epoch
 * seconds. Only fresh downloads/reusable forecasts (at most six hours old)
 * can add or use history. Retained samples may be older than six hours, but
 * only fill absent, strictly-past hours of today's Prague date. Every supplied
 * current row wins, including explicit nulls. No current/future sample is ever
 * persisted. The caller still owns the current forecast's freshness checks.
 * policy.noStore removes this point's retained context and never merges or
 * stores its response, honoring the origin's no-store directive.
 */
function createHistory(options) {
  options = options || {};
  var storage = options.storage;
  var now = typeof options.now === 'function' ? options.now : Date.now;

  function load(day) {
    var value;
    try {
      var text = storage.getItem(KEY);
      if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) { return []; }
      value = JSON.parse(text);
    } catch (ignored) { return []; }
    if (!object(value) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_POINTS) { return []; }
    var records = [];
    value.records.forEach(function(record) {
      if (!object(record) || !validPoint(record) || record.date !== day.date ||
          !validFetch(record.touchedAt, day.now) || !Array.isArray(record.samples) || record.samples.length > MAX_SAMPLES ||
          (record.retractions !== undefined && (!Array.isArray(record.retractions) || record.retractions.length > MAX_SAMPLES))) { return; }
      var byTime = Object.create(null);
      var retracted = Object.create(null);
      record.samples.forEach(function(hour) {
        if (!validValue(hour) || !past(hour.time, day) || hour.source !== 'ALADIN' || !validFetch(hour.fetchedAt, day.now)) { return; }
        var previous = byTime[hour.time];
        if (!previous || hour.fetchedAt >= previous.fetchedAt) { byTime[hour.time] = sample(hour, hour.fetchedAt); }
      });
      (record.retractions || []).forEach(function(mark) {
        if (!object(mark) || !past(mark.time, day) || !validFetch(mark.fetchedAt, day.now)) { return; }
        if (!retracted[mark.time] || mark.fetchedAt >= retracted[mark.time].fetchedAt) {
          retracted[mark.time] = {time:mark.time, fetchedAt:mark.fetchedAt};
        }
      });
      Object.keys(retracted).forEach(function(time) {
        if (!byTime[time] || retracted[time].fetchedAt >= byTime[time].fetchedAt) { delete byTime[time]; }
        else { delete retracted[time]; }
      });
      var samples = Object.keys(byTime).map(function(time) { return byTime[time]; }).sort(function(a, b) { return a.time - b.time; });
      var retractions = Object.keys(retracted).map(function(time) { return retracted[time]; }).sort(function(a, b) { return a.time - b.time; });
      if (!samples.length && !retractions.length) { return; }
      var clean = {id:record.id, latitude:record.latitude, longitude:record.longitude,
        date:day.date, touchedAt:record.touchedAt, samples:samples, retractions:retractions};
      var key = identity(clean, day.date);
      // The stored array is least-to-most recently used. Keep its latest copy
      // if interrupted/concurrent writes left a duplicate identity.
      records = records.filter(function(other) { return identity(other, day.date) !== key; });
      records.push(clean);
    });
    return records;
  }
  function save(records) {
    try { storage.setItem(KEY, JSON.stringify({version:1, records:records.slice(-MAX_POINTS)})); } catch (ignored) {}
  }
  function merge(point, forecast, fetchedAt, policy) {
    var hours = forecast && Array.isArray(forecast.hours) ? forecast.hours : [];
    var result = unchanged(hours);
    var clock;
    try { clock = context(now()); } catch (ignored) { return result; }
    if (!clock) { return result; }
    var records = load(clock);
    if (validPoint(point) && policy && policy.noStore === true) {
      var forbidden = identity(point, clock.date);
      save(records.filter(function(record) { return identity(record, clock.date) !== forbidden; }));
      return result;
    }
    if (!validPoint(point) || !validFetch(fetchedAt, clock.now) || clock.now - fetchedAt > 6 * HOUR ||
        !hours.length || hours.length > MAX_FORECAST_HOURS) {
      save(records); // Also remove yesterday's context at the first new-day call.
      return result;
    }
    var supplied = Object.create(null);
    for (var i = 0; i < hours.length; i++) {
      var hour = hours[i];
      if (!object(hour) || !validTime(hour.time) || supplied[hour.time]) { save(records); return result; }
      supplied[hour.time] = true;
    }
    var key = identity(point, clock.date);
    var previous;
    records = records.filter(function(record) {
      if (identity(record, clock.date) !== key) { return true; }
      previous = record;
      return false;
    });
    var retained = Object.create(null);
    var retracted = Object.create(null);
    if (previous) { previous.samples.forEach(function(hour) { retained[hour.time] = hour; }); }
    if (previous) { previous.retractions.forEach(function(mark) { retracted[mark.time] = mark; }); }
    hours.forEach(function(hour) {
      if (!past(hour.time, clock) || !rawForecastHour(hour)) { return; }
      var old = retained[hour.time] || retracted[hour.time];
      // An older overlapping request may win this call's output, but must not
      // downgrade a newer retained sample or erase it with an older null.
      if (old && old.fetchedAt > fetchedAt) { return; }
      // Fetch timestamps use whole seconds. A retraction wins an ambiguous
      // equal-stamp numeric update as well; a strictly newer value can restore it.
      if (retracted[hour.time] && retracted[hour.time].fetchedAt === fetchedAt && validValue(hour)) { return; }
      if (validValue(hour)) {
        retained[hour.time] = sample(hour, fetchedAt);
        delete retracted[hour.time];
      } else {
        delete retained[hour.time];
        // Ordering metadata only: never persist the null/invalid temperature.
        // Keep this even if no numeric samples remain, so an older response
        // cannot resurrect a value that a newer forecast explicitly removed.
        retracted[hour.time] = {time:hour.time, fetchedAt:fetchedAt};
      }
    });
    var samples = Object.keys(retained).map(function(time) { return retained[time]; })
      .sort(function(a, b) { return a.time - b.time; }).slice(-MAX_SAMPLES);
    var retractions = Object.keys(retracted).map(function(time) { return retracted[time]; })
      .sort(function(a, b) { return a.time - b.time; }).slice(-MAX_SAMPLES);
    if (samples.length || retractions.length) {
      records.push({id:point.id, latitude:point.latitude, longitude:point.longitude,
        date:clock.date, touchedAt:clock.now, samples:samples, retractions:retractions});
    }
    save(records);
    samples.forEach(function(hour) {
      if (supplied[hour.time]) { return; }
      result.hours.push({time:hour.time, temperatureC:hour.temperatureC,
        conditionCode:hour.conditionCode, retainedForecast:true});
      result.historicalTimes.push(hour.time);
      result.historicalFetchedAt[hour.time] = hour.fetchedAt;
    });
    result.hours.sort(function(a, b) { return a.time - b.time; });
    return result;
  }
  return {merge:merge};
}

module.exports = {createHistory:createHistory};
