# Privacy

This notice distinguishes the public release from the separately labelled
**ČHMÚ Weather Personal** build. The public build does not include the
authenticated ČHMÚ mobile-app service or request permission for its domain.

ČHMÚ Weather has no advertisements, analytics or server operated by its
developer, and does not ask you to sign in. It reads weather locations and unit
preferences from Pebble. The current-location entry requests an approximate
phone position with Location permission; fixed saved locations do not request
GPS.

## Requests to weather providers

Nearest forecast towns and stations are selected locally from a bundled
catalogue. Public ČHMÚ graph requests identify a forecast-town ID or station ID
rather than sending the phone's raw GPS coordinates.

The public build defaults to Open-Meteo completion and **Open-Meteo** UV:

- **Use Open-Meteo to complete missing weather data** requests rain
  probabilities, missing weather fields and forecasts up to seven days.
  Choosing Open-Meteo UV requires this switch to be on; the selector never
  enables it automatically. When the switch is off, there are no Open-Meteo
  requests or cached Open-Meteo values in output, including UV fallback.

The public build enforces app-service exclusion even if settings from an older
release enabled it. An old ČHMÚ UV preference becomes Open-Meteo when completion
is enabled, or Off otherwise. Explicit Open-Meteo/Off preferences remain.
Old app-service cached values and diagnostic readings are excluded. The public
build does not obtain app-service credentials or read Pebble's secure storage.

Open-Meteo requests send the public coordinates of the nearby forecast town,
not the phone's raw GPS position or your saved location name.

ČHMÚ station measurements and valid public ALADIN fields remain the primary
sources for current temperature and hourly forecasts.

The public build declares these network domains:

| Domain | Purpose |
| --- | --- |
| `data-provider.chmi.cz` | Public ČHMÚ live station and ALADIN forecast graphs |
| `opendata.chmi.cz` | Backup ČHMÚ station observations |
| `api.open-meteo.com` | Optional additional forecast fields and extended days |

Pebble asks for the plugin's declared network permissions through its normal
permission flow. Version 1.0.1 removes the app-service domain from the public
manifest.

Each provider can observe the connecting network's IP address and the requested
town, station or forecast coordinates, as with other web requests.
No weather requests, credentials or location data are sent to
the developer. Provider policies: [ČHMÚ](https://www.chmi.cz/) and
[Open-Meteo](https://open-meteo.com/en/terms#privacy).

Disabling a source stops future requests for that source and excludes its
cached values. A request already sent can finish, but an obsolete update does
not replace readings under the new settings. UV Off omits
UV; Open-Meteo may still be contacted for other enabled completion fields.
Previously delivered weather remains subject to Pebble or each watchface's own
storage behavior.

## Local storage and calculations

Weather responses, station choices, source settings and the latest
diagnostic per location are stored locally in Pebble's plugin storage.

The public ČHMÚ/Open-Meteo resource cache retains at most 16 records. These
records include station/town
IDs and may include coarse forecast-town or model-grid coordinates and other
provider response metadata. Cache metadata can also contain HTTP validators
(ETag or Last-Modified), the last check time and the original body-download time.
They are not a raw GPS history and are not uploaded to the developer. Diagnostics contain the place and station names,
measurement time and age, displayed weather, source information, original UV
update time, eligible nearby station choices, status and last successful update. They do not display service credentials.

A separate bounded history retains already-past ALADIN forecast temperature
and condition values for today's Prague date: at most 16 public forecast points
and 25 hourly samples per point. Records use the public point ID and coordinates,
date and original forecast download time. They contain no phone GPS history or
station measurements. A later model run can use them only as past forecast
context. Previous-day records are removed when the history is next accessed.

Conditional GETs send a weather response's ETag or Last-Modified value back to
the same service when rechecking it. They do not change the selected locations
or services. A 304 updates the check time without changing data ages. Weather
responses marked `no-store` are not persisted as reusable weather bodies.
Their values can still appear in the current reply and derived diagnostics.
An ALADIN `no-store` response also removes that public point's retained forecast
context.

## Personal build only: ČHMÚ app service

The separately labelled **ČHMÚ Weather Personal** build has its own plugin
UUID and storage, and additionally declares `chmu.rails.cz` internet access.
It is not included in the public PBW or Store package. This service's
third-party access terms remain unconfirmed; attribution is not treated as
permission to use the authenticated service.

Its default settings enable **Use ČHMÚ full-day forecasts** and **ČHMÚ** UV:

- **Use ČHMÚ full-day forecasts** requests three-day local daily aggregates.
  It controls daily forecasts only.
- Choosing **ČHMÚ** under **Preferred UV source** requests clear-sky noon UV
  even when full-day forecasts are off. Open-Meteo or Off stops this UV channel.
- To stop all app-service requests and exclude its cached values, turn off
  full-day forecasts and select Open-Meteo or Off for UV.

App-service requests send the public coordinates of the selected forecast
town. They do not send raw phone GPS, a saved location name or the phone's
actual Android identifier. When either channel is needed, this build creates
a persistent random installation ID and obtains its own login/refresh
credentials. They identify this plugin installation, and are not account
credentials or credentials copied from another app. Nothing is embedded in
the distributed PBW.

The installation ID is stored locally. Credentials use Pebble secure storage
when available, with local plugin storage as a fallback on older runtimes.
The app cache retains at most 16 additional records. The service can associate
requests with the random installation ID and service session; no credentials
are shown in diagnostics or sent to the developer. Disabling full-day
forecasts alone does not disable ČHMÚ UV or its authentication. A request
already sent can finish after a setting changes.

## Local calculations and denied permissions

Feels-like temperature and sunrise/sunset are calculated inside both builds.
Those calculations do not contact an additional service. Removing the plugin
removes its data according to the Pebble app's storage behavior.

If Location or network access is denied, the plugin may be unable to provide
weather. It never circumvents a denied location-source permission by requesting
GPS instead. Pebble's own provider integration or a consuming watchface may
retain its own cached weather or choose a fallback independently.
