# ČHMÚ Weather 1.0.3 — Store artwork

The banners follow Xef’s original Halftone composition: a bold product colour, curved patterned edge, large title and illustrated watch. The native screenshot bytes are embedded unchanged; standalone Store screenshots remain raw and unframed. The original Halftone banner and all frozen release archives remain intact.

Store icons are black, single-colour glyphs on a transparent background, with binary alpha and no baked-in tile, gradient or shadow. Upload `icon-small-80.png` and `icon-large-144.png`, then enable the listing’s tintable-icon setting so the public API reports `icon_tintable: true`. This is what lets Store clients recolour the same glyph for light and dark mode; separate dark/light uploads are not needed. The exact signed-in checkbox wording is not assumed.

This is a phone plugin. It has no Store watch screenshot or banner; the Weather marketing banner is website-only.

`listing.json` and the upload map select the files. The review folder is `Watch/Pebble-Store-Artwork-2026-11-14/`; it includes the original reference, light/dark proofs and pixel checks. `ARTWORK-LICENSES.txt` preserves the font and original illustration credits. This listing-artwork change does not alter the PBW, app version or watch launcher resources.

Sources: https://appstore-api.repebble.com/ and https://developer.repebble.com/guides/appstore-publishing/preparing-a-submission/
