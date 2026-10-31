const assert = require('node:assert/strict');
const {test} = require('node:test');
const weather = require('../src/lib/weather');
const NOW = Date.parse('2026-10-31T08:00:00Z');
const HOUR = 3600;

function observation(points) { return {dataPoints: points}; }
function measured(timestamp, T, other = {}) { return {timestamp, values: {T, ...other}}; }
function bulk(rows, header = ['STATION', 'ELEMENT', 'DT', 'VAL', 'FLAG', 'QUALITY']) {
  return {data: {data: {header, values: rows}}};
}
function iso(seconds) { return new Date(seconds * 1000).toISOString(); }
function forecast(overrides = {}) {
  const start = Date.parse('2026-10-31T00:00:00Z') / 1000;
  return {
    parameters: {t2m: {unit: '°C'}, windSpeed: {unit: 'm/s'}}, z: 387,
    data: Array.from({length: 73}, (_, i) => ({
      validityTime: iso(start + i * HOUR).replace('Z', '+00:00'),
      t2m: 5 + i / 10, rh2m: 90, prec: 0, windSpeed: 2.1,
      windDirection: 302, icon: 140, cloudsTot: 33, ...overrides
    }))
  };
}

test('The 07:40 observed temperature 6.8°C is retained, not replaced with a modeled 5°C or rounded early', () => {
  const input = observation([measured('2026-10-31T07:40:00Z', '6.8', {TPM: '5.0', T05: '9.4'})]);
  const actual = weather.parseObservation(input, NOW);
  assert.deepEqual(actual, {temperatureC: 6.8, observedAt: Date.parse('2026-10-31T07:40:00Z') / 1000});
  assert.equal(Math.round(actual.temperatureC), 7);
  assert.equal(weather.parseForecast(forecast(), NOW).hours[0].temperatureC, 5);
});

test('Observation chooses the newest valid numeric T regardless of input order or newest null reading', () => {
  const input = observation([
    measured('2026-10-31T07:50:00+00:00', null),
    measured('2026-10-31T07:30:00Z', 6.2),
    measured('2026-10-31T07:40:00Z', '6.8'),
    measured('2026-10-31T07:20:00Z', 5.7)
  ]);
  assert.equal(weather.parseObservation(input, NOW).temperatureC, 6.8);
});

test('Observation honors the one-hour default and a configured age limit at their boundaries', () => {
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:00:00Z', '0')]), NOW).temperatureC, 0);
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T06:59:59Z', 6)]), NOW), null);
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:50:00Z', 6)]), NOW, 600).temperatureC, 6);
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:49:59Z', 6)]), NOW, 600), null);
});

test('Observation tolerates at most five minutes of clock skew', () => {
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T08:05:00Z', 6)]), NOW).temperatureC, 6);
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T08:05:01Z', 6)]), NOW), null);
});

test('Observation rejects absent or nonnumeric T without coercing null, whitespace or booleans to zero', () => {
  for (const value of [null, undefined, '', ' ', true, false, [], {}, NaN, Infinity, 'NaN', 'Infinity', '0x10', '6,8', -101, 101, '-101']) {
    assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:40:00Z', value)]), NOW), null, String(value));
  }
  assert.equal(weather.parseObservation(observation([{timestamp: '2026-10-31T07:40:00Z', values: {TPM: '6.8'}}]), NOW), null);
});

test('Observation handles signed decimal strings and finite negative temperatures without changing precision', () => {
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:40:00Z', '-6.85')]), NOW).temperatureC, -6.85);
  assert.equal(weather.parseObservation(observation([measured('2026-10-31T07:40:00Z', '+6.8')]), NOW).temperatureC, 6.8);
});

test('Observation timestamps must be explicit, possible UTC dates', () => {
  for (const timestamp of ['2026-10-31T07:40:00', '2026-10-31 07:40:00', '2026-10-31T07:40:00+01:00',
    '2026-02-30T07:40:00Z', '2026-10-31T24:00:00Z', '2026-13-31T07:40:00Z', 'today', null, NOW]) {
    assert.equal(weather.parseObservation(observation([measured(timestamp, '6.8')]), NOW), null, String(timestamp));
  }
});

