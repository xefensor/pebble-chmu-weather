'use strict';

var SunCalc = require('suncalc');
var apparentTemperature = require('./apparent').apparentTemperature;
var HOUR = 3600;
var DAY = 86400;
var CONDITIONS = {
  sun: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy',
  light_rain: 'Light rain', heavy_rain: 'Heavy rain', light_snow: 'Light snow',
  heavy_snow: 'Heavy snow', rain_and_snow: 'Rain and snow', unknown: 'Unknown'
};

function finite(value) { return typeof value === 'number' && isFinite(value); }
function validTemp(value) { return finite(value) && value >= -100 && value <= 100; }
function percent(value) { return finite(value) && value >= 0 && value <= 100; }
function validCode(value) {
  // Parser gap rows also use "unknown". They must not block a usable
  // supplementary condition when the rest of that hour can be completed.
  return typeof value === 'string' && value !== 'unknown' && Object.prototype.hasOwnProperty.call(CONDITIONS, value);
}

// All supported observation stations and ALADIN points are in Czechia. Prague
// follows EU daylight-saving transitions at 01:00 UTC on the final Sunday of
// March and October. This avoids depending on an Intl time-zone database in JS.
function offsetAt(ms) {
  var year = new Date(ms).getUTCFullYear();
  var march = new Date(Date.UTC(year, 2, 31, 1));
  var october = new Date(Date.UTC(year, 9, 31, 1));
  var start = march.getTime() - march.getUTCDay() * DAY * 1000;
  var end = october.getTime() - october.getUTCDay() * DAY * 1000;
  return ms >= start && ms < end ? 120 : 60;
}

function localDate(ms) {
  var date = new Date(ms + offsetAt(ms) * 60000);
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}

function midnight(parts) {
  var utc = Date.UTC(parts[0], parts[1], parts[2]);
  return Math.floor((utc - offsetAt(utc) * 60000) / 1000);
}

function sameDate(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }
function dayParts(today, days) {
  var date = new Date(Date.UTC(today[0], today[1], today[2] + days));
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
}
function dateKey(parts) {
  return parts[0] + '-' + ('0' + (parts[1] + 1)).slice(-2) + '-' + ('0' + parts[2]).slice(-2);
}

function fresh(fetched, now) {
  return finite(fetched) && fetched > 0 && fetched <= now + 300 && now - fetched <= 6 * HOUR;
}

function hourMap(hours) {
  var result = {};
  if (Array.isArray(hours)) {
    hours.forEach(function(hour) {
      if (hour && finite(hour.time) && hour.time > 0 && Math.floor(hour.time) === hour.time) {
        result[hour.time] = hour;
      }
    });
  }
  return result;
}

// Keep field provenance: a missing condition must never replace a valid CHMI
// temperature, and a missing CHMI humidity/wind can be filled independently.
function mergeHour(primary, extra) {
  var merged = {time: (primary || extra).time, sources: {}};
  var validators = {
    temperatureC: validTemp, conditionCode: validCode, humidity: percent,
    windSpeed: function(v) { return finite(v) && v >= 0 && v <= 150; },
    windDirection: function(v) { return finite(v) && v >= 0 && v <= 360; }
  };
  Object.keys(validators).forEach(function(field) {
    var validate = validators[field];
    if (primary && validate(primary[field])) {
      merged[field] = primary[field];
      merged.sources[field] = 'ALADIN';
    } else if (extra && validate(extra[field])) {
      merged[field] = extra[field];
      merged.sources[field] = 'Open-Meteo';
    }
  });
  if (extra && percent(extra.precipitationProbability)) {
    merged.precipitationProbability = extra.precipitationProbability;
    merged.sources.precipitationProbability = 'Open-Meteo';
  }
  return merged;
}

function inUnit(celsius, unit) { return unit === '°F' ? celsius * 9 / 5 + 32 : celsius; }
function tempText(celsius, unit, estimate) {
  return (estimate ? '~' : '') + Math.round(inUnit(celsius, unit)) + unit;
}
function tempShape(celsius, unit, estimate) {
  var text = tempText(celsius, unit, estimate);
  return {shortText: {text: text}, longText: {text: text},
    numericValue: {value: inUnit(celsius, unit), unit: unit}};
}
function textShape(text) { return {shortText: {text: text}, longText: {text: text}}; }
function codeOf(hour) { return hour && CONDITIONS[hour.conditionCode] ? hour.conditionCode : 'unknown'; }
function timestamp(value) { return {timestamp: {value: value}}; }
function over(start, step, shapes) {
  shapes.start = start;
  shapes.stepSec = step;
  return {series: shapes};
}
function tempSeries(start, step, values, unit) {
  return over(start, step, {
    numericValue: {values: values.map(function(t) { return t === null ? null : inUnit(t, unit); }), unit: unit},
    shortText: {values: values.map(function(t) { return t === null ? null : tempText(t, unit, false); })}
  });
}

