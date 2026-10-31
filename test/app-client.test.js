'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createClient} = require('../src/lib/app-client');

const NOW = Date.parse('2026-10-31T08:00:00Z');
const POINT = {id:'75', latitude:48.975, longitude:14.476};
const UUID = '12345678-1234-4123-8123-123456789abc';
const AUTH = 'chmu.app.auth.v1';
const INSTALL = 'chmu.app.install.v1';
const CACHE = 'chmu.app.cache.v1.';
const copy = value => JSON.parse(JSON.stringify(value));
const tokens = number => ({access_token:'access-' + number, refresh_token:'refresh-' + number});
const response = (body, status=200) => ({ok:status>=200 && status<300, status, json:async()=>copy(body)});
const jwt = exp => 'header.' + Buffer.from(JSON.stringify({exp})).toString('base64url') + '.signature';
const deferred = () => { let resolve; const promise=new Promise(r=>{ resolve=r; }); return {promise,resolve}; };
async function flush() { for (let i=0;i<80;i++) await Promise.resolve(); }

function fixture(overrides={}) {
  let now=NOW;
  let sequence=0;
  let version=0;
  let network=true;
  const values=new Map(overrides.values || []);
  const timers=new Map();
  const calls=[];
  const f={values, timers, calls,
    setNow(value) { now=value; },
    setNetwork(value) { network=value; },
    async tick(ms) {
      await flush();
      const end=now+ms;
      for (;;) {
        const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!next) break;
        now=next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now=end;
      await flush();
    }
  };
  const options={
    storage:{getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)},
    now:()=>now,
    later:(fn,delay)=>{ const id=++sequence; timers.set(id,{fn,at:now+delay}); return id; },
    cancelLater:id=>timers.delete(id),
    randomUUID:()=>UUID,
    fetch:async(url,init)=>{
      const call={url,init, path:new URL(url).pathname.slice('/api/'.length),
        body:init.body ? JSON.parse(init.body) : undefined};
      calls.push(call);
      if (overrides.http) {
        const handled=overrides.http(call,f);
        if (handled !== undefined) return handled;
      }
      if (!network) throw new Error('private fetch detail access-secret refresh-secret');
      if (call.path==='v1/jwt/login' || call.path==='v1/jwt/refresh') return response(tokens(++version));
      if (call.path==='v1/jwt/verify_refresh_token') return response({valid:true});
      if (call.path==='v1/uv_measures') return response([{date_at:'2026-10-31', value:1.4, updated_at:'2026-10-31T07:00:00Z'}]);
      if (call.path==='v2/places/nearest') return response({id:75, lat:POINT.latitude, lng:POINT.longitude, forecast_weather_cumulative:[]});
      throw new Error('Unexpected test route');
    },
    ...overrides.options
  };
  f.delay=(value,ms)=>new Promise(resolve=>options.later(()=>resolve(value),ms));
  f.restart=()=>{ f.client=createClient(options); };
  f.restart();
  return f;
}

test('Construction makes no requests; first call registers an owned persisted UUID and no precise/device fields', async()=>{
  const f=fixture();
  assert.equal(f.calls.length,0);
  assert.equal(f.values.size,0);
  const uv=await f.client.uv(POINT);
  assert.equal(uv.fetchedAt,NOW/1000);
  assert.equal(uv.value[0].value,1.4);
  const login=f.calls[0];
  assert.equal(login.url,'https://chmu.rails.cz/api/v1/jwt/login');
  assert.equal(login.init.method,'POST');
  assert.deepEqual(login.body,{device:{device_token:UUID,platform:'android'}});
  assert.deepEqual(login.init.headers,{Accept:'application/json','Content-Type':'application/json'});
  assert.equal(JSON.parse(f.values.get(INSTALL)),UUID);
  assert.deepEqual(JSON.parse(f.values.get(AUTH)),tokens(1));
  assert.equal(f.calls[1].init.headers.Authorization,'Bearer access-1');
  assert.equal(f.timers.size,0);
});

test('UV query uses public town coordinates and seven Prague calendar dates, including a DST boundary', async()=>{
  const f=fixture();
  f.setNow(Date.parse('2026-10-24T22:30:00Z')); // Already October 25 in Prague, still UTC October 24.
  await f.client.uv(POINT);
  const url=new URL(f.calls[1].url);
  assert.equal(url.searchParams.get('date_from'),'2026-10-25');
  assert.equal(url.searchParams.get('date_to'),'2026-10-31');
  assert.equal(url.searchParams.get('lat'),'48.975');
  assert.equal(url.searchParams.get('lng'),'14.476');
  assert.equal(url.searchParams.size,4);
});

