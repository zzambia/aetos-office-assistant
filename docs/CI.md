# CI/CD — GitHub Actions (Windows and macOS artifacts)

The repository builds two distributable artifacts on GitHub-hosted runners — no
self-hosted runners are required:

| Job | Runner | Artifact |
|---|---|---|
| `test` | `ubuntu-latest` | test report (`docs/automated-test-results.tap`) |
| `build-windows` | `windows-latest` | `AETOS-Office-Assistant-<version>.exe` + `aetos-web.zip` |
| `build-macos` | `macos-latest` | `AETOS Office Assistant.app` + `AETOS-Office-Assistant-<version>-macos.zip` |
| `release` | `ubuntu-latest` | GitHub Release (only on `v*` tags) |

The workflow is `.github/workflows/ci.yml`. It runs on pushes to `main`, on
`v*` tags, and manually via the Actions tab.

## Releasing

Tag the release and push the tag:

```sh
git tag v0.2.11
git push origin v0.2.11
```

The `release` job then attaches the Windows executable and the macOS zip to a
GitHub Release with auto-generated notes.

## Signing secrets

All signing is **opt-in**. Without the secrets below the jobs still run and
produce ad-hoc signed / unsigned preview artifacts.

GitHub stores secrets as strings, so certificates are supplied **base64-encoded**.
Add them under **Repo → Settings → Secrets and variables → Actions**.

### Windows (Authenticode)

| Secret | Value |
|---|---|
| `AETOS_SIGN_PFX_BASE64` | `base64 -i certificate.pfx` output |
| `AETOS_SIGN_PASSWORD` | the `.pfx` password |
| `AETOS_SIGN_TIMESTAMP_URL` | optional; defaults to `http://timestamp.digicert.com` |

The workflow decodes the certificate to a temp file and `desktop/build.ps1`
signs with `signtool sign`, then verifies with `signtool verify /pa`.

### macOS (Developer ID + notarization)

| Secret | Value |
|---|---|
| `AETOS_MAC_CERT_P12_BASE64` | `base64 -i DeveloperID.p12` output |
| `AETOS_MAC_CERT_PASSWORD` | the `.p12` password |
| `AETOS_MAC_NOTARY_APPLE_ID` | Apple ID used for notarization |
| `AETOS_MAC_NOTARY_TEAM_ID` | Apple Developer team ID |
| `AETOS_MAC_NOTARY_PASSWORD` | app-specific password for that Apple ID |

The workflow imports the `.p12` into a temporary keychain, finds the
`Developer ID Application` identity, and `macos/build.sh` signs with hardened
runtime, notarizes with `notarytool`, and staples the ticket before zipping.

## Local builds (same scripts, no CI)

```sh
./macos/build.sh                          # macOS .app + zip
"macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant" --self-test-routes /tmp/routes.txt
```

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File desktop/build.ps1   # Windows
```

## Self-hosted GitLab (optional, kept for reference)

`.gitlab-ci.yml` is a GitLab equivalent for teams that must self-host runners
instead of using GitHub-hosted ones. It uses runner tags `linux`, `windows` and
`macos`; register those runners in GitLab **Settings > CI/CD > Runners**.

All GitLab jobs are currently gated on the `AETOS_GITLAB_CI_ENABLED` variable
because no self-hosted runners are available. While it is unset the jobs resolve
to `when: never` and no runner is requested; set it (e.g. to `1`) as a CI/CD
variable to re-enable them. GitHub Actions is unaffected. On
GitLab, `AETOS_SIGN_PFX` is a **File**-type variable (not base64), and the
macOS variables use the same names listed above.

## What CI cannot do

The first-run steps that mutate the local machine stay end-user steps and are
deliberately not performed in CI:

- trusting the localhost certificate in the login keychain,
- sideloading `manifest.xml` into Word's `wef` folder,
- Full Disk Access grants.

These run inside the `.app` (or the existing `scripts/mac-*.mjs`) on the user's
machine. CI builds and packages the artifacts and runs the in-app route
self-test, which performs no keychain or Word changes.
