# ČHMÚ Weather for Pebble

Unofficial weather plugin by Xef. Nearby ČHMÚ station measurements supply the
current temperature, humidity and wind when the station reports them together.
ALADIN supplies local forecasts. ČHMÚ app data adds full-day local ranges and
clear-sky noon UV, with separate controls for each. When enabled, Open-Meteo completes
missing weather fields, rain probabilities and forecasts up to seven days.

The plugin serves Pebble's standard `weather/location` source and runs inside
the Pebble phone app. No API key, user sign-in, separate Android app or
developer-operated server is needed.

## Install 1.0.0

[Settings preview: English/light](docs/images/settings-en-light.png) · [Czech/dark](docs/images/settings-cs-dark.png)

1. Use a Pebble mobile app supporting the plugin APIs. In 1.16.x, enable
   **Settings → Plugins → Plugins / permissions preview** if required. Labels
   may change between app versions.
2. Open [CHMU-Weather-1.0.0.pbw](dist/CHMU-Weather-1.0.0.pbw) with the Pebble app.
3. Allow Location and internet access to `data-provider.chmi.cz`,
   `opendata.chmi.cz`, `chmu.rails.cz` and `api.open-meteo.com` through Pebble's
   normal permission flow.
4. Select **Settings → Weather → Weather provider → ČHMÚ Weather**. This feeds
   the watch's Weather app and timeline, and watchfaces using Pebble weather.
   Your saved weather locations and units are used automatically.
5. Open the plugin settings, refresh the data, and inspect the current reading
   and measured/forecast status. Choose a nearby station or leave selection on
   Automatic. Source timestamps and technical details remain available under
   **Source details**.

Plugin-aware watchfaces can also select ČHMÚ Weather directly as a source.
Version **1.0.0** is the prepared stable release. If publishing is enabled for
your developer account, use the exact PBW and assets in the store package.
Preparing these files does not submit a Store listing. The earlier 0.5.1 runtime
fix was reported working; current live-service and physical-device validation
limits are recorded separately in [validation](docs/VALIDATION.md).
[Source archive](dist/CHMU-Weather-1.0.0-source.zip) and
[prepared store package](dist/CHMU-Weather-1.0.0-store-package.zip) are included.
Read the [publishing checklist](store/PUBLISHING.md) before uploading.

## Settings

The settings page follows English/Czech phone language and light/dark appearance.
**Latest loaded readings** puts current values and station selection first.
**Forecast sources** keeps daily forecasts, UV and Open-Meteo independent;
**Source details** expands timestamps and provenance. **Setup and help** explains
Weather provider selection and coverage. Weather calculations, defaults, source permissions and cache freshness
rules are retained. UI text and diagnostics do not redefine a forecast as a
measurement.


## Weather sources

| Reading | Source and behavior |
| --- | --- |
| Current temperature | ČHMÚ station measurement, at most one hour old; otherwise a forecast marked `~` in direct plugin readings |
| Humidity and wind | Measurements from the temperature station at the same timestamp when available; each missing field falls back to public ALADIN, then enabled Open-Meteo |
| Conditions | Public ALADIN forecast, with enabled Open-Meteo filling missing values |
| Hourly series | 48 slots for today and tomorrow; the active slot uses a fresh station measurement, forecasts supply other slots, and retained ALADIN context can fill missing past hours |
| Daily forecast | Fresh ČHMÚ full-day aggregates first, then complete ALADIN ranges; enabled Open-Meteo supplies full days when ALADIN is incomplete, up to seven days |
| UV | Separate choice of ČHMÚ clear-sky noon UV, Open-Meteo cloud-aware forecast peak, or Off |
| Precipitation probability | Open-Meteo hourly and daily probabilities; never inferred from rainfall amounts |
| Feels-like temperature | Calculated shade estimate using the displayed temperature, relative humidity and sustained 10 m wind, when all inputs are usable |
| Sunrise and sunset | Calculated locally with SunCalc |

Two forecast settings are on by default:

