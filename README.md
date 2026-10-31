# ČHMÚ Weather for Pebble

Unofficial weather plugin by Xef. Nearby ČHMÚ station measurements supply the
current temperature, and ALADIN supplies local forecasts. ČHMÚ app data adds
full-day local ranges and clear-sky noon UV. Open-Meteo completes missing weather
fields, rain probabilities and forecasts up to seven days.

The plugin serves Pebble's standard `weather/location` source and runs inside
the Pebble phone app. No API key, user sign-in, separate Android app or
developer-operated server is needed.

## Install the 0.3.0 beta

1. In Pebble mobile app 1.16.x, enable **Settings → Plugins → Plugins /
   permissions preview**. Labels may change while plugins are in preview.
2. Open [CHMU-Weather-0.3.0.pbw](dist/CHMU-Weather-0.3.0.pbw) with the Pebble app.
3. Allow Location and internet access to `data-provider.chmi.cz`,
   `opendata.chmi.cz`, `chmu.rails.cz` and `api.open-meteo.com`. When upgrading,
   Pebble may ask you to approve access to the new ČHMÚ app domain.
4. Select **Settings → Weather → Weather provider → ČHMÚ Weather**. This feeds
   the watch's Weather app and timeline, and watchfaces using Pebble weather.
   Your saved weather locations and units are used automatically.
5. Open the plugin's settings and tap **Refresh ČHMÚ data** to inspect the
   station, measurement time, UV source and other weather fields. You can choose
   a different nearby temperature station for each location.

Plugin-aware watchfaces can also select ČHMÚ Weather directly as a source.
This is a sideloadable beta, not a Pebble Store release. Installation and
end-to-end delivery inside the physical phone/watch runtime still need testing.
Source: [CHMU-Weather-0.3.0-source.zip](dist/CHMU-Weather-0.3.0-source.zip).

## Weather sources

| Reading | Source and behavior |
| --- | --- |
| Current temperature | ČHMÚ station measurement, at most one hour old; otherwise a forecast marked `~` in direct plugin readings |
| Conditions, humidity and wind | Valid public ALADIN forecast values first; Open-Meteo fills missing values when enabled |
| Hourly series | 48 slots for today and tomorrow, anchored at local midnight; the active slot uses a fresh station measurement, other slots prefer public ALADIN forecasts |
| Daily forecast | Fresh ČHMÚ app aggregates for the first three dates; public ALADIN ranges and enabled Open-Meteo complete the available local forecast, up to seven days |
| UV | ČHMÚ app **clear-sky noon UV** by default; Open-Meteo forecast daily peak as fallback when enabled |
| Precipitation probability | Open-Meteo hourly and daily probabilities; never inferred from rainfall amounts |
| Feels-like temperature | Calculated shade estimate using the displayed temperature, relative humidity and sustained 10 m wind, when all inputs are usable |
| Sunrise and sunset | Calculated locally with SunCalc |

Two independent settings are on by default:

- **Use ČHMÚ app data** adds the app's three-day local aggregates and UV. Its UV
  assumes clear skies at noon: it can be higher than a forecast that
  accounts for clouds, and is not an instantaneous measurement. Settings show
  the UV source and its original update time. The plugin creates its own random
  installation ID and service credentials automatically; you do not sign in.
- **Use Open-Meteo to complete missing weather data** adds actual rain
  probabilities, missing fields and later local forecast days. It also supplies
  forecast peak UV when usable ČHMÚ app UV is unavailable.

Turning either setting off stops future weather updates from contacting that
source and excludes its cached values from plugin output. A request already
sent can finish; disabling ČHMÚ app data blocks its follow-up requests and
discards the obsolete weather result. ČHMÚ app UV still works with Open-Meteo off.
With both off, the plugin uses public ČHMÚ measurements and ALADIN forecasts,
plus local calculations; UV, rain probability and later days can be absent.
Turning a source off does not retract weather already stored by Pebble or
another watchface. See [privacy information](PRIVACY.md) for network and storage
details.

For České Budějovice, automatic station selection normally chooses **Rožnov**.
Temperature retains decimal precision and rounds only once for display in the
chosen Celsius or Fahrenheit unit. The actual observation timestamp controls
freshness: downloading the same measurement never makes it younger.

Forecast responses can be reused offline for up to **six hours** after
downloading. ČHMÚ app daily aggregates also require a source update age of at most six
hours; UV records require the correct date and an original update no more than
seven days old. Downloading them does not reset their source timestamps.
Without usable app daily aggregates, today's ALADIN high/low can cover only the
available part of today. Future ALADIN days must be complete before their
ranges are used. The national ČHMÚ outlook is not presented as a local forecast.

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

## Coverage and Pebble limitations

The bundled catalogue covers Czech temperature stations and ALADIN town
points. A forecast town and measurement station must be within 30 km.
Automatic station selection prefers an elevation within 150 m of the model
point when the forecast reports elevation. A station does not measure the
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
Past and future slots keep their forecasts; the raw model cache is unchanged.
Per-hour source metadata identifies the blended measurement. Once it expires,
the slot returns to the model forecast. The built-in weather bridge can discard
estimate markers and custom source details. The phone app controls native
Weather delivery timing. If the watch advances to a new hourly slot before the
next import, it can show that slot's forecast until another update arrives.

Direct consumers can read observation timestamps, `is_forecast`, source and
station metadata, UV provenance, calculated feels-like provenance, and daily
forecast sources. A Halftone beta using the built-in bridge can use this plugin
through the global Weather provider setting, but does not receive every custom
property. If a station observation is usable but too little forecast data is
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
