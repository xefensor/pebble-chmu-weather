'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {spawnSync} = require('node:child_process');
const {createHistory} = require('../src/lib/forecast-history');

const HOUR = 3600;
const NOW = Date.parse('2026-10-31T10:37:00Z');
const CURRENT = Math.floor(NOW / 1000 / HOUR) * HOUR;
const POINT = {id:'75',latitude:48.975,longitude:14.476};
const KEY = 'chmu.forecast-history.v1';

function hour(time, temperatureC = 6.81234, conditionCode = 'cloudy', other = {}) {
  return {time,temperatureC,conditionCode,...other};
}
function forecast(hours) { return {hours}; }
function fixture(at = NOW) {
  let now = at;
  const values = new Map();
  const storage = {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  let history = createHistory({storage,now:()=>now});
  return {storage,values,clock:()=>now,setNow:value=>{now=value;},
    merge:(point,body,fetchedAt = Math.floor(now / 1000),policy)=>history.merge(point,body,fetchedAt,policy),
    restart:()=>{history=createHistory({storage,now:()=>now});},
    records:()=>JSON.parse(values.get(KEY)||'{"records":[]}').records};
}

test('A later ALADIN run fills only missing past-today hours and preserves their exact values and original fetch times', () => {
  const f = fixture();
  const originalFetch = NOW / 1000 - 60;
  const old = forecast([hour(CURRENT - 2 * HOUR,4.123456,'sun'),hour(CURRENT - HOUR),
    hour(CURRENT,5),hour(CURRENT + HOUR,7)]);
  assert.deepEqual(f.merge(POINT,old,originalFetch).historicalTimes,[]);
  const latest = forecast([hour(CURRENT,5.5),hour(CURRENT + HOUR,7.5)]);
  const raw = JSON.stringify(latest);
  const actual = f.merge(POINT,latest);
  assert.deepEqual(actual.hours.map(h=>h.time),[CURRENT - 2 * HOUR,CURRENT - HOUR,CURRENT,CURRENT + HOUR]);
  assert.deepEqual(actual.historicalTimes,[CURRENT - 2 * HOUR,CURRENT - HOUR]);
  assert.deepEqual(actual.historicalFetchedAt,{[CURRENT - 2 * HOUR]:originalFetch,[CURRENT - HOUR]:originalFetch});
  assert.equal(actual.hours[0].temperatureC,4.123456);
  assert.equal(actual.hours[0].conditionCode,'sun');
  assert.equal(actual.hours[0].retainedForecast,true);
  assert.equal(actual.hours[2].temperatureC,5.5);
  assert.equal(actual.hours[2].retainedForecast,undefined);
  assert.equal(JSON.stringify(latest),raw,'merge never rewrites the current forecast');
  assert.notEqual(actual.hours,latest.hours);
});

test('A cold midday install does not invent a missing morning or persist current/future forecast slots', () => {
  const f = fixture();
  const body = forecast(Array.from({length:73},(_,i)=>hour(CURRENT + i * HOUR,i)));
  const actual = f.merge(POINT,body);
  assert.deepEqual(actual.hours,body.hours);
  assert.deepEqual(actual.historicalTimes,[]);
  assert.deepEqual(actual.historicalFetchedAt,{});
  assert.deepEqual(f.records(),[]);
  f.setNow(NOW + HOUR * 1000);
  assert.deepEqual(f.merge(POINT,forecast(body.hours.slice(1))).historicalTimes,[]);
});

test('A reusable forecast can accumulate a newly past slot without renewing its original download stamp', () => {
  const f = fixture();
  const fetchedAt = NOW / 1000;
  const body = forecast([hour(CURRENT),hour(CURRENT + HOUR),hour(CURRENT + 2 * HOUR)]);
  f.merge(POINT,body,fetchedAt);
  f.setNow(NOW + HOUR * 1000);
  f.merge(POINT,body,fetchedAt);
  f.restart();
  const result = f.merge(POINT,forecast(body.hours.slice(1)));
  assert.deepEqual(result.historicalTimes,[CURRENT]);
  assert.equal(result.historicalFetchedAt[CURRENT],fetchedAt);
});

test('The cutoff is the current UTC hour, not the current minute, and cache cannot fill any current or future slot', () => {
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - HOUR)]));
  const records = f.records();
  records[0].samples.push({time:CURRENT,temperatureC:99,conditionCode:'sun',source:'ALADIN',fetchedAt:NOW / 1000},
    {time:CURRENT + HOUR,temperatureC:98,conditionCode:'sun',source:'ALADIN',fetchedAt:NOW / 1000});
  f.values.set(KEY,JSON.stringify({version:1,records}));
  const actual = f.merge(POINT,forecast([hour(CURRENT + 2 * HOUR,5)]));
  assert.deepEqual(actual.hours.map(h=>h.time),[CURRENT - HOUR,CURRENT + 2 * HOUR]);
  assert.deepEqual(actual.historicalTimes,[CURRENT - HOUR]);
  assert.ok(f.records()[0].samples.every(h=>h.time < CURRENT));
});

