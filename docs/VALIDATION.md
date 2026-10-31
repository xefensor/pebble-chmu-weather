# Release validation

## 0.6.0 release candidate 1

The checks below use the final candidate and actual rendered settings. No
physical phone/watch success is claimed for this new candidate. The user's report that 0.5.1 fixed the original source failure does
not establish every path in this candidate.

- Settings use readable current-reading cards, nearby station selection,
  independent forecast/UV/source controls and expandable technical details.
  English/Czech text and light/dark presentation are reviewed separately from
  actual provider availability.
- Weather selection, permissions, observation/source/body-download timestamps,
  conditional-request semantics and source-disable behavior are retained.
  The native plugin must continue to avoid forbidden timer globals.
- A phone-only manifest, exact script/config bytes, preserved UUID and provider
  domains, license notices, original icons and current listing/privacy links
  are included in the release pass.
- Pebble's current [plugin publishing guide](https://developer.repebble.com/guides/plugins/publishing-plugins/)
  limits publishing to invited developers. No public Store submission is part
  of preparing the candidate. Settings screenshots are documentation previews;
  plugins do not have Store screenshot fields.

- **297 JavaScript tests** and **14 Python packaging tests** pass. New
  regressions cover package-derived settings version, failed storage writes for
  all four settings mutations, preserved settings/diagnostics and no source
  refresh after an unconfirmed save. Packaging keeps the numeric version in
  the manifest and candidate suffix in filenames, and rejects unusable versions.
- **Nine restricted-runtime regressions** pass against JavaScript extracted
  from the exact PBW. Throwing timer getters reproduce the native plugin's
  restriction. The version regression fails against the older 0.5.1 PBW, which
  reported 0.5.0, and passes on this candidate. No browser timers were added to
  the native entrypoint or its deadline handling.
- The exact packaged script passes the network-free forecast-history smoke:
  13 retained past hours in the warm case, honest partial ranges for cold and
  retrospective-only cases, and eight fixture public requests. The fixture run requires no live providers or disk credentials.
- **88 browser rendering cases** and **20 DOM interaction groups** pass on the
  exact final HTML: English/Czech, 320/390/760px, light/dark, zero and
  missing readings, forecasts, stale snapshots, long names/diagnostics,
  permissions, UV dependencies and source independence. Autosave ACKs mirror
  real diagnostic invalidation, station changes affect only their location,
  failed/malformed responses restore confirmed controls, initial state failure
  prevents writes until recovery, and busy locking prevents concurrent changes.
  Expanded details and keyboard access pass. There are no JavaScript errors,
  page HTTP requests, injection execution or horizontal overflow. Documentation
  previews use illustrative fixture weather, not live phone measurements.
- The PBW is **70,493 bytes**, byte-identical on repeat builds. Its manifest,
  bundled script, local config and license notices match current source/build
  bytes. UUID, all source/property shapes and the four permitted domains are
  preserved. There is no native watch binary. The original icons render at
  **80 × 80** and **144 × 144**; hashes and preview provenance are recorded in
  [asset-provenance.json](../store/asset-provenance.json).
- **The single strict live smoke did not pass.** It stopped in the source phase
  before the exact-bundle live phase: public station, ALADIN and bulk requests
  took 6.67–6.76 seconds, beyond the existing six-second per-call deadline.
  Seven provider requests returned HTTP 200, including successful app-service
  authentication, but late ČHMÚ results were safely rejected and the resulting
  temperature was a labelled Open-Meteo forecast. Two backup requests were still
  pending when the harness stopped. One secure credential record was used,
  zero request-safety failures were reported, and credentials were not saved to
  disk. No timeout, freshness or provider-selection rules were relaxed to make
  the check pass. This is not a successful fresh-station or exact-bundle live
  validation; those paths still need confirmation on the phone/network.
- Source and Store archives use fixed ZIP metadata, are repeatable and are
  byte-checked against current files. Dependencies, build output, credentials
  and nested release archives are excluded from source. The Store bundle has
  the exact PBW, original icons, English/Czech listing copy, privacy/attribution,
  licenses and a publication checklist, with an internal checksum manifest.
  Outer hashes are in `dist/SHA256SUMS`. Plugin publication remains invitation-
  limited; no Store upload was performed.

Final PBW SHA-256:

`5819de2b18aed101a36d2975c02e1267c17df2b6314642d7d366250a85914e33`

Packaged script SHA-256:

`269d433937347ccd1244feae2c33a7448a7a21d13f9dda4cabf68aacdca11ba7`

Packaged config SHA-256:

`715b98d20f0e6554ec4cd50800f0ae91d5738a009889c1000df6acdbba529ea3`

Version 0.5.1 checked on 31 October 2026. Earlier results below are historical.