test('Malformed observation inputs and invalid clock/age parameters return null', () => {
  for (const input of [null, {}, [], {dataPoints: null}, {dataPoints: {}}, {dataPoints: [null, {}, {values: {}}]}]) {
    assert.equal(weather.parseObservation(input, NOW), null);
  }
  const valid = observation([measured('2026-10-31T07:40:00Z', 6.8)]);
  for (const clock of [null, 'now', NaN, Infinity, 0, -1]) assert.equal(weather.parseObservation(valid, clock), null);
  for (const age of [-1, null, NaN, Infinity, '3600']) assert.equal(weather.parseObservation(valid, NOW, age), null);
  assert.equal(weather.parseObservation(observation(Array(25001).fill(null)), NOW), null);
});

test('Official daily bulk files retain measured T and its UTC observation time independently of the graph', () => {
  const input = bulk([
    ['0-20000-0-11546', 'TPM', '2026-10-31T07:50:00Z', 5, '', 0],
    ['0-20000-0-11546', 'T', '2026-10-31T07:40:00Z', 6.8, '', 5],
    ['0-20000-0-11546', 'T', '2026-10-31T07:50:00Z', null, '', 4]
  ]);
  assert.deepEqual(weather.parseObservation(input, NOW), {
    temperatureC: 6.8, observedAt: Date.parse('2026-10-31T07:40:00Z') / 1000, quality: 'unknown'
  });
});

test('Bulk quality metadata accepts good and operative unknown values but rejects suspect, poor, estimated and missing', () => {
  for (const quality of [1, 2, 3, 4, 6, null, '', true, 'bad']) {
    assert.equal(weather.parseObservation(bulk([
      ['station', 'T', '2026-10-31T07:40:00Z', 6.8, '', quality]
    ]), NOW), null, 'QUALITY=' + quality);
  }
  for (const quality of [0, '0', 5, '5.0']) {
    const actual = weather.parseObservation(bulk([
      ['station', 'T', '2026-10-31T07:40:00Z', '6.8', '', quality]
    ]), NOW);
    assert.equal(actual.temperatureC, 6.8);
    assert.equal(actual.quality, Number(quality) === 0 ? 'good' : 'unknown');
  }
});

test('Bulk headers are resolved by name, and mixed-station or unexplained-flag files are not used', () => {
  const header = ['VAL', 'DT', 'QUALITY', 'ELEMENT', 'STATION', 'FLAG'];
  assert.equal(weather.parseObservation(bulk([[6.8, '2026-10-31T07:40:00Z', 0, 'T', 'station', '']], header), NOW).temperatureC, 6.8);
  assert.equal(weather.parseObservation(bulk([
    ['station', 'T', '2026-10-31T07:40:00Z', 6.8, 'unexplained', 0]
  ]), NOW), null);
  assert.equal(weather.parseObservation(bulk([
    ['station-a', 'T', '2026-10-31T07:40:00Z', 6.8, '', 0],
    ['station-b', 'T', '2026-10-31T07:50:00Z', 10, '', 0]
  ]), NOW), null);
});

test('Bulk data obeys the same age, numeric and strict UTC validation as the live graph', () => {
  for (const [time, value] of [
    ['2026-10-31T06:50:00Z', 6.8], ['2026-10-31T08:10:00Z', 6.8],
    ['2026-10-31T07:40:00', 6.8], ['2026-10-31T07:40:00Z', null],
    ['2026-10-31T07:40:00Z', false], ['2026-10-31T07:40:00Z', '']
  ]) assert.equal(weather.parseObservation(bulk([['station', 'T', time, value, '', 0]]), NOW), null);
});

