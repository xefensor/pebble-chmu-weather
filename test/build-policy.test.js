'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const station = require('../tests/fixtures/station-C2CBUD01.json');
const forecast = require('../tests/fixtures/forecast-75.json');
const supplement = require('../tests/fixtures/supplement.json');
const appPlace = require('../tests/fixtures/app-place.json');
const appUV = require('../tests/fixtures/app-uv.json');

const NOW = Date.parse('2026-10-31T08:00:00Z');
const copy = value => JSON.parse(JSON.stringify(value));
const bundles = Object.fromEntries(['public','personal'].map(variant => [variant,
  process.env['CHMU_' + variant.toUpperCase() + '_SCRIPT']
  ? fs.readFileSync(process.env['CHMU_' + variant.toUpperCase() + '_SCRIPT'], 'utf8')
  : esbuild.buildSync({absWorkingDir:path.resolve(__dirname,'..'), entryPoints:['src/plugin/index.js'],
    bundle:true, format:'iife', platform:'neutral', mainFields:['main','module'], target:'es2020', write:false,
    define:{__CHMU_PUBLIC_BUILD__:String(variant==='public'), __CHMU_VERSION__:JSON.stringify('policy-test')}
  }).outputFiles[0].text]));

function host(variant, savedValues=new Map()) {
  const values = new Map(savedValues);
  const urls = [];
  let source, config, secureReads=0;
  const storage = {getItem:key=>values.get(key)??null,
    setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
  const secure = new Map();
  const Pebble = {
    registerSourceHandler:handler=>{source=handler;}, registerConfigHandler:handler=>{config=handler;},
    subscribeSource:()=>{}, refreshSources:()=>{},
    readSource:async request=>request.item==='units' ? {instances:[]} : {instances:[{
      instanceId:'saved-cb', properties:{name:{shortText:{text:'České Budějovice'}},
        current:{boolean:{value:false}},latitude:{numericValue:{value:48.98}},longitude:{numericValue:{value:14.48}}}
    }]}
  };
  Object.defineProperty(Pebble,'secureStorage',{get:()=>{
    secureReads++;
    if(variant==='public') throw Error('Public build must not access app credentials');
    return {getItem:async key=>secure.get(key)??null, setItem:async(key,value)=>secure.set(key,value)};
  }});
  class Clock extends Date {
    constructor(...args) { super(...(args.length?args:[NOW])); }
    static now() { return NOW; }
  }
  const response = body=>({ok:true,status:200,headers:{get:()=>null},json:async()=>copy(body)});
  const context=vm.createContext({Pebble,localStorage:storage,Date:Clock,navigator:{geolocation:{}},
    fetch:async(url,init)=>{
      urls.push(url);
      if(url.includes('chmu.rails.cz/')) {
        assert.equal(variant,'personal','Public build must never contact the app backend');
        if(url.endsWith('/jwt/login')) return response({access_token:'test-access',refresh_token:'test-refresh'});
        assert.equal(init.headers.Authorization,'Bearer test-access');
        return response(url.includes('/uv_measures?')?appUV:appPlace);
      }
      if(url.includes('api.open-meteo.com/')) return response(supplement);
      if(url.includes('/graf.meteogram/')) return response(forecast);
      if(url.includes('/graf.meteo-stanice.klima-10m/')) return response(station);
      throw Error('Unexpected request '+url);
    }});
  vm.runInContext(`for (const name of ['setTimeout','clearTimeout','setInterval','clearInterval']) {
    Object.defineProperty(globalThis,name,{get:()=>{throw Error('Forbidden native timer '+name);}});
  }`,context);
  vm.runInContext(bundles[variant],context,{timeout:1000});
  return {values,urls,secureReads:()=>secureReads,
    async configure(message={type:'getState'}) {
      let result;
      await config(message,value=>{result=copy(value);});
      assert.ok(result,'Config handler must respond');
      return result;
    },
    async read() {
      let result,error;
      await source({category:'weather',item:'location'},{data:value=>{result=copy(value);},error:(code,message)=>{error={code,message};}});
      assert.equal(error,undefined,JSON.stringify(error));
      assert.equal(result.instances.length,1);
      return result.instances[0].properties;
    }};
}

test('Public bundle omits authenticated app implementation and exposes the public policy',async()=>{
  assert.doesNotMatch(bundles.public,/chmu\.rails\.cz|chmu\.app\.auth\.v1|v1\/jwt\/login/);
  const runtime=host('public');
  const state=await runtime.configure();
  assert.equal(state.version,process.env.CHMU_PUBLIC_SCRIPT ? require('../package.json').version : 'policy-test');
  assert.equal(state.buildVariant,'public');
  assert.equal(state.capabilities.appService,false);
  assert.equal(state.settings.appData,false);
  assert.equal(state.settings.uvSource,'open-meteo');
  const properties=await runtime.read();
  assert.equal(runtime.secureReads(),0);
  assert.equal(runtime.urls.some(url=>url.includes('chmu.rails.cz')),false);
  assert.match(properties.uv_source.longText.text,/Open-Meteo/);
  assert.equal(properties.app_forecast_updated_at,undefined);
  assert.equal(properties.app_data_fetched_at,undefined);
});

test('Public upgrades clamp saved app preferences without enabling another disabled service',async()=>{
  for(const complete of [true,false]) for(const uv of ['chmu',undefined]) {
    const runtime=host('public',new Map([['chmu.settings.v1',JSON.stringify({
      appData:true,completeWeather:complete,uvSource:uv,revision:3
    })]]));
    const state=await runtime.configure();
    assert.equal(state.settings.appData,false);
    assert.equal(state.settings.completeWeather,complete);
    assert.equal(state.settings.uvSource,complete?'open-meteo':'off');
    const properties=await runtime.read();
    assert.equal(runtime.urls.some(url=>url.includes('chmu.rails.cz')),false);
    assert.equal(runtime.urls.some(url=>url.includes('open-meteo')),complete);
    if(!complete) assert.equal(properties.uv_index,undefined);
  }
});

test('Public configuration cannot re-enable authenticated app channels',async()=>{
  const runtime=host('public');
  for(const message of [{type:'setAppData',enabled:true},{type:'setUVSource',source:'chmu'}]) {
    const result=await runtime.configure(message);
    assert.match(result.error,/unavailable in the public build/);
  }
  const state=await runtime.configure();
  assert.equal(state.settings.appData,false);
  assert.equal(state.settings.uvSource,'open-meteo');
  assert.equal(runtime.values.has('chmu.settings.v1'),false,'Rejected changes must not persist settings');
  assert.equal(runtime.urls.length,0);
  assert.equal((await runtime.configure({type:'setUVSource',source:'off'})).settings.uvSource,'off');
});

test('Personal build defaults enable both app channels and retains explicit source choices',async()=>{
  const runtime=host('personal');
  const state=await runtime.configure();
  assert.equal(state.buildVariant,'personal');
  assert.equal(state.capabilities.appService,true);
  assert.equal(state.settings.appData,true);
  assert.equal(state.settings.uvSource,'chmu');
  const properties=await runtime.read();
  assert.ok(runtime.urls.some(url=>url.includes('/uv_measures?')));
  assert.ok(runtime.urls.some(url=>url.includes('/places/nearest?')));
  assert.match(properties.uv_source.longText.text,/ČHMÚ/);
  assert.ok(properties.app_forecast_updated_at);
  assert.equal((await runtime.configure({type:'setAppData',enabled:false})).settings.appData,false);
  assert.equal((await runtime.configure({type:'setUVSource',source:'off'})).settings.uvSource,'off');
});

test('Public build ignores cached app data and diagnostics from a previous personal build',async()=>{
  const personal=host('personal');
  await personal.read();
  assert.ok([...personal.values.keys()].some(key=>key.startsWith('chmu.app.cache.v1.')));
  const runtime=host('public',personal.values);
  assert.equal((await runtime.configure()).locations.length,0,'Previous personal readings must not be displayed');
  const properties=await runtime.read();
  assert.equal(properties.app_forecast_updated_at,undefined);
  assert.equal(properties.app_data_fetched_at,undefined);
  assert.match(properties.uv_source.longText.text,/Open-Meteo/);
  assert.equal(runtime.urls.some(url=>url.includes('chmu.rails.cz')),false);
  const state=await runtime.configure();
  assert.equal(state.locations.length,1);
  assert.equal(state.locations[0].buildVariant,'public');
});

test('Public build hides untagged diagnostics from release 1.0.0',async()=>{
  const runtime=host('public',new Map([['chmu.status.v1',JSON.stringify({
    old:{id:'old',temperature:'99°C',uvSource:'ČHMÚ',settingsRevision:0}
  })]]));
  assert.equal((await runtime.configure()).locations.length,0);
});
