const assert = require('node:assert/strict');
const {test} = require('node:test');
const parse = require('../src/lib/supplement').parseForecast;
const captured = require('../tests/fixtures/supplement.json');
const NOW = Date.parse(captured._fixture.capturedAt);
const HOUR = 3600;
const DAY = 24 * HOUR;
function fixture() { return JSON.parse(JSON.stringify(captured)); }
function removeRow(block, index) { for (const values of Object.values(block)) values.splice(index, 1); }

test('Captured supplemental data preserves the actual hourly units, PoP, UV and seven daily date keys', () => {
  const actual = parse(fixture(), NOW);
  assert.equal(actual.timezone, 'Europe/Prague');
  assert.equal(actual.hours.length, 8);
  assert.equal(actual.days.length, 7);
  assert.deepEqual(actual.hours[0], {
    time: captured.hourly.time[0], temperatureC: captured.hourly.temperature_2m[0],
    conditionCode: 'light_rain', humidity: captured.hourly.relative_humidity_2m[0],
    windSpeed: captured.hourly.wind_speed_10m[0], windDirection: captured.hourly.wind_direction_10m[0],
    precipitationProbability: captured.hourly.precipitation_probability[0], precipitation: captured.hourly.precipitation[0]
  });
  assert.equal(actual.days[0].date, '2026-10-31');
  assert.equal(actual.days[6].date, '2026-11-06');
  assert.equal(actual.days[0].uvIndex, captured.daily.uv_index_max[0]);
  assert.equal(actual.days[0].precipitationProbability, captured.daily.precipitation_probability_max[0]);
  assert.equal(actual.generatedAt, undefined);
});

test('Zero UV index, zero probability and zero precipitation remain real zero readings', () => {
  const input = fixture();
  input.hourly.precipitation_probability[0] = 0;
  input.hourly.precipitation[0] = 0;
  input.daily.uv_index_max[0] = 0;
  input.daily.precipitation_probability_max[0] = 0;
  const actual = parse(input, NOW);
  assert.equal(actual.hours[0].precipitationProbability, 0);
  assert.equal(actual.hours[0].precipitation, 0);
  assert.equal(actual.days[0].uvIndex, 0);
  assert.equal(actual.days[0].precipitationProbability, 0);
});

test('Null or nonnumeric metrics never turn into zero, and precipitation amount does not invent probability', () => {
  for (const value of [null, undefined, '', '0', true, false, NaN, Infinity]) {
    const input = fixture();
    input.hourly.temperature_2m[0] = value;
    input.hourly.relative_humidity_2m[0] = value;
    input.hourly.precipitation_probability[0] = value;
    input.hourly.precipitation[0] = 3;
    input.daily.uv_index_max[0] = value;
    input.daily.precipitation_probability_max[0] = value;
    const actual = parse(input, NOW);
    assert.equal(actual.hours[0].temperatureC, null);
    assert.equal(actual.hours[0].humidity, null);
    assert.equal(actual.hours[0].precipitationProbability, null);
    assert.equal(actual.hours[0].precipitation, 3);
    assert.equal(actual.days[0].uvIndex, null);
    assert.equal(actual.days[0].precipitationProbability, null);
  }
});

test('Invalid metric ranges become null while other model fields remain useful', () => {
  const input = fixture();
  input.hourly.temperature_2m[0] = 101;
  input.hourly.relative_humidity_2m[0] = -1;
  input.hourly.precipitation_probability[0] = 101;
  input.hourly.precipitation[0] = -1;
  input.hourly.wind_speed_10m[0] = -1;
  input.hourly.wind_direction_10m[0] = 361;
  input.daily.uv_index_max[0] = -1;
  input.daily.precipitation_probability_max[0] = 101;
  input.daily.temperature_2m_max[0] = 1;
  input.daily.temperature_2m_min[0] = 10;
  const actual = parse(input, NOW);
  for (const key of ['temperatureC', 'humidity', 'precipitationProbability', 'precipitation', 'windSpeed', 'windDirection']) {
    assert.equal(actual.hours[0][key], null, key);
  }
  for (const key of ['uvIndex', 'precipitationProbability', 'highC', 'lowC']) assert.equal(actual.days[0][key], null, key);
});

test('The explicit unit contract prevents Fahrenheit, km/h, inches or percentages in the wrong field', () => {
  for (const [block, key, badUnit] of [
    ['hourly_units', 'time', 'iso8601'], ['hourly_units', 'temperature_2m', '°F'],
    ['hourly_units', 'wind_speed_10m', 'km/h'], ['hourly_units', 'precipitation', 'inch'],
    ['hourly_units', 'precipitation_probability', 'mm'], ['daily_units', 'temperature_2m_max', 'K'],
    ['daily_units', 'uv_index_max', '%'], ['daily_units', 'precipitation_probability_max', 'mm']
  ]) {
    const input = fixture(); input[block][key] = badUnit;
    assert.equal(parse(input, NOW), null, block + '/' + key);
  }
});

test('Missing or mismatched arrays and oversized data are rejected instead of zipped to the wrong times', () => {
  for (const block of ['hourly', 'daily']) {
    for (const key of Object.keys(captured[block])) {
      const input = fixture(); input[block][key].pop();
      assert.equal(parse(input, NOW), null, block + '/' + key);
      const absent = fixture(); delete absent[block][key];
      assert.equal(parse(absent, NOW), null, 'missing ' + block + '/' + key);
    }
    const input = fixture();
    const count = block === 'hourly' ? 201 : 9;
    for (const key of Object.keys(input[block])) input[block][key] = Array(count).fill(input[block][key][0]);
    assert.equal(parse(input, NOW), null);
  }
});

