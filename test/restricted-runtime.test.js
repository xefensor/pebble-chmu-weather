'use strict';

// Exercise the bundled entrypoint, not only clients with injected Node timers.
// Pebble 1.16 exposes timer names as throwing getters. Keeping that behavior
// here also catches a misleading `typeof setTimeout` availability guard.
// Set CHMU_PLUGIN_SCRIPT to plugin.js extracted from a PBW to validate that
// exact distributable with the same checks.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const observation = require('../tests/fixtures/station-C2CBUD01.json');
const appPlace = require('../tests/fixtures/app-place.json');
const appUV = require('../tests/fixtures/app-uv.json');
const manifest = require('../package.json').pebble;

const ROOT = path.resolve(__dirname, '..');
const bundle = process.env.CHMU_PLUGIN_SCRIPT
  ? fs.readFileSync(process.env.CHMU_PLUGIN_SCRIPT, 'utf8')
  : esbuild.buildSync({absWorkingDir:ROOT, entryPoints:['src/plugin/index.js'],
    bundle:true, format:'iife', platform:'neutral', mainFields:['main','module'],
    target:'es2020', write:false}).outputFiles[0].text;
const NOW = Date.parse('2026-10-31T08:00:00Z');
const HOUR = 3600000;
const REQUEST = {category:'weather', item:'location'};
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve=done;});
  return {promise, resolve};
};
async function flush() { for (let i=0; i<100; i++) await Promise.resolve(); }

function forecast() {
  return {parameters:{t2m:{unit:'°C'}, windSpeed:{unit:'m/s'}}, z:387,
    data:Array.from({length:73}, (_, i) => ({
      validityTime:new Date(NOW-8*HOUR+i*HOUR).toISOString(),
      t2m:5, rh2m:90, prec:0, windSpeed:2, windDirection:300, cloudsTot:50, icon:140
    }))};
}
function supplement() {
  const start = (NOW-9*HOUR)/1000; // Prague local midnight.
  return {timezone:'Europe/Prague', utc_offset_seconds:3600,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',
      precipitation_probability:'%',precipitation:'mm',weather_code:'wmo code',
      wind_speed_10m:'m/s',wind_direction_10m:'°'},
    hourly:{time:Array.from({length:168},(_,i)=>start+i*3600),
      temperature_2m:Array(168).fill(12),relative_humidity_2m:Array(168).fill(60),
      precipitation_probability:Array(168).fill(42),precipitation:Array(168).fill(0),
      weather_code:Array(168).fill(0),wind_speed_10m:Array(168).fill(3),
      wind_direction_10m:Array(168).fill(180)},
    daily_units:{time:'unixtime',temperature_2m_max:'°C',temperature_2m_min:'°C',
      weather_code:'wmo code',uv_index_max:'',precipitation_probability_max:'%'},
    daily:{time:Array.from({length:7},(_,i)=>start+i*86400),
      temperature_2m_max:Array(7).fill(22),temperature_2m_min:Array(7).fill(12),
      weather_code:Array(7).fill(0),uv_index_max:Array(7).fill(2),
      precipitation_probability_max:Array(7).fill(42)}};
}
function response(body) {
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>copy(body)};
}

