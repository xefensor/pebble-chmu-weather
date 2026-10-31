'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {buildInstance} = require('../src/lib/envelope');
const {apparentTemperature} = require('../src/lib/apparent');

const NOW = Date.parse('2026-10-31T07:48:00Z');
const START = Date.parse('2026-10-30T23:00:00Z') / 1000;
const PLACE = {id: 'saved-cb', name: 'České Budějovice', latitude: 48.951944, longitude: 14.469722};

function hours(start = START, count = 73) {
  return Array.from({length: count}, (_, i) => ({
    time: start + i * 3600,
    temperatureC: i === 8 ? 5 : 4 + i % 8,
    conditionCode: i % 3 ? 'cloudy' : 'light_rain',
    humidity: 84,
    windSpeed: 3,
    windDirection: 315,
    precipitation: 0.1
  }));
}

function options(overrides = {}) {
  return Object.assign({
    place: PLACE,
    forecast: {hours: hours()},
    observation: {temperatureC: 6.8, observedAt: Date.parse('2026-10-31T07:40:00Z') / 1000},
    station: {id: 'C2CBUD01', name: 'České Budějovice, Rožnov', distanceKm: 2},
    now: NOW,
    fetchedAt: Math.floor(NOW / 1000),
    units: {temperature: '°C', wind: 'km/h'},
    request: {}
  }, overrides);
}

function supplement() {
  return {
    timezone: 'Europe/Prague',
    hours: hours(START, 168).map(hour => Object.assign({}, hour, {
      temperatureC: 25, conditionCode: 'sun', humidity: 50, windSpeed: 5,
      windDirection: 90, precipitationProbability: 20
    })),
    days: Array.from({length: 7}, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 31 + i)).toISOString().slice(0, 10),
      highC: 25 + i, lowC: 15 + i, conditionCode: 'sun', uvIndex: 3,
      precipitationProbability: 20 + i
    }))
  };
}

function withSupplement(overrides = {}) {
  return options(Object.assign({supplemental: supplement(), supplementalFetchedAt: NOW / 1000}, overrides));
}

function appOptions(overrides = {}) {
  return withSupplement({
    appUV:{days:[{date:'2026-10-31',uvIndex:1.5,updatedAt:NOW/1000-4*86400}]},
    appUVFetchedAt:NOW/1000,
    appForecast:{updatedAt:NOW/1000-3600,days:[
      {date:'2026-10-31',highC:14,lowC:1,conditionCode:'light_rain'},
      {date:'2026-11-01',highC:13,lowC:2,conditionCode:'cloudy'},
      {date:'2026-11-02',highC:12,lowC:3,conditionCode:'sun'}]},
    appForecastFetchedAt:NOW/1000,
    ...overrides
  });
}

function measurement(fields = {}) {
  return Object.assign({temperatureC:6.8, observedAt:NOW / 1000 - 8 * 60}, fields);
}

test('App full-day local ranges override partial graph days without changing measured temperature or hourly data', () => {
  const p = buildInstance(appOptions()).properties;
  assert.equal(p.temperature.numericValue.value,6.8);
  assert.deepEqual(p.daily_high.series.numericValue.values.slice(0,3),[14,13,12]);
  assert.deepEqual(p.daily_low.series.numericValue.values.slice(0,3),[1,2,3]);
  assert.match(p.daily_source.series.longText.values[0],/full-day app forecast/);
  assert.equal(p.daily_high.series.numericValue.values[3],28);
  assert.equal(p.daily_source.series.longText.values[3],'Open-Meteo');
  assert.equal(p.hourly_temperature.series.numericValue.values[8],6.8);
  assert.equal(p.hourly_temperature.series.numericValue.values[9],hours()[9].temperatureC);
  assert.equal(p.app_forecast_updated_at.timestamp.value,NOW/1000-3600);
});

test('ČHMÚ clear-sky noon UV wins over Open-Meteo with original issue time and valid zero', () => {
  const p = buildInstance(appOptions()).properties;
  assert.equal(p.uv_index.numericValue.value,1.5);
  assert.match(p.uv_source.longText.text,/ČHMÚ.*clear-sky noon/);
  assert.equal(p.uv_updated_at.timestamp.value,NOW/1000-4*86400);
  const zero = appOptions(); zero.appUV.days[0].uvIndex=0;
  assert.equal(buildInstance(zero).properties.uv_index.numericValue.value,0);
});

test('App data works with supplementary weather disabled, and absent today UV is never borrowed from tomorrow', () => {
  const only = appOptions({supplemental:null,supplementalFetchedAt:0});
  const p = buildInstance(only).properties;
  assert.equal(p.uv_index.numericValue.value,1.5);
  assert.equal(p.supplemental_source,undefined);
  assert.equal(p.precipitation,undefined);
  only.appUV.days[0].date='2026-11-01';
  assert.equal(buildInstance(only).properties.uv_index,undefined);
  assert.equal(buildInstance(appOptions({appUV:only.appUV})).properties.uv_index.numericValue.value,3);
});

test('Expired app downloads, stale source issues and future issues cannot override public data', () => {
  for (const change of [
    {appUVFetchedAt:NOW/1000-6*3600-1,appForecastFetchedAt:NOW/1000-6*3600-1},
    {appUV:{days:[{date:'2026-10-31',uvIndex:9,updatedAt:NOW/1000-7*86400-1}]},appForecast:{updatedAt:NOW/1000-6*3600-1,days:[{date:'2026-10-31',highC:99,lowC:80}]}},
    {appUV:{days:[{date:'2026-10-31',uvIndex:9,updatedAt:NOW/1000+601}]},appForecast:{updatedAt:NOW/1000+601,days:[{date:'2026-10-31',highC:99,lowC:80}]}}
  ]) {
    const p=buildInstance(appOptions(change)).properties;
    assert.equal(p.uv_index.numericValue.value,3);
    assert.match(p.uv_source.longText.text,/Open-Meteo/);
    assert.equal(p.app_forecast_updated_at,undefined);
    assert.equal(p.app_data_fetched_at,undefined);
    assert.notEqual(p.high.numericValue.value,99);
  }
});

