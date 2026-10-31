'use strict';
var createClient = require('../lib/client');
var client = createClient({
  catalog: require('../catalog.json'), storage: localStorage,
  secureStorage: Pebble.secureStorage,
  fetch: function(url, init) { return fetch(url, init); }, geolocation: navigator.geolocation,
  readSource: function(request) { return Pebble.readSource(request); },
  subscribeSource: function(request) { return Pebble.subscribeSource(request); },
  now: function() { return Date.now(); },
  later: function(fn, delay) { return setTimeout(fn, delay); },
  cancelLater: function(timer) { clearTimeout(timer); }
});

Pebble.registerSourceHandler(async function(request, respond) {
  try { respond.data(await client.getWeather(request)); }
  catch (error) { respond.error(error.code || 'PLUGIN_UNAVAILABLE', error.message || 'ČHMÚ weather unavailable'); }
});
Pebble.registerConfigHandler(async function(message, respond) {
  try {
    if (message.type === 'getState') { respond(client.state()); }
    else if (message.type === 'setStation') {
      var state = client.setStation(message.locationId, message.stationId);
      Pebble.refreshSources(['weather/location']);
      respond(state);
    } else if (message.type === 'setCompleteWeather') {
      var updated = client.setCompleteWeather(message.enabled);
      Pebble.refreshSources(['weather/location']);
      respond(updated);
    } else if (message.type === 'setAppData') {
      var appState = client.setAppData(message.enabled);
      Pebble.refreshSources(['weather/location']);
      respond(appState);
    } else if (message.type === 'refresh') {
      await client.getWeather({category:'weather', item:'location'}, true);
      Pebble.refreshSources(['weather/location']);
      respond(client.state());
    } else { respond({error:'Unknown settings request'}); }
  } catch (error) { respond({error:error.message || 'Could not update settings'}); }
});