test('Every explicit current row wins, including past nulls, and a fresh null prevents later resurrection', () => {
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - HOUR,6)]),NOW / 1000 - 60);
  const explicit = hour(CURRENT - HOUR,null,'unknown',{humidity:84});
  const actual = f.merge(POINT,forecast([explicit,hour(CURRENT)]));
  assert.deepEqual(actual.hours[0],explicit);
  assert.deepEqual(actual.historicalTimes,[]);
  assert.deepEqual(f.records()[0].samples,[]);
  assert.deepEqual(f.records()[0].retractions,[{time:CURRENT - HOUR,fetchedAt:NOW / 1000}]);
  assert.deepEqual(f.merge(POINT,forecast([hour(CURRENT)])).historicalTimes,[]);
});

test('A supplied newer past row overrides retained values rather than replacing current or future values', () => {
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - HOUR,1)]),NOW / 1000 - 60);
  const latest = forecast([hour(CURRENT - HOUR,9,'light_rain'),hour(CURRENT,null,'unknown'),hour(CURRENT + HOUR,7)]);
  assert.deepEqual(f.merge(POINT,latest).hours,latest.hours);
  const replay = f.merge(POINT,forecast([hour(CURRENT)]));
  assert.equal(replay.hours[0].temperatureC,9);
  assert.equal(replay.hours[0].conditionCode,'light_rain');
});

test('Delayed older downloads win their own supplied output but cannot downgrade or null-delete newer retained samples', () => {
  const f = fixture();
  const recent = NOW / 1000 - 30;
  f.merge(POINT,forecast([hour(CURRENT - HOUR,9)]),recent);
  for (const value of [1,null]) {
    const body = forecast([hour(CURRENT - HOUR,value),hour(CURRENT)]);
    assert.equal(f.merge(POINT,body,NOW / 1000 - HOUR).hours[0].temperatureC,value);
    const replay = f.merge(POINT,forecast([hour(CURRENT)]));
    assert.equal(replay.hours[0].temperatureC,9);
    assert.equal(replay.historicalFetchedAt[CURRENT - HOUR],recent);
  }
});

test('A newer null keeps an ordering watermark so delayed older or equal-stamp values cannot resurrect it after restart', () => {
  const f = fixture();
  const retractedAt = NOW / 1000 - 30;
  f.merge(POINT,forecast([hour(CURRENT - HOUR,6)]),NOW / 1000 - 120);
  f.merge(POINT,forecast([hour(CURRENT - HOUR,null)]),retractedAt);
  f.restart();
  for (const fetchedAt of [NOW / 1000 - 90,retractedAt]) {
    const supplied = forecast([hour(CURRENT - HOUR,1),hour(CURRENT)]);
    assert.equal(f.merge(POINT,supplied,fetchedAt).hours[0].temperatureC,1,'raw supplied row still wins its own output');
    assert.deepEqual(f.merge(POINT,forecast([hour(CURRENT)])).historicalTimes,[]);
    assert.deepEqual(f.records()[0].samples,[]);
    assert.deepEqual(f.records()[0].retractions,[{time:CURRENT - HOUR,fetchedAt:retractedAt}]);
  }
  f.merge(POINT,forecast([hour(CURRENT - HOUR,8)]),NOW / 1000);
  const restored = f.merge(POINT,forecast([hour(CURRENT)]));
  assert.deepEqual(restored.historicalTimes,[CURRENT - HOUR]);
  assert.equal(restored.hours[0].temperatureC,8);
  assert.deepEqual(f.records()[0].retractions,[]);
});

