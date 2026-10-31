'use strict';

// HTTP validators only. Callers retain ownership of response bodies, source
// timestamps, local TTLs and maximum offline ages. Server freshness directives
// deliberately do not change the weather plugin's polling/offline policy.
var MAX_HEADER = 1024;

function finite(value) { return typeof value === 'number' && isFinite(value); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function safeHeader(value) {
  return typeof value === 'string' && value.length <= MAX_HEADER &&
    !/[\x00-\x08\x0a-\x1f\x7f]/.test(value) ? value.trim() : null;
}

function header(response, name) {
  try {
    if (!response || !response.headers || typeof response.headers.get !== 'function') { return {present:false}; }
    var value = response.headers.get(name);
    return value === null || value === undefined ? {present:false} : {present:true, value:safeHeader(value)};
  } catch (ignored) { return {present:false}; }
}

function etag(value) {
  value = safeHeader(value);
  // The app backend also returns an unquoted SHA-256 tag, which it accepts
  // unchanged in If-None-Match. Keep that safe opaque token rather than adding
  // quotes that could change this server's validator comparison.
  return value !== null && (/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ||
    /^[A-Za-z0-9._~+\-]+$/.test(value)) ? value : null;
}

// Accept the canonical HTTP date format, including a matching weekday and a real
// calendar date. Date.parse alone accepts normalized/impossible dates and local
// date strings, neither of which should become an outbound validator.
function httpDate(value) {
  value = safeHeader(value);
  if (value === null || !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    return null;
  }
  var parsed = Date.parse(value);
  return finite(parsed) && new Date(parsed).toUTCString() === value ? parsed : null;
}

function directives(value) {
  var parts = [];
  var start = 0;
  var quoted = false;
  var escaped = false;
  for (var i = 0; i < value.length; i++) {
    var char = value[i];
    if (escaped) { escaped = false; }
    else if (quoted && char === '\\') { escaped = true; }
    else if (char === '"') { quoted = !quoted; }
    else if (char === ',' && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}

function noStore(value) {
  if (value === null) { return false; }
  return directives(value).some(function(part) {
    part = part.trim();
    var equal = part.indexOf('=');
    var name = (equal < 0 ? part : part.slice(0, equal)).trim().toLowerCase();
    return name === 'no-store';
  });
}

function conditionalHeaders(record) {
  if (!object(record) || record.noStore === true) { return {}; }
  var tag = etag(record.etag);
  if (tag !== null) { return {'If-None-Match':tag}; }
  var modified = safeHeader(record.lastModified);
  return httpDate(modified) !== null ? {'If-Modified-Since':modified} : {};
}

/**
 * Normalize metadata from a 200 or 304 response. A 304 retains absent
 * validators/no-store policy; present headers replace them. checkedAt records a
 * validation, never a new weather observation or body retrieval. Other cache
 * directives, Expires, Date and Age are outside this helper's policy.
 */
function policy(response, nowMs, previous) {
  if (!finite(nowMs) || !finite(new Date(nowMs).getTime())) { throw new TypeError('A valid response time is required'); }
  var retained = response && response.status === 304 && object(previous) ? previous : {};
  var tag = header(response, 'etag');
  var modified = header(response, 'last-modified');
  var control = header(response, 'cache-control');
  var out = {
    etag:etag(tag.present ? tag.value : retained.etag),
    lastModified:null,
    checkedAt:nowMs,
    noStore:control.present ? noStore(control.value) : retained.noStore === true
  };
  var lastModified = safeHeader(modified.present ? modified.value : retained.lastModified);
  if (httpDate(lastModified) !== null) { out.lastModified = lastModified; }
  return out;
}

module.exports = {conditionalHeaders:conditionalHeaders, policy:policy};
