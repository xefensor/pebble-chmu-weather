'use strict';
var httpCache = require('./http-cache');

// The app backend uses an anonymous per-install device registration. This
// client owns its identifier and tokens; it never imports the official app's
// Android ID, credentials, notification token or precise location.
var API = 'https://chmu.rails.cz/api/';
var ID = 'chmu.app.install.v1';
var AUTH = 'chmu.app.auth.v1';
var CACHE = 'chmu.app.cache.v1.';
var REFRESH = 30 * 60000;
var MAX_AGE = 6 * 3600000;
var HTTP_TIMEOUT = 6000;
var DEFAULT_BUDGET = 17000;

function unavailable(status) {
  var error = {code:'PLUGIN_UNAVAILABLE', message:'ČHMÚ app weather unavailable'};
  if (status === 401) { error.httpStatus = 401; }
  return error;
}
function timeout() { return {code:'TIMEOUT', message:'ČHMÚ app request timed out'}; }
function finite(value) { return typeof value === 'number' && isFinite(value); }
function validToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[A-Za-z0-9._~+\/-]+=*$/.test(value);
}
function validTokens(value) {
  return value && validToken(value.access_token) && validToken(value.refresh_token);
}

// Decode only the JWT expiry hint. The server remains responsible for token
// verification; opaque tokens work too and are refreshed after an HTTP 401.
function tokenExpiry(token) {
  try {
    var encoded = token.split('.')[1];
    if (!encoded || encoded.length > 16384) { return null; }
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var bits = 0;
    var buffer = 0;
    var decoded = '';
    encoded = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    for (var i = 0; i < encoded.length; i++) {
      var digit = alphabet.indexOf(encoded[i]);
      if (digit < 0) { return null; }
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((buffer >> bits) & 255); }
    }
    var exp = JSON.parse(decoded).exp;
    return finite(exp) && exp > 0 ? exp * 1000 : null;
  } catch (ignored) { return null; }
}

// EU summer time begins/ends on the last Sunday at 01:00 UTC. Date arithmetic
// below adds calendar dates, so a query crossing a DST change still has 7 days.
function pragueDate(now) {
  var year = new Date(now).getUTCFullYear();
  function transition(month) {
    var last = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
  }
  var offset = now >= transition(2) && now < transition(9) ? 7200000 : 3600000;
  return new Date(now + offset).toISOString().slice(0, 10);
}

