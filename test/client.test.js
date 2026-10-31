'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const createClient = require('../src/lib/client');
const officialCatalog = require('../src/catalog.json');
const observationFixture = require('../tests/fixtures/station-C2CBUD01.json');
const bulkFixture = require('../tests/fixtures/station-bulk-11546.json');
const appUVFixture = require('../tests/fixtures/app-uv.json');
const appPlaceFixture = require('../tests/fixtures/app-place.json');
const manifest = require('../package.json').pebble;

const NOW = Date.parse('2026-10-31T08:00:00Z');
const HOUR = 3600000;
const REQUEST = {category:'weather', item:'location'};
const copy = value => JSON.parse(JSON.stringify(value));
const station = officialCatalog.stations.find(s => s.id === 'C2CBUD01');
const forecastPlace = officialCatalog.forecastPlaces.find(p => String(p.id) === '75');
const CATALOG = {stations:[station], forecastPlaces:[forecastPlace]};

function savedPlace(id='saved-cb', latitude=48.975, longitude=14.476) {
  return {instanceId:id, properties:{name:{shortText:{text:'České Budějovice'}},
    latitude:{numericValue:{value:latitude}}, longitude:{numericValue:{value:longitude}},
    current:{boolean:{value:false}}}};
}

function forecast() {
  return {parameters:{t2m:{unit:'°C'}, windSpeed:{unit:'m/s'}}, z:387,
    data:Array.from({length:73}, (_, i) => ({
      validityTime:new Date(NOW - 8*HOUR + i*HOUR).toISOString(),
      t2m:5, rh2m:90, prec:0, windSpeed:2, windDirection:300, cloudsTot:50, icon:140
    }))};
}

function supplementalForecast() {
  const start = (NOW - 9*HOUR)/1000; // Prague local midnight on 31 October.
  return {
    timezone:'Europe/Prague', utc_offset_seconds:3600,
    hourly_units:{time:'unixtime', temperature_2m:'°C', relative_humidity_2m:'%',
      precipitation_probability:'%', precipitation:'mm', weather_code:'wmo code',
      wind_speed_10m:'m/s', wind_direction_10m:'°'},
    hourly:{
      time:Array.from({length:168},(_,i)=>start+i*3600),
      temperature_2m:Array(168).fill(12), relative_humidity_2m:Array(168).fill(60),
      precipitation_probability:Array(168).fill(0), precipitation:Array(168).fill(0),
      weather_code:Array(168).fill(0), wind_speed_10m:Array(168).fill(3),
      wind_direction_10m:Array(168).fill(180)
    },
    daily_units:{time:'unixtime', temperature_2m_max:'°C', temperature_2m_min:'°C',
      weather_code:'wmo code', uv_index_max:'', precipitation_probability_max:'%'},
    daily:{time:Array.from({length:7},(_,i)=>start+i*86400),
      temperature_2m_max:Array(7).fill(22), temperature_2m_min:Array(7).fill(12),
      weather_code:Array(7).fill(0), uv_index_max:[0,1,2,3,4,5,6],
      precipitation_probability_max:[0,10,20,30,40,50,60]}
  };
}

async function flush() { for (let i=0; i<30; i++) await Promise.resolve(); }

function fixture(overrides={}) {
  let now = NOW;
  let nextTimer = 0;
  let gpsCalls = 0;
  let network = true;
  let graphBody = copy(observationFixture);
  let forecastBody = forecast();
  let supplementBody = supplementalForecast();
  let units = {temperature:'°C', wind:'km/h'};
  let places = [savedPlace()];
  const timers = new Map();
  const values = new Map();
  // Existing channel regressions explicitly disable the app backend. New app
  // integration tests supply appHttp and exercise actual installation defaults.
  if (overrides.settings !== null) {
    values.set('chmu.settings.v1', JSON.stringify({appData:false, uvSource:overrides.appHttp ? 'chmu' : 'off',
      ...(overrides.settings || {stations:{},completeWeather:false})}));
  } else if (!overrides.appHttp) {
    values.set('chmu.settings.v1', JSON.stringify({appData:false,uvSource:'open-meteo'}));
  }
  const urls = [];
  const subscriptions = [];
  const state = {
    urls, values, subscriptions, timers,
    setNow(value) { now=value; },
    setNetwork(value) { network=value; },
    setGraph(value) { graphBody=value; },
    setForecast(value) { forecastBody=value; },
    setSupplement(value) { supplementBody=value; },
    setUnits(value) { units=value; },
    setPlaces(value) { places=value; },
    gpsCalls() { return gpsCalls; },
    async tick(ms) {
      await flush();
      const target=now+ms;
      for (;;) {
        const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!next) break;
        now=next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now=target;
      await flush();
    }
  };
  const options = {
    catalog:copy(CATALOG),
    storage:{getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)},
    now:()=>now,
    later:(fn,delay)=>{ const id=++nextTimer; timers.set(id,{fn,at:now+delay}); return id; },
    cancelLater:id=>timers.delete(id),
    geolocation:{getCurrentPosition:success=>{ gpsCalls++; success({coords:{latitude:48.975,longitude:14.476}}); }},
    readSource:async request=> request.category==='preferences' && request.item==='weather_location'
      ? {instances:copy(places)}
      : {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:units.temperature}},wind_speed:{shortText:{text:units.wind}}}}]},
    subscribeSource:request=>subscriptions.push(copy(request)),
    fetch:async (url,init)=>{
      urls.push(url);
      if (overrides.http) return overrides.http(url, state, init);
      if (!network) throw new Error('offline');
      if (url.startsWith('https://chmu.rails.cz/')) {
        if (overrides.appHttp) return overrides.appHttp(url, init, state);
        throw new Error('App backend disabled in this test');
      }
      if (url.includes('api.open-meteo.com/')) {
        if (overrides.supplementHttp) return overrides.supplementHttp(url, state);
        return {ok:true,json:async()=>copy(supplementBody)};
      }
      if (url.includes('graf.meteogram/')) return {ok:true,json:async()=>copy(forecastBody)};
      if (url.includes('graf.meteo-stanice.klima-10m/')) return {ok:true,json:async()=>copy(graphBody)};
      if (url.includes('opendata.chmi.cz/')) return {ok:true,json:async()=>copy(bulkFixture)};
      throw new Error('Unexpected URL '+url);
    },
    ...overrides.options
  };
  state.catalog=options.catalog;
  state.later=options.later;
  state.restart=()=>{ state.client=createClient(options); };
  state.restart();
  return state;
}

test('Saved Pebble city uses point 75 and the measured Rožnov 6.8°C, never modeled 5°C or GPS', async()=>{
  const f=fixture();
  const result=await f.client.getWeather(REQUEST);
  const actual=result.instances[0];
  assert.equal(actual.instanceId,'saved-cb');
  assert.equal(actual.properties.temperature.shortText.text,'7°C');
  assert.equal(actual.properties.temperature.numericValue.value,6.8);
  assert.equal(actual.properties.is_forecast.boolean.value,false);
  assert.equal(actual.properties.source.longText.text,'ČHMÚ station measurement');
  assert.equal(actual.properties.observed_at.timestamp.value,Date.parse('2026-10-31T07:50:00Z')/1000);
  assert.ok(actual.properties.station.longText.text.includes('Rožnov'));
  assert.ok(f.urls.some(url=>url.endsWith('/graf.meteogram/75')));
  assert.ok(f.urls.some(url=>url.endsWith('/C2CBUD01')));
  assert.equal(f.gpsCalls(),0);
  assert.equal(result.validUntilMs,NOW+30*60000);
  assert.deepEqual(f.subscriptions.map(s=>s.item),['weather_location','units']);
  assert.equal(f.timers.size,0,'successful calls clear every deadline timer');
});