test('Retrospective downloads older than six hours remain past context only when a fresh usable forecast accompanies them', () => {
  const f = fixture(NOW - 8 * HOUR * 1000);
  const past = CURRENT - 9 * HOUR;
  const oldFetch = f.clock() / 1000 - 60;
  f.merge(POINT,forecast([hour(past,3.25)]),oldFetch);
  f.setNow(NOW);
  f.restart();
  const current = forecast([hour(CURRENT,6)]);
  const actual = f.merge(POINT,current);
  assert.deepEqual(actual.historicalTimes,[past]);
  assert.equal(actual.historicalFetchedAt[past],oldFetch);
  assert.equal(actual.hours[1].temperatureC,6);
  const stale = f.merge(POINT,current,NOW / 1000 - 6 * HOUR - 1);
  assert.deepEqual(stale.hours,current.hours);
  assert.deepEqual(stale.historicalTimes,[]);
});

test('Stale, malformed and future download stamps neither add samples nor erase good retained values', () => {
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - HOUR,9)]),NOW / 1000 - 60);
  for (const fetchedAt of [0,null,undefined,'now',NaN,Infinity,NOW / 1000 + 301,NOW / 1000 - 6 * HOUR - 1,NOW / 1000 + 0.5]) {
    const body = forecast([hour(CURRENT - HOUR,null),hour(CURRENT - 2 * HOUR,8),hour(CURRENT)]);
    const result = f.merge(POINT,body,fetchedAt === undefined ? NaN : fetchedAt);
    assert.deepEqual(result.hours,body.hours);
    assert.deepEqual(result.historicalTimes,[],String(fetchedAt));
    const replay = f.merge(POINT,forecast([hour(CURRENT)]));
    assert.deepEqual(replay.historicalTimes,[CURRENT - HOUR]);
    assert.equal(replay.hours[0].temperatureC,9);
  }
  const boundary = fixture();
  boundary.merge(POINT,forecast([hour(CURRENT - HOUR)]),NOW / 1000 - 6 * HOUR);
  assert.equal(boundary.records()[0].samples[0].fetchedAt,NOW / 1000 - 6 * HOUR);
  const future = fixture();
  future.merge(POINT,forecast([hour(CURRENT - HOUR)]),NOW / 1000 + 300);
  assert.equal(future.records()[0].samples[0].fetchedAt,NOW / 1000 + 300);
});

test('A public point is shared across saved locations, but a changed point ID or exact coordinates never reuses its history', () => {
  const f = fixture();
  f.merge({...POINT,name:'saved home'},forecast([hour(CURRENT - HOUR,6)]));
  const body = forecast([hour(CURRENT)]);
  assert.deepEqual(f.merge({...POINT,name:'another saved location'},body).historicalTimes,[CURRENT - HOUR]);
  assert.deepEqual(f.merge({...POINT,id:'76'},body).historicalTimes,[]);
  assert.deepEqual(f.merge({...POINT,latitude:POINT.latitude + 0.000001},body).historicalTimes,[]);
  assert.deepEqual(f.merge({...POINT,longitude:POINT.longitude + 0.000001},body).historicalTimes,[]);
});

test('Zero Celsius and zero coordinates are valid and retained without coercing other types', () => {
  const f = fixture();
  const zero = {id:'0',latitude:0,longitude:0};
  f.merge(zero,forecast([hour(CURRENT - HOUR,0,'unknown')]));
  const actual = f.merge(zero,forecast([hour(CURRENT)]));
  assert.equal(actual.hours[0].temperatureC,0);
  assert.equal(actual.hours[0].conditionCode,'unknown');
  for (const point of [null,{},[],{...POINT,id:0},{...POINT,id:''},{...POINT,id:' 75'},
    {...POINT,latitude:'48.975'},{...POINT,latitude:NaN},{...POINT,latitude:91},{...POINT,longitude:181}]) {
    assert.deepEqual(f.merge(point,forecast([hour(CURRENT)])).historicalTimes,[]);
  }
});