## 0.5.1 runtime compatibility fix

- The physical-phone report from Pebble app **1.16.0.5** identifies the failure:
  `PLUGIN_UNAVAILABLE · setTimeout is not available to plugins`. Pebble weather
  works on that installation; the failing source is ČHMÚ Weather.
- Earlier bundled-script smoke checks supplied browser timers. They therefore
  missed the native runtime's restriction, despite passing their weather-data
  assertions. Those historical checks do not establish native compatibility.
- The native entrypoint no longer references JavaScript timers. The client can
  still use an explicitly injected scheduler outside the native plugin host.
- HTTP results are checked against a six-second per-call deadline, and work is
  checked against the overall 17-second budget before starting and when bridge
  calls finish. Without timers, these checks cannot interrupt a pending Promise.
  Pebble's native **20-second source-session timeout** is the final bound.
  GPS uses its supported native timeout, capped at seven seconds or the
  remaining budget.
- The UUID, four permitted network domains, forecast/provenance rules and
  30-minute source refresh interval are unchanged.
- `npm test`: **291 JavaScript tests and 12 Python packaging tests pass**.
  Seven bundled-entrypoint regressions define throwing timer getters inside
  the VM, matching the phone's restriction. All seven fail against the 0.5.0
  PBW, reproducing the reported error; all seven pass against 0.5.1, both the
  freshly bundled source and the exact JavaScript extracted from the final PBW.
- These fixtures cover saved and GPS locations, original station measurements,
  condition icons, default ČHMÚ app/UV and seven-day supplemental forecasts,
  optional-service failure, secure credentials, cache reuse, forced refresh,
  configuration changes and rejection of completed late HTTP responses.
- The live-smoke harness and deterministic forecast-history harness now also
  reject timer access. The final packaged script passes the network-free
  forecast-history checks with that restriction. No new live-service result
  or physical-device success is claimed for this compatibility-only patch.
- The PBW is byte-identical across repeat packaging. Its manifest keeps the
  existing source declarations and permissions, and its script and local
  settings match the current build byte for byte. The source archive excludes
  dependencies, credentials and nested release files.
- PBW SHA256:
  `8634d15dd9c5055daab138c673c4c410cb108881f44b7398fbe5ce174b809c82`.
  Packaged `plugin.js` SHA256:
  `b5606d23e2b72edd6ebd5272cdf070837c828b9b24cddbfa3565ba00eac0a488`.

No physical-phone installation or end-to-end delivery of 0.5.1 is claimed yet.
This remains a sideloadable beta.

## Historical 0.5.0 release checks

- `npm test`: **280 JavaScript tests and 12 Python packaging tests pass**.
- The phone-only PBW keeps its UUID, four network domains, source choices and
  existing refresh windows. Its SHA256 is
  `06f4618132d5d9ad10916a8caebdbc92b2858f6a4d1979104e9569bbda5a814a`.
  The packaged `plugin.js` SHA256 is
  `c430949087fa21bf8777049757eb49a20439278a120ded31550eb01dfe6c4465`.
- Network-free checks execute that exact bundled script. They cover retaining
  morning forecast context across a two-hour gap and a replacement model run,
  complete versus cold-start partial daily ranges, original download stamps,
  and retrospective context older than six hours that cannot supply current or
  future weather.
- Conditional-request regressions cover safe validators, HTTP 304 without
  reading a body, original download/source timestamps, unconditional download
  after the six-hour reuse limit, changed URLs, malformed responses and
  `no-store` deletion. Forecast-history tests cover local dates and daylight
  saving, bounded storage, current-input precedence and delayed replies that
  cannot resurrect retracted hours. Integration checks cover coalesced requests
  and history cleanup before an obsolete settings revision can reject output.
- Isolated live endpoint probes confirmed HTTP 304 support for the ČHMÚ app
  place and UV services. The inspected public graphs and Open-Meteo responses
  supplied no ETag or Last-Modified validator, so no conditional-download
  savings are claimed for those feeds.
- **The final full live smoke did not pass.** Public ČHMÚ forecast, station,
  bulk-data and Open-Meteo requests returned HTTP 200, but authenticated app
  weather requests exceeded the six-second individual deadline. An unchanged
  retry timed out during login. No request-safety failures were reported.
  Earlier checks also encountered app daily aggregates older than the existing
  six-hour source limit; those must remain unavailable rather than be made
  fresh by a download. The final bundle's end-to-end authenticated 304 path
  and fresh app daily branch therefore remain unverified live in this release.
- Settings JavaScript passes a syntax check and matches the PBW entry; the
  packaged script matches the built JavaScript byte for byte. The PBW is
  reproducible and the source archive excludes dependencies, credentials and
  nested release files.