test('App calendar gaps do not shift daily values or turn national ranges into local forecasts', () => {
  const o=appOptions();
  o.appForecast.days=[{date:'2026-11-02',highC:15,lowC:2,conditionCode:'cloudy'},
    {date:'2026-11-03',highC:99,lowC:80,conditionCode:'sun'}];
  const p=buildInstance(o).properties;
  assert.notEqual(p.daily_high.series.numericValue.values[0],15);
  assert.equal(p.daily_high.series.numericValue.values[2],15);
  assert.equal(p.daily_high.series.numericValue.values[3],28);
});

test('Explicit Open-Meteo UV ignores valid app UV while keeping independent app daily ranges', () => {
  const p = buildInstance(appOptions({uvSource:'open-meteo', appUVFetchedAt:NOW / 1000 - 5 * 3600})).properties;
  assert.equal(p.uv_index.numericValue.value,3);
  assert.equal(p.uv_source.longText.text,'Open-Meteo (forecast daily peak)');
  assert.equal(p.uv_updated_at.timestamp.value,NOW / 1000);
  assert.equal(p.high.numericValue.value,14);
  assert.equal(p.low.numericValue.value,1);
  assert.match(p.daily_source.series.longText.values[0],/full-day app forecast/);
  assert.equal(p.app_forecast_updated_at.timestamp.value,NOW / 1000 - 3600);
  assert.equal(p.app_data_fetched_at.timestamp.value,NOW / 1000,'ignored app UV does not contribute an older download time');
});

test('UV off omits its value, source and update time without disabling app daily ranges or rain probabilities', () => {
  const p = buildInstance(appOptions({uvSource:'off'})).properties;
  for (const name of ['uv_index','uv_source','uv_updated_at']) assert.equal(p[name],undefined,name);
  assert.equal(p.high.numericValue.value,14);
  assert.equal(p.low.numericValue.value,1);
  assert.equal(p.precipitation.numericValue.value,20);
  assert.ok(p.app_forecast_updated_at);
  assert.ok(p.supplemental_source);
  assert.doesNotMatch(p.supplemental_source.longText.text,/UV/);
});

test('UV preference and supplement availability are independent: CHMU-first can fall back, Open-Meteo never borrows app UV', () => {
  const absent = {days:[{date:'2026-11-01',uvIndex:8,updatedAt:NOW / 1000}]};
  const preferred = buildInstance(appOptions({uvSource:'chmu', appUV:absent})).properties;
  assert.equal(preferred.uv_index.numericValue.value,3);
  assert.match(preferred.uv_source.longText.text,/Open-Meteo/);
  for (const uvSource of ['chmu','open-meteo','off']) {
    const p = buildInstance(appOptions({uvSource, supplemental:null, supplementalFetchedAt:0})).properties;
    assert.equal(p.high.numericValue.value,14);
    assert.equal(p.precipitation,undefined);
    assert.equal(p.supplemental_source,undefined);
    if (uvSource === 'chmu') {
      assert.equal(p.uv_index.numericValue.value,1.5);
      assert.match(p.uv_source.longText.text,/ČHMÚ/);
    } else {
      for (const name of ['uv_index','uv_source','uv_updated_at']) assert.equal(p[name],undefined,uvSource + '/' + name);
    }
  }
  const missing = buildInstance(appOptions({uvSource:'chmu', appUV:absent, supplemental:null})).properties;
  assert.equal(missing.uv_index,undefined);
});

test('Disabled UV-only downloads make no emitted source or freshness claim, and selected Open-Meteo preserves zero UV', () => {
  const onlyUV = {timezone:'Europe/Prague',hours:[],days:[{date:'2026-10-31',uvIndex:0}]};
  const off = buildInstance(appOptions({uvSource:'off',appForecast:null,supplemental:onlyUV})).properties;
  for (const name of ['uv_index','uv_source','uv_updated_at','app_data_fetched_at','app_forecast_updated_at',
    'supplemental_source','supplemental_updated_at']) assert.equal(off[name],undefined,name);
  const selected = buildInstance(appOptions({uvSource:'open-meteo',appForecast:null,supplemental:onlyUV})).properties;
  assert.equal(selected.uv_index.numericValue.value,0);
  assert.equal(selected.app_data_fetched_at,undefined);
  assert.match(selected.uv_source.longText.text,/Open-Meteo/);
});

test('Fresh measured 6.8°C is displayed as 7°C, not the current-hour ALADIN forecast of 5°C', () => {
  const p = buildInstance(options()).properties;
  assert.equal(p.temperature.shortText.text, '7°C');
  assert.equal(p.temperature.numericValue.value, 6.8);
  assert.equal(p.temperature.numericValue.unit, '°C');
  assert.equal(p.is_forecast.boolean.value, false);
  assert.equal(p.observed_at.timestamp.value, Date.parse('2026-10-31T07:40:00Z') / 1000);
  assert.equal(p.observation_age.numericValue.value, 8);
  assert.equal(p.station.longText.text, 'České Budějovice, Rožnov');
  assert.equal(p.source.longText.text, 'ČHMÚ station measurement');
});

test('Fresh measured zero humidity, calm wind and north direction retain values and original observation timestamps', () => {
  const observation = measurement({humidity:0,windSpeed:0,windDirection:0});
  const p = buildInstance(options({observation})).properties;
  assert.equal(p.humidity.numericValue.value,0);
  assert.equal(p.wind_speed.numericValue.value,0);
  assert.equal(p.wind_direction.numericValue.value,0);
  assert.equal(p.humidity_source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.wind_source.longText.text,'ČHMÚ station measurement');
  assert.equal(p.humidity_observed_at.timestamp.value,observation.observedAt);
  assert.equal(p.wind_observed_at.timestamp.value,observation.observedAt);
  assert.equal(p.feels_like.numericValue.value,apparentTemperature(6.8,0,0));
  assert.equal(p.feels_like_source.longText.text,'Calculated shade estimate; station temperature, station humidity and station wind');
});