function base64(bytes) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return out;
}

// Authored geometric icons. Pebble bitmap shapes use 4-bpp pixels (even x in
// the high nibble), one byte per palette entry, and palette index 0 transparent.
function glyph(code, size, mono) {
  var pixels = [];
  for (var p = 0; p < size * size; p++) { pixels.push(0); }
  var ink = mono ? 1 : 2;
  function circle(cx, cy, radius, colour) {
    for (var y = Math.max(0, Math.floor(cy - radius)); y < Math.min(size, Math.ceil(cy + radius)); y++) {
      for (var x = Math.max(0, Math.floor(cx - radius)); x < Math.min(size, Math.ceil(cx + radius)); x++) {
        var dx = x + 0.5 - cx;
        var dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= radius * radius) { pixels[y * size + x] = colour; }
      }
    }
  }
  function line(x0, y0, x1, y1, width) {
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (var i = 0; i <= steps; i++) {
      circle(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, width / 2, ink);
    }
  }
  function cloud(lift) {
    circle(size * 0.36, size * (0.53 - lift), size * 0.14, ink);
    circle(size * 0.50, size * (0.45 - lift), size * 0.17, ink);
    circle(size * 0.65, size * (0.55 - lift), size * 0.12, ink);
    line(size * 0.30, size * (0.60 - lift), size * 0.68, size * (0.60 - lift), size * 0.12);
  }
  function sun(cx, cy, radius) {
    circle(cx, cy, radius, ink);
    for (var n = 0; n < 8; n++) {
      var angle = n * Math.PI / 4;
      line(cx + Math.cos(angle) * radius * 1.35, cy + Math.sin(angle) * radius * 1.35,
        cx + Math.cos(angle) * radius * 1.85, cy + Math.sin(angle) * radius * 1.85, Math.max(1, size * 0.025));
    }
  }
  var wet = code === 'light_rain' || code === 'heavy_rain' || code === 'rain_and_snow';
  var snow = code === 'light_snow' || code === 'heavy_snow' || code === 'rain_and_snow';
  var background = wet ? 0xC7 : snow ? 0xCB : code === 'sun' || code === 'partly_cloudy' ? 0xF8 : 0xEA;
  if (!mono) { circle(size / 2, size / 2, size / 2, 1); }
  if (code === 'sun') { sun(size / 2, size / 2, size * 0.15); }
  else if (code === 'partly_cloudy') { sun(size * 0.65, size * 0.36, size * 0.11); cloud(-0.03); }
  else if (code === 'cloudy' || wet || snow) {
    cloud(wet || snow ? 0.07 : 0);
    if (wet || snow) {
      var count = code === 'heavy_rain' || code === 'heavy_snow' ? 4 : 3;
      for (var drop = 0; drop < count; drop++) {
        var x = size * (0.36 + drop * 0.1);
        var y = size * 0.70;
        if (snow && (!wet || drop === 1)) {
          line(x - size * 0.035, y, x + size * 0.035, y, Math.max(1, size * 0.025));
          line(x, y - size * 0.035, x, y + size * 0.035, Math.max(1, size * 0.025));
        } else { line(x, y - size * 0.035, x - size * 0.025, y + size * 0.055, Math.max(1, size * 0.035)); }
      }
    }
  } else {
    line(size * 0.37, size * 0.36, size * 0.60, size * 0.36, size * 0.055);
    line(size * 0.60, size * 0.36, size * 0.60, size * 0.49, size * 0.055);
    line(size * 0.60, size * 0.49, size * 0.50, size * 0.56, size * 0.055);
    circle(size * 0.50, size * 0.68, size * 0.035, ink);
  }
  var bytes = [];
  for (var row = 0; row < size; row++) {
    for (var column = 0; column < size; column += 2) {
      bytes.push((pixels[row * size + column] << 4) |
        (column + 1 < size ? pixels[row * size + column + 1] : 0));
    }
  }
  return {pixels: base64(bytes), palette: base64(mono ? [0, 0xC0] : [0, background, 0xFF]), width: size, height: size};
}