test('Repeated reads within observation and forecast cache windows issue no duplicate HTTP', async()=>{
  const f=fixture();
  await f.client.getWeather(REQUEST);
  f.setNow(NOW+4*60000);
  await f.client.getWeather(REQUEST);
  assert.equal(f.urls.length,2);
});

test('Concurrent consumer reads coalesce identical weather resource requests', async()=>{
  const f=fixture();
  const [a,b]=await Promise.all([f.client.getWeather(REQUEST), f.client.getWeather(REQUEST)]);
  assert.equal(a.instances[0].properties.temperature.numericValue.value,6.8);
  assert.deepEqual(a,b);
  assert.equal(f.urls.length,2,'one forecast and one station fetch for overlapping consumers');
});

test('Stale measurements fall back to the current ALADIN hour and visibly mark an estimate', async()=>{
  const f=fixture();
  f.setNow(NOW+2*HOUR); // Both historical observation channels are now stale.
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  assert.equal(p.temperature.shortText.text,'~5°C');
  assert.equal(p.temperature.numericValue.value,5);
  assert.equal(p.is_forecast.boolean.value,true);
  assert.equal(p.observed_at,undefined);
});

test('Offline cached forecasts survive plugin restart but expire at six hours', async()=>{
  const f=fixture();
  await f.client.getWeather(REQUEST);
  f.setNetwork(false);
  f.setNow(NOW+5*HOUR);
  f.restart();
  const cached=await f.client.getWeather(REQUEST);
  assert.equal(cached.instances[0].properties.temperature.shortText.text,'~5°C');
  assert.equal(cached.instances[0].properties.forecast_updated_at.timestamp.value,NOW/1000);
  f.setNow(NOW+6*HOUR);
  await assert.rejects(f.client.getWeather(REQUEST));
});

test('Malformed replacement JSON never poisons the last valid forecast cache', async()=>{
  const f=fixture();
  await f.client.getWeather(REQUEST);
  const before=f.values.get('chmu.cache.v1.forecast.75');
  f.setNow(NOW+31*60000);
  f.setForecast({unexpected:'bad schema'});
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.instances[0].properties.temperature.numericValue.value,6.8);
  assert.equal(f.values.get('chmu.cache.v1.forecast.75'),before);
  assert.equal(result.instances[0].properties.forecast_updated_at.timestamp.value,NOW/1000);
});

test('Official bulk endpoint backs up failed station graphs and retains measured precision', async()=>{
  const f=fixture({http:async url=>{
    if (url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if (url.includes('graf.meteo-stanice')) return {ok:false,status:503};
    return {ok:true,json:async()=>copy(bulkFixture)};
  }});
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.instances[0].properties.temperature.numericValue.value,6.8);
  assert.ok(f.urls.some(url=>url==='https://opendata.chmi.cz/meteorology/climate/now/data/10m-0-20000-0-11546-20261031.json'));
});

test('A bulk response for the wrong station is not attributed to the requested station', async()=>{
  const wrong=copy(bulkFixture);
  const data=wrong.data.data;
  const column=data.header.indexOf('STATION');
  data.values.forEach(row=>{row[column]='0-20000-0-OTHER';});
  const f=fixture({http:async url=>{
    if (url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if (url.includes('graf.meteo-stanice')) return {ok:false,status:503};
    return {ok:true,json:async()=>wrong};
  }});
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.temperature.shortText.text,'~5°C');
  assert.equal(p.observed_at,undefined);
});

test('JSON-string-encoded ČHMÚ responses are parsed once and still supply real measurements', async()=>{
  const f=fixture({http:async url=>({ok:true,json:async()=>JSON.stringify(url.includes('graf.meteogram/')?forecast():observationFixture)})});
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.instances[0].properties.temperature.numericValue.value,6.8);
});

test('Unsupported foreign places are omitted; entirely unsupported requests fail without weather HTTP', async()=>{
  const f=fixture();
  f.setPlaces([savedPlace('foreign',40,-74),savedPlace('local')]);
  const mixed=await f.client.getWeather(REQUEST);
  assert.deepEqual(mixed.instances.map(i=>i.instanceId),['local']);
  f.urls.length=0;
  f.setPlaces([savedPlace('foreign',40,-74)]);
  await assert.rejects(f.client.getWeather(REQUEST),error=>error.code==='PLUGIN_UNAVAILABLE');
  assert.equal(f.urls.length,0);
});

test('Diagnostics explain a still-saved location that has moved beyond supported coverage', async()=>{
  const f=fixture();
  await f.client.getWeather(REQUEST);
  assert.equal(f.client.state().locations.length,1);
  f.setPlaces([savedPlace('saved-cb',40,-74)]);
  await assert.rejects(f.client.getWeather(REQUEST));
  assert.equal(f.client.state().locations[0].stationStatus,'out-of-range');
  assert.equal(f.client.state().locations[0].temperature,undefined);
});

test('Hung graph and backup HTTP operations settle after their two bounded six-second attempts', async()=>{
  const f=fixture({http:()=>new Promise(()=>{})});
  let outcome='pending';
  f.client.getWeather(REQUEST).then(()=>{outcome='resolved';},error=>{outcome=error.code;});
  await f.tick(6000);
  await f.tick(6000);
  assert.equal(outcome,'PLUGIN_UNAVAILABLE');
  assert.equal(f.timers.size,0);
});

test('Slow preferences, GPS and HTTP share a 17-second end-to-end budget instead of adding their timeouts', async()=>{
  const f=fixture({http:()=>new Promise(()=>{}),options:{
    readSource:()=>new Promise(()=>{}),
    geolocation:{getCurrentPosition:success=>f.later(()=>success({coords:{latitude:48.975,longitude:14.476}}),7000)}
  }});
  let outcome='pending';
  f.client.getWeather(REQUEST).then(()=>{outcome='resolved';},error=>{outcome=error.code;});
  await f.tick(16999);
  assert.equal(outcome,'pending');
  await f.tick(1);
  assert.equal(outcome,'PLUGIN_UNAVAILABLE');
  assert.equal(f.timers.size,0);
  assert.equal(f.urls.length,2,'no new bulk request starts after the request budget expires');
});

