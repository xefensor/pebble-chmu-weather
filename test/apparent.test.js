'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {apparentTemperature} = require('../src/lib/apparent');

function close(actual, expected) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test('matches independently calculated dry, humid, hot and cold shade estimates', () => {
  // Golden values evaluated separately using 40-digit decimal arithmetic.
  close(apparentTemperature(0, 0, 0), -4);
  close(apparentTemperature(0, 100, 0), -1.98535);
  close(apparentTemperature(20, 50, 0), 19.848242312858146);
  close(apparentTemperature(30, 70, 2), 34.36833429149539);
  close(apparentTemperature(-10, 80, 5), -16.74508655187782);
  close(apparentTemperature(6.8, 90, 3), 3.6311528383427037);
});

test('wind input is in metres per second and each extra m/s reduces the estimate by 0.7C', () => {
  const calm = apparentTemperature(20, 50, 0);
  close(apparentTemperature(20, 50, 3), calm - 2.1);
  // A caller must first convert 10.8 km/h to 3 m/s; the function never guesses.
  assert.ok(Math.abs(apparentTemperature(20, 50, 10.8) - apparentTemperature(20, 50, 3)) > 5);
});

test('more humidity raises the estimate and Celsius precision is retained for later unit conversion', () => {
  assert.ok(apparentTemperature(30, 90, 2) > apparentTemperature(30, 50, 2));
  const c = apparentTemperature(20, 50, 0);
  assert.notEqual(c, Math.round(c));
  close(c * 9 / 5 + 32, 67.72683616314466);
});

test('missing or nonnumeric fields remain unavailable rather than becoming dry or calm conditions', () => {
  for (const invalid of [undefined, null, '', '0', '20', true, false, [], {}, NaN, Infinity, -Infinity]) {
    assert.equal(apparentTemperature(invalid, 50, 3), null);
    assert.equal(apparentTemperature(20, invalid, 3), null);
    assert.equal(apparentTemperature(20, 50, invalid), null);
  }
  assert.equal(apparentTemperature(), null);
  assert.equal(apparentTemperature(20), null);
  assert.equal(apparentTemperature(20, 50), null);
});

test('rejects impossible humidity, negative wind and values outside the supported input bounds', () => {
  for (const t of [-50.001, 50.001, 293.15]) {
    assert.equal(apparentTemperature(t, 50, 3), null);
  }
  for (const rh of [-0.001, 100.001]) {
    assert.equal(apparentTemperature(20, rh, 3), null);
  }
  for (const wind of [-0.001, 50.001, 180]) {
    assert.equal(apparentTemperature(20, 50, wind), null);
  }
  for (const t of [-50, 50]) {
    for (const rh of [0, 100]) {
      for (const wind of [0, 50]) {
        assert.ok(Number.isFinite(apparentTemperature(t, rh, wind)));
      }
    }
  }
});
