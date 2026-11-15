# GitHub releases

## Current public release

**[Version 1.0.4](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.4)**
is published on GitHub and in [Pebble Store](https://apps.repebble.com/ef7111ffaeaf4593aaaa85ed).
[store/publication.json](../store/publication.json) records the verified public
links, UUID and exact PBW SHA-256. Source/package evidence and its
[QA correction](QA-ERRATA.md) remain distinct from publication.

The GitHub release contains:

- `CHMU-Weather-1.0.4.pbw`
- `CHMU-Weather-1.0.4-source.zip`
- `CHMU-Weather-1.0.4-store-package.zip`
- `SHA256SUMS.txt`, containing those selected asset basenames.

Download all four into one directory, then verify with:

```sh
sha256sum -c SHA256SUMS.txt
```

The frozen 1.0.4 package/source/Store files are also under [`releases/`](../releases/),
with `SHA256SUMS-1.0.4.txt`. Historical `dist/` files, earlier releases and the
initial 1.0.1 bootstrap commit remain unchanged. A new current document does not
change the contents of an already-published source archive.

## Future releases

Routine source documentation or tooling changes do not create a release. For a
separately requested package change:

1. Choose an unused numeric version in `package.json`, preserving the public
   UUID. Set the new listing to preparation and update its notes/metadata. RC/beta
   identifiers must remain GitHub prereleases.
2. Select the pinned runtimes, install locked dependencies and run source/package
   checks. `npm run build` creates the canonical public candidate beneath
   `build/candidate/`; normal builds refuse frozen output folders.
3. Run `npm run store:prepare` and `npm run store:check`. Preparation listings
   default to that candidate; published listings default to their exact `releases/`
   PBW. The `--pbw PATH` override explicitly selects another canonical-named file.
   Follow [readiness](RELEASE-READINESS.md) for evidence scope.
4. Run `python3 scripts/freeze-release.py` for the unused version. Defaults select
   that candidate and its checked `build/store/` kit; `--pbw PATH --store-kit PATH`
   select explicit inputs. The helper refuses an existing frozen version and
   copies exact checked bytes to new PBW/source/Store files and versioned checksums.
5. Commit the complete version/artifacts/notes locally and validate the committed
   release with `npm run release:prepare`. Then push for read-only source checks.
6. When GitHub publication has been explicitly requested, run **Actions → GitHub
   release → Run workflow** on main. This manual operation uploads the checked
   frozen packages; it does not rebuild them or submit a Pebble Store update.

For a local check:

```sh
npm ci --ignore-scripts
npm test
npm run release:prepare
```

Preparation reads committed HEAD, not uncommitted changes. An unchanged existing
release is validated against its original tag and frozen artifact identity;
later documentation/tooling commits do not authorise replacing it. `.github/release.json`
selects the public files. Its bootstrap record identifies the first frozen
release and is not a dependency pin to update on every version.

## Workflow boundaries

Pushes and pull requests run source/candidate checks without upload credentials.
The separate release workflow is manual-only and restricted to main. Its
read-only checks precede the content-write publish job. It uses GitHub's workflow
token and pinned actions; no personal access token is required.

A repeated manual run for the same tag and identical files verifies the existing
release rather than replacing it. A matching interrupted draft can resume;
changed assets or a conflicting tag fail. Never move a published tag or replace
its files to repair a later issue.

The focused release tests are
`python3 -m unittest discover -s tests -p test_github_release.py`. Live weather
requests are a separate optional smoke check, not part of normal source CI or
release publication. Phone permissions/provider delivery and physical-device
coverage require their own evidence.

## Public and Personal separation

The allowlist contains the public PBW, source ZIP and Store ZIP only. The public
script/build marker and configuration identify `public`; public permissions and
runtime code exclude `chmu.rails.cz` and app-service authentication.

Personal binaries belong in ignored `build/personal/`, with a separate name and
UUID. They and generated credentials must never be public release assets.
Personal recipe/source code can remain in the public source ZIP; generated
build/dependency/Git folders and PBW binaries cannot. This is a phone-only
plugin, so no native debug archive or launcher capture belongs in its release.

[README](../README.md) · [Contributing](../CONTRIBUTING.md) ·
[Store publishing](../store/PUBLISHING.md) · [Current validation](VALIDATION.md)