test('Available forecast is returned at the request deadline even when late GPS leaves little observation time', async()=>{
  const f=fixture({http:async url=>{
    if (url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    return new Promise(()=>{});
  },options:{
    readSource:request=>new Promise(resolve=>f.later(()=>resolve(request.item==='weather_location'
      ? {instances:[{instanceId:'current',properties:{current:{boolean:{value:true}}}}]}
      : {instances:[]}),7000)),
    geolocation:{getCurrentPosition:success=>f.later(()=>success({coords:{latitude:48.975,longitude:14.476}}),7000)}
  }});
  let result;
  f.client.getWeather(REQUEST).then(value=>{result=value;});
  await f.tick(16999);
  assert.equal(result,undefined);
  await f.tick(1);
  assert.equal(result.instances[0].properties.temperature.shortText.text,'~5°C');
  assert.equal(f.timers.size,0);
  assert.equal(f.urls.length,2);
});

test('Elevation correction starts the appropriate station immediately instead of awaiting a hung mountain request', async()=>{
  const f=fixture({http:url=>{
    if (url.includes('graf.meteogram/')) return new Promise(resolve=>f.later(()=>resolve({ok:true,json:async()=>forecast()}),4000));
    if (url.endsWith('/lowland')) return Promise.resolve({ok:true,json:async()=>copy(observationFixture)});
    return new Promise(()=>{});
  }});
  f.catalog.stations=[
    {...station,id:'mountain',latitude:48.975,longitude:14.476,elevation:1400},
    {...station,id:'lowland',latitude:48.96,longitude:14.476,elevation:390}
  ];
  let result;
  f.client.getWeather(REQUEST).then(value=>{result=value;});
  await f.tick(4000);
  assert.equal(result.instances[0].properties.temperature.numericValue.value,6.8);
  assert.ok(f.urls.some(url=>url.endsWith('/lowland')));
  await f.tick(2000); // The discarded shared graph operation reaches its own deadline.
  assert.equal(f.timers.size,0);
  assert.equal(f.urls.some(url=>url.includes('opendata.chmi.cz')),false,'discarded station starts no bulk backup');
});

test('A coalesced resource from a later caller cannot extend the earlier caller beyond its own request budget', async()=>{
  let preferenceReads=0;
  const f=fixture({http:async url=>{
    if (url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    return new Promise(()=>{});
  },options:{readSource:request=>{
    if (request.item!=='weather_location') return Promise.resolve({instances:[]});
    preferenceReads++;
    if (preferenceReads===1) return new Promise(resolve=>f.later(()=>resolve({instances:[
      {instanceId:'current',properties:{current:{boolean:{value:true}}}}
    ]}),7000));
    return Promise.resolve({instances:[savedPlace()]});
  },geolocation:{getCurrentPosition:success=>f.later(()=>success({coords:{latitude:48.975,longitude:14.476}}),7000)}}});
  let earlier;
  let later;
  f.client.getWeather(REQUEST).then(value=>{earlier=value;});
  await f.tick(13000);
  f.client.getWeather(REQUEST).then(value=>{later=value;});
  await f.tick(4000);
  assert.equal(earlier.instances[0].properties.temperature.shortText.text,'~5°C');
  assert.equal(later,undefined,'later request is still allowed to try its shared station request');
  await f.tick(8000);
  assert.equal(later.instances[0].properties.temperature.shortText.text,'~5°C');
  assert.equal(f.timers.size,0);
});

test('Pebble Fahrenheit and wind preferences apply without changing the stable location instance ID', async()=>{
  const f=fixture();
  const celsius=await f.client.getWeather(REQUEST);
  f.setUnits({temperature:'°F',wind:'mph'});
  const fahrenheit=await f.client.getWeather(REQUEST);
  const p=fahrenheit.instances[0].properties;
  assert.equal(fahrenheit.instances[0].instanceId,celsius.instances[0].instanceId);
  assert.equal(p.temperature.shortText.text,'44°F');
  assert.ok(Math.abs(p.temperature.numericValue.value-44.24)<1e-9);
  assert.equal(p.temperature.numericValue.unit,'°F');
  assert.equal(p.wind_speed.numericValue.unit,'mph');
  assert.equal(f.urls.length,2);
});

test('Current-location preference obtains GPS once for shared current-location instances', async()=>{
  const f=fixture();
  f.setPlaces([{instanceId:'current',properties:{name:{shortText:{text:'Current location'}},current:{boolean:{value:true}}}}]);
  const result=await f.client.getWeather(REQUEST);
  assert.equal(f.gpsCalls(),1);
  assert.equal(result.instances[0].instanceId,'current');
});

test('Denied location preference never silently switches to GPS', async()=>{
  const f=fixture({options:{readSource:async source=>{
    if (source.item==='weather_location') throw {code:'PERMISSION_DENIED'};
    return {instances:[]};
  }}});
  await assert.rejects(f.client.getWeather(REQUEST),error=>error.code==='PERMISSION_DENIED');
  assert.equal(f.gpsCalls(),0);
  assert.equal(f.urls.length,0);
});

test('Cache retains at most 16 resource records and removes evicted values from storage', async()=>{
  const f=fixture();
  for (let i=0; i<10; i++) {
    f.setPlaces([savedPlace('place-'+i)]);
    // Exercise independent resource keys while keeping each point at a supported location.
    f.catalog.forecastPlaces[0]={...forecastPlace,id:'75-'+i};
    f.catalog.stations[0]={...station,id:'station-'+i};
    await f.client.getWeather(REQUEST);
  }
  const index=JSON.parse(f.values.get('chmu.cache.v1.index'));
  assert.equal(index.length,16);
  const records=[...f.values.keys()].filter(key=>key.startsWith('chmu.cache.v1.')&&key!=='chmu.cache.v1.index');
  assert.equal(records.length,16);
  assert.equal(f.values.has('chmu.cache.v1.forecast.75-0'),false);
});

test('Fresh station observations remain available when ALADIN is unavailable', async()=>{
  const f=fixture({http:async url=>{
    if (url.includes('graf.meteogram/')) return {ok:false,status:503};
    return {ok:true,json:async()=>copy(observationFixture)};
  }});
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.temperature.shortText.text,'7°C');
  assert.equal(p.is_forecast.boolean.value,false);
  assert.equal(p.forecast_updated_at,undefined);
  const active=Math.floor((NOW/1000-p.hourly_temperature.series.start)/3600);
  assert.equal(p.hourly_temperature.series.numericValue.values[active],6.8);
  assert.ok(p.hourly_temperature.series.numericValue.values.every((value,i)=>i===active||value===null));
});

test('An HTTP response with malformed JSON does not overwrite a previously valid forecast', async()=>{
  let malformed=false;
  const f=fixture({http:async url=>({ok:true,json:async()=>{
    if (url.includes('graf.meteogram/')) {
      if (malformed) throw new SyntaxError('Invalid JSON');
      return forecast();
    }
    return copy(observationFixture);
  }})});
  await f.client.getWeather(REQUEST);
  const saved=f.values.get('chmu.cache.v1.forecast.75');
  f.setNow(NOW+31*60000);
  malformed=true;
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.instances[0].properties.temperature.numericValue.value,6.8);
  assert.equal(f.values.get('chmu.cache.v1.forecast.75'),saved);
});

test('Every emitted property shape is declared in the weather/location plugin manifest', async()=>{
  const f=fixture({settings:null});
  const result=await f.client.getWeather({...REQUEST,iconPixelSize:{w:16,h:16}});
  const shapes=manifest.plugin.sources.find(s=>s.category==='weather'&&s.items.includes('location')).properties;
  for (const instance of result.instances) {
    for (const [property,value] of Object.entries(instance.properties)) {
      assert.ok(shapes[property],'undeclared property '+property);
      for (const [shape,payload] of Object.entries(value)) {
        if (shape==='series') {
          for (const inner of Object.keys(payload).filter(key=>!['start','stepSec'].includes(key))) {
            assert.ok(shapes[property].includes('series.'+inner),property+' series.'+inner);
          }
        } else assert.ok(shapes[property].includes(shape),property+' '+shape);
      }
    }
  }
});

