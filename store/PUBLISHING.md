# ČHMÚ Weather publishing package

## Release status

This directory prepares **ČHMÚ Weather 1.0.0** for publication and sideloading.
No appstore submission has been performed by preparing these files.

If publishing is enabled for your developer account, upload the exact verified
PBW and the two prepared icons using the available plugin publishing flow.
The [plugin publishing guide](https://developer.repebble.com/guides/plugins/publishing-plugins/)
and the current tool/dashboard describe that flow. Account eligibility is
separate from the software's release version and its validation results.

The previously shipped 0.5.1 fixed forbidden timer access and was reported
working. Current automated checks, the live-service timeout result and remaining
physical phone/watch checks are recorded in [validation](../docs/VALIDATION.md).

## Prepared files and listing fields

| Field | Value |
| --- | --- |
| Type | Phone-only Pebble plugin; no native watch binary |
| Name | ČHMÚ Weather |
| Developer | Xef |
| Numeric version | 1.0.0 |
| Release filename | `CHMU-Weather-1.0.0.pbw` |
| UUID | `00866104-6ce5-4ae3-952f-9800f437442c` |
| Source | `weather/location`, multiple locations |
| Plugin category | Choose the weather category offered by the current plugin publishing tool |
| English description | [description.txt](description.txt) |
| Czech description | [description-cs.txt](description-cs.txt) |
| Release notes | [release-notes.txt](release-notes.txt) |
| Source/website | https://github.com/xefensor/pebble-chmu-weather |
| Privacy | https://github.com/xefensor/pebble-chmu-weather/blob/main/PRIVACY.md |
| Support | https://github.com/xefensor/pebble-chmu-weather/issues |
| Code license | PolyForm Noncommercial 1.0.0, with Xef's required attribution |

The manifest and release filename both use **1.0.0** without a candidate suffix.
Each appstore version must be unused and numeric. Preserve the UUID for later
releases. The package does not install a separate Android companion app, run a
watchface, or require a user weather-service account.

The release bundle is `CHMU-Weather-1.0.0-store-package.zip`. A separate
`CHMU-Weather-1.0.0-source.zip` contains source and notices. The store bundle
must include the exact verified PBW, not a later unchecked rebuild.

## Plugin artwork

Plugins have **no Store screenshot fields**, according to the plugin publishing
guide. Settings-page images in the repository are documentation previews, not
watch screenshots or claimed live weather.

The prepared original artwork is a generic weather symbol, not ČHMÚ's logo:

| File | Size | Purpose |
| --- | --- | --- |
| `icon-small-80.png` | 80 × 80 | Small listing icon |
| `icon-large-144.png` | 144 × 144 | Large listing icon |
| `icon-source.svg` | 144 × 144 viewBox | Editable original artwork |

The general [submission guide](https://developer.repebble.com/guides/appstore-publishing/preparing-a-submission/)
uses 80 × 80 and 144 × 144 icons. The plugin guide accepts `--icon-small` and
`--icon-large`, or an appstore-generated line icon. Recheck the eligible
plugin-specific form before uploading if it offers different requirements.
Image files and the PBW must each be no more than 4.4 MB. No watch-frame image
or platform banner is needed for this phone-only plugin.

## Permission and source disclosure

Keep the existing `Location` permission and the four Internet domains:

| Domain | Purpose |
| --- | --- |
| `data-provider.chmi.cz` | Public ČHMÚ station and ALADIN graphs |
| `opendata.chmi.cz` | Backup public station observations |
| `chmu.rails.cz` | Optional app-service installation authentication, daily aggregates and clear-sky noon UV |
| `api.open-meteo.com` | Optional missing fields, rain probabilities and later forecasts |

Fixed saved locations do not request phone GPS. The current-location entry can
request approximate location. Public town/station lookups are selected locally;
optional app-service and Open-Meteo requests use the nearby forecast town's
coordinates. The app-service channel creates its own random installation ID
and credentials without a personal sign-in. Preserve the complete
[privacy disclosure](../PRIVACY.md), [provider/library notices](../THIRD_PARTY.md)
and `licenses/SunCalc-MIT.txt` in distributions. The public open-data attribution
must not be represented as a separate license grant for authenticated app data.
Do not imply that ČHMÚ, Open-Meteo or Core Devices endorse this project.

## Checks before uploading

- Verify numeric version, UUID, `projectType: plugin`, manifest version 2,
  `plugin.js`, the local `config.html` and all declared source shapes.
- Compare the PBW's script/config and permissions with the tested build. Check
  its SHA-256 and repeat-build equality. Retain included licenses/notices.
- Exercise the final bundled script with throwing timer getters. Plugins cannot
  use browser JavaScript timers; a successful ordinary Node test is insufficient.
- Keep original observation/source/body-download timestamps and disabled-source
  settings. A 304 or cache replay must not make an old reading fresh.
- Verify nearby automatic/manual stations, saved/GPS locations, fresh versus
  forecast fallback, zero and negative values, optional-service failures and
  rejected permissions without exposing credentials.
- Check UV off/ČHMÚ/Open-Meteo and both optional forecast controls independently.
  Clear-sky noon UV and forecast peak UV must never be labelled live readings.
- Confirm English/Czech settings, narrow/wide screens, light/dark modes, error
  states, keyboard access and successful/failed changes on the phone.
- Install the exact PBW in a supported preview-enabled Pebble mobile app.
  Compare direct source values with source timestamps, then check native Weather,
  timeline and a plugin-aware watchface. Pebble controls import scheduling and
  may omit custom provenance markers; verify over time, not only after launch.
- Test the actual app-service path, secure storage and network/location permission
  prompts. Deterministic browser/VM checks do not replace those device checks.
- Keep settings previews illustrative and free of real installation identifiers,
  credentials, precise private coordinates or real account details.

## Publication workflow

Use the same developer identity and existing UUID. If plugin publishing is
enabled for your account, inspect the current tool's help and dashboard release
state before uploading.

The installed Pebble tool's `publish --help` supports `--pbw PATH` to upload an
already-built PBW without a rebuild or emulator. It also documents
`--is-published` with default false. The online app publishing guide describes
immediate publication, so do not assume defaults are identical across tool
versions. Inspect the dashboard's release/visibility state before making it
public; new listing changes can be visible immediately.

Use the exact release PBW and the two prepared icons through
the plugin's offered publishing flow. Do not add watch screenshots, OAuth
connectors, a companion app or native platform binaries that this plugin does
not use. Do not run `pebble publish` merely to inspect these files. Preparing this bundle does not upload or publish it.
