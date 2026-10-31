'use strict';
// Real source + PBW JavaScript run against live services. All HTTP, including
// anonymous installation authentication, passes through the urllib bridge.
// Credentials stay in child-process pipes and separate in-memory secure storage.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../src/catalog.json');
const createClient = require('../src/lib/client');
const {parseObservation} = require('../src/lib/station-observation');
const {parseUV} = require('../src/lib/app-uv');
const {parseWeather} = require('../src/lib/app-weather');
const manifest = require('../package.json').pebble;
const ROOT = path.resolve(__dirname, '..');
const REQUEST = {category:'weather', item:'location'};
const APP = 'chmu.rails.cz';
const OM = 'api.open-meteo.com';
const AUTH_KEY = 'chmu.app.auth.v1';
const ID_KEY = 'chmu.app.install.v1';
const POINT = catalog.forecastPlaces.find(p => String(p.id) === '75');
const ALLOWED = ['data-provider.chmi.cz','opendata.chmi.cz',OM,APP].sort();
const declared = manifest.usesPermissions.find(p => p && p.name === 'Internet').parameters.domains;
assert.deepEqual([...declared].sort(), ALLOWED, 'The transport must match the four manifest domains');
assert.ok(POINT, 'The live check requires the bundled České Budějovice forecast point');

const localValues = new Map();
const secretValues = new Map();
const storage = {
  getItem:k => localValues.get(k) ?? null,
  setItem:(k,v) => localValues.set(k,v),
  removeItem:k => localValues.delete(k)
};
const secureStorage = {
  getItem:async k => secretValues.get(k) ?? null,
  setItem:async (k,v) => { secretValues.set(k,v); },
  removeItem:async k => { secretValues.delete(k); }
};
const calls = [];
const bodies = new Map(); // Only public weather bodies; authentication is never retained here.
const weatherResponses = [];
const children = new Set();
const idleWaiters = [];
let ownLoginIds = 0;
let authenticatedGets = 0;
let safetyFailures = 0;
let loginMetadata = null;
let phase = 'startup';
let bundleDigest = null;