- **ČHMÚ full-day forecasts** adds the app service's three-day local
  aggregates. This checkbox controls daily ranges and conditions only.
- **Complete with Open-Meteo** adds rain probabilities,
  missing fields and later local forecast days. Turning it off prevents all
  Open-Meteo requests and use of cached Open-Meteo values.

The separate **UV source** setting has three choices:

| Choice | Behavior |
| --- | --- |
| ČHMÚ — default | Clear-sky noon UV from the official app service; Open-Meteo forecast peak is a fallback only when completion is enabled |
| Open-Meteo | Cloud-aware forecast daily peak; requires Open-Meteo completion to be enabled |
| Off | Omits UV from plugin output |

ČHMÚ UV assumes clear skies at noon and can be higher than the value expected
under cloud cover. Neither UV option is an instantaneous measurement. Settings
show the actual source, ČHMÚ's original update time or Open-Meteo's download
time. Selecting
Open-Meteo while completion is off shows an instruction to enable completion;
it does not enable that service automatically.

ČHMÚ UV works with **ČHMÚ full-day forecasts** off. To stop requests to the
ČHMÚ app service, turn off full-day forecasts and choose Open-Meteo or Off for
UV. The plugin creates its own random installation ID and service credentials
when that service is needed; you do not sign in. With both forecast settings
off and UV Off, public ČHMÚ observations, ALADIN and local calculations still
work. Rain probabilities and later forecast days can be absent.

When upgrading from 0.3.0, an existing disabled ČHMÚ app-data setting stays
respected: UV starts on Open-Meteo if completion was enabled, or Off if both
sources were disabled. New installations default to ČHMÚ UV.

Changing a source setting excludes its disabled cached values. A request
already sent can finish; obsolete updates do not replace the current readings.
Turning a source off does not retract weather already stored by Pebble or
another watchface. See [privacy information](PRIVACY.md) for network and storage
details.

For České Budějovice, automatic station selection normally chooses **Rožnov**.
Automatic mode can try up to three eligible nearby stations when the first has
no usable fresh temperature, within the request's time budget. A manually
chosen station stays fixed. Missing humidity or wind never causes a reading
from another station or timestamp to be silently attached to that temperature.
Temperature retains decimal precision and rounds only once for display in the
chosen Celsius or Fahrenheit unit. The actual observation timestamp controls
freshness: downloading the same measurement never makes it younger.

Current and future forecasts can be reused offline for up to **six hours**
from the original body download. ČHMÚ app daily aggregates also require a source
update age of at most six hours; UV records require today's date and an original
update no more than seven days old. Rechecking an unchanged response does not
reset these ages.

The plugin retains ALADIN temperature and condition forecasts for already-past
hours of today's Prague date. If a later model run drops the morning, those
previously downloaded hours can preserve context for today's range. They remain
forecasts and cannot supply current or future weather. A cold start midway
through the day cannot reconstruct hours the plugin never received.

ČHMÚ full-day aggregates still take priority. If today's ALADIN coverage remains
incomplete and completion is enabled, the plugin uses Open-Meteo's full-day
range. With completion off, an available partial ALADIN range is labelled as
partial in settings and source metadata; Pebble's native bridge may omit that
label. Future ALADIN daily ranges require complete coverage. The national ČHMÚ
outlook is not presented as a local forecast.

Conditions use ČHMÚ's published icon meanings where available. Pebble's shared
condition vocabulary is less detailed, so fog, freezing rain and some severe
weather symbols cannot be represented exactly. Unknown symbols use a
quantitative fallback only when its inputs support it.

Direct source subscriptions request a **30-minute** refresh interval. Native
Weather uses the Pebble phone app's own schedule (about hourly in the inspected
version); the plugin cannot force that importer to run every 30 minutes.
Station HTTP results can be reused for five minutes and forecasts for
30 minutes across consumers. The settings Refresh button bypasses those short
reuse windows; failures retain usable cached data with its original timestamps.