function runtime(options={}) {
  let now = NOW;
  let source;
  let config;
  let gpsCalls = 0;
  let secureWrites = 0;
  const timerCalls = [];
  const urls = [];
  const refreshes = [];
  const subscriptions = [];
  const values = new Map();
  const secure = new Map();
  if (!options.defaults) values.set('chmu.settings.v1',JSON.stringify({
    stations:{},appData:false,completeWeather:false,uvSource:'off',revision:0}));
  const localStorage = {getItem:key=>values.get(key)??null,
    setItem:(key,value)=>{
      if (options.failSettings && key==='chmu.settings.v1') throw Error('Internal storage failure');
      values.set(key,value);
    },removeItem:key=>values.delete(key)};
  class Clock extends Date {
    constructor(...args) { super(...(args.length?args:[now])); }
    static now() { return now; }
  }
  const Pebble = {
    readSource:async request => request.item==='units'
      ? {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:'°C'}},
        wind_speed:{shortText:{text:'m/s'}}}}]}
      : {instances:options.gps?[]:[{instanceId:'saved-cb',properties:{
        name:{shortText:{text:'České Budějovice'}},current:{boolean:{value:false}},
        latitude:{numericValue:{value:48.98}},longitude:{numericValue:{value:14.48}}}}]},
    subscribeSource:request=>subscriptions.push(copy(request)),
    refreshSources:request=>refreshes.push(copy(request)),
    secureStorage:{getItem:async key=>secure.get(key)??null,
      setItem:async(key,value)=>{secureWrites++;secure.set(key,value);}},
    registerSourceHandler:handler=>{source=handler;},
    registerConfigHandler:handler=>{config=handler;}
  };
  async function fetch(url,init={}) {
    urls.push(url);
    if (options.http) return options.http(url,init);
    if (url.startsWith('https://chmu.rails.cz/')) {
      if (options.optionalFailure) throw new Error('App backend unavailable');
      if (url.endsWith('/jwt/login')) {
        assert.equal(init.method,'POST');
        return response({access_token:'restricted-access',refresh_token:'restricted-refresh'});
      }
      assert.equal(init.headers.Authorization,'Bearer restricted-access');
      return response(url.includes('/uv_measures?')?appUV:appPlace);
    }
    if (url.startsWith('https://api.open-meteo.com/')) {
      if (options.optionalFailure) throw new Error('Supplement unavailable');
      return response(supplement());
    }
    if (url.includes('/graf.meteogram/')) return response(forecast());
    if (url.includes('/graf.meteo-stanice.klima-10m/')) return response(observation);
    throw new Error('Unexpected weather endpoint: '+url);
  }
  const globals = {Pebble,localStorage,fetch,Date:Clock,console,
    navigator:{geolocation:{getCurrentPosition:(success,failure,settings)=>{
      gpsCalls++;
      assert.equal(settings.timeout,7000);
      if (options.gpsDenied) failure({code:1});
      else success({coords:{latitude:48.98,longitude:14.48}});
    }}},
    // These browser/Node conveniences are not required by the native plugin.
    Buffer:undefined,process:undefined,require:undefined,URL:undefined,
    AbortController:undefined,TextEncoder:undefined,TextDecoder:undefined,
    Intl:undefined,crypto:undefined};
  globals.recordForbiddenTimerAccess=name=>timerCalls.push(name);
  const context=vm.createContext(globals);
  // Define getters in the guest realm. A getter installed on the host sandbox
  // object is wrapped by Node as a different ReferenceError for bare globals.
  vm.runInContext(`
    for (const name of ['setTimeout','clearTimeout','setInterval','clearInterval']) {
      Object.defineProperty(globalThis,name,{get:()=>{
        recordForbiddenTimerAccess(name);
        throw new Error(name+' is not available to plugins');
      }});
    }
  `,context);
  vm.runInContext(bundle,context,{filename:'plugin.js',timeout:1000});
  assert.equal(typeof source,'function');
  assert.equal(typeof config,'function');
  async function readRaw(request=REQUEST) {
    let data;
    let error;
    await source(copy(request),{data:value=>{data=copy(value);},error:(code,message)=>{error={code,message};}});
    return {data,error};
  }
  async function read(request=REQUEST) {
    const result=await readRaw(request);
    assert.equal(result.error,undefined,JSON.stringify(result.error));
    assert.equal(result.data.instances.length,1);
    assert.equal(timerCalls.length,0,'Native plugin must never call forbidden timers');
    return result.data.instances[0].properties;
  }
  async function configure(message,allowError=false) {
    let result;
    await config(copy(message),value=>{result=copy(value);});
    assert.ok(result,'Config handler must reply');
    if (!allowError) assert.equal(result.error,undefined,result.error);
    assert.equal(timerCalls.length,0);
    return result;
  }
  return {read,readRaw,configure,urls,values,secure,refreshes,subscriptions,timerCalls,
    gpsCalls:()=>gpsCalls,secureWrites:()=>secureWrites,clock:value=>{now=value;}};
}

test('Restricted bundled plugin reports the package version in settings state',async()=>{
  const host=runtime();
  const state=await host.configure({type:'getState'});
  assert.equal(state.version,require('../package.json').version);
  assert.equal(host.urls.length,0,'Reading settings metadata does not fetch weather');
  assert.equal(host.timerCalls.length,0,'Reading metadata must not access forbidden timers');
});

test('Restricted bundled plugin reports a rejected settings save without refreshing sources',async()=>{
  const host=runtime({failSettings:true});
  const result=await host.configure({type:'setCompleteWeather',enabled:true},true);
  assert.equal(result.error,'Pebble could not save settings. Check available storage and try again.');
  assert.equal((await host.configure({type:'getState'})).settings.completeWeather,false);
  assert.deepEqual(host.refreshes,[],'a failed save cannot advertise a source configuration change');
  assert.equal(host.urls.length,0);
  assert.equal(host.timerCalls.length,0);
});