test('Open-Meteo completion uses catalogue coordinates while keeping ČHMÚ current temperature', async()=>{
  const f=fixture({settings:null});
  // Keep the saved phone location different from the public model-point
  // coordinates, so this detects an accidental GPS disclosure to the supplement.
  f.setPlaces([savedPlace('saved-cb',48.98,14.48)]);
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  const extras=f.urls.filter(url=>url.startsWith('https://api.open-meteo.com/'));
  assert.equal(extras.length,1);
  assert.equal(f.urls.length,3,'station, ALADIN and completion run once each');
  const url=new URL(extras[0]);
  assert.equal(Number(url.searchParams.get('latitude')),forecastPlace.latitude);
  assert.equal(Number(url.searchParams.get('longitude')),forecastPlace.longitude);
  assert.equal(url.searchParams.get('forecast_days'),'7');
  assert.equal(url.searchParams.get('timeformat'),'unixtime');
  assert.equal(url.searchParams.get('timezone'),'Europe/Prague');
  assert.ok(url.searchParams.get('daily').split(',').includes('uv_index_max'));
  assert.ok(url.searchParams.get('daily').split(',').includes('precipitation_probability_max'));
  assert.ok(url.searchParams.get('hourly').split(',').includes('precipitation_probability'));
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.is_forecast.boolean.value,false);
  assert.equal(p.uv_index.numericValue.value,0,'zero UV is valid rather than missing');
  assert.equal(p.precipitation.numericValue.value,0,'zero precipitation probability is valid');
  assert.deepEqual(p.daily_precipitation.series.numericValue.values,[0,10,20,30,40,50,60]);
  assert.equal(p.daily_high.series.numericValue.values.length,7);
  assert.equal(p.daily_high.series.numericValue.values[0],5,'ALADIN is retained where available');
  assert.equal(p.daily_high.series.numericValue.values[6],22,'completion extends the daily forecast');
  assert.ok(Number.isFinite(p.feels_like.numericValue.value));
  assert.equal(p.feels_like.numericValue.unit,'°C');
  assert.ok(p.supplemental_source.longText.text.includes('Open-Meteo'));
  assert.equal(p.supplemental_updated_at.timestamp.value,NOW/1000);
  assert.equal(f.client.state().settings.completeWeather,true);
  assert.equal(f.gpsCalls(),0);
  assert.equal(f.timers.size,0);
});

test('Completion diagnostics describe used values and a disabled preference preserves station overrides', async()=>{
  const f=fixture({settings:null});
  f.client.setStation('saved-cb',station.id);
  await f.client.getWeather(REQUEST);
  const diagnostics=f.client.state().locations[0];
  assert.equal(diagnostics.forecastDays,7);
  assert.equal(f.client.state().settings.completeWeather,true);
  assert.equal(diagnostics.uvIndex,0);
  assert.equal(diagnostics.precipitation,0);
  assert.ok(diagnostics.supplementalSource.includes('Open-Meteo'));
  assert.ok(diagnostics.feelsLike);
  const updated=f.client.setCompleteWeather(false);
  assert.equal(updated.settings.completeWeather,false);
  assert.deepEqual(updated.settings.stations,{'saved-cb':station.id});
  assert.deepEqual(updated.locations,[],'changing completion mode clears stale diagnostics immediately');
  f.restart();
  assert.equal(f.client.state().settings.completeWeather,false);
  assert.deepEqual(f.client.state().settings.stations,{'saved-cb':station.id});
});

test('Turning completion off ignores its warm cache and removes supplemental fields and extended days', async()=>{
  const f=fixture({settings:null});
  await f.client.getWeather(REQUEST);
  f.client.setCompleteWeather(false);
  f.urls.length=0;
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(f.urls.length,0,'warm ČHMÚ caches remain usable without any completion HTTP');
  assert.equal(p.temperature.numericValue.value,6.8);
  for (const name of ['uv_index','precipitation','daily_precipitation','hourly_precipitation','supplemental_source','supplemental_updated_at']) {
    assert.equal(p[name],undefined,name+' cannot leak from the completion cache');
  }
  assert.ok(p.daily_high.series.numericValue.values.length<7);
  assert.equal(f.client.state().settings.completeWeather,false);
  assert.ok(!f.client.state().locations[0].supplementalSource);
  f.urls.length=0;
  f.setNow(NOW+31*60000);
  await f.client.getWeather(REQUEST);
  assert.ok(f.urls.length>0,'ČHMÚ still refreshes normally');
  assert.equal(f.urls.some(url=>url.includes('api.open-meteo.com')),false);
});

test('An older pending completion request cannot publish extra data or diagnostics after completion is turned off', async()=>{
  let finishSupplement;
  const f=fixture({settings:null,supplementHttp:()=>new Promise(resolve=>{
    finishSupplement=resolve;
  })});
  const oldRequest=f.client.getWeather(REQUEST).then(
    value=>({value}),error=>({error})
  );
  await flush();
  assert.equal(typeof finishSupplement,'function','completion request is actually pending');
  assert.equal(f.client.setCompleteWeather(false).settings.completeWeather,false);
  assert.deepEqual(f.client.state().locations,[]);
  finishSupplement({ok:true,json:async()=>supplementalForecast()});
  const old=await oldRequest;
  assert.equal(old.value,undefined);
  assert.equal(old.error && old.error.code,'PLUGIN_UNAVAILABLE');
  assert.deepEqual(f.client.state().locations,[],'the old mode cannot repopulate cleared diagnostics');
  f.urls.length=0;
  const current=await f.client.getWeather(REQUEST);
  const p=current.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.uv_index,undefined);
  assert.equal(p.precipitation,undefined);
  assert.equal(p.supplemental_updated_at,undefined);
  assert.ok(p.daily_high.series.numericValue.values.length<7);
  assert.equal(f.urls.some(url=>url.includes('api.open-meteo.com')),false);
  assert.equal(f.client.state().settings.completeWeather,false);
  assert.ok(!f.client.state().locations[0].supplementalSource);
  assert.equal(f.timers.size,0);
});

test('A station selection change prevents an older pending reading from replacing the chosen station or its diagnostics', async()=>{
  let holdStation=false;
  let finishStation;
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(url.includes('graf.meteo-stanice')) {
      if(holdStation) return new Promise(resolve=>{finishStation=()=>resolve({ok:true,json:async()=>copy(observationFixture)});});
      return {ok:true,json:async()=>copy(observationFixture)};
    }
    return {ok:false,status:503};
  }});
  f.setPlaces([savedPlace('saved-cb'),savedPlace('other-location')]);
  await f.client.getWeather(REQUEST);
  assert.equal(f.client.state().locations.length,2);
  f.catalog.stations.push({...station,id:'second-station',name:'Second station'});
  // The station is discovered before the next user selection is validated.
  const status=JSON.parse(f.values.get('chmu.status.v1'));
  status['saved-cb'].eligibleStations.push({id:'second-station',name:'Second station',distanceKm:3,elevation:station.elevation});
  f.values.set('chmu.status.v1',JSON.stringify(status));
  holdStation=true;
  const oldRequest=f.client.getWeather(REQUEST,true).then(value=>({value}),error=>({error}));
  await flush();
  assert.equal(typeof finishStation,'function','the old station request is actually pending');
  const changed=f.client.setStation('saved-cb','second-station');
  assert.equal(changed.settings.stations['saved-cb'],'second-station');
  assert.deepEqual(changed.locations.map(location=>location.id),['other-location'],
    'Only the changed location loses its old station diagnostics');
  finishStation();
  const old=await oldRequest;
  assert.equal(old.value,undefined);
  assert.equal(old.error && old.error.code,'PLUGIN_UNAVAILABLE');
  assert.deepEqual(f.client.state().locations.map(location=>location.id),['other-location'],
    'The obsolete reading cannot put the previous station back into diagnostics');
  holdStation=false;
  const current=await f.client.getWeather(REQUEST);
  const selected=current.instances.find(instance=>instance.instanceId==='saved-cb');
  assert.equal(selected.properties.station.longText.text,'Second station');
  assert.ok(f.urls.some(url=>url.endsWith('/second-station')));
  assert.equal(f.client.state().settings.stations['saved-cb'],'second-station');
  assert.equal(f.timers.size,0);
});