test('Missing hourly rows preserve an explicit null hole and cannot shift later data earlier', () => {
  const input = fixture();
  const nextTime = input.hourly.time[3];
  const nextTemperature = input.hourly.temperature_2m[3];
  removeRow(input.hourly, 2);
  const actual = parse(input, NOW);
  assert.equal(actual.hours.length, 8);
  assert.equal(actual.hours[2].time, nextTime - HOUR);
  assert.equal(actual.hours[2].temperatureC, null);
  assert.equal(actual.hours[2].precipitationProbability, null);
  assert.equal(actual.hours[3].time, nextTime);
  assert.equal(actual.hours[3].temperatureC, nextTemperature);
});

test('A missing daily row retains its own empty date rather than relabelling tomorrow as today', () => {
  const input = fixture();
  removeRow(input.daily, 1);
  const actual = parse(input, NOW);
  assert.equal(actual.days.length, 7);
  assert.equal(actual.days[1].date, '2026-11-01');
  assert.equal(actual.days[1].highC, null);
  assert.equal(actual.days[1].uvIndex, null);
  assert.equal(actual.days[2].date, '2026-11-02');
  const future = fixture(); removeRow(future.daily, 0);
  assert.equal(parse(future, NOW).days[0].date, '2026-11-01');
});

test('Daily dates follow the response fixed offset across a DST transition, preserving Open-Meteo date keys', () => {
  const input = fixture();
  input.utc_offset_seconds = 7200;
  const start = Date.parse('2026-10-23T22:00:00Z') / 1000;
  input.daily.time = input.daily.time.map((_, i) => start + i * DAY);
  input.hourly.time = input.hourly.time.map((_, i) => start + (8 + i) * HOUR);
  const actual = parse(input, Date.parse('2026-10-24T08:00:00Z'));
  assert.equal(actual.days[0].date, '2026-10-24');
  assert.equal(actual.days[2].date, '2026-10-26');
  assert.equal(actual.days[6].date, '2026-10-30');
});

test('Timestamps must be finite epoch seconds on the expected grid, ordered and within the forecast window', () => {
  for (const value of [null, '1793401200', NaN, Infinity, -1, NOW, captured.hourly.time[0] + 0.5,
    Math.floor(NOW / 1000) + 20 * DAY]) {
    const input = fixture(); input.hourly.time[0] = value;
    assert.equal(parse(input, NOW), null, String(value));
  }
  for (const block of ['hourly', 'daily']) {
    const duplicate = fixture(); duplicate[block].time[1] = duplicate[block].time[0];
    assert.equal(parse(duplicate, NOW), null);
    const reversed = fixture(); reversed[block].time.reverse();
    assert.equal(parse(reversed, NOW), null);
  }
  const offGrid = fixture(); offGrid.daily.time[0] += HOUR;
  assert.equal(parse(offGrid, NOW), null);
});

test('Entirely stale forecasts, invalid timezone/offset, invalid clocks and API error bodies are rejected', () => {
  assert.equal(parse(fixture(), NOW + 10 * DAY * 1000), null);
  for (const value of [null, 'UTC', 'Europe/Berlin']) {
    const input = fixture(); input.timezone = value;
    assert.equal(parse(input, NOW), null);
  }
  for (const value of [0, 3600.5, '3600', null]) {
    const input = fixture(); input.utc_offset_seconds = value;
    assert.equal(parse(input, NOW), null);
  }
  for (const clock of [null, undefined, 'now', NaN, Infinity, 0, -1]) assert.equal(parse(fixture(), clock), null);
  for (const input of [null, {}, [], {error: true, reason: 'Invalid request'}]) assert.equal(parse(input, NOW), null);
});

test('An entirely missing forecast cannot manufacture useful weather from array positions', () => {
  const input = fixture();
  for (const block of ['hourly', 'daily']) {
    for (const key of Object.keys(input[block])) if (key !== 'time') input[block][key].fill(null);
  }
  assert.equal(parse(input, NOW), null);
});

test('WMO conditions map consistently to Pebble categories and unsupported codes stay unknown', () => {
  const examples = [[0, 'sun'], [1, 'sun'], [2, 'partly_cloudy'], [3, 'cloudy'], [45, 'cloudy'],
    [48, 'cloudy'], [51, 'light_rain'], [61, 'light_rain'], [65, 'heavy_rain'], [67, 'heavy_rain'],
    [71, 'light_snow'], [73, 'light_snow'], [75, 'heavy_snow'], [77, 'light_snow'],
    [80, 'light_rain'], [82, 'heavy_rain'], [85, 'light_snow'], [86, 'heavy_snow'],
    [95, 'heavy_rain'], [99, 'heavy_rain'], [999, 'unknown'], ['0', 'unknown'], [null, 'unknown']];
  for (const [code, expected] of examples) {
    const input = fixture(); input.hourly.weather_code[0] = code; input.daily.weather_code[0] = code;
    const actual = parse(input, NOW);
    assert.equal(actual.hours[0].conditionCode, expected, String(code));
    assert.equal(actual.days[0].conditionCode, expected, String(code));
  }
});
