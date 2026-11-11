# AETOS Office Assistant

Independent Microsoft Word task-pane add-in — a rewrite of the author's WordCraft plugin, based on the Writing Assistant PRD dated 19 October 2026. Version 0.2.10 is an implementation preview, **not a declaration of verified WordCraft feature parity**. The source, built application, sideloadable XML manifest, automated tests and explicit parity/host-test checklists are included.

**Windows users:** the desktop launcher in `desktop/release/` embeds this web application and handles local setup, HTTPS, Word developer registration and optional startup at sign-in. No Node/npm commands are required to use it. Read `desktop/START_HERE.txt` for its preview status and installation steps. The bundled executable is the 0.2.9 Windows build; rebuild it on Windows with `desktop/build.ps1` for 0.2.10. The development commands below remain available for source builds and non-launcher hosting.

**macOS users:** a native menu-bar launcher app is built with `macos/build.sh` (see "macOS app" below). It embeds the web application, serves it over trusted localhost HTTPS, sideloads the manifest into Word and can start at login — no Node/npm or terminal needed to use it. The app is an unsigned preview build; see [docs/CI.md](docs/CI.md) for signing and notarization.

## Build and test

Use Node.js 22 or later. There are **no npm dependencies**, no package installation and no cloud build step. Runtime Office.js is loaded from Microsoft's official hosted URL.

```sh
npm test
npm run build
```

The build copies browser ES modules to `dist/`, copies the supplied logo and its PNG icon sizes, and writes `dist/manifest.xml`. Sources are in `src/`; generated output is already included. Run commands from this directory. The build does not read documents or contact model providers.

GitLab CI (`.gitlab-ci.yml`) builds the Windows launcher executable and the macOS `.app`/zip on `windows` and `macos` runners and runs the tests on a `linux` runner. Runner setup, signing and notarization notes are in [docs/CI.md](docs/CI.md).

## Run locally

An Office add-in needs an HTTPS origin trusted by the Word browser engine. Do not disable browser or Office security checks.

### macOS quick start

```sh
npm run mac:setup   # build, create/trust a localhost certificate, sideload into Word
npm start           # keep this running while Word uses the add-in
npm run mac:doctor  # optional readiness check
```

To keep the server in its own Terminal window instead of the current one, run `npm run mac:terminal`.

Open Word once and quit it with Cmd+Q before `mac:setup`, so Word's sandbox container exists. The scripts create a certificate in `.certs/`, trust it in your login keychain, and copy the manifest to Word's `wef` folder. Sideloading into Word's container may require granting your terminal app Full Disk Access in System Settings; alternatively copy `dist/manifest.xml` to the `wef` folder in Finder. See [docs/MAC.md](docs/MAC.md) for details, ports, troubleshooting and the macOS host-test gaps.

### macOS app (menu-bar launcher)

`macos/build.sh` produces a native, self-contained `.app` (no Node/npm needed to run it) plus a distributable zip:

```sh
./macos/build.sh
# macos/build/AETOS Office Assistant.app
# macos/build/AETOS-Office-Assistant-0.2.10-macos.zip
```

The app embeds the built web application, serves it over trusted HTTPS on
`https://localhost:38473`, sideloads the manifest into Word, and provides a menu
bar item (Open Word, start at login, remove setup, quit). On first launch it
creates/trusts a localhost certificate and registers the add-in; macOS may ask
you to approve the keychain change, and sideloading may require Full Disk Access.
The same origin/port, HTTPS routing and security headers as the Windows launcher
are used. Run its route self-test with
`macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant --self-test-routes /tmp/routes.txt`
(or `--self-test` to also exercise the TLS listener). The app is an unsigned
preview build; see [docs/CI.md](docs/CI.md).

### Windows and custom certificates

Obtain a development certificate for localhost using your organization's certificate process or Microsoft's Office add-in development tooling. Certificate creation/trust is deliberately not automated for Windows by this package. Do not disable browser or Office security checks.

PowerShell:

```powershell
$env:AETOS_TLS_CERT = 'C:\path\localhost-cert.pem'
$env:AETOS_TLS_KEY = 'C:\path\localhost-key.pem'
npm run build
npm start
```

Manual certificate on macOS or other platforms:

```sh
export AETOS_TLS_CERT=/path/localhost-cert.pem
export AETOS_TLS_KEY=/path/localhost-key.pem
npm run build
npm start
```

Open `https://localhost:3000/help.html` to check that your browser trusts the certificate. The server binds only to loopback. Keep it running while Word uses the add-in. There is no backend proxy or inference engine.

## Sideload in Word

Use `dist/manifest.xml`, not the source manifest when building for a different origin. The add-in is named **AETOS Office Assistant** and opens from Word's Add-ins list. The initial release uses the standard task-pane launcher; it has no custom ribbon tab.

- **Windows:** use an Office trusted shared-folder catalog containing `dist/manifest.xml`, or your organization's add-in deployment mechanism. After the catalog is configured and Word restarted, choose the add-in from the Shared Folder section of My Add-ins. Follow Microsoft's current instructions linked below; changing trust settings is a user/admin step.
- **macOS:** sideload the manifest into Word's `wef` folder with `npm run mac:sideload` (or manually, as described in Microsoft's guide), then open the add-in from Word. Word must trust the HTTPS certificate; `npm run mac:cert` creates and trusts one. See [docs/MAC.md](docs/MAC.md).
- **Web:** open a test DOCX in Word for the web and upload the manifest through the Office Add-ins upload command, where permitted by your tenant. The add-in origin must be reachable by that browser. Some tenants prohibit sideloading.