test('A completion service failure leaves usable ČHMÚ weather intact', async()=>{
  const f=fixture({settings:null,supplementHttp:async()=>{throw new Error('completion offline');}});
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.uv_index,undefined);
  assert.equal(p.precipitation,undefined);
  assert.equal(p.supplemental_updated_at,undefined);
  assert.equal(result.validUntilMs,NOW+30*60000);
  assert.equal(f.timers.size,0);
});

test('Completion HTTP coalesces across consumers and locations using the same forecast point', async()=>{
  const f=fixture({settings:null});
  f.setPlaces([savedPlace('first'),savedPlace('second',48.98,14.48)]);
  const [a,b]=await Promise.all([f.client.getWeather(REQUEST),f.client.getWeather(REQUEST)]);
  assert.deepEqual(a,b);
  assert.equal(a.instances.length,2);
  assert.equal(f.urls.filter(url=>url.includes('api.open-meteo.com')).length,1);
  assert.equal(f.urls.length,3);
  f.setNow(NOW+4*60000);
  await f.client.getWeather(REQUEST);
  assert.equal(f.urls.length,3,'completion retains its 30-minute reuse window');
  f.setNow(NOW+29*60000);
  await f.client.getWeather(REQUEST);
  assert.equal(f.urls.filter(url=>url.includes('api.open-meteo.com')).length,1);
  f.setNow(NOW+31*60000);
  await f.client.getWeather(REQUEST);
  assert.equal(f.urls.filter(url=>url.includes('api.open-meteo.com')).length,2,
    'completion is fetched again once its 30-minute cache window expires');
});

test('Cached completion survives restart offline but keeps its timestamp and expires after six hours', async()=>{
  let extrasOffline=false;
  const f=fixture({settings:null,supplementHttp:async()=>{
    if (extrasOffline) throw new Error('completion offline');
    return {ok:true,json:async()=>supplementalForecast()};
  }});
  await f.client.getWeather(REQUEST);
  extrasOffline=true;
  f.setNow(NOW+5*HOUR+50*60000);
  const fresh=copy(observationFixture);
  fresh.dataPoints.forEach(point=>{point.timestamp=new Date(Date.parse(point.timestamp)+6*HOUR).toISOString();});
  f.setGraph(fresh);
  f.restart();
  const cached=await f.client.getWeather(REQUEST);
  assert.equal(cached.instances[0].properties.uv_index.numericValue.value,0);
  assert.equal(cached.instances[0].properties.supplemental_updated_at.timestamp.value,NOW/1000);
  assert.equal(cached.validUntilMs,NOW+6*HOUR,'supplement expiry caps envelope validity');
  f.setNow(NOW+6*HOUR);
  const expired=await f.client.getWeather(REQUEST);
  const p=expired.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,6.8,'fresh station still supplies current temperature');
  assert.equal(p.uv_index,undefined);
  assert.equal(p.precipitation,undefined);
  assert.equal(p.supplemental_updated_at,undefined);
});

test('Unused completion metadata never shortens the validity of valid ČHMÚ-only output', async()=>{
  const f=fixture({settings:null,supplementHttp:async()=>{throw new Error('completion offline');}});
  const empty=supplementalForecast();
  for (const [key,values] of Object.entries(empty.hourly)) if (key!=='time') values.fill(null);
  for (const [key,values] of Object.entries(empty.daily)) if (key!=='time') values.fill(null);
  // Keep a valid point beyond the emitted 48-hour series, with no complete
  // extra daily forecast. Parsing succeeds, but no output actually uses it.
  empty.hourly.temperature_2m[100]=12;
  f.values.set('chmu.cache.v1.supplement.75',JSON.stringify({body:empty,fetchedAt:NOW-5*HOUR-50*60000}));
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.instances[0].properties.supplemental_updated_at,undefined);
  assert.equal(result.validUntilMs,NOW+30*60000);
});

test('Slow completion shares the existing 17-second preferences/GPS/network budget', async()=>{
  const f=fixture({settings:null,http:()=>new Promise(()=>{}),options:{
    readSource:()=>new Promise(()=>{}),
    geolocation:{getCurrentPosition:success=>f.later(()=>success({coords:{latitude:48.975,longitude:14.476}}),7000)}
  }});
  let outcome='pending';
  f.client.getWeather(REQUEST).then(()=>{outcome='resolved';},error=>{outcome=error.code;});
  await f.tick(16999);
  assert.equal(outcome,'pending');
  await f.tick(1);
  assert.equal(outcome,'PLUGIN_UNAVAILABLE');
  assert.equal(f.urls.length,3,'all three weather channels start together; no late bulk request');
  assert.equal(f.timers.size,0);
});

function appHTTP(overrides={}) {
  return async function(url, init) {
    if (url.endsWith('/jwt/login')) {
      assert.equal(init.method,'POST');
      assert.equal(init.headers['Content-Type'],'application/json');
      const body=JSON.parse(init.body);
      assert.equal(body.device.platform,'android');
      assert.match(body.device.device_token,/^[a-f0-9-]{36}$/i);
      assert.deepEqual(Object.keys(body.device).sort(),['device_token','platform']);
      return {ok:true,status:200,json:async()=>({access_token:'own-access',refresh_token:'own-refresh'})};
    }
    assert.equal(init.method,'GET');
    assert.equal(init.headers.Authorization,'Bearer own-access');
    if (overrides.read) return overrides.read(url,init);
    return {ok:true,status:200,json:async()=>copy(url.includes('/uv_measures?')?appUVFixture:appPlaceFixture)};
  };
}

test('Default app source supplies clear-sky UV and three local daily summaries, keeping real temperature and graph humidity', async()=>{
  const f=fixture({settings:null,appHttp:appHTTP()});
  f.setPlaces([savedPlace('saved-cb',48.98,14.48)]);
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  assert.equal(f.client.state().settings.appData,true);
  assert.equal(f.client.state().settings.completeWeather,true);
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.humidity.numericValue.value,90);
  assert.equal(p.uv_index.numericValue.value,1.5);
  assert.match(p.uv_source.longText.text,/ČHMÚ.*clear-sky noon/);
  assert.equal(p.uv_updated_at.timestamp.value,Date.parse(appUVFixture[0].updated_at)/1000);
  assert.equal(p.high.numericValue.value,8.88);
  assert.equal(p.low.numericValue.value,4.7);
  assert.equal(p.daily_high.series.numericValue.values.length,7);
  assert.match(p.daily_source.series.longText.values[0],/full-day app forecast/);
  assert.equal(p.daily_source.series.longText.values[3],'Open-Meteo');
  assert.equal(f.urls.filter(url=>url.endsWith('/jwt/login')).length,1,'both app resources share login');
  for (const url of f.urls.filter(url=>url.includes('/uv_measures?')||url.includes('/places/nearest?'))) {
    assert.equal(Number(new URL(url).searchParams.get('lat')),forecastPlace.latitude);
    assert.equal(Number(new URL(url).searchParams.get('lng')),forecastPlace.longitude);
  }
  assert.equal(f.timers.size,0);
  const shapes=manifest.plugin.sources[0].properties;
  for (const property of Object.keys(p)) assert.ok(shapes[property],'declares '+property);
  assert.equal(f.client.state().locations[0].uvSource,p.uv_source.longText.text);
  assert.equal(f.client.state().locations[0].uvUpdatedAt,p.uv_updated_at.timestamp.value);
  assert.ok(!JSON.stringify(f.client.state()).includes('own-access'),'configuration never exposes credentials');
});

