# Changelog

## 0.4.0 beta

- Adds measured humidity and wind from the same station and timestamp as the
  selected fresh temperature. Missing fields fall back independently to public
  forecasts, with measurement/source timestamps retained.
- Uses the richer ČHMÚ ten-minute climate graph and matching-time open-data
  observations, with freshness and quality checks.
- Lets Automatic try up to three eligible stations within 30 km, preferring a
  similar elevation. A manually selected station remains fixed.
- Limits the station picker to eligible nearby choices and shows distance and
  elevation.
- Adds clearer stale, network and coverage status, measurement age and the last
  successful update to settings diagnostics.
- Adds a separate **Preferred UV source** choice: ČHMÚ clear-sky noon (default), Open-Meteo
  cloud-aware forecast peak, or Off. The full-day forecast checkbox now controls
  only ČHMÚ local daily aggregates.
- Keeps UV and daily forecasts independent. ČHMÚ UV can work with full-day
  forecasts off; Open-Meteo UV requires completion to be enabled and never
  turns it on automatically.


## 0.3.0 beta

- Aligns Pebble's main Weather screen with the measured current temperature
  by blending that fresh observation into only the active hourly slot. Other
  hours retain their forecasts, with per-hour source metadata.
- Adds a default-enabled **Use ČHMÚ app data** setting for the official app
  service's clear-sky noon UV and three-day local daily aggregates.
- Uses fresh app daily ranges to avoid an incomplete high/low for today when
  the public hourly forecast no longer includes the morning.
- Preserves nearby station measurements for current temperature and the richer
  public ALADIN feed for hourly forecasts, humidity and wind.
- Labels UV meaning and source, retains its original update time, and falls
  back to Open-Meteo forecast peak UV only when completion is enabled.
- Keeps the app-data and Open-Meteo settings independent; turning either off
  excludes its new requests and cached weather values.
- Persists settings revisions so separate Pebble settings/source sessions
  cannot publish results from obsolete station or source choices.
- Uses a random plugin installation ID and its own service credentials, with
  no user sign-in or Android device identifier required.
- Adds the ČHMÚ app domain to permissions and explains its requests and local
  credential storage in the privacy information.
- Keeps later forecasts local; the national outlook is not used as a town
  forecast.

## 0.2.0

- Adds a default-enabled Open-Meteo supplement for today's peak UV, actual
  precipitation probabilities and local forecasts up to seven days.
- Keeps fresh ČHMÚ station measurements and valid ALADIN forecast fields first.
- Adds hourly/daily precipitation probability and fills missing forecast fields
  or incomplete/later daily forecasts from Open-Meteo when enabled.
- Adds calculated shade feels-like temperature with explicit input provenance.
- Uses official ČHMÚ icon meanings for available condition codes.
- Adds source diagnostics and a setting to disable both Open-Meteo requests
  and use of its cached values.
- Updates permissions, attribution and privacy text for the additional source.
- Continues to feed Pebble's native Weather app and timeline when selected as
  Weather provider; field visibility still depends on PebbleOS.

## 0.1.0

- First sideloadable beta of ČHMÚ Weather for Pebble.
- Prefers fresh nearby station air-temperature measurements, with real timestamps.
- Supplies ALADIN hourly and daily forecasts, model conditions and calculated sun times.
- Follows Pebble's saved locations and temperature/wind units.
- Includes offline caching, bounded requests, station overrides and source diagnostics.
