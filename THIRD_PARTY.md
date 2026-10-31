# Third-party attribution

## ČHMÚ weather and location data

Český hydrometeorologický ústav (ČHMÚ), https://www.chmi.cz/.
Public station observations, ALADIN graph data and the derived location
catalogue are used under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
The optional app-service UV and local daily aggregates are also attributed to
ČHMÚ; the public open-data notice is not treated as a separate license grant
for that service.

The plugin selects station observations, converts units and rounds values for
display. It maps published ČHMÚ icon meanings to Pebble's smaller condition
vocabulary, uses quantitative classification where needed, and derives daily
ranges from available ALADIN hours, requiring complete future days. When
ČHMÚ full-day forecasts are enabled, its fresh local daily aggregates supply
full-day ranges. Choosing ČHMÚ as the preferred UV source independently uses
its clear-sky noon estimates. The UV value
is not relabelled as an instantaneous or cloud-adjusted measurement.

These presentations can differ from ČHMÚ's own applications. Service access
and the data license are separate: the app service requires installation
authentication, obtained independently for this plugin. This is an unofficial
product and is not endorsed by ČHMÚ. See [feed details](docs/FEEDS.md) for
sources and transformations.

## Open-Meteo forecast supplement

Open-Meteo, https://open-meteo.com/.
Weather data are attributed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
API access is governed separately by [Open-Meteo's service terms](https://open-meteo.com/en/terms).
This noncommercial beta uses the free forecast endpoint.

When enabled, Open-Meteo supplies actual precipitation probabilities and
missing or extended forecast values. Its forecast daily peak UV is used when
chosen explicitly, or when preferred ČHMÚ UV is unavailable and completion is
enabled. UV can also be hidden independently of all other weather fields.
The plugin requests
the selected forecast town, converts units, maps WMO weather codes to Pebble's
condition vocabulary and combines these forecasts with ČHMÚ data. It retains
source metadata rather than attributing the combined output entirely to ČHMÚ.
Open-Meteo does not supply the primary station measurement. Disabling the
supplement excludes its cached values as well as new requests.

## Calculated apparent temperature

The shade apparent-temperature approximation follows the
[Australian Bureau of Meteorology's thermal-stress explanation](https://www.bom.gov.au/info/thermal_stress/).
The implementation in `src/lib/apparent.js` is authored for this plugin. It uses
temperature, relative humidity and sustained 10 m wind speed and retains input
source provenance. It does not account for sunshine, wet clothing or individual
response and is not a measured or official ČHMÚ feels-like value. Referencing
the formula does not imply endorsement by the Bureau of Meteorology.

## SunCalc 1.9.0

Sunrise and sunset calculations use SunCalc by Vladimir Agafonkin under the
MIT License. See [the included license](licenses/SunCalc-MIT.txt). Sun times
are calculated locally, not claimed as measured ČHMÚ observations.

## Build tools

esbuild is a development tool under the MIT License; its executable is not
shipped in the PBW. pyproj is an optional development dependency for catalogue
regeneration and is not part of the plugin runtime.
