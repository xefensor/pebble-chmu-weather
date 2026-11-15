# Current evidence scope and QA errata

Documentation correction · 15 November 2026 · public release 1.0.4.

ČHMÚ Weather is a **phone-only plugin**. Its public PBW has no native watch
binary, launcher icon or native target platform. It does not require a Pebble SDK.

## Correction to the 1.0.4 summary

The frozen [release summary](qa/release-1.0.4/validation.json) contains a generic
`nativeScreenshots` sentence about fresh native smoke/launcher inspection and
historical native-gallery reuse. **That sentence does not apply to ČHMÚ Weather**
and is not evidence of those checks. The same JSON records `platforms: []`,
`sdkVersion: null`, `pebbleToolVersion: null` and `nativeEmulatorRuns: 0`.

The previous readiness page also mixed the phone plugin with a generic
Time 2/Round 2 native checklist. Its original bytes are retained in
[history](history/release-readiness-before-2026-11-15.md), with this correction.
No frozen report, screenshot, binary, tag or release archive has been relabelled
or changed to hide the error.

## What the evidence establishes

| Evidence | Scope |
| --- | --- |
| 1.0.4 source/package checks | Recorded source tests and fresh public packaging/artifact audit; identity, permissions and public/personal separation. |
| Settings DOM/browser fixtures | Real configuration code with simulated Pebble replies, including save/refresh status, station-change context, keyboard recovery and UV dependency. |
| Earlier exact-PBW live weather smoke | Only the recorded older package/date and services; not a fresh 1.0.4 provider or physical-phone result. |
| Publication record | Current Store/GitHub version and exact public PBW hash; not runtime/device verification. |
| Native watch smoke/launcher screenshots | Not applicable to this phone-only plugin. |

The source/package summary records Node 22.23.4 and Python 3.12.15, with no SDK.
It explicitly records `physicalDeviceTest: false` and `liveProviderTest: false`.
The [settings changes](../SETTINGS-CANDIDATE.md), versioned reports and
[older validation sections](VALIDATION.md) retain the actual cases and dates.

No repository fixture establishes fresh physical-phone storage/permission
behaviour, native Weather delivery, current provider availability or a physical
watch result for 1.0.4. A user's earlier working 0.5.1 report remains valuable
historical feedback, rather than a substitute for those checks.

## Publication is a separate fact

Version 1.0.4 is published; [store/publication.json](../store/publication.json)
records the checked links/hash. This correction adds no new device-approval gate,
claims no additional service test and does not change the reviewed release bytes.
Future validation must name its exact PBW, environment and scope.
