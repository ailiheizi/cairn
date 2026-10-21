# Search scope and size acceptance — 2026-10-15

This implements PC-07d within Phase 4 and the admitted UX-C1 client contract.
It repairs the existing host result scope; it adds no endpoint, durable state,
processor, index dimension, runtime loader or recovery meaning.

## Problem and resulting behavior

A search could finish before the initial `content.list`. Its cards then lacked
loaded lengths, and the later listing cleared the query and replaced relevance
order with library order. In the opposite order, the pending query used its
earlier empty projection. A pending URL search could also submit after a newer
explicit search when the listing became ready.

The host now binds search intent and loaded rows to the current workspace and
refresh generation. Listing completion supplies only an identical subject,
entry and canonical content identity's missing length. It preserves the search
order, query and newer destination; background listing completion also guards
newer selection and dirty Details/Notes state. Obsolete search successes and
failures cannot publish results or notices for that intent. Existing draft
guards still precede explicit departures.

Clear search, All content and workspace departures invalidate search intent.
Presentation switches retain it. A newer explicit search supersedes a pending
URL restore without another query. No size is guessed from a filename or another
identity; conflicting or malformed tuples stay unknown.

## Executable evidence

Head `d1750d916f198293bae84fb43ae9d6127e7ee86e`, dirty worktree with unrelated
changes preserved. Headless browser checks used the real owner API on port
4648 and retained fixture-derived content, delaying responses rather than
substituting search hits.

| Case | Result |
| --- | --- |
| Search response before initial listing | 20 hits retain daemon order and query; the matching Notes file changes from unknown to 253 B |
| Listing response before pending search | Latest loaded lengths are used; relevance order remains identical; exactly one query is submitted |
| Older URL query versus newer explicit search | Only the explicit `Cairn` query is submitted |
| Clear search, Sources, Activity and All content | Each destination remains after the held query response is released and its busy indicator settles |
| Pending query followed by Photos presentation | Query stays active; the executed `Cairn-Notes` scope is displayed after response release |
| Same malformed tuple, conflicting sizes and mismatched identities | Focused archive checks retain unknown length |
| Original takeout | `Cairn-Notes.txt`, 253 bytes, SHA-256 `276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73` |

Web build, script syntax, focused archive checks, the shared broad
`go test -tags purego ./...` cohort and `git diff --check` pass. The parent read
the final diff, checked the screenshot and independently compared served assets
with disk. Final JS is `index-De1uyfGb.js`, SHA-256
`b863a7fa8d07ef5f57539e70d93fb1419acf71b152bdbda91bb824b9b30a7db8`;
CSS remains `index-DmxeW6U-.css`. The accepted daemon binary is unchanged.

Ignored records are under `dist/search-size-20261015/`: `final/checks.json`,
`final/delayed-list-search.json`, `final/search-before-list-ordering.json`,
`final/search-intent-navigation.json`, `final/original-takeout.json`,
`root-final-review.json`, `root-go-test-receipt.json` and its log. Browser command
output is retained in `final/browser-qa.log`. No daemon restart, model install or owner
content/config write occurred; owned headless browsers were closed.

## Limits and next work

This closes the bounded PC-07d repair, not PC-07 or a core/release phase.
The corpus is fixture-derived and does not qualify recall quality or storage
benefits. Workspace/refresh and failure guards were reviewed; this cohort did
not inject every provider failure or repeat the full client matrix. Tags,
Notes and Duplicates use the shared guarded departure helper, but their held
response routes were not separately exercised here. Existing playback and
recovery acceptance retain their earlier stated scope.

The later [local-delay acceptance](semantic-latency-profiling-20261015.md)
closes the bounded PC-07c optimization. The later
[metadata-readability acceptance](search-evidence-readability-acceptance-20261015.md)
closes PC-07e while preserving matched source and provenance. Those separate
results do not expand this scope-and-size repair into retrieval qualification.

## SavedView recall scope successor

PC-04b extends the existing UX-R1/UX-C1 client flow within the execution plan's
admitted SavedView convenience track. A held real `view.evaluate` response
reproduced a visible failure: after the operator opened Sources, the old
evaluation replaced that page with the three `Tone` search results.

`useExport.ts` now starts the same host search intent used by ordinary search
and checks it after `view.get`, after evaluation and on failure. Its completion
releases busy only when a newer query does not own that state. It introduces
no query authority, operation, durable shape or recovery meaning. Existing
dirty changes to bounded recall counts were preserved.

The existing `scripts/e2e/search.mjs` now holds real responses without
substituting content and verifies these outcomes on the current preview:

| User action | Executed result |
| --- | --- |
| Open the existing saved search normally | Same three ordered subject, entry and content identities |
| Open Sources while evaluation is held, then release it | Sources remains visible, with no recalled-result caption |
| Choose a newer recent query while recall is held | Its input and loading state survive the old response; all twenty rendered names match the real newer response order |

The checks wait for the actual requests to finish; the newer-query case also
waits two rendering frames before inspecting state. The Web build, script
syntax, final focused browser run and `git diff --check` pass. Parent review
compares the change with a saved pre-slice dirty source and checks the actual
served assets against disk. Accepted JS for that cohort is `index-D4O2_6UE.js`, SHA-256
`efc9df4a54ee40bea47ca689eee7942467ea29577838d351e58bfe9f457876d9`;
CSS remains `index-DRBQWM39.css`, SHA-256
`d847dd232d3cc9aa6689423e9b51bb19f044b23f819c14db5860f7954b1a1fe0`.
The existing daemon remained PID 66042 without restart or index rebuild.

The single broad Go attempt printed 27 successful package lines with no FAIL
markers. Its zsh wrapper then failed while assigning the read-only `status`
variable, so the test process exit was not captured. Its log is retained as
successful package output, not an exact-exit passing cohort. The earlier
captured-exit passing backend cohort remains separate; no backend source was
changed by this client slice.

Ignored evidence is under `dist/product-next-gap-20261015/recall/`:
`repro.json`, `useExport.pre-slice.ts`, `saved-recall-intent.json`,
`attempt5-receipt.json`, `browser-regression-attempt5.log`, `root-review.json`
and `go-cohort/`. Earlier harness-selector failures remain in their logs.
These are local checks over retained fixture-derived content. Provider errors,
workspace/refresh permutations, audio playback and exact takeout were not
repeated here; their earlier bounded evidence is unchanged. Full SavedView,
media, Phase 4/5/6 and release qualification remain open.

## SavedView to Music continuation

PC-04c closes a reproduced gap between UX-R1 daily retrieval and UX-M1 playback
under the existing UX-C1 size-projection rule. The retained `Tone` view returned
Beta, Gamma and Alpha WAV identities without logical lengths. The loaded
library already held each identical subject/entry/content tuple at 48,044
bytes, but recalled Music rows showed an unknown length and disabled Play.

Recall now resolves missing lengths through the existing
`resolveArchiveSelectionSizes` helper using `currentLibraryItems` for the active
workspace and refresh generation. That same current projection supplies index
status. The evaluation's membership, order, query and source segments remain
unchanged. Conflicting, malformed, unmatched or unavailable tuples remain
unknown; the audio byte ceiling and complete verification are unchanged.

The existing `scripts/e2e/search.mjs` adds a reusable ordinary-UI check:
open the existing saved view, switch to Music, compare all three names in
evaluation order, confirm all three known sizes and Play actions, and explicitly
play one selected original. Full actual listing/evaluation envelopes and
separate original-response and verified-player Blob files are retained. Parent
rehashing confirms both files are 48,044 bytes with SHA-256
`5c34ee159cab7b251757ec3fc1d0ccde26bcf9a4c4e821d7c3e2e1f3c99234b6`,
matching the selected evaluation identity and loaded length. The native audio
element reports a Blob source, readyState 4 and a three-second duration.

The Web build, unchanged focused archive helper check, script syntax and final
browser regression pass. A separate ordinary
`GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` run now captures exit 0
directly through Python subprocess; it does not relabel the earlier wrapper
failure. Parent source review and served-asset equality checks pass. Accepted
JS is `index-D6yWQUTY.js`, SHA-256
`5e32c2514b436c6145b70265da4669a73ef6e9f7620c0d70214aed2aa2f5f399`;
CSS remains `index-DRBQWM39.css` with the digest recorded above. Daemon PID
66042 remained running without a restart or index rebuild.

Ignored evidence is under `dist/saved-recall-music-20261015/`: the pre-slice
dirty source copies, `baseline.json`, initial `after.json`, `root-review.json`,
`go-cohort/`, and `final/` containing raw byte files, actual response envelopes,
`playback.json` and the command/exit/source-hash record `run.json`. The initial
harness assertion incorrectly expected projected length in raw evaluation;
its failure screenshot is preserved and the final check uses the actual exact
listing tuple. No fixture data was rewritten to satisfy it.

This is local headless-browser evidence for the stated WAV sample, not audible
speaker verification, all audio formats, large-file playback, a streaming
service or persistent playlist acceptance. No backend operation, catalog
schema, processor, index dimension or AI integration was added. Browser
contexts were closed after playback. Export/ZIP and the earlier stale-recall
matrix were not repeated; their prior stated evidence remains separate.
