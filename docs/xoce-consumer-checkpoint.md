# Packaged XOCE consumer checkpoint — 8 November 2026

The public 1.0.1 candidate was executed through the exact Dynamic 0.18.3 and
Halftone 1.9.0 candidate phone bundles and their pinned Core 0.5.2 native decoder.
All eight cases passed for each face: station Celsius, station Fahrenheit,
humidity, ALADIN fallback, denied location, unavailable location, missing plugin
and unconfigured slots. The two visible slots retain the provider's values,
units, original observation and expiry; the other three wire slots stay empty.
Humidity does not acquire rain presentation. A cache replay performs no HTTP
requests and retains its original observation. Permission revocation clears
previously delivered values. The decoder rejects freshness after the original
lease, without pretending that a new observation arrived.

The source identity remains `00866104-6ce5-4ae3-952f-9800f437442c`. Only the three
declared public domains are used. No app-service authentication, secure storage,
private endpoint or GPS bypass of an explicit permission denial is exercised.

The same packets rendered in the unmodified final native faces on Emery
firmware 4.45.0. Visual review confirmed °C/°F, forecast marking, immediate
withdrawal on permission denial, and expiry after a natural minute tick with
no new source message. Both faces keep their own visual presentation.

Artifacts in ignored `build/qa/xoce-consumers/`:

- `pipeline.json`: candidate paths, SHA-256s, common Core archive SHA-256,
  exact packets and decoded field assertions.
- `dynamic/report.json` and `halftone/report.json`: firmware, hashes and ten
  native captures each.
- `weather-comparison.png`: Celsius, Fahrenheit, forecast, revocation and
  expiry side by side for both faces.

Reproduce from the repository with its documented dependencies installed:

```sh
python3 scripts/check-xoce-consumers.py \
  --consumer ../pebble-watchface-dynamic/build/candidate/Dynamic-0.18.3.pbw \
  --consumer ../pebble-watchface-halftone/build/candidate/Halftone-1.9.0.pbw \
  --core ../pebble-watchface-dynamic/vendor/pebble-watchface-core-0.5.2.tgz
```

With the existing Pebble SDK Python environment and the chosen firmware assets,
run `python3 scripts/emulator-xoce-consumers.py --face Dynamic` and the equivalent
`--face Halftone`, then inspect the generated captures. This optional emulator
step uses disposable local storage and strips phone code only from the native
installation wrapper; C and resources come unchanged from the candidate PBWs.

The HTTP responses, phone SDK, permissions, discovery and global weather-provider
selection are fixtures. This is packaged execution plus native emulator
verification, not installation in the physical Pebble phone app. On the phone,
install the public candidate, grant location, select ČHMÚ as Weather provider,
choose the two face complications, and check °C/°F, another saved location,
revocation, reconnect and fallback. That physical check remains pending.
