# Architecture and constraints

AETOS Office Assistant is a static Office add-in. There is no backend, no
inference engine and no proxy. The task pane runs in Word's browser engine and
talks directly to the model endpoint you configure.

## Modules

| File | Responsibility |
|---|---|
| `src/core.js` | Settings, limits, prompts, session lifecycle, selection and freshness rules. |
| `src/transport.js` | Bounded SSE/JSON processing, timeout, cancellation and safe error messages. |
| `src/markdown.js` | Inert Markdown-to-native-OOXML renderer. No HTML execution and no image downloads. |
| `src/fingerprint.js` | Local fingerprint of uncompressed DOCX package parts. |
| `src/xml-fingerprint.js` | Normalization used by the document comparison. |
| `src/word.js` | Tracked Word ranges, document checks and a single OOXML insertion call. |
| `src/app.js` | Task pane UI, preview, settings and explicit acceptance. |

## Document integrity checks

Before offering a suggestion for insertion, the add-in exports the current
document in memory and fingerprints it. Document contents, styles,
headers/footers and relationships are hashed **locally**, excluding volatile
`docProps/` metadata and Word's own bookkeeping churn.

None of that full-document data is transmitted to the provider or persisted.

- The export is capped at **64 MiB** compressed and expanded.
- A 3-second monitor detects observed changes while you review a suggestion.
- Acceptance rechecks document content and range location.

This is **not** an atomic transaction and cannot detect every possible edit
undone between observations. Merely moving the selection can be reversed;
observed document edits permanently invalidate that suggestion.

## Apply behaviour

- Generating never edits the document. The preview is read-only while streaming
  and becomes editable only after a successful completion.
- **Insert after selection** and **Replace selection** perform one tracked Word
  edit.
- **Copy** copies the Markdown.
- **Discard** invalidates the request and cancels its transport.
- Partial results from failed requests remain copyable but cannot be applied.
- If a host mutation has an uncertain result, application is disabled to prevent
  retrying the same edit. Check the document before generating again.
- After a successful application the suggestion is cleared.

## Supported-host policy

The Word API floor is **WordApi 1.3** (Microsoft documents Windows
version 1612/build 7668.1000, Mac 15.32, and Word on the web for that requirement
set).

**Those historical versions are not supported by this build.** The add-in also
requires a modern engine with:

- ES modules,
- `fetch` streaming,
- Web Crypto,
- `DecompressionStream('deflate-raw')`.

Target hosts:

- current Microsoft 365 Word on Windows with WebView2,
- current Microsoft 365 Word on macOS,
- current Word for the web in a modern browser.

An exact minimum tested Word/browser build is **not yet established**.
Unsupported export or browser capabilities fail closed.

## Local launchers

The Windows launcher (`desktop/Launcher.cs`) and the macOS app (`macos/Sources`)
embed the built web assets and serve them over trusted HTTPS on
`https://localhost:38473`, listening on loopback only.

Both apply the same rules:

- Only `GET` and `HEAD` are allowed; other methods get `405`.
- Path traversal is refused; unknown assets get `404`.
- Foreign `Host` headers get `400`.
- Word's `_host_Info` and other bootstrap query parameters are ignored for
  routing, and the URL is left intact so Office.js can read it.
- Responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` and a restrictive `Content-Security-Policy`.

Neither launcher records document content, request headers or credentials.

## Security posture

- No analytics, telemetry, proxy or third-party scripts.
- API keys stay in local browser storage and are never written to documents.
- Markdown rendering is inert: no HTML execution and no remote image loading.
- Model credentials are never included in diagnostics.

## Testing

- `npm test` runs 56 automated tests (see [HOST-TESTS.md](HOST-TESTS.md) and
  [automated-test-results.tap](automated-test-results.tap)).
- Both launchers expose a self-test that exercises routing, security headers,
  traversal refusal, method and host refusal, and Word's query-string URL.

```sh
"macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant" --self-test-routes /tmp/routes.txt
"macos/build/AETOS Office Assistant.app/Contents/MacOS/AETOS-Office-Assistant" --self-test /tmp/self.txt
```

The synthetic model endpoint used for host testing is documented in
[MODELS.md](MODELS.md).

## Known gaps

Feature parity is tracked in [PARITY.md](PARITY.md) and real-Word behaviour in
[HOST-TESTS.md](HOST-TESTS.md). Neither is complete for version 0.2.11.
