# Beta validation

Version 0.3.0 checked on 31 October 2026. Earlier results below are historical.

## 0.3.0 release checks

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

Request deadlines share a 17-second total budget, leaving room before the
native host's 20-second timeout. This does not guarantee that fresh weather
can be obtained within that budget on every phone or network.

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