For deployment to your own static HTTPS hosting, set `AETOS_ORIGIN` to its origin before `npm run build` (for example `https://assistant.example.org`). Publish the contents of `dist/` at that origin's root and distribute its generated manifest. Serve `.js` as `text/javascript`, retain a restrictive CSP equivalent to `scripts/serve.mjs`, and do not add telemetry, a proxy, or third-party scripts. HTTPS hosting has **not** been provisioned or published by this task.

## Configure a model

Open **Model connection**, enter a connection name, the complete chat-completions endpoint, the exact model identifier, and optionally a Bearer API key. Save and optionally make it the default. No provider or model is preselected. Up to 32 connections may share an endpoint.

Keys are intentionally visible and saved **unencrypted in localStorage** with connection settings. Clearing the key and saving removes its stored value. Browser/Word profile storage may be isolated across hosts or cleared by policies. Settings are local to the add-in origin, not synchronized between devices, and never stored in Word documents.

An endpoint must accept browser CORS requests from the add-in origin, including POST with `Content-Type` and (if used) `Authorization`. Redirects, URL credentials, query strings and fragments are refused. Hosted endpoints require HTTPS; HTTP is permitted only for localhost, 127.0.0.1 and ::1 development connections. Browser mixed-content/private-network policies may still block HTTP loopback: use trusted HTTPS in that case. No gateway silently forwards content.

The request has `model`, `messages` and `stream: true`. The only document information in those messages is selected plain text. There are no tools, history, images or surrounding text. SSE requires `finish_reason: stop` and `[DONE]`; JSON requires one assistant text completion with `finish_reason: stop`.

## Use

1. Place a cursor for Draft, or select ordinary text for Rewrite/Summarize.
2. Choose the mode, enter instructions (required for Draft), and optionally expand Model to choose a session-only connection override.
3. Generate. The document is not edited. The preview is read-only while streaming and editable only after a successful completion.
4. Review/edit the Markdown and choose Insert after selection or Replace selection. Copy copies Markdown; Discard invalidates the request and cancels its transport.

Partial results from failed requests remain copyable but cannot be applied. After a successful application the suggestion is cleared. If a host mutation has an uncertain result, application is disabled to prevent retrying the same edit. Check the document before generating again. Merely moving the selection can be reversed; observed document edits permanently invalidate that suggestion.

## Architecture and constraints

- `core.js`: settings, limits, prompts, session lifecycle, selection/freshness rules.
- `transport.js`: bounded SSE/JSON processing, timeout, cancellation and safe errors.
- `markdown.js`: inert Markdown-to-native-OOXML renderer; no HTML execution or image downloads.
- `fingerprint.js`: local fingerprint of uncompressed DOCX package parts.
- `word.js`: tracked Word ranges, document checks and one OOXML insertion call.
- `app.js`: accessible task pane, preview, settings and explicit acceptance.

Local integrity checks export the current DOCX in memory. Document contents, styles, headers/footers and relationships are hashed locally, excluding volatile `docProps/` metadata. None of this full-document data is transmitted to the provider or persisted. The document export is capped at 64 MiB compressed and expanded; this is an additional implementation limit. A 3-second monitor detects observed changes, and acceptance rechecks document content and range location. This is not an atomic transaction and cannot detect all edits undone between observations. See the parity checklist for all gaps.

## Supported-host policy

The API floor is WordApi 1.3 (Microsoft documents Windows version 1612/build 7668.1000, Mac 15.32, and Word on the web for that requirement set). **Those historical versions are not supported by this build**: the add-in also requires a modern engine with ES modules, fetch streaming, Web Crypto and `DecompressionStream('deflate-raw')`. Target current Microsoft 365 Word on Windows with WebView2, current Microsoft 365 Word on macOS, and current Word for the web in a modern browser. An exact minimum tested Word/browser build is **not yet established**. Unsupported export or browser capabilities fail closed.

Read [docs/PARITY.md](docs/PARITY.md) and [docs/HOST-TESTS.md](docs/HOST-TESTS.md) before using this preview on important documents. macOS setup and host-specific limits are in [docs/MAC.md](docs/MAC.md).

## Synthetic endpoint for host testing

```sh
node scripts/test-endpoint.mjs
```

Default URL: `http://localhost:8787/v1/chat/completions`. If the same TLS certificate variables are set, it uses `https://localhost:8787/v1/chat/completions`. Optional `AETOS_ORIGIN` controls its CORS origin. Save separate connections with model IDs `sse`, `json`, `truncated`, `filtered`, `malformed`, and `timeout`. It returns only synthetic Markdown, validates the minimal request envelope and does not log request bodies or credentials. Do not send real private document text to a test endpoint unnecessarily.

## Official references

- [Word API requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-requirement-sets)
- [Word Range API](https://learn.microsoft.com/en-us/javascript/api/word/word.range)
- [Whole-document export](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/get-the-whole-document-from-an-add-in-for-powerpoint-or-word)
- [Windows sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)
- [Mac sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)
- [Web sideloading](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing)

No WordCraft code or Microsoft visual assets are included. The logo was supplied by the user from https://www.aetos-ai.it/images/aetos_logo_short.svg and is bundled locally. The original SVG is retained as logo.svg; desktop/render-logo.ps1 produces the raster sizes without changing the artwork. Office.js remains Microsoft's externally hosted runtime, subject to its terms.