test('Missing measured humidity and wind components fall back independently with exact mixed provenance', () => {
  const rh = buildInstance(options({observation:measurement({humidity:67})})).properties;
  assert.equal(rh.humidity.numericValue.value,67);
  assert.equal(rh.wind_speed.numericValue.value,10.8);
  assert.equal(rh.wind_direction.numericValue.value,315);
  assert.equal(rh.humidity_source.longText.text,'ČHMÚ station measurement');
  assert.equal(rh.wind_source.longText.text,'ČHMÚ ALADIN forecast');
  assert.ok(rh.humidity_observed_at);
  assert.equal(rh.wind_observed_at,undefined);
  assert.equal(rh.feels_like.numericValue.value,apparentTemperature(6.8,67,3));
  assert.equal(rh.feels_like_source.longText.text,'Calculated shade estimate; station temperature, station humidity and ALADIN wind');

  const speed = buildInstance(options({observation:measurement({windSpeed:2})})).properties;
  assert.equal(speed.humidity.numericValue.value,84);
  assert.equal(speed.wind_speed.numericValue.value,7.2);
  assert.equal(speed.wind_direction.numericValue.value,315);
  assert.equal(speed.humidity_source.longText.text,'ČHMÚ ALADIN forecast');
  assert.equal(speed.wind_source.longText.text,'Speed: ČHMÚ station measurement; Direction: ČHMÚ ALADIN forecast');
  assert.equal(speed.humidity_observed_at,undefined);
  assert.ok(speed.wind_observed_at);
  assert.equal(speed.feels_like_source.longText.text,'Calculated shade estimate; station temperature, ALADIN humidity and station wind');

  const direction = buildInstance(options({observation:measurement({windDirection:180})})).properties;
  assert.equal(direction.wind_source.longText.text,'Speed: ČHMÚ ALADIN forecast; Direction: ČHMÚ station measurement');
  assert.ok(direction.wind_observed_at);
  assert.equal(direction.feels_like.numericValue.value,apparentTemperature(6.8,84,3));
  assert.equal(direction.feels_like_source.longText.text,'Calculated shade estimate; station temperature, ALADIN humidity and ALADIN wind');
});

test('Invalid optional measurements fall back without coercing null, booleans or numeric strings', () => {
  const cases = {
    humidity:[null,undefined,'0',false,true,NaN,Infinity,-1,101,[],{}],
    windSpeed:[null,undefined,'0',false,true,NaN,Infinity,-1,151,[],{}],
    windDirection:[null,undefined,'0',false,true,NaN,Infinity,-1,361,[],{}]
  };
  const fields = {humidity:'humidity',windSpeed:'wind_speed',windDirection:'wind_direction'};
  const expected = {humidity:84,windSpeed:10.8,windDirection:315};
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      const p = buildInstance(options({observation:measurement({[field]:value})})).properties;
      assert.equal(p[fields[field]].numericValue.value,expected[field],field + '=' + String(value));
      assert.equal(p.humidity_observed_at,undefined);
      assert.equal(p.wind_observed_at,undefined);
      assert.equal(p.humidity_source.longText.text,'ČHMÚ ALADIN forecast');
      assert.equal(p.wind_source.longText.text,'ČHMÚ ALADIN forecast');
    }
  }
  const boundary = buildInstance(options({observation:measurement({humidity:100,windSpeed:150,windDirection:360})})).properties;
  assert.equal(boundary.humidity.numericValue.value,100);
  assert.equal(boundary.wind_speed.numericValue.value,540);
  assert.equal(boundary.wind_direction.numericValue.value,360);
  assert.equal(boundary.feels_like,undefined,'wind outside the approximation guardrails does not borrow forecast wind');
});

test('Optional measurements are ignored when the same temperature sample is stale, future-invalid, or invalid', () => {
  const samples = [null,
    measurement({observedAt:NOW / 1000 - 3601}),
    measurement({observedAt:NOW / 1000 + 301}),
    measurement({observedAt:null}), measurement({temperatureC:null})];
  for (const sample of samples) {
    const observation = sample && Object.assign(sample,{humidity:10,windSpeed:9,windDirection:90});
    const p = buildInstance(options({observation})).properties;
    assert.equal(p.humidity.numericValue.value,84);
    assert.equal(p.wind_speed.numericValue.value,10.8);
    assert.equal(p.wind_direction.numericValue.value,315);
    assert.equal(p.humidity_observed_at,undefined);
    assert.equal(p.wind_observed_at,undefined);
    assert.equal(p.humidity_source.longText.text,'ČHMÚ ALADIN forecast');
    assert.equal(p.wind_source.longText.text,'ČHMÚ ALADIN forecast');
    assert.equal(p.feels_like_source.longText.text,'Calculated shade estimate; ALADIN temperature, ALADIN humidity and ALADIN wind');
  }
});

test('Complete fresh measurements supply humidity, wind and calculated feels-like even without a current forecast hour', () => {
  const observation = measurement({humidity:67,windSpeed:2.75,windDirection:270});
  const p = buildInstance(options({observation,forecast:{hours:[]},fetchedAt:0})).properties;
  assert.equal(p.humidity.numericValue.value,67);
  assert.equal(p.wind_speed.numericValue.value,9.9);
  assert.equal(p.wind_direction.numericValue.value,270);
  assert.equal(p.humidity_observed_at.timestamp.value,observation.observedAt);
  assert.equal(p.wind_observed_at.timestamp.value,observation.observedAt);
  assert.equal(p.feels_like.numericValue.value,apparentTemperature(6.8,67,2.75));
  assert.equal(p.forecast_updated_at,undefined);
  assert.equal(p.condition_code.longText.text,'unknown');
  assert.equal(p.hourly_temperature.series.numericValue.values[8],6.8);
});

test('A missing current metric is not borrowed from a later hour, and incomplete wind source describes only the available component', () => {
  const data = hours();
  data[8].humidity = null;
  data[8].windSpeed = null;
  data[9].humidity = 99;
  data[9].windSpeed = 9;
  const o = options({forecast:{hours:data},observation:measurement({humidity:40})});
  const p = buildInstance(o).properties;
  assert.equal(p.humidity.numericValue.value,40);
  assert.equal(p.wind_speed,undefined);
  assert.equal(p.wind_direction.numericValue.value,315);
  assert.equal(p.wind_source.longText.text,'Direction: ČHMÚ ALADIN forecast');
  assert.equal(p.wind_observed_at,undefined);
  assert.equal(p.feels_like,undefined);
});

