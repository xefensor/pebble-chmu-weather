# Release 1.0.4 · 2026-11-14

The final source tests, fresh builds, package checks and native emulator scope are recorded in [current validation](qa/release-1.0.4/validation.json). Historical galleries keep their capture versions and have explicit final-binary reuse proof. Physical phone/watch and live-provider results are not claimed. Xef authorized stable GitHub publication and retained the existing review acceptance; no new device approval gate applies. Pebble Store submission remains manual and unsubmitted.

# Local Store release candidate — 2026-11-12

This version is prepared for review and sideload testing. It has not been
submitted to Pebble Store or published as a new GitHub release.

Native products target Time 2 (Emery) and Round 2 (Gabbro) only. Duo is excluded.
ČHMÚ Weather is the public phone-only plugin. Personal Weather is never included.

The release uses SDK 4.44 / pebble-tool 5.1.2, Node 22.23.4 and Python 3.12.15.
The SDK emulator firmware reports v4.44.3. Dependencies are locked and internal
library archives record exact source commits and checksums. The native CI job
has been prepared and checked locally; it has not run on GitHub yet.

Source tests, package audits and emulator checks are separate from physical
phone/watch validation. Raw evidence remains in the local workspace under
`recovery-validation/release-qa/`; the release review bundle records the exact
PBW hashes and evidence paths. Store screenshots are unmodified native pixels
with synthetic sample data. Phone previews were refreshed from native renders.

Before publication:

- Test the final PBW on Time 2 with the current Android Pebble app: upgrade with
  saved state, permission denial/regrant, actual settings Save, selected provider
  delivery, offline/reconnect and the product's physical controls.
- Check real Timer Wakeups/Quiet Time and live music, notifications and artwork
  where applicable. Round 2 remains emulator-only and must be disclosed.
- Confirm Developer Dashboard listing ownership, UUID and unused version.
- Publish the proposed privacy/support documents at the listed URLs and verify
  them. The current site catalogue keeps existing public downloads until the
  new GitHub releases exist.
- Obtain final publication approval. Local freezing and release preparation
  do not authorize a push, release workflow, Store upload or site deployment.

Use `npm run store:prepare` and `npm run store:check`, then
`python3 scripts/freeze-release.py` to freeze exact checked candidates into new
versioned files. Existing historical files and checksums stay unchanged.

## Verified candidate

Exact public PBW live smoke passed against all three declared public hosts (HTTP 200), with zero private-backend requests and zero request-safety failures. Public/private packaging and cache/expiry/permissions regressions pass. Personal Weather was not exercised or included in public release files.

Exact package identity, checks and remaining gates are recorded in
[the versioned review](qa/1.0.2/release-review.json).


## Store update — 1.0.3 (2026-11-14)

Xef requested a new numeric version for the reviewed current implementation and Store handoff. Public Store history already contains 1.0.2; 1.0.3 was absent from the checked public Store history and GitHub tags. The public UUID, saved-state compatibility, pinned dependencies and reviewed native interfaces are retained. New source/artifact/Store verification is recorded with this release preparation; prior emulator captures are reused only after native renderer/resource equality is verified. No new physical-device result is claimed. GitHub branch pushes are authorized; app submission and website deployment remain separate.