function createClient(options) {
  var storage = options.storage;
  // Native plugin secure storage is asynchronous and encrypted at rest. A
  // failing secure bridge must not downgrade credentials into plain storage.
  var authStorage = options.secureStorage || storage;
  var auth = null;
  var authLoaded = false;
  var authLoad = null;
  var authFlight = null;
  var inFlight = Object.create(null);
  function load(key) {
    try { return JSON.parse(storage.getItem(key)); } catch (ignored) { return null; }
  }
  function save(key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (ignored) {}
  }
  function requestBudget(budget) {
    return budget && finite(budget.endsAt) ? budget : {endsAt:options.now() + DEFAULT_BUDGET};
  }
  function enabled() {
    try { return !options.isEnabled || options.isEnabled() !== false; } catch (ignored) { return false; }
  }
  function within(promise, budget, limit) {
    return new Promise(function(resolve, reject) {
      var remaining = budget.endsAt - options.now();
      if (remaining <= 0) {
        Promise.resolve(promise).catch(function() {});
        reject(timeout()); return;
      }
      var done = false;
      var endsAt = options.now() + Math.min(limit, remaining);
      // The native plugin host forbids JS timers. It owns the final session
      // timeout; without an injected scheduler, reject late bridge completions.
      var timed = typeof options.later === 'function' && typeof options.cancelLater === 'function';
      var timer = timed ? options.later(function() {
        if (!done) { done = true; reject(timeout()); }
      }, Math.min(limit, remaining)) : null;
      function finish(error, value) {
        if (done) { return; }
        done = true;
        if (timed) { options.cancelLater(timer); }
        if (options.now() >= endsAt) { reject(timeout()); }
        else if (error) { reject(error); }
        else { resolve(value); }
      }
      Promise.resolve(promise).then(function(value) { finish(null, value); }, function(error) { finish(error); });
    });
  }
  async function http(path, method, body, access, budget, conditional) {
    if (!enabled()) { throw unavailable(); }
    // Do not even start a fetch when another stage used the remaining budget.
    if (options.now() >= budget.endsAt) { throw timeout(); }
    var headers = {Accept:'application/json'};
    var init = {method:method, headers:headers};
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (access) { headers.Authorization = 'Bearer ' + access; }
    if (method === 'GET' && conditional) {
      Object.keys(conditional).forEach(function(name) { headers[name] = conditional[name]; });
    }
    var pending;
    try {
      pending = Promise.resolve(options.fetch(API + path, init)).then(function(response) {
        if (method === 'GET' && response && response.status === 304) { return {response:response, notModified:true}; }
        if (!response || !response.ok) { throw unavailable(response && response.status); }
        if (method === 'GET') {
          return Promise.resolve().then(function() { return response.json(); }).then(function(value) {
            return {response:response, body:value};
          }).catch(function() { return {response:response, invalid:true}; });
        }
        return response.json();
      }).catch(function(error) {
        if (error && error.code === 'TIMEOUT') { throw timeout(); }
        throw unavailable(error && error.httpStatus);
      });
    } catch (ignored) { throw unavailable(); }
    return within(pending, budget, HTTP_TIMEOUT);
  }
  function identifier() {
    var saved = load(ID);
    var pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof saved === 'string' && pattern.test(saved)) { return saved; }
    var uuid;
    try {
      if (options.randomUUID) { uuid = options.randomUUID(); }
      else if (typeof crypto !== 'undefined' && crypto.randomUUID) { uuid = crypto.randomUUID(); }
    } catch (ignored) {}
    if (typeof uuid !== 'string' || !pattern.test(uuid)) {
      var random = options.random || Math.random;
      uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.floor(random() * 16) & 15;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
    }
    save(ID, uuid);
    return uuid;
  }
  function storedAuth(budget) {
    if (authLoaded) { return Promise.resolve(auth); }
    if (!authLoad) {
      authLoad = (async function() {
        var text;
        try { text = await within(Promise.resolve(authStorage.getItem(AUTH)), budget, HTTP_TIMEOUT); }
        catch (error) { throw error && error.code === 'TIMEOUT' ? timeout() : unavailable(); }
        var saved;
        try { saved = JSON.parse(text); } catch (ignored) { saved = null; }
        auth = validTokens(saved) ? {access_token:saved.access_token, refresh_token:saved.refresh_token} : null;
        authLoaded = true;
        return auth;
      })().then(function(value) { authLoad = null; return value; },
        function(error) { authLoad = null; throw error; });
    }
    return within(authLoad, budget, DEFAULT_BUDGET);
  }
  async function saveAuth(value, budget) {
    try { await within(Promise.resolve(authStorage.setItem(AUTH, JSON.stringify(value))), budget, HTTP_TIMEOUT); }
    catch (error) { throw error && error.code === 'TIMEOUT' ? timeout() : unavailable(); }
    auth = value;
  }
  function expired(tokens) {
    var exp = tokenExpiry(tokens.access_token);
    return exp !== null && exp <= options.now() + 30000;
  }
  async function login(budget) {
    return http('v1/jwt/login', 'POST', {device:{device_token:identifier(),
      platform:options.platform === 'ios' ? 'ios' : 'android'}}, null, budget);
  }
  async function authenticate(budget) {
    var previous = await storedAuth(budget);
    var next;
    if (previous) {
      try {
        var verification = await http('v1/jwt/verify_refresh_token', 'POST',
          {refresh_token:previous.refresh_token}, null, budget);
        if (!verification || typeof verification.valid !== 'boolean') { throw unavailable(); }
        if (verification.valid) {
          next = await http('v1/jwt/refresh', 'POST', {refresh_token:previous.refresh_token}, null, budget);
          if (!validTokens(next)) { throw unavailable(); }
        }
      } catch (error) {
        if (!error || error.httpStatus !== 401) { throw error; }
      }
    }
    // Keep login outside the refresh catch: a failed registration itself must
    // not be mistaken for an invalid refresh token and posted a second time.
    if (!next) { next = await login(budget); }
    if (!validTokens(next)) { throw unavailable(); }
    if (options.now() >= budget.endsAt) { throw timeout(); }
    await saveAuth({access_token:next.access_token, refresh_token:next.refresh_token}, budget);
    return auth;
  }
  async function credentials(rejectedAccess, budget) {
    var current = await storedAuth(budget);
    // An overlapping request may already have replaced the rejected token.
    if (current && !expired(current) && (!rejectedAccess || current.access_token !== rejectedAccess)) {
      return Promise.resolve(current);
    }
    if (!authFlight) {
      authFlight = authenticate(budget).then(function(value) { authFlight = null; return value; },
        function(error) { authFlight = null; throw error; });
    }
    return within(authFlight, budget, DEFAULT_BUDGET);
  }
  async function get(path, budget, conditional) {
    var token = await credentials(null, budget);
    try { return await http(path, 'GET', undefined, token.access_token, budget, conditional); }
    catch (error) {
      if (!error || error.httpStatus !== 401) { throw error; }
      token = await credentials(token.access_token, budget);
      // Exactly one authenticated retry, including when the new token fails.
      return http(path, 'GET', undefined, token.access_token, budget, conditional);
    }
  }
  function cache(key, record) {
    save(CACHE + key, record);
    var index = load(CACHE + 'index');
    index = (Array.isArray(index) ? index : []).filter(function(item) {
      return typeof item === 'string' && item !== key;
    });
    index.push(key);
    while (index.length > 16) {
      try { storage.removeItem(CACHE + index.shift()); } catch (ignored) {}
    }
    save(CACHE + 'index', index);
  }
  function removeCache(key) {
    try { storage.removeItem(CACHE + key); } catch (ignored) {}
    var index = load(CACHE + 'index');
    if (Array.isArray(index)) { save(CACHE + 'index', index.filter(function(item) { return item !== key; })); }
  }
  function cacheFresh(record) {
    var checked = record.checkedAt === undefined ? record.fetchedAt : record.checkedAt;
    return !record.noStore && finite(checked) && checked <= options.now() &&
      options.now() - checked < REFRESH;
  }
  function validBody(body, kind, point) {
    if (!body || typeof body !== 'object' || (kind === 'uv' ? !Array.isArray(body) || !body.length : Array.isArray(body))) {
      return false;
    }
    var validate = kind === 'uv' ? options.validateUV : options.validatePlace;
    try { return !validate || !!validate(body, options.now(), point); } catch (ignored) { return false; }
  }
  function usable(record, kind, point) {
    return record && !record.noStore && finite(record.fetchedAt) && record.fetchedAt <= options.now() &&
      options.now() - record.fetchedAt < MAX_AGE && validBody(record.body, kind, point);
  }
  function result(record) {
    var value = {value:record.body, fetchedAt:Math.floor(record.fetchedAt / 1000),
      checkedAt:Math.floor((record.checkedAt === undefined ? record.fetchedAt : record.checkedAt) / 1000)};
    if (record.noStore) { value.noStore = true; }
    return value;
  }
  async function resourceRequest(key, path, force, budget, kind, point) {
    var previous = load(CACHE + key);
    if (!force && usable(previous, kind, point) && cacheFresh(previous)) { return result(previous); }
    try {
      var conditional = usable(previous, kind, point) && previous.requestPath === path ? httpCache.conditionalHeaders(previous) : {};
      var reply = await get(path, budget, conditional);
      if (!enabled()) { throw unavailable(); }
      if (options.now() >= budget.endsAt) { throw timeout(); }
      var at = options.now();
      var policy = httpCache.policy(reply.response, at, reply.notModified ? previous : null);
      if (policy.noStore) { removeCache(key); }
      var record;
      if (reply.notModified) {
        if (!Object.keys(conditional).length || !usable(previous, kind, point)) { throw unavailable(); }
        record = Object.assign({}, previous, policy);
      } else {
        if (reply.invalid || !validBody(reply.body, kind, point)) { throw unavailable(); }
        record = Object.assign({body:reply.body, fetchedAt:at, requestPath:path}, policy);
      }
      if (!policy.noStore) { cache(key, record); }
      return result(record);
    } catch (error) {
      if (!enabled()) { throw unavailable(); }
      // Keep the original retrieval time; failed refreshes cannot extend it.
      if (usable(previous, kind, point) && !(typeof policy !== 'undefined' && policy.noStore)) { return result(previous); }
      throw error;
    }
  }
  function resource(kind, point, force, requestedBudget) {
    var budget = requestBudget(requestedBudget);
    if (!enabled()) { return Promise.reject(unavailable()); }
    if (options.now() >= budget.endsAt) { return Promise.reject(timeout()); }
    if (!point || !finite(point.latitude) || !finite(point.longitude) ||
        Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
      return Promise.reject(unavailable());
    }
    var lat = String(point.latitude);
    var lng = String(point.longitude);
    var date = pragueDate(options.now());
    // Keep future rows across local midnight. The caller's validator decides
    // whether a cached response still contains a usable forecast for today.
    var key = kind + '.' + lat + ',' + lng;
    var path;
    if (kind === 'uv') {
      var last = new Date(Date.parse(date + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
      path = 'v1/uv_measures?date_from=' + date + '&date_to=' + last + '&lat=' + encodeURIComponent(lat) +
        '&lng=' + encodeURIComponent(lng);
    } else {
      path = 'v2/places/nearest?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng) +
        '&with_detail%5B%5D=forecast_cumulative';
    }
    var previous = load(CACHE + key);
    // A force refresh must not join a same-turn promise that only reads cache.
    if (!force && usable(previous, kind, point) && cacheFresh(previous)) {
      return Promise.resolve(result(previous));
    }
    if (!inFlight[key]) {
      inFlight[key] = resourceRequest(key, path, !!force, budget, kind, point).then(function(value) {
        delete inFlight[key]; return value;
      }, function(error) { delete inFlight[key]; throw error; });
    }
    return within(inFlight[key], budget, DEFAULT_BUDGET).catch(function(error) {
      // Never forward fetch/parser error messages, URLs, bodies or tokens.
      throw error && error.code === 'TIMEOUT' ? timeout() : unavailable();
    });
  }
  return {uv:function(point, force, budget) { return resource('uv', point, force, budget); },
    place:function(point, force, budget) { return resource('place', point, force, budget); }};
}

module.exports = {createClient:createClient};