Pebble plugins cannot use JavaScript timers. The client checks its six-second
HTTP limits and 17-second overall budget before starting work and when bridge
calls finish. A pending call cannot be interrupted by those checks; Pebble
enforces the final 20-second source-session timeout. GPS uses its native
timeout, capped at seven seconds or the remaining request budget.

When a weather service supplies an ETag or Last-Modified validator, the next
check can use a conditional GET. An HTTP 304 reuses the validated body while
preserving its original download, source and measurement times. It reduces
response payloads where supported; the inspected ČHMÚ app endpoints support
this, while the public graphs and Open-Meteo did not provide validators.
Refresh timing and the six-hour forecast limit stay the same. Responses marked
`no-store` are not saved as weather bodies or retained forecast context.

Settings distinguish stale readings, network failures and places outside
coverage. They retain the last successful download time and show the station
measurement's age. A download time does not replace the measurement timestamp.

## Coverage and Pebble limitations

The bundled catalogue covers Czech temperature stations and ALADIN town
points. A forecast town and measurement station must be within 30 km.
When the model reports elevation, automatic selection requires stations within
150 m of it and tries nearby alternatives from that suitable group. The station
picker lists supported choices within 30 km with distance and elevation. A station does not measure the
exact street or microclimate where the phone is. Unsupported places are
omitted; Pebble's provider integration can fall back for that whole location.

Selecting a provider does **not** mean Pebble fills each missing optional field
from another provider. The plugin must supply the fields itself. Pebble's
current importer accepts today's scalar UV value, daily precipitation
probabilities (or the scalar probability as a fallback for today), and current
feels-like. It does not import separate hourly or daily UV series. Which
readings and alerts appear on the watch also depends on PebbleOS's UI.

PebbleOS's main Weather screen reads the active hourly slot. In each refreshed
payload, the plugin puts the same fresh station measurement into that slot and
the scalar current temperature, so the main screen, detailed report and
watchface receive a consistent current reading.
Past and future slots keep their forecast meaning. Retained context can fill
missing past slots; current and future slots require usable current forecast
data. The raw model response is unchanged.
Per-hour source metadata identifies the blended measurement. Once it expires,
the slot returns to the model forecast. The built-in weather bridge can discard
estimate markers and custom source details. The phone app controls native
Weather delivery timing. If the watch advances to a new hourly slot before the
next import, it can show that slot's forecast until another update arrives.

Direct consumers can read observation timestamps, `is_forecast`, source and
station metadata, UV provenance, calculated feels-like provenance, and daily
forecast sources. Halftone can use the selected weather readings through its global complication
choices. Direct consumers retain the plugin's source properties; the native
Weather bridge does not retain every custom property. If a station observation is usable but too little forecast data is
available, direct consumers can still receive the observation; Pebble's native
provider bridge may reject the incomplete location and use its own fallback.

## Build and check

```sh
npm ci
npm test
npm run build
npm run smoke
```

Node.js 20+ and Python 3.10+ are needed; the Pebble SDK is not required for this
phone-only PBW. The pinned esbuild release bundles JavaScript. Packaging is
deterministic and includes permission metadata and license notices.
The smoke command makes real weather requests. See [validation status](docs/VALIDATION.md).

To regenerate the static catalogue, install development-only `pyproj` and run
`python3 scripts/update-catalog.py`. See [feed details](docs/FEEDS.md).

## Data, privacy and license

Weather data: **Český hydrometeorologický ústav (ČHMÚ)** and, when enabled,
**Open-Meteo**. Public ČHMÚ graph/open-data sources, the derived catalogue and
Open-Meteo forecasts use CC BY 4.0 attribution. The optional app data is
attributed separately to ČHMÚ. Feels-like is a plugin-calculated estimate.
This project is independent of ČHMÚ, Open-Meteo and Core Devices.
See [privacy information](PRIVACY.md) and [third-party notices](THIRD_PARTY.md).

Project code uses [PolyForm Noncommercial 1.0.0](LICENSE), with attribution.
Weather data and third-party libraries retain their own licenses.

Required Notice: ČHMÚ Weather for Pebble by Xef (https://github.com/xefensor/pebble-chmu-weather)