This is a sideloadable beta. No physical phone/watch testing is claimed.
Native Weather scheduling and display limitations below remain unchanged.

## Historical 0.4.0 release checks

- `npm test`: **223 JavaScript tests and 12 Python packaging tests pass**.
- `npm run build`: produces the 0.4.0 phone-only PBW with the existing UUID,
  the same four network domains, updated settings and attribution.
- `npm run smoke`: source modules and the byte-identical packaged plugin both
  passed against live services. All 27 HTTP requests returned 200, including
  own-installation login, token verification/refresh and seven authenticated
  weather requests. One secure credential record was used; request checks
  reported zero failures and no credentials were written to disk.
- The final PBW SHA256 is
  `4fdea3b482d17909d61376149242dcd20332ca3364bd12411284bf6ac4147774`.
  The executed `plugin.js` SHA256 is
  `45d4f6633ec19ff5414cc8108be2c1fdfd1eb10babdc75c0e911387a3fe234e7`.
- The live check returned measured temperature, humidity **89%**, wind
  **10.44 km/h** and direction **312°**, all carrying the same observation
  timestamp. It verified independent field provenance, calculated feels-like,
  the active-hour temperature blend and an unchanged next-hour forecast.
- Defaults produced 48 hourly slots, seven daily forecasts, ČHMÚ UV **1.5**,
  and ČHMÚ app daily high/low **8.88/4.7°C**. These describe the sampled weather.
- The nearby-only picker and a pinned manual station passed live checks.
  Automatic failover is covered by deterministic tests: at most three station
  candidates, similar elevation, distance priority, no fourth attempt and no
  silent replacement of a manual choice.
- All source combinations passed: daily forecasts off with ČHMÚ UV on;
  Open-Meteo UV without ČHMÚ service requests; Open-Meteo completion off with
  an honest unavailable-UV explanation; UV hidden while completion continues;
  daily aggregates without ČHMÚ UV requests; and ČHMÚ UV alone without daily
  aggregates or Open-Meteo requests.

New regressions cover same-time/same-station T/H/F/D parsing, units and quality,
zero humidity/wind, missing optional fields, exact stale-source attribution,
failed-location diagnostics, per-field observation/forecast fallback, wind
conversion, UV settings across separate JS sessions and source changes during
pending requests. A sample expiring while optional feeds finish becomes a
forecast with a stale explanation. Migration tests verify that upgrading does
not re-enable a ČHMÚ or Open-Meteo service disabled in 0.3.

The live harness waits for its preceding HTTP jobs to settle before strict
per-setting route checks: a forced refresh can legitimately coalesce an
already-running request or use valid cached data after a timeout. App-service
requests have a 14-second channel budget inside the overall 17-second source
budget; individual HTTP timeouts remain bounded.

Settings JavaScript passes a syntax check. The PBW is reproducible and the
source archive excludes credentials, dependencies and nested release files.
No physical phone/watch testing is claimed. Native Weather scheduling and
field-display limitations described below remain unchanged in 0.4.0.

## Historical 0.3.0 release checks

- `npm test`: **181 JavaScript tests and 12 Python packaging tests pass**.
- `npm run build`: produces the phone-only 0.3.0 PBW with the existing UUID,
  four declared weather domains, local settings and attribution notices.
- `npm run smoke`: the source modules and byte-identical PBW script both
  passed against live services. All 17 HTTP requests in the final run returned
  200, including the plugin's own installation login, refresh-token verification
  and refresh, authenticated UV and local-place requests, public ALADIN/station
  requests and Open-Meteo completion. No audit credentials were reused.
- The final PBW SHA256 is
  `e475de249e3eb6823f6cb933940cde1c87c8fb8f064ec2c2cef0d7cde4bf5c44`.
  The executed script matched its `plugin.js` entry byte for byte.
- The live result used a Rožnov measurement with its original timestamp,
  calculated feels-like, ČHMÚ clear-sky noon UV **1.5**, first-day app high/low
  **8.88/4.7°C**, 48 hourly slots and seven local daily forecasts. These values
  describe that sample, not fixed expected future weather.
- The active hourly temperature matched scalar measured temperature, the next
  hour retained ALADIN's forecast, and validity ended by the hour boundary.
- Disabling app data selected Open-Meteo UV without app requests. Disabling
  both optional sources removed UV and optional requests. Re-enabling only
  app data restored ČHMÚ UV/full-day ranges without Open-Meteo requests.
- One secure credential record was used. Request checks found no credentials
  in ordinary storage/state, no raw GPS disclosure, and no invalid request.
  The live script saved no credentials to disk.