test('Malformed and oversized bulk data is rejected safely', () => {
  for (const input of [
    {data: null}, {data: {data: null}}, bulk([], []), bulk([], ['STATION', 'ELEMENT', 'DT', 'VAL']),
    {data: {data: {header: ['STATION'], values: {}}}}, bulk([null, [], {}, ['station']]),
    bulk(Array(25001).fill(null))
  ]) assert.equal(weather.parseObservation(input, NOW), null);
});

test('Captured official graph and forecast fixtures parse without replacing observation with model data', () => {
  const observationFixture = require('../tests/fixtures/station-C2CBUD01.json');
  const bulkFixture = require('../tests/fixtures/station-bulk-11546.json');
  const forecastFixture = require('../tests/fixtures/forecast-75.json');
  const observationNow = Date.parse(observationFixture._fixture.capturedAt);
  const forecastNow = Date.parse(forecastFixture._fixture.capturedAt);
  const actual = weather.parseObservation(observationFixture, observationNow);
  assert.ok(actual);
  assert.equal(actual.temperatureC, 6.8);
  assert.equal(Math.round(actual.temperatureC), 7);
  const backup = weather.parseObservation(bulkFixture, Date.parse(bulkFixture._fixture.capturedAt));
  assert.equal(backup.temperatureC, actual.temperatureC);
  assert.equal(backup.quality, 'unknown');
  assert.equal(backup.observedAt, Date.parse('2026-10-31T07:50:00Z') / 1000);
  const model = weather.parseForecast(forecastFixture, forecastNow);
  assert.ok(model);
  assert.equal(model.hours.length, 8);
  assert.equal(model.elevation, 387);
});

test('Forecast parses the official hourly schema, native Celsius and m/s, without an invented generation time', () => {
  const actual = weather.parseForecast(forecast(), NOW);
  assert.equal(actual.hours.length, 73);
  assert.equal(actual.elevation, 387);
  assert.equal(actual.generatedAt, undefined);
  assert.deepEqual(actual.hours[0], {
    time: Date.parse('2026-10-31T00:00:00Z') / 1000,
    temperatureC: 5, conditionCode: 'partly_cloudy', humidity: 90,
    windSpeed: 2.1, windDirection: 302, precipitation: 0, cloudsTotal: 33, icon: 140
  });
});

test('Forecast null temperatures remain at their original hour; later values never shift into missing slots', () => {
  const input = forecast();
  input.data[9].t2m = null;
  input.data[11].t2m = 'bad';
  const actual = weather.parseForecast(input, NOW);
  assert.equal(actual.hours[9].temperatureC, null);
  assert.equal(actual.hours[10].temperatureC, 6);
  assert.equal(actual.hours[11].temperatureC, null);
  assert.equal(actual.hours[10].time - actual.hours[9].time, HOUR);
});

test('Missing forecast timestamp rows become explicit empty hours rather than compressing the timeline', () => {
  const input = forecast();
  input.data.splice(9, 1);
  const actual = weather.parseForecast(input, NOW);
  assert.equal(actual.hours.length, 73);
  assert.equal(actual.hours[9].temperatureC, null);
  assert.equal(actual.hours[9].conditionCode, 'unknown');
  assert.equal(actual.hours[10].temperatureC, 6);
});

test('Forecast optional invalid values remain null, not zero or misleading units', () => {
  const actual = weather.parseForecast(forecast({rh2m: 101, prec: -1, windSpeed: false,
    windDirection: 361, cloudsTot: null, icon: 1.5}), NOW).hours[0];
  assert.equal(actual.humidity, null);
  assert.equal(actual.precipitation, null);
  assert.equal(actual.windSpeed, null);
  assert.equal(actual.windDirection, null);
  assert.equal(actual.cloudsTotal, null);
  assert.equal(actual.icon, null);
  assert.equal(actual.conditionCode, 'unknown');
});