test('Place and UV calls coalesce authentication and each identical resource while preserving raw responses', async()=>{
  const f=fixture();
  const [uv,again,place,placeAgain]=await Promise.all([
    f.client.uv(POINT),f.client.uv(POINT),f.client.place(POINT),f.client.place(POINT)
  ]);
  assert.deepEqual(uv,again);
  assert.deepEqual(place,placeAgain);
  assert.equal(place.value.id,75);
  assert.deepEqual(f.calls.map(c=>c.path).sort(),['v1/jwt/login','v1/uv_measures','v2/places/nearest']);
  const url=new URL(f.calls.find(c=>c.path==='v2/places/nearest').url);
  assert.equal(url.searchParams.get('with_detail[]'),'forecast_cumulative');
  assert.equal(url.searchParams.get('lat'),String(POINT.latitude));
  assert.equal(f.timers.size,0);
});

test('Restart reuses stored tokens, identifier and weather cache without a new registration', async()=>{
  const f=fixture();
  const original=await f.client.uv(POINT);
  f.restart();
  assert.deepEqual(await f.client.uv(POINT),original);
  await f.client.place(POINT);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/login').length,1);
  assert.equal(f.calls.length,3);
  assert.equal(f.calls[2].init.headers.Authorization,'Bearer access-1');
});

test('Expired JWT is verified and refreshed proactively, with exact refresh-token request bodies', async()=>{
  const old={access_token:jwt(NOW/1000-1),refresh_token:'old-refresh'};
  const f=fixture({values:[[AUTH,JSON.stringify(old)]]});
  await f.client.uv(POINT);
  assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/verify_refresh_token','v1/jwt/refresh','v1/uv_measures']);
  for (const call of f.calls.slice(0,2)) {
    assert.deepEqual(call.body,{refresh_token:'old-refresh'});
    assert.equal(call.init.headers.Authorization,undefined);
  }
  assert.equal(f.calls[2].init.headers.Authorization,'Bearer access-1');
  assert.equal(f.values.has(INSTALL),false,'refresh needs no new install registration');
});

test('Overlapping unauthorized UV and place requests share one verify/refresh and each retry once', async()=>{
  const f=fixture({values:[[AUTH,JSON.stringify(tokens('old'))]],http:call=>{
    if (call.init.headers.Authorization==='Bearer access-old') return response({},401);
  }});
  await Promise.all([f.client.uv(POINT),f.client.place(POINT)]);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/verify_refresh_token').length,1);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/refresh').length,1);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/login').length,0);
  assert.equal(f.calls.filter(c=>c.path==='v1/uv_measures').length,2);
  assert.equal(f.calls.filter(c=>c.path==='v2/places/nearest').length,2);
});

test('Invalid refresh token registers with the same owned UUID, without an authentication loop', async()=>{
  const f=fixture({values:[[AUTH,JSON.stringify(tokens('old'))],[INSTALL,JSON.stringify(UUID)]],http:call=>{
    if (call.init.headers.Authorization==='Bearer access-old') return response({},401);
    if (call.path==='v1/jwt/verify_refresh_token') return response({valid:false});
  }});
  await f.client.uv(POINT);
  assert.deepEqual(f.calls.map(c=>c.path),['v1/uv_measures','v1/jwt/verify_refresh_token','v1/jwt/login','v1/uv_measures']);
  assert.deepEqual(f.calls[2].body,{device:{device_token:UUID,platform:'android'}});
});

test('Refresh HTTP 401 falls back to login once; retry HTTP 401 is final and sanitized', async()=>{
  const f=fixture({values:[[AUTH,JSON.stringify(tokens('old'))]],http:call=>{
    if (call.path==='v1/uv_measures' || call.path==='v1/jwt/refresh') return response({private:'never forward'},401);
  }});
  await assert.rejects(f.client.uv(POINT),error=>{
    assert.deepEqual(error,{code:'PLUGIN_UNAVAILABLE',message:'ČHMÚ app weather unavailable'});
    return true;
  });
  assert.equal(f.calls.filter(c=>c.path==='v1/uv_measures').length,2);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/login').length,1);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/refresh').length,1);
  assert.equal(f.timers.size,0);
});

