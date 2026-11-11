# CI/CD (GitLab) — Windows and macOS artifacts

The repository builds two distributable artifacts in GitLab CI:

| Job | Runs on | Artifact |
|---|---|---|
| `test` | any Linux/Docker runner | test report (`docs/automated-test-results.tap`) |
| `build:windows` | Windows runner | `AETOS-Office-Assistant-<version>.exe` + `aetos-web.zip` |
| `build:macos` | macOS runner | `AETOS Office Assistant.app` + `AETOS-Office-Assistant-<version>-macos.zip` |

The pipeline is defined in `.gitlab-ci.yml`. It uses runner tags `linux`,
`windows` and `macos`. Jobs run on the default branch (`main`) and on tags.

## 1. Register runners

No runners are registered yet. Each job needs a runner with the matching tag.
Register them from the GitLab UI: **Settings > CI/CD > Runners**, or with
`gitlab-runner register`. The registration token is shown on that page.

### Linux runner (tests)

- Any machine with Docker, or a shell runner with Node.js 22.
- Register with tag `linux`.

```sh
gitlab-runner register \
  --url https://git.internal.youbiquo.eu \
  --registration-token "$TOKEN" \
  --executor docker \
  --docker-image node:22 \
  --tag-list linux \
  --non-interactive
```

### Windows runner (launcher executable)

- Windows 10/11 or Windows Server.
- Install [Node.js 22](https://nodejs.org/) and make sure `node`/`npm` are on PATH.
- `.NET Framework 4.8` must be present. The build uses the in-box compiler
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, which ships with
  Windows Server and Windows 10/11 — no NuGet packages are needed.
- Use the **shell** executor with PowerShell.
- Register with tag `windows`.

```powershell
.\gitlab-runner.exe register `
  --url https://git.internal.youbiquo.eu `
  --registration-token "$env:TOKEN" `
  --executor shell `
  --tag-list windows `
  --non-interactive
```

The runner runs the GitLab-provided PowerShell script, which invokes the
`.gitlab-ci.yml` `script` entries. `npm run build` then
`desktop/build.ps1` produce `desktop/release/AETOS-Office-Assistant-<version>.exe`.

### macOS runner (app bundle)

- A Mac with **Xcode Command Line Tools** (or full Xcode): `xcode-select --install`.
  The build uses `swiftc`, `lipo`, `iconutil`, `codesign` and `ditto`, all from
  the macOS SDK / command line tools.
- Install [Node.js 22](https://nodejs.org/).
- Use the **shell** executor (bash/zsh).
- Register with tag `macos`.

```sh
gitlab-runner register \
  --url https://git.internal.youbiquo.eu \
  --registration-token "$TOKEN" \
  --executor shell \
  --tag-list macos \
  --non-interactive
```

`./macos/build.sh` runs `npm run build`, compiles a universal
(arm64 + x86_64) Swift binary, assembles the `.app`, ad-hoc signs it, and
creates the distributable zip. The job then runs the in-app route self-test
(`--self-test-routes`) and fails if any check fails.

> macOS runners build for the runner's own macOS SDK. Building the app locally
> with `./macos/build.sh` on a modern Mac produces the same artifact.

## 2. Verify locally before enabling CI

On a Mac:

```sh
./macos/build.sh
"macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant" --self-test-routes /tmp/routes.txt
"macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant" --self-test /tmp/self.txt
```

On Windows:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
```

## 3. Code signing

### Windows (Authenticode) — supported in the pipeline

The Windows job signs the `.exe` with `signtool.exe` when a signing certificate
is provided. The certificate is read from GitLab CI/CD variables, so nothing is
committed. The build stays unsigned when the variables are absent, so local
builds and unsigned previews keep working.

Add these variables under **Settings > CI/CD > Variables** (make them
**Protected** and, for the password, **Masked**):

| Variable | Type | Value |
|---|---|---|
| `AETOS_SIGN_PFX` | **File** | the PKCS#12 (`.pfx`/`.p12`) code-signing certificate |
| `AETOS_SIGN_PASSWORD` | Variable | the `.pfx` password |
| `AETOS_SIGN_TIMESTAMP_URL` | Variable | optional; defaults to `http://timestamp.digicert.com` |

GitLab writes `AETOS_SIGN_PFX` to a temp file and passes its path to the job.
`desktop/build.ps1` then runs
`signtool sign /f <pfx> /p <password> /fd SHA256 /tr <timestamp> /td SHA256`
and fails the job if signing fails.

> **Protected variables note:** a *Protected* GitLab variable is only injected
> on protected branches/tags. If `main` is not protected, either protect it or
> create these variables as non-protected so the `build:windows` job receives
> them.

The runner needs `signtool.exe`, which ships with the **Windows SDK** (the
**Windows SDK Signing Tools for Desktop Apps** feature is enough). `build.ps1`
searches the SDK's usual install locations; set `AETOS_SIGNTOOL` to the full
path if it is installed elsewhere.

For a local signed build on a Windows machine:

```powershell
$env:AETOS_SIGN_PFX = 'C:\path\certificate.pfx'
$env:AETOS_SIGN_PASSWORD = '...'
powershell -ExecutionPolicy Bypass -File desktop/build.ps1
```

### macOS (Developer ID + notarization) — supported in the pipeline

`macos/build.sh` signs with a **Developer ID Application** certificate when
`AETOS_MAC_IDENTITY` is set, and notarizes + staples when the Apple credentials
below are also set. Otherwise it falls back to an ad-hoc signature, so local
unsigned builds keep working.

Add these variables under **Settings > CI/CD > Variables**:

| Variable | Type | Value |
|---|---|---|
| `AETOS_MAC_IDENTITY` | Variable | the signing identity, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `AETOS_MAC_NOTARY_APPLE_ID` | Variable | Apple ID used for notarization |
| `AETOS_MAC_NOTARY_TEAM_ID` | Variable | your Apple Developer team ID |
| `AETOS_MAC_NOTARY_PASSWORD` | Variable (masked) | an app-specific password for that Apple ID |

When all four are present the job runs:

```sh
codesign --force --options runtime --timestamp --sign "$AETOS_MAC_IDENTITY" "$APP"
xcrun notarytool submit "$ZIP" --apple-id ... --team-id ... --password ... --wait
xcrun stapler staple "$APP"
```

and re-creates the zip so the downloaded artifact carries the stapled ticket.
Notarization needs **full Xcode** (for `notarytool`) on the macOS runner, not
just the command line tools. The Developer ID certificate and its private key
must be present in the runner's login keychain.

> **Protected variables note:** a *Protected* GitLab variable is only injected
> on protected branches/tags. If `main` is not protected, either protect it or
> create these variables as non-protected.

Signing secrets should always be added as masked/protected CI/CD variables and
never committed to the repository.

## 4. What CI cannot do

The macOS first-run steps that mutate the local machine stay end-user steps and
are deliberately not performed in CI:

- trusting the localhost certificate in the login keychain,
- sideloading `manifest.xml` into Word's `wef` folder,
- Full Disk Access grants.

These run inside the `.app` (or the existing `scripts/mac-*.mjs`) on the user's
Mac. CI only builds and packages the artifacts and runs the in-memory route
self-test, which performs no keychain or Word changes.