test('Forecast rejects duplicate, reversed, unknown, non-UTC or non-hourly timestamps', () => {
  for (const makeBad of [
    data => {data[1].validityTime = data[0].validityTime;},
    data => {const x = data[1]; data[1] = data[2]; data[2] = x;},
    data => {data[1].validityTime = 'bad';},
    data => {data[1].validityTime = '2026-10-31T01:00:00';},
    data => {data[1].validityTime = '2026-10-31T01:00:00+01:00';},
    data => {data[1].validityTime = '2026-10-31T01:01:00Z';},
    data => {data[1].validityTime = '2026-10-31T01:00:00.500Z';},
    data => {data[1] = null;}
  ]) {
    const input = forecast(); makeBad(input.data);
    assert.equal(weather.parseForecast(input, NOW), null);
  }
});

test('Forecast cannot claim a stale series, an oversized span, or an entirely missing temperature series', () => {
  assert.equal(weather.parseForecast(forecast(), NOW + 5 * 86400000), null);
  assert.equal(weather.parseForecast(forecast({t2m: null}), NOW), null);
  const tooLong = forecast();
  tooLong.data.push({...tooLong.data[72], validityTime: '2026-11-03T01:00:00Z'});
  assert.equal(weather.parseForecast(tooLong, NOW), null);
  const gapTooWide = forecast();
  gapTooWide.data = [gapTooWide.data[0], {...gapTooWide.data[1], validityTime: '2026-11-04T00:00:00Z'}];
  assert.equal(weather.parseForecast(gapTooWide, NOW), null);
});

test('Malformed forecast roots and invalid clocks return null', () => {
  for (const input of [null, {}, {data: []}, {data: {}}, {data: [null]}]) assert.equal(weather.parseForecast(input, NOW), null);
  for (const clock of [null, undefined, 'now', NaN, Infinity, 0, -1]) assert.equal(weather.parseForecast(forecast(), clock), null);
  for (const unit of ['K', '°F', null]) {
    const input = forecast(); input.parameters.t2m.unit = unit;
    assert.equal(weather.parseForecast(input, NOW), null);
  }
});

test('Unknown icons retain the quantitative weather fallback without guessing their meaning', () => {
  const cases = [
    [{prec: 0, cloudsTot: 10, icon: 99999}, 'sun'],
    [{prec: 0, cloudsTot: 50}, 'partly_cloudy'],
    [{prec: 0, cloudsTot: 90}, 'cloudy'],
    [{prec: 0.3, t2m: 8}, 'light_rain'],
    [{prec: 6, t2m: 8}, 'heavy_rain'],
    [{prec: 0.3, t2m: -3}, 'light_snow'],
    [{prec: 3, t2m: -3}, 'heavy_snow'],
    [{prec: 0.3, t2m: 1}, 'rain_and_snow'],
    [{prec: null, cloudsTot: 10}, 'unknown'],
    [{prec: 0, cloudsTot: null}, 'unknown']
  ];
  for (const [values, expected] of cases) assert.equal(weather.parseForecast(forecast({icon:null, ...values}), NOW).hours[0].conditionCode, expected);
});

test('Official ČHMÚ rain and snow icons remain authoritative even when rounded precipitation is zero', () => {
  for (const icon of [41,61,62,71,72,81,82,91,92,141,161,162,171,172]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:10,t2m:-5}), NOW).hours[0].conditionCode,'light_rain','rain icon '+icon);
  }
  for (const icon of [45,64,65,74,75,84,85,94,145,164,165,174,175]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:10,t2m:8}), NOW).hours[0].conditionCode,'light_snow','snow icon '+icon);
  }
  for (const icon of [43,63,73,83,93,143,163,173]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:10,t2m:8}), NOW).hours[0].conditionCode,'rain_and_snow','mixed icon '+icon);
  }
});

test('Official clear and cloud symbols take precedence over disagreeing model quantities', () => {
  for (const icon of [10,20,110,120]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:6,cloudsTot:100}), NOW).hours[0].conditionCode,'sun');
  }
  for (const icon of [40,140]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:6,cloudsTot:100}), NOW).hours[0].conditionCode,'partly_cloudy');
  }
  for (const icon of [60,70,80,90,160,170]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:0}), NOW).hours[0].conditionCode,'cloudy');
  }
});

