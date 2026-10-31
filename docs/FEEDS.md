# Weather feeds and bundled location catalogue

Version 0.4.0 beta prefers fresh ČHMÚ station temperature, humidity and wind
when they are reported together, then public ALADIN forecast fields. The
**Use ČHMÚ full-day forecasts** setting adds fresh three-day local aggregates.
The separate **Preferred UV source** selector chooses ČHMÚ clear-sky noon (default),
Open-Meteo cloud-aware daily peak, or Off. Open-Meteo completion independently
supplies missing fields, rain probabilities and up to seven local forecast days.

Endpoint/schema checks were performed on 31 October 2026. ČHMÚ's website
graphs are publicly readable; its app service uses installation authentication.
No supported public API contract was established for these backends. Keep
parsing defensive and retain the published open-data export as an independent
measurement backup.

## Measured station weather

Primary endpoint:

```text
https://data-provider.chmi.cz/api/graphs/graf.meteo-stanice.klima-10m/{GH_ID}
```

For České Budějovice, Rožnov:

```text
https://data-provider.chmi.cz/api/graphs/graf.meteo-stanice.klima-10m/C2CBUD01
```

The [official station page](https://www.chmi.cz/w/c2cbud01-ceske-budejovice-roznov)
uses these graph feeds. The combined ten-minute graph has `dataPoints`, each
with an ISO UTC `timestamp` and a `values` object. Its `dial` describes units:

| Field | Meaning | Unit |
| --- | --- | --- |
| `T` | Air temperature | °C |
| `H` | Relative humidity | % |
| `F` | Wind speed | m/s |
| `D` | Wind direction | Degrees |

The newest usable fresh `T` selects the measurement timestamp. Optional `H`,
`F` and `D` must come from the same station and that exact timestamp. Values
from an earlier row or another station are not attached to it. Each absent or
invalid optional field can fall back independently to public ALADIN and then
enabled Open-Meteo. `TPM` is near-ground temperature; soil temperatures such as
`T05` and `T10` must not substitute for air-temperature `T`.

The original timestamp controls age, with a one-hour maximum for measured
weather. Downloading the same sample must not make it newer. The scalar
humidity/wind source fields identify observations or forecasts; measured
values expose `humidity_observed_at` and `wind_observed_at`. Feels-like uses the
actual selected temperature, humidity and wind and retains their provenance.

ČHMÚ's [measurement explanation](https://www.chmi.cz/namerena-data/data-z-mericich-stanic/aktualni-teplota)
states that air temperature is measured in the ten-minute cycle, normally at
2 m above the surface, and arrives with a delay of minutes to low tens of
minutes. Operative data can later change during verification. A station
measurement represents that station, not every street or altitude nearby.

### Station selection and diagnostics

Eligible stations come from the bundled temperature-capable catalogue and
must be within 30 km. When the forecast point's elevation is known, automatic
mode requires a station within 150 m of it. It can try up to three candidates
from the suitable nearby group while the shared request deadline allows. A manual selection remains
fixed; an unavailable manual station does not silently switch to another.

The settings picker lists eligible nearby stations with distance and elevation.
Per-location diagnostics include `stationMode`, `requestedStationId`, eligible
choices, `stationStatus` and `stationReason`. They distinguish stale data,
network failures and places outside coverage, preserve the last successful
fetch timestamp and show the measurement's age.
`latestSampleAt` and `measurementAgeSec` describe the source measurement;
`observationFetchedAt` and `lastSuccessfulFetch` describe retrieval, not a new
measurement. A failed refresh never renews a cached sample's timestamp.

### Published open-data backup

```text
https://opendata.chmi.cz/meteorology/climate/now/data/10m-{WSI}-{YYYYMMDD}.json
```

Rožnov's WSI is `0-20000-0-11546`, so one dated example is
`10m-0-20000-0-11546-20261031.json`. The file is a published rolling/daily
export; its latest available point can lag the live graph. Use the actual
timestamps and require the expected station WSI. Select the newest acceptable
`T` row, then optional `H`, `F` and `D` only when their `DT` equals that
selected temperature's timestamp.

The table is at `data.data`; `header` supplies the column names
`STATION,ELEMENT,DT,VAL,FLAG,QUALITY`, and `values` contains rows. Do not infer
column order without checking the header. Times in `DT` are UTC ISO strings.

The accompanying `metadata/meta4-YYYYMMDD.json` defines quality codes:

| QUALITY | Official meaning |
| --- | --- |
| 0 | Good / Kvalitní hodnota |
| 1 | Suspect / Podezřelá hodnota |
| 2 | Poor / low quality, do not use yet |
| 3 | Estimated / Odhadnutá hodnota |
| 4 | Missing / Chybějící hodnota |
| 5 | Unknown / Kvalita neznámá |

Live operative Rožnov measurements carried quality 5 during inspection.
Treating every nonzero code as missing would therefore discard these actual
observations. Code 5 means unknown quality, not verified quality. Estimated
values must not be presented as station measurements. The same quality and
validity checks apply to optional humidity and wind rows; missing, invalid or
unexplained flagged values remain absent. `meta3` describes element-specific
flags and lists no special flag for air-temperature `T`.

## ALADIN forecast

```text
https://data-provider.chmi.cz/api/graphs/graf.meteogram/{POI_ID}
```

České Budějovice is POI `75`. The [official city page](https://www.chmi.cz/meteogram/75-ceske-budejovice)
identifies it as the nearest ALADIN model point, at an elevation of 387 m.
This differs from the observed Rožnov station (394.6 m).

The JSON has `parameters`, `data` and `z`. Each forecast row contains
`validityTime` with an explicit UTC offset, numeric `t2m` in °C, `rh2m`,
`prec`, `snow`, `windSpeed`, `windDirection`, `windGustSpeed`, `cloudsTot`
and numeric `icon`. The inspected response had 73 hourly points. `z` is the
model-point elevation. No model issue time or `generatedAt` field was present;
do not claim that download time is a model generation time.

[ČHMÚ documents](https://www.chmi.cz/predpoved-pocasi/aladin/vice-o-modelu-aladin)
four nominal ALADIN runs per day and a 72-hour forecast. Checking for a new run
does not produce a new forecast every ten minutes. Preserve the validity times
and identify these values as forecasts, including when a forecast is used as
the fallback for unavailable measured temperature.

### Conditions and icons

The official graph frontend loads numeric `icon` values directly as SVG files,
for example `https://www.chmi.cz/o/chmu-theme/images/icon/140.svg`.
[ČHMÚ's published icon legend](https://www.chmi.cz/predpoved-pocasi/ikony-pocasi)
pairs those exact filenames with their meanings. The plugin uses the explicit
published codes: for example 10/110 means clear, 40/140 partly cloudy, 61/161
cloudy with a shower, 63/163 rain and snow, and 65/165 snow showers. Known wet
symbols remain wet even if the hourly precipitation amount rounds to zero.

Pebble's shared condition vocabulary is coarser: fog becomes cloudy and
freezing rain becomes rain. Published thunder/hail codes have no exact
equivalent; they use an available wet quantitative fallback or remain unknown,
never clear solely because a precipitation value is zero. For unknown or
unlisted IDs, a classification from cloud amount, precipitation and temperature
is approximate. Rain/snow intensity is also derived from the available
precipitation amount rather than invented from a generic symbol. Temperature
readings do not depend on this classification.

Some website endpoints return a JSON-encoded string rather than an object when
the request declares `Accept: application/json`; this was observed for the POI
GeoJSON responses. The catalogue updater unwraps one such JSON layer. Runtime
clients should validate the resulting shape rather than assume content
negotiation is consistent across all endpoints.

### Longer ČHMÚ forecasts and missing optional fields

The official [weekly forecast page](https://www.chmi.cz/predpoved-pocasi/tyden)
uses `https://data-provider.chmi.cz/api/graphs/graf.forecast`. Its inspected
response contained daily minimum/maximum pairs with `time`, `sent` and
`weatherIcon`, extending beyond ALADIN's range. This is a national outlook;
the same response was returned when coordinates for České Budějovice were
added. The app's national bulletin endpoint likewise supplies country-wide
values. Neither is appended to a town forecast as though it were a local
prediction.

App inspection and a live response check established usable local daily
aggregates and clear-sky UV, described below. The inspected app national
records retained nullable `rainfall_probability`, `temperature_perceived` and
`wind_perceived` fields, but all were null in the nine returned records. Their
presence in a model does not establish a usable data source. Public ALADIN
precipitation is an amount in millimetres, not a probability.

The checked public text-forecast files contain rain probabilities for mountain
areas; a mountain-region forecast must not be relabelled as a city forecast.
A bounded search did not establish a suitable full local ČHMÚ point feed for
rain probability or days four through seven. This is not a claim that such
data can never exist. Open-Meteo fills those local fields when enabled.

## ČHMÚ app data

**Use ČHMÚ full-day forecasts** is enabled by default and controls only the
three-day local date aggregates. They avoid deriving today's high/low only
from the hours remaining in the public graph. The separate **Preferred UV source** choice
controls the ČHMÚ app's clear-sky noon estimate. Either app-service channel can
operate without the other.

The service is hosted at `chmu.rails.cz`. The plugin obtains its own installation
login and refresh credentials using a persistent random installation ID. It
uses no actual Android ID, requires no user sign-in and needs no user-supplied
API key. The protocol is implemented independently for this plugin; the Android
application is not bundled. Service credentials use Pebble's secure storage
when available and local plugin storage on older runtimes without it. See
[privacy details](../PRIVACY.md).

Requests use the coordinates of the public forecast town selected from the
bundled catalogue. They do not transmit raw phone GPS or a saved location name.
The routes are:

```text
https://chmu.rails.cz/api/v2/places/nearest?lat={LAT}&lng={LNG}&with_detail[]=forecast_cumulative
https://chmu.rails.cz/api/v1/uv_measures?date_from={DATE}&date_to={DATE}&lat={LAT}&lng={LNG}
```

They are authenticated with the plugin installation's own service session.
The UV request covers today through six days ahead, but only today's selected
value is sent through Pebble's current scalar UV field.

### Local date aggregates

`forecast_weather_cumulative` is a flat list of `{category, value, time_at}`
items. Group items by their exact date key. The inspected České Budějovice
response contained eight categories for each of three dates:

```text
aladin_clstemperature
min_temperature
aladin_clsvent_zonal
aladin_clsvent_meridien
aladin_surfprec_total
aladin_surfnebul_totale
weather_icon_day
weather_icon_night
```

The plugin uses the app's max/min ranges and daily condition as supplied,
rather than recalculating ranges from its shorter hourly array. In the inspected response,
that array covered only 24 hours ahead, whereas the date aggregates covered
three dates. Its current/hourly and cumulative data did not supply relative
humidity. The plugin therefore keeps the public 73-point ALADIN feed for hourly
forecasts, humidity and other available fields, and keeps station observations
for current temperature and available same-time humidity/wind. It does not
switch to the app's model temperature.

Fresh app date aggregates take priority for their available local dates;
public ALADIN and enabled Open-Meteo fill remaining forecast coverage. The
plugin checks the app response's original `updated_at` and limits its age to
six hours, in addition to the six-hour downloaded-response cache limit.
Unavailable or stale aggregates leave the existing forecast sources in use.

App icon IDs are a separate namespace from the website SVG filenames. Their
meaning must be mapped using the app's definitions; the website's numeric
mapping must not be applied to them.

### UV meaning, dates and fallback

Each UV record contains `date_at`, `value`, `value_snow` and `updated_at`.
The plugin uses the ordinary `value`. The separate snow value is not substituted
for it. The selected record must match today's date in Europe/Prague and have
a usable original update time no more than seven days old. Downloading the
record does not reset `updated_at`; its original timestamp is exposed with UV
source metadata and shown in settings.

The clear-sky noon meaning was verified against the official Android app's UV
screen during technical inspection on 31 October 2026. See ČHMÚ's
[official app information](https://www.chmi.cz/o-chmu/povinne-zverejnovane-informace/o-mobilni-aplikaci)
for the application. The service's upstream UV model is not identified here.

This is a forecast for clear skies at noon, not a live UV measurement
or a cloud-adjusted estimate. It can therefore exceed Open-Meteo's forecast
peak on a cloudy day without either value being a unit-conversion error.
The UV source and meaning remain explicit in plugin diagnostics.

The **Preferred UV source** setting is independent of the full-day forecast checkbox:

| Stored value | UI choice | Output and network behavior |
| --- | --- | --- |
| `chmu` | ČHMÚ — default | Uses clear-sky noon UV; Open-Meteo forecast peak can fill unavailable app UV only when completion is on |
| `open-meteo` | Open-Meteo | Uses cloud-aware forecast daily peak only while completion is on |
| `off` | Off | Omits UV, including cached UV values |

Selecting Open-Meteo while completion is off leaves UV unavailable and explains
that completion must be enabled. It never changes the completion setting.
When completion is off, no Open-Meteo requests or cached values are used, even
for ČHMÚ UV fallback. When UV is Off but completion remains on, Open-Meteo can
still be requested for precipitation probabilities and other forecast fields.

Selecting ČHMÚ UV can request installation authentication and `uv_measures`
even with full-day forecasts off. Only when full-day forecasts are off **and**
UV is not set to ČHMÚ are all app-service requests and cached app data excluded.
A request already sent can finish, but disabled channels do not start later
requests or publish results under obsolete settings. Settings show the selected
UV preference, actual source, status and reason.

App data normally reuses a 30-minute fetch cache and can be reused offline for
up to six hours after download, subject to the original source-age checks above.
Refresh bypasses the short reuse window. A failed fetch does not make old
source timestamps newer.

## Open-Meteo supplement

Endpoint: `https://api.open-meteo.com/v1/forecast`.
The request uses the selected public forecast-town coordinates from the
bundled catalogue, not raw phone GPS coordinates. Parameters are:

```text
hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m
daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max,precipitation_probability_max
timezone=Europe/Prague
timeformat=unixtime
forecast_days=7
temperature_unit=celsius
wind_speed_unit=ms
precipitation_unit=mm
```

The response has `hourly`, `hourly_units`, `daily`, `daily_units`, `timezone`
and `utc_offset_seconds`. Arrays must align with their time arrays and use the
expected units. Missing points stay missing; indices are not shifted to hide
gaps. Hourly values use their UTC timestamps. Daily values use the API's local
date keys and reported offset, including when a response spans a daylight-saving
transition. Download time records cache age, not a model issue time.

Fresh same-time ČHMÚ station temperature/humidity/wind and valid public
ALADIN hourly forecast fields take priority.
Fresh app local daily aggregates are preferred for the dates they provide;
otherwise complete future ALADIN ranges remain preferred. Without usable app
aggregates, today's ALADIN range can use the available part of the current day;
past hours missing from a new model run are not invented. Open-Meteo supplies
missing, incomplete future or later forecast days, up to seven days total.
The plugin still exposes 48 hourly slots anchored at local midnight for today
and tomorrow, not a promise of 48 future hours from the current moment.

`uv_index_max` is today's **forecast maximum UV**, used for `uv_index` when
Open-Meteo is selected or as the enabled fallback for unavailable ČHMÚ UV.
UV Off suppresses it. It is not an instantaneous UV reading. `precipitation_probability` supplies actual
hourly probabilities, and `precipitation_probability_max` supplies the daily
values. The scalar `precipitation` property is today's daily probability.
Rainfall amounts in millimetres are never converted into percentages.
WMO weather codes are mapped following [Open-Meteo's variable documentation](https://open-meteo.com/en/docs#weathervariables).

Supplemental responses normally reuse a 30-minute cache and expire after
six hours. When the setting is off, they are neither requested nor used from
cache. Disabling does not retract previously delivered data from consumers.
Source and download timestamps are exposed to direct plugin consumers; mixed
output is not attributed entirely to ČHMÚ. Cached response bodies can include
coarse forecast/model coordinates and provider metadata: see [privacy details](../PRIVACY.md).

Open-Meteo data attribution is **Open-Meteo, CC BY 4.0**. The free API's access
terms are separate from its data license; this noncommercial beta uses that
endpoint under [Open-Meteo's terms](https://open-meteo.com/en/terms).

## Calculated feels-like and sun times

The plugin calculates shade apparent temperature using the
[Australian Bureau of Meteorology's documented approximation](https://www.bom.gov.au/info/thermal_stress/):

```text
e = (RH / 100) × 6.105 × exp(17.27 × T / (237.7 + T))
AT = T + 0.33 × e − 0.70 × wind − 4
```

`T` is the actual displayed temperature in °C before rounding, `RH` is relative
humidity in percent, and wind is sustained 10 m wind in m/s. A current station
temperature uses same-station, same-time humidity/wind when available, with
independent ALADIN or enabled supplemental forecast inputs when necessary. Input sources are retained in
`feels_like_source`. The result is calculated and marked as an estimate; it is
not an official measured ČHMÚ feels-like value. Missing or invalid inputs omit
the result rather than substituting zero. It estimates shade conditions and
does not model direct sun, wet clothing or individual response.

SunCalc calculates sunrise/sunset locally from the requested place and date.
These values are not measured or downloaded ČHMÚ observations.

## Pebble provider import

Selecting the plugin in **Settings → Weather → Weather provider** supplies
Pebble's Weather app, timeline weather and consumers of built-in weather.
Direct plugin consumers receive more source detail than the native database
bridge preserves.

The current importer accepts the scalar `uv_index` as today's peak, current
`feels_like`, and `daily_precipitation`. If the daily probability series is
missing, scalar `precipitation` can fill today. It does not import separate
hourly/daily UV series. This plugin does not claim those unsupported UV fields.
Native field visibility and alert behavior depend on PebbleOS. Missing optional
fields do not automatically trigger per-field supplementation by Pebble;
its provider fallback can instead replace an unsupported or failed location
as a whole. The main Weather screen uses the active hourly slot, so this plugin
blends its fresh station measurement into that slot as well as scalar
temperature. The original observation time still controls validity. Raw model
cache values and all other hourly slots are unchanged; `hourly_source` records
the observation/forecast provenance for direct consumers. An expired or absent
observation leaves the forecast slot intact. The envelope expiry is capped at
the hour boundary, but the current native Weather importer ignores that expiry
for scheduling. It uses the phone app's own approximately hourly weather job,
while direct plugin subscriptions use the suggested 30-minute interval. Thus
temperature consistency is guaranteed within a refreshed plugin payload, not
across a later hour transition before the next native import.

## Catalogue provenance and updates

`src/catalog.json` contains:

- `version`, `generatedAt`, `metadataDate`, `sources`, and `attribution`.
- `stations`: `{id, wsi, name, latitude, longitude, elevation}`. `id` is the
  official GH_ID and `wsi` is the corresponding open-data identifier.
- `forecastPlaces`: `{id, name, latitude, longitude}`. `id` is the official
  numeric POI identifier stored as a string. Forecast-point elevation is read
  from the forecast response, not guessed from the town's coordinates.

Station names, coordinates and elevation come from official daily `meta1`
metadata. `meta2` narrows the list to stations advertising `OBS_TYPE=10M`,
`EG_EL_ABBREVIATION=T`, `SCHEDULE=10M`. Czech GH_ID format and geographic bounds
exclude foreign entries such as Reykjavik. Metadata capability does not
guarantee that a station has a fresh reading at every request.

Forecast locations merge the official map's `/api/poi/data/map/obce/2`, `/3`
and `/4` levels and are deduplicated by POI ID. The official
`/api/map/init/poi.obce` declares their source coordinates as EPSG:32633;
the updater uses PROJ/pyproj to transform them to WGS84 EPSG:4326. Runtime
nearest-point selection therefore needs no coordinate-conversion library.
These are forecast town points, not a complete ALADIN grid. Apply a distance
limit and do not silently use a distant town when outside supported coverage.

To update from the newest common `meta1`/`meta2` date advertised in the
official metadata directory, including yesterday when today is unavailable:

```sh
python3 -m pip install pyproj
python3 scripts/update-catalog.py
```

`--date YYYYMMDD` pins the metadata date; `--stdout` previews the generated
JSON without writing files. The existing bundled catalogue remains usable
without a network metadata download. Fixtures in `tests/fixtures` are small
slices of real responses with historical capture timestamps; they are not
live weather and should be tested against a fixed clock.

Public ČHMÚ graph/open-data and catalogue attribution:
**Český hydrometeorologický ústav (ČHMÚ), CC BY 4.0**.
ČHMÚ's [open-data information](https://www.chmi.cz/-/kde-najdu-otev%C5%99en%C3%A1-data-%C4%8Dhm%C3%BA-)
states that its open data may be used free of charge under this license.
Retain this attribution when redistributing the catalogue or displaying data.
