# ČHMÚ Weather publication

## Current published version

**1.0.4 is published** in [Pebble Store](https://apps.repebble.com/ef7111ffaeaf4593aaaa85ed)
and [GitHub releases](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.4).
[publication.json](publication.json) records the public UUID, exact PBW hash and
links checked on 15 November 2026. There is no new upload needed for that version.

This is the public **phone-only weather plugin**. It has no watch binary,
launcher icon, Store screenshot set or platform-banner fields. The website-only
banner must not be uploaded into a plugin screenshot/banner slot. Current
artwork authority and reproduction links are in [README](README.md) and
[current-artwork.json](current-artwork.json).

## A future Store update

Use the existing listing in its owner account and choose **New Release** for a
new, unused version. Confirm the intended UUID/version, public PBW bytes and
current listing fields before submitting. A new plugin with a new UUID is not
an upgrade path for existing users.

The [official plugin publishing guide](https://developer.repebble.com/guides/plugins/publishing-plugins/)
documents CLI and Developer Dashboard submission. Preview support is not an
invitation-only publication prohibition. Use the current official phone app and
enable Plugins / permissions preview when offered; labels may vary.

Public ČHMÚ data uses required Internet access; backup observations and
Open-Meteo are optional, with separate reasons. Saved places do not need GPS;
current location uses optional Location permission. The public domains remain
`data-provider.chmi.cz`, `opendata.chmi.cz` and `api.open-meteo.com`.
The Personal variant, its UUID, app-service credentials and `chmu.rails.cz` must
never enter public packages.

Source tests, packaged settings/browser fixtures, exact-PBW service smoke and
real-phone/provider checks have different scopes. Record what actually ran,
using [current readiness](../docs/RELEASE-READINESS.md) and the
[QA correction](../docs/QA-ERRATA.md); do not infer native watch checks or invent
new device-approval requirements from the old generic checklist.

## Local tooling and records

`npm run store:prepare` creates a disposable checked kit; `npm run store:check`
compares its exact contents. Published listings default to the exact versioned
PBW in `releases/`, while preparation listings use `build/candidate/`. Both accept
`--pbw PATH` for explicit candidate or artifact selection.
`python3 scripts/freeze-release.py` freezes a separately reviewed,
unused version and refuses earlier releases. The [GitHub release guide](../docs/GITHUB-RELEASES.md)
explains the independent manual publication workflow.

[listing.json](listing.json) describes the current public listing and points to
[publication.json](publication.json). `store_submission_allowed: false` keeps
these local tools from granting automatic upload permission; it does not mean
the already-published plugin is unavailable. Earlier version-check observations
in [upload-map.json](upload-map.json) retain their recorded dates. The publication
record owns current distribution status. Frozen Store ZIPs keep their original
review/preparation text and are not rewritten by this maintenance update.