test('Malformed stored credentials are ignored; malformed returned tokens are never persisted or used', async()=>{
  for (const invalid of [null,{},tokens('bad\r\nAuthorization:secret'),{access_token:'valid',refresh_token:null}]) {
    const f=fixture({values:[[AUTH,JSON.stringify({access_token:12,refresh_token:'old'})]],http:call=>{
      if (call.path==='v1/jwt/login') return response(invalid);
    }});
    await assert.rejects(f.client.uv(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
    assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/login']);
    assert.equal(JSON.parse(f.values.get(AUTH)).access_token,12);
  }
});

test('Malformed verification response does not silently register again or leak token data', async()=>{
  const f=fixture({values:[[AUTH,JSON.stringify({access_token:jwt(NOW/1000-1),refresh_token:'secret-refresh'})]],http:call=>{
    if (call.path==='v1/jwt/verify_refresh_token') return response({valid:'true',detail:'secret-refresh'});
  }});
  await assert.rejects(f.client.uv(POINT),error=>{
    assert.equal(JSON.stringify(error).includes('secret'),false);
    return error.code==='PLUGIN_UNAVAILABLE';
  });
  assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/verify_refresh_token']);
});

test('Cache reuses for 30 minutes, force bypasses TTL, and network failure never renews retrieval age', async()=>{
  const f=fixture();
  const original=await f.client.uv(POINT);
  f.setNow(NOW+29*60000);
  assert.deepEqual(await f.client.uv(POINT),original);
  assert.equal(f.calls.length,2);
  const forced=await f.client.uv(POINT,true);
  assert.equal(forced.fetchedAt,(NOW+29*60000)/1000);
  assert.equal(f.calls.length,3);
  f.setNow(NOW+60*60000);
  f.setNetwork(false);
  assert.deepEqual(await f.client.uv(POINT),forced);
  assert.equal(f.calls.length,4);
  const records=[...f.values].filter(([key])=>key.startsWith(CACHE) && key!==CACHE+'index');
  assert.equal(JSON.parse(records[0][1]).fetchedAt,NOW+29*60000);
});

test('A weather cache is rejected exactly at six hours and after a clock rollback', async()=>{
  for (const age of [6*3600000,-1]) {
    const f=fixture();
    await f.client.uv(POINT);
    f.setNow(NOW+age);
    f.setNetwork(false);
    await assert.rejects(f.client.uv(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
  }
});

test('Cache is bounded to 16 resources across place and UV without deleting credentials or identity', async()=>{
  const f=fixture();
  for (let i=0;i<17;i++) await f.client[i%2?'place':'uv']({...POINT,latitude:POINT.latitude+i/1000});
  const keys=[...f.values.keys()].filter(key=>key.startsWith(CACHE) && key!==CACHE+'index');
  assert.equal(keys.length,16);
  assert.equal(JSON.parse(f.values.get(CACHE+'index')).length,16);
  assert.equal(f.values.has(AUTH),true);
  assert.equal(f.values.has(INSTALL),true);
  assert.equal(keys.some(key=>key.includes('48.975,')),false,'first resource is evicted');
});

test('Validation rejects malformed fresh data before replacing a good cache and rechecks source expiry', async()=>{
  let valid=true;
  const f=fixture({options:{validateUV:(body,now,point)=>{
    assert.deepEqual(point,POINT);
    return valid && now<NOW+2*3600000 && body[0].value===1.4;
  }},http:call=>{
    if (call.path==='v1/uv_measures' && !valid) return response([{value:'malformed'}]);
  }});
  const original=await f.client.uv(POINT);
  f.setNow(NOW+31*60000);
  // The new response fails schema validation, while the previously cached one still passes.
  valid=false;
  const f2=fixture({values:[...f.values],options:{validateUV:body=>body[0].value===1.4},http:call=>{
    if (call.path==='v1/uv_measures') return response([{value:'malformed'}]);
  }});
  f2.setNow(NOW+31*60000);
  assert.deepEqual(await f2.client.uv(POINT),original);
  assert.ok([...f2.values].filter(([key])=>key.startsWith(CACHE) && key!==CACHE+'index')
    .every(([,raw])=>JSON.parse(raw).body[0].value===1.4));
  // Even a recently fetched record can become invalid according to source time.
  valid=true;
  f.setNow(NOW+2*3600000);
  f.setNetwork(false);
  await assert.rejects(f.client.uv(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
});

test('Place validator receives current time and rejects invalid payloads without creating a cache', async()=>{
  const f=fixture({options:{validatePlace:(body,now,point)=>{
    assert.equal(now,NOW);
    assert.deepEqual(point,POINT);
    return body.id===999;
  }}});
  await assert.rejects(f.client.place(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
});

test('A shorter coalesced caller deadline does not cancel or poison another caller', async()=>{
  const held=deferred();
  const f=fixture({http:call=>call.path==='v1/uv_measures' ? held.promise : undefined});
  const long=f.client.uv(POINT,false,{endsAt:NOW+10000});
  const short=f.client.uv(POINT,false,{endsAt:NOW+100});
  const shortCheck=assert.rejects(short,error=>error.code==='TIMEOUT');
  await f.tick(100);
  await shortCheck;
  held.resolve(response([{value:2}]));
  assert.equal((await long).value[0].value,2);
  assert.equal(f.calls.filter(c=>c.path==='v1/uv_measures').length,1);
  assert.equal(f.timers.size,0);
});

test('Shared budget bounds a slow login and ignores its late tokens and weather cache', async()=>{
  const held=deferred();
  const f=fixture({http:call=>call.path==='v1/jwt/login' ? held.promise : undefined});
  const result=f.client.uv(POINT,false,{endsAt:NOW+1000});
  const rejected=assert.rejects(result,error=>error.code==='TIMEOUT');
  await f.tick(1000);
  await rejected;
  held.resolve(response(tokens('late')));
  await flush();
  assert.equal(f.values.has(AUTH),false);
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
  assert.equal(f.calls.length,1);
  assert.equal(f.timers.size,0);
});

test('Each endpoint has a six-second timeout even under a longer budget; late JSON cannot update cache', async()=>{
  const held=deferred();
  const f=fixture({http:call=>call.path==='v1/uv_measures' ? held.promise : undefined});
  const result=f.client.uv(POINT,false,{endsAt:NOW+17000});
  const rejected=assert.rejects(result,error=>error.code==='TIMEOUT');
  await f.tick(6000);
  await rejected;
  held.resolve(response([{value:2}]));
  await flush();
  assert.equal(f.values.has(AUTH),true,'a completed login remains usable independently of weather timeout');
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
  assert.equal(f.timers.size,0);
});

test('Exhausted budgets and malformed coordinates never start HTTP', async()=>{
  const f=fixture();
  await assert.rejects(f.client.uv(POINT,false,{endsAt:NOW}),error=>error.code==='TIMEOUT');
  for (const point of [null,{latitude:NaN,longitude:14},{latitude:91,longitude:14},{latitude:48,longitude:'14'}]) {
    await assert.rejects(f.client.place(point),error=>error.code==='PLUGIN_UNAVAILABLE');
  }
  assert.equal(f.calls.length,0);
  assert.equal(f.timers.size,0);
});

test('Fetch exception details never escape the public module error', async()=>{
  const f=fixture();
  f.setNetwork(false);
  await assert.rejects(f.client.uv(POINT),error=>{
    assert.deepEqual(error,{code:'PLUGIN_UNAVAILABLE',message:'ČHMÚ app weather unavailable'});
    return true;
  });
});

test('Secure storage reads coalesce asynchronously and credentials never enter ordinary storage', async()=>{
  const vault=new Map();
  let reads=0;
  let writes=0;
  const f=fixture({options:{secureStorage:{
    async getItem(key) { reads++; await flush(); return vault.get(key)||null; },
    async setItem(key,value) { writes++; await flush(); vault.set(key,value); }
  }}});
  await Promise.all([f.client.uv(POINT),f.client.place(POINT)]);
  assert.equal(reads,1);
  assert.equal(writes,1);
  assert.deepEqual(JSON.parse(vault.get(AUTH)),tokens(1));
  assert.equal(f.values.has(AUTH),false);
  assert.equal(f.values.has(INSTALL),true);
  f.restart();
  await f.client.uv({...POINT,latitude:48.98});
  assert.equal(reads,2);
  assert.equal(writes,1);
  assert.equal(f.calls.filter(c=>c.path==='v1/jwt/login').length,1);
});

test('Secure storage read/write failures never downgrade tokens into plain storage', async()=>{
  for (const failAt of ['read','write']) {
    const f=fixture({options:{secureStorage:{
      async getItem() { if (failAt==='read') throw new Error('sensitive native detail'); return null; },
      async setItem() { throw new Error('sensitive native detail'); }
    }}});
    await assert.rejects(f.client.uv(POINT),error=>{
      assert.deepEqual(error,{code:'PLUGIN_UNAVAILABLE',message:'ČHMÚ app weather unavailable'});
      return true;
    });
    assert.equal(f.values.has(AUTH),false);
    assert.equal(f.calls.filter(c=>c.path==='v1/uv_measures').length,0);
    assert.equal(f.calls.length,failAt==='read' ? 0 : 1);
  }
});

test('Cached future UV rows survive local midnight offline, preserving original retrieval time', async()=>{
  let online=true;
  const before=Date.parse('2026-10-31T22:50:00Z'); // Prague 23:50.
  const f=fixture({options:{validateUV:(body,now)=>{
    const date=new Date(now+3600000).toISOString().slice(0,10);
    return body.some(row=>row.date_at===date);
  }},http:call=>{
    if (call.path==='v1/uv_measures') {
      if (!online) throw new Error('offline');
      return response([{date_at:'2026-10-31',value:1},{date_at:'2026-11-01',value:2}]);
    }
  }});
  f.setNow(before);
  const previous=await f.client.uv(POINT);
  online=false;
  f.setNow(before+40*60000);
  const cached=await f.client.uv(POINT);
  assert.deepEqual(cached,previous);
  assert.equal(cached.fetchedAt,before/1000);
  const query=new URL(f.calls[f.calls.length-1].url).searchParams;
  assert.equal(query.get('date_from'),'2026-11-01');
  assert.equal([...f.values.keys()].filter(key=>key.startsWith(CACHE) && key!==CACHE+'index').length,1);
});

test('Same-turn force refresh issues HTTP even when another call is returning a fresh cache', async()=>{
  const f=fixture();
  await f.client.place(POINT);
  f.setNow(NOW+1000);
  const [cached,forced]=await Promise.all([f.client.place(POINT),f.client.place(POINT,true)]);
  assert.equal(cached.fetchedAt,NOW/1000);
  assert.equal(forced.fetchedAt,NOW/1000+1);
  assert.equal(f.calls.filter(c=>c.path==='v2/places/nearest').length,2);
});

test('Shared seventeen-second budget bounds a verify/refresh/login/weather sequence', async()=>{
  const old={access_token:jwt(NOW/1000-1),refresh_token:'old-refresh'};
  const f=fixture({values:[[AUTH,JSON.stringify(old)]],http:(call,state)=>{
    if (call.path==='v1/jwt/verify_refresh_token') return state.delay(response({valid:true}),5000);
    if (call.path==='v1/jwt/refresh') return state.delay(response({},401),5000);
    if (call.path==='v1/jwt/login') return state.delay(response(tokens('new')),5000);
    if (call.path==='v1/uv_measures') return state.delay(response([{value:2}]),5000);
  }});
  const pending=f.client.uv(POINT,false,{endsAt:NOW+17000});
  const checked=assert.rejects(pending,error=>error.code==='TIMEOUT');
  await f.tick(17000);
  await checked;
  assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/verify_refresh_token','v1/jwt/refresh','v1/jwt/login','v1/uv_measures']);
  assert.equal(f.values.has(AUTH),true,'a completed token refresh is independent of the weather result');
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
  await f.tick(3000);
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false,'late weather JSON is discarded');
  assert.equal(f.timers.size,0);
});

test('Disabling app data during login prevents the follow-up weather request', async()=>{
  let enabled=true;
  const held=deferred();
  const f=fixture({options:{isEnabled:()=>enabled},http:call=>call.path==='v1/jwt/login' ? held.promise : undefined});
  const pending=f.client.uv(POINT);
  const rejected=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
  await flush();
  enabled=false;
  held.resolve(response(tokens('new')));
  await rejected;
  assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/login']);
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
  await assert.rejects(f.client.place(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
  assert.equal(f.calls.length,1);
});

test('Disabling while weather is in flight discards its data and prevents cache writes', async()=>{
  let enabled=true;
  const held=deferred();
  const f=fixture({options:{isEnabled:()=>enabled},http:call=>call.path==='v1/uv_measures' ? held.promise : undefined});
  const pending=f.client.uv(POINT);
  const rejected=assert.rejects(pending,error=>error.code==='PLUGIN_UNAVAILABLE');
  await flush();
  enabled=false;
  held.resolve(response([{value:2}]));
  await rejected;
  assert.equal([...f.values.keys()].some(key=>key.startsWith(CACHE)),false);
  assert.equal(f.timers.size,0);
});

test('Invalid refresh followed by refused registration never repeats the registration POST', async()=>{
  const f=fixture({values:[[AUTH,JSON.stringify({access_token:jwt(NOW/1000-1),refresh_token:'old'})]],http:call=>{
    if (call.path==='v1/jwt/verify_refresh_token') return response({valid:false});
    if (call.path==='v1/jwt/login') return response({},401);
  }});
  await assert.rejects(f.client.uv(POINT),error=>error.code==='PLUGIN_UNAVAILABLE');
  assert.deepEqual(f.calls.map(c=>c.path),['v1/jwt/verify_refresh_token','v1/jwt/login']);
});
