/* Local review fixture only. Injected into the real config page by the preview
   builder; never included in plugin.js, config.html or a release PBW. */
(function () {
  'use strict';
  var query = new URLSearchParams(location.search), language = query.get('lang') === 'cs' ? 'cs' : 'en';
  Object.defineProperty(navigator, 'language', { configurable: true, value: language });
  document.documentElement.setAttribute('data-review-theme', query.get('theme') === 'dark' ? 'dark' : 'light');
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var now = Math.floor(Date.now() / 1000), failSave = false, failRefresh = false, changedStation = false;
  var locationId = 'demo-praha', calls = [], toolbar;
  var state = {
    version: '1.0.4', buildVariant: 'public', capabilities: { appService: false },
    settings: { stations: {}, completeWeather: true, appData: false, uvSource: 'open-meteo', revision: 0 },
    locations: []
  };
  function readings() {
    if (query.get('scenario') === 'empty') return [];
    var selected = state.settings.stations[locationId], name = selected === 'demo-kbely' ? 'Praha-Kbely' : 'Praha-Libuš';
    var row = {
      id: locationId, name: 'Praha', temperature: changedStation ? '4°C' : '5°C',
      isForecast: false, station: name, stationId: selected || 'demo-libus',
      temperatureSource: 'ČHMÚ station observation · simulated example', stationStatus: 'available',
      stationReason: 'Local review fixture', observedAt: now - 300, measurementAgeSec: 300,
      lastSuccessfulFetch: now, humidity: '68%', wind: '12 km/h', feelsLike: '2°C',
      humiditySource: 'Same station and observation time', windSource: 'Same station and observation time',
      feelsLikeSource: 'Calculated shade estimate', distanceKm: selected ? 7 : 5,
      forecastDays: state.settings.completeWeather ? 7 : 3,
      eligibleStations: [
        { id: 'demo-libus', name: 'Praha-Libuš', distanceKm: 5, elevation: 302 },
        { id: 'demo-kbely', name: 'Praha-Kbely', distanceKm: 7, elevation: 285 }
      ]
    };
    if (state.settings.completeWeather) {
      row.precipitation = 40; row.supplementalSource = 'Open-Meteo · simulated example';
      if (state.settings.uvSource === 'open-meteo') {
        row.uvIndex = 1; row.uvSource = 'Open-Meteo'; row.uvUpdatedAt = now - 600;
      }
    }
    return [row];
  }
  state.locations = readings();
  function appendLog(message) {
    calls.push(clone(message));
    var entry = document.createElement('li'); entry.textContent = message.type;
    document.getElementById('review-call-log').appendChild(entry);
  }
  window.Pebble = {
    addEventListener: function (type, callback) {
      if (type === 'ready') Promise.resolve().then(function () { callback({ target: 'plugin' }); });
    },
    sendMessage: function (target, message) {
      if (target !== 'plugin') return Promise.reject(new Error('Only the local plugin fixture is supported'));
      appendLog(message);
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          var saving = ['setStation', 'setCompleteWeather', 'setUVSource'].indexOf(message.type) >= 0;
          if (saving && failSave) {
            failSave = false; document.getElementById('review-fixture-status').textContent = 'Save failure delivered';
            reject(new Error('Pebble could not save settings. Check available storage and try again.')); return;
          }
          if (message.type === 'refresh' && failRefresh) {
            failRefresh = false; state.refreshError = 'Weather could not be refreshed. Check the location details below.';
            document.getElementById('review-fixture-status').textContent = 'Refresh failure delivered';
            resolve(clone(state)); return;
          }
          delete state.refreshError;
          if (message.type === 'setStation') {
            changedStation = true;
            if (message.stationId) state.settings.stations[message.locationId] = message.stationId;
            else delete state.settings.stations[message.locationId];
            state.settings.revision++; state.locations = [];
          } else if (message.type === 'setCompleteWeather') {
            state.settings.completeWeather = message.enabled; state.settings.revision++; state.locations = [];
          } else if (message.type === 'setUVSource') {
            state.settings.uvSource = message.source; state.settings.revision++; state.locations = [];
          } else if (message.type === 'refresh') state.locations = readings();
          else if (message.type !== 'getState') { reject(new Error('Unsupported fixture operation')); return; }
          resolve(clone(state));
        }, 450);
      });
    },
    openUrl: function (url) {
      document.getElementById('review-fixture-status').textContent = 'External link blocked in review: ' + url;
    }
  };
  // The settings page should never need fetch; this fixture cannot contact a provider.
  window.fetch = function () { return Promise.reject(new Error('Network disabled in local settings review')); };
  toolbar = document.createElement('aside'); toolbar.className = 'review-toolbar';
  toolbar.setAttribute('aria-label', 'Local review controls');
  toolbar.innerHTML = '<strong>Unpublished settings candidate · simulated data</strong><p>The settings below run their original page code against a local fixture. No weather service, phone action or account is used.</p><nav aria-label="Review appearance"><a href="?lang=en&amp;theme=light">English · light</a><a href="?lang=en&amp;theme=dark">English · dark</a><a href="?lang=cs&amp;theme=light">Česky · světlé</a><a href="?lang=cs&amp;theme=dark">Česky · tmavé</a><a href="?lang=' + language + '&amp;theme=' + (query.get('theme') === 'dark' ? 'dark' : 'light') + '&amp;scenario=empty">No locations</a></nav><div><button type="button" id="review-fail-save">Fail next save</button><button type="button" id="review-fail-refresh">Fail next refresh</button><button type="button" id="review-reset">Reset fixture</button></div><p id="review-fixture-status" role="status">Fixture ready · replies delayed 450 ms</p><details><summary>Fixture request log</summary><ol id="review-call-log"></ol></details>';
  document.body.insertBefore(toolbar, document.body.firstChild);
  document.getElementById('review-fail-save').onclick = function () { failSave = true; document.getElementById('review-fixture-status').textContent = 'Next save will fail'; };
  document.getElementById('review-fail-refresh').onclick = function () { failRefresh = true; document.getElementById('review-fixture-status').textContent = 'Next refresh will fail'; };
  document.getElementById('review-reset').onclick = function () { location.reload(); };
})();
