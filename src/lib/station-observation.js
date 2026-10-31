'use strict';

var MAX_ROWS = 25000;
var FIELDS = {
  T: {name: 'temperatureC', low: -100, high: 100},
  H: {name: 'humidity', low: 0, high: 100},
  F: {name: 'windSpeed', low: 0, high: 150},
  D: {name: 'windDirection', low: 0, high: 360}
};

function finite(value) { return typeof value === 'number' && isFinite(value); }
function numeric(value) {
  if (finite(value)) { return value; }
  if (typeof value !== 'string') { return null; }
  var text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) { return null; }
  var number = Number(text);
  return finite(number) ? number : null;
}
function bounded(value, field) {
  var number = numeric(value);
  return number !== null && number >= field.low && number <= field.high ? number : null;
}

// Both official measurement feeds publish UTC. Check the original calendar
// fields because Date.UTC otherwise normalizes impossible dates such as Feb 30.
function utcSeconds(text) {
  if (typeof text !== 'string') { return null; }
  var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|\+00:00)$/.exec(text);
  if (!match) { return null; }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var hour = Number(match[4]);
  var minute = Number(match[5]);
  var second = Number(match[6]);
  var time = Date.UTC(year, month - 1, day, hour, minute, second);
  var date = new Date(time);
  if (!finite(time) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) { return null; }
  return time / 1000 + (match[7] ? Number('0.' + match[7]) : 0);
}

function unitMatches(code, unit) {
  if (typeof unit !== 'string') { return false; }
  var text = unit.replace(/<\/?sup>/gi, '').replace(/&deg;|&#176;/g, '°')
    .replace(/⁻¹/g, '-1').replace(/·/g, '.').replace(/[\s^]/g, '');
  if (code === 'T') { return text === '°C'; }
  if (code === 'H') { return text === '%'; }
  if (code === 'F') { return text === 'm/s' || text === 'm.s-1' || text === 'ms-1'; }
  return code === 'D' && text === '°';
}

// The graph's dial documents T in C, H in %, F in m.s<sup>-1</sup> and D in
// degrees. Older temperature-only inputs can lack dial; explicit conflicting
// metadata must never silently turn Fahrenheit or km/h into Celsius or m/s.
function metadataAllows(body, code) {
  if (body.dial === undefined) { return true; }
  if (!body.dial || typeof body.dial !== 'object' || Array.isArray(body.dial)) { return false; }
  var entry = body.dial[code];
  if (entry === undefined) { return true; }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { return false; }
  if (entry.Code !== undefined && entry.Code !== code) { return false; }
  return entry.UnitHTML === undefined || unitMatches(code, entry.UnitHTML);
}

/**
 * Newest fresh air-temperature sample plus optional co-timed station weather.
 * Graph rows are samples from the requested station endpoint. Bulk rows carry
 * explicit station IDs, so reject a source mixing IDs among T/H/F/D rows.
 * For bulk, each field independently needs QUALITY 0 (good) or 5 (operative
 * unknown) and no unexplained FLAG. The returned quality describes T only.
 */
function parseObservation(body, nowMs, maxAgeSec) {
  if (maxAgeSec === undefined) { maxAgeSec = 3600; }
  if (!body || !finite(nowMs) || nowMs <= 0 || !finite(maxAgeSec) || maxAgeSec < 0) { return null; }
  var now = nowMs / 1000;
  function fresh(time) { return time !== null && time > 0 && time <= now + 300 && now - time <= maxAgeSec; }
  var newest = null;
  var newestTime = null;
  if (Array.isArray(body.dataPoints)) {
    if (body.dataPoints.length > MAX_ROWS || !metadataAllows(body, 'T')) { return null; }
    body.dataPoints.forEach(function(point) {
      if (!point || !point.values || typeof point.values !== 'object' || Array.isArray(point.values)) { return; }
      var time = utcSeconds(point.timestamp);
      var temperature = bounded(point.values.T, FIELDS.T);
      if (!fresh(time) || temperature === null || (newestTime !== null && time <= newestTime)) { return; }
      newestTime = time;
      newest = {temperatureC: temperature, observedAt: Math.floor(time)};
      ['H', 'F', 'D'].forEach(function(code) {
        var value = bounded(point.values[code], FIELDS[code]);
        if (metadataAllows(body, code) && value !== null) { newest[FIELDS[code].name] = value; }
      });
    });
    return newest;
  }

  var table = body.data && body.data.data;
  if (!table || !Array.isArray(table.values) || table.values.length > MAX_ROWS) { return null; }
  var header = typeof table.header === 'string' && table.header.length <= 1000
    ? table.header.split(',').map(function(name) { return name.trim(); }) : table.header;
  if (!Array.isArray(header) || header.length > 100 || header.some(function(name) { return typeof name !== 'string'; }) ||
      header.some(function(name, i) { return header.indexOf(name) !== i; })) { return null; }
  var columns = {};
  ['STATION', 'ELEMENT', 'DT', 'VAL', 'FLAG', 'QUALITY'].forEach(function(name) { columns[name] = header.indexOf(name); });
  if (['STATION', 'ELEMENT', 'DT', 'VAL', 'QUALITY'].some(function(name) { return columns[name] < 0; })) { return null; }
  var unitColumn = header.indexOf('UNIT');
  if (unitColumn < 0) { unitColumn = header.indexOf('UNITS'); }
  if (unitColumn < 0) { unitColumn = header.indexOf('UnitHTML'); }
  var station = null;
  var mixed = false;
  var samples = {};
  table.values.forEach(function(row) {
    if (!Array.isArray(row)) { return; }
    var code = row[columns.ELEMENT];
    if (!Object.prototype.hasOwnProperty.call(FIELDS, code)) { return; }
    var id = row[columns.STATION];
    if (typeof id !== 'string' || !id.trim()) { return; }
    if (station !== null && station !== id) { mixed = true; }
    station = id;
    var time = utcSeconds(row[columns.DT]);
    var value = bounded(row[columns.VAL], FIELDS[code]);
    var quality = numeric(row[columns.QUALITY]);
    if (!fresh(time) || value === null || (quality !== 0 && quality !== 5) || !metadataAllows(body, code) ||
        (columns.FLAG >= 0 && row[columns.FLAG] !== '' && row[columns.FLAG] !== null) ||
        (unitColumn >= 0 && !unitMatches(code, row[unitColumn]))) { return; }
    // Keep fractional timestamps until after grouping: samples 1ms apart must
    // not be merged merely because exported observedAt is whole epoch seconds.
    var sample = samples[time] || (samples[time] = {});
    if (!sample[code] || (sample[code].quality === 5 && quality === 0)) {
      sample[code] = {value: value, quality: quality};
    }
  });
  if (mixed) { return null; }
  Object.keys(samples).forEach(function(timeKey) {
    var time = Number(timeKey);
    var sample = samples[timeKey];
    if (!sample.T || (newestTime !== null && time <= newestTime)) { return; }
    newestTime = time;
    newest = {temperatureC: sample.T.value, observedAt: Math.floor(time), quality: sample.T.quality === 0 ? 'good' : 'unknown'};
    ['H', 'F', 'D'].forEach(function(code) {
      if (sample[code]) { newest[FIELDS[code].name] = sample[code].value; }
    });
  });
  return newest;
}

module.exports = {parseObservation: parseObservation};