test('Only valid finite numeric forecast temperatures and known condition codes are persisted', () => {
  for (const value of [null,undefined,'0',false,true,NaN,Infinity,-101,101,[],{}]) {
    const f = fixture();
    const row = hour(CURRENT - HOUR,value); row.temperatureC = value;
    f.merge(POINT,forecast([row,hour(CURRENT)]));
    assert.deepEqual(f.records()[0].samples,[],String(value));
    assert.equal(f.records()[0].retractions.length,1);
    assert.deepEqual(Object.keys(f.records()[0].retractions[0]).sort(),['fetchedAt','time']);
  }
  for (const condition of [null,undefined,'invalid',1,{},[]]) {
    const f = fixture();
    const row = hour(CURRENT - HOUR,6,condition); row.conditionCode = condition;
    f.merge(POINT,forecast([row,hour(CURRENT)]));
    assert.deepEqual(f.records()[0].samples,[],String(condition));
    assert.equal(f.records()[0].retractions.length,1);
  }
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - 2 * HOUR,-100),hour(CURRENT - HOUR,100),hour(CURRENT)]));
  assert.deepEqual(f.records()[0].samples.map(h=>h.temperatureC),[-100,100]);
});

test('Observed, blended, supplemental or already-retained rows never become new ALADIN history', () => {
  const markers = [{observedAt:NOW / 1000},{isForecast:false},{retainedForecast:true},
    {source:'ČHMÚ station measurement'},{source:'Open-Meteo'},
    {sources:{temperatureC:'station',conditionCode:'ALADIN'}},
    {sources:{temperatureC:'ALADIN',conditionCode:'Open-Meteo'}}];
  for (const marker of markers) {
    const f = fixture();
    f.merge(POINT,forecast([hour(CURRENT - HOUR,6,'cloudy',marker),hour(CURRENT)]));
    assert.deepEqual(f.records(),[],JSON.stringify(marker));
  }
});

test('Malformed, duplicate or non-hourly raw timestamps cannot contaminate persistent history', () => {
  const bodies = [null,{},forecast([]),forecast([null]),forecast([hour(CURRENT - 1)]),
    forecast([hour(CURRENT - HOUR + 0.5)]),forecast([hour(String(CURRENT))]),forecast([hour(0)]),
    forecast([hour(-HOUR)]),forecast([hour(CURRENT - HOUR),hour(CURRENT - HOUR)]),
    forecast(Array.from({length:74},(_,i)=>hour(CURRENT + i * HOUR)))];
  for (const body of bodies) {
    const f = fixture();
    const result = f.merge(POINT,body);
    assert.deepEqual(result.historicalTimes,[]);
    assert.deepEqual(f.records(),[]);
  }
});

test('Persistent records contain only public point identity and model samples, excluding unrelated point/hour data', () => {
  const f = fixture();
  const point = {...POINT,name:'private-label-placeholder',savedLocationId:'home-placeholder',station:{id:'station-placeholder'}};
  f.merge(point,forecast([hour(CURRENT - HOUR,6,'cloudy',{humidity:84,windSpeed:3,unrelated:'private-hour-placeholder'})]));
  const record = f.records()[0];
  assert.deepEqual(Object.keys(record).sort(),['date','id','latitude','longitude','retractions','samples','touchedAt']);
  assert.deepEqual(Object.keys(record.samples[0]).sort(),['conditionCode','fetchedAt','source','temperatureC','time']);
  assert.equal(record.samples[0].source,'ALADIN');
  assert.doesNotMatch(f.values.get(KEY),/private-label|home-placeholder|station-placeholder|private-hour/);
});