test('ČHMÚ UV remains independently available when app daily summaries are disabled', async()=>{
  const f=fixture({settings:{appData:true,completeWeather:false},appHttp:appHTTP()});
  const first=await f.client.getWeather(REQUEST);
  assert.equal(first.instances[0].properties.uv_index.numericValue.value,1.5);
  assert.equal(first.instances[0].properties.precipitation,undefined);
  assert.equal(f.urls.some(url=>url.includes('api.open-meteo.com')),false);
  const before=f.urls.filter(url=>url.includes('chmu.rails.cz')).length;
  assert.equal(f.client.setAppData(false).settings.appData,false);
  assert.equal(f.client.state().locations.length,0);
  const off=await f.client.getWeather(REQUEST);
  assert.equal(off.instances[0].properties.uv_index.numericValue.value,1.5);
  assert.equal(off.instances[0].properties.app_forecast_updated_at,undefined);
  assert.equal(f.urls.filter(url=>url.includes('chmu.rails.cz')).length,before);
  f.restart();
  assert.equal(f.client.state().settings.appData,false);
  f.client.setAppData(true);
  assert.equal((await f.client.getWeather(REQUEST)).instances[0].properties.uv_index.numericValue.value,1.5);
  assert.equal(f.urls.filter(url=>url.includes('chmu.rails.cz')).length,before,'warm cache reusable only after re-enabling');
});

test('Preferred ČHMÚ UV falls back to enabled Open-Meteo without borrowing a future date', async()=>{
  const f=fixture({settings:null,appHttp:appHTTP({read:async url=>({ok:true,status:200,
    json:async()=>copy(url.includes('/uv_measures?')?appUVFixture.slice(1):appPlaceFixture)})})});
  let p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index.numericValue.value,0);
  assert.match(p.uv_source.longText.text,/Open-Meteo/);
  assert.equal(f.client.state().locations[0].uvStatus,'fallback');
  f.client.setCompleteWeather(false);
  p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index,undefined);
  assert.equal(p.high.numericValue.value,8.88);
});

test('Unavailable app login preserves public ČHMÚ weather and enabled completion without leaking HTTP errors', async()=>{
  const f=fixture({settings:null,appHttp:async()=>{throw Error('private-token-or-server-body');}});
  const result=await f.client.getWeather(REQUEST);
  const p=result.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.equal(p.uv_index.numericValue.value,0);
  assert.match(f.client.state().locations[0].appDataStatus,/unavailable/);
  assert.equal(JSON.stringify(f.client.state()).includes('private-token'),false);
});

test('Disabling app data while a request is pending rejects obsolete output and diagnostic publication', async()=>{
  const releases=[];
  const f=fixture({settings:null,appHttp:appHTTP({read:url=>new Promise(resolve=>releases.push(()=>resolve({
    ok:true,status:200,json:async()=>copy(url.includes('/uv_measures?')?appUVFixture:appPlaceFixture)
  })))})});
  const pending=f.client.getWeather(REQUEST);
  const result=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
  await flush();
  assert.equal(releases.length,2);
  f.client.setAppData(false);
  releases.forEach(release=>release());
  await result;
  assert.equal(f.client.state().locations.length,0);
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.match(p.uv_source.longText.text,/ČHMÚ/);
  assert.equal(p.app_forecast_updated_at,undefined);
  assert.throws(()=>f.client.setAppData('false'),error=>error.code==='INVALID_ARGS');
});

test('App source issue expiry limits envelope validity even after a successful fresh download', async()=>{
  const nearlyExpired=copy(appPlaceFixture);
  nearlyExpired.updated_at=new Date(NOW-6*HOUR+10*60000).toISOString();
  const f=fixture({settings:null,appHttp:appHTTP({read:async url=>({ok:true,status:200,
    json:async()=>copy(url.includes('/uv_measures?')?appUVFixture:nearlyExpired)})})});
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.validUntilMs,NOW+10*60000);
});

test('A measured current-hour blend expires at the hour boundary before the next slot is selected', async()=>{
  const f=fixture();
  f.setNow(NOW+50*60000);
  const graph=copy(observationFixture);
  graph.dataPoints.forEach(point=>{point.timestamp=new Date(Date.parse(point.timestamp)+50*60000).toISOString();});
  f.setGraph(graph);
  const result=await f.client.getWeather(REQUEST);
  assert.equal(result.validUntilMs,NOW+HOUR,'the 30-minute refresh must not span a blended hour boundary');
  const p=result.instances[0].properties;
  const index=Math.floor((NOW/1000-p.hourly_source.series.start)/3600);
  assert.equal(p.hourly_source.series.longText.values[index],'ČHMÚ station measurement');
  f.setNow(NOW+HOUR);
  const after=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(after.hourly_source.series.longText.values[index+1],'ČHMÚ station measurement');
  assert.equal(after.hourly_source.series.longText.values[index],'ČHMÚ ALADIN forecast');
});

test('A separate settings session disables already-resolved app data before a slower source session can publish', async()=>{
  let release;
  const f=fixture({settings:null,appHttp:appHTTP(),http:(url,state,init)=>{
    if (url.startsWith('https://chmu.rails.cz/')) return appHTTP()(url,init);
    if (url.includes('graf.meteo-stanice.klima')) return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>copy(observationFixture)});});
    if (url.includes('api.open-meteo.com/')) return {ok:true,json:async()=>supplementalForecast()};
    return {ok:true,json:async()=>forecast()};
  }});
  const source=f.client;
  const pending=source.getWeather(REQUEST);
  const rejected=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
  await flush();
  assert.equal(f.urls.filter(url=>url.includes('/uv_measures?')||url.includes('/places/nearest?')).length,2);
  assert.ok(release);
  f.restart(); // Models Pebble's separate settings JS engine, same native storage.
  const revision=f.client.setAppData(false).settings.revision;
  assert.equal(revision,1);
  release();
  await rejected;
  assert.equal(source.state().settings.appData,false);
  assert.equal(source.state().locations.length,0);
  assert.equal(f.client.state().locations.length,0);
});

test('Separate settings sessions also invalidate obsolete supplement and station selections', async()=>{
  for (const change of ['complete','station']) {
    let release;
    const f=fixture({settings:null,supplementHttp:()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>supplementalForecast()});})});
    const original=f.client;
    const pending=original.getWeather(REQUEST);
    const rejected=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
    await flush();
    f.restart();
    if(change==='complete') f.client.setCompleteWeather(false);
    else f.client.setStation('saved-cb',station.id);
    release();
    await rejected;
    assert.equal(original.state().locations.length,0);
    assert.equal(f.client.state().locations.length,0);
  }
});

test('Diagnostics tagged with a previous settings revision are hidden after a cross-session race', async()=>{
  const f=fixture();
  await f.client.getWeather(REQUEST);
  const obsolete=f.values.get('chmu.status.v1');
  f.client.setAppData(true);
  f.values.set('chmu.status.v1',obsolete); // A late old-session write cannot restore visible settings data.
  assert.equal(f.client.state().locations.length,0);
  f.restart();
  assert.equal(f.client.state().locations.length,0);
});

function measured(temperature=6.8, age=600, fields={}) {
  return {dataPoints:[{timestamp:new Date(NOW-age*1000).toISOString(),values:{T:String(temperature),...fields}}],
    dial:{T:{Code:'T',UnitHTML:'°C'},H:{Code:'H',UnitHTML:'%'},F:{Code:'F',UnitHTML:'m.s<sup>-1</sup>'},D:{Code:'D',UnitHTML:'°'}}};
}
function stationChoices() {
  return ['a','b','c','d'].map((id,i)=>({...station,id,name:'Station '+id,
    latitude:48.975+i*0.01,longitude:14.476,elevation:387,wsi:'station-wsi-'+id}));
}