test('Forecast precipitation determines the heavy variant of a known rain or snow symbol', () => {
  assert.equal(weather.parseForecast(forecast({icon:61,prec:5}), NOW).hours[0].conditionCode,'heavy_rain');
  assert.equal(weather.parseForecast(forecast({icon:65,prec:2}), NOW).hours[0].conditionCode,'heavy_snow');
  assert.equal(weather.parseForecast(forecast({icon:61,prec:null}), NOW).hours[0].conditionCode,'light_rain');
  assert.equal(weather.parseForecast(forecast({icon:65,prec:null}), NOW).hours[0].conditionCode,'light_snow');
});

test('Malformed, unlisted and non-weather icon IDs use fallback values rather than undocumented normalization', () => {
  for (const icon of [null,false,true,{},[],NaN,Infinity,41.5,-41,180,203,310,99999]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:10}), NOW).hours[0].conditionCode,'sun',String(icon));
    assert.equal(weather.parseForecast(forecast({icon,prec:null,cloudsTot:null}), NOW).hours[0].conditionCode,'unknown',String(icon));
  }
  // Thunder and hail have no equivalent in Pebble's shared vocabulary.
  for (const icon of [46,66,69,76,79,86,89,146,166,169,176,179]) {
    assert.equal(weather.parseForecast(forecast({icon,prec:6,t2m:8}), NOW).hours[0].conditionCode,'heavy_rain');
    assert.equal(weather.parseForecast(forecast({icon,prec:0,cloudsTot:10}), NOW).hours[0].conditionCode,'unknown');
    assert.equal(weather.parseForecast(forecast({icon,prec:null,cloudsTot:10}), NOW).hours[0].conditionCode,'unknown');
  }
});

test('Nearest chooses by great-circle distance and returns the original point without mutating it', () => {
  const far = Object.freeze({id: 'far', latitude: 49.1, longitude: 15.0});
  const close = Object.freeze({id: 'close', latitude: 48.98, longitude: 14.48});
  const catalog = Object.freeze([far, close]);
  const result = weather.nearest(catalog, 48.97, 14.47, 30);
  assert.equal(result.point, close);
  assert.ok(result.distanceKm > 1 && result.distanceKm < 2);
  assert.equal(weather.nearest(catalog, 48.97, 14.47, 1), null);
});

test('Haversine handles zero coordinates, opposite meridians, antipodes and exact radius boundaries', () => {
  assert.equal(weather.distanceKm(0, 0, 0, 0), 0);
  assert.ok(Math.abs(weather.distanceKm(0, 0, 0, 1) - 111.195) < 0.01);
  assert.ok(weather.distanceKm(0, 179.9, 0, -179.9) < 23);
  assert.ok(weather.distanceKm(90, 0, -90, 180) > 20000);
  const point = {latitude: 0, longitude: 1};
  const radius = weather.distanceKm(0, 0, 0, 1);
  assert.equal(weather.nearest([point], 0, 0, radius).point, point);
  assert.equal(weather.nearest([{latitude: 0, longitude: 0}], 0, 0, 0).distanceKm, 0);
});

test('Nearest validates coordinate and radius bounds and ignores malformed catalogue entries', () => {
  const point = {latitude: 48.98, longitude: 14.48};
  for (const [lat, lon] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity], ['49', 14]]) {
    assert.equal(weather.nearest([point], lat, lon, 30), null);
  }
  for (const radius of [-1, NaN, '30', null]) assert.equal(weather.nearest([point], 49, 14, radius), null);
  assert.equal(weather.nearest(null, 49, 14, 30), null);
  assert.equal(weather.nearest([], 49, 14, 30), null);
  assert.equal(weather.nearest([null, {}, {latitude: null, longitude: 0}, point], 48.98, 14.48, 30).point, point);
});
