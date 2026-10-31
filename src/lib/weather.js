// Parsing and location selection for the official CHMI graph endpoints.
// Observations and model forecasts deliberately remain separate data types.
var HOUR = 3600;
var FORECAST_HOURS = 73;
var EARTH_RADIUS_KM = 6371.0088;
var MAX_OBSERVATION_ROWS = 25000;

function finite(value) { return typeof value === 'number' && isFinite(value); }

function numeric(value) {
  if (finite(value)) { return value; }
  if (typeof value !== 'string') { return null; }
  var text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) { return null; }
  var number = Number(text);
  return finite(number) ? number : null;
}

function bounded(value, low, high) {
  var number = numeric(value);
  return number !== null && number >= low && number <= high ? number : null;
}

// Date.parse accepts local timestamps and can normalize impossible dates.
// Both CHMI endpoints supply UTC: require it explicitly and check the fields.
function utcSeconds(text) {
  if (typeof text !== 'string') { return null; }
  var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|\+00:00)$/.exec(text);
  if (!match) { return null; }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var hour = Number(match[4]);
  var minute = Number(match[5]);
  var second = Number(match[6]);
  var time = Date.UTC(year, month - 1, day, hour, minute, second);
  var date = new Date(time);
  if (!finite(time) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) { return null; }
  return time / 1000 + (match[7] ? Number('0.' + match[7]) : 0);
}

function parseObservation(json, nowMs, maxAgeSec) {
  if (maxAgeSec === undefined) { maxAgeSec = HOUR; }
  if (!json || !finite(nowMs) || nowMs <= 0 ||
      !finite(maxAgeSec) || maxAgeSec < 0) { return null; }
  var now = Math.floor(nowMs / 1000);
  var newest = null;
  function consider(timestamp, value, quality) {
    var observed = utcSeconds(timestamp);
    var temperature = bounded(value, -100, 100);
    if (observed === null || observed <= 0 || temperature === null ||
        observed > now + 300 || now - observed > maxAgeSec) { return; }
    if (!newest || observed > newest.observedAt) {
      newest = {temperatureC: temperature, observedAt: Math.floor(observed)};
      if (quality) { newest.quality = quality; }
    }
  }
  if (Array.isArray(json.dataPoints)) {
    if (json.dataPoints.length > MAX_OBSERVATION_ROWS) { return null; }
    json.dataPoints.forEach(function(point) {
      if (point && point.values) { consider(point.timestamp, point.values.T); }
    });
    return newest;
  }
  // Open-data daily station files are an independent official measurement
  // path. Column lookup protects against reordered headers and other elements.
  var bulk = json.data && json.data.data;
  if (!bulk || !Array.isArray(bulk.values) ||
      bulk.values.length > MAX_OBSERVATION_ROWS) { return null; }
  var header = typeof bulk.header === 'string' && bulk.header.length <= 1000
    ? bulk.header.split(',').map(function(name) { return name.trim(); }) : bulk.header;
  if (!Array.isArray(header)) { return null; }
  var stationColumn = header.indexOf('STATION');
  var elementColumn = header.indexOf('ELEMENT');
  var timeColumn = header.indexOf('DT');
  var valueColumn = header.indexOf('VAL');
  var flagColumn = header.indexOf('FLAG');
  var qualityColumn = header.indexOf('QUALITY');
  if (stationColumn < 0 || elementColumn < 0 || timeColumn < 0 || valueColumn < 0 || qualityColumn < 0) { return null; }
  var station = null;
  var mixedStations = false;
  bulk.values.forEach(function(row) {
    if (!Array.isArray(row) || row[elementColumn] !== 'T') { return; }
    var id = row[stationColumn];
    if (typeof id !== 'string' || !id) { return; }
    if (station !== null && station !== id) { mixedStations = true; }
    station = id;
    // Official meta4: 0 good, 1 suspect, 2 poor, 3 estimated, 4 missing,
    // 5 unknown. Operative measured data commonly has quality 5: retain that
    // distinction instead of calling it a verified observation.
    var quality = numeric(row[qualityColumn]);
    if (quality !== 0 && quality !== 5) { return; }
    // No temperature-specific FLAG mapping is published in current meta3.
    // Do not silently accept an unexplained flag on a current measurement.
    if (flagColumn >= 0 && row[flagColumn] !== '' && row[flagColumn] !== null) { return; }
    consider(row[timeColumn], row[valueColumn], quality === 0 ? 'good' : 'unknown');
  });
  if (mixedStations) { return null; }
  return newest;
}

function emptyHour(time) {
  return {time: time, temperatureC: null, conditionCode: 'unknown', humidity: null,
    windSpeed: null, windDirection: null, precipitation: null, cloudsTotal: null, icon: null};
}

// Official legend: https://www.chmi.cz/predpoved-pocasi/ikony-pocasi
// Its image filenames identify these codes (for example 40.svg = Polojasno,
// 41.svg = Polojasno, přeháňka). Only explicitly published variants are listed.
// Pebble has no fog, freezing-rain, thunder or hail codes. Fog is represented
// by cloudy and freezing rain by rain. Thunder/hail require wet quantitative
// data or remain unknown, never clear. Rain/snow intensity comes from mm/h.
var ICON_CONDITIONS = {
  10:'sun', 20:'sun', 110:'sun', 120:'sun',
  40:'partly_cloudy', 140:'partly_cloudy',
  60:'cloudy', 70:'cloudy', 80:'cloudy', 90:'cloudy',
  160:'cloudy', 170:'cloudy',
  41:'rain', 61:'rain', 62:'rain', 71:'rain', 72:'rain',
  81:'rain', 82:'rain', 91:'rain', 92:'rain',
  141:'rain', 161:'rain', 162:'rain', 171:'rain', 172:'rain',
  43:'rain_and_snow', 63:'rain_and_snow', 73:'rain_and_snow',
  83:'rain_and_snow', 93:'rain_and_snow',
  143:'rain_and_snow', 163:'rain_and_snow', 173:'rain_and_snow',
  45:'snow', 64:'snow', 65:'snow', 74:'snow', 75:'snow',
  84:'snow', 85:'snow', 94:'snow',
  145:'snow', 164:'snow', 165:'snow', 174:'snow', 175:'snow',
  46:'unsupported_wet', 66:'unsupported_wet', 69:'unsupported_wet',
  76:'unsupported_wet', 79:'unsupported_wet', 86:'unsupported_wet', 89:'unsupported_wet',
  146:'unsupported_wet', 166:'unsupported_wet', 169:'unsupported_wet',
  176:'unsupported_wet', 179:'unsupported_wet'
};