function conditionShape(code, iconSize, wanted) {
  var out = textShape(CONDITIONS[code] || CONDITIONS.unknown);
  if (iconSize && wanted) {
    out.icon = glyph(code, iconSize, true);
    out.image = glyph(code, iconSize, false);
  }
  return out;
}

function sunTimes(parts, latitude, longitude) {
  var times = SunCalc.getTimes(new Date(Date.UTC(parts[0], parts[1], parts[2], 12)), latitude, longitude);
  var rise = Math.round(times.sunrise.getTime() / 1000);
  var set = Math.round(times.sunset.getTime() / 1000);
  var from = midnight(parts);
  var to = midnight(dayParts(parts, 1));
  return finite(rise) && finite(set) && rise >= from && rise < set && set < to
    ? {rise: rise, set: set} : null;
}

function buildInstance(options) {
  options = options || {};
  var place = options.place || {};
  var now = options.now;
  if (!finite(now) || !finite(place.latitude) || !finite(place.longitude) ||
      Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180 ||
      typeof place.id !== 'string' || !place.id) { return null; }
  var request = options.request || {};
  var wanted = function(name) { return !Array.isArray(request.properties) || request.properties.indexOf(name) >= 0; };
  var iconSize = request.iconPixelSize && Math.min(request.iconPixelSize.w, request.iconPixelSize.h);
  iconSize = finite(iconSize) && iconSize > 0 ? Math.min(96, Math.max(8, Math.floor(iconSize))) : null;
  var units = options.units || {};
  var unit = units.temperature === '°F' ? '°F' : '°C';
  var nowSec = Math.floor(now / 1000);
  var fetched = options.fetchedAt;
  var forecastUsable = fresh(fetched, nowSec);
  var byPrimaryTime = hourMap(forecastUsable && options.forecast ? options.forecast.hours : null);
  var supplemental = options.supplemental;
  var supplementalUsable = supplemental && supplemental.timezone === 'Europe/Prague' && fresh(options.supplementalFetchedAt, nowSec);
  var byExtraTime = hourMap(supplementalUsable ? supplemental.hours : null);
  var byTime = {};
  Object.keys(byPrimaryTime).concat(Object.keys(byExtraTime)).forEach(function(time) {
    if (!byTime[time]) { byTime[time] = mergeHour(byPrimaryTime[time], byExtraTime[time]); }
  });
  var byExtraDate = {};
  if (supplementalUsable && Array.isArray(supplemental.days)) {
    supplemental.days.forEach(function(day) {
      if (day && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date)) { byExtraDate[day.date] = day; }
    });
  }
  var byAppDate = {};
  var appForecast = options.appForecast;
  var appForecastUsable = appForecast && fresh(options.appForecastFetchedAt, nowSec) &&
    fresh(appForecast.updatedAt, nowSec) && Array.isArray(appForecast.days);
  if (appForecastUsable) {
    appForecast.days.forEach(function(day) {
      if (day && validTemp(day.highC) && validTemp(day.lowC) && day.highC >= day.lowC) {
        byAppDate[day.date] = day;
      }
    });
  }
  var appFetchTimes = [];
  var appForecastUsed = false;
  var supplementalUsed = false;
  function noteSources(hour, fields) {
    if (!hour) { return; }
    fields.forEach(function(field) {
      if (hour.sources[field] === 'Open-Meteo') { supplementalUsed = true; }
    });
  }
  var currentHour = null;
  Object.keys(byTime).forEach(function(time) {
    var hour = byTime[time];
    if (hour.time <= nowSec && nowSec < hour.time + HOUR) { currentHour = hour; }
  });
  var observation = options.observation;
  var measured = observation && validTemp(observation.temperatureC) && finite(observation.observedAt) &&
    observation.observedAt > 0 && observation.observedAt <= nowSec + 300 && nowSec - observation.observedAt <= HOUR;
  if (!measured && !(currentHour && validTemp(currentHour.temperatureC))) { return null; }
  var temp = measured ? observation.temperatureC : currentHour.temperatureC;
  var code = codeOf(currentHour);
  var today = localDate(now);
  var start = midnight(today);
  var temperatureSource = measured ? 'station' : currentHour.sources.temperatureC;
  var currentSource = measured ? 'ČHMÚ station measurement' : temperatureSource === 'ALADIN' ? 'ČHMÚ ALADIN forecast' : 'Open-Meteo forecast';
  var properties = {
    name: {shortText: {text: typeof place.name === 'string' ? place.name : place.id}},
    temperature: tempShape(temp, unit, !measured),
    condition: conditionShape(code, iconSize, wanted('condition')),
    condition_code: {longText: {text: code}},
    utc_offset: {numericValue: {value: offsetAt(now), unit: 'min'}},
    is_forecast: {boolean: {value: !measured}},
    source: {shortText: {text: temperatureSource === 'Open-Meteo' ? 'Open-Meteo' : 'ČHMÚ'}, longText: {text: currentSource}}
  };
  noteSources(currentHour, measured ? ['conditionCode'] : ['temperatureC', 'conditionCode']);
  if (forecastUsable) { properties.forecast_updated_at = timestamp(Math.floor(fetched)); }
  if (options.station && typeof options.station.name === 'string') {
    properties.station = {longText: {text: options.station.name}};
  }
  if (measured) {
    properties.observed_at = timestamp(Math.floor(observation.observedAt));
    properties.observation_age = {numericValue: {value: Math.max(0, Math.floor((nowSec - observation.observedAt) / 60)), unit: 'min'}};
  }
  if (currentHour && finite(currentHour.humidity) && currentHour.humidity >= 0 && currentHour.humidity <= 100) {
    properties.humidity = {numericValue: {value: currentHour.humidity, unit: '%', min: 0, max: 100},
      shortText: {text: Math.round(currentHour.humidity) + '%'}};
  }
  if (currentHour && finite(currentHour.windSpeed) && currentHour.windSpeed >= 0) {
    var factor = {'m/s': 1, 'km/h': 3.6, mph: 2.2369362921, knots: 1.9438444924};
    var windUnit = Object.prototype.hasOwnProperty.call(factor, units.wind) ? units.wind : 'm/s';
    var wind = currentHour.windSpeed * factor[windUnit];
    properties.wind_speed = {numericValue: {value: wind, unit: windUnit}, shortText: {text: Math.round(wind) + ' ' + windUnit}};
  }
  if (currentHour && finite(currentHour.windDirection) && currentHour.windDirection >= 0 && currentHour.windDirection <= 360) {
    properties.wind_direction = {numericValue: {value: currentHour.windDirection, unit: '°', min: 0, max: 360}};
  }
  noteSources(currentHour, ['humidity', 'windSpeed', 'windDirection']);
  var apparent = currentHour ? apparentTemperature(temp, currentHour.humidity, currentHour.windSpeed) : null;
  if (apparent !== null) {
    properties.feels_like = tempShape(apparent, unit, true);
    properties.feels_like_source = {longText: {text: 'Calculated shade estimate; ' + temperatureSource +
      ' temperature, ' + currentHour.sources.humidity + ' humidity and ' + currentHour.sources.windSpeed + ' wind'}};
  }
  var hourlyTemps = [];
  var hourlyCodes = [];
  var hourlyProbability = [];
  var hourlySources = [];
  for (var h = 0; h < 48; h++) {
    var slot = start + h * HOUR;
    var hour = byTime[slot];
    // PebbleOS main Weather reads this slot instead of scalar temperature.
    // Blend the fresh observation into this one current slot so both screens
    // show the same current reading; raw forecasts and other hours stay intact.
    var currentMeasurement = measured && slot <= nowSec && nowSec < slot + HOUR;
    var hourTemperature = currentMeasurement ? observation.temperatureC : hour && hour.temperatureC;
    hourlyTemps.push(validTemp(hourTemperature) ? hourTemperature : null);
    hourlyCodes.push(validTemp(hourTemperature) ? codeOf(hour) : null);
    hourlySources.push(currentMeasurement ? 'ČHMÚ station measurement' :
      hour && validTemp(hour.temperatureC) ? hour.sources.temperatureC === 'ALADIN' ? 'ČHMÚ ALADIN forecast' : 'Open-Meteo forecast' : null);
    hourlyProbability.push(hour && percent(hour.precipitationProbability) ? hour.precipitationProbability : null);
    noteSources(hour, validTemp(hourTemperature) ? currentMeasurement ? ['conditionCode', 'precipitationProbability'] :
      ['temperatureC', 'conditionCode', 'precipitationProbability'] : ['precipitationProbability']);
  }
  properties.hourly_temperature = tempSeries(start, HOUR, hourlyTemps, unit);
  properties.hourly_source = over(start, HOUR, {longText:{values:hourlySources}});
  properties.hourly_condition_code = over(start, HOUR, {longText: {values: hourlyCodes}});
  var hourlyCondition = {shortText: {values: hourlyCodes.map(function(c) { return c === null ? null : CONDITIONS[c]; })}};
  if (iconSize && wanted('hourly_condition')) {
    var icons = {};
    hourlyCondition.icon = {values: hourlyCodes.map(function(c) {
      return c === null ? null : icons[c] || (icons[c] = glyph(c, iconSize, true));
    })};
    var images = {};
    hourlyCondition.image = {values: hourlyCodes.map(function(c) {
      return c === null ? null : images[c] || (images[c] = glyph(c, iconSize, false));
    })};
  }
  properties.hourly_condition = over(start, HOUR, hourlyCondition);
  if (hourlyProbability.some(function(value) { return value !== null; })) {
    properties.hourly_precipitation = over(start, HOUR, {numericValue: {values: hourlyProbability, unit: '%', min: 0, max: 100},
      shortText: {values: hourlyProbability.map(function(value) { return value === null ? null : Math.round(value) + '%'; })}});
  }

  var dailies = [];
  var primaryHours = Object.keys(byPrimaryTime).map(function(time) { return byPrimaryTime[time]; });
  for (var day = 0; day < 7; day++) {
    var parts = dayParts(today, day);
    var extraDay = byExtraDate[dateKey(parts)];
    var appDay = day < 3 ? byAppDate[dateKey(parts)] : null;
    var entries = primaryHours.filter(function(hour) { return validTemp(hour.temperatureC) && sameDate(localDate(hour.time * 1000), parts); });
    if (day > 0) {
      // The ALADIN response ends after 73 hours, often partway into its last
      // local day. A few early hours cannot stand in for that day's high/low.
      // Demand every actual UTC hour of a future local calendar day; Prague
      // daylight-saving transitions make that 23 or 25 hours, not always 24.
      var complete = [];
      var until = midnight(dayParts(parts, 1));
      for (var at = midnight(parts); at < until; at += HOUR) {
        var expected = byPrimaryTime[at];
        if (!expected || !validTemp(expected.temperatureC)) { break; }
        complete.push(expected);
      }
      entries = at === until ? complete : [];
    }
    var daily;
    if (appDay) {
      // These are server full-day aggregates, including already-passed hours.
      // The public hourly graph often starts partway through today.
      var appCode = validCode(appDay.conditionCode) ? appDay.conditionCode : 'unknown';
      if (appCode === 'unknown') {
        var appNoon = entries.filter(function(hour) {
          return new Date(hour.time * 1000 + offsetAt(hour.time * 1000) * 60000).getUTCHours() === 12;
        })[0];
        appCode = codeOf(appNoon);
      }
      daily = {high:appDay.highC, low:appDay.lowC, code:appCode, source:'ČHMÚ ALADIN (full-day app forecast)'};
      appForecastUsed = true;
    } else if (entries.length) {
      var high = -Infinity;
      var low = Infinity;
      var nearestNoon = null;
      var noonDistance = Infinity;
      entries.forEach(function(hour) {
        high = Math.max(high, hour.temperatureC);
        low = Math.min(low, hour.temperatureC);
        var local = new Date(hour.time * 1000 + offsetAt(hour.time * 1000) * 60000);
        var distance = Math.abs(local.getUTCHours() + local.getUTCMinutes() / 60 - 12);
        if (distance < noonDistance) { nearestNoon = hour; noonDistance = distance; }
      });
      daily = {high: high, low: low, code: codeOf(nearestNoon), source: 'ČHMÚ ALADIN'};
    } else if (extraDay && validTemp(extraDay.highC) && validTemp(extraDay.lowC) && extraDay.highC >= extraDay.lowC) {
      daily = {high: extraDay.highC, low: extraDay.lowC, code: codeOf(extraDay), source: 'Open-Meteo'};
      supplementalUsed = true;
    } else {
      // Native series use consecutive calendar-day indexes. Never shift a
      // later available day into an unavailable tomorrow's position.
      break;
    }
    daily.sun = sunTimes(parts, place.latitude, place.longitude);
    daily.probability = extraDay && percent(extraDay.precipitationProbability) ? extraDay.precipitationProbability : null;
    if (daily.probability !== null) { supplementalUsed = true; }
    dailies.push(daily);
  }
  if (dailies.length) {
    properties.high = tempShape(dailies[0].high, unit, false);
    properties.low = tempShape(dailies[0].low, unit, false);
    if (dailies[0].sun) {
      properties.sunrise = timestamp(dailies[0].sun.rise);
      properties.sunset = timestamp(dailies[0].sun.set);
    }
    properties.daily_high = tempSeries(start, DAY, dailies.map(function(d) { return d.high; }), unit);
    properties.daily_low = tempSeries(start, DAY, dailies.map(function(d) { return d.low; }), unit);
    properties.daily_source = over(start, DAY, {longText: {values: dailies.map(function(d) { return d.source; })}});
    properties.daily_condition_code = over(start, DAY, {longText: {values: dailies.map(function(d) { return d.code; })}});
    properties.daily_sunrise = over(start, DAY, {timestamp: {values: dailies.map(function(d) { return d.sun ? d.sun.rise : null; })}});
    properties.daily_sunset = over(start, DAY, {timestamp: {values: dailies.map(function(d) { return d.sun ? d.sun.set : null; })}});
    var dailyCondition = {
      shortText: {values: dailies.map(function(d) { return CONDITIONS[d.code]; })},
      longText: {values: dailies.map(function(d) { return CONDITIONS[d.code]; })}
    };
    if (iconSize && wanted('daily_condition')) {
      dailyCondition.icon = {values: dailies.map(function(d) { return glyph(d.code, iconSize, true); })};
      dailyCondition.image = {values: dailies.map(function(d) { return glyph(d.code, iconSize, false); })};
    }
    properties.daily_condition = over(start, DAY, dailyCondition);
    if (dailies.some(function(d) { return d.probability !== null; })) {
      properties.daily_precipitation = over(start, DAY, {numericValue: {values: dailies.map(function(d) { return d.probability; }), unit: '%', min: 0, max: 100},
        shortText: {values: dailies.map(function(d) { return d.probability === null ? null : Math.round(d.probability) + '%'; })}});
    }
  }
  if (appForecastUsed) {
    properties.app_forecast_updated_at = timestamp(Math.floor(appForecast.updatedAt));
    appFetchTimes.push(options.appForecastFetchedAt);
  }
  var extraToday = byExtraDate[dateKey(today)];
  var appTodayUV = options.appUV && fresh(options.appUVFetchedAt, nowSec) && Array.isArray(options.appUV.days)
    ? options.appUV.days.filter(function(day) {
      return day && day.date === dateKey(today) && finite(day.uvIndex) && day.uvIndex >= 0 && day.uvIndex <= 30 &&
        finite(day.updatedAt) && day.updatedAt > 0 && day.updatedAt <= nowSec + 600 && nowSec - day.updatedAt <= 7 * DAY;
    })[0] : null;
  if (appTodayUV) {
    properties.uv_index = {numericValue:{value:appTodayUV.uvIndex, unit:'', min:0}, shortText:{text:String(appTodayUV.uvIndex)}};
    properties.uv_source = {longText:{text:'ČHMÚ app (clear-sky noon forecast)'}};
    properties.uv_updated_at = timestamp(Math.floor(appTodayUV.updatedAt));
    appFetchTimes.push(options.appUVFetchedAt);
  } else if (extraToday && finite(extraToday.uvIndex) && extraToday.uvIndex >= 0 && extraToday.uvIndex <= 30) {
    // This native field is today's forecast daily peak, not instantaneous UV.
    properties.uv_index = {numericValue: {value: extraToday.uvIndex, unit: '', min: 0}, shortText: {text: String(extraToday.uvIndex)}};
    properties.uv_source = {longText:{text:'Open-Meteo (forecast daily peak)'}};
    properties.uv_updated_at = timestamp(Math.floor(options.supplementalFetchedAt));
    supplementalUsed = true;
  }
  if (extraToday && percent(extraToday.precipitationProbability)) {
    properties.precipitation = {numericValue: {value: extraToday.precipitationProbability, unit: '%', min: 0, max: 100},
      shortText: {text: Math.round(extraToday.precipitationProbability) + '%'}};
    supplementalUsed = true;
  }
  if (supplementalUsed) {
    properties.supplemental_source = {longText: {text: 'Open-Meteo forecast supplement: precipitation probability and forecast gaps/extended days; UV when ČHMÚ app UV is unavailable'}};
    properties.supplemental_updated_at = timestamp(Math.floor(options.supplementalFetchedAt));
  }
  if (appFetchTimes.length) { properties.app_data_fetched_at = timestamp(Math.floor(Math.min.apply(null, appFetchTimes))); }
  return {instanceId: place.id, properties: properties};
}

module.exports = {buildInstance: buildInstance};
