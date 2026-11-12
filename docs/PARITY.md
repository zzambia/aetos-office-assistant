# AETOS Office Assistant — PRD parity checklist

Date: 19 October 2026. Status: **implementation preview; parity not achieved/verified**.

Freshness update in 0.2.3: XML parts are normalized before hashing. Revision-session attributes, settings rsids/proofState/view/zoom and generated docId, proofErr, cached page breaks, and the internal _GoBack bookmark are excluded. Namespace prefixes, attribute ordering and serialization-only whitespace do not cause differences. Text (including spaces in Word text nodes), formatting, headers/footers, user bookmarks, protection and revision settings remain checked. The supplied host-export regression fixtures pass; the user's actual export has not been captured or verified. If instability remains, the UI reports fixed changed-area categories without exposing document content.

“Implemented” means code and automated coverage exist where stated; it does not mean validated in real Word. The automated suite is not a substitute for the Windows/macOS/web acceptance matrix.

| PRD requirement | Implementation and evidence | Status / remaining work |
| --- | --- | --- |
| 1 Independent Word writing plugin | Original JS modules, XML manifest and build | Implemented |
| 2 Windows/macOS/web | WordApi 1.3 task-pane APIs, runtime guard | Host matrix unexecuted; tested minimum versions unknown |
| 3 User controls edits | No mutation during generation; explicit acceptance | Unit/integration mocks pass; host check pending |
| 4 Generate/review/edit/apply workflow | Task pane, editable successful result, explicit actions | Implemented; UI/host end-to-end verification pending |
| 5.1 Draft | Instructions required; optional selection context | Automated validation passes |
| 5.1 Rewrite/Summarize | Source required, distinct task prompts | Automated validation passes |
| 5.1 Source is data | JSON source field plus system instruction | Envelope covered; models can still disregard instructions |
| 5.2 Connection CRUD/default | Maximum 32, duplicate endpoints, key clearing and local persistence | Automated tests pass |
| 5.2 Visible retained credentials | Visible text field, local unencrypted storage disclosure | Implemented; actual Word restart test pending |
| 5.3 Temporary override | Starts Default/collapsed; not persisted; removal falls back | Implemented; UI test pending |
| 5.3 Request snapshot | Connection cloned at start, controls locked during generation | Implemented |
| 5.4 Endpoint transport | Direct fetch; optional Bearer; SSE and JSON; redirects denied | Automated tests pass |
| 5.4 Completion checks | stop + DONE required for SSE; stop for JSON; text-only | Malformed/filtered/truncated/empty tested |
| 5.4 URL restrictions | HTTPS or loopback HTTP; no embedded credentials/query/fragment | Automated tests pass |
| 5.5 Streaming preview | Progressive read-only textarea, conditional following, copy partials | Implemented; scroll and screen-reader tests pending |
| 5.5 One request, failure/discard | State machine, AbortController and generation token | Automated transport/lifecycle tests pass |
| 5.6 Insert / Replace | Tracked range, single OOXML replacement; after-selection uses end range and paragraph boundary | Host checks pending, including selection ending on paragraph marks |
| 5.6 Bare cursor behavior | No forced leading empty paragraph at a cursor | Complex block insertion mid-paragraph may affect preceding paragraph formatting; open gap |
| 5.6 Copy / Discard / duplicate apply | Markdown clipboard, token invalidation, clear on success, uncertain apply disabled | Unit coverage for lifecycle; actual clipboard pending |
| 5.7 Native formatting | Bold, italic, strike, ATX headings, simple/nested lists, inline links/code, fenced code, pipe tables → OOXML | Structures tested; actual Word rendering unverified |
| 5.7 Markdown scope | Custom bounded parser, up to 9 list levels | Not full CommonMark: multiline list continuations, loose lists, reference links, setext headings and complex delimiter combinations are not fully handled |
| 5.7 Surrounding prose | Leading/trailing boundary paragraphs where applicable | Formatting isolation, particularly first paragraph at a bare cursor, remains unverified |
| 5.7 Inert content | XML escape all text, no raw HTML/images, allowlisted link schemes | Automated hostile-output tests pass |
| 5.8 Continuous body text | Direct Word selection, paragraph count | Mock test passes; real host pending |
| 5.8 Cell/header/footer text | Uses range.parentBody, no main-body-only assumption | Implemented paths, real hosts pending |
| 5.8 Cell and table-boundary refusal | Cell markers, OOXML structure and whole-cell range comparison | Unit tests pass; whole-cell representation may differ by host |
| 5.8 Equations/embedded objects | OOXML element and text marker validation | Unit tests pass |
| 5.8 Column/noncontinuous/cross-story selections | Word exposes a range, which may normalize unsupported selections | **Open gap:** no reliable cross-platform selection-shape API used; cannot guarantee all such selections are rejected |
| 5.9 Document identity | Host document object, URL, task-pane session token, tracked range | Mock switching test passes; lifecycle behavior needs host verification |
| 5.9 Content freshness | Hashes all non-docProps DOCX package entries; compares before/after prepare and before apply; periodic monitor | Automated fingerprint tests pass, including headers/footers/styles |
| 5.9 Same text/empty cursors | compareLocationWith tracked range; not text search | Automated location tests pass |
| 5.9 Restore original selection | Preflight refusal retains completed suggestion for retry | Implemented; host pending |
| 5.9 Any document edit | Observed differences permanently invalidate | **Gap:** edit-then-undo between checks may evade detection; volatile document properties are excluded |
| 5.9 Atomic freshness | Last range check and a single insertion command | **Platform limitation:** content export/check and insertion are not atomic; edits/coauthoring can race |
| 5.10 One Undo | One insertOoxml mutation, no extra document commands | **Not verified.** One API call is not proof of one native Undo step |
| 5.10 Protection/Track Changes | Does not disable protection or alter tracking; delegates insertion to Word | **Not verified in real Word.** Locked/partial failures require host testing |
| 5.10 No partial mutation | All own validation before mutation; no automatic retry after uncertain result | No cross-platform rollback guarantee; cannot promise host-side all-or-nothing behavior |
| 6 Limits | 8 KiB instructions, 64 KiB source/result, 4096 source paragraphs, 1 MiB provider body, 90s timeout, 32 profiles | Automated boundary tests pass |
| 6 Result paragraphs | Counts rendered paragraphs plus conservative Markdown line cap of 4096 | Stricter than PRD for long fenced code blocks; explicit limitation |
| 6 Errors | Safe fixed messages, no provider bodies/logged data | Automated error sanitization passes |
| 7 Privacy/persistence | Only settings persisted; only source/instructions sent; no proxy | Payload tested; actual host network capture pending |
| 8 UI/accessibility | Labels, keyboard-native controls, focus rings, live status | Implemented; screen-reader and host keyboard audits pending |
| 9 Scope | No agents/history/tools/automatic provider/image generation | Implemented |
| 10 Complete acceptance suite | Core tests plus host protocol delivered | **Not complete:** real Word host matrix is unexecuted |
| 11 Deliverables | Source, dist/manifest, build, instructions, tests, this checklist, limitations and host-results report | Delivered; real Word pass evidence not available |