test('Measured optional fields do not mutate raw forecasts or alter any hourly/daily forecast series', () => {
  const o = withSupplement({observation:measurement({humidity:20,windSpeed:8,windDirection:180})});
  const raw = JSON.stringify({forecast:o.forecast,supplemental:o.supplemental});
  const baseline = buildInstance(withSupplement()).properties;
  const p = buildInstance(o).properties;
  assert.equal(JSON.stringify({forecast:o.forecast,supplemental:o.supplemental}),raw);
  for (const name of ['hourly_temperature','hourly_source','hourly_condition_code','hourly_precipitation',
    'daily_high','daily_low','daily_condition_code','daily_source','daily_precipitation']) {
    assert.deepEqual(p[name],baseline[name],name);
  }
  assert.equal(p.humidity.numericValue.value,20);
  assert.equal(p.wind_speed.numericValue.value,28.8);
});

test('Measured wind feeds feels-like in m/s independently of wind display units and converts Fahrenheit once', () => {
  const observation = measurement({humidity:67,windSpeed:2.75,windDirection:270});
  const expected = apparentTemperature(6.8,67,2.75);
  const factors = {'m/s':1,'km/h':3.6,mph:2.2369362921,knots:1.9438444924};
  for (const [wind, factor] of Object.entries(factors)) {
    const p = buildInstance(options({observation,units:{temperature:'°F',wind}})).properties;
    assert.ok(Math.abs(p.wind_speed.numericValue.value - 2.75 * factor) < 1e-10,wind);
    assert.ok(Math.abs(p.feels_like.numericValue.value - (expected * 9 / 5 + 32)) < 1e-10,wind);
    assert.equal(p.feels_like_source.longText.text,'Calculated shade estimate; station temperature, station humidity and station wind');
    assert.equal(p.wind_source.longText.text,'ČHMÚ station measurement');
  }
});

test('Overridden Open-Meteo current metrics do not falsely claim supplemental use or freshness', () => {
  const data = hours();
  Object.assign(data[8],{humidity:null,windSpeed:null,windDirection:null});
  const extra = {timezone:'Europe/Prague',days:[],hours:[{time:START + 8 * 3600,
    humidity:50,windSpeed:5,windDirection:90,temperatureC:null,conditionCode:'unknown'}]};
  const o = options({forecast:{hours:data},supplemental:extra,supplementalFetchedAt:NOW / 1000,
    observation:measurement({humidity:67,windSpeed:2.75,windDirection:270})});
  const measured = buildInstance(o).properties;
  assert.equal(measured.supplemental_source,undefined);
  assert.equal(measured.supplemental_updated_at,undefined);
  delete o.observation.windDirection;
  const mixed = buildInstance(o).properties;
  assert.equal(mixed.wind_source.longText.text,'Speed: ČHMÚ station measurement; Direction: Open-Meteo forecast');
  assert.ok(mixed.supplemental_source);
  assert.equal(mixed.supplemental_updated_at.timestamp.value,NOW / 1000);
  assert.equal(mixed.feels_like_source.longText.text,'Calculated shade estimate; station temperature, station humidity and station wind');
});

test('Fahrenheit retains unrounded converted numeric precision and formats one rounded native reading', () => {
  const p = buildInstance(options({units: {temperature: '°F', wind: 'mph'}})).properties;
  assert.equal(p.temperature.shortText.text, '44°F');
  assert.ok(Math.abs(p.temperature.numericValue.value - 44.24) < 1e-9);
  assert.equal(p.temperature.numericValue.unit, '°F');
  assert.equal(p.hourly_temperature.series.numericValue.unit, '°F');
  assert.equal(p.hourly_temperature.series.shortText.values[8], '44°F');
  assert.equal(p.wind_speed.numericValue.unit, 'mph');
  assert.ok(Math.abs(p.wind_speed.numericValue.value - 6.7108088763) < 1e-9);
});

test('Expired or invalid measurement falls back only to the actual current forecast hour with an estimate marker', () => {
  for (const observation of [null, {temperatureC: 6.8, observedAt: NOW / 1000 - 3601},
    {temperatureC: null, observedAt: NOW / 1000}, {temperatureC: 6.8, observedAt: NOW / 1000 + 301}]) {
    const p = buildInstance(options({observation})).properties;
    assert.equal(p.temperature.shortText.text, '~5°C');
    assert.equal(p.temperature.numericValue.value, 5);
    assert.equal(p.is_forecast.boolean.value, true);
    assert.equal(p.observed_at, undefined);
    assert.equal(p.observation_age, undefined);
    assert.equal(p.source.longText.text, 'ČHMÚ ALADIN forecast');
  }
});

test('A measurement at the one-hour limit is still current but the next second is a forecast', () => {
  const old = {temperatureC: 6.8, observedAt: NOW / 1000 - 3600};
  assert.equal(buildInstance(options({observation: old})).properties.is_forecast.boolean.value, false);
  old.observedAt--;
  assert.equal(buildInstance(options({observation: old})).properties.is_forecast.boolean.value, true);
});

test('Expired downloaded forecast is not presented as a new estimate or kept in hourly arrays', () => {
  const old = options({observation: null, fetchedAt: NOW / 1000 - 6 * 3600 - 1});
  assert.equal(buildInstance(old), null);
  const measured = buildInstance(options({fetchedAt: old.fetchedAt})).properties;
  assert.equal(measured.temperature.shortText.text, '7°C');
  assert.equal(measured.forecast_updated_at, undefined);
  assert.equal(measured.hourly_temperature.series.numericValue.values[8],6.8);
  assert.ok(measured.hourly_temperature.series.numericValue.values.every((v,i) => i === 8 || v === null));
});

