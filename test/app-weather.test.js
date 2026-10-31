const assert = require('node:assert/strict');
const {test} = require('node:test');
const {parseWeather, conditionCode} = require('../src/lib/app-weather');
const fixture = require('../tests/fixtures/app-place.json');

const NOW = Date.parse('2026-10-31T10:00:00Z');
const POINT = {latitude: 48.975, longitude: 14.476};
const DAY = 86400000;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function row(date, category, value) { return {time_at: date, category, value}; }
function daily(date, high = 8.88, low = 4.7, dayIcon = 17, nightIcon = 17) {
  return [row(date, 'aladin_clstemperature', high), row(date, 'min_temperature', low),
    row(date, 'weather_icon_day', dayIcon), row(date, 'weather_icon_night', nightIcon)];
}
function response(rows = daily('2026-10-31')) {
  return {lat: 48.977, lng: 14.478, updated_at: '2026-10-31T09:00:00+01:00',
    forecast_weather_cumulative: rows};
}

test('Captured public app response retains the three full-day local Celsius ranges', () => {
  const actual = parseWeather(fixture, NOW, POINT);
  assert.deepEqual(actual, {
    days: [
      {date: '2026-10-31', highC: 8.88, lowC: 4.7, conditionCode: 'light_rain'},
      {date: '2026-11-01', highC: 8.24, lowC: 1.62, conditionCode: 'light_rain'},
      {date: '2026-11-02', highC: 5.75, lowC: 2.42, conditionCode: 'light_rain'}
    ],
    updatedAt: Date.parse('2026-10-31T06:20:20+01:00') / 1000,
    latitude: 48.977, longitude: 14.478
  });
  assert.notEqual(actual.updatedAt, NOW / 1000);
  assert.equal(actual.hours, undefined);
  assert.equal(actual.temperatureC, undefined);
});

test('App numeric icon IDs use the decompiled app mapping, not public SVG IDs', () => {
  const groups = {
    sun: [1, 2], partly_cloudy: [3], cloudy: [6, 16, 22, 30],
    light_rain: [4, 7, 8, 17, 18, 23, 24],
    light_snow: [5, 9, 12, 14, 15, 28, 29], rain_and_snow: [11, 20, 26, 31],
    unknown: [10, 13, 19, 21, 25, 27]
  };
  for (const [code, values] of Object.entries(groups)) {
    for (const value of values) assert.equal(conditionCode(value), code, String(value));
  }
  // The graph's 10.svg means sun; app10 means hail. App1 means sun.
  assert.equal(conditionCode(10), 'unknown');
  assert.equal(conditionCode(1), 'sun');
});

test('Unknown, null and malformed icons remain unknown instead of using the app UI partly-cloudy fallback', () => {
  for (const value of [null, undefined, '1', '17', false, true, [], {}, NaN, Infinity, 0, -1, 32, 140, 1.5]) {
    assert.equal(conditionCode(value), 'unknown', String(value));
  }
  const input = response(daily('2026-10-31', 8, 4, 140, 1));
  assert.equal(parseWeather(input, NOW, POINT).days[0].conditionCode, 'unknown');
});

test('Daily totals do not create heavy conditions or reinterpret unsupported thunder/hail', () => {
  for (const icon of [7, 13, 10, 28]) {
    const input = response([...daily('2026-10-31', 8, 4, icon),
      row('2026-10-31', 'aladin_surfprec_total', 100)]);
    const expected = icon === 7 ? 'light_rain' : icon === 28 ? 'light_snow' : 'unknown';
    assert.equal(parseWeather(input, NOW, POINT).days[0].conditionCode, expected);
  }
});

test('A single daily condition uses daytime independent of current clock; only an absent day category permits night fallback', () => {
  const input = response(daily('2026-10-31', 8, 4, 1, 7));
  input.updated_at = '2026-10-31T19:00:00Z';
  assert.equal(parseWeather(input, Date.parse('2026-10-31T20:00:00Z'), POINT).days[0].conditionCode, 'sun');
  input.updated_at = '2026-10-31T09:00:00+01:00';
  input.forecast_weather_cumulative = input.forecast_weather_cumulative.filter(item => item.category !== 'weather_icon_day');
  assert.equal(parseWeather(input, NOW, POINT).days[0].conditionCode, 'light_rain');
  input.forecast_weather_cumulative.push(row('2026-10-31', 'weather_icon_day', null));
  assert.equal(parseWeather(input, NOW, POINT).days[0].conditionCode, 'unknown');
  input.forecast_weather_cumulative = daily('2026-10-31').filter(item => !item.category.startsWith('weather_icon'));
  assert.equal(parseWeather(input, NOW, POINT).days[0].conditionCode, 'unknown');
});

