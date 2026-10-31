'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {conditionalHeaders, policy} = require('../src/lib/http-cache');

const NOW = Date.parse('2026-10-31T08:00:00Z');
const date = value => new Date(value).toUTCString();
const response = (values={}, status=200) => ({status, headers:{get:name =>
  Object.prototype.hasOwnProperty.call(values,name) ? values[name] : null}});

test('Conditional requests prefer a valid opaque ETag, including weak/empty tags',()=>{
  for(const etag of ['"version-1"','W/"opaque:etag/42"','""']) {
    assert.deepEqual(conditionalHeaders({etag,lastModified:date(NOW)}),{'If-None-Match':etag});
  }
  assert.deepEqual(conditionalHeaders({etag:'not quoted',lastModified:date(NOW)}),{'If-Modified-Since':date(NOW)});
  assert.deepEqual(conditionalHeaders({etag:'"tag"',noStore:true}),{});
});

test('The app backend unquoted SHA-256 ETag survives 200/304 and is sent without added quotes',()=>{
  const etag='ce8920461dd9894a30a51eb62641e71cd64569dc8d162fb0a1533270201ceab4';
  const stored=policy(response({etag,'last-modified':date(NOW-60000)}),NOW);
  assert.equal(stored.etag,etag);
  assert.deepEqual(conditionalHeaders(stored),{'If-None-Match':etag});
  const revalidated=policy(response({},304),NOW+60000,stored);
  assert.equal(revalidated.etag,etag);
  assert.deepEqual(conditionalHeaders(revalidated),{'If-None-Match':etag});
  assert.equal(revalidated.checkedAt,NOW+60000);
  for(const invalid of ['abc,def','abc;def','abc/def','abc def','abc\tdef','abc:123']) {
    assert.deepEqual(conditionalHeaders({etag:invalid}),{});
  }
});

test('Validators reject injection, overlong strings and impossible/non-HTTP dates',()=>{
  for(const value of ['"ok"\r\nAuthorization: secret','*','W/"space inside"','"'+ 'a'.repeat(1023)+'"']) {
    assert.deepEqual(conditionalHeaders({etag:value}),{});
  }
  for(const lastModified of ['2026-10-31','Fri, 31 Oct 2026 08:00:00 GMT',
    'Mon, 30 Feb 2026 08:00:00 GMT','Sat, 31 Oct 2026 08:00:00 GMT\r\nX: y']) {
    assert.deepEqual(conditionalHeaders({lastModified}),{});
  }
});

test('Missing or throwing header bridges produce safe optional metadata',()=>{
  const expected={etag:null,lastModified:null,checkedAt:NOW,noStore:false};
  assert.deepEqual(policy({},NOW),expected);
  assert.deepEqual(policy({headers:{get(){throw Error('native detail');}}},NOW),expected);
  assert.deepEqual(policy(response({'cache-control':null}),NOW),expected);
  assert.throws(()=>policy({},NaN),TypeError);
});

test('200 metadata contains validators and validation time, never source timestamps or lifetime policy',()=>{
  const p=policy(response({etag:'"a"','last-modified':date(NOW-3600000),
    'cache-control':'no-cache, max-age=180',date:date(NOW-60000),age:'120',expires:date(NOW+600000)}),NOW);
  assert.deepEqual(p,{etag:'"a"',lastModified:date(NOW-3600000),checkedAt:NOW,noStore:false});
});

test('no-store is case-insensitive and cannot be smuggled through a quoted extension',()=>{
  for(const value of ['no-store','public, NO-STORE','max-age=180, no-store']) {
    assert.equal(policy(response({'cache-control':value}),NOW).noStore,true);
  }
  for(const value of ['no-cache','private, max-age=0','extension="x,no-store", public','extension="unterminated,no-store']) {
    assert.equal(policy(response({'cache-control':value}),NOW).noStore,false);
  }
});

test('304 retains absent validators/no-store and changes only checkedAt metadata',()=>{
  const previous={etag:'W/"old"',lastModified:date(NOW-3600000),checkedAt:NOW,
    noStore:true,fetchedAt:NOW-7200000,body:{temperature:5}};
  const snapshot=JSON.stringify(previous);
  const p=policy(response({},304),NOW+300000,previous);
  assert.deepEqual(p,{etag:previous.etag,lastModified:previous.lastModified,checkedAt:NOW+300000,noStore:true});
  assert.equal(JSON.stringify(previous),snapshot,'the helper never mutates the body/cache record');
});

test('304 present headers replace old validators/no-store; invalid validators are dropped',()=>{
  const previous={etag:'"old"',lastModified:date(NOW),noStore:true};
  const changed=policy(response({etag:'"new"','last-modified':date(NOW-60000),'cache-control':'max-age=600'},304),NOW,previous);
  assert.deepEqual(changed,{etag:'"new"',lastModified:date(NOW-60000),checkedAt:NOW,noStore:false});
  const invalid=policy(response({etag:'"bad"\r\nX: y','last-modified':'not a date'},304),NOW,previous);
  assert.equal(invalid.etag,null);
  assert.equal(invalid.lastModified,null);
  assert.deepEqual(conditionalHeaders(invalid),{});
});

test('200 responses do not inherit old metadata; hostile and unrelated metadata is never emitted',()=>{
  const p=policy(response(),NOW,{etag:'"old"',lastModified:date(NOW),noStore:true,
    noCache:true,maxAgeSec:600,expiresAt:NOW+600000,serverFreshUntil:NOW+600000});
  assert.deepEqual(p,{etag:null,lastModified:null,checkedAt:NOW,noStore:false});
  assert.deepEqual(policy(response({'cache-control':'x'.repeat(1025),etag:'x'.repeat(1025)}),NOW),p);
  assert.deepEqual(conditionalHeaders(null),{});
  assert.deepEqual(conditionalHeaders({lastModified:9}),{});
});
