'use strict';
var model = require('./weather');
var supplementModel = require('./supplement');
var createAppClient = require('./app-client').createClient;
var parseAppUV = require('./app-uv').parseUV;
var parseAppWeather = require('./app-weather').parseWeather;
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
  var appClient = createAppClient(Object.assign({}, options, {
    isEnabled:function() { return settings().appData; },
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
    return {stations: value.stations && typeof value.stations === 'object' && !Array.isArray(value.stations) ? value.stations : {},
      completeWeather:value.completeWeather !== false, appData:value.appData !== false,
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
  async function httpJson(url, budget) {
    return deadline(function(resolve, reject) {
      options.fetch(url).then(function(response) {
        if (!response.ok) { throw {code:'PLUGIN_UNAVAILABLE', message:'Weather HTTP ' + response.status}; }
        return response.json();
      }).then(function(body) {
        // Some ČHMÚ graph/POI endpoints encode their JSON as a JSON string.
        if (typeof body === 'string') { body = JSON.parse(body); }
        resolve(body);
      }).catch(reject);
    }, 6000, budget);
  }
  async function resourceRequest(key, url, ttl, maxAge, parse, force, budget) {
    var saved = load(PREFIX + key, null);
    function parsed(record) {
      if (!record || typeof record.fetchedAt !== 'number' || record.fetchedAt > options.now() ||
          options.now() - record.fetchedAt >= maxAge) { return null; }
      try { return parse(record.body); } catch (ignored) { return null; }
    }
    var previous = parsed(saved);
    if (!force && previous && options.now() - saved.fetchedAt < ttl) {
      return {value:previous, fetchedAt:Math.floor(saved.fetchedAt / 1000)};
    }
    try {
      var body = await httpJson(url, budget);
      var value = parse(body);
      if (!value) { throw {code:'PLUGIN_UNAVAILABLE', message:'No usable ČHMÚ data'}; }
      var fetchedAt = options.now();
      cache(key, {body:body, fetchedAt:fetchedAt});
      return {value:value, fetchedAt:Math.floor(fetchedAt / 1000)};
    } catch (error) {
      // Recheck measurement time after a slow request. A cached observation can
      // expire during a timeout and must not become current again.
      previous = parsed(saved);
      if (previous) { return {value:previous, fetchedAt:Math.floor(saved.fetchedAt / 1000)}; }
      throw error;
    }
  }
  function resource(key, url, ttl, maxAge, parse, force, budget) {
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
    if (!station) { return null; }
    var parse = function(body) {
      var measured = model.parseObservation(body, options.now(), 3600);
      var bulk = body && body.data && body.data.data;
      var header = bulk && typeof bulk.header === 'string' && bulk.header.length <= 1000
        ? bulk.header.split(',').map(function(name) { return name.trim(); }) : bulk && bulk.header;
      if (measured && bulk && Array.isArray(header) && Array.isArray(bulk.values)) {
        var column = header.indexOf('STATION');
        var elementColumn = header.indexOf('ELEMENT');
        if (column >= 0 && bulk.values.some(function(row) {
          return Array.isArray(row) && row[elementColumn] === 'T' && row[column] !== station.wsi;
        })) { return null; }
      }
      return measured;
    };
    try {
      return (await resource('station.' + station.id, API + 'graf.meteo-stanice.teplota-10m/' +
        encodeURIComponent(station.id), 5 * 60000, 3600000, parse, force, budget)).value;
    } catch (ignored) {
      // If elevation selection replaced this station, its shared graph request
      // can finish for other consumers; do not start a discarded bulk backup.
      if (selection && !selection.active) { return null; }
      // Documented open data is an independent backup to the website graph API.
      var day = new Date(options.now()).toISOString().slice(0,10).replace(/-/g,'');
      var url = 'https://opendata.chmi.cz/meteorology/climate/now/data/10m-' +
        encodeURIComponent(station.wsi) + '-' + day + '.json';
      try { return (await resource('bulk.' + station.id, url, 15 * 60000, 3600000, parse, force, budget)).value; }
      catch (unavailable) { return null; }
    }
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
  async function location(place, request, userUnits, force, budget, completeWeather, appData, generation) {
    var point = model.nearest(catalog.forecastPlaces, place.latitude, place.longitude, 30);
    if (!point) { return null; }
    var supplementalPromise = completeWeather ? supplemental(point.point, force, budget) : Promise.resolve({value:null, fetchedAt:0});
    // App authentication and the two app feeds share a smaller budget. A slow
    // optional channel must still leave time for the station/public feeds.
    var appBudget = {endsAt:Math.min(budget.endsAt, options.now() + 10000)};
    function appResource(method, parser) {
      if (!appData) { return Promise.resolve({value:null, fetchedAt:0}); }
      return appClient[method](point.point, force, appBudget).then(function(result) {
        return {value:parser(result.value, options.now(), point.point), fetchedAt:result.fetchedAt};
      }).catch(function() { return {value:null, fetchedAt:0}; });
    }
    var appUVPromise = appResource('uv', parseAppUV);
    var appForecastPromise = appResource('place', parseAppWeather);
    var forecastPromise = resource('forecast.' + point.point.id, API + 'graf.meteogram/' +
      encodeURIComponent(point.point.id), REFRESH, MAX_FORECAST_AGE,
      function(body) { return model.parseForecast(body, options.now()); }, force, budget);
    // Start both requests together. Prefer a lowland station for a lowland
    // location rather than choosing a nearby mountain station by distance alone.
    var nearby = model.nearest(catalog.stations, place.latitude, place.longitude, 30);
    var override = settings().stations[place.id];
    if (override) {
      var station = catalog.stations.filter(function(s) { return s.id === override; })[0];
      nearby = station ? model.nearest([station], place.latitude, place.longitude, 30) : null;
    }
    var selection = {active:true};
    var obsPromise = observation(nearby && nearby.point, force, budget, selection);
    var forecast;
    try { forecast = await forecastPromise; }
    catch (error) { forecast = {value:{hours:[]}, fetchedAt:0}; }
    if (!override && typeof forecast.value.elevation === 'number') {
      var suitable = catalog.stations.filter(function(s) {
        return typeof s.elevation === 'number' && Math.abs(s.elevation - forecast.value.elevation) <= 150;
      });
      var chosen = model.nearest(suitable, place.latitude, place.longitude, 30);
      if ((!chosen && nearby) || (chosen && (!nearby || chosen.point.id !== nearby.point.id))) {
        // We never silently attribute a mountain reading to another location.
        selection.active = false;
        selection = {active:true};
        nearby = chosen;
        // The first station may still be waiting for its graph or bulk backup.
        // Do not serialize an unrelated, corrected station behind that work.
        obsPromise = observation(nearby && nearby.point, force, budget, selection);
      }
    }
    var observed = await obsPromise;
    var extra = await supplementalPromise;
    var appResults = await Promise.all([appUVPromise, appForecastPromise]);
    // A settings change can happen while any network channel is pending. Do
    // not publish an old-mode response or put it back into source diagnostics.
    if (generation !== settings().revision) { return null; }
    var instance = buildInstance({place:place, forecast:forecast.value,
      supplemental:extra.value, supplementalFetchedAt:extra.fetchedAt,
      appUV:appResults[0].value, appUVFetchedAt:appResults[0].fetchedAt,
      appForecast:appResults[1].value, appForecastFetchedAt:appResults[1].fetchedAt,
      observation:observed, station:nearby && Object.assign({}, nearby.point, {distanceKm:nearby.distanceKm}),
      now:options.now(), fetchedAt:forecast.fetchedAt, units:userUnits, request:request});
    if (!instance) { return null; }
    var properties = instance.properties;
    var diagnostics = load(STATUS, {});
    diagnostics[place.id] = {id:place.id, name:place.name, settingsRevision:generation, station:nearby && nearby.point.name || '',
      stationId:nearby && nearby.point.id || '', distanceKm:nearby ? Math.round(nearby.distanceKm * 10) / 10 : null,
      temperature:properties.temperature && properties.temperature.shortText.text || '',
      observedAt:properties.observed_at ? properties.observed_at.timestamp.value : null, fetchedAt:forecast.fetchedAt,
      temperatureSource:properties.source && properties.source.longText.text || '',
      isForecast:properties.is_forecast && properties.is_forecast.boolean.value || false,
      feelsLike:properties.feels_like && properties.feels_like.shortText.text || '',
      feelsLikeSource:properties.feels_like_source && properties.feels_like_source.longText.text || '',
      uvIndex:properties.uv_index && properties.uv_index.numericValue.value,
      uvSource:properties.uv_source && properties.uv_source.longText.text || '',
      uvUpdatedAt:properties.uv_updated_at && properties.uv_updated_at.timestamp.value,
      appForecastUpdatedAt:properties.app_forecast_updated_at && properties.app_forecast_updated_at.timestamp.value,
      appDataStatus:!appData ? 'ČHMÚ app data disabled' :
        !appResults[0].value && !appResults[1].value ? 'ČHMÚ app data unavailable; using other enabled sources' : '',
      precipitation:properties.precipitation && properties.precipitation.numericValue.value,
      forecastDays:properties.daily_high ? properties.daily_high.series.numericValue.values.length : 0,
      supplementalSource:properties.supplemental_source && properties.supplemental_source.longText.text || ''};
    save(STATUS, diagnostics);
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
    var generation = selected.revision;
    var instances = (await Promise.all(data[0].map(async function(place) {
      try { return await location(place, request, data[1], force, budget, completeWeather, appData, generation); }
      catch (error) { errors.push(error); return null; }
    }))).filter(function(instance) { return instance; });
    if (generation !== settings().revision) {
      throw {code:'PLUGIN_UNAVAILABLE', message:'Weather sources changed; refresh again'};
    }
    // A still-saved location can move out of coverage or lose all usable data.
    // Only returned instances describe the current request's valid diagnostics.
    diagnostics = load(STATUS, {});
    active = {};
    instances.forEach(function(instance) {
      if (diagnostics[instance.instanceId]) { active[instance.instanceId] = diagnostics[instance.instanceId]; }
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
    return {version:'0.3.0', settings:selected, locations:locations,
      stations:catalog.stations.map(function(s) { return {id:s.id, name:s.name}; })};
  }
  function setStation(locationId, stationId) {
    if (typeof locationId !== 'string' || !locationId || locationId.length > 128 ||
        locationId === '__proto__' || locationId === 'constructor' ||
        typeof stationId !== 'string' || (stationId && !catalog.stations.some(function(s) { return s.id === stationId; }))) {
      throw {code:'INVALID_ARGS', message:'Unknown station or location'};
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
  return {getWeather:getWeather, state:state, setStation:setStation, setCompleteWeather:setCompleteWeather, setAppData:setAppData};
};
