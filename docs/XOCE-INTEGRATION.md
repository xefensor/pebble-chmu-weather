# XOCE public-provider integration — 2026-11-08

Starting commit: `21207632c6e2c38defd3fa7d4e90b317c9b0cbf7`.
The public provider remains `00866104-6ce5-4ae3-952f-9800f437442c`, serving
`weather/location`. No weather algorithm, source field, permission, location,
unit preference or personal-build identity changed in this check.

`npm ci --ignore-scripts`, `npm test` and the documented public candidate build
passed with Node 26.12.0 / Python 3.13.16. The package needs no watch SDK.
The new `scripts/smoke.py --pbw` argument selects an exact candidate while
retaining the existing manifest, variant and bundled-script checks. The old
default remains available for explicit frozen-artifact verification.

Candidate: `build/candidate/CHMU-Weather.pbw`, SHA-256
`68aa845ab9531115f0c0a15e792ea80212dbca32c0a83969e36fb3a6ddd23711`.
Packaged script SHA-256:
`4f61827f18402a3beee0f9f59f370c1a01021fdeb14dc858e37fdf86ea4644d6`.

## Live public smoke

The exact candidate passed the restricted-host smoke on 8 November 2026.
The public ALADIN, Rožnov station and enabled Open-Meteo requests returned HTTP
200. The station supplied a fresh measured temperature, checked against its
original observation timestamp. Forged personal-service enable messages were
rejected; old settings were clamped; disabling completion and UV excluded their
cached fields without another Open-Meteo request. There were zero app-backend
requests and zero request-safety failures. The raw hash-bound result is in
`build/qa/xoce-public-smoke.json`.

This is live-service and packaged host-shim evidence. It is not a physical
Pebble phone, permission-prompt or watchface-delivery result. Frozen `dist/`
artifacts and earlier validation remain unchanged.

## Consumer routes and pending phone checks

The [official plugin contract](https://developer.repebble.com/guides/plugins/preview/)
defines provider selection under Settings → Weather and the standard weather
source that consumes the selected provider. Direct complication choices can
also refer to a weather plugin's readings. Native Weather importing does not
retain every custom provenance field; direct readings retain those properties.

Halftone's existing **Pebble weather** route reads the built-in Weather source;
its two complication readings can use configured source choices. Dynamic uses
the configured complication readings. Verify those existing routes rather than
adding an implicit provider switch or a second weather service.

On a supported phone, install the exact public candidate, grant its declared
permissions, configure a saved location and choose ČHMÚ as Weather provider.
Check both Celsius and Fahrenheit, select temperature in each supported face
reading position, and compare its value/unit with the provider output. Then
check Halftone's Pebble-weather mode, a denied permission, a missing location,
stale observations, disabled completion, offline reuse and reconnect. Confirm
that original timestamps survive cache reuse and that consumer fallback follows
the user's settings. Phone discovery, importer behavior and end-to-end delivery
remain pending because no paired phone/watch runtime was available.
