# Privacy

ČHMÚ Weather has no advertisements, analytics or server operated by its
developer, and does not ask you to sign in. It reads weather locations and unit
preferences from Pebble. The current-location entry requests an approximate
phone position with Location permission; fixed saved locations do not request
GPS.

## Requests to weather providers

Nearest forecast towns and stations are selected locally from a bundled
catalogue. Public ČHMÚ graph requests identify a forecast-town ID or station ID
rather than sending the phone's raw GPS coordinates.

The default settings enable **Use ČHMÚ full-day forecasts**, Open-Meteo
completion and the **ČHMÚ** UV source. Their network controls are separate:

- **Use ČHMÚ full-day forecasts** requests three-day local daily aggregates
  from the official app service. It controls daily forecasts only.
- Choosing **ČHMÚ** under **Preferred UV source** requests that service's clear-sky noon
  UV even when full-day forecasts are off. Choosing Open-Meteo or Off stops this
  ČHMÚ UV channel. To avoid all ČHMÚ app-service requests, turn off full-day
  forecasts and choose a UV source other than ČHMÚ.
- **Use Open-Meteo to complete missing weather data** requests rain
  probabilities, missing weather fields and forecasts up to seven days.
  Choosing Open-Meteo UV requires this switch to be on; the selector never
  enables it automatically. When the switch is off, there are no Open-Meteo
  requests or cached Open-Meteo values in output, including UV fallback.

When upgrading from 0.3.0, an existing disabled ČHMÚ app-data setting stays
respected: UV starts on Open-Meteo if completion was enabled, or Off if both
sources were disabled. New installations default to ČHMÚ UV.

App-service and Open-Meteo requests send the public coordinates of the nearby
forecast town, not the phone's raw GPS position or your saved location name.
When either app-service channel is needed, the plugin creates a persistent
random installation ID and obtains its own login and refresh credentials.
These identify this plugin installation; they are not your Android ID, account
credentials or credentials copied from another app installation. With both
app-service channels disabled, its cached data is excluded as well.

ČHMÚ station measurements and valid public ALADIN fields remain the primary
sources for current temperature and hourly forecasts. The app service receives
no request for the phone's actual Android identifier.

The plugin uses these network domains:

| Domain | Purpose |
| --- | --- |
| `data-provider.chmi.cz` | Public ČHMÚ live station and ALADIN forecast graphs |
| `opendata.chmi.cz` | Backup ČHMÚ station observations |
| `chmu.rails.cz` | ČHMÚ app installation authentication, local daily aggregates and clear-sky noon UV |
| `api.open-meteo.com` | Optional additional forecast fields and extended days |

Pebble asks for the plugin's declared network permissions through its normal
permission flow. The network domains are unchanged from version 0.3.0.

Each provider can observe the connecting network's IP address and the requested
town, station or forecast coordinates, as with other web requests. The ČHMÚ
app service can associate its requests with the random installation ID and
service session. No weather requests, credentials or location data are sent to
the developer. Provider policies: [ČHMÚ](https://www.chmi.cz/) and
[Open-Meteo](https://open-meteo.com/en/terms#privacy).

Disabling a source stops future requests for that source and excludes its
cached values. A request already sent can finish, but an obsolete update does
not replace readings under the new settings. Disabling full-day forecasts
alone does not disable ČHMÚ UV or its installation authentication. UV Off omits
UV; Open-Meteo may still be contacted for other enabled completion fields.
Previously delivered weather remains subject to Pebble or each watchface's own
storage behavior.

## Local storage and calculations

Weather responses, station choices, source settings and the latest
diagnostic per location are stored locally in Pebble's plugin storage. When
a ČHMÚ app-service channel is used, the random installation ID is stored locally so
future requests can reuse the same installation. Service credentials use
Pebble's secure storage when available, with local plugin storage as a fallback
on older runtimes that do not provide it.

The public ČHMÚ/Open-Meteo resource cache retains at most 16 records, and the
ČHMÚ app cache retains at most another 16. These records include station/town
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
Installation login/refresh and secure credential handling are unchanged.

Feels-like temperature and sunrise/sunset are calculated inside the plugin.
Those calculations do not contact an additional service. Removing the plugin
removes its data according to the Pebble app's storage behavior.

If Location or network access is denied, the plugin may be unable to provide
weather. It never circumvents a denied location-source permission by requesting
GPS instead. Pebble's own provider integration or a consuming watchface may
retain its own cached weather or choose a fallback independently.
