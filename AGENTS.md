# ČHMÚ Weather maintainer notes

This is a phone-only Pebble weather plugin, not a watchface or an Android
companion app. It serves the standard `weather/location` source. Start with
[README.md](README.md), [feed contracts](docs/FEEDS.md),
[privacy](PRIVACY.md) and [validation](docs/VALIDATION.md).

## Public and personal boundaries

- The public UUID is `00866104-6ce5-4ae3-952f-9800f437442c`. Preserve it for
  public upgrades. Public builds use only the declared public ČHMÚ/Open-Meteo
  domains and must exclude app-service authentication and `chmu.rails.cz`.
- `npm run build` is public by default. `npm run build:personal` is an explicit
  opt-in and writes to ignored `build/personal/`, with a separate UUID and
  provider name. Never publish its PBW or credentials in `dist/`, GitHub assets
  or a store package. Keep source/build recipes available without embedding
  generated installation identifiers, credentials or private observations.
- Public settings must clamp inherited app-service preferences and exclude
  old app-service cache/diagnostics. Public UV choices are Open-Meteo forecast
  peak or Off; selecting a source must not silently enable another service.
- Attribution for public data is not permission for the separately
  authenticated app service. Preserve the documented distinction and existing
  notices; do not invent an endorsement or new access claim.

## Source map

- `src/plugin/index.js`: Pebble source/config handlers and native bridge.
- `src/lib/client.js`: shared request budget, locations/units, source selection,
  settings generations and diagnostics.
- `src/lib/envelope.js`: reading/series output, units and provenance.
- `src/lib/station-observation.js`, `weather.js`, `supplement.js`: public feed
  parsing; `app-*` modules belong to the personal-only channel.
- `src/lib/http-cache.js`, `forecast-history.js`: bounded response and retained
  past-forecast policies. `src/config.html` is the bundled bilingual settings UI.
- `scripts/build-js.js` and `build.py`: explicit variant bundling and deterministic
  permission-aware PBW packaging. No Pebble SDK is needed.
- `store/`: prepared listing copy/icons; `docs/`: source contracts and evidence.

## Runtime and weather invariants

- Native plugins have no browser JavaScript timers. Do not add accesses to
  `setTimeout`/`setInterval` in code reachable from the plugin entrypoint, even
  as feature probes; restricted-runtime tests use throwing getters. The settings
  webview is a separate browser environment. Preserve elapsed-time budget checks
  and host limits.
- Keep measurement time, forecast time, body-download time and validation-check
  time separate. A cache replay or HTTP 304 must not make old weather fresh.
- Current measured temperature uses an observation at most one hour old.
  Measured humidity/wind must share its station and timestamp; label fallback
  forecast fields honestly. Keep current hourly and scalar temperature aligned.
- Preserve bounded six-hour forecast reuse, `no-store` behavior and retained
  ALADIN context for already-past hours of today's Prague date. Past context
  must not supply current/future weather or invent hours never downloaded.
- Manual stations stay fixed. Automatic alternatives remain within the
  catalogue's distance/elevation rules and request budget. Do not mix nearby
  stations silently or turn a national outlook into a local forecast.
- Respect denied permissions, disabled sources and in-flight settings
  generations. Reuse valid cached data with its original ages after failure.
- Keep source metadata and estimate/forecast meaning in direct output even
  where Pebble's native Weather importer cannot preserve every custom field.

## Build and checks

Use Node.js 20+ and Python 3.10+; GitHub Actions currently uses Node 22.

```sh
npm ci --ignore-scripts
npm test
npm run build
```

`npm test` covers JavaScript, Python packaging and release-automation tests.
For the focused release tests use
`python3 -m unittest discover -s tests -p test_github_release.py`.
`npm run smoke` makes real public weather requests against the exact PBW;
`npm run smoke:personal` additionally exercises authenticated personal channels.
Do not run a live personal smoke merely to check docs. Reuse unchanged evidence
and distinguish fixture/browser checks from live-service and physical-device
results. Catalogue regeneration separately needs development-only `pyproj`.

For a release, finish packaging/checksums/notes and commit them locally before
running `python3 scripts/github-release.py prepare --output /tmp/chmu-release-check`.
The helper reads committed `HEAD`, not the working tree; push to `main` after
that check passes. Running it before committing validates the old version.

## Release lifecycle

- Follow [docs/GITHUB-RELEASES.md](docs/GITHUB-RELEASES.md): package and test,
  commit the version/artifacts/notes locally, validate committed `HEAD`, then
  push to `main` for automatic GitHub validation and publication. Actions uploads the
  checked files; it does not rebuild them or submit a Pebble appstore listing.
- `.github/release.json` selects exact public filenames and marks prereleases.
  RC/beta IDs must remain prereleases. The bootstrap records the first frozen
  artifact commit; it is not a dependency pin to update on every release.
- Published tags/assets are immutable under this workflow. Do not overwrite
  or repackage 1.0.1 because later documentation or automation changed. While
  preparing a new, unpublished version, include its final source/notices and
  refresh checksums after packaging. Change the version when package bytes change.
- Source ZIPs must exclude generated/build/dependency/Git folders and PBW
  binaries. Personal recipe source is allowed; personal generated artifacts
  and credentials are not. Keep public UUID, marker and domain checks intact.
- Preserve old validation as historical. Verify current Pebble publishing
  eligibility separately before any appstore submission; the GitHub release's
  stable flag does not establish that permission or device coverage.