- Date parsers also passed all 26 targeted tests with the host timezone set to
  Los Angeles. Settings JavaScript passes a syntax check.

Regression coverage includes malformed/expired source data, missing dates and
valid zero values, exact icon ID families, source/download freshness, midnight
cache continuity, secure-storage failure, token expiry/401 retry, coalescing,
timeouts and no follow-up app requests after disabling the source. Separate
client instances sharing storage reproduce Pebble's separate settings/source
sessions; persisted revisions prevent obsolete app, supplement or station
choices from publishing. Stale diagnostics are filtered by the same revision.

Real networks vary. A repeat during validation crossed the station graph's
six-second timeout and fell back to the forecast when no timely measurement
was available. The strict measured-branch live check then failed as intended;
the final complete run above subsequently passed. Bounded requests and fallback
do not guarantee fresh measurements on every connection.

## 0.3.0 device and scheduling limits

No physical phone/watch plugin-runtime test is claimed. Installation,
permissions, settings WebView, reconnection and end-to-end watch delivery still
need checking on the actual devices. This is a sideloadable beta.

The official host source was checked for POST, Authorization, response methods,
native persistent storage and encrypted secureStorage. Native Weather consumes
instance data but does not schedule from envelope `validUntilMs`; its own
weather job is approximately hourly in the inspected version. Direct plugin
subscriptions use the suggested 30-minute interval. The measured active-hour
blend makes each refreshed payload internally consistent, but a later hour
transition before the next native import can select a forecast again. The
plugin does not overwrite future forecasts to conceal that host limitation.

## Historical 0.2.0 release checks

- `npm test`: 109 JavaScript checks and 12 Python packaging checks pass.
- `npm run build`: produces the version 0.2.0 phone-only PBW with its stable
  UUID, declared feed permissions, bundled JavaScript, local settings and
  third-party license notices.
- `npm run smoke`: live ČHMÚ and Open-Meteo responses produced a Rožnov
  station temperature with its original timestamp, calculated feels-like,
  today's peak UV, actual precipitation probabilities, 48 hourly slots and
  seven daily forecasts. The first three daily temperature ranges came from
  ALADIN and the later four from Open-Meteo in this check.
- The smoke check also executed the bundled source and config handlers in a
  JavaScript host shim, then disabled and re-enabled supplementary data.
  Disabling removed the supplementary fields without changing the measured
  temperature or making another Open-Meteo request.
- The settings JavaScript passes a syntax check. All emitted property shapes
  are declared in the packaged manifest.

Required regressions include ČHMÚ temperature and valid ALADIN field priority,
disabled-supplement isolation, actual probability values including zero, today's
peak UV semantics, model date alignment, complete daily ranges, stale-cache
expiry, current feels-like input provenance and invalid-input rejection.
An in-flight settings-toggle regression confirms that an earlier enabled-mode
request cannot publish supplementary values or restore diagnostics after the
user turns the supplement off.
Station-selection changes also reject obsolete pending responses, while
preserving diagnostics for other locations. Parser-generated unknown-condition
gaps can use known supplemental conditions without replacing valid ČHMÚ
temperatures.

The native runtime's current deadline behavior is described in the 0.5.1
section above. Historical timer-based checks below did not reproduce that
runtime restriction. No deadline guarantees that fresh weather can be obtained
on every phone or network.

## Hardware/runtime checks still needed

No physical-watch or physical-phone plugin-runtime test is claimed for 0.2.0.
Verify installation, permission prompts, WebView settings, provider selection,
unit changes, reconnects and end-to-end delivery on the actual devices. Also
confirm that disabling the Open-Meteo supplement excludes its data after a
refresh. Already-delivered data may remain in a consumer's own cache.

Pebble's native importer accepts today's scalar UV, current feels-like and
daily precipitation probabilities, with scalar precipitation as today's
fallback. It does not import hourly/daily UV series or every custom source
field. Actual field visibility and alerts depend on the watch firmware. Its
main Weather screen can choose the current hourly forecast temperature rather
than the station observation.

This remains a sideloadable beta, not a Pebble Store release.

## Historical 0.1.0 checks — 31 October 2026

- `npm test`: 65 JavaScript checks and 12 Python packaging checks passed.
- `npm run build`: produced a phone-only PBW with permission metadata, local
  settings, bundled JavaScript and third-party license notices.
- `npm run smoke`: downloaded live Rožnov and České Budějovice ALADIN feeds;
  returned a measured temperature with its original timestamp, 48 hourly slots
  and three daily forecasts. Native Weather provider fields were present.
- The smoke check executed the bundled plugin in a JavaScript host shim and
  checked both registered handlers and its reading.
- The settings JavaScript passed a syntax check.

These checks did not run inside the physical Pebble phone/watch runtime.
