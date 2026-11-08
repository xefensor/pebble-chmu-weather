# Developing ČHMÚ Weather

Follow the [XOCE contributor conventions](https://github.com/xefensor/xoce/blob/main/docs/contributor-conventions.md)
and this project's [maintainer instructions](AGENTS.md). This is a phone-only
plugin. It needs Node.js 20+ and Python 3.10+; it needs no Pebble SDK, native
Android app or sibling checkout. CI uses Node 22. Install the locked dependencies:

```sh
npm ci --ignore-scripts
npm test
npm run build -- --output build/candidate/CHMU-Weather.pbw
```

The build is public by default. The explicit output keeps frozen `dist/` releases
intact. Preserve the public UUID, three declared public domains, source fields,
locations, units and the distinction between observations and forecasts. See
[feed contracts](docs/FEEDS.md) and [privacy](PRIVACY.md).

## Source and outputs

`src/plugin/` owns Pebble source/config handlers; `src/lib/` owns providers,
parsing, envelopes, settings and caches. `src/config.html` owns the bilingual
settings page. `scripts/` builds and verifies packages, `test/` contains
JavaScript tests, `tests/` contains Python checks, `docs/` records contracts and
verification, and `store/` holds listing assets. Keep these project-specific
locations and packaging references intact.

Use ignored `build/candidate/` for public development artifacts and `build/qa/`
for disposable evidence. `npm test` includes packaging and release-automation
checks. For live public data checks against the exact candidate:

```sh
python3 scripts/smoke.py --pbw build/candidate/CHMU-Weather.pbw
```

The smoke check makes public HTTPS requests. It executes the packaged plugin in
a restricted host shim; it does not establish installation, permission prompts
or provider delivery inside a physical Pebble phone app. Keep those checks
separate in the report. Review [validation](docs/VALIDATION.md) before reusing
historical results.

## Personal builds and publication

`npm run build:personal` is an explicit separate channel under ignored
`build/personal/`, with its own identity. Public checks do not need a live
personal-service smoke or credentials. Preserve its separation from public
packages, catalogue links and release assets.

Use local commits for review. Follow [the release workflow](docs/GITHUB-RELEASES.md)
only when publication is authorized: a push to `main` can publish automatically.
Do not overwrite frozen 1.0.1 artifacts, bump a version for routine edits, or
treat a local candidate as a published release.
