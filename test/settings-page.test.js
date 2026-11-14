'use strict';

// Pure Node DOM checks of the production page's real inline script.
// A test-only Pebble bridge supplies deferred replies; no provider/network runs.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(path.join(__dirname,'../src/config.html'),'utf8')
  .replace('__CHMU_BUILD_VARIANT__','public');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const observedAt = Math.floor(Date.now()/1000)-300;
  return {
    version:'1.0.3',buildVariant:'public',capabilities:{appService:false},
    settings:{stations:{praha:'station-a'},completeWeather:true,appData:false,uvSource:'open-meteo',revision:0},
    locations:[{
      id:'praha',name:'Praha',temperature:'5°C',isForecast:false,
      station:'Praha-Libuš',observedAt,measurementAgeSec:300,
      humidity:'68%',wind:'12 km/h',feelsLike:'2°C',
      eligibleStations:[
        {id:'station-a',name:'Praha-Libuš',distanceKm:3,elevation:300},
        {id:'station-b',name:'Praha-Klementinum',distanceKm:5,elevation:200}
      ]
    }]
  };
}

async function page(t,language='en-GB',initial=fixture()) {
  const dom = new JSDOM(html,{runScripts:'outside-only',url:'https://settings-preview.invalid/'});
  t.after(()=>dom.window.close());
  const window=dom.window, pending=[], sent=[];
  Object.defineProperty(window.navigator,'language',{value:language,configurable:true});
  window.fetch=()=>{throw Error('Network is forbidden in settings DOM tests');};
  let ready;
  window.Pebble={
    addEventListener(name,callback){assert.equal(name,'ready');ready=callback;},
    sendMessage(channel,message){
      assert.equal(channel,'plugin');sent.push(copy(message));
      return new Promise((resolve,reject)=>pending.push({message:copy(message),resolve,reject}));
    },
    openUrl(){throw Error('External navigation is forbidden in settings DOM tests');}
  };
  window.eval(script);
  assert.equal(typeof ready,'function');
  ready({target:'plugin'});
  await tick();
  assert.equal(pending.length,1);assert.equal(pending[0].message.type,'getState');
  pending.shift().resolve(copy(initial));await tick();await tick();
  return {window,document:window.document,pending,sent,initial:copy(initial)};
}

for (const [language,refreshLabel,loadingLabel,savedCue] of [
  ['en-GB','Refresh data','Refreshing…',/saved|refresh/i],
  ['cs-CZ','Obnovit data','Obnovování…',/uložen|obnov/i]
]) {
  test(language+': a saved station with no diagnostics retains honest context and a keyboard route to Refresh',async t=>{
    const p=await page(t,language),d=p.document;
    const select=d.querySelector('[data-location-id="praha"]');
    assert.ok(select);select.focus();select.value='station-b';
    select.dispatchEvent(new p.window.Event('change',{bubbles:true}));await tick();
    assert.equal(p.pending.length,1);assert.equal(p.pending[0].message.type,'setStation');
    assert.equal(p.pending[0].message.stationId,'station-b');
    assert.equal(d.getElementById('refresh').textContent,refreshLabel,'Saving must not claim weather is refreshing');
    assert.equal(d.getElementById('refresh').disabled,true);

    const saved=copy(p.initial);saved.settings.stations.praha='station-b';saved.settings.revision++;
    saved.locations=[]; // Real client invalidates the old diagnostic on station change.
    p.pending.shift().resolve(saved);await tick();await tick();
    const placeholder=d.querySelector('.location-pending');
    assert.ok(placeholder,'Saved station must not erase the location context');
    assert.match(placeholder.textContent,/Praha/);assert.match(placeholder.textContent,savedCue);
    assert.equal(placeholder.querySelectorAll('.reading,.metrics,.station-control').length,0,'Pending context must not present the old reading as new data');
    assert.doesNotMatch(placeholder.textContent,/5°C|68%|12 km\/h|Praha-Libuš/);
    assert.equal(d.activeElement,d.getElementById('refresh'),'Focus falls back to the available next action');
    assert.equal(d.getElementById('refresh').disabled,false);

    d.getElementById('refresh').click();await tick();
    assert.equal(p.pending[0].message.type,'refresh');
    assert.equal(d.getElementById('refresh').textContent,loadingLabel,'Only a real refresh uses its progress label');
    const refreshed=copy(p.initial);refreshed.settings=saved.settings;
    refreshed.locations[0].station='Praha-Klementinum';refreshed.locations[0].temperature='8°C';
    p.pending.shift().resolve(refreshed);await tick();await tick();
    assert.equal(d.querySelector('.location-pending'),null);
    assert.equal(d.querySelector('.reading').textContent,'8°C');
    assert.equal(d.querySelector('[data-location-id="praha"]').value,'station-b');
    assert.equal(d.activeElement,d.getElementById('refresh'));
  });
}

test('a rejected station save restores confirmed settings and the station selector focus',async t=>{
  const p=await page(t),d=p.document;
  const select=d.querySelector('[data-location-id="praha"]');select.focus();select.value='station-b';
  select.dispatchEvent(new p.window.Event('change',{bubbles:true}));await tick();
  p.pending.shift().reject(new Error('Storage is full'));await tick();await tick();
  const restored=d.querySelector('[data-location-id="praha"]');
  assert.equal(restored.value,'station-a');
  assert.equal(d.activeElement,restored);
  assert.equal(d.querySelector('.location-pending'),null);
  assert.equal(d.querySelector('.reading').textContent,'5°C');
  assert.equal(d.getElementById('status').getAttribute('role'),'alert');
  assert.match(d.getElementById('status').textContent,/Storage is full/);
  assert.equal(d.getElementById('refresh').textContent,'Refresh data');
  assert.equal(p.sent.filter(message=>message.type==='refresh').length,0,'A failed save must not silently refresh');
});

for (const language of ['en-GB','cs-CZ']) {
  test(language+': UV dependency is described and warned without changing the saved preference',async t=>{
    const state=fixture();state.settings.completeWeather=false;state.settings.uvSource='open-meteo';
    const p=await page(t,language,state),d=p.document,uv=d.getElementById('uv-source');
    assert.equal(uv.value,'open-meteo');
    assert.ok(uv.getAttribute('aria-describedby').split(/\s+/).includes('uv-hint'));
    assert.ok(d.getElementById('uv-hint').classList.contains('note-warning'));
    assert.match(d.getElementById('uv-hint').textContent,language==='en-GB'?/Enable|completion/i:/zapn|dopln/i);
    assert.equal(d.getElementById('complete').checked,false);
    assert.deepEqual(p.sent.map(message=>message.type),['getState'],'Displaying the dependency must not change settings');
  });
}
