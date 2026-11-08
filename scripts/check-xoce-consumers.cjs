'use strict';
// Exact public provider and consumer PBWs; the phone SDK and HTTP are fixtures.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const options=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),root=path.resolve(__dirname,'..'),copy=value=>JSON.parse(JSON.stringify(value));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function unpack(file){return JSON.parse(cp.execFileSync('python3',['-c','import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps({n:z.read(n).decode() for n in ["appinfo.json","plugin.js","pebble-js-app.js"] if n in z.namelist()}))',file],{encoding:'utf8',maxBuffer:16*1024*1024}));}
const provider=unpack(options.provider),manifest=JSON.parse(provider['appinfo.json']);
assert.equal(manifest.uuid,'00866104-6ce5-4ae3-952f-9800f437442c');assert.doesNotMatch(provider['plugin.js'],/chmu\.rails\.cz|chmu\.app\.auth\.v1/);
assert.ok(manifest.plugin.sources.some(s=>s.category==='weather'&&s.items.includes('location')));
const allowed=manifest.usesPermissions.find(p=>p.name==='Internet').parameters.domains;
assert.deepEqual([...allowed].sort(),['api.open-meteo.com','data-provider.chmi.cz','opendata.chmi.cz']);
const initial=Date.parse('2026-10-31T08:00:00Z');
function providerHost(spec){
 let now=initial+(spec.forecast?2*3600000:0),gps=0;
 const values=new Map(),urls=[],sourceSubscriptions=[];let source,config;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const fixture=name=>JSON.parse(fs.readFileSync(root+'/tests/fixtures/'+name+'.json','utf8'));
 const response=body=>({ok:true,status:200,headers:{get:()=>null},json:async()=>copy(body)});
 const sdk={registerSourceHandler:fn=>source=fn,registerConfigHandler:fn=>config=fn,refreshSources(){},subscribeSource:req=>sourceSubscriptions.push(copy(req)),readSource:async req=>{
  if(req.item==='units')return {instances:[{instanceId:'units',properties:{temperature:{shortText:{text:spec.unit||'°C'}},wind_speed:{shortText:{text:spec.wind||'km/h'}}}}]};
  if(spec.locationDenied)throw {code:'PERMISSION_DENIED',message:'Fixture location permission denied'};
  return {instances:spec.missingLocation?[]:[{instanceId:'saved-cb',properties:{name:{shortText:{text:'České Budějovice'}},current:{boolean:{value:false}},latitude:{numericValue:{value:48.98}},longitude:{numericValue:{value:14.48}}}}]};
 }};
 Object.defineProperty(sdk,'secureStorage',{get(){throw Error('Public provider cannot use credentials');}});
 const sandbox=require('./native-sandbox')({Pebble:sdk,localStorage:store,Date:Clock,console:{log(){},error(){}},navigator:{geolocation:{getCurrentPosition(_ok,fail){gps++;fail({code:1,message:'No fixture GPS fix'});}}},fetch:async(url,init={})=>{
  const parsed=new URL(url);assert.ok(allowed.includes(parsed.hostname));assert.equal(init.method||'GET','GET');assert.ok(!Object.keys(init.headers||{}).some(k=>k.toLowerCase()==='authorization'));urls.push(url);
  if(url.includes('api.open-meteo.com/'))return response(fixture('supplement'));
  if(url.includes('/graf.meteogram/'))return response(fixture('forecast-75'));
  if(url.includes('/graf.meteo-stanice.klima-10m/'))return response(fixture('station-C2CBUD01'));
  if(url.includes('opendata.chmi.cz/'))return response(fixture('station-bulk-11546'));
  throw Error('Unexpected public fixture URL '+url);
 }});
 vm.runInContext(provider['plugin.js'],sandbox,{timeout:2000});
 return {urls,values,Clock,gps:()=>gps,now:()=>now,advance:ms=>now+=ms,
  configure:async message=>{let value;await config(message,result=>value=result);return value;},
  read:async request=>{let value,error;await source(request,{data:result=>value=copy(result),error:(code,message)=>error={code,message}});return {value,error};}};
}
async function faceHost(bundle,host,spec){
 const info=JSON.parse(bundle['appinfo.json']),events={},subs=[],frames=[],timers=new Map(),store=new Map();let id=0,inflight=[],lastProvider;
 const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value))};
 const short=text=>({shortText:{text}});
 const prefs={validUntilMs:host.now()+7200000,instances:[0,1,2].filter(i=>!spec.empty||i===2).map(i=>({instanceId:String(i),properties:{category:short('weather'),item:short('location'),property:short(i===0?'temperature':i===1?(spec.second||'precipitation'):'uv_index'),index:{numericValue:{value:0}}}}))};
 const sdk={getActiveWatchInfo:()=>({language:'en',platform:'emery'}),addEventListener:(name,fn)=>events[name]=fn,
 sendAppMessage(payload,ok){const bytes=payload.COMPLICATION_DATA||payload[info.messageKeys.COMPLICATION_DATA];if(bytes)frames.push(Array.from(bytes));if(ok)ok();},subscribeToSource(req){
  const entry={req,active:true};subs.push(entry);
  const job=Promise.resolve().then(async()=>{
   if(!entry.active)return;
   if(req.category==='preferences'&&req.item==='complications'){req.onData(copy(prefs));return;}
   if(req.category==='weather'&&req.item==='location'){
    if(spec.absent){req.onError({code:'PLUGIN_UNAVAILABLE'});return;}
    const result=await host.read(req);if(!entry.active)return;
    if(result.error){req.onError(result.error);return;}lastProvider=result.value;
    const envelope=copy(result.value);envelope.pluginUuid=manifest.uuid;
    // The SDK can filter the response to requested properties. Dependencies
    // such as observed_at/is_forecast must therefore be explicitly requested.
    if(Array.isArray(req.properties))for(const item of envelope.instances)item.properties=Object.fromEntries(Object.entries(item.properties).filter(([key])=>req.properties.includes(key)));
    req.onData(envelope);return;
   }
   if(req.onData)req.onData({validUntilMs:host.now()+60000,instances:[]});
  });inflight.push(job);return {unsubscribe(){entry.active=false;}};
 }};
 vm.runInNewContext(bundle['pebble-js-app.js'],{Pebble:sdk,localStorage:storage,Date:host.Clock,navigator:{language:'en'},console:{log(){},error(){}},setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:host.now()+delay});return id;},clearTimeout:key=>timers.delete(key)});
 events.ready();for(let i=0;i<12;i++){const pending=inflight;inflight=[];await Promise.all(pending);await Promise.resolve();}
 assert.ok(frames.length,'Face must send complication state');
 return {info,frames,provider:()=>lastProvider,store,subscriptions:subs,now:host.now,
  current:()=>frames.at(-1),deny(){subs.filter(s=>s.active&&s.req.category==='weather').forEach(s=>s.req.onError({code:'PERMISSION_DENIED'}));},
  replay:async()=>{for(const s of subs.filter(s=>s.active&&s.req.category==='weather')){const result=await host.read(s.req);assert.equal(result.error,undefined);s.req.onData({...result.value,pluginUuid:manifest.uuid});}await Promise.resolve();}};
}
function decode(bytes,now){
 const file=path.join(options.output,'probe.bin');fs.writeFileSync(file,Buffer.from(bytes));
 try{return JSON.parse(cp.execFileSync(options.decoder,[String(Math.floor(now/1000)),file],{encoding:'utf8'}));}finally{fs.unlinkSync(file);}
}
async function main(){
 const report={result:'PASS',coreSha256:options.coreSha256,provider:{file:options.provider,sha256:sha(fs.readFileSync(options.provider)),uuid:manifest.uuid},consumers:[],scope:'Exact packaged public provider and face PKJS. Public HTTP data, phone discovery/permissions/global Weather-provider selection and SDK delivery are fixtures. Both consumers use the same pinned native C decoder, which validates every packet. Native emulator rendering is a separate step; no physical phone claim.'};
 for(const consumer of options.consumers){
  const bundle=unpack(consumer),entry={file:consumer,sha256:sha(fs.readFileSync(consumer)),name:JSON.parse(bundle['appinfo.json']).shortName,cases:[]};
  for(const spec of [{name:'measured-celsius'},{name:'measured-fahrenheit',unit:'°F',wind:'mph'},{name:'humidity',second:'humidity'},{name:'forecast-fallback',forecast:true},{name:'denied-location',locationDenied:true},{name:'missing-location',missingLocation:true},{name:'missing-plugin',absent:true},{name:'unconfigured',empty:true}]){
   const host=providerHost(spec),state=await host.configure({type:'getState'});assert.equal(state.buildVariant,'public');assert.equal(state.capabilities.appService,false);
   const face=await faceHost(bundle,host,spec),packet=face.current(),decoded=decode(packet,host.now());assert.ok(decoded.slice(2).every(s=>s.status===0),'Only two configured slots may reach the watch');
   const result={name:spec.name,now:Math.floor(host.now()/1000),packet,slots:decoded,providerCalls:host.urls.length,gpsCalls:host.gps()};
   if(spec.empty){assert.ok(decoded.every(s=>s.status===0));assert.equal(host.urls.length,0);}
   else if(spec.locationDenied||spec.missingLocation||spec.absent){assert.ok(decoded.slice(0,2).every(s=>!s.fresh&&s.status!==2));assert.equal(host.urls.length,0);if(spec.locationDenied)assert.equal(host.gps(),0);}
   else{
    const envelope=face.provider(),properties=envelope.instances[0].properties;assert.equal(decoded[0].status,2);assert.equal(decoded[0].source,1);assert.equal(decoded[0].kind,1);assert.equal(decoded[0].value,properties.temperature.numericValue.value);assert.equal(decoded[0].unit,properties.temperature.numericValue.unit);assert.equal(decoded[0].text,properties.temperature.shortText.text);
    assert.equal(decoded[0].validUntil,Math.floor(envelope.validUntilMs/1000));assert.equal(host.gps(),0);
    const forecast=properties.is_forecast.boolean.value;assert.equal(forecast,!!spec.forecast);assert.equal(!!(decoded[0].qualifiers&1),forecast);assert.equal(decoded[0].observedAt,forecast?0:properties.observed_at.timestamp.value);
    assert.ok(Math.abs(decoded[0].value-(spec.forecast?6.9:spec.unit==='°F'?44.24:6.8))<1e-6,'Fixture temperature/units changed');
    const second=properties[spec.second||'precipitation'];assert.ok(second);assert.equal(decoded[1].text,second.shortText.text);assert.equal(decoded[1].value,second.numericValue.value);assert.equal(decoded[1].displayKind,spec.second==='humidity'?0:1);
    if(spec.name==='measured-celsius'){
     const before=decoded[0],calls=host.urls.length;host.advance(60000);await face.replay();const after=decode(face.current(),host.now())[0];assert.equal(after.observedAt,before.observedAt);assert.ok(after.validUntil<=before.observedAt+3600);assert.equal(host.urls.length,calls,'Cache replay unexpectedly fetched new data');result.cacheReplay={originalObservation:before.observedAt,replayedObservation:after.observedAt,ageSeconds:Math.floor(host.now()/1000)-after.observedAt,requestDelta:host.urls.length-calls};
     const expired=decode(packet,(decoded[0].validUntil+1)*1000);assert.equal(expired[0].fresh,false);result.expiryTime=decoded[0].validUntil+1;
     face.deny();const denied=decode(face.current(),host.now());assert.ok(denied.slice(0,2).every(s=>s.status===4&&!s.fresh));result.deniedPacket=face.current();
    }
   }
   assert.ok(!host.values.has('chmu.app.auth.v1')&&!host.values.has('chmu.app.install.v1'));entry.cases.push(result);
  }
  report.consumers.push(entry);
 }
 fs.mkdirSync(options.output,{recursive:true});fs.writeFileSync(path.join(options.output,'pipeline.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',file:path.join(options.output,'pipeline.json')}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
