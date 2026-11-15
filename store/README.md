# ČHMÚ Weather artwork

This is a phone-only weather plugin. Store uploads use the black transparent
`icon-small-80.png` and `icon-large-144.png`, marked tintable. The website uses
`product-mark.svg` at its actual UI size, with a matching 144px PNG fallback.
There is **no native launcher export** for this plugin.

`website-banner.png` and its editable SVG are website marketing artwork only.
Plugins have no Store screenshots or watch-platform banner fields. The image
must not be uploaded as either. It belongs to the XOCE family through Fira
outlines, weather bands/contours and a restrained shared presentation, without
inventing a watch interface.

## Current authority

[current-artwork.json](current-artwork.json) indexes the active files and
identifies the records that own their hashes:

- [icon-provenance.json](icon-provenance.json): current 80/144px Store icons and
  website marks, exported with binary alpha and a monochrome silhouette.
- [artwork-provenance.json](artwork-provenance.json): current website banner
  and editable SVG. Its source/font/reference paths describe the original
  review workspace, not files promised inside this app repository.
- [asset-provenance.json](asset-provenance.json): **historical 1.0.1** PBW,
  previous icon hashes and original settings previews. It is retained unchanged
  and does not override current icon provenance for reused filenames. Its original
  icon/preview bytes remain in the [frozen 1.0.1 Store ZIP](../dist/CHMU-Weather-1.0.1-store-package.zip).

The PNG/SVG files, old provenance records, original settings images and
[font/illustration credits](ARTWORK-LICENSES.txt) retain their bytes. Historical
browser previews do not become fresh-release or physical-phone evidence.

## Reproduction and maintenance

The maintained, self-contained generators and inputs live in
[XOCE artwork tooling](https://github.com/xefensor/xoce/tree/main/artwork).
Follow that README for dependencies, exact commands and product selections.
Original `artwork/...` paths retained in provenance identify their creation
context; they are not a missing local build dependency.

Use the editable SVG sources in this folder for inspection. Regenerate into a
review directory, compare intended exports and hashes, and update current
provenance deliberately when artwork changes. Do not overwrite a historical
record or silently alter the frozen Store package. App builds require none of
these artwork generators. [Publication](PUBLISHING.md) and
[publication.json](publication.json) own the checked release state.
