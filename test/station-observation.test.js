'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {parseObservation} = require('../src/lib/station-observation');
const legacy = require('../src/lib/weather').parseObservation;
const fixture = require('../tests/fixtures/station-weather-C2CBUD01.json');
const NOW = Date.parse('2026-10-31T11:00:00Z');
const AT = '2026-10-31T10:40:00Z';
const DIAL = {T: {Code: 'T', UnitHTML: '°C'}, H: {Code: 'H', UnitHTML: '%'},
  F: {Code: 'F', UnitHTML: 'm.s<sup>-1</sup>'}, D: {Code: 'D', UnitHTML: '°'}};
function point(timestamp = AT, values = {T: '7.2', H: '86', F: '3.2', D: '324'}) { return {timestamp, values}; }
function graph(points = [point()], dial = DIAL) { return {dataPoints: points, dial}; }
function bulk(rows, header = ['STATION', 'ELEMENT', 'DT', 'VAL', 'FLAG', 'QUALITY']) {
  return {data: {data: {header, values: rows}}};
}
function measurement(code, value, quality = 5, time = AT, station = 'station', flag = '') {
  return [station, code, time, value, flag, quality];
}

test('captured official multiweather station graph retains co-timed air temperature, humidity and 10m wind', () => {
  const result = parseObservation(fixture, NOW);
  assert.deepEqual(result, {temperatureC: 7.2, observedAt: Date.parse(AT) / 1000,
    humidity: 86, windSpeed: 3.2, windDirection: 324});
  assert.equal(fixture.dial.H.UnitHTML, '%');
  assert.equal(fixture.dial.F.UnitHTML, 'm.s<sup>-1</sup>');
  assert.equal(fixture.dial.D.UnitHTML, '°');
});

test('newest valid T chooses its own optional values, never an older complete sample or a newer temperature-less row', () => {
  const result = parseObservation(graph([
    point('2026-10-31T10:50:00Z', {H: 90, F: 7, D: 120}),
    point('2026-10-31T10:30:00Z', {T: 6, H: 80, F: 3, D: 40}),
    point(AT, {T: 7.2, H: 0, F: 0})
  ]), NOW);
  assert.deepEqual(result, {temperatureC: 7.2, observedAt: Date.parse(AT) / 1000, humidity: 0, windSpeed: 0});
  assert.deepEqual(parseObservation(graph([point(AT, {T: 7.2}), point(AT, {H: 80, F: 3})]), NOW),
    {temperatureC: 7.2, observedAt: Date.parse(AT) / 1000}, 'Graph point objects are individual station samples');
});

test('temperature-only graph and bulk callers retain the existing parser contract', () => {
  for (const input of [
    {dataPoints: [point(AT, {T: '7.2', TPM: '99', T05: '88'})]},
    bulk([measurement('T', '7.2')]), bulk([measurement('T', '7.2', 0)])
  ]) assert.deepEqual(parseObservation(input, NOW), legacy(input, NOW));
});

test('explicit graph units and code metadata must match each measured field', () => {
  for (const [code, unit] of [['T', '°F'], ['H', 'fraction'], ['F', 'km/h'], ['D', 'rad']]) {
    const dial = JSON.parse(JSON.stringify(DIAL));
    dial[code].UnitHTML = unit;
    const result = parseObservation(graph([point()], dial), NOW);
    if (code === 'T') assert.equal(result, null);
    else assert.equal(result[{H: 'humidity', F: 'windSpeed', D: 'windDirection'}[code]], undefined);
  }
  const dial = JSON.parse(JSON.stringify(DIAL));
  dial.T.Code = 'TPM';
  assert.equal(parseObservation(graph([point()], dial), NOW), null);
  assert.equal(parseObservation(graph([point()], 'invalid metadata'), NOW), null);
});

test('missing or invalid optional measurements stay absent and are not coerced into zero', () => {
  for (const value of [null, undefined, '', ' ', true, false, NaN, Infinity, 'NaN', '0x10', {}, []]) {
    const result = parseObservation(graph([point(AT, {T: 7.2, H: value, F: value, D: value})]), NOW);
    assert.deepEqual(result, {temperatureC: 7.2, observedAt: Date.parse(AT) / 1000}, String(value));
  }
  const result = parseObservation(graph([point(AT, {T: '+7.25', H: 100, F: 150, D: 360})]), NOW);
  assert.equal(result.temperatureC, 7.25);
  assert.equal(result.humidity, 100);
  assert.equal(result.windSpeed, 150);
  assert.equal(result.windDirection, 360);
  for (const [code, invalid] of [['H', -0.1], ['H', 100.1], ['F', -0.1], ['F', 150.1], ['D', -1], ['D', 360.1]]) {
    const values = {T: 7.2}; values[code] = invalid;
    const out = parseObservation(graph([point(AT, values)]), NOW);
    assert.equal(Object.keys(out).length, 2);
  }
});

test('bulk fields group by the exact UTC instant and retain zero humidity, calm wind and north direction', () => {
  const result = parseObservation(bulk([
    measurement('F', 9, 0, '2026-10-31T10:30:00Z'),
    measurement('H', 99, 0, '2026-10-31T10:50:00Z'),
    measurement('T', '7.2'), measurement('F', 0), measurement('H', '0'),
    measurement('D', '0', 0, '2026-10-31T10:40:00+00:00')
  ]), NOW);
  assert.deepEqual(result, {temperatureC: 7.2, observedAt: Date.parse(AT) / 1000,
    quality: 'unknown', humidity: 0, windSpeed: 0, windDirection: 0});
  const separated = parseObservation(bulk([
    measurement('T', 7.2, 0, '2026-10-31T10:40:00.000Z'),
    measurement('H', 80, 0, '2026-10-31T10:40:00.001Z')
  ]), NOW);
  assert.equal(separated.humidity, undefined, 'Milliseconds must not disappear before grouping');
});