test('Hourly temperatures use UTC timestamps from Czech local midnight and retain explicit null gaps', () => {
  const data = hours();
  data[6].temperatureC = null;
  data[8].temperatureC = null;
  const p = buildInstance(options({forecast: {hours: data}})).properties;
  const series = p.hourly_temperature.series;
  assert.equal(series.start, START);
  assert.equal(series.stepSec, 3600);
  assert.equal(series.numericValue.values.length, 48);
  assert.equal(series.numericValue.values[8], 6.8);
  assert.equal(series.numericValue.values[6], null);
  assert.equal(series.numericValue.values[9], data[9].temperatureC);
  assert.equal(p.hourly_condition_code.series.longText.values[8], 'cloudy');
  assert.equal(p.temperature.shortText.text, '7°C');
  assert.equal(buildInstance(options({forecast: {hours: data}, observation: null})), null,
    'The following hour must not be moved into a missing current forecast slot');
});

test('Only the active hourly slot uses the fresh observation, including a sample from the previous hour', () => {
  const o=options({observation:{temperatureC:6.8,observedAt:NOW/1000-50*60}});
  const p=buildInstance(o).properties;
  const expected=hours().slice(0,48).map(hour=>hour.temperatureC);
  expected[8]=6.8;
  assert.deepEqual(p.hourly_temperature.series.numericValue.values,expected);
  assert.equal(p.hourly_source.series.longText.values[8],'ČHMÚ station measurement');
  assert.equal(p.hourly_source.series.longText.values[7],'ČHMÚ ALADIN forecast');
  assert.equal(p.hourly_source.series.longText.values[9],'ČHMÚ ALADIN forecast');
  assert.equal(o.forecast.hours[8].temperatureC,5,'raw forecast remains untouched');
  assert.equal(p.observed_at.timestamp.value,o.observation.observedAt);
});

test('An exact hour boundary moves the observation blend to the new hour only', () => {
  const now=(START+9*3600)*1000;
  const p=buildInstance(options({now,observation:{temperatureC:6.8,observedAt:now/1000-50*60}})).properties;
  assert.equal(p.hourly_temperature.series.numericValue.values[8],5);
  assert.equal(p.hourly_temperature.series.numericValue.values[9],6.8);
  assert.equal(p.hourly_temperature.series.numericValue.values[10],hours()[10].temperatureC);
  assert.equal(p.hourly_source.series.longText.values[8],'ČHMÚ ALADIN forecast');
});

test('Expired or missing observations never replace a current forecast slot, and Fahrenheit uses unrounded measurement', () => {
  for(const observation of [null,{temperatureC:6.8,observedAt:NOW/1000-3601}]) {
    const p=buildInstance(options({observation})).properties;
    assert.equal(p.hourly_temperature.series.numericValue.values[8],5);
    assert.equal(p.hourly_source.series.longText.values[8],'ČHMÚ ALADIN forecast');
  }
  const p=buildInstance(options({units:{temperature:'°F'}})).properties;
  assert.ok(Math.abs(p.hourly_temperature.series.numericValue.values[8]-44.24)<1e-9);
  assert.equal(p.hourly_temperature.series.numericValue.values[8],p.temperature.numericValue.value);
});

test('Missing early hours are not shifted backward and a later-day forecast remains at its timestamp', () => {
  const data = hours().slice(5);
  const p = buildInstance(options({forecast: {hours: data}})).properties;
  assert.deepEqual(p.hourly_temperature.series.numericValue.values.slice(0, 5), [null, null, null, null, null]);
  assert.equal(p.hourly_temperature.series.numericValue.values[5], data[0].temperatureC);
});

test('Provider instance contains today and tomorrow high/low/condition and computed sunrise/sunset', () => {
  const result = buildInstance(options());
  assert.equal(result.instanceId, PLACE.id);
  const p = result.properties;
  assert.equal(p.utc_offset.numericValue.value, 60);
  for (const name of ['daily_high', 'daily_low', 'daily_condition_code', 'daily_sunrise', 'daily_sunset']) {
    assert.ok(p[name], name + ' must be supplied for the native weather provider');
    assert.equal(p[name].series.start, START);
    assert.equal(p[name].series.stepSec, 86400);
  }
  assert.ok(p.daily_high.series.numericValue.values.length >= 2);
  assert.ok(p.daily_low.series.numericValue.values.length >= 2);
  assert.ok(p.daily_condition_code.series.longText.values.length >= 2);
  const rises = p.daily_sunrise.series.timestamp.values;
  const sets = p.daily_sunset.series.timestamp.values;
  for (let i = 0; i < 2; i++) {
    assert.ok(Number.isInteger(rises[i]) && Number.isInteger(sets[i]));
    assert.ok(rises[i] < sets[i]);
    assert.equal(new Date((rises[i] + 3600) * 1000).toISOString().slice(0, 10), ['2026-10-31', '2026-11-01'][i]);
  }
  assert.ok(p.sunrise.timestamp.value > Date.parse('2026-10-31T05:00:00Z') / 1000);
  assert.ok(p.sunrise.timestamp.value < Date.parse('2026-10-31T08:00:00Z') / 1000);
  assert.ok(p.sunset.timestamp.value > Date.parse('2026-10-31T14:00:00Z') / 1000);
  assert.ok(p.sunset.timestamp.value < Date.parse('2026-10-31T17:00:00Z') / 1000);
});

test('A trailing partial future day is omitted from every daily series rather than given a false high and low', () => {
  const data = hours(); // Three complete local days, then the first hour of a fourth.
  data[72].temperatureC = 80;
  const p = buildInstance(options({forecast: {hours: data}})).properties;
  for (const name of ['daily_high', 'daily_low']) {
    assert.equal(p[name].series.numericValue.values.length, 3);
    assert.ok(!p[name].series.numericValue.values.includes(80));
  }
  assert.equal(p.daily_condition_code.series.longText.values.length, 3);
  assert.equal(p.daily_sunrise.series.timestamp.values.length, 3);
  assert.equal(p.daily_sunset.series.timestamp.values.length, 3);
  assert.equal(p.daily_condition.series.shortText.values.length, 3);
});