test('History is pruned at Prague midnight even when UTC still has the previous calendar date', () => {
  const before = Date.parse('2026-10-31T22:30:00Z');
  const f = fixture(before);
  f.merge(POINT,forecast([hour(Date.parse('2026-10-31T21:00:00Z') / 1000)]));
  assert.equal(f.records()[0].date,'2026-10-31');
  f.setNow(Date.parse('2026-10-31T23:05:00Z'));
  const current = Date.parse('2026-10-31T23:00:00Z') / 1000;
  assert.deepEqual(f.merge(POINT,forecast([hour(current)])).historicalTimes,[]);
  assert.deepEqual(f.records(),[]);
});

test('Spring and autumn Prague days preserve all23/25 actual UTC slots without inventing or collapsing hours', () => {
  for (const [startText,count,date] of [['2026-03-28T23:00:00Z',23,'2026-03-29'],
    ['2026-10-24T22:00:00Z',25,'2026-10-25']]) {
    const start = Date.parse(startText) / 1000;
    const end = start + count * HOUR;
    const f = fixture((end - HOUR / 2) * 1000);
    const all = Array.from({length:count},(_,i)=>hour(start + i * HOUR,i));
    const original = f.clock() / 1000 - 60;
    f.merge(POINT,forecast(all),original);
    f.restart();
    const result = f.merge(POINT,forecast(all.slice(-1)));
    assert.deepEqual(result.hours.map(h=>h.time),all.map(h=>h.time),date);
    assert.equal(new Set(result.hours.map(h=>h.time)).size,count);
    assert.equal(result.historicalTimes.length,count - 1);
    assert.equal(f.records()[0].date,date);
    assert.ok(f.records()[0].samples.length <= 25);
    assert.ok(f.records()[0].samples.every(h=>h.time < end - HOUR));
    assert.ok(Object.values(result.historicalFetchedAt).every(time=>time === original));
    if (count === 25) {
      assert.equal(result.hours.find(h=>h.time === Date.parse('2026-10-25T00:00:00Z') / 1000).temperatureC,2);
      assert.equal(result.hours.find(h=>h.time === Date.parse('2026-10-25T01:00:00Z') / 1000).temperatureC,3);
    }
  }
});

test('The persistent store keeps at most16 recently-used public points and evicts the least recent one', () => {
  const f = fixture();
  const point = i=>({id:String(i),latitude:48 + i / 1000,longitude:14});
  for (let i=0;i<16;i++) f.merge(point(i),forecast([hour(CURRENT - HOUR,i)]));
  f.merge(point(0),forecast([hour(CURRENT)]));
  f.merge(point(16),forecast([hour(CURRENT - HOUR,16)]));
  assert.equal(f.records().length,16);
  assert.ok(f.records().some(record=>record.id === '0'));
  assert.equal(f.records().some(record=>record.id === '1'),false);
  assert.deepEqual(f.merge(point(1),forecast([hour(CURRENT)])).historicalTimes,[]);
  assert.equal(f.merge(point(0),forecast([hour(CURRENT)])).hours[0].temperatureC,0);
});

test('Corrupt, oversized, foreign-date or non-model persisted data is ignored safely', () => {
  const payloads = ['not json',' '.repeat(100001),JSON.stringify({version:2,records:[]}),
    JSON.stringify({version:1,records:Array(17).fill({})})];
  const base = fixture();
  base.merge(POINT,forecast([hour(CURRENT - HOUR)]));
  const record = base.records()[0];
  for (const change of [{date:'2026-10-30'},{date:'2026-02-30'},{latitude:'48.975'},
    {samples:Array(26).fill(record.samples[0])},
    {samples:[{...record.samples[0],time:CURRENT - 1}]},
    {samples:[{...record.samples[0],temperatureC:null}]},
    {samples:[{...record.samples[0],source:'station'}]},
    {samples:[{...record.samples[0],fetchedAt:NOW / 1000 + 301}]}]) {
    payloads.push(JSON.stringify({version:1,records:[{...record,...change}]}));
  }
  for (const payload of payloads) {
    const f = fixture();
    f.values.set(KEY,payload);
    assert.deepEqual(f.merge(POINT,forecast([hour(CURRENT)])).historicalTimes,[]);
    assert.deepEqual(f.records(),[]);
  }
});

