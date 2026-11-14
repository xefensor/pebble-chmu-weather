# ČHMÚ Weather 1.0.2 — current Store preparation

The active listing is `listing.json`. Descriptions and release notes are plain
text; native screenshots and banner filenames are listed per platform. Upload
standalone native PNGs as screenshots and the 720×320 family PNG as each platform’s
banner. SVGs, product marks, provenance and licence files are editable/review
material, not extra screenshots.

Upload the 80×80 and 144×144 icons. This is a phone-only plugin: no watch screenshots or Store banners.

The coordinated family artwork is original XOCE work. Inter text is outlined in
SVG, with its SIL OFL notice in `ARTWORK-LICENSES.txt`. Official hardware frames
are not used in these Store banners. Native app UI, UUID and version are unchanged.

Prepare/check a kit with `python3 scripts/store-kit.py --pbw /path/to/checked.pbw`
and the same command with `--check`. Outputs stay under ignored `build/store/`.
The six-product review bundle is `Watch/Store-Update-2026-11-14/` in the workspace.
Keep old `dist/`, `releases/` and prior review bundles unchanged.

This preparation does not upload, publish or deploy anything. Existing review
acceptance is retained; emulator/browser checks do not establish physical phone
or watch testing. Verify the Dashboard listing/ownership and exact public
release bytes before activating website installation links.
