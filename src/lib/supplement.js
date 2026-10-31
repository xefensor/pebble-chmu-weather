// Optional Open-Meteo model data. Never treat these forecasts as station
// observations, and never infer precipitation probabilities from amounts.
var HOUR = 3600;
var DAY = 24 * HOUR;
var HOURLY_UNITS = {time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%',
  precipitation_probability: '%', precipitation: 'mm', weather_code: 'wmo code',
  wind_speed_10m: 'm/s', wind_direction_10m: '°'};
var DAILY_UNITS = {time: 'unixtime', temperature_2m_max: '°C', temperature_2m_min: '°C',
  weather_code: 'wmo code', uv_index_max: '', precipitation_probability_max: '%'};

function finite(value) { return typeof value === 'number' && isFinite(value); }
function bounded(value, low, high) { return finite(value) && value >= low && value <= high ? value : null; }

// WMO definitions: https://open-meteo.com/en/docs#weathervariables
// The shared Pebble vocabulary has no separate fog/thunderstorm category.
function condition(code) {
  if (!finite(code) || Math.floor(code) !== code) { return 'unknown'; }
  if (code === 0 || code === 1) { return 'sun'; }
  if (code === 2) { return 'partly_cloudy'; }
  if (code === 3 || code === 45 || code === 48) { return 'cloudy'; }
  if ([51, 53, 55, 56, 57, 61, 63, 66, 80, 81].indexOf(code) >= 0) { return 'light_rain'; }
  if ([65, 67, 82, 95, 96, 97, 99].indexOf(code) >= 0) { return 'heavy_rain'; }
  if ([71, 73, 77, 85].indexOf(code) >= 0) { return 'light_snow'; }
  if (code === 75 || code === 86) { return 'heavy_snow'; }
  return 'unknown';
}

function validArrays(data, units, expected, maximum) {
  if (!data || !units || !Array.isArray(data.time) ||
      data.time.length < 1 || data.time.length > maximum) { return false; }
  return Object.keys(expected).every(function(key) {
    return units[key] === expected[key] && Array.isArray(data[key]) && data[key].length === data.time.length;
  });
}

function epoch(value, now) {
  return finite(value) && Math.floor(value) === value && value > 0 &&
    value >= now - 2 * DAY && value <= now + 9 * DAY;
}

function emptyHour(time) {
  return {time: time, temperatureC: null, conditionCode: 'unknown', humidity: null,
    windSpeed: null, windDirection: null, precipitationProbability: null, precipitation: null};
}

function dateAt(time, offset) {
  // With timeformat=unixtime Open-Meteo's daily boundaries use the response's
  // fixed utc_offset_seconds, including across an upcoming DST change. Recover
  // the API's actual date key rather than relabelling it through another zone.
  return new Date((time + offset) * 1000).toISOString().slice(0, 10);
}

function emptyDay(time, offset) {
  return {date: dateAt(time, offset), highC: null, lowC: null, conditionCode: 'unknown',
    uvIndex: null, precipitationProbability: null};
}

function parseForecast(json, nowMs) {
  if (!json || json.error || json.timezone !== 'Europe/Prague' || !finite(nowMs) || nowMs <= 0 ||
      (json.utc_offset_seconds !== 3600 && json.utc_offset_seconds !== 7200)) { return null; }
  var hourly = json.hourly;
  var daily = json.daily;
  if (!validArrays(hourly, json.hourly_units, HOURLY_UNITS, 200) ||
      !validArrays(daily, json.daily_units, DAILY_UNITS, 8)) { return null; }
  var now = Math.floor(nowMs / 1000);
  var offset = json.utc_offset_seconds;
  var hours = [];
  var days = [];
  var previous = null;
  var first = null;
  var hasData = false;
  for (var i = 0; i < hourly.time.length; i++) {
    var time = hourly.time[i];
    if (!epoch(time, now) || time % HOUR !== 0 ||
        (previous !== null && time <= previous)) { return null; }
    if (first === null) { first = time; }
    if (time - first >= 200 * HOUR) { return null; }
    while (previous !== null && previous + HOUR < time) {
      previous += HOUR;
      hours.push(emptyHour(previous));
    }
    var hour = {time: time,
      temperatureC: bounded(hourly.temperature_2m[i], -100, 100),
      conditionCode: condition(hourly.weather_code[i]),
      humidity: bounded(hourly.relative_humidity_2m[i], 0, 100),
      windSpeed: bounded(hourly.wind_speed_10m[i], 0, 150),
      windDirection: bounded(hourly.wind_direction_10m[i], 0, 360),
      precipitationProbability: bounded(hourly.precipitation_probability[i], 0, 100),
      precipitation: bounded(hourly.precipitation[i], 0, 1000)};
    if (hour.temperatureC !== null || hour.precipitationProbability !== null) { hasData = true; }
    hours.push(hour);
    previous = time;
  }
  if (previous < Math.floor(now / HOUR) * HOUR) { return null; }
  previous = null;
  first = null;
  for (i = 0; i < daily.time.length; i++) {
    time = daily.time[i];
    if (!epoch(time, now) || (time + offset) % DAY !== 0 ||
        (previous !== null && time <= previous)) { return null; }
    if (first === null) { first = time; }
    if (time - first >= 8 * DAY) { return null; }
    while (previous !== null && previous + DAY < time) {
      previous += DAY;
      days.push(emptyDay(previous, offset));
    }
    var high = bounded(daily.temperature_2m_max[i], -100, 100);
    var low = bounded(daily.temperature_2m_min[i], -100, 100);
    if (high !== null && low !== null && high < low) { high = null; low = null; }
    var day = {date: dateAt(time, offset), highC: high, lowC: low,
      conditionCode: condition(daily.weather_code[i]),
      uvIndex: bounded(daily.uv_index_max[i], 0, 30),
      precipitationProbability: bounded(daily.precipitation_probability_max[i], 0, 100)};
    if (day.highC !== null || day.uvIndex !== null || day.precipitationProbability !== null) { hasData = true; }
    days.push(day);
    previous = time;
  }
  if (previous + DAY <= now || !hasData) { return null; }
  return {hours: hours, days: days, timezone: 'Europe/Prague'};
}

module.exports = {parseForecast: parseForecast};
