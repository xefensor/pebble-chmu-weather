'use strict';
// Deterministic network-free checks of the exact PBW JavaScript. The live API
// cannot be asked to remove a previously downloaded morning on demand.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const nativeSandbox = require('./native-sandbox');
const HOUR = 3600000;
const DAY_START = Date.parse('2026-10-30T23:00:00Z'); // Prague midnight.
const FIRST_NOW = Date.parse('2026-10-31T10:15:00Z');
const REQUEST = {category:'weather',item:'location'};

function storage() {
  const values = new Map();
  values.set('chmu.settings.v1',JSON.stringify({stations:{},appData:false,
    completeWeather:false,uvSource:'off',revision:0}));
  return {values,getItem:key => values.get(key) ?? null,
    setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key)};
}
function forecast(start,full) {
  return {parameters:{t2m:{unit:'°C'}},z:387,data:Array.from({length:73},(_,index) => {
    const time = start+index*HOUR;
    const temperature = full ? time === DAY_START+2*HOUR ? -8 :
      time === DAY_START+7*HOUR ? 32 : 17 : index === 1 ? 24 : 22;
    return {validityTime:new Date(time).toISOString(),t2m:temperature,rh2m:80,
      windSpeed:2,windDirection:90,prec:0,cloudsTot:0,icon:10};
  })};
}
function instance(envelope) {
  assert.ok(envelope && envelope.instances.length === 1,'Injected bundle must return the deterministic place');
  return envelope.instances[0].properties;
}
function host(bundle,local) {
  let now = FIRST_NOW;
  let model = forecast(DAY_START,true);
  let requests = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const pebble = {
    readSource:async request => request.item === 'units'
      ? {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:'°C'}},wind_speed:{shortText:{text:'m/s'}}}}]}
      : {instances:[{instanceId:'history-cb',properties:{name:{shortText:{text:'České Budějovice'}},
        latitude:{numericValue:{value:48.975}},longitude:{numericValue:{value:14.476}},current:{boolean:{value:false}}}}]},
    subscribeSource:() => {},refreshSources:() => {},
    secureStorage:{getItem:async () => {throw new Error('Disabled app service must not load credentials');},
      setItem:async () => {throw new Error('Disabled app service must not store credentials');}},
    registerSourceHandler:handler => {pebble.handler=handler;},
    registerConfigHandler:handler => {pebble.config=handler;}
  };
  const fetch = async (url,init={}) => {
    requests++;
    const parsed = new URL(url);
    assert.equal(parsed.hostname,'data-provider.chmi.cz','Injected history check must not contact any other service');
    assert.equal(init.method || 'GET','GET');
    let body;
    if (parsed.pathname === '/api/graphs/graf.meteogram/75') body=model;
    else if (parsed.pathname.startsWith('/api/graphs/graf.meteo-stanice.klima-10m/')) {
      body={dial:{T:{UnitHTML:'°C'},H:{UnitHTML:'%'},F:{UnitHTML:'m/s'},D:{UnitHTML:'°'}},
        dataPoints:[{timestamp:new Date(now-600000).toISOString(),values:{T:'8',H:'86',F:'3',D:'90'}}]};
    } else throw new Error('Unexpected injected history endpoint');
    return {ok:true,status:200,headers:{get:() => null},json:async () => body};
  };
  vm.runInContext(bundle,nativeSandbox({Pebble:pebble,localStorage:local,
    navigator:{geolocation:{getCurrentPosition:() => {throw new Error('Saved place must not request GPS');}}},
    fetch,Date:Clock,console}));
  async function read(force=true) {
    if (force) {
      let reply;
      await pebble.config({type:'refresh'},value => {reply=value;});
      assert.ok(reply && !reply.refreshError && !reply.error,'Injected forecast refresh must succeed');
    }
    let output;
    let error;
    await pebble.handler(REQUEST,{data:value => {output=value;},error:code => {error=code;}});
    assert.ok(!error,'Injected bundled weather handler must succeed');
    return instance(output);
  }
  return {read,requests:() => requests,clock:value => {now=value;},model:value => {model=value;}};
}