function callCounts() {
  const grouped = {};
  for (const c of calls) {
    const key = c.method + ' ' + c.host + c.pathname + ' ' + c.status;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  return grouped;
}
function count(host, prefix='') {
  return calls.filter(c => c.host === host && c.pathname.startsWith(prefix)).length;
}
function unwrap(body) { return typeof body === 'string' ? JSON.parse(body) : body; }
function latestBody(host, pathname) {
  const matches = [...bodies].filter(([url]) => {
    const parsed = new URL(url);
    return parsed.hostname === host && parsed.pathname === pathname;
  });
  return matches.length ? unwrap(matches[matches.length-1][1]) : null;
}
function storedTokens() {
  let tokens;
  try { tokens = JSON.parse(secretValues.get(AUTH_KEY)); } catch (_) {}
  assert.ok(tokens && typeof tokens.access_token === 'string' && tokens.access_token.length > 0 &&
    typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0,
  'Live app login must persist usable credentials through secureStorage');
  const plain = JSON.stringify([...localValues]);
  assert.ok(!localValues.has(AUTH_KEY), 'Credentials must not be saved in localStorage');
  assert.ok(!plain.includes(tokens.access_token) && !plain.includes(tokens.refresh_token),
    'Service tokens must not leak into the public weather cache or settings');
  return tokens;
}
function requestSafety(url, init) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === 'https:' && ALLOWED.includes(parsed.hostname), 'Only manifest HTTPS domains are allowed');
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    assert.ok(parsed.hostname === APP && ['/api/v1/jwt/login','/api/v1/jwt/verify_refresh_token','/api/v1/jwt/refresh'].includes(parsed.pathname),
      'Only installation authentication may use POST');
    assert.equal(method, 'POST');
  }
  if (parsed.hostname === APP && parsed.pathname === '/api/v1/jwt/login') {
    const body = JSON.parse(init.body);
    const id = JSON.parse(localValues.get(ID_KEY));
    assert.ok(typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
      'Login must use this plugin installation’s generated UUID');
    assert.ok(body && body.device && body.device.device_token === id,
      'Login must use the plugin-owned installation identifier');
    assert.deepEqual(Object.keys(body.device).sort(), ['device_token','platform']);
    assert.equal(body.device.platform, 'android');
    ownLoginIds++;
  }
  if (parsed.hostname === APP && ['/api/v1/jwt/verify_refresh_token','/api/v1/jwt/refresh'].includes(parsed.pathname)) {
    const body = JSON.parse(init.body);
    const tokens = storedTokens();
    assert.deepEqual(Object.keys(body),['refresh_token']);
    assert.ok(body.refresh_token === tokens.refresh_token,
      'Session renewal must use this test installation’s own securely stored refresh token');
  }
  if (parsed.hostname === APP && method === 'GET') {
    const authorization = init.headers && init.headers.Authorization;
    const tokens = storedTokens();
    assert.ok(authorization === 'Bearer ' + tokens.access_token, 'App weather GET must use this session’s secure credential');
    authenticatedGets++;
  }
  if (parsed.hostname === OM || (parsed.hostname === APP && method === 'GET')) {
    const latitude = parsed.searchParams.get(parsed.hostname === OM ? 'latitude' : 'lat');
    const longitude = parsed.searchParams.get(parsed.hostname === OM ? 'longitude' : 'lng');
    assert.equal(latitude, String(POINT.latitude), 'Remote requests use public forecast-town latitude');
    assert.equal(longitude, String(POINT.longitude), 'Remote requests use public forecast-town longitude');
  }
  return {host:parsed.hostname, pathname:parsed.pathname, method, status:0};
}
function bridge(url, init={}) {
  let record;
  try { record = requestSafety(url, init); } catch (error) { safetyFailures++; throw error; }
  record.startedAt = Date.now();
  calls.push(record);
  return new Promise((resolve,reject) => {
    const child = spawn(process.env.CHMU_SMOKE_PYTHON || 'python3', [path.join(__dirname,'http-json.py')],
      {cwd:ROOT, stdio:['pipe','pipe','pipe']});
    children.add(child);
    let output = '';
    let done = false;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      children.delete(child);
      if (!children.size) idleWaiters.splice(0).forEach(resolve => resolve());
      if (error) reject(error); else resolve(result);
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Developer HTTPS transport timed out'));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 6*1024*1024) {
        child.kill();
        finish(new Error('Developer HTTPS response exceeded its size limit'));
      }
    });
    // Child diagnostics must never be surfaced: they could contain HTTP details.
    child.stderr.resume();
    child.on('error', () => finish(new Error('Developer HTTPS transport could not start')));
    child.on('close', code => {
      if (done) return;
      let response;
      try { response = JSON.parse(output); } catch (_) {}
      if (code !== 0 || !response || !Number.isInteger(response.status)) {
        finish(new Error('Developer HTTPS transport returned an invalid response')); return;
      }
      record.status = response.status;
      record.durationMs = Date.now()-record.startedAt;
      if (record.pathname === '/api/v1/jwt/login') {
        const body = response.body;
        loginMetadata = {keys:body && typeof body === 'object' ? Object.keys(body).sort() : [],
          accessTokenType:typeof (body && body.access_token), accessTokenLength:typeof body?.access_token === 'string' ? body.access_token.length : 0,
          refreshTokenType:typeof (body && body.refresh_token), refreshTokenLength:typeof body?.refresh_token === 'string' ? body.refresh_token.length : 0};
      }
      if (!record.pathname.startsWith('/api/v1/jwt/') && response.status >= 200 && response.status < 300) {
        bodies.set(url,response.body);
        weatherResponses.push({url,body:response.body});
      }
      finish(null,{ok:response.status >= 200 && response.status < 300, status:response.status,
        json:async () => response.body});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({url,init}));
  });
}
async function transportIdle() {
  // Settings checks count newly started requests. Let prior real HTTP and its
  // in-flight cleanup finish first; overlapping updates are covered by unit tests.
  do {
    if (children.size) await new Promise(resolve => idleWaiters.push(resolve));
    await new Promise(resolve => setImmediate(resolve));
  } while (children.size);
}
const geolocation = {getCurrentPosition:() => { throw new Error('Saved coordinates must not invoke GPS'); }};
const pebble = {
  readSource:async request => request.item === 'units'
    ? {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:'°C'}},wind_speed:{shortText:{text:'km/h'}}}}]}
    : {instances:[{instanceId:'smoke-city-75',properties:{name:{shortText:{text:'České Budějovice'}},
      latitude:{numericValue:{value:48.975}},longitude:{numericValue:{value:14.476}},current:{boolean:{value:false}}}}]},
  subscribeSource:() => {}
};
const options = {catalog,storage,secureStorage,fetch:bridge,readSource:pebble.readSource,
  subscribeSource:pebble.subscribeSource,geolocation,randomUUID:crypto.randomUUID,
  now:Date.now,later:setTimeout,cancelLater:clearTimeout};
