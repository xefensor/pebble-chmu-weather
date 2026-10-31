'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {parseUV} = require('../src/lib/app-uv');
const fixture = require('../tests/fixtures/app-uv.json');
const NOW = Date.parse('2026-10-31T07:48:00Z');

function row(overrides = {}) {
  return Object.assign({date_at: '2026-10-31', value: 1.5, value_snow: 1.8,
    updated_at: '2026-10-31T06:16:33+01:00'}, overrides);
}

test('live weather-only response preserves dates, normal UV and actual source update timestamps', () => {
  const result = parseUV(fixture, NOW);
  assert.equal(result.source, 'ČHMÚ app clear-sky noon UV');
  assert.equal(result.days.length, 6);
  assert.deepEqual(result.days.map(day => day.date),
    ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(result.days[0].uvIndex, 1.5);
  assert.equal(result.days[0].updatedAt, Date.parse('2026-10-27T05:16:22Z') / 1000,
    'A valid four-day-old issue time must not become the download time');
  assert.ok(Math.abs(result.days[0].valueSnow - 1.8) < 1e-12);
  assert.ok(!result.days.some(day => day.date === '2026-11-06'), 'An absent seventh day stays absent');
});

test('zero normal UV stays zero and snow-adjusted UV never substitutes for missing normal UV', () => {
  const result = parseUV([row({value: 0, value_snow: 5})], NOW);
  assert.equal(result.days[0].uvIndex, 0);
  assert.equal(result.days[0].valueSnow, 5);
  assert.equal(parseUV([row({value: null, value_snow: 5})], NOW), null);
  assert.equal(parseUV([row({value: undefined, value_snow: 5})], NOW), null);
  const normalOnly = parseUV([row({value_snow: '5'})], NOW).days[0];
  assert.equal(normalOnly.uvIndex, 1.5);
  assert.equal(normalOnly.valueSnow, undefined);
});

test('duplicates select the freshest valid issue, then sort by date without filling gaps', () => {
  const result = parseUV([
    row({date_at: '2026-11-02', value: 2}),
    row({value: 1, updated_at: '2026-10-30T07:46:00Z'}),
    row({value: 0, updated_at: '2026-10-31T07:46:00Z'}),
    row({value: 29, updated_at: '2026-10-31T08:46:00Z'}), // Future issue rejected.
    row({value: 30, updated_at: '2026-02-30T07:47:00Z'})
  ], NOW);
  assert.deepEqual(result.days.map(day => [day.date, day.uvIndex]), [['2026-10-31', 0], ['2026-11-02', 2]]);
  assert.equal(result.days[0].updatedAt, Date.parse('2026-10-31T07:46:00Z') / 1000);
});

test('only today through the sixth following Prague calendar day are accepted', () => {
  const result = parseUV(['2026-10-30', '2026-10-31', '2026-11-06', '2026-11-07']
    .map(date => row({date_at: date})), NOW);
  assert.deepEqual(result.days.map(day => day.date), ['2026-10-31', '2026-11-06']);
  const midnight = Date.parse('2026-10-31T23:05:00Z'); // Prague November 1.
  const next = parseUV(fixture, midnight);
  assert.equal(next.days[0].date, '2026-11-01');
  assert.ok(!next.days.some(day => day.date === '2026-10-31'));
});

test('Prague date selection handles spring and autumn DST independently of the host time zone', () => {
  for (const [now, today, yesterday] of [
    ['2026-03-29T22:30:00Z', '2026-03-30', '2026-03-29'], // Summer UTC+2.
    ['2026-10-25T22:30:00Z', '2026-10-25', '2026-10-24']  // Winter UTC+1.
  ]) {
    const result = parseUV([row({date_at: yesterday, updated_at: now}), row({date_at: today, updated_at: now})], Date.parse(now));
    assert.deepEqual(result.days.map(day => day.date), [today]);
  }
});

test('source timestamps must be actual calendar times with explicit valid offsets', () => {
  for (const updated_at of [undefined, null, 1793430000, '', '2026-10-31T07:00:00',
    '2026-10-31', '2026-02-30T07:00:00Z', '2026-10-31T24:00:00Z',
    '2026-10-31T07:60:00Z', '2026-10-31T07:00:60Z', '2026-10-31T07:00:00+14:01',
    '2026-10-31T07:00:00+25:00', '2026-10-31T07:00:00+01:60', '2026-10-31T07:00:00-00:00']) {
    assert.equal(parseUV([row({updated_at})], NOW), null, String(updated_at));
  }
  const z = parseUV([row({updated_at: '2026-10-31T07:46:00.123Z'})], NOW);
  const offset = parseUV([row({updated_at: '2026-10-31T08:46:00.123+01:00'})], NOW);
  assert.deepEqual(z, offset);
  assert.equal(z.days[0].updatedAt, Date.parse('2026-10-31T07:46:00Z') / 1000);
});

test('source update age is limited to seven days and future tolerance is ten minutes', () => {
  function at(delta) { return new Date(NOW + delta).toISOString(); }
  for (const delta of [-7 * 86400000, 10 * 60000]) {
    assert.ok(parseUV([row({updated_at: at(delta)})], NOW));
  }
  for (const delta of [-7 * 86400000 - 1, 10 * 60000 + 1]) {
    assert.equal(parseUV([row({updated_at: at(delta)})], NOW), null);
  }
});

test('malformed rows and values are omitted without coercion or losing another valid date', () => {
  for (const date_at of [null, undefined, 20261031, '2026-1-31', '2026-02-30',
    '2026-10-31T00:00:00Z', '2026-13-01', '2026-10-00']) {
    assert.equal(parseUV([row({date_at})], NOW), null);
  }
  for (const value of [null, undefined, '0', '1.5', true, false, NaN, Infinity, -Infinity, -0.01, 30.01]) {
    assert.equal(parseUV([row({value})], NOW), null, String(value));
  }
  const result = parseUV([null, [], 'bad', row({value: '1.5'}), row({value: 0})], NOW);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].uvIndex, 0);
  assert.equal(parseUV([row({date_at: '2026-11-02'})], NOW).days[0].date, '2026-11-02',
    'Missing current-date UV must not move a future record into today');
});

test('input size and current-time validation bound work and prevent invalid date operations', () => {
  for (const body of [null, undefined, {}, '[]', [], Array.from({length: 17}, () => row())]) {
    assert.equal(parseUV(body, NOW), null);
  }
  for (const now of [null, undefined, '1793432880000', NaN, Infinity, -Infinity, 0, -1, 1e20]) {
    assert.equal(parseUV([row()], now), null);
  }
  assert.equal(parseUV(Array.from({length: 16}, () => row()), NOW).days.length, 1);
});