test('Storage failures, absent storage and invalid clocks do not break current forecasts', () => {
  const body = forecast([hour(CURRENT - HOUR),hour(CURRENT)]);
  for (const storage of [undefined,{},
    {getItem(){throw Error('read');},setItem(){throw Error('write');}}]) {
    const h = createHistory({storage,now:()=>NOW});
    assert.deepEqual(h.merge(POINT,body,NOW / 1000).hours,body.hours);
  }
  for (const value of [null,'now',NaN,Infinity,0,-1,9e20,Date.parse('9999-01-01T00:00:00Z')]) {
    const f = fixture(value);
    assert.deepEqual(f.merge(POINT,body,NOW / 1000).hours,body.hours);
    assert.equal(f.values.size,0);
  }
  const h = createHistory({now:()=>{throw Error('clock');}});
  assert.deepEqual(h.merge(POINT,body,NOW / 1000).hours,body.hours);
});

test('A merge captures the clock exactly once so a midnight transition cannot split pruning and storage dates', () => {
  let calls = 0;
  const f = fixture();
  const h = createHistory({storage:f.storage,now:()=>{calls++;return calls === 1 ? NOW : NOW + 86400000;}});
  h.merge(POINT,forecast([hour(CURRENT - HOUR)]),NOW / 1000);
  assert.equal(calls,1);
  assert.equal(f.records()[0].date,'2026-10-31');
});

test('Origin no-store returns raw rows only, removes this point history, and does not affect another point', () => {
  const f = fixture();
  const other = {...POINT,id:'76'};
  f.merge(POINT,forecast([hour(CURRENT - HOUR,6)]));
  f.merge(other,forecast([hour(CURRENT - HOUR,7)]));
  const body = forecast([hour(CURRENT - 2 * HOUR,99.123),hour(CURRENT)]);
  const actual = f.merge(POINT,body,NOW / 1000,{noStore:true});
  assert.deepEqual(actual.hours,body.hours);
  assert.deepEqual(actual.historicalTimes,[]);
  assert.deepEqual(actual.historicalFetchedAt,{});
  assert.equal(f.records().some(record=>record.id === POINT.id),false);
  assert.doesNotMatch(f.values.get(KEY),/99\.123/);
  assert.deepEqual(f.merge(POINT,forecast([hour(CURRENT)])).historicalTimes,[]);
  assert.deepEqual(f.merge(other,forecast([hour(CURRENT)])).historicalTimes,[CURRENT - HOUR]);
  const cold = fixture();
  cold.merge(POINT,body,NOW / 1000,{noStore:true});
  assert.deepEqual(cold.records(),[]);
});

test('An unusable ALADIN no-store response can still clear its retained context without a valid body or fetch stamp', () => {
  const f = fixture();
  f.merge(POINT,forecast([hour(CURRENT - HOUR,6)]));
  const actual = f.merge(POINT,forecast([]),0,{noStore:true});
  assert.deepEqual(actual,{hours:[],historicalTimes:[],historicalFetchedAt:{}});
  assert.deepEqual(f.records(),[]);
  assert.deepEqual(f.merge(POINT,forecast([hour(CURRENT)])).historicalTimes,[]);
});

test('Host timezone does not affect Prague keys, retained timestamps or source fetch times', () => {
  const script = `const {createHistory}=require(${JSON.stringify(require.resolve('../src/lib/forecast-history'))});
    const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
    const now=Date.parse('2026-10-25T22:30:00Z');const h=createHistory({storage,now:()=>now});
    const point={id:'75',latitude:48.975,longitude:14.476};
    h.merge(point,{hours:[{time:Date.parse('2026-10-25T00:00:00Z')/1000,temperatureC:4,conditionCode:'cloudy'}]},Math.floor(now/1000));
    process.stdout.write(JSON.stringify([...values]));`;
  const run = zone=>spawnSync(process.execPath,['-e',script],{env:{...process.env,TZ:zone},encoding:'utf8'});
  const utc = run('UTC');
  const la = run('America/Los_Angeles');
  assert.equal(utc.status,0,utc.stderr);
  assert.equal(la.status,0,la.stderr);
  assert.equal(utc.stdout,la.stdout);
  assert.match(utc.stdout,/2026-10-25/);
});