test('Restricted bundled plugin reads saved ČHMÚ observations without invoking timer globals',async()=>{
  const host=runtime();
  const p=await host.read({...REQUEST,iconPixelSize:{w:24,h:24}});
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.temperature.shortText.text,'7°C');
  assert.equal(p.observed_at.timestamp.value,Date.parse('2026-10-31T07:50:00Z')/1000);
  assert.equal(p.is_forecast.boolean.value,false);
  assert.equal(p.hourly_temperature.series.numericValue.values[9],6.8);
  assert.equal(p.condition.icon.width,24);
  assert.equal(host.gpsCalls(),0);
  assert.equal(host.secureWrites(),0);
  assert.deepEqual(host.subscriptions.map(s=>s.item),['weather_location','units']);
  for (const name of Object.keys(p)) assert.ok(manifest.plugin.sources[0].properties[name],name);
});

test('Restricted bundled plugin supplies default app UV, local daily forecasts and supplement',async()=>{
  const host=runtime({defaults:true});
  const p=await host.read();
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.high.numericValue.value,8.88);
  assert.equal(p.low.numericValue.value,4.7);
  assert.equal(p.uv_index.numericValue.value,1.5);
  assert.equal(p.precipitation.numericValue.value,42);
  assert.equal(p.daily_high.series.numericValue.values.length,7);
  assert.equal(host.urls.filter(url=>url.endsWith('/jwt/login')).length,1);
  assert.equal(host.secureWrites(),1);
  assert.ok([...host.secure.values()].some(value=>value.includes('restricted-access')));
  assert.ok(![...host.values.values()].some(value=>value.includes('restricted-access')));
  const state=await host.configure({type:'getState'});
  assert.equal(state.locations[0].uvIndex,1.5);
  assert.ok(!JSON.stringify(state).includes('restricted-access'));
});

test('Restricted bundled plugin retains public ČHMÚ weather when both optional services fail',async()=>{
  const host=runtime({defaults:true,optionalFailure:true});
  const p=await host.read();
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.uv_index,undefined);
  assert.equal(p.precipitation,undefined);
  const state=await host.configure({type:'getState'});
  assert.match(state.locations[0].appDataStatus,/unavailable/);
});

test('Restricted bundled plugin uses native GPS options when no weather city is saved',async()=>{
  const host=runtime({gps:true});
  const p=await host.read();
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(host.gpsCalls(),1);
  const denied=runtime({gps:true,gpsDenied:true});
  const result=await denied.readRaw();
  assert.equal(result.error.code,'PERMISSION_DENIED');
  assert.equal(denied.timerCalls.length,0);
});

test('Restricted bundled plugin reuses cache and forced config refresh bypasses its short windows',async()=>{
  const host=runtime();
  await host.read();
  const firstRequests=host.urls.length;
  await host.read();
  assert.equal(host.urls.length,firstRequests);
  const refreshed=await host.configure({type:'refresh'});
  assert.equal(refreshed.refreshError,undefined);
  assert.equal(host.urls.length,2*firstRequests);
  assert.deepEqual(host.refreshes,[['weather/location']]);
  assert.equal(refreshed.locations[0].temperature,'7°C');
});

test('Restricted bundled plugin config choices work without timers or browser facilities',async()=>{
  const host=runtime({defaults:true});
  await host.read();
  const station=await host.configure({type:'setStation',locationId:'saved-cb',stationId:'C2CBUD01'});
  assert.equal(station.settings.stations['saved-cb'],'C2CBUD01');
  assert.equal((await host.configure({type:'setAppData',enabled:false})).settings.appData,false);
  assert.equal((await host.configure({type:'setCompleteWeather',enabled:false})).settings.completeWeather,false);
  assert.equal((await host.configure({type:'setUVSource',source:'off'})).settings.uvSource,'off');
  host.urls.length=0;
  const refreshed=await host.configure({type:'refresh'});
  assert.equal(refreshed.refreshError,undefined);
  assert.ok(host.urls.every(url=>url.startsWith('https://data-provider.chmi.cz/')));
  assert.equal((await host.read()).uv_index,undefined);
});

test('Restricted bundled plugin rejects completed HTTP past its six-second deadline without caching it',async()=>{
  const pending=[];
  let released=false;
  const host=runtime({http:url=>{
    if (released) return Promise.reject(new Error('No fallback endpoint available'));
    const item=deferred();
    pending.push({url,...item});
    return item.promise;
  }});
  const reading=host.readRaw();
  await flush();
  assert.ok(pending.length>=2,'Forecast and observation must start together');
  host.clock(NOW+7000);
  released=true;
  for (const item of pending) {
    item.resolve(response(item.url.includes('/graf.meteogram/')?forecast():observation));
  }
  const result=await reading;
  assert.equal(result.data,undefined);
  assert.ok(result.error,'A completed late response must not become a weather reading');
  assert.ok(![...host.values.keys()].some(key=>/^chmu\.cache\.v1\.(?:forecast|climate|bulk)\./.test(key)),
    'Late HTTP results must not enter the weather cache');
  assert.equal(host.timerCalls.length,0);
});