function properties(envelope) {
  assert.ok(envelope && envelope.instances && envelope.instances.length === 1, 'Live weather must return the saved Czech location');
  assert.equal(envelope.instances[0].instanceId,'smoke-city-75');
  const p = envelope.instances[0].properties;
  if (p.observed_at && p.hourly_source) {
    const series = p.hourly_source.series;
    const active = series.longText.values.indexOf('ČHMÚ station measurement');
    assert.ok(active >= 0, 'Measured response must identify its active hourly slot');
    const nextHour = (series.start+(active+1)*series.stepSec)*1000;
    assert.ok(envelope.validUntilMs <= nextHour, 'Native measurement blend must expire by the next hour');
  }
  return p;
}
function verifyMeasured(p) {
  assert.equal(p.source?.longText?.text, 'ČHMÚ station measurement', 'Live station measurement branch must be verified');
  assert.equal(p.is_forecast.boolean.value,false);
  assert.ok(p.observed_at && p.station, 'Measurement provenance must be present');
  const diagnostic = JSON.parse(localValues.get('chmu.status.v1'))['smoke-city-75'];
  const station = catalog.stations.find(item => item.id === diagnostic.stationId);
  assert.ok(station, 'Measured reading must identify a bundled station');
  const observations = weatherResponses.filter(({url}) => {
    const parsed = new URL(url);
    return parsed.hostname === 'data-provider.chmi.cz' && parsed.pathname === '/api/graphs/graf.meteo-stanice.klima-10m/'+station.id ||
      parsed.hostname === 'opendata.chmi.cz' && parsed.pathname.includes('/10m-'+station.wsi+'-');
  }).map(({body}) => parseObservation(unwrap(body),Date.now(),3600)).filter(Boolean);
  const observation = observations.find(value => value.observedAt === p.observed_at.timestamp.value &&
    value.temperatureC === p.temperature.numericValue.value);
  assert.ok(observation, 'The output observation must match the live selected-station graph or bulk sample');
  for (const field of ['humidity','windSpeed','windDirection']) {
    assert.equal(typeof observation[field],'number','Live station '+field+' branch must be verified');
  }
  assert.equal(p.humidity.numericValue.value,observation.humidity);
  assert.equal(p.humidity_source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.humidity_observed_at.timestamp.value,observation.observedAt,'Measured humidity must share the temperature timestamp');
  assert.equal(p.wind_speed.numericValue.unit,'km/h');
  assert.equal(p.wind_speed.numericValue.value,observation.windSpeed*3.6);
  assert.equal(p.wind_direction.numericValue.value,observation.windDirection);
  assert.equal(p.wind_source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.wind_observed_at.timestamp.value,observation.observedAt,'Measured wind must share the temperature timestamp');
  assert.equal(diagnostic.stationStatus,'fresh');
  assert.equal(diagnostic.latestSampleAt,observation.observedAt);
  assert.ok(diagnostic.lastSuccessfulFetch > 0 && diagnostic.lastSuccessfulFetch <= Date.now()/1000);
  assert.ok(Math.abs(diagnostic.measurementAgeSec-(Math.floor(Date.now()/1000)-observation.observedAt)) <= 3);
  assert.ok(diagnostic.eligibleStations.some(item => item.id === station.id));
  diagnostic.eligibleStations.forEach((item,index,list) => {
    assert.ok(item.distanceKm >= 0 && item.distanceKm <= 30,'Picker must contain only nearby eligible stations');
    assert.ok(catalog.stations.some(known => known.id === item.id));
    if (index) assert.ok(list[index-1].distanceKm <= item.distanceKm,'Picker choices must be sorted by distance');
  });
  const hourly = p.hourly_temperature.series;
  const active = Math.floor((Date.now()/1000-hourly.start)/hourly.stepSec);
  assert.ok(active >= 0 && active < hourly.numericValue.values.length, 'Current hour must be within the native series');
  assert.equal(hourly.numericValue.values[active],p.temperature.numericValue.value,
    'Native Weather active hour must match the measured scalar temperature');
  assert.equal(p.hourly_source?.series.longText.values[active],'ČHMÚ station measurement');
  const forecast = latestBody('data-provider.chmi.cz','/api/graphs/graf.meteogram/75');
  const futureTime = hourly.start + (active+1)*hourly.stepSec;
  const future = forecast && forecast.data.find(row => Date.parse(row.validityTime)/1000 === futureTime);
  assert.ok(future && typeof future.t2m === 'number', 'Live ALADIN must supply the next forecast hour');
  assert.equal(hourly.numericValue.values[active+1],future.t2m,'Future hour must retain its ALADIN forecast');
  assert.equal(p.hourly_source.series.longText.values[active+1],'ČHMÚ ALADIN forecast');
}
function verifyComplete(p,withUV=true) {
  verifyMeasured(p);
  for (const name of ['humidity','feels_like','precipitation','daily_precipitation','daily_sunrise','daily_sunset']) {
    assert.ok(p[name], name + ' must be available in the live complete response');
  }
  if (withUV) assert.ok(p.uv_index,'Selected live UV must be available');
  assert.equal(p.hourly_temperature.series.numericValue.values.length,48);
  assert.equal(p.daily_high.series.numericValue.values.length,7);
  assert.equal(p.daily_low.series.numericValue.values.length,7);
  assert.equal(p.daily_precipitation.series.numericValue.values.length,7);
  assert.ok(p.precipitation.numericValue.value >= 0 && p.precipitation.numericValue.value <= 100);
  assert.match(p.feels_like_source.longText.text,/Calculated shade estimate/);
  assert.ok(p.daily_source.series.longText.values.includes('Open-Meteo'), 'Later local days must come from Open-Meteo');
}
function localDateAt(seconds) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(seconds*1000));
  const date = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return date.year+'-'+date.month+'-'+date.day;
}
function verifyAppUV(p) {
  const uv = latestBody(APP,'/api/v1/uv_measures');
  assert.ok(uv, 'Live authenticated app UV request must succeed');
  const parsedUV = parseUV(uv,Date.now());
  assert.ok(parsedUV && parsedUV.days.length, 'Live app UV must be usable; app branch cannot be skipped');
  const today = parsedUV.days.find(day => day.date === localDateAt(p.daily_high.series.start));
  assert.ok(today, 'Live app UV must include today');
  assert.equal(p.uv_source.longText.text,'ČHMÚ app (clear-sky noon forecast)');
  assert.equal(p.uv_index.numericValue.value,today.uvIndex);
  assert.equal(p.uv_updated_at.timestamp.value,today.updatedAt,'Original UV updated_at must be retained');
  storedTokens();
}
function verifyAppDaily(p) {
  const place = latestBody(APP,'/api/v2/places/nearest');
  assert.ok(place, 'Live authenticated app place request must succeed');
  const daily = parseWeather(place,Date.now(),POINT);
  assert.ok(daily && daily.days.length === 3, 'Live three-day app aggregates must be fresh; full-day branch cannot be skipped');
  assert.equal(p.app_forecast_updated_at.timestamp.value,daily.updatedAt);
  assert.equal(daily.days[0].date,localDateAt(p.daily_high.series.start));
  daily.days.slice(0,3).forEach((day,index) => {
    assert.equal(p.daily_high.series.numericValue.values[index],day.highC,'Full-day app high must win over partial public hours');
    assert.equal(p.daily_low.series.numericValue.values[index],day.lowC,'Full-day app low must win over partial public hours');
    assert.equal(p.daily_source.series.longText.values[index],'ČHMÚ ALADIN (full-day app forecast)');
  });
  storedTokens();
}
function verifyApp(p) { verifyAppUV(p); verifyAppDaily(p); }
function publicReading(label,p) {
  console.log(JSON.stringify({phase:label,place:p.name.shortText.text,reading:p.temperature.shortText.text,
    source:p.source.longText.text,station:p.station?.longText.text,observedAt:p.observed_at?.timestamp.value,
    humidity:p.humidity?.numericValue.value,humiditySource:p.humidity_source?.longText.text,
    humidityObservedAt:p.humidity_observed_at?.timestamp.value,wind:p.wind_speed?.numericValue.value,
    windUnit:p.wind_speed?.numericValue.unit,windDirection:p.wind_direction?.numericValue.value,
    windSource:p.wind_source?.longText.text,windObservedAt:p.wind_observed_at?.timestamp.value,
    feelsLike:p.feels_like?.shortText.text,uv:p.uv_index?.numericValue.value,uvSource:p.uv_source?.longText.text,
    uvUpdatedAt:p.uv_updated_at?.timestamp.value,high:p.high?.numericValue.value,low:p.low?.numericValue.value,
    forecastHours:p.hourly_temperature?.series.numericValue.values.length,
    dailyForecasts:p.daily_high?.series.numericValue.values.length,
    dailySources:p.daily_source?.series.longText.values}));
}
async function main() {
  phase = 'source module with live app authentication';
  const source = createClient(options);
  const sourceP = properties(await source.getWeather(REQUEST,true));
  verifyComplete(sourceP);
  verifyApp(sourceP);
  assert.equal(ownLoginIds,1,'Cold source module must perform exactly one own-installation login');
  assert.ok(authenticatedGets >= 2,'Both app weather routes must be authenticated');
  assert.ok(calls.some(c => c.pathname === '/api/v1/jwt/login' && c.status >= 200 && c.status < 300), 'Live installation login must succeed');
  publicReading('source',sourceP);

  // Reuse this test's own refresh token, with an expired access-token hint, so
  // the real bundled implementation verifies and refreshes its own session.
  const tokens = storedTokens();
  await secureStorage.setItem(AUTH_KEY,JSON.stringify({access_token:'smoke.'+
    Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.expired',refresh_token:tokens.refresh_token}));
  phase = 'bundled plugin authentication refresh';
  const host = {...pebble,secureStorage,registerSourceHandler:fn => {host.handler=fn;},
    registerConfigHandler:fn => {host.config=fn;},refreshSources:() => {}};
  const bundle = fs.readFileSync(path.join(ROOT,'build/plugin.js'));
  bundleDigest = crypto.createHash('sha256').update(bundle).digest('hex');
  assert.equal(bundleDigest,process.env.CHMU_SMOKE_BUNDLE_SHA256,
    'Executed bundle must be byte-identical to plugin.js in the built PBW');
  vm.runInNewContext(bundle.toString('utf8'),
    {Pebble:host,localStorage:storage,navigator:{geolocation},fetch:bridge,setTimeout,clearTimeout,
      crypto:{randomUUID:crypto.randomUUID},console,Date});
  assert.equal(typeof host.handler,'function');
  assert.equal(typeof host.config,'function');
  async function config(message) {
    await transportIdle();
    let reply;
    await host.config(message,value => {reply=value;});
    assert.ok(reply && !reply.error,'Bundled config request must succeed');
    return reply;
  }
  async function reading() {
    let result;
    let error;
    await host.handler(REQUEST,{data:value => {result=value;},error:code => {error=code;}});
    assert.ok(!error,'Bundled weather handler must return data');
    return properties(result);
  }
  await config({type:'refresh'});
  let p = await reading();
  verifyComplete(p);
  verifyApp(p);
  assert.ok(calls.some(c => c.pathname === '/api/v1/jwt/verify_refresh_token' && c.status >= 200 && c.status < 300),
    'Bundled plugin must verify this test installation’s own refresh token');
  assert.ok(calls.some(c => c.pathname === '/api/v1/jwt/refresh' && c.status >= 200 && c.status < 300),
    'Bundled plugin must refresh this test installation’s own session');
  assert.equal(ownLoginIds,1,'Bundle must reuse the source run’s own installation instead of creating another');
  publicReading('bundle',p);

  phase = 'nearby station picker and fixed manual selection';
  let state = await config({type:'getState'});
  const selectedStation = state.locations.find(item => item.id === 'smoke-city-75').stationId;
  await config({type:'setStation',locationId:'smoke-city-75',stationId:selectedStation});
  p = await reading();
  verifyMeasured(p);
  state = await config({type:'getState'});
  let diagnostic = state.locations.find(item => item.id === 'smoke-city-75');
  assert.equal(diagnostic.stationMode,'manual');
  assert.equal(diagnostic.requestedStationId,selectedStation);
  assert.equal(diagnostic.stationId,selectedStation);
  await config({type:'setStation',locationId:'smoke-city-75',stationId:''});
  p = await reading();
  verifyMeasured(p);

  phase = 'ČHMÚ UV independent of disabled full-day forecasts';
  state = await config({type:'setAppData',enabled:false});
  assert.equal(state.settings.appData,false);
  assert.equal(state.settings.uvSource,'chmu');
  let placeCount = count(APP,'/api/v2/places/nearest');
  const uvCount = count(APP,'/api/v1/uv_measures');
  await config({type:'refresh'});
  p = await reading();
  verifyComplete(p);
  verifyAppUV(p);
  assert.equal(count(APP,'/api/v2/places/nearest'),placeCount,'Daily-off must not request app daily aggregates');
  assert.ok(count(APP,'/api/v1/uv_measures') > uvCount,'ČHMÚ UV must still use its independently enabled route');
  assert.equal(p.app_forecast_updated_at,undefined,'Disabled app aggregates must not be reused');
  publicReading('daily-off-chmu-uv',p);

  phase = 'Open-Meteo UV with both app-service channels disabled';
  state = await config({type:'setUVSource',source:'open-meteo'});
  assert.equal(state.settings.uvSource,'open-meteo');
  assert.equal(state.settings.completeWeather,true);
  const noAppCount = count(APP);
  await config({type:'refresh'});
  p = await reading();
  verifyComplete(p);
  assert.equal(count(APP),noAppCount,'Daily-off plus non-ČHMÚ UV must not request any app-service route');
  assert.equal(p.uv_source.longText.text,'Open-Meteo (forecast daily peak)');
  assert.equal(p.app_forecast_updated_at,undefined);
  publicReading('open-meteo-uv',p);

  phase = 'Open-Meteo UV cannot enable disabled completion';
  state = await config({type:'setCompleteWeather',enabled:false});
  assert.equal(state.settings.completeWeather,false);
  const disabledCounts = {app:count(APP),om:count(OM)};
  p = await reading();
  verifyMeasured(p);
  assert.equal(p.uv_index,undefined,'Selected Open-Meteo UV must be unavailable while completion is off');
  assert.equal(p.precipitation,undefined,'Disabled completion must not reuse cached probabilities');
  assert.equal(count(APP),disabledCounts.app);
  assert.equal(count(OM),disabledCounts.om);
  state = await config({type:'getState'});
  diagnostic = state.locations.find(item => item.id === 'smoke-city-75');
  assert.equal(state.settings.completeWeather,false,'UV selection must never enable completion implicitly');
  assert.equal(diagnostic.uvStatus,'unavailable');
  assert.match(diagnostic.uvReason,/requires.*enabled/i);
  publicReading('open-meteo-disabled',p);

  phase = 'UV Off suppresses cached UV while completion remains enabled';
  await config({type:'setUVSource',source:'off'});
  await config({type:'setCompleteWeather',enabled:true});
  const offAppCount = count(APP);
  p = await reading();
  verifyComplete(p,false);
  assert.equal(p.uv_index,undefined);
  assert.equal(p.uv_source,undefined);
  assert.equal(count(APP),offAppCount);
  publicReading('uv-off',p);

  phase = 'full-day forecasts remain independent of UV Off';
  await config({type:'setAppData',enabled:true});
  const noUVCount = count(APP,'/api/v1/uv_measures');
  placeCount = count(APP,'/api/v2/places/nearest');
  await config({type:'refresh'});
  p = await reading();
  verifyComplete(p,false);
  verifyAppDaily(p);
  assert.equal(p.uv_index,undefined);
  assert.equal(count(APP,'/api/v1/uv_measures'),noUVCount);
  assert.ok(count(APP,'/api/v2/places/nearest') > placeCount);
  publicReading('daily-on-uv-off',p);

  phase = 'ČHMÚ UV with daily forecasts and Open-Meteo disabled';
  await config({type:'setAppData',enabled:false});
  await config({type:'setCompleteWeather',enabled:false});
  await config({type:'setUVSource',source:'chmu'});
  const omCount = count(OM);
  placeCount = count(APP,'/api/v2/places/nearest');
  await config({type:'refresh'});
  p = await reading();
  verifyMeasured(p);
  verifyAppUV(p);
  assert.equal(count(OM),omCount,'Completion-off must not request Open-Meteo for any UV mode');
  assert.equal(count(APP,'/api/v2/places/nearest'),placeCount);
  assert.equal(p.app_forecast_updated_at,undefined);
  assert.equal(p.precipitation,undefined);
  publicReading('chmu-uv-only',p);
  storedTokens();
  assert.equal(safetyFailures,0,'Every live request must satisfy the transport, coordinate and credential checks');
  console.log(JSON.stringify({result:'passed',pbwSha256:process.env.CHMU_SMOKE_PBW_SHA256,bundleSha256:bundleDigest,ownInstallationLogins:ownLoginIds,
    authenticatedWeatherRequests:authenticatedGets,secureCredentialRecords:secretValues.size,requestSafetyFailures:safetyFailures,requests:callCounts()}));
}
main().catch(error => {
  // Do not print exception objects, HTTP bodies, storage or transport input.
  console.error('Live smoke failed during '+phase+': '+(error && error.message || 'weather verification failed'));
  console.error(JSON.stringify({requests:callCounts(),safetyFailures,secureCredentialRecords:secretValues.size,loginMetadata,
    transportTimings:calls.map(c => ({method:c.method,host:c.host,path:c.pathname,status:c.status,durationMs:c.durationMs || Date.now()-c.startedAt}))}));
  process.exitCode = 1;
}).finally(() => { for (const child of children) child.kill(); });
