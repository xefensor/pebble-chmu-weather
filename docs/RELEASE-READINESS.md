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
