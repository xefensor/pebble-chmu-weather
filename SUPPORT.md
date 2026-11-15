# ČHMÚ Weather support

The current public release is **1.0.4**, available in
[Pebble Store](https://apps.repebble.com/ef7111ffaeaf4593aaaa85ed) and
[GitHub releases](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.4).
Use the [setup guide](https://xefensor.github.io/xoce/docs/pebble/chmu-weather/)
and the [README](README.md) for provider/location choices.

Report problems at [GitHub issues](https://github.com/xefensor/pebble-chmu-weather/issues).
Include the plugin and Pebble phone-app versions, saved/current location mode,
selected source options, observation time and reproduction steps. Remove precise
private locations, installation identifiers and credentials from reports.

Use the current official Pebble phone app with plugin support enabled. Choose
ČHMÚ Weather as the built-in Weather provider or select its standard
`weather/location` readings in a compatible consumer. These are separate setup
paths. The plugin has no watch app to open and does not publish Timer-style
Activities.

Settings save automatically; **Refresh data** fetches a new result. If readings
are missing, inspect the location's **Source details**, coverage and permissions.
Provider availability and Pebble's refresh schedule affect delivery. Receiving an
old observation does not make it fresh. This is an independent plugin, not an
official ČHMÚ application.

Personal builds are a separate channel outside the public Store package.
[Privacy](PRIVACY.md), [third-party notices](THIRD_PARTY.md), [validation](docs/VALIDATION.md)
and the [QA correction](docs/QA-ERRATA.md) explain data handling and evidence scope.
