# Current release and future readiness

ČHMÚ Weather **1.0.4** is published on
[GitHub](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.4) and
[Pebble Store](https://apps.repebble.com/ef7111ffaeaf4593aaaa85ed). The
[publication record](../store/publication.json) pins its public UUID and exact
PBW hash. The existing review acceptance is retained; no new device-approval gate
is introduced by this documentation correction.

## Actual package scope

This is the public **phone-only weather plugin**, with no watch binary,
launcher, native target or Pebble SDK dependency. Personal-service binaries and
credentials are excluded. The frozen [1.0.4 summary](qa/release-1.0.4/validation.json)
records source/package checks, Node 22.23.4 and Python 3.12.15. Its generic native
screenshot sentence is corrected by [QA-ERRATA.md](QA-ERRATA.md); it is not native
emulator evidence. Physical-phone and fresh live-provider results are not claimed.

The old mixed readiness checklist is retained separately in
[history](history/release-readiness-before-2026-11-15.md). Its older publication
status and native-device checklist do not govern this plugin.

## A future changed package

1. Preserve the public UUID and public/personal boundaries. Use a new unused
   numeric version when package bytes change and mark that new listing as
   preparation; do not rebuild an existing release.
2. Run the pinned source/package checks and create a disposable public candidate
   with `npm run build`. Record any additional exact-PBW browser, public-service
   or real-phone checks separately, with their actual environment and date.
3. Prepare/check its Store kit, then freeze that exact candidate and kit with
   `python3 scripts/freeze-release.py`. Never replace earlier frozen files.
4. Commit the complete new release locally and run `npm run release:prepare`.
   Push/PR checks validate source; the separate manual GitHub release workflow
   uploads checked packages only when publication has been requested.
5. For a separately requested Store update, use the existing listing and a new
   release, verify version availability and exact bytes, then record its result.

See [contributing](../CONTRIBUTING.md), [GitHub release instructions](GITHUB-RELEASES.md)
and [Store publishing](../store/PUBLISHING.md). Documentation maintenance, candidate
builds and read-only checks do not create a release or submit the app.