test('Today can be partial, but a missing future hour truncates the daily series without shifting later days', () => {
  const data = hours().slice(5); // Forecast starts after today's midnight.
  const complete = buildInstance(options({forecast: {hours: data}})).properties;
  assert.equal(complete.daily_high.series.numericValue.values.length, 3);
  const tomorrowGap = data.filter(hour => hour.time !== START + 30 * 3600);
  const truncated = buildInstance(options({forecast: {hours: tomorrowGap}})).properties;
  assert.equal(truncated.daily_high.series.numericValue.values.length, 1,
    'An incomplete tomorrow must not be replaced by the complete day after tomorrow');
  assert.equal(truncated.daily_sunrise.series.timestamp.values.length, 1);
  const tomorrowNull = data.map(hour => hour.time === START + 30 * 3600 ?
    Object.assign({}, hour, {temperatureC: null}) : hour);
  assert.equal(buildInstance(options({forecast: {hours: tomorrowNull}})).properties.daily_low.series.numericValue.values.length, 1);
});

test('A future autumn DST day requires all 25 real hours, including both occurrences of local 02:00', () => {
  const start = Date.parse('2026-10-23T22:00:00Z') / 1000;
  const now = Date.parse('2026-10-24T12:15:00Z');
  const data = hours(start, 73); // Oct 24: 24h, Oct 25: 25h, Oct 26: 24h.
  const full = buildInstance(options({now, forecast: {hours: data}, fetchedAt: now / 1000, observation: null})).properties;
  assert.equal(full.daily_high.series.numericValue.values.length, 3);
  const missingRepeatedHour = data.filter(hour => hour.time !== Date.parse('2026-10-25T01:00:00Z') / 1000);
  const gap = buildInstance(options({now, forecast: {hours: missingRepeatedHour}, fetchedAt: now / 1000, observation: null})).properties;
  assert.equal(gap.daily_high.series.numericValue.values.length, 1,
    'Twenty-four samples do not fully cover a 25-hour local day');
});

test('A complete future spring DST day has 23 hours and is retained', () => {
  const start = Date.parse('2026-03-27T23:00:00Z') / 1000;
  const now = Date.parse('2026-03-28T12:15:00Z');
  const data = hours(start, 71); // Mar 28: 24h, Mar 29: 23h, Mar 30: 24h.
  const p = buildInstance(options({now, forecast: {hours: data}, fetchedAt: now / 1000, observation: null})).properties;
  assert.equal(p.daily_high.series.numericValue.values.length, 3);
  assert.equal(p.daily_sunset.series.timestamp.values.length, 3);
});

test('Midnight advances to the next local calendar day without treating old hour zero as current', () => {
  const now = Date.parse('2026-10-31T23:05:00Z'); // 00:05 on 1 November in Prague.
  const forecast = {hours: hours(START)};
  const p = buildInstance(options({now, forecast, fetchedAt: now / 1000, observation: null})).properties;
  assert.equal(p.hourly_temperature.series.start, Date.parse('2026-10-31T23:00:00Z') / 1000);
  assert.equal(p.temperature.numericValue.value, forecast.hours[24].temperatureC);
});

test('DST end keeps both repeated 02:00 hours at their distinct UTC positions', () => {
  const start = Date.parse('2026-10-24T22:00:00Z') / 1000;
  const now = Date.parse('2026-10-25T01:15:00Z'); // second local 02:15, CET.
  const forecast = {hours: hours(start)};
  const p = buildInstance(options({now, forecast, fetchedAt: now / 1000, observation: null})).properties;
  assert.equal(p.utc_offset.numericValue.value, 60);
  assert.equal(p.hourly_temperature.series.start, start);
  assert.equal(p.temperature.numericValue.value, forecast.hours[3].temperatureC);
  assert.equal(p.hourly_temperature.series.numericValue.values[2], forecast.hours[2].temperatureC);
  assert.equal(p.hourly_temperature.series.numericValue.values[3], forecast.hours[3].temperatureC);
});

test('Icons are only generated on request and their palette/pixel data match Pebble 4-bpp dimensions', () => {
  assert.equal(buildInstance(options()).properties.condition.image, undefined);
  const p = buildInstance(options({request: {properties: ['condition', 'hourly_condition', 'daily_condition'], iconPixelSize: {w: 25, h: 21}}})).properties;
  for (const shape of [p.condition.icon, p.condition.image, p.hourly_condition.series.image.values[8], p.daily_condition.series.image.values[0]]) {
    assert.equal(shape.width, 21);
    assert.equal(shape.height, 21);
    const bytes = Buffer.from(shape.pixels, 'base64');
    const palette = Buffer.from(shape.palette, 'base64');
    assert.equal(bytes.length, Math.ceil(21 / 2) * 21);
    assert.ok(palette.length >= 2 && palette.length <= 3);
    for (const b of bytes) { assert.ok((b >> 4) < palette.length && (b & 15) < palette.length); }
  }
  const limited = buildInstance(options({request: {properties: ['temperature'], iconPixelSize: {w: 32, h: 32}}})).properties;
  assert.equal(limited.condition.icon, undefined);
  assert.equal(limited.hourly_condition.series.image, undefined);
});

test('Rain amount is not a probability, while calculated feels-like requires all actual input fields', () => {
  const p = buildInstance(options()).properties;
  assert.equal(p.precipitation, undefined);
  assert.equal(p.daily_precipitation, undefined);
  assert.equal(p.hourly_precipitation, undefined);
  assert.equal(p.uv_index, undefined);
  assert.ok(Math.abs(p.feels_like.numericValue.value - 3.4357426491198577) < 1e-10);
  assert.equal(p.feels_like.shortText.text, '~3°C');
  assert.equal(p.feels_like_source.longText.text, 'Calculated shade estimate; station temperature, ALADIN humidity and ALADIN wind');
  assert.equal(p.humidity.numericValue.value, 84);
  assert.equal(p.wind_speed.numericValue.value, 10.8);
  for (const field of ['humidity', 'windSpeed']) {
    const data = hours();
    data[8][field] = null;
    const missing = buildInstance(options({forecast: {hours: data}})).properties;
    assert.equal(missing.feels_like, undefined);
    assert.equal(missing.feels_like_source, undefined);
  }
});

