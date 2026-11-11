# Building and releasing

## Requirements

Node.js 22 or later. There are **no npm dependencies**, no package installation
and no cloud build step. Runtime Office.js is loaded from Microsoft's official
hosted URL.

## Build and test

```sh
npm test        # 56 automated tests
npm run build   # writes dist/
```

The build copies browser ES modules to `dist/`, copies the logo and its PNG icon
sizes, and writes `dist/manifest.xml`. Versioned module URLs are injected from
`src/version.js`. Generated output is included in the repository.

The build does not read documents or contact model providers.

`npm run verify` runs the tests, writes `docs/automated-test-results.tap`, then
builds.

## Build a launcher

**macOS** — produces a universal (arm64 + x86_64) app and a distributable zip:

```sh
./macos/build.sh
# macos/build/AETOS Office Assistant.app
# macos/build/AETOS-Office-Assistant-<version>-macos.zip
```

**Windows** — produces the executable with the in-box .NET Framework compiler:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
# desktop/release/AETOS-Office-Assistant-<version>.exe
```

`desktop/release/` is generated and is not committed.

## Run locally

An Office add-in needs an HTTPS origin that Word's browser engine trusts.

```sh
npm run mac:cert    # macOS: create and trust a localhost certificate
npm start           # serves dist/ on https://localhost:3000
```

For a custom certificate, set `AETOS_TLS_CERT` and `AETOS_TLS_KEY`. The server
binds only to loopback. `npm run mac:doctor` checks readiness, and
`npm run mac:terminal` starts the server in its own Terminal window.

`scripts/serve.mjs` is a reference server. It sets the content types, caching
headers and Content-Security-Policy that Word expects.

## Hosting `dist/` on your own HTTPS site

Set `AETOS_ORIGIN` before building so the manifest points at your origin:

```sh
AETOS_ORIGIN=https://assistant.example.org npm run build
```

Publish the contents of `dist/` at that origin's root and distribute the
generated `dist/manifest.xml`.

- Serve `.js` as `text/javascript`.
- Keep a restrictive CSP equivalent to `scripts/serve.mjs`.
- Do not add telemetry, a proxy or third-party scripts.

`AETOS_ORIGIN` must be an HTTPS origin with no path, query, fragment or
credentials, or the build fails.

## CI and releases

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes to `main`, on `v*`
tags, and manually:

| Job | Runner | Output |
|---|---|---|
| `test` | `ubuntu-latest` | test report |
| `build-windows` | `windows-latest` | `.exe` + `aetos-web.zip` |
| `build-macos` | `macos-latest` | `.app` + macOS zip |
| `release` | `ubuntu-latest` | GitHub Release on `v*` tags |

Cut a release by pushing a tag:

```sh
git tag v0.2.11
git push origin v0.2.11
```

Code signing and notarization are **opt-in** and documented in [CI.md](CI.md).
Without those secrets the pipeline produces unsigned preview artifacts.

A GitLab CI equivalent (`.gitlab-ci.yml`) is kept for self-hosted runners.

## Repository layout

```
src/           add-in source (ES modules)
scripts/       build, dev server, certificate, sideload, verify tools
desktop/       Windows launcher source and build script
macos/         macOS app source and build script
docs/          documentation and screenshots
tests/         Node test suite
dist/          generated web output
```
