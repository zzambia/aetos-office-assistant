# Real Word host verification report

Product: AETOS Office Assistant 0.1.0. Report date: 19 October 2026.

## Actual results

| Environment | Result |
| --- | --- |
| Node.js v26.8.1, Windows | 35 automated tests pass; includes transport, limits, cancellation, OOXML generation, DOCX fingerprints and mocked Word adapter |
| Static distribution build | Successful, dependency-free; dist/manifest.xml produced |
| Real Word on Windows | **NOT RUN**. Word executable is present, but this add-in has not been sideloaded into a trusted HTTPS host in this session |
| Real Word on macOS | **NOT RUN**. No macOS Word host available in this execution environment |
| Word for the web | **NOT RUN**. No authenticated test document/add-in session established |
| One native Undo / protection / Track Changes | **NOT VERIFIED** in any real Word host |

No mocked result above is evidence of actual Word mutation, Undo behavior, protection or tracked changes. Do not record “pass” until the specific host has been exercised.

## Reproducible acceptance protocol

Use a disposable DOCX with three plain paragraphs (including duplicate text), a 2×2 table, a header, a footer, an equation, an embedded image, a locked content control and a copy protected for editing. Start the supplied synthetic endpoint and configure its `sse` and `json` connections. Record Word version/build, operating system, browser/webview version, manifest origin and test date.

For **each of Windows, macOS and web**, record pass/fail and observed evidence for every scenario:

| ID | Procedure | Required result | Win | Mac | Web |
| --- | --- | --- | --- | --- | --- |
| H01 | Draft at empty cursor; rewrite and summarize selected text | Successful full generate → review → edit → apply workflow | Not run | Not run | Not run |
| H02 | Generate using SSE, then JSON connection | Progressive SSE output, successful JSON output, no document edit during generation | Not run | Not run | Not run |
| H03 | Use truncated, filtered, malformed and timeout models | Partial copy allowed; insertion and replacement disabled | Not run | Not run | Not run |
| H04 | Discard while streaming, then generate again | Old late output cannot overwrite new suggestion | Not run | Not run | Not run |
| H05 | Scroll up during streaming and later return to bottom | Reading position held; following resumes at bottom | Not run | Not run | Not run |
| H06 | Edit the completed preview then apply | Edited Markdown is accepted exactly once | Not run | Not run | Not run |
| H07 | Insert after selection at paragraph middle/end and across paragraphs | Source preserved; suggestion starts new paragraph; no unrelated formatting changed | Not run | Not run | Not run |
| H08 | Replace mid-paragraph; insert/replace at empty cursor | Correct location; no unnecessary leading paragraph at cursor; prose isolated | Not run | Not run | Not run |
| H09 | Accept fixture with all formatting types and nested lists | Native formatting, editable table/list structures and links | Not run | Not run | Not run |
| H10 | Select ordinary text inside a cell, header and footer | Supported in each story without redirecting to body | Not run | Not run | Not run |
| H11 | Select whole/multiple cells, boundary, column, equation, object | Clear refusal before mutation; column case currently an open gap | Not run | Not run | Not run |
| H12 | Move selection to identical text elsewhere or a different empty cursor | Acceptance refused; no edit to new location | Not run | Not run | Not run |
| H13 | Restore unchanged original selection | Completed suggestion can still be accepted | Not run | Not run | Not run |
| H14 | Edit body, header/footer, styles or tracked changes after generation | Suggestion invalidated; generate again required | Not run | Not run | Not run |
| H15 | Switch/open/Save As document, close/reopen task pane | Old suggestion cannot edit another document | Not run | Not run | Not run |
| H16 | Apply each action and press native Undo once | Entire acceptance reverted in one step; preceding user edit retained | Not run | Not run | Not run |
| H17 | Apply with Track Changes on, then off | Honors current setting; no setting changes or unrelated revisions | Not run | Not run | Not run |
| H18 | Apply in protected document/locked control; select mixed locked/unlocked text | Word refuses; no partial edit, no retry duplication | Not run | Not run | Not run |
| H19 | Create/edit/delete/default profiles; restart Word | Settings and visible keys persist; overrides and content do not | Not run | Not run | Not run |
| H20 | Inspect provider-bound traffic using synthetic source | Only task instructions, source, model and optional authorization; no other document data | Not run | Not run | Not run |
| H21 | Keyboard, screen reader, narrow task pane | All controls operable, labels/status announced, visible focus | Not run | Not run | Not run |
| H22 | Coauthor edit during acceptance; edit/undo between monitor checks | Record race outcome; atomic guarantee is not available | Not run | Not run | Not run |

Keep test captures local and use synthetic documents/keys. Do not attach real API keys, private provider responses, document text or full local DOCX exports to diagnostics. Record actual failures in PARITY.md and block release rather than converting them into assumed accepted behavior.
