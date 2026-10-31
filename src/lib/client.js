'use strict';
var model = require('./weather');
var supplementModel = require('./supplement');
var createAppClient = require('./app-client').createClient;
var parseAppUV = require('./app-uv').parseUV;
var parseAppWeather = require('./app-weather').parseWeather;
var parseStationObservation = require('./station-observation').parseObservation;
var httpCache = require('./http-cache');
var createHistory = require('./forecast-history').createHistory;
var buildInstance = require('./envelope').buildInstance;
var REFRESH = 30 * 60000;
var MAX_FORECAST_AGE = 6 * 3600000;
// The phone host gives a native source handler 20 seconds. Keep time for its
// reply even when preferences, GPS and both observation endpoints are slow.
var REQUEST_BUDGET = 17000;
var PREFIX = 'chmu.cache.v1.';
var SETTINGS = 'chmu.settings.v1';
var STATUS = 'chmu.status.v1';
var API = 'https://data-provider.chmi.cz/api/graphs/';
var LOCATIONS = {category: 'preferences', item: 'weather_location'};
var UNITS = {category: 'preferences', item: 'units'};

module.exports = function(options) {
  var storage = options.storage;
  var catalog = options.catalog;
  var inFlight = {};
  var forecastHistory = createHistory({storage:storage, now:options.now});
  var appClient = createAppClient(Object.assign({}, options, {
    isEnabled:function() { var selected = settings(); return selected.appData || selected.uvSource === 'chmu'; },
    validateUV:function(body, now, point) { return !!parseAppUV(body, now, point); },
    validatePlace:function(body, now, point) { return !!parseAppWeather(body, now, point); }
  }));
  function load(key, fallback) {
    try { return JSON.parse(storage.getItem(key)) || fallback; } catch (ignored) { return fallback; }
  }
  function save(key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (ignored) {}
  }
  function settings() {
    var value = load(SETTINGS, {});
    // An upgrade must not re-enable a service the user disabled in 0.3.
    // Its single app-data switch also controlled UV before UV had its own choice.
    var inheritedUV = value.appData === false ? value.completeWeather === false ? 'off' : 'open-meteo' : 'chmu';
    return {stations: value.stations && typeof value.stations === 'object' && !Array.isArray(value.stations) ? value.stations : {},
      completeWeather:value.completeWeather !== false, appData:value.appData !== false,
      uvSource:['chmu','open-meteo','off'].indexOf(value.uvSource) >= 0 ? value.uvSource : inheritedUV,
      revision:Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0};
  }
  function deadline(start, timeout, budget) {
    return new Promise(function(resolve, reject) {
      var remaining = budget ? budget.endsAt - options.now() : timeout;
      if (remaining <= 0) {
        reject({code:'TIMEOUT', message:'ČHMÚ request budget exhausted'});
        return;
      }
      var done = false;
      var timer = options.later(function() {
        if (!done) { done = true; reject({code: 'TIMEOUT', message: 'ČHMÚ request timed out'}); }
      }, Math.min(timeout, remaining));
      function finish(error, value) {
        if (done) { return; }
        done = true;
        options.cancelLater(timer);
        if (error) { reject(error); } else { resolve(value); }
      }
      try { start(function(value) { finish(null, value); }, function(error) { finish(error || {code:'UNKNOWN'}); }); }
      catch (error) { finish(error); }
    });
  }
  function readSource(source, budget) {
    return deadline(function(resolve, reject) { options.readSource(source).then(resolve, reject); }, 8000, budget);
  }
  function currentPosition(budget) {
    return deadline(function(resolve, reject) {
      options.geolocation.getCurrentPosition(function(p) { resolve(p.coords); },
        function() { reject({code:'PERMISSION_DENIED', message:'Current location unavailable; check Location permission'}); },
        {maximumAge: REFRESH, timeout: 7000, enableHighAccuracy: false});
    }, 8000, budget);
  }
  function coordinates(coords) {
    return coords && typeof coords.latitude === 'number' && isFinite(coords.latitude) &&
      typeof coords.longitude === 'number' && isFinite(coords.longitude) &&
      Math.abs(coords.latitude) <= 90 && Math.abs(coords.longitude) <= 180;
  }
  async function places(budget) {
    var envelope;
    try { envelope = await readSource(LOCATIONS, budget); }
    catch (error) { if (error.code === 'PERMISSION_DENIED') { throw error; } }
    var instances = envelope && Array.isArray(envelope.instances) ? envelope.instances : [];
    if (!instances.length) {
      var coords = await currentPosition(budget);
      return coordinates(coords) ? [{id:'current', name:'Current location', latitude:coords.latitude, longitude:coords.longitude}] : [];
    }
    var position;
    var positionError;
    var result = (await Promise.all(instances.map(async function(instance) {
      if (!instance || typeof instance.instanceId !== 'string' || !instance.properties) { return null; }
      var p = instance.properties;
      var here = p.current && p.current.boolean && p.current.boolean.value;
      var coords = {latitude:p.latitude && p.latitude.numericValue && p.latitude.numericValue.value,
        longitude:p.longitude && p.longitude.numericValue && p.longitude.numericValue.value};
      if (here || !coordinates(coords)) {
        if (!here && p.latitude) { return null; }
        if (!position) { position = currentPosition(budget); }
        try { coords = await position; } catch (error) { positionError = error; return null; }
      }
      if (!coordinates(coords)) { return null; }
      return {id:instance.instanceId, name:p.name && p.name.shortText && p.name.shortText.text || instance.instanceId,
        latitude:coords.latitude, longitude:coords.longitude};
    }))).filter(function(p) { return p; });
    if (!result.length && positionError) { throw positionError; }
    return result;
  }
  async function units(budget) {
    try {
      var e = await readSource(UNITS, budget);
      var p = e.instances[0].properties;
      return {temperature:p.temperature.shortText.text === '°F' ? '°F' : '°C',
        wind:p.wind_speed && p.wind_speed.shortText.text || 'km/h'};
    } catch (ignored) { return {temperature:'°C', wind:'km/h'}; }
  }
  function cache(key, value) {
    save(PREFIX + key, value);
    var index = load(PREFIX + 'index', []);
    if (!Array.isArray(index)) { index = []; }
    index = index.filter(function(k) { return typeof k === 'string' && k !== key; });
    index.push(key);
    while (index.length > 16) {
      var old = index.shift();
      try { storage.removeItem(PREFIX + old); } catch (ignored) {}
    }
    save(PREFIX + 'index', index);
  }
  function removeCache(key) {
    try { storage.removeItem(PREFIX + key); } catch (ignored) {}
    var index = load(PREFIX + 'index', []);
    if (Array.isArray(index)) { save(PREFIX + 'index', index.filter(function(item) { return item !== key; })); }
  }
  function cacheFresh(record, ttl) {
    var checked = record.checkedAt === undefined ? record.fetchedAt : record.checkedAt;
    return !record.noStore && typeof checked === 'number' && isFinite(checked) &&
      checked <= options.now() && options.now() - checked < ttl;
  }
  function resourceResult(value, record) {
    var result = {value:value, fetchedAt:Math.floor(record.fetchedAt / 1000),
      checkedAt:Math.floor((record.checkedAt === undefined ? record.fetchedAt : record.checkedAt) / 1000)};
    if (record.noStore) { result.noStore = true; }
    return result;
  }
  async function httpJson(url, budget, headers) {
    return deadline(function(resolve, reject) {
      options.fetch(url, Object.keys(headers).length ? {headers:headers} : undefined).then(function(response) {
        if (response.status === 304) { return {response:response, notModified:true}; }
        if (!response.ok) { throw {code:'PLUGIN_UNAVAILABLE', message:'Weather HTTP ' + response.status}; }
        return Promise.resolve().then(function() { return response.json(); }).then(function(body) {
          // Some ČHMÚ graph/POI endpoints encode their JSON as a JSON string.
          if (typeof body === 'string') { body = JSON.parse(body); }
          return {response:response, body:body};
        }).catch(function() { return {response:response, invalid:true}; });
      }).then(resolve, reject);
    }, 6000, budget);
  }
  function parsedRecord(record, maxAge, parse) {
    if (!record || record.noStore || typeof record.fetchedAt !== 'number' || !isFinite(record.fetchedAt) || record.fetchedAt > options.now() ||
        options.now() - record.fetchedAt >= maxAge) { return null; }
    try { return parse(record.body); } catch (ignored) { return null; }
  }
  async function resourceRequest(key, url, ttl, maxAge, parse, force, budget) {
    var saved = load(PREFIX + key, null);
    function parsed(record) { return parsedRecord(record, maxAge, parse); }
    var previous = parsed(saved);
    if (!force && previous && cacheFresh(saved, ttl)) {
      return resourceResult(previous, saved);
    }
    try {
      var conditional = previous && saved.requestUrl === url ? httpCache.conditionalHeaders(saved) : {};
      var reply = await httpJson(url, budget, conditional);
      var policy = httpCache.policy(reply.response, options.now(), reply.notModified ? saved : null);
      if (policy.noStore) { removeCache(key); }
      var record;
      var value;
      if (reply.notModified) {
        // The cached source must still be valid NOW. A slow 304 cannot revive
        // an expired observation or reset the maximum body-download age.
        value = Object.keys(conditional).length ? parsed(saved) : null;
        if (!value) { throw {code:'PLUGIN_UNAVAILABLE', message:'No usable ČHMÚ data'}; }
        record = Object.assign({}, saved, policy);
      } else {
        value = !reply.invalid && parse(reply.body);
        record = Object.assign({body:reply.body, fetchedAt:options.now(), requestUrl:url}, policy);
      }
      if (!value) { throw {code:'PLUGIN_UNAVAILABLE', message:'No usable ČHMÚ data'}; }
      if (!policy.noStore) { cache(key, record); }
      return resourceResult(value, record);
    } catch (error) {
      // Recheck measurement time after a slow request. A cached observation can
      // expire during a timeout and must not become current again.
      previous = parsed(saved);
      if (previous && !(typeof policy !== 'undefined' && policy.noStore)) { return resourceResult(previous, saved); }
      if (typeof policy !== 'undefined' && policy.noStore) {
        throw {code:'PLUGIN_UNAVAILABLE', message:'No usable ČHMÚ data', noStore:true};
      }
      throw error;
    }
  }
  function resource(key, url, ttl, maxAge, parse, force, budget) {
    // A force refresh may join a real network request, but must not join a
    // same-turn promise whose only work was returning a cached snapshot.
    if (!force) {
      var saved = load(PREFIX + key, null);
      var value = parsedRecord(saved, maxAge, parse);
      if (value && cacheFresh(saved, ttl)) { return Promise.resolve(resourceResult(value, saved)); }
    }
    if (inFlight[key]) {
      // Another request may have started this fetch later with a longer budget.
      // Its useful work can continue, but this caller must still reply on time.
      return deadline(function(resolve, reject) { inFlight[key].then(resolve, reject); }, REQUEST_BUDGET, budget);
    }
    if (!inFlight[key]) {
      inFlight[key] = resourceRequest(key, url, ttl, maxAge, parse, force, budget).then(function(result) {
        delete inFlight[key]; return result;
      }, function(error) { delete inFlight[key]; throw error; });
    }
    return inFlight[key];
  }
  async function observation(station, force, budget, selection) {
    var detail = {observed:null, fetchedAt:0, lastSuccessfulFetch:null, latest:null, status:'unavailable',
      stationId:station && station.id || ''};
    if (!station) { return detail; }
    var parse = function(body) {
      var latest = parseStationObservation(body, options.now(), 7 * 86400);
      var bulk = body && body.data && body.data.data;
      var header = bulk && typeof bulk.header === 'string' && bulk.header.length <= 1000
        ? bulk.header.split(',').map(function(name) { return name.trim(); }) : bulk && bulk.header;
      if (latest && bulk && Array.isArray(header) && Array.isArray(bulk.values)) {
        var column = header.indexOf('STATION');
        var elementColumn = header.indexOf('ELEMENT');
        if (column >= 0 && bulk.values.some(function(row) {
          return Array.isArray(row) && row[elementColumn] === 'T' && row[column] !== station.wsi;
        })) { return null; }
      }
      return latest ? {latest:latest, observed:parseStationObservation(body, options.now(), 3600)} : null;
    };
    function accept(result) {
      detail.lastSuccessfulFetch = Math.max(detail.lastSuccessfulFetch || 0, result.fetchedAt);
      if (!detail.latest || result.value.latest.observedAt > detail.latest.observedAt) { detail.latest = result.value.latest; }
      if (result.value.observed) { detail.observed = result.value.observed; detail.fetchedAt = result.fetchedAt; detail.status = 'fresh'; }
      else if (!detail.observed && detail.latest) { detail.status = 'stale'; }
    }
    try {
      accept(await resource('climate.' + station.id, API + 'graf.meteo-stanice.klima-10m/' +
        encodeURIComponent(station.id), 5 * 60000, 3600000, parse, force, budget));
    } catch (ignored) {}
    if (detail.observed || (selection && !selection.active) || options.now() >= budget.endsAt) { return detail; }
    // Documented open data is an independent backup to the website graph API.
    var day = new Date(options.now()).toISOString().slice(0,10).replace(/-/g,'');
    var url = 'https://opendata.chmi.cz/meteorology/climate/now/data/10m-' +
      encodeURIComponent(station.wsi) + '-' + day + '.json';
    try { accept(await resource('bulk.' + station.id, url, 15 * 60000, 3600000, parse, force, budget)); }
    catch (ignored) {}
    return detail;
  }
  function supplemental(point, force, budget) {
    // Send the public forecast-town coordinates, never the phone's raw GPS.
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(point.latitude) +
      '&longitude=' + encodeURIComponent(point.longitude) +
      '&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,precipitation_probability_max' +
      '&timezone=Europe%2FPrague&timeformat=unixtime&forecast_days=7&temperature_unit=celsius&wind_speed_unit=ms&precipitation_unit=mm';
    return resource('supplement.' + point.id, url, REFRESH, MAX_FORECAST_AGE,
      function(body) { return supplementModel.parseForecast(body, options.now()); }, force, budget)
      .catch(function() { return {value:null, fetchedAt:0}; });
  }
  function nearbyStations(place) {
    return catalog.stations.map(function(station) {
      return model.nearest([station], place.latitude, place.longitude, 30);
    }).filter(function(candidate) { return candidate; }).sort(function(a, b) {
      return a.distanceKm - b.distanceKm || String(a.point.id).localeCompare(String(b.point.id));
    });
  }
  function publicStations(candidates) {
    return candidates.map(function(candidate) {
      return {id:candidate.point.id, name:candidate.point.name,
        distanceKm:Math.round(candidate.distanceKm * 10) / 10, elevation:candidate.point.elevation};
    });
  }
  function writeDiagnostic(place, generation, diagnostic) {
    if (generation !== settings().revision) { return; }
    var diagnostics = load(STATUS, {});
    diagnostics[place.id] = Object.assign({id:place.id, name:place.name, settingsRevision:generation}, diagnostic);
    save(STATUS, diagnostics);
  }
  async function location(place, request, userUnits, force, budget, completeWeather, appData, uvSource, generation) {
    var eligible = nearbyStations(place);
    var override = settings().stations[place.id];
    var priorDiagnostic = load(STATUS, {})[place.id];
    var point = model.nearest(catalog.forecastPlaces, place.latitude, place.longitude, 30);
    if (!point) {
      writeDiagnostic(place, generation, {eligibleStations:publicStations(eligible), stationMode:override ? 'manual' : 'automatic',
        requestedStationId:override || '', stationStatus:'out-of-range',
        stationReason:'No supported ČHMÚ forecast location within 30 km', uvPreference:uvSource,
        uvStatus:'unavailable', uvReason:'Location is outside supported coverage', isForecast:true});
      return null;
    }
    var supplementalPromise = completeWeather ? supplemental(point.point, force, budget) : Promise.resolve({value:null, fetchedAt:0});
    // App authentication and the two app feeds share a smaller budget. A slow
    // optional channel must still leave time for the station/public feeds.
    var appBudget = {endsAt:Math.min(budget.endsAt, options.now() + 14000)};
    function appResource(method, parser, enabled) {
      if (!enabled) { return Promise.resolve({value:null, fetchedAt:0}); }
      return appClient[method](point.point, force, appBudget).then(function(result) {
        return Object.assign({}, result, {value:parser(result.value, options.now(), point.point)});
      }).catch(function() { return {value:null, fetchedAt:0}; });
    }
    var appUVPromise = appResource('uv', parseAppUV, uvSource === 'chmu');
    var appForecastPromise = appResource('place', parseAppWeather, appData);
    // Some hours that were future/current in the last downloaded run are now
    // past. Retain them before a new run replaces the raw response cache.
    var previousForecast = load(PREFIX + 'forecast.' + point.point.id, null);
    var previousModel = parsedRecord(previousForecast, MAX_FORECAST_AGE, function(body) {
      return model.parseForecast(body, options.now());
    });
    if (previousModel) {
      forecastHistory.merge(point.point, previousModel, Math.floor(previousForecast.fetchedAt / 1000));
    }
    var forecastPromise = resource('forecast.' + point.point.id, API + 'graf.meteogram/' +
      encodeURIComponent(point.point.id), REFRESH, MAX_FORECAST_AGE,
      function(body) { return model.parseForecast(body, options.now()); }, force, budget);
    // Start both requests together. Prefer a lowland station for a lowland
    // location rather than choosing a nearby mountain station by distance alone.
    var nearby = eligible[0] || null;
    var stationStatus;
    var stationReason = '';
    if (override) {
      var station = catalog.stations.filter(function(s) { return s.id === override; })[0];
      nearby = eligible.filter(function(candidate) { return candidate.point.id === override; })[0] || null;
      if (!station) { stationStatus = 'unsupported'; stationReason = 'The selected station is no longer supported'; }
      else if (!nearby) { stationStatus = 'out-of-range'; stationReason = 'The selected station is more than 30 km from this location'; }
    }
    var selection = {active:true};
    var attempted = [];
    var controls = [];
    function start(candidate, control) {
      attempted.push(candidate.point.id);
      controls.push(control);
      return observation(candidate.point, force, budget, control);
    }
    var obsPromise = nearby ? start(nearby, selection) : Promise.resolve(null);
    var forecast;
    try { forecast = await forecastPromise; }
    catch (error) { forecast = {value:{hours:[]}, fetchedAt:0, noStore:error && error.noStore === true}; }
    // Cache-policy cleanup applies even if settings later invalidate this
    // pending request's output. Do it before waiting for other channels.
    var noStoreHistory = forecast.noStore === true ?
      forecastHistory.merge(point.point, forecast.value, forecast.fetchedAt, {noStore:true}) : null;
    var suitable = eligible;
    if (!override && typeof forecast.value.elevation === 'number') {
      suitable = eligible.filter(function(candidate) {
        return typeof candidate.point.elevation === 'number' && Math.abs(candidate.point.elevation - forecast.value.elevation) <= 150;
      });
      var chosen = suitable[0] || null;
      if ((!chosen && nearby) || (chosen && (!nearby || chosen.point.id !== nearby.point.id))) {
        // We never silently attribute a mountain reading to another location.
        selection.active = false;
        selection = {active:true};
        nearby = chosen;
        // The first station may still be waiting for its graph or bulk backup.
        // Do not serialize an unrelated, corrected station behind that work.
        obsPromise = nearby ? start(nearby, selection) : Promise.resolve(null);
      }
    }
    var detail = await obsPromise;
    var attemptedDetails = detail ? [detail] : [];
    if (!override && (!detail || !detail.observed) && attempted.length < 3 && options.now() < budget.endsAt) {
      var backups = suitable.filter(function(candidate) { return attempted.indexOf(candidate.point.id) < 0; }).slice(0, 3 - attempted.length);
      // Try at most two alternatives concurrently, then choose by distance
      // order. A fast distant response cannot beat a fresh closer station.
      var pending = backups.map(function(candidate) { return start(candidate, {active:true}); });
      for (var i = 0; i < pending.length; i++) {
        var alternative = await pending[i];
        attemptedDetails.push(alternative);
        if (alternative.observed && options.now() / 1000 - alternative.observed.observedAt <= 3600) {
          nearby = backups[i]; detail = alternative; break;
        }
      }
    }
    controls.forEach(function(control) { control.active = false; });
    if (!override && (!detail || !detail.observed)) {
      // If none is current, describe the closest attempted station for which
      // an original sample exists. Keep its name and sample tied together.
      var staleDetail = attemptedDetails.filter(function(candidate) { return candidate && candidate.latest; })[0];
      if (staleDetail) {
        detail = staleDetail;
        nearby = eligible.filter(function(candidate) { return candidate.point.id === detail.stationId; })[0] || nearby;
      }
    }
    var observed = detail && detail.observed;
    if (observed && options.now() / 1000 - observed.observedAt > 3600) { observed = null; }
    if (!stationStatus) {
      if (!nearby || !suitable.length) {
        stationStatus = 'no-suitable-station';
        stationReason = eligible.length ? 'No nearby station has a comparable elevation (within 150 m)' : 'No supported measurement station within 30 km';
      } else if (observed) {
        stationStatus = 'fresh';
        stationReason = attempted.length > 1 ? 'Using the nearest suitable station with a fresh measurement' : 'Fresh station measurement';
      } else {
        stationStatus = attemptedDetails.some(function(candidate) { return candidate && candidate.latest; }) ? 'stale' : 'unavailable';
        stationReason = stationStatus === 'stale' ? 'Available station measurements are older than one hour' : 'Nearby station measurement feeds are unavailable';
      }
    }
    var extra = await supplementalPromise;
    var appResults = await Promise.all([appUVPromise, appForecastPromise]);
    // Optional feeds can finish after a once-fresh station sample expires.
    // Keep the explanation consistent with the envelope's final freshness check.
    if (observed && options.now() / 1000 - observed.observedAt > 3600) {
      observed = null;
      stationStatus = 'stale';
      stationReason = 'The station measurement became older than one hour while refreshing';
    }
    // A settings change can happen while any network channel is pending. Do
    // not publish an old-mode response or put it back into source diagnostics.
    if (generation !== settings().revision) { return null; }
    var retained = noStoreHistory || forecastHistory.merge(point.point, forecast.value, forecast.fetchedAt);
    // Coalesced consumers can share forecast.value: never add history to it.
    var displayForecast = Object.assign({}, forecast.value, retained);
    var instance = buildInstance({place:place, forecast:displayForecast,
      supplemental:extra.value, supplementalFetchedAt:extra.fetchedAt,
      uvSource:uvSource,
      appUV:appResults[0].value, appUVFetchedAt:appResults[0].fetchedAt,
      appForecast:appResults[1].value, appForecastFetchedAt:appResults[1].fetchedAt,
      observation:observed, station:nearby && Object.assign({}, nearby.point, {distanceKm:nearby.distanceKm}),
      now:options.now(), fetchedAt:forecast.fetchedAt, units:userUnits, request:request});
    var properties = instance ? instance.properties : {};
    var latest = detail && detail.latest;
    var latestStation = nearby && nearby.point;
    attemptedDetails.forEach(function(candidate) {
      if (candidate && candidate.latest && (!latest || candidate.latest.observedAt > latest.observedAt)) {
        latest = candidate.latest;
        latestStation = catalog.stations.filter(function(station) { return station.id === candidate.stationId; })[0];
      }
    });
    var lastSuccessfulFetch = detail && detail.lastSuccessfulFetch;
    attemptedDetails.forEach(function(candidate) {
      if (candidate) { lastSuccessfulFetch = Math.max(lastSuccessfulFetch || 0, candidate.lastSuccessfulFetch || 0) || null; }
    });
    if (!latest && priorDiagnostic && priorDiagnostic.requestedStationId === (override || '') &&
        priorDiagnostic.stationId === (nearby && nearby.point.id || '') &&
        priorDiagnostic.latestSampleStationId === priorDiagnostic.stationId) {
      latest = priorDiagnostic.latestSampleAt ? {observedAt:priorDiagnostic.latestSampleAt, temperatureC:priorDiagnostic.latestSampleTemperatureC} : null;
      lastSuccessfulFetch = lastSuccessfulFetch || priorDiagnostic.lastSuccessfulFetch || null;
    }
    var uvAvailable = !!properties.uv_index;
    var actualUVSource = properties.uv_source && properties.uv_source.longText.text || '';
    var uvFallback = uvSource === 'chmu' && uvAvailable && actualUVSource.indexOf('Open-Meteo') >= 0;
    writeDiagnostic(place, generation, {station:nearby && nearby.point.name || '',
      stationId:nearby && nearby.point.id || '', distanceKm:nearby ? Math.round(nearby.distanceKm * 10) / 10 : null,
      eligibleStations:publicStations(eligible), requestedStationId:override || '', stationMode:override ? 'manual' : 'automatic',
      stationStatus:stationStatus, stationReason:stationReason, lastSuccessfulFetch:lastSuccessfulFetch,
      observationFetchedAt:detail && detail.fetchedAt || null, latestSampleAt:latest && latest.observedAt || null,
      latestSampleStationId:latest && latestStation ? latestStation.id : '',
      latestSampleStationName:latest && latestStation ? latestStation.name : '',
      latestSampleTemperatureC:latest ? latest.temperatureC : null,
      measurementAgeSec:latest ? Math.max(0, Math.floor(options.now() / 1000) - latest.observedAt) : null,
      temperature:properties.temperature && properties.temperature.shortText.text || '',
      observedAt:properties.observed_at ? properties.observed_at.timestamp.value : null, fetchedAt:forecast.fetchedAt,
      temperatureSource:properties.source && properties.source.longText.text || '',
      isForecast:properties.is_forecast && properties.is_forecast.boolean.value || false,
      feelsLike:properties.feels_like && properties.feels_like.shortText.text || '',
      feelsLikeSource:properties.feels_like_source && properties.feels_like_source.longText.text || '',
      humidity:properties.humidity && properties.humidity.shortText.text || '',
      humiditySource:properties.humidity_source && properties.humidity_source.longText.text || '',
      humidityObservedAt:properties.humidity_observed_at && properties.humidity_observed_at.timestamp.value,
      wind:properties.wind_speed && properties.wind_speed.shortText.text || '',
      windSource:properties.wind_source && properties.wind_source.longText.text || '',
      windObservedAt:properties.wind_observed_at && properties.wind_observed_at.timestamp.value,
      uvIndex:properties.uv_index && properties.uv_index.numericValue.value,
      uvSource:actualUVSource,
      uvUpdatedAt:properties.uv_updated_at && properties.uv_updated_at.timestamp.value,
      uvPreference:uvSource, uvStatus:uvSource === 'off' ? 'disabled' : uvFallback ? 'fallback' : uvAvailable ? 'available' : 'unavailable',
      uvReason:uvSource === 'off' ? 'UV display disabled' : uvFallback ? 'ČHMÚ UV unavailable; using the enabled Open-Meteo supplement' : uvAvailable ? '' :
        uvSource === 'open-meteo' && !completeWeather ? 'Open-Meteo UV requires the Open-Meteo supplement to be enabled' :
        uvSource === 'chmu' ? 'ČHMÚ clear-sky UV forecast unavailable for today' : 'Open-Meteo UV forecast unavailable for today',
      appForecastUpdatedAt:properties.app_forecast_updated_at && properties.app_forecast_updated_at.timestamp.value,
      appDataLastChecked:Math.max(appResults[0].value && appResults[0].checkedAt || 0,
        appResults[1].value && appResults[1].checkedAt || 0) || null,
      retainedForecastHours:properties.forecast_history_hours && properties.forecast_history_hours.numericValue.value || 0,
      forecastHistoryOldestDownload:properties.forecast_history_oldest_download && properties.forecast_history_oldest_download.timestamp.value,
      todayRangeComplete:properties.today_range_complete ? properties.today_range_complete.boolean.value : null,
      appDataStatus:!appData ? 'ČHMÚ full-day forecasts disabled' :
        !appResults[1].value ? 'ČHMÚ full-day forecasts unavailable; using other enabled sources' : '',
      precipitation:properties.precipitation && properties.precipitation.numericValue.value,
      forecastDays:properties.daily_high ? properties.daily_high.series.numericValue.values.length : 0,
      supplementalSource:properties.supplemental_source && properties.supplemental_source.longText.text || ''});
    return instance;
  }
  async function getWeather(request, force) {
    if (request.category !== 'weather' || request.item !== 'location') {
      throw {code:'INVALID_REQUEST', message:'Unsupported source'};
    }
    var budget = {endsAt:options.now() + REQUEST_BUDGET};
    if (options.subscribeSource) { options.subscribeSource(LOCATIONS); options.subscribeSource(UNITS); }
    var data = await Promise.all([places(budget), units(budget)]);
    var diagnostics = load(STATUS, {});
    var active = {};
    data[0].forEach(function(place) { if (diagnostics[place.id]) { active[place.id] = diagnostics[place.id]; } });
    save(STATUS, active);
    var errors = [];
    // Source handlers and settings can run in different JS engines. Read a
    // persisted revision, rather than relying on a process-local generation.
    var selected = settings();
    var completeWeather = selected.completeWeather;
    var appData = selected.appData;
    var uvSource = selected.uvSource;
    var generation = selected.revision;
    var instances = (await Promise.all(data[0].map(async function(place) {
      try { return await location(place, request, data[1], force, budget, completeWeather, appData, uvSource, generation); }
      catch (error) { errors.push(error); return null; }
    }))).filter(function(instance) { return instance; });
    if (generation !== settings().revision) {
      throw {code:'PLUGIN_UNAVAILABLE', message:'Weather sources changed; refresh again'};
    }
    // Keep failed saved locations visible so settings can explain stale feeds
    // and out-of-range manual selections. Removed locations are still pruned.
    diagnostics = load(STATUS, {});
    active = {};
    data[0].forEach(function(place) {
      if (diagnostics[place.id]) { active[place.id] = diagnostics[place.id]; }
    });
    save(STATUS, active);
    if (!instances.length) {
      throw errors[0] || {code:'PLUGIN_UNAVAILABLE', message:'No supported Czech location or usable ČHMÚ weather'};
    }
    var expires = options.now() + REFRESH;
    instances.forEach(function(instance) {
      var p = instance.properties;
      if (p.observed_at) {
        expires = Math.min(expires, p.observed_at.timestamp.value * 1000 + 3600000);
        // At the next hour the native UI selects another series slot. Mark the
        // payload expired then; the phone host still controls actual polling.
        var series = p.hourly_source && p.hourly_source.series;
        if (series && series.longText) {
          var active = series.longText.values.indexOf('ČHMÚ station measurement');
          if (active >= 0) { expires = Math.min(expires, (series.start + (active + 1) * series.stepSec) * 1000); }
        }
      }
      if (p.forecast_updated_at) { expires = Math.min(expires, p.forecast_updated_at.timestamp.value * 1000 + MAX_FORECAST_AGE); }
      if (p.supplemental_updated_at) { expires = Math.min(expires, p.supplemental_updated_at.timestamp.value * 1000 + MAX_FORECAST_AGE); }
      if (p.app_data_fetched_at) { expires = Math.min(expires, p.app_data_fetched_at.timestamp.value * 1000 + MAX_FORECAST_AGE); }
      if (p.app_forecast_updated_at) { expires = Math.min(expires, p.app_forecast_updated_at.timestamp.value * 1000 + MAX_FORECAST_AGE); }
      if (p.uv_updated_at) { expires = Math.min(expires, p.uv_updated_at.timestamp.value * 1000 + 7 * 86400000); }
    });
    return {validUntilMs:Math.max(options.now() + 1000, expires), instances:instances};
  }
  function state() {
    var selected = settings();
    var locations = Object.values(load(STATUS, {})).filter(function(value) {
      return value && (value.settingsRevision || 0) === selected.revision;
    });
    return {version:'0.5.0', settings:selected, locations:locations};
  }
  function setStation(locationId, stationId) {
    if (typeof locationId !== 'string' || !locationId || locationId.length > 128 ||
        locationId === '__proto__' || locationId === 'constructor' ||
        typeof stationId !== 'string' || (stationId && !catalog.stations.some(function(s) { return s.id === stationId; }))) {
      throw {code:'INVALID_ARGS', message:'Unknown station or location'};
    }
    var diagnostic = load(STATUS, {})[locationId];
    if (stationId && diagnostic && Array.isArray(diagnostic.eligibleStations) &&
        !diagnostic.eligibleStations.some(function(station) { return station.id === stationId; })) {
      throw {code:'INVALID_ARGS', message:'Choose a station within 30 km of this location'};
    }
    var s = settings();
    if ((s.stations[locationId] || '') !== stationId) {
      var previousRevision = s.revision;
      s.revision++;
      var diagnostics = load(STATUS, {});
      delete diagnostics[locationId];
      Object.keys(diagnostics).forEach(function(id) {
        if (diagnostics[id] && (diagnostics[id].settingsRevision || 0) === previousRevision) {
          diagnostics[id].settingsRevision = s.revision;
        } else { delete diagnostics[id]; }
      });
      save(STATUS, diagnostics);
    }
    if (stationId) { s.stations[locationId] = stationId; } else { delete s.stations[locationId]; }
    save(SETTINGS, s);
    return state();
  }
  function setCompleteWeather(enabled) {
    if (typeof enabled !== 'boolean') { throw {code:'INVALID_ARGS', message:'Choose whether complete weather data is enabled'}; }
    var s = settings();
    if (s.completeWeather !== enabled) { s.revision++; save(STATUS, {}); }
    s.completeWeather = enabled;
    save(SETTINGS, s);
    return state();
  }
  function setAppData(enabled) {
    if (typeof enabled !== 'boolean') { throw {code:'INVALID_ARGS', message:'Choose whether ČHMÚ app data is enabled'}; }
    var s = settings();
    if (s.appData !== enabled) { s.revision++; save(STATUS, {}); }
    s.appData = enabled;
    save(SETTINGS, s);
    return state();
  }
  function setUVSource(source) {
    if (['chmu','open-meteo','off'].indexOf(source) < 0) { throw {code:'INVALID_ARGS', message:'Choose a supported UV source'}; }
    var s = settings();
    if (s.uvSource !== source) { s.revision++; save(STATUS, {}); }
    s.uvSource = source;
    save(SETTINGS, s);
    return state();
  }
  return {getWeather:getWeather, state:state, setStation:setStation, setCompleteWeather:setCompleteWeather, setAppData:setAppData, setUVSource:setUVSource};
};