Additional limitations: full-document integrity export requires a DOCX-compatible document and is capped at 64 MiB compressed/expanded. Browser export, TLS, storage, CORS and private-network restrictions can prevent use; these failures do not silently bypass checks. A changed document URL (including Save As) conservatively requires reopening the assistant. Reopening discards the in-memory suggestion. Full document exports every 3 seconds may be expensive on larger documents; performance remains unbenchmarked in hosts.

Release gate: complete all host scenarios, establish tested minimum versions, close selection/formatting gaps or obtain an explicitly revised product scope, and record actual evidence before declaring parity or recommending production rollout.

Version 0.2.4: excludes docProps and word/webextensions parts and their internal package relationships/content-type overrides. Relationship and content-type record ordering is normalized. External links and all other content parts remain checked. 46 automated tests pass; actual Word host validation remains outstanding.

Version 0.2.5: metadata is recognized by OPC webextension content types as well as alternate metadata directories. Unused content-type defaults and package-root relationship IDs are normalized. Build-specific module URLs, visible runtime version and more precise diagnostics make stale builds identifiable. 49 automated tests pass; live Word remains unverified.

Version 0.2.6: scope structural selection validation to /word/document.xml body in Flat OPC. Cell body equality no longer means a whole-cell selection; boundary containment and marker checks remain, including immediately before apply. 51 automated tests pass; real Word remains unverified.

Version 0.2.7: preparation-time package mismatch allows a read-only preview only after selection identity/text revalidation. The snapshot remains invalid for automatic application. A bounded redacted diagnostic reports changed standard part names/structural paths without document text, attribute values, hashes or arbitrary filenames. This deliberately changes the previous generation-blocking behavior; application remains guarded. Root cause of the user's unknown part remains unresolved pending the diagnostic. 54 tests pass; real Word unverified.

Version 0.2.8: user's diagnostic located attribute churn in footnotes/endnotes. Exclude exactly w14:paraId and w14:textId on Word elements in these two parts, retaining w:id, text, formatting and structure. Report standard changed attribute names in remaining diagnostics (never values). Attribute names were absent from the original report, so this is a targeted hypothesis awaiting Word confirmation. 56 automated tests pass.

Version 0.2.10: adds macOS build and host-setup tooling: trusted localhost certificate creation, Word `wef` sideload, readiness diagnostics, a dual-stack loopback server and a WKWebView raw-deflate/Web Crypto capability guard. 56 automated tests pass; real Word for Mac host validation remains outstanding.

Version 0.2.11: documentation and packaging release. README restructured around user-facing facts (what the add-in does, which models it can connect, how to install it), with technical detail moved to docs/INSTALL.md, docs/MODELS.md, docs/ARCHITECTURE.md and docs/DEVELOPMENT.md. Adds task-pane screenshots and GitHub Actions CI building Windows and macOS artifacts. No application behaviour changed; 56 automated tests pass and real Word host validation remains outstanding.

Version 0.2.12: packaging and CI housekeeping. The macOS bundle identifier and LaunchAgent labels move from `com.aetos.office-assistant` to `it.aetos-ai.office-assistant` (bundle, LaunchAgent plist and label, sync agent label and docs), so an existing 0.2.11 install must be reinstalled to pick up the new login item. The self-hosted GitLab pipeline is paused behind the `AETOS_GITLAB_CI_ENABLED` variable while no runners are available; GitHub Actions is unchanged. No application behaviour changed; 56 automated tests pass.
