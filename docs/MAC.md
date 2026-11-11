# Running AETOS Office Assistant in Word on macOS

This guide covers the source build. The Windows launcher in `desktop/release/`
is a Windows executable and does not run on macOS.

The add-in is a static web application. Word for Mac loads it from a trusted
`https://localhost` origin in a WKWebView task pane, so macOS needs all three of:

1. a local HTTPS server for the files in `dist/`,
2. a localhost certificate that macOS trusts,
3. the generated manifest in Word's `wef` sideload folder.

## Requirements

- macOS with a current Microsoft 365 Word for Mac (`Word > About Microsoft Word`).
- Node.js 22 or later (`node --version`).
- `openssl` (included with macOS, or any recent OpenSSL in `PATH`).
- Optional: [mkcert](https://github.com/FiloSottile/mkcert). The setup script
  uses it automatically when installed, otherwise it creates a self-signed
  certificate with OpenSSL.
- **Full Disk Access** for the terminal app you build from (Terminal, iTerm,
  VS Code, etc.), so the sideload command can write into Word's sandbox
  container. Add it under **System Settings > Privacy & Security > Full Disk
  Access**, then quit and reopen the terminal. Alternatively, copy the
  manifest manually in Finder as described below.

No npm packages are installed. The build has no dependencies.

## Quick start

From the repository root:

```sh
npm test
npm run mac:setup
npm start           # keep this terminal open while Word uses the add-in
```

To keep the server in its own Terminal window instead:

```sh
npm run mac:terminal
```

That opens a Terminal window running `scripts/mac-start.command`. Closing
that window or pressing Ctrl+C stops the server.

`npm run mac:setup` performs a build and:

- creates `.certs/localhost-cert.pem` and `.certs/localhost-key.pem` with
  `localhost`, `127.0.0.1` and `::1` in the certificate;
- adds that certificate to your **login keychain** trust settings;
- copies `dist/manifest.xml` to
  `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/aetos-office-assistant.xml`.

Word must have been opened at least once before sideloading so its sandbox
container exists. Open Word, quit it with **Cmd+Q**, then run the command.

If macOS blocks access to Word's container, grant Full Disk Access to your
terminal app (see Requirements) and rerun `npm run mac:sideload`. The build and
certificate steps will not be repeated unnecessarily.

`npm start` serves `dist/` on `https://localhost:3000` and stays in the
foreground. Keep it running while you use Word.

Then:

1. Quit Word completely (**Cmd+Q**) if it was open, and reopen it.
2. Open or create a document.
3. Choose **Insert > Add-ins** (older builds: **Insert > My Add-ins**) and
   select **AETOS Office Assistant**.
4. In the task pane, open **Model connection** and save your endpoint, model
   and API key.

Check the setup at any time with:

```sh
npm run mac:doctor
```

## What the scripts do

| Command | Effect |
| --- | --- |
| `npm run mac:setup` | Build, create/trust the certificate, sideload the manifest. |
| `npm run mac:cert` | Only create and trust the localhost certificate. Add `-- --force` to replace an existing one or `-- --no-trust` to skip trust. |
| `npm run mac:sideload` | Only copy the manifest. Add `-- --clear-cache` to clear Word's disposable add-in caches, `-- --uninstall` to remove this add-in, or `-- --open` to launch Word afterwards. |
| `npm run mac:doctor` | Read-only check of Node, Word, certificate, trust, manifest and server. |
| `npm run mac:terminal` | Open a dedicated Terminal window running the HTTPS server. |
| `npm start` | Serve `dist/` over HTTPS on loopback. |

The certificate and private key are written only to `.certs/`, which is
git-ignored. The private key is never served or transmitted; keep `.certs/`
local and do not commit or share it. If your organization requires certificates
from its own PKI, skip `mac:cert` and point the server at your files:

```sh
export AETOS_TLS_CERT=/path/localhost-cert.pem
export AETOS_TLS_KEY=/path/localhost-key.pem
npm start
```

## How sideloading works on macOS

Word for Mac reads additionally installed add-in manifests from:

```
~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
```

The build writes `dist/manifest.xml` with its `SourceLocation` set to
`https://localhost:3000` (or the value of `AETOS_ORIGIN`). `mac:sideload`
copies that file unchanged to the `wef` folder. The manifest ID is stable, so
re-running the command updates the existing registration.

To use a different port, rebuild the manifest for that origin first:

```sh
AETOS_ORIGIN=https://localhost:3443 PORT=3443 npm run build && npm run mac:sideload
PORT=3443 npm start
```

`AETOS_ORIGIN` must be an HTTPS origin with no path, query or credentials.

## Troubleshooting

### `EPERM` or "Operation not permitted" while sideloading

macOS protects other applications' sandbox containers, so a terminal without
Full Disk Access cannot create `wef/` or copy into it. Either:

- add your terminal app to **System Settings > Privacy & Security > Full Disk
  Access**, quit and reopen the terminal, then run `npm run mac:sideload`; or
- install manually in Finder:
  1. Choose **Go > Go to Folder** and open
     `~/Library/Containers/com.microsoft.Word/Data/Documents`.
  2. Create a folder named `wef` if it does not exist.
  3. Copy `dist/manifest.xml` into `wef` and rename it to
     `aetos-office-assistant.xml`.

The error is a macOS privacy restriction, not a Word or add-in error.

### The add-in is not in the Add-ins list

- Quit Word with **Cmd+Q**, not just close the window, and reopen it.
- Confirm the manifest exists:
  `ls -l ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`
- Clear Word's cache and restart:
  `npm run mac:sideload -- --clear-cache`
- Make sure the server is running: `npm run mac:doctor`.

### The task pane is blank, or shows a certificate error

- Run `npm run mac:doctor`; it checks macOS trust for `localhost`.
- Trust changes are picked up only after Word restarts. Quit and reopen Word.
- If `npm run mac:cert` could not change the login keychain, add the
  certificate to the system keychain instead:

  ```sh
  sudo security add-trusted-cert -d -r trustRoot \
    -k /Library/Keychains/System.keychain \
    .certs/localhost-cert.pem
  ```

- Verify manually in Safari: `https://localhost:3000/help.html` must load
  without a warning.

### `EADDRINUSE` on port 3000

Something else is using the port. Start on another port **and** rebuild the
manifest for that origin:

```sh
AETOS_ORIGIN=https://localhost:3443 npm run build
npm run mac:sideload
PORT=3443 npm start
```

### "This add-in requires WordApi 1.3 and a modern WebView..."

The add-in checks for `WordApi 1.3`, `DecompressionStream('deflate-raw')` and
`crypto.subtle` before enabling generation. Update macOS and Microsoft 365
Word, quit Word, and reopen the add-in. The macOS WebView inherits the Safari
engine bundled with the OS, so very old macOS versions cannot run this build.

### "Word could not verify the document"

The integrity check uses `Office.context.document.getFileAsync` with
`Office.FileType.Compressed`, then unpacks the DOCX locally. The document must
be a DOCX-compatible file and below the 64 MiB limit. If macOS Word cannot
export the document in a particular state, save it as `.docx` and retry.

Failures are deliberately closed: generation may still be reviewable for some
package instability, but automatic insertion is disabled. Use
**Copy diagnostic** in the task pane when reporting a problem; it does not
include document text, attribute values or credentials.

### Provider requests fail but the add-in loads

The endpoint must allow browser CORS from the origin shown in the manifest
(`https://localhost:3000` by default) and must accept a POST with
`Content-Type: application/json` and, when used, `Authorization`. Hosted
endpoints must be HTTPS. HTTP is accepted only for loopback development
endpoints, and macOS private-network policies can still block it. WKWebView may
also block HTTP requests from the HTTPS task pane even to loopback; use an
HTTPS endpoint (or a local HTTPS proxy with a trusted certificate) if that
happens.

## Known host gaps on macOS

The code paths used here are WordApi 1.3 APIs, but this build has **not** been
validated against a real Word for Mac host in `docs/HOST-TESTS.md`. Treat the
following as unverified rather than working:

- one native Undo step for an applied suggestion;
- Track Changes and protected-document behavior;
- insertion into headers, footers and table cells;
- whole-cell and cross-story selection refusal;
- DOCX export stability across Word for Mac versions;
- screen-reader and keyboard behavior in the Mac task pane.

Run the scenarios in `docs/HOST-TESTS.md` with a disposable document before
relying on this preview. `docs/PARITY.md` records the remaining product gaps.

## Remove the add-in

```sh
npm run mac:sideload -- --uninstall
```

Then quit and reopen Word. To remove the certificate, open **Keychain Access**,
find the certificate named `localhost`, and delete it. To remove everything,
also delete `.certs/` and `dist/`.

## Security notes

- The server binds only to `127.0.0.1` and `::1`, not to other interfaces.
- The server has no proxy, telemetry or remote logging. Model requests go
  directly from the task pane to the endpoint you configure.
- Connection settings and visible API keys are stored unencrypted in the
  task pane's local storage, as described in the README. They are not stored
  in Word documents.
- The add-in manifest is unsigned, as with any developer sideload. Your
  organization may block unsigned or developer add-ins; do not bypass its
  policy.