test('Seven-day completion preserves CHMI current temperature and complete daily extrema before extending with same-date Open-Meteo', () => {
  const baseline = buildInstance(options()).properties;
  const p = buildInstance(withSupplement()).properties;
  assert.equal(p.temperature.numericValue.value, 6.8);
  assert.equal(p.source.longText.text, 'ČHMÚ station measurement');
  assert.equal(p.is_forecast.boolean.value, false);
  assert.equal(p.feels_like.numericValue.value, baseline.feels_like.numericValue.value);
  assert.deepEqual(p.hourly_temperature.series.numericValue.values, baseline.hourly_temperature.series.numericValue.values);
  assert.equal(p.daily_high.series.numericValue.values.length, 7);
  assert.deepEqual(p.daily_high.series.numericValue.values.slice(0, 3), baseline.daily_high.series.numericValue.values);
  assert.deepEqual(p.daily_low.series.numericValue.values.slice(0, 3), baseline.daily_low.series.numericValue.values);
  assert.deepEqual(p.daily_high.series.numericValue.values.slice(3), [28, 29, 30, 31]);
  assert.deepEqual(p.daily_source.series.longText.values,
    ['ČHMÚ ALADIN', 'ČHMÚ ALADIN', 'ČHMÚ ALADIN', 'Open-Meteo', 'Open-Meteo', 'Open-Meteo', 'Open-Meteo']);
  assert.deepEqual(p.daily_condition_code.series.longText.values.slice(3), ['sun', 'sun', 'sun', 'sun']);
  assert.equal(p.daily_sunrise.series.timestamp.values.length, 7);
  assert.equal(p.daily_sunset.series.timestamp.values.length, 7);
  assert.match(p.supplemental_source.longText.text, /Open-Meteo.*probability.*extended/);
  assert.match(p.supplemental_source.longText.text, /UV/);
  assert.equal(p.supplemental_updated_at.timestamp.value, NOW / 1000);
});

test('An incomplete ALADIN tomorrow uses the matching Open-Meteo day without shifting or mislabeling the following complete day', () => {
  const data = hours().filter(hour => hour.time !== START + 30 * 3600);
  const settings = withSupplement({forecast: {hours: data}});
  const p = buildInstance(settings).properties;
  assert.equal(p.daily_high.series.numericValue.values[1], 26);
  assert.equal(p.daily_high.series.numericValue.values[2], 11);
  assert.deepEqual(p.daily_source.series.longText.values.slice(0, 3), ['ČHMÚ ALADIN', 'Open-Meteo', 'ČHMÚ ALADIN']);
  assert.equal(p.hourly_temperature.series.numericValue.values[30], 25);
  settings.supplemental.days = settings.supplemental.days.filter(day => day.date !== '2026-11-01');
  const gap = buildInstance(settings).properties;
  assert.equal(gap.daily_high.series.numericValue.values.length, 1,
    'Later dates cannot be shifted into a missing tomorrow even when hourly gaps were filled');
});

test('Current and hourly fields merge independently: CHMI temperature wins even when condition is missing', () => {
  const data = hours();
  data[8].conditionCode = 'invalid';
  data[8].humidity = null;
  const p = buildInstance(withSupplement({observation: null, forecast: {hours: data}})).properties;
  assert.equal(p.temperature.numericValue.value, 5);
  assert.equal(p.temperature.shortText.text, '~5°C');
  assert.equal(p.source.longText.text, 'ČHMÚ ALADIN forecast');
  assert.equal(p.condition_code.longText.text, 'sun');
  assert.equal(p.humidity.numericValue.value, 50);
  assert.equal(p.wind_speed.numericValue.value, 10.8);
  assert.equal(p.hourly_temperature.series.numericValue.values[8], 5);
  assert.equal(p.hourly_condition_code.series.longText.values[8], 'sun');
  assert.equal(p.feels_like.numericValue.value, apparentTemperature(5, 50, 3));
  assert.equal(p.feels_like_source.longText.text, 'Calculated shade estimate; ALADIN temperature, Open-Meteo humidity and ALADIN wind');
});

test('An actual parsed CHMI null-hour gap uses both the supplemental temperature and its known condition', () => {
  const data = hours();
  data[8].temperatureC = null;
  data[8].conditionCode = 'unknown';
  const p = buildInstance(withSupplement({observation: null, forecast: {hours: data}})).properties;
  assert.equal(p.temperature.numericValue.value, 25);
  assert.equal(p.source.longText.text, 'Open-Meteo forecast');
  assert.equal(p.condition_code.longText.text, 'sun');
  assert.equal(p.hourly_temperature.series.numericValue.values[8], 25);
  assert.equal(p.hourly_condition_code.series.longText.values[8], 'sun');
  assert.ok(p.supplemental_source.longText.text.includes('Open-Meteo'));
});

test('An unknown CHMI condition does not replace valid CHMI temperature or block a known supplemental condition', () => {
  const data = hours();
  data[8].conditionCode = 'unknown';
  const p = buildInstance(withSupplement({observation: null, forecast: {hours: data}})).properties;
  assert.equal(p.temperature.numericValue.value, 5);
  assert.equal(p.temperature.shortText.text, '~5°C');
  assert.equal(p.source.longText.text, 'ČHMÚ ALADIN forecast');
  assert.equal(p.condition_code.longText.text, 'sun');
  assert.equal(p.hourly_temperature.series.numericValue.values[8], 5);
  assert.equal(p.hourly_condition_code.series.longText.values[8], 'sun');
});

test('When neither forecast knows the condition it remains unknown rather than inventing clear skies', () => {
  const data = hours();
  data[8].conditionCode = 'unknown';
  const settings = withSupplement({observation: null, forecast: {hours: data}});
  settings.supplemental.hours[8].conditionCode = 'unknown';
  const p = buildInstance(settings).properties;
  assert.equal(p.temperature.numericValue.value, 5);
  assert.equal(p.source.longText.text, 'ČHMÚ ALADIN forecast');
  assert.equal(p.condition_code.longText.text, 'unknown');
  assert.equal(p.hourly_condition_code.series.longText.values[8], 'unknown');
});

