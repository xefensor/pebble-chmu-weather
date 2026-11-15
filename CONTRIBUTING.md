# Developing ČHMÚ Weather

Follow the [XOCE contributor conventions](https://github.com/xefensor/xoce/blob/main/docs/contributor-conventions.md)
and this project's [maintainer instructions](AGENTS.md). This is a phone-only
plugin: no Pebble SDK, native Android app or sibling checkout is required.

## Build a local candidate

Use the pinned Node **22.23.4** and Python **3.12.15** from `.node-version` and
`.python-version`; CI reads those files too. The supported minimum remains
Node 20+ and Python 3.10+. Install the locked dependencies, then run:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

For current version 1.0.4, the public output is
`build/candidate/CHMU-Weather-1.0.4.pbw`. The versioned basename follows
`package.json`, including any RC suffix. An explicit output is supported:

```sh
npm run build -- --output build/qa/CHMU-Weather-1.0.4.pbw
```

Keep the canonical versioned basename when choosing another directory. Normal
builds refuse output under frozen `dist/` or `releases/`. Preserve the public UUID,
three public domains, locations/units and observation-versus-forecast meaning.
See [feed contracts](docs/FEEDS.md) and [privacy](PRIVACY.md).

## Source and outputs

`src/plugin/` owns Pebble source/config handlers; `src/lib/` owns providers,
parsing, envelopes, settings and caches. `src/config.html` owns the bilingual
settings page. `scripts/` builds/verifies packages, `test/` contains JavaScript
checks, `tests/` contains Python checks and `store/` holds listing artwork/copy.

Use ignored `build/candidate/` for development PBWs, `build/store/` for checked
submission kits and `build/qa/` for disposable evidence. `npm test` covers source,
packaging and release automation. To make real public weather requests against
the exact current candidate, run this optional check separately:

```sh
python3 scripts/smoke.py --pbw build/candidate/CHMU-Weather-1.0.4.pbw
```

The smoke executes packaged JavaScript in a restricted host shim. It does not
establish physical-phone installation, permission prompts or provider delivery.
Keep its result separate from browser fixtures and real devices; consult
[validation](docs/VALIDATION.md) and the [QA correction](docs/QA-ERRATA.md).

## Personal builds

`npm run build:personal` writes a separately labelled package under ignored
`build/personal/`, with its own UUID. Public checks need no personal-service
credentials or live personal smoke. Personal binaries and generated credentials
must not enter public release files. Source/build recipes remain available.

## Prepare a future release

Version 1.0.4 is already published. Routine documentation/tooling changes do not
require a new version, a rebuild of frozen files or a new release. For a separately
reviewed package change, first select an unused version and update its
listing/release metadata to preparation. The following commands then use that package version:

```sh
npm run build
npm run store:prepare
npm run store:check
python3 scripts/freeze-release.py
```

For a preparation listing, Store preparation/checks select that candidate. A
published listing instead selects the exact `releases/CHMU-Weather-VERSION.pbw`
so ordinary Store checks do not substitute development bytes for a public build.
Override either with `--pbw PATH` when intentionally checking another canonical-
named PBW. The freezer
also supports `--pbw PATH --store-kit PATH`; its defaults are the current candidate
and `build/store/CHMU-Weather-VERSION-store-package.zip`. It compares the exact kit
contents with that PBW, refuses an existing frozen version and creates the public
PBW/source/Store archives plus `releases/SHA256SUMS-VERSION.txt`. This plugin has
no native debug archive.

Commit a complete future release locally before `npm run release:prepare`.
Preparation reads committed HEAD (or its existing frozen tag when applicable),
not unsaved working-tree changes, and does not build or publish. Preserve all
published tags/assets and existing `dist/`, `releases/` and historical QA bytes.

Push/PR workflows run read-only checks. Publication is a separate, explicitly
requested **GitHub release → Run workflow** operation on main; ordinary pushes
no longer publish automatically. See [the release guide](docs/GITHUB-RELEASES.md)
and [current readiness](docs/RELEASE-READINESS.md). No Store upload is triggered
by source checks, freezing, preparation or the GitHub release workflow.
