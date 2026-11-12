'use strict';
// Live public smoke uses only the exact PBW bundle. It never instantiates the
// source module's personal-service implementation or an authentication client.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nativeSandbox = require('./native-sandbox');
assert.equal(process.env.CHMU_SMOKE_VARIANT,'public',
  'Use python3 scripts/smoke.py to validate the exact public PBW');
const manifest = JSON.parse(process.env.CHMU_SMOKE_MANIFEST);
const allowed = ['data-provider.chmi.cz','opendata.chmi.cz','api.open-meteo.com'].sort();
const declared = manifest.usesPermissions.filter(p => p && p.name === 'Internet').flatMap(p => p.parameters.domains);
assert.deepEqual([...declared].sort(),allowed,'Public transport must match the three manifest domains');
const script = fs.readFileSync(process.env.CHMU_SMOKE_SCRIPT_PATH);
const digest = crypto.createHash('sha256').update(script).digest('hex');
assert.equal(digest,process.env.CHMU_SMOKE_BUNDLE_SHA256,'Executed script must match the packaged PBW');
assert.ok(!script.includes('chmu.rails.cz'),'Public bundle must not contain the app-backend host');
const requests = [];
const children = new Set();
let safetyFailures = 0;
const values = new Map([
  ['chmu.settings.v1',JSON.stringify({appData:true,uvSource:'chmu',completeWeather:true,revision:0})]
]);
const storage = {getItem:key => values.get(key) ?? null,
  setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key)};
function bridge(url,init={}) {
  let parsed;
  try {
    parsed = new URL(url);
    assert.ok(parsed.protocol === 'https:' && allowed.includes(parsed.hostname));
    assert.ok(!parsed.username && !parsed.password);
    assert.equal((init.method || 'GET').toUpperCase(),'GET','Public weather requires no authentication POSTs');
    assert.ok(!Object.keys(init.headers || {}).some(key => key.toLowerCase() === 'authorization'));
  } catch (error) { safetyFailures++; throw error; }
  const record = {host:parsed.hostname,path:parsed.pathname,status:0,startedAt:Date.now()};
  requests.push(record);
  return new Promise((resolve,reject) => {
    const child = spawn(process.env.CHMU_SMOKE_PYTHON || 'python3',[path.join(__dirname,'http-json.py')],
      {stdio:['pipe','pipe','pipe']});
    children.add(child);
    let output = '';
    let done = false;
    function finish(error,value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      children.delete(child);
      record.durationMs = Date.now()-record.startedAt;
      if (error) reject(error); else resolve(value);
    }
    const timer = setTimeout(() => {child.kill();finish(new Error('Developer HTTPS transport timed out'));},10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk => {
      output += chunk;
      if (output.length > 6*1024*1024) {child.kill();finish(new Error('Developer response exceeded its size limit'));}
    });
    child.stderr.resume();
    child.on('error',() => finish(new Error('Developer HTTPS transport could not start')));
    child.on('close',code => {
      if (done) return;
      let response;
      try {response=JSON.parse(output);} catch (_) {}
      if (code !== 0 || !response || !Number.isInteger(response.status)) {
        finish(new Error('Developer HTTPS transport returned an invalid response'));return;
      }
      record.status = response.status;
      const headers = Object.fromEntries(Object.entries(response.headers || {}).map(([key,value]) => [key.toLowerCase(),value]));
      finish(null,{ok:response.status >= 200 && response.status < 300,status:response.status,
        headers:{get:key => headers[String(key).toLowerCase()] ?? null},
        json:async() => {
          assert.notEqual(response.status,304,'A 304 must reuse its cached body');
          return response.body;
        }});
    });
    child.stdin.on('error',() => {});
    child.stdin.end(JSON.stringify({url,init}));
  });
}
const geolocation = {getCurrentPosition:() => {throw Error('Saved location must not invoke GPS');}};
const host = {
  readSource:async request => request.item === 'units'
    ? {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:'°C'}},wind_speed:{shortText:{text:'km/h'}}}}]}
    : {instances:[{instanceId:'public-smoke-cb',properties:{name:{shortText:{text:'České Budějovice'}},
      latitude:{numericValue:{value:48.975}},longitude:{numericValue:{value:14.476}},current:{boolean:{value:false}}}}]},
  subscribeSource:() => {},refreshSources:() => {},
  registerSourceHandler:fn => {host.source=fn;},registerConfigHandler:fn => {host.config=fn;}
};
Object.defineProperty(host,'secureStorage',{get:() => {throw Error('Public build must not access secureStorage');}});
vm.runInContext(script.toString('utf8'),nativeSandbox({Pebble:host,localStorage:storage,
  navigator:{geolocation},fetch:bridge,console,Date}));