test('Missing or expired CHMI forecasts can use fresh Open-Meteo without replacing a fresh station measurement', () => {
  const p = buildInstance(withSupplement({observation: null, forecast: null})).properties;
  assert.equal(p.temperature.numericValue.value, 25);
  assert.equal(p.temperature.shortText.text, '~25°C');
  assert.equal(p.source.longText.text, 'Open-Meteo forecast');
  assert.equal(p.is_forecast.boolean.value, true);
  assert.equal(p.forecast_updated_at.timestamp.value, NOW / 1000);
  assert.equal(p.feels_like.numericValue.value, apparentTemperature(25, 50, 5));
  const measured = buildInstance(withSupplement({fetchedAt: NOW / 1000 - 6 * 3600 - 1})).properties;
  assert.equal(measured.temperature.numericValue.value, 6.8);
  assert.equal(measured.source.longText.text, 'ČHMÚ station measurement');
  assert.equal(measured.forecast_updated_at, undefined);
  assert.equal(measured.feels_like.numericValue.value, apparentTemperature(6.8, 50, 5));
  assert.equal(measured.feels_like_source.longText.text, 'Calculated shade estimate; station temperature, Open-Meteo humidity and Open-Meteo wind');
});

test('Fahrenheit feels-like is calculated from Celsius inputs and converted exactly once', () => {
  const c = buildInstance(withSupplement()).properties.feels_like.numericValue.value;
  const f = buildInstance(withSupplement({units: {temperature: '°F', wind: 'mph'}})).properties;
  assert.equal(f.feels_like.numericValue.unit, '°F');
  assert.equal(f.feels_like.numericValue.value, c * 9 / 5 + 32);
  assert.equal(f.feels_like.shortText.text, '~38°F');
});

test('Daily peak UV and precipitation probability preserve zero and null slots without borrowing rain amounts', () => {
  const settings = withSupplement();
  settings.supplemental.days[0].uvIndex = 0;
  settings.supplemental.days[0].precipitationProbability = 0;
  settings.supplemental.days[1].precipitationProbability = null;
  settings.supplemental.hours[8].precipitationProbability = 0;
  settings.supplemental.hours[9].precipitationProbability = null;
  settings.supplemental.hours[9].precipitation = 100;
  const p = buildInstance(settings).properties;
  assert.equal(p.uv_index.numericValue.value, 0);
  assert.equal(p.precipitation.numericValue.value, 0);
  assert.equal(p.precipitation.numericValue.unit, '%');
  assert.deepEqual(p.daily_precipitation.series.numericValue.values.slice(0, 3), [0, null, 22]);
  assert.equal(p.daily_precipitation.series.numericValue.values.length, p.daily_high.series.numericValue.values.length);
  assert.equal(p.hourly_precipitation.series.numericValue.values[8], 0);
  assert.equal(p.hourly_precipitation.series.numericValue.values[9], null);
  assert.equal(p.hourly_precipitation.series.numericValue.values[10], 20);
});

test('UV and probability follow the current Prague date across midnight, regardless of supplied day array order', () => {
  const now = Date.parse('2026-10-31T23:05:00Z'); // Prague November 1.
  const settings = withSupplement({now, observation: null, fetchedAt: now / 1000, supplementalFetchedAt: now / 1000});
  settings.supplemental.days.reverse();
  settings.supplemental.days.find(day => day.date === '2026-10-31').uvIndex = 15;
  settings.supplemental.days.find(day => day.date === '2026-11-01').uvIndex = 0;
  const p = buildInstance(settings).properties;
  assert.equal(p.uv_index.numericValue.value, 0);
  assert.equal(p.precipitation.numericValue.value, 21);
  settings.supplemental.days = settings.supplemental.days.filter(day => day.date !== '2026-11-01');
  const missingToday = buildInstance(settings).properties;
  assert.equal(missingToday.uv_index, undefined);
  assert.equal(missingToday.precipitation, undefined);
  assert.equal(missingToday.daily_precipitation.series.numericValue.values[0], null);
});

test('Supplement lifetime is independent, includes six hours, and rejects stale, future or wrong-zone input', () => {
  const boundary = buildInstance(withSupplement({supplementalFetchedAt: NOW / 1000 - 6 * 3600})).properties;
  assert.equal(boundary.daily_high.series.numericValue.values.length, 7);
  for (const fetched of [NOW / 1000 - 6 * 3600 - 1, NOW / 1000 + 301, null]) {
    const p = buildInstance(withSupplement({supplementalFetchedAt: fetched})).properties;
    assert.equal(p.daily_high.series.numericValue.values.length, 3);
    assert.equal(p.supplemental_source, undefined);
    assert.equal(p.supplemental_updated_at, undefined);
    assert.equal(p.uv_index, undefined);
    assert.equal(p.precipitation, undefined);
    assert.equal(p.daily_precipitation, undefined);
    assert.equal(p.hourly_precipitation, undefined);
    assert.equal(buildInstance(withSupplement({forecast: null, observation: null, supplementalFetchedAt: fetched})), null);
  }
  const wrongZone = supplement();
  wrongZone.timezone = 'UTC';
  assert.equal(buildInstance(withSupplement({supplemental: wrongZone})).properties.supplemental_source, undefined);
});

test('A downloaded supplement that contributes no emitted fields has no source or freshness claim', () => {
  const extra = supplement();
  extra.hours = [];
  extra.days = extra.days.slice(0, 3).map(day => ({date: day.date, highC: 80, lowC: 70, conditionCode: 'sun'}));
  const p = buildInstance(withSupplement({supplemental: extra})).properties;
  assert.equal(p.daily_high.series.numericValue.values.length, 3);
  assert.equal(p.supplemental_source, undefined);
  assert.equal(p.supplemental_updated_at, undefined);
  assert.deepEqual(p.daily_source.series.longText.values, ['ČHMÚ ALADIN', 'ČHMÚ ALADIN', 'ČHMÚ ALADIN']);
});

test('Invalid coordinates or missing current data produce no instance', () => {
  assert.equal(buildInstance(options({place: Object.assign({}, PLACE, {latitude: NaN})})), null);
  assert.equal(buildInstance(options({place: Object.assign({}, PLACE, {longitude: 181})})), null);
  assert.equal(buildInstance(options({place: Object.assign({}, PLACE, {id: ''})})), null);
  assert.equal(buildInstance(options({observation: null, forecast: {hours: []}})), null);
});
