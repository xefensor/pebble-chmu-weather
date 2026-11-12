# ČHMÚ Weather release preparation

The local 1.0.2 package is being prepared for the Pebble Store. It has not been
submitted or published. The existing [1.0.1 GitHub release](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.1)
remains unchanged. The public plugin UUID remains
`00866104-6ce5-4ae3-952f-9800f437442c`.

Current listing fields are in [listing.json](listing.json), with English and
Czech descriptions, release notes and original 80×80 / 144×144 weather icons.
This phone-only plugin has no watch binary or Store screenshot fields.
The Personal variant and its UUID must never enter a public bundle.

[Plugin publishing](https://developer.repebble.com/guides/plugins/publishing-plugins/)
supports the Pebble CLI and Developer Dashboard. Preview status does not prohibit
submission. Plugins remain disabled by default in the phone app: enable
Settings → Plugins → Plugins / permissions preview. The current
[preview guide](https://developer.repebble.com/guides/plugins/preview/) describes
mobile app 1.18.0.1; use the current phone app for final validation.

Permissions keep public ČHMÚ data required and the backup/open-data and
Open-Meteo services optional, with separate reasons. Saved locations do not
need GPS; current location uses the optional Location permission. The exact
allowlist is `data-provider.chmi.cz`, `opendata.chmi.cz` and
`api.open-meteo.com`. No public build may contain app-service authentication,
credentials or `chmu.rails.cz`.

Before publication, finish physical Time 2/Android integration, verify listing
ownership and that numeric version 1.0.2 is unused, inspect the prepared PBW,
source, notices and checksums, and obtain explicit final approval. Preparing
files never invokes login, upload, publication or deployment.