async function configure(message,allowError=false) {
  let reply;
  await host.config(message,value => {reply=value;});
  assert.ok(reply,'Config must respond');
  if (!allowError) assert.equal(reply.error,undefined,reply.error);
  return reply;
}
async function read() {
  let envelope,error;
  await host.source({category:'weather',item:'location'},
    {data:value => {envelope=value;},error:(code,message) => {error={code,message};}});
  assert.equal(error,undefined,error && error.message);
  assert.ok(envelope && envelope.instances && envelope.instances.length === 1,'Live public weather must return the saved Czech location');
  return envelope.instances[0].properties;
}
function validate(p) {
  assert.equal(p.app_forecast_updated_at,undefined,'App daily forecasts must be absent');
  assert.equal(p.app_data_fetched_at,undefined,'App data provenance must be absent');
  assert.ok(!p.daily_source || p.daily_source.series.longText.values.every(source => !source.includes('app forecast')));
  assert.ok(p.temperature && Number.isFinite(p.temperature.numericValue.value));
  assert.equal(typeof p.is_forecast.boolean.value,'boolean');
  if (p.is_forecast.boolean.value) {
    assert.match(p.source.longText.text,/forecast/i,'A fallback must identify itself as forecast');
    assert.match(p.temperature.shortText.text,/^~/,'Direct forecast readings must retain the estimate marker');
  } else {
    assert.equal(p.source.longText.text,'ČHMÚ station measurement');
    assert.ok(p.station && p.observed_at,'A measurement must retain station and observation provenance');
    const age = Date.now()/1000-p.observed_at.timestamp.value;
    assert.ok(age >= -600 && age <= 3600,'An observation must be recent at its measurement time');
  }
  if (p.uv_source) assert.equal(p.uv_source.longText.text,'Open-Meteo (forecast daily peak)');
}
async function main() {
  const state = await configure({type:'getState'});
  assert.equal(state.buildVariant,'public');
  assert.equal(state.capabilities.appService,false);
  assert.equal(state.settings.appData,false,'Old enabled settings must be clamped');
  assert.equal(state.settings.uvSource,'open-meteo');
  for (const message of [{type:'setAppData',enabled:true},{type:'setUVSource',source:'chmu'}]) {
    assert.ok((await configure(message,true)).error,'Public config must reject app-service activation');
  }
  const first = await read();
  validate(first);
  const measured = !first.is_forecast.boolean.value;
  await configure({type:'setCompleteWeather',enabled:false});
  await configure({type:'setUVSource',source:'off'});
  const supplementCalls = requests.filter(request => request.host === 'api.open-meteo.com').length;
  const publicOnly = await read();
  validate(publicOnly);
  assert.equal(publicOnly.uv_index,undefined,'UV Off must exclude cached UV');
  assert.equal(publicOnly.precipitation,undefined,'Disabled completion must exclude cached probabilities');
  assert.equal(requests.filter(request => request.host === 'api.open-meteo.com').length,supplementCalls);
  assert.equal(safetyFailures,0);
  assert.ok(!values.has('chmu.app.auth.v1') && !values.has('chmu.app.install.v1'));
  console.log(JSON.stringify({result:'passed',variant:'public',pbwSha256:process.env.CHMU_SMOKE_PBW_SHA256,
    bundleSha256:digest,liveObservationVerified:measured,reading:first.temperature.shortText.text,
    source:first.source.longText.text,liveLimitations:measured?[]:['Station measurement unavailable in this live run; public fallback provenance verified'],
    appBackendRequests:0,requestSafetyFailures:safetyFailures,requests}));
}
main().catch(error => {
  console.error('Public live smoke failed: '+(error && error.message || 'weather verification failed'));
  console.error(JSON.stringify({variant:'public',requestSafetyFailures:safetyFailures,requests}));
  process.exitCode=1;
}).finally(() => {for (const child of children) child.kill();});
