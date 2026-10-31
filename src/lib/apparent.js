'use strict';

// Steadman apparent-temperature approximation, non-radiation version, as
// documented by the Australian Bureau of Meteorology:
// https://www.bom.gov.au/info/thermal_stress/
// AT = T + 0.33e - 0.70w - 4, where e is vapour pressure in hPa.
// This estimates how conditions feel to a suitably dressed adult walking in
// shade; it does not account for sunshine, wet clothing or individual response.
// It is a plugin-calculated estimate, not a measured or official CHMI value.

function finite(value) { return typeof value === 'number' && isFinite(value); }

/**
 * Return an unrounded estimated apparent temperature in degrees Celsius.
 * Inputs: dry-bulb temperature (degrees Celsius), relative humidity (percent),
 * and sustained wind speed at 10 metres (metres/second, not gusts).
 *
 * T -50..50 C and wind 0..50 m/s are conservative plugin input guardrails,
 * not a claim that the approximation is validated throughout that domain.
 * All inputs must be present, finite numbers in their stated units. No unit
 * conversion or missing-value substitution is performed. Callers using model
 * or mixed station/model inputs must retain that provenance in their output.
 */
function apparentTemperature(tempC, humidity, windSpeed) {
  if (!finite(tempC) || tempC < -50 || tempC > 50 ||
      !finite(humidity) || humidity < 0 || humidity > 100 ||
      !finite(windSpeed) || windSpeed < 0 || windSpeed > 50) { return null; }

  var vapourPressure = humidity / 100 * 6.105 * Math.exp(17.27 * tempC / (237.7 + tempC));
  var apparent = tempC + 0.33 * vapourPressure - 0.70 * windSpeed - 4;
  return finite(apparent) ? apparent : null;
}

module.exports = {apparentTemperature: apparentTemperature};
