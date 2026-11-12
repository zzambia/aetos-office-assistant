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
git tag v0.2.12
git push origin v0.2.12
npm run sync          # mirror branch and tags to the internal GitLab
```

Code signing and notarization are **opt-in** and documented in [CI.md](CI.md).
Without those secrets the pipeline produces unsigned preview artifacts.

## Keeping the GitLab mirror in sync

GitHub is the primary remote (`origin`). The internal GitLab server is a
secondary remote named `gitlab`:

```sh
git remote -v
gitlab  ssh://git@git.internal.youbiquo.eu:2222/aetos/aetos-office-assistant.git
```

Mirror the current branch and tags with:

```sh
npm run sync                  # or: scripts/sync-gitlab.sh [branch]
```

The script retries the connection (the internal server is sometimes briefly
unreachable), fast-forwards the branch, and only forces a tag update when a
release tag has moved. GitHub remains the primary remote, so an unreachable
internal network never blocks a normal `git push`.

Pulling changes made on GitLab back into the working copy uses the normal
explicit remote:

```sh
git fetch gitlab
git log --oneline HEAD..gitlab/main
```

Automating the mirror from the GitLab side (so no local push is needed) is
possible with **Settings → Repository → Mirroring repositories**, which requires
a GitLab tier that includes repository mirroring. If available, configure GitLab
to *pull* from the public GitHub URL on a schedule.

### Scheduled mirror on macOS (launchd)

```sh
npm run sync:install     # every 900s; AETOS_SYNC_INTERVAL=3600 to change
npm run sync:status
npm run sync:remove
```

This installs the LaunchAgent `it.aetos-ai.office-assistant.sync`. It mirrors
`origin/main` rather than your working copy, so it also picks up commits made
through the GitHub web interface, and it runs whether or not the repository is
open. Output is appended to `~/Library/Logs/aetos-sync.log`.

```sh
launchctl kickstart -k "gui/$(id -u)/it.aetos-ai.office-assistant.sync"   # run now
tail -f ~/Library/Logs/aetos-sync.log
```

The script needs no interactive input: the GitLab SSH key has no passphrase and
GitHub HTTPS uses the `osxkeychain` credential helper. If you change either, rerun
the sync by hand first to confirm it still works unattended.

On Linux, use `scripts/sync-gitlab.sh` from cron or a systemd timer; the
`--from` behaviour is the same via `AETOS_SYNC_FROM=origin`.

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