function conditionCode(temperature, precipitation, clouds, icon) {
  var known = icon !== null && Object.prototype.hasOwnProperty.call(ICON_CONDITIONS, icon)
    ? ICON_CONDITIONS[icon] : null;
  if (known === 'rain') { return precipitation >= 5 ? 'heavy_rain' : 'light_rain'; }
  if (known === 'snow') { return precipitation >= 2 ? 'heavy_snow' : 'light_snow'; }
  if (known === 'unsupported_wet') {
    if (!(precipitation > 0)) { return 'unknown'; }
    known = null;
  }
  if (known) { return known; }
  // Unknown or unrepresentable icons can still use model quantities. An absent
  // required quantity remains unknown rather than inventing a weather state.
  if (precipitation === null) { return 'unknown'; }
  if (precipitation > 0) {
    if (temperature === null) { return 'unknown'; }
    if (temperature <= 0) { return precipitation >= 2 ? 'heavy_snow' : 'light_snow'; }
    if (temperature < 2) { return 'rain_and_snow'; }
    return precipitation >= 5 ? 'heavy_rain' : 'light_rain';
  }
  if (clouds === null) { return 'unknown'; }
  if (clouds <= 20) { return 'sun'; }
  if (clouds <= 70) { return 'partly_cloudy'; }
  return 'cloudy';
}

function parseForecast(json, nowMs) {
  if (!json || !Array.isArray(json.data) || !json.data.length ||
      json.data.length > FORECAST_HOURS || !finite(nowMs) || nowMs <= 0) { return null; }
  var temperatureUnit = json.parameters && json.parameters.t2m && json.parameters.t2m.unit;
  if (temperatureUnit !== undefined && temperatureUnit !== '°C') { return null; }
  var hours = [];
  var first = null;
  var previous = null;
  var hasTemperature = false;
  for (var i = 0; i < json.data.length; i++) {
    var row = json.data[i];
    var time = row && utcSeconds(row.validityTime);
    if (time === null || time <= 0 || time % HOUR !== 0 ||
        (previous !== null && time <= previous)) { return null; }
    if (first === null) { first = time; }
    if (time - first >= FORECAST_HOURS * HOUR) { return null; }
    while (previous !== null && previous + HOUR < time) {
      previous += HOUR;
      hours.push(emptyHour(previous));
    }
    var temperature = bounded(row.t2m, -100, 100);
    var precipitation = bounded(row.prec, 0, 1000);
    var clouds = bounded(row.cloudsTot, 0, 100);
    var icon = bounded(row.icon, 0, 100000);
    icon = icon !== null && Math.floor(icon) === icon ? icon : null;
    var hour = {
      time: time, temperatureC: temperature,
      conditionCode: conditionCode(temperature, precipitation, clouds, icon),
      humidity: bounded(row.rh2m, 0, 100),
      windSpeed: bounded(row.windSpeed, 0, 150),
      windDirection: bounded(row.windDirection, 0, 360),
      precipitation: precipitation, cloudsTotal: clouds,
      icon: icon
    };
    if (temperature !== null) { hasTemperature = true; }
    hours.push(hour);
    previous = time;
  }
  if (!hasTemperature || previous < Math.floor(nowMs / 1000 / HOUR) * HOUR) { return null; }
  var result = {hours: hours};
  var elevation = bounded(json.z, -500, 10000);
  if (elevation !== null) { result.elevation = elevation; }
  // The endpoint has no model issue/generation time. Do not invent one.
  return result;
}

function coordinates(latitude, longitude) {
  return finite(latitude) && finite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function distanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  if (!coordinates(latitudeA, longitudeA) || !coordinates(latitudeB, longitudeB)) { return null; }
  var radians = Math.PI / 180;
  var latitudeDelta = (latitudeB - latitudeA) * radians;
  var longitudeDelta = (longitudeB - longitudeA) * radians;
  var sineLat = Math.sin(latitudeDelta / 2);
  var sineLon = Math.sin(longitudeDelta / 2);
  var a = sineLat * sineLat + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians) * sineLon * sineLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

function nearest(catalog, latitude, longitude, maxDistanceKm) {
  if (maxDistanceKm === undefined) { maxDistanceKm = Infinity; }
  if (!Array.isArray(catalog) || !coordinates(latitude, longitude) ||
      typeof maxDistanceKm !== 'number' || isNaN(maxDistanceKm) || maxDistanceKm < 0) { return null; }
  var best = null;
  catalog.forEach(function(point) {
    if (!point) { return; }
    var distance = distanceKm(latitude, longitude, point.latitude, point.longitude);
    if (distance !== null && distance <= maxDistanceKm && (!best || distance < best.distanceKm)) {
      best = {point: point, distanceKm: distance};
    }
  });
  return best;
}

module.exports = {parseObservation: parseObservation, parseForecast: parseForecast,
  nearest: nearest, distanceKm: distanceKm};