test('bulk validates quality and flags separately for every optional field', () => {
  for (const code of ['H', 'F', 'D']) {
    for (const quality of [1, 2, 3, 4, 6, null, '', true, 'bad']) {
      const result = parseObservation(bulk([measurement('T', 7.2), measurement(code, 10, quality)]), NOW);
      assert.equal(result[FIELDS_NAME[code]], undefined, code + ' quality ' + quality);
    }
    const flagged = parseObservation(bulk([measurement('T', 7.2), measurement(code, 10, 0, AT, 'station', 'unexplained')]), NOW);
    assert.equal(flagged[FIELDS_NAME[code]], undefined);
  }
  for (const quality of [0, '0', 5, '5.0']) {
    const result = parseObservation(bulk([measurement('T', 7.2, quality), measurement('F', 0, quality)]), NOW);
    assert.equal(result.windSpeed, 0);
    assert.equal(result.quality, Number(quality) === 0 ? 'good' : 'unknown');
  }
  assert.equal(parseObservation(bulk([measurement('T', 7.2, 3)]), NOW), null);
  assert.equal(parseObservation(bulk([measurement('T', 7.2, 0, AT, 'station', 'unexplained')]), NOW), null);
});
const FIELDS_NAME = {H: 'humidity', F: 'windSpeed', D: 'windDirection'};

test('mixed-station bulk sources are rejected for humidity/wind as well as temperature', () => {
  for (const code of ['T', 'H', 'F', 'D']) {
    assert.equal(parseObservation(bulk([
      measurement('T', 7.2, 0, AT, 'station-a'), measurement(code, 10, 0, AT, 'station-b')
    ]), NOW), null, code);
  }
  const unrelated = parseObservation(bulk([
    measurement('T', 7.2, 0, AT, 'station-a'), measurement('TPM', 1, 0, AT, 'station-b')
  ]), NOW);
  assert.equal(unrelated.temperatureC, 7.2, 'Unused element rows cannot supply any weather field');
});

test('bulk header lookup supports reordered columns and validates explicit per-row units', () => {
  const header = 'VAL,UNIT,DT,QUALITY,ELEMENT,STATION,FLAG';
  const input = bulk([
    [7.2, '°C', AT, 0, 'T', 'station', ''],
    [86, '%', AT, 0, 'H', 'station', ''],
    [3.2, 'm/s', AT, 0, 'F', 'station', ''],
    [324, '°', AT, 0, 'D', 'station', '']
  ], header);
  assert.equal(parseObservation(input, NOW).windSpeed, 3.2);
  input.data.data.values[2][1] = 'km/h';
  assert.equal(parseObservation(input, NOW).windSpeed, undefined);
  input.data.data.values[0][1] = '°F';
  assert.equal(parseObservation(input, NOW), null);
});

test('offline measurements expire after the requested age while diagnostic reads can deliberately inspect older data', () => {
  for (const input of [graph(), bulk([measurement('T', 7.2), measurement('H', 86)])]) {
    const at = Date.parse(AT);
    assert.ok(parseObservation(input, at + 3600000));
    assert.equal(parseObservation(input, at + 3600001), null);
    assert.ok(parseObservation(input, at + 12 * 3600000, 48 * 3600));
    assert.ok(parseObservation(input, at - 300000));
    assert.equal(parseObservation(input, at - 301000), null);
  }
});

test('strict UTC calendars and finite numeric T/freshness inputs reject malformed data safely', () => {
  for (const time of ['2026-02-30T10:40:00Z', '2026-10-31T24:00:00Z', '2026-10-31T10:60:00Z',
    '2026-10-31T10:40:00', '2026-10-31T10:40:00+01:00', 'now', null]) {
    assert.equal(parseObservation(graph([point(time)]), NOW), null);
    assert.equal(parseObservation(bulk([measurement('T', 7.2, 0, time)]), NOW), null);
  }
  for (const value of [null, '', ' ', false, true, NaN, Infinity, '0x10', -100.1, 100.1]) {
    assert.equal(parseObservation(graph([point(AT, {T: value})]), NOW), null);
  }
  for (const now of [null, NaN, Infinity, 0, -1, 'now']) assert.equal(parseObservation(graph(), now), null);
  for (const age of [null, NaN, Infinity, -1, '3600']) assert.equal(parseObservation(graph(), NOW, age), null);
});

test('malformed, oversized and duplicate-header inputs have no usable observation', () => {
  for (const input of [null, {}, [], {dataPoints: {}}, graph([null, {}, point(AT, [])]),
    graph(Array(25001).fill(null)), bulk(Array(25001).fill(null)), bulk([], []),
    bulk([measurement('T', 7.2)], ['STATION', 'ELEMENT', 'DT', 'VAL', 'QUALITY', 'QUALITY']),
    bulk([measurement('T', 7.2)], ['STATION', 'ELEMENT', 'DT', 'VAL']),
    bulk([null, [], {}, ['station']])]) assert.equal(parseObservation(input, NOW), null);
});
