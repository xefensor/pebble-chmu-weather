# GitHub releases

The release workflow publishes versioned downloads to the repository's
[Releases page](https://github.com/xefensor/pebble-chmu-weather/releases).
The release workflow uploads the existing, checked public packages. The
personal build remains outside the public release allowlist.

## Current public release

[**v1.0.1 is published**](https://github.com/xefensor/pebble-chmu-weather/releases/tag/v1.0.1), using tested commit
`127995bf5612809c6693c0622813198475b37a75`. It keeps the public plugin UUID
`00866104-6ce5-4ae3-952f-9800f437442c` and the numeric Pebble version `1.0.1`.
The GitHub release is a stable project release; Pebble publishing eligibility
remains a separate account/platform requirement.

The selected public assets are:

- `CHMU-Weather-1.0.1.pbw`
- `CHMU-Weather-1.0.1-source.zip`
- `CHMU-Weather-1.0.1-store-package.zip`
- `SHA256SUMS.txt`, containing only the selected release asset basenames.

The initial tag points to that tested commit. Adding the automation does not
rebuild those packages or change the previously checked source archive.
Documentation and automation can move forward on `main` while those downloads
remain frozen. The next packaged version gets a new source snapshot and tag.

After downloading all four files into one directory, verify them with:

```sh
sha256sum -c SHA256SUMS.txt
```

The public PBW, source and store archives are also kept in [`dist/`](../dist/).

## Future releases

1. Update the numeric `package.json` version; if preparing a candidate, add the
   intended `releaseCandidate` number and set the configured GitHub prerelease
   flag appropriately. An RC or beta ID must remain a GitHub prerelease. Preserve the public UUID.
2. Run the tests and prepare the **public** build with `npm run build`. Follow
   the [validation record](VALIDATION.md) for any relevant runtime/service/UI
   checks. Assemble the source and store archives, update `dist/SHA256SUMS`,
   and refresh the release notes.
3. Confirm the exact public filenames match `.github/release.json`. Templates
   use `{release_id}`, which includes `-rc.N` when applicable.
4. Commit the version, checked artifacts, checksums and notes locally. Run the
   release helper against that committed `HEAD`, then push the commit to `main`.
   GitHub Actions validates the pushed version and publishes the downloads. It
   attaches the prepared packages rather than rebuilding them.

For local checks without uploading anything, install dependencies and run tests:

```sh
npm ci --ignore-scripts
npm test
```

After packaging and committing the complete release locally, validate it with:

```sh
python3 scripts/github-release.py prepare --output /tmp/chmu-release-check
```

`prepare` reads committed `HEAD`, not uncommitted working-tree changes. Running
it before the release commit checks the previous committed version. Push to
`main` only after this check passes.

`npm test` covers JavaScript, packaging and release-automation tests. The
focused release check is `python3 -m unittest discover -s tests -p test_github_release.py`.
Live network smoke tests are separate; they are not run by the release workflow.

The release configuration is repository-maintained metadata. Its `bootstrap`
entry identifies only the initial existing release; future versions use
their own artifact commit. Existing release assets are immutable: bump the
version when package bytes need to change.

A manual rerun through the release workflow's **Run workflow** button is safe
for the same version and identical assets. It verifies the existing release
instead of creating a duplicate. Conflicting tag targets or changed asset
bytes fail validation rather than replacing a published release.

## Public/personal boundary

The workflow selects exact public filenames and verifies the public PBW's
identity and build marker. The public script must start with
`// CHMU_BUILD_VARIANT=public`, and its script and internet permissions must
exclude the authenticated `chmu.rails.cz` service. Its configuration must also
identify the public variant.

Personal binaries belong in ignored `build/personal/`; neither that directory
nor `*-personal*` artifacts are uploaded. Source ZIP validation also rejects
root `build/`, `node_modules/`, `.git/` and `.pebble/` folders and any `.pbw`
member, including a nested or differently cased personal binary. The public source archive intentionally
includes the personal build recipe and code, as documented in the main README;
that does not turn the public PBW into the personal variant. Installation
credentials are generated at runtime and are not embedded in the public build.

## Workflow boundaries

The `check` job has read-only repository access and runs portable tests and
artifact validation. Only the `publish` job receives content-write access through
GitHub's built-in token. The workflow uses pinned official checkout/Node actions;
no personal access token or separate scheduler is needed. Publication creates a
draft, verifies every uploaded asset, then publishes it. A matching interrupted
draft can resume; an incompatible published release fails rather than being
clobbered.

The workflow is limited to `main`. It triggers for version/artifact/checksum or
release-automation changes, and supports **Actions → GitHub release → Run workflow**.
Ordinary documentation-only commits do not trigger a release. Do not move an
existing tag or replace a released file to fix a later issue: prepare a new
version instead.

## Pebble distribution status

GitHub provides downloadable public packages. The workflow does not submit a
Pebble appstore listing, run live weather requests or use personal service
credentials. Review [Pebble publishing instructions](../store/PUBLISHING.md)
and the remaining live-service/physical-device checks before a store upload.

[Project README](../README.md) · [Maintainer notes](../AGENTS.md) · [Validation](VALIDATION.md)
