# ČHMÚ Weather settings candidate

This is the unpublished ČHMÚ Weather 1.0.4 candidate. Its public UUID, provider behavior and permissions are unchanged. The fresh public PBW is under `build/candidate/`; build and verification records are collected alongside the release-work apps in `proofs/chmu-weather/`. The original frozen 1.0.3 review package remains unchanged. Nothing has been published.

The candidate corrects three interactions:

- Saving a setting no longer labels the Refresh button as though a weather refresh is running.
- When a saved change clears its old diagnostic reading, a temporary card keeps only the place name and an instruction to refresh. It never reassigns an old weather value to the newly selected station. If the station selector disappears, keyboard focus moves to Refresh.
- The UV selector is associated with its dependency message. An unmet Open-Meteo completion requirement is visibly warned without changing the saved UV preference.

English/Czech helper text also separates Pebble's saved places and units from the measuring-station selection. Original page styling and dark/mobile behavior are retained.

## Verification

```sh
npm ci
node --test test/client.test.js test/build-policy.test.js test/settings-page.test.js
python -m unittest discover -s tests -p test_package.py
```

The five new async DOM cases run the real inline settings script with jsdom 26.1.0 and deferred fixture replies. They verify language-specific save/refresh status, honest pending context, focus recovery, failed-save restoration and the UV dependency. jsdom is a development dependency only.

For local visual review:

```sh
node scripts/build-settings-preview.cjs /absolute/path/to/preview/chmu-weather
```

Serve that output directory using the review environment. Open `index.html?lang=en&theme=light` or `index.html?lang=cs&theme=dark`. The local review toolbar labels the data as simulated and can fail the next save or refresh. It shows requests visibly; no weather provider, phone action or account is used. The production page script is unchanged by the preview builder. Public build markers are substituted, and theme variables are copied from the actual production CSS so both appearance modes can be inspected.

`preview-manifest.json` records hashes of the candidate config, fixture bridge and generated review page. The builder does not write a PBW or modify the production config.