test('Unordered dates are grouped by exact calendar key and missing dates do not shift later ranges', () => {
  const input = response([...daily('2026-11-02', 5.75, 2.42, 1), ...daily('2026-10-31')].reverse());
  const actual = parseWeather(input, NOW, POINT);
  assert.deepEqual(actual.days.map(item => item.date), ['2026-10-31', '2026-11-02']);
  assert.equal(actual.days[1].highC, 5.75);
  assert.equal(actual.days[1].conditionCode, 'sun');
});

test('Only today through the next two Prague dates are accepted, without national or longer-range inference', () => {
  const input = response([...daily('2026-10-30'), ...daily('2026-10-31'), ...daily('2026-11-02'),
    ...daily('2026-11-03'), ...daily('2026-11-07')]);
  assert.deepEqual(parseWeather(input, NOW, POINT).days.map(item => item.date), ['2026-10-31', '2026-11-02']);
  input.forecast_weather_cumulative = daily('2026-11-03');
  assert.equal(parseWeather(input, NOW, POINT), null);
});

test('Prague midnight and both DST seasons determine date keys independently of UTC calendar date', () => {
  const cases = [
    ['2026-07-01T22:30:00Z', '2026-07-02'],
    ['2026-12-01T23:30:00Z', '2026-12-02'],
    ['2026-03-28T23:30:00Z', '2026-03-29'],
    ['2026-10-24T22:30:00Z', '2026-10-25'],
    ['2026-10-25T23:30:00Z', '2026-10-26']
  ];
  for (const [clock, date] of cases) {
    const now = Date.parse(clock);
    const previous = new Date(Date.parse(date + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
    const input = response([...daily(previous), ...daily(date)]);
    input.updated_at = new Date(now - 3600000).toISOString();
    assert.deepEqual(parseWeather(input, now, POINT).days.map(item => item.date), [date], clock);
  }
});

test('Impossible, timestamp-shaped and non-string daily keys are ignored without damaging valid dates', () => {
  for (const date of ['2026-02-30', '2026-11-31', '2026-13-01', '2026-10-00', '2026-10-31T00:00:00Z',
    '2026-1-1', '', null, 20261031]) {
    const input = response([...daily(date), ...daily('2026-11-01')]);
    assert.deepEqual(parseWeather(input, NOW, POINT).days.map(item => item.date), ['2026-11-01'], String(date));
  }
});

test('Temperature values must be finite Celsius numbers and retain their original precision', () => {
  for (const value of [null, undefined, '', '8.88', '280K', '45°F', false, true, [], {}, NaN, Infinity, -101, 101]) {
    const input = response([...daily('2026-10-31', value), ...daily('2026-11-01')]);
    // Defaults in the test helper are intentionally bypassed for undefined.
    input.forecast_weather_cumulative[0].value = value;
    assert.deepEqual(parseWeather(input, NOW, POINT).days.map(item => item.date), ['2026-11-01'], String(value));
  }
  assert.deepEqual(parseWeather(response(daily('2026-10-31', 0, 0)), NOW, POINT).days[0],
    {date: '2026-10-31', highC: 0, lowC: 0, conditionCode: 'light_rain'});
  const extrema = parseWeather(response(daily('2026-10-31', 100, -100)), NOW, POINT).days[0];
  assert.equal(extrema.highC, 100);
  assert.equal(extrema.lowC, -100);
});

test('A reversed or incomplete range stays absent instead of borrowing top-level/current/hourly values', () => {
  for (const missingCategory of ['aladin_clstemperature', 'min_temperature']) {
    const input = response(daily('2026-10-31').filter(item => item.category !== missingCategory));
    input.max_temperature = 15;
    input.min_temperature = -5;
    input.current_weather = {weather_icon: 1, values: [row('2026-10-31T11:00:00+01:00', 'aladin_clstemperature', 6.79)]};
    input.forecast_weather = [{time_at: '2026-10-31', value: 20}];
    assert.equal(parseWeather(input, NOW, POINT), null);
  }
  assert.equal(parseWeather(response(daily('2026-10-31', 2, 3)), NOW, POINT), null);
  assert.equal(parseWeather(response(daily('2026-10-31', 8, null)), NOW, POINT), null);
});

test('Duplicate categories reject only the ambiguous date, including identical or malformed repeated values', () => {
  for (const [category, value] of [['aladin_clstemperature', 8.88], ['min_temperature', null],
    ['weather_icon_day', 1], ['weather_icon_night', 17]]) {
    const input = response([...daily('2026-10-31'), row('2026-10-31', category, value), ...daily('2026-11-01')]);
    assert.deepEqual(parseWeather(input, NOW, POINT).days.map(item => item.date), ['2026-11-01'], category);
  }
  const input = response([...daily('2026-10-31'), row('2026-10-31', 'aladin_clsvent_zonal', 1),
    row('2026-10-31', 'aladin_clsvent_zonal', 2)]);
  assert.equal(parseWeather(input, NOW, POINT), null);
});

test('Issue time is mandatory, offset-aware, and accepted up to six hours old or ten minutes ahead', () => {
  const input = response();
  for (const updated of ['2026-10-31T04:00:00Z', '2026-10-31T05:00:00+01:00', '2026-10-31T10:10:00Z']) {
    input.updated_at = updated;
    assert.equal(parseWeather(input, NOW, POINT).updatedAt, Math.floor(Date.parse(updated) / 1000));
  }
  for (const updated of ['2026-10-31T03:59:59Z', '2026-10-31T10:10:00.001Z']) {
    input.updated_at = updated;
    assert.equal(parseWeather(input, NOW, POINT), null, updated);
  }
  input.updated_at = '2026-10-31T09:00:00.123+01:00';
  assert.equal(parseWeather(input, NOW, POINT).updatedAt, Date.parse('2026-10-31T08:00:00Z') / 1000);
});

test('Malformed issue timestamps cannot be normalized or interpreted in the host timezone', () => {
  for (const updated of [null, undefined, NOW, '', 'today', '2026-10-31T09:00:00',
    '2026-10-31 09:00:00Z', '2026-10-31T24:00:00Z', '2026-10-31T09:60:00Z',
    '2026-10-31T09:00:60Z', '2026-02-30T09:00:00Z', '2026-10-31T09:00:00+14:01',
    '2026-10-31T09:00:00+15:00', '2026-10-31T09:00:00+01:60', '2026-10-31T09:00:00-00:00']) {
    const input = response();
    input.updated_at = updated;
    assert.equal(parseWeather(input, NOW, POINT), null, String(updated));
  }
});

test('Returned place coordinates must be valid numbers within thirty kilometres of the requested point', () => {
  const input = response();
  input.lat = POINT.latitude + 0.2;
  input.lng = POINT.longitude;
  assert.ok(parseWeather(input, NOW, POINT));
  input.lat = POINT.latitude + 0.3;
  assert.equal(parseWeather(input, NOW, POINT), null);
  for (const [key, value] of [['lat', null], ['lat', '48.977'], ['lat', false], ['lat', 91],
    ['lat', NaN], ['lng', 181], ['lng', Infinity]]) {
    const invalid = response();
    invalid[key] = value;
    assert.equal(parseWeather(invalid, NOW, POINT), null, key + '=' + value);
  }
  for (const point of [null, [], {}, {latitude: '48.975', longitude: 14.476},
    {latitude: 48.975, longitude: false}, {latitude: Infinity, longitude: 14.476}]) {
    assert.equal(parseWeather(response(), NOW, point), null);
  }
});

test('Malformed roots, invalid clocks, oversized arrays and all-invalid rows return null safely', () => {
  for (const raw of [null, [], {}, 'forecast', {forecast_weather_cumulative: {}},
    response([]), response([null, [], 'row', {}, {time_at: '2026-10-31'}]), response(Array(129).fill(null))]) {
    assert.equal(parseWeather(raw, NOW, POINT), null);
  }
  for (const now of [null, undefined, 'now', NaN, Infinity, 0, -1, 9e20, Date.parse('9999-01-01T00:00:00Z')]) {
    assert.equal(parseWeather(response(), now, POINT), null, String(now));
  }
});

test('Malformed unrelated records and absent humidity do not invalidate complete daily ranges or mutate input', () => {
  const input = response([...daily('2026-10-31'), null, [], 5, {},
    row('2026-10-31', '', 1), row('2026-10-31', 'x'.repeat(101), 1)]);
  const before = clone(input);
  const actual = parseWeather(input, NOW, POINT);
  assert.equal(actual.days[0].highC, 8.88);
  assert.equal(actual.days[0].humidity, undefined);
  assert.equal(actual.days[0].precipitationProbability, undefined);
  assert.deepEqual(input, before);
});