test('Climate graph supplies measured humidity and wind with their original shared timestamp and provenance', async()=>{
  const f=fixture();
  f.setGraph(measured(6.8,600,{H:'86',F:'3.2',D:'324'}));
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.ok(f.urls.some(url=>url.includes('/graf.meteo-stanice.klima-10m/')));
  assert.equal(f.urls.some(url=>url.includes('teplota-10m')),false);
  assert.equal(p.humidity.numericValue.value,86);
  assert.ok(Math.abs(p.wind_speed.numericValue.value-11.52)<1e-10);
  assert.equal(p.wind_direction.numericValue.value,324);
  assert.equal(p.humidity_observed_at.timestamp.value,NOW/1000-600);
  assert.equal(p.wind_observed_at.timestamp.value,NOW/1000-600);
  const d=f.client.state().locations[0];
  assert.match(d.humiditySource,/station/i);
  assert.match(d.windSource,/station/i);
  assert.equal(d.humidityObservedAt,NOW/1000-600);
  assert.equal(d.windObservedAt,NOW/1000-600);
  assert.equal(d.stationStatus,'fresh');
  assert.equal(d.lastSuccessfulFetch,NOW/1000);
  assert.equal(d.latestSampleAt,NOW/1000-600);
  assert.equal(d.measurementAgeSec,600);
});

test('Automatic selection tries at most three stations and chooses fresh backups by distance rather than response order', async()=>{
  let releaseCloser;
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(url.endsWith('/b')) return new Promise(resolve=>{releaseCloser=()=>resolve({ok:true,json:async()=>measured(9.1)});});
    if(url.endsWith('/c')) return {ok:true,json:async()=>measured(10.2)};
    return {ok:false,status:503};
  }});
  f.catalog.stations=stationChoices();
  let result;
  f.client.getWeather(REQUEST).then(value=>{result=value;});
  await flush();
  assert.equal(result,undefined,'a faster farther station cannot outrank the pending closer station');
  assert.equal(typeof releaseCloser,'function');
  releaseCloser();
  await flush();
  const p=result.instances[0].properties;
  assert.equal(p.temperature.numericValue.value,9.1);
  assert.equal(p.station.longText.text,'Station b');
  assert.equal(f.client.state().locations[0].stationId,'b');
  assert.ok(f.urls.some(url=>url.endsWith('/c')),'two backup graph requests run concurrently');
  assert.equal(f.urls.some(url=>url.endsWith('/d')),false);
});

test('Unavailable first three automatic stations never expand into a fourth attempt', async()=>{
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(url.endsWith('/d')) return {ok:true,json:async()=>measured(12)};
    return {ok:false,status:503};
  }});
  f.catalog.stations=stationChoices();
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.temperature.numericValue.value,5);
  assert.equal(p.is_forecast.boolean.value,true);
  assert.equal(f.urls.filter(url=>url.includes('graf.meteo-stanice.klima')).length,3);
  assert.equal(f.urls.some(url=>url.endsWith('/d')),false);
  assert.equal(f.client.state().locations[0].stationStatus,'unavailable');
});

test('Manual station failure uses forecast and never silently switches to a fresh nearby station', async()=>{
  const f=fixture({settings:{stations:{'saved-cb':'a'},completeWeather:false},http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(url.endsWith('/b')) return {ok:true,json:async()=>measured(9.1)};
    return {ok:false,status:503};
  }});
  f.catalog.stations=stationChoices();
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.is_forecast.boolean.value,true);
  assert.equal(f.urls.some(url=>/\/[bcd]$/.test(url)),false);
  const d=f.client.state().locations[0];
  assert.equal(d.stationMode,'manual');
  assert.equal(d.requestedStationId,'a');
  assert.equal(d.stationStatus,'unavailable');
});

test('Station picker exposes only sorted nearby public metadata and validates against the actual location eligibility', async()=>{
  const f=fixture();
  const choices=stationChoices();
  const remote={...station,id:'remote',latitude:50,longitude:14.476};
  f.catalog.stations=[choices[2],remote,choices[0],choices[1]];
  await f.client.getWeather(REQUEST);
  const state=f.client.state();
  assert.equal(state.stations,undefined,'there is no global all-stations picker');
  const eligible=state.locations[0].eligibleStations;
  assert.deepEqual(eligible.map(s=>s.id),['a','b','c']);
  for(const point of eligible) assert.deepEqual(Object.keys(point).sort(),['distanceKm','elevation','id','name']);
  assert.equal(JSON.stringify(state).includes('latitude'),false);
  assert.equal(JSON.stringify(state).includes('longitude'),false);
  assert.throws(()=>f.client.setStation('saved-cb','remote'),error=>error.code==='INVALID_ARGS');
  assert.equal(f.client.setStation('saved-cb','b').settings.stations['saved-cb'],'b');
});

test('Persisted out-of-range or unsupported manual stations stay unavailable until the user clears them', async()=>{
  for(const id of ['remote','removed']) {
    const f=fixture({settings:{stations:{'saved-cb':id},completeWeather:false}});
    f.catalog.stations.push({...station,id:'remote',latitude:50,longitude:14.476});
    const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
    assert.equal(p.is_forecast.boolean.value,true);
    assert.equal(f.urls.some(url=>url.includes('graf.meteo-stanice')),false);
    assert.equal(f.client.state().locations[0].stationStatus,id==='remote'?'out-of-range':'unsupported');
    f.client.setStation('saved-cb','');
    assert.equal((await f.client.getWeather(REQUEST)).instances[0].properties.temperature.numericValue.value,6.8);
  }
});

test('Stale and unavailable observations retain honest last-sample and download diagnostics even when no weather is usable', async()=>{
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteo-stanice')) return {ok:true,json:async()=>measured(6.8,7200,{H:'86',F:'3.2',D:'324'})};
    return {ok:false,status:503};
  }});
  await assert.rejects(f.client.getWeather(REQUEST),error=>error.code==='PLUGIN_UNAVAILABLE');
  const d=f.client.state().locations[0];
  assert.equal(d.stationStatus,'stale');
  assert.equal(d.latestSampleAt,NOW/1000-7200);
  assert.equal(d.latestSampleTemperatureC,6.8);
  assert.equal(d.measurementAgeSec,7200);
  assert.equal(d.lastSuccessfulFetch,NOW/1000);
  assert.equal(d.observedAt,null);
  assert.equal(d.temperature,'');
  assert.equal(d.humidity,'');
});

test('No station at comparable elevation reports the reason and retains only the forecast', async()=>{
  const f=fixture();
  f.catalog.stations=[{...station,elevation:1400}];
  const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.is_forecast.boolean.value,true);
  assert.equal(f.client.state().locations[0].stationStatus,'no-suitable-station');
  assert.match(f.client.state().locations[0].stationReason,/elevation/);
});

test('Three hung station attempts remain bounded by the original seventeen-second request budget', async()=>{
  const f=fixture({http:async url=>url.includes('graf.meteogram/')
    ? {ok:true,json:async()=>forecast()} : new Promise(()=>{})});
  f.catalog.stations=stationChoices();
  let result;
  f.client.getWeather(REQUEST).then(value=>{result=value;});
  await f.tick(16999);
  assert.equal(result,undefined);
  await f.tick(1);
  assert.equal(result.instances[0].properties.is_forecast.boolean.value,true);
  assert.equal(f.urls.filter(url=>url.includes('graf.meteo-stanice.klima')).length,3);
  assert.equal(f.urls.some(url=>url.endsWith('/d')),false);
  assert.equal(f.timers.size,0);
});