module.exports = async function verifyHistory(bundle) {
  const local = storage();
  const warm = host(bundle,local);
  const first = await warm.read();
  assert.equal(first.high.numericValue.value,32);
  assert.equal(first.low.numericValue.value,-8);
  assert.equal(first.today_range_complete.boolean.value,true);
  const history = JSON.parse(local.getItem('chmu.forecast-history.v1'));
  assert.ok(history.records.length > 0 && history.records.length <= 16);
  const currentHour = Math.floor(FIRST_NOW/HOUR)*HOUR;
  for (const point of history.records) {
    assert.ok(point.samples.length <= 25);
    for (const sample of point.samples) {
      assert.ok(sample.time*1000 < currentHour,'Only already-past hours may enter retained history');
      assert.equal(sample.source,'ALADIN');
      assert.equal(sample.observedAt,undefined,'History must not contain station observations');
    }
  }

  const nextNow = FIRST_NOW+2*HOUR+60000;
  const nextHour = Math.floor(nextNow/HOUR)*HOUR;
  warm.clock(nextNow);
  warm.model(forecast(nextHour,false));
  const retained = await warm.read();
  assert.equal(retained.high.numericValue.value,32,'Dropped morning model maximum must survive');
  assert.equal(retained.low.numericValue.value,-8,'Dropped morning model minimum must survive');
  assert.equal(retained.today_range_complete.boolean.value,true);
  assert.equal(retained.daily_coverage.series.longText.values[0],'Full-day forecast');
  assert.ok(retained.forecast_history_hours.numericValue.value > 0);
  assert.equal(retained.forecast_history_oldest_download.timestamp.value,FIRST_NOW/1000);
  assert.ok(retained.hourly_source.series.longText.values.includes('ČHMÚ ALADIN (retained forecast)'));
  const active = Math.floor((nextNow/1000-retained.hourly_temperature.series.start)/3600);
  assert.equal(retained.temperature.numericValue.value,8);
  assert.equal(retained.hourly_temperature.series.numericValue.values[active],8,'Current slot must use the fresh observation');
  assert.equal(retained.hourly_temperature.series.numericValue.values[active+1],24,'Future slot must use the newer model, never retained history');

  const cold = host(bundle,storage());
  cold.clock(nextNow);
  cold.model(forecast(nextHour,false));
  const partial = await cold.read();
  assert.equal(partial.today_range_complete.boolean.value,false,'Cold start cannot reconstruct a missing morning');
  assert.equal(partial.daily_coverage.series.longText.values[0],'Partial-day forecast');
  assert.equal(partial.high.numericValue.value,24);
  assert.equal(partial.low.numericValue.value,22);
  assert.equal(partial.forecast_history_hours,undefined);

  const late = nextNow+7*HOUR;
  warm.clock(late);
  warm.model(forecast(Math.floor(late/HOUR)*HOUR,false));
  const retrospective = await warm.read();
  assert.equal(retrospective.high.numericValue.value,32,'Older past context remains retrospective within the same day');
  assert.equal(retrospective.low.numericValue.value,-8);
  assert.equal(retrospective.today_range_complete.boolean.value,false,'Unseen intervening hours must remain a gap');
  assert.ok(late/1000-retrospective.forecast_history_oldest_download.timestamp.value > 6*3600);
  assert.equal(retrospective.forecast_history_oldest_download.timestamp.value,FIRST_NOW/1000,'Original history download time must survive');
  const lateActive = Math.floor((late/1000-retrospective.hourly_temperature.series.start)/3600);
  assert.equal(retrospective.hourly_temperature.series.numericValue.values[lateActive],8);
  assert.equal(retrospective.hourly_temperature.series.numericValue.values[lateActive+1],24);
  return {exactBundleHistory:'passed',warmHistoryHours:retained.forecast_history_hours.numericValue.value,
    coldStartCoverage:partial.daily_coverage.series.longText.values[0],
    retrospectiveCoverage:retrospective.daily_coverage.series.longText.values[0],
    injectedPublicRequests:warm.requests()+cold.requests()};
};