test('ČHMÚ UV works without app daily summaries or Open-Meteo, while UV off preserves app daily summaries', async()=>{
  const f=fixture({settings:{appData:false,completeWeather:false,uvSource:'chmu'},appHttp:appHTTP()});
  let p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index.numericValue.value,1.5);
  assert.equal(p.app_forecast_updated_at,undefined);
  assert.equal(f.urls.some(url=>url.includes('/places/nearest?')),false);
  assert.equal(f.urls.some(url=>url.includes('open-meteo')),false);
  f.client.setUVSource('off');
  f.client.setAppData(true);
  f.urls.length=0;
  p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index,undefined);
  assert.equal(p.uv_source,undefined);
  assert.equal(p.uv_updated_at,undefined);
  assert.equal(p.high.numericValue.value,8.88);
  assert.ok(p.app_forecast_updated_at);
  assert.equal(f.urls.some(url=>url.includes('/uv_measures?')),false);
  assert.ok(f.urls.some(url=>url.includes('/places/nearest?')));
  assert.equal(f.client.state().locations[0].uvStatus,'disabled');
});

test('Explicit Open-Meteo UV requires completion and never requests ČHMÚ UV', async()=>{
  const f=fixture({settings:{appData:false,completeWeather:false,uvSource:'open-meteo'},appHttp:appHTTP()});
  let p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index,undefined);
  assert.equal(f.urls.some(url=>url.includes('chmu.rails.cz')||url.includes('open-meteo')),false);
  assert.match(f.client.state().locations[0].uvReason,/requires.*enabled/);
  f.client.setCompleteWeather(true);
  p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index.numericValue.value,0);
  assert.match(p.uv_source.longText.text,/Open-Meteo/);
  assert.equal(f.urls.some(url=>url.includes('/uv_measures?')),false);
});

test('UV choice persists across sessions, changes revision once, and rejects unsupported settings', async()=>{
  const f=fixture({settings:null,appHttp:appHTTP()});
  await f.client.getWeather(REQUEST);
  const original=f.client.state().settings.revision;
  assert.equal(f.client.setUVSource('chmu').settings.revision,original);
  for(const value of ['automatic','',null,12]) assert.throws(()=>f.client.setUVSource(value),error=>error.code==='INVALID_ARGS');
  assert.equal(f.client.state().settings.revision,original);
  assert.equal(f.client.setUVSource('open-meteo').settings.revision,original+1);
  assert.deepEqual(f.client.state().locations,[]);
  f.restart();
  let p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.match(p.uv_source.longText.text,/Open-Meteo/);
  f.client.setUVSource('off');
  f.restart();
  p=(await f.client.getWeather(REQUEST)).instances[0].properties;
  assert.equal(p.uv_index,undefined);
  assert.equal(p.uv_source,undefined);
  assert.equal(p.uv_updated_at,undefined);
  assert.equal(f.client.state().settings.uvSource,'off');
});

test('A cross-session UV choice change rejects an already-resolved obsolete UV payload before publication', async()=>{
  let release;
  const f=fixture({settings:null,appHttp:appHTTP(),http:(url,state,init)=>{
    if(url.startsWith('https://chmu.rails.cz/')) return appHTTP()(url,init);
    if(url.includes('graf.meteo-stanice')) return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>measured()});});
    return {ok:true,json:async()=>url.includes('open-meteo')?supplementalForecast():forecast()};
  }});
  const original=f.client;
  const pending=original.getWeather(REQUEST);
  const rejected=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
  await flush();
  assert.ok(f.urls.some(url=>url.includes('/uv_measures?')));
  f.restart();
  f.client.setUVSource('off');
  release();
  await rejected;
  assert.deepEqual(original.state().locations,[]);
  assert.equal(original.state().settings.uvSource,'off');
  assert.equal(f.client.state().settings.uvSource,'off');
});

test('Stale backup diagnostics keep the sample attributed to the station that supplied it', async()=>{
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(url.endsWith('/a')) return {ok:true,json:async()=>measured(1,9000)};
    if(url.endsWith('/b')) return {ok:true,json:async()=>measured(2,7200)};
    return {ok:false,status:503};
  }});
  f.catalog.stations=stationChoices();
  await f.client.getWeather(REQUEST);
  const d=f.client.state().locations[0];
  assert.equal(d.stationId,'a');
  assert.equal(d.latestSampleStationId,'b');
  assert.equal(d.latestSampleStationName,'Station b');
  assert.equal(d.latestSampleTemperatureC,2);
  assert.equal(d.latestSampleAt,NOW/1000-7200);
});

test('A measurement expiring while optional feeds are pending becomes a forecast with an honest stale reason', async()=>{
  let release;
  const f=fixture({settings:null,supplementHttp:()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>supplementalForecast()});})});
  f.setGraph(measured(6.8,3599,{H:'86',F:'3.2',D:'324'}));
  const pending=f.client.getWeather(REQUEST);
  await flush();
  f.setNow(NOW+2000);
  release();
  const p=(await pending).instances[0].properties;
  assert.equal(p.is_forecast.boolean.value,true);
  assert.equal(p.temperature.numericValue.value,5);
  assert.equal(p.humidity_observed_at,undefined);
  assert.equal(p.wind_observed_at,undefined);
  const d=f.client.state().locations[0];
  assert.equal(d.stationStatus,'stale');
  assert.match(d.stationReason,/older than one hour/);
  assert.equal(d.measurementAgeSec,3601);
});

test('Upgrading old source settings preserves disabled services when creating an independent UV preference', async()=>{
  for(const complete of [false,true]) {
    const f=fixture({settings:null,appHttp:appHTTP()});
    f.values.set('chmu.settings.v1',JSON.stringify({appData:false,completeWeather:complete,stations:{}}));
    f.restart();
    assert.equal(f.client.state().settings.uvSource,complete?'open-meteo':'off');
    const p=(await f.client.getWeather(REQUEST)).instances[0].properties;
    assert.equal(f.urls.some(url=>url.includes('chmu.rails.cz')),false,'an upgrade must not re-enable the app service');
    if(complete) assert.match(p.uv_source.longText.text,/Open-Meteo/);
    else {assert.equal(p.uv_index,undefined);assert.equal(f.urls.some(url=>url.includes('open-meteo')),false);}
    f.client.setUVSource('chmu');
    assert.equal((await f.client.getWeather(REQUEST)).instances[0].properties.uv_index.numericValue.value,1.5,'explicit new UV choice can enable ČHMÚ independently');
  }
  const f=fixture({settings:null,appHttp:appHTTP()});
  f.values.set('chmu.settings.v1',JSON.stringify({appData:true,completeWeather:false}));
  f.restart();
  assert.equal(f.client.state().settings.uvSource,'chmu');
  f.client.setAppData(false);
  assert.equal(f.client.state().settings.uvSource,'chmu','the new daily-only switch preserves the now-explicit UV preference');
});

test('An automatic station change never reuses another station original-sample diagnostics', async()=>{
  let unavailable=false;
  const f=fixture({http:async url=>{
    if(url.includes('graf.meteogram/')) return {ok:true,json:async()=>forecast()};
    if(!unavailable && url.endsWith('/a')) return {ok:true,json:async()=>measured(1)};
    return {ok:false,status:503};
  }});
  f.catalog.stations=stationChoices().slice(0,1);
  await f.client.getWeather(REQUEST);
  unavailable=true;
  f.catalog.stations=[stationChoices()[1]];
  await f.client.getWeather(REQUEST);
  const d=f.client.state().locations[0];
  assert.equal(d.stationId,'b');
  assert.equal(d.latestSampleAt,null);
  assert.equal(d.latestSampleStationId,'');
  assert.equal(d.lastSuccessfulFetch,null);
});
