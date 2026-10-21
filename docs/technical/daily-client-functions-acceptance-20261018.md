# Daily client functions — 2026-10-18

## Scope and decision

This batch follows the operator's functionality-first instruction: implement
independent useful operations together, review the combined diff, then run one
proportional integrated check. It refines the admitted RW-PERSONAL-UX-1
Photos/Music clients and the existing shared Notes surface. It does not admit
another application, backend operation, durable format or release profile.

| Existing surface | Implemented operation | Authority and limits |
| --- | --- | --- |
| Photos viewer | Adjacent thumbnail navigation, in a moving window of at most five items | Uses the active matches or selected-only sequence and the existing visible-only `PhotoThumbnail` pipeline. Read, pixel, transfer, decode and cache limits are unchanged; refused previews retain named navigation. |
| Shared Music player | Back/forward 15 seconds, playback speed, volume and mute in an explicit Playback options disclosure | Controls the current verified audio Blob only. Seeking is clamped to finite duration; loading/startup and absent-source controls are disabled. Preferences are transient and source-matched native events keep the controls consistent. |
| Shared Notes body | Literal case-insensitive find, next/previous, visible highlights and keyboard navigation | Searches only the loaded source body, expands long Notes for navigation, and exposes the first 500 matches with an explicit limit. Source offsets survive lowercase expansion, validated links retain their complete targets, and Copy still receives the full unchanged body. |

The reviewed list-order correction in `useExport.ts` is included in the
candidate: obsolete SavedView/export-history reads cannot replace a newer
read's rows, error or loading state. This is a client read-order guard, not a
concurrent-write or backend compare-and-swap guarantee.

The source review used per-file snapshots of the existing dirty worktree;
unrelated work was preserved. The batch adds no dependency or test framework.

## Candidate evidence

Evidence is retained under `dist/product-function-batch-20261017/`.
`source-final.json` records the reviewed source hashes and eight feature-file
deltas. `candidate-build.json` records numeric exit code 0 for TypeScript,
the isolated Vite build, i18n, `go test -tags cairn_zvec_dynamic ./...`, and
`git diff --check`. The interrupted turn completed those commands; resumption
verified the unchanged source hashes instead of repeating them.

The isolated retained fixture serves the candidate at port 4652. Its readiness
receipt records the actual process, effective fixture-owned storage paths,
typed status and content listing, and matching HTTP hashes for all nine built
files. Fixture semantic search is unavailable; this batch neither supplies nor
qualifies the default semantic profile. The owner preview remains a separate
instance and is not a target for test mutations.

## Focused runtime acceptance

One integrated headless-browser run exited 0. The root reviewed its source,
numeric exit, receipt and screenshots. The temporary harness needed selector
and fixture-expectation corrections before execution; no product source was
changed during the run. Its executed script hash is retained separately from
the later evidence-summary correction (four CJK matches, not three).

- Photos displayed five neighboring thumbnail buttons over seven loaded
  matches, navigated to a neighbor, narrowed to the explicitly selected single
  photo and returned focus to its card. The 390-pixel viewport had no horizontal
  page overflow. The tested thumbnail path was the existing small-image path.
- An actual 48,044-byte, three-second WAV played and paused. Forward/back
  controls clamped to 3/0 seconds; the native element reported rate 1.25,
  volume 0.37 and both mute states. Navigation retained its paused Blob source,
  Stop released it, and these controls made no additional original request:
  the entire listening flow issued one original GET.
- One new fixture NOTE at revision 1 supplied a 2,157-code-point loaded body.
  Four CJK matches, next/previous navigation, no-match/clear, ASCII before `İ`,
  lowercase expansion and literal `.*` highlighting passed. The full rendered
  body and safe HTTPS target remained unchanged. A controlled `writeText`
  capture received the exact body; the operator's system clipboard was not
  touched and OS clipboard permission is not established by this check.

The receipt and three screenshots are in `qa/evidence/`. The fixture NOTE was
created once; fixture contents and the mutation receipt are retained. The
SavedView delayed-list race was **NOT RUN** in this integrated feature check;
that correction has source/build review only here. Exhaustive playback rates,
replacement/workspace races, the 500-match limit, all Notes host contexts and
large-image/fallback branches were not separately exercised in this batch.

## Local preview delivery

The same candidate is served at `http://127.0.0.1:4648/`. Non-index files were
copied first, previous hashed assets were retained, and the index was replaced
atomically. `preview-promotion.json` records matching HTTP hashes for all nine
built files and index SHA-256
`739a110ead3872af98dda8e2a5c13b0d42b79de3ffed0e323b00be3e88d6d745`.
The owner daemon, binary and configuration were unchanged, and its twenty
listed content records were identical before and after. This is a Web-only
update over the retained daemon, not a native rebuild or a rollout of every
unrelated backend change in the worktree.

This record closes no core phase, full Photos/Music baseline, persistent
album/playlist contract or release gate.

## Structured search controls continuation

The next four-file batch exposes the existing size, modification-time and
protection query operators in the shared visual filter editor. Size controls
offer inclusive lower/upper/between/exact values with explicit binary units.
Modification-date controls disclose their exclusive UTC-midnight boundary;
they do not infer capture dates. Protection labels describe recorded modes,
including the existing stored-original prefix match. All recognized conditions
can be explicitly removed by their current parser index and raw token,
including supported negative conditions. Invalid/stale edits and inverted
ranges are refused rather than widening the query silently.

These controls only edit the existing visible search text. Search still
requires the ordinary explicit action; no second query authority, durable
record, endpoint, processor or index was introduced. Four explicit accessible
field names were added after the browser driver exposed ambiguous labels.

Evidence is in `dist/product-search-controls-20261018/`. Parent review covers
the complete helper/UI/CSS/message deltas and the accessibility correction.
The final TypeScript, Vite, i18n and diff checks exited 0; the earlier tagged Go
cohort exited 0 before dictionary/accessibility-only corrections and was not
repeated. The initial wrong-working-directory TypeScript command and duplicate
translation failures are retained with their corrected receipts.

Runtime evidence is **a partial integrated flow plus a retained-view resume**,
not one clean full-script pass. Failed driver attempts remain in `evidence/`:
they include an incorrect helper predicate index, ambiguous labels, a nested
summary locator and a page-level attachment-response waiter. The main flow
reached actual filter composition, explicit typed search, save, exact SavedView
readback, recall and matching hits. The final read/recall/download continuation
exited 0 on the same candidate, fixture and revision-1 SavedView; it did not
save another record. The 390-pixel screenshot is retained alongside that proof.

The actual record stores the parsed lexical query separately from these five
supported conditions: size 0–1,024 bytes, modification time after UTC midnight
2000-01-01 and before UTC midnight 2100-01-01, and recorded `STORE_EXACT` mode.
The parent independently compared the current parser output with the actual
SavedView query and all five fields (`root-query-field-proof.json`). A browser
download of `Source-Scope-Notes.txt` completed with no download failure; its
253 bytes match SHA-256
`276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73`
from the recalled hit. The attachment's page-level HTTP status was
**NOT_OBSERVED**; actual downloaded bytes, not an invented response status,
provide the output evidence.

The candidate is now served on port 4648. All nine HTTP asset hashes match the
build, with index SHA-256
`82b78802e1192c251968d72db757220f9b8091ede5b21f752802bf7ee8d3f583`.
The owner daemon/configuration and twenty content rows were unchanged.
The isolated fixture and its new SavedView are retained as evidence; only its
temporary daemon is stopped after acceptance. Fixture semantic unavailability
does not establish default semantic qualification. Full negative-condition UI,
every size/unit/date boundary, unknown-save reconciliation and all browsers
were not separately exercised. This continuation closes no core or release gate.


## Function-first organization and inspection cohort

The operator requested useful functionality in batches, with local Luna doing
implementation and one combined acceptance after review. This cohort improves
the admitted shared discovery/organization loop. It adds no backend operation,
durable record, processor, index, plugin loader or release admission.

- Notes can narrow the returned Note/description rows by existing user TAGs,
  combined with source and loaded-text filters. Counts are distinct subjects
  among loaded Notes rows. Filtering uses a memoized subject-to-tag projection,
  never hydrates a description body, and never writes a second Note. Missing
  selected tags remain visible with zero matches. Unreadable, degraded or
  malformed annotation lists cannot become an apparently empty tag vocabulary.
- Details can inspect the previous/next regular file in the host's loaded
  Library result order. Exact subject/entry/content tuples must be unambiguous;
  an outside-scope or ambiguous selection has no navigation controls. It does
  not wrap, prefetch, run a query, or imply the order of a local domain filter.
  The existing subject-bound reads, draft-leave guard and browse-return token
  remain authoritative.
- Existing batch TAG add/remove, favorites and queued multi-tag operations show
  started writes and fully checked subjects/item-tag checks. Stop waits for the
  current operation and its readback, retains committed changes and pending
  drafts/tags, and starts no remaining write. Unknown/degraded outcomes retain
  their existing reconciliation behavior. Progress survives selection clearing
  while active and an empty filtered result; workspace changes invalidate it.
  Clearing selection after completion dismisses the transient receipt.

Root reviewed the slice diffs and corrected translation reuse, cached-response
TypeScript typing, tag lookup complexity, narrow layout wrapping, workspace
progress invalidation and empty-result retention. The first combined TypeScript
check failed on the cached annotation response union; the existing Result type
resolved it. The focused successor passed TypeScript, Vite and diff checks;
i18n and the broad tagged Go suite passed in the combined cohort. Receipts,
source hashes and retained failed browser attempts are under
`dist/product-function-batch-20261018/`. The root-supplied Vite output directory
had one extra parent component; the canonical artifact is a byte-identical copy
of those nine built files, with no rebuild or native restart.

The third retained-fixture integrated attempt exited **0** in 17.563 seconds.
The first two attempts failed in pre-write locators, were retained, and made
no tag writes. The successful attempt used the same persisted intent, three
subject identities and tag. A genuine upstream TAG response was held after the
daemon committed it; Stop was clicked, the response released, and live readback
confirmed exactly one tagged subject and two untouched subjects. The existing
Note record/body remained unchanged. Its new tag narrowed Notes to one matching
subject, and Clear restored the nine returned rows. The 15-file host order
supported next/previous Details inspection; dismissing the draft-leave dialog
retained the exact unsaved Note draft, and accepting it allowed navigation.

The browser download completed without failure and matched its exact hit at
426,519 bytes and SHA-256
`b631c60a9eab2ffd6869092d17dae01d9f318114de7ee99c0df50ec3472ec1f1`.
Its attachment HTTP status was NOT_OBSERVED. The browser reported no page or
console errors. The 390 px selection layout passed the horizontal-overflow
check; root viewed that screenshot and the desktop stopping state. Ordinary
pointer selection after row hover also succeeded in the retained second attempt;
its subsequent failure was the driver's stale Select/Deselect accessible-name
locator, not an unsuccessful selection.

The same candidate is served on port 4648: all nine HTTP asset hashes match,
index SHA-256
`18f49794e786cc0e72beb0ae73fc9fae4fabae9e6a6c6937a9673c159bfbcc0e`.
Root confirmed the same native PID 71879, binary/configuration hashes and twenty
owner content rows. Evidence is in `qa/evidence/attempt-03/result.json`,
`driver-execution.json`, `source-freeze.json` and `preview-promotion.json` under
the cohort directory. Only the isolated daemon is stopped after acceptance;
its data and the one actual TAG are retained.

Single-tag removal/favorite stopping, multiple pending tags per subject,
workspace-change/empty-filter progress retention, failed/degraded/unknown
writes and invalid annotation responses were source-reviewed, not separately
browser-exercised here. Source/text/tag combinations and Notes/Details mobile
layouts were not a separate matrix. This is a bounded client implementation;
no complete Photos/Music journey, semantic default qualification, core phase
or release qualification is awarded by this cohort.

## Notes-to-Library associated-file takeout

The later function-first slice connects the existing Notes list to host-owned
file selection and takeout. Active track: RW-PERSONAL-UX-1 and the bounded
Notes convenience view. Requirement: retain one Notes surface and one host
result/selection authority. Exit: filter Notes, select two distinct associated
files, return to the same committed query, and take out both exact originals.

Notes compares its own returned listing with the captured host result scope.
Only an unambiguous regular-file subject/entry/canonical-content/length tuple
can be selected. Repeated Note records share one file selection. Visible bulk
add/remove retains hidden selections and discloses their possible inclusion
in later Library actions. Secondary actions expand on demand. A workspace,
refresh or ordered identity change disables the old handoff; an ambiguous or
unknown individual row does not disable other safely matched files.

The host keeps the original search/path/tag/content source semantics while
Notes is open. Returning uses the ordinary Library presentation with that
same source, query and filters, without a new search or cleared selection.
Notes records remain read-only here; editing and durable batch operations
remain in their existing host surfaces. No endpoint, schema, processor,
retained format, query authority or runtime extension is added.

Root reviewed five source diffs and the scope/return corrections. TypeScript,
Vite, i18n and final diff checks pass. Native Go source remains identical to
the same-day broad tagged-Go cohort recorded in the
[mixed-search acceptance](mixed-search-ranking-acceptance-20261018.md);
that suite was not rerun for unchanged Go code. Source freeze and build assets
are retained under `dist/product-notes-takeout-20261018/`.

The retained 15-file private fixture has five live user Note records attached
to two files. A real browser `https` query returns those two exact identities;
its `DEGRADED` outcome remains visible because that private profile's semantic
bundle is unavailable. This is lexical-fallback client evidence, separate from
the real BGE ranking corpus and READY owner preview.

Browser attempt 02 passes after the preserved first attempt's navigation
locator failure. Five filtered rows yield exactly two shared file selections.
The handoff retains the query, both ordered result labels and selected exact
tuples; `search.query` count remains one. The existing frozen-export ZIP path
downloads without a Playwright failure and contains exactly:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `01-暖光客厅.jpg` | 75,670 | `e87984f72220cae80c154c6fe56f1c72ecb31479fb4f98d7d4b8ea385a3639a4` |
| `Cairn-Notes.txt` | 253 | `276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73` |

The 76,165-byte ZIP passes member integrity checks. Attachment HTTP status is
NOT_OBSERVED; the browser Download API and saved bytes supply the evidence.
There are no page/console errors, and measured document width remains 390 px
at a 390 px viewport. Root viewed both screenshots, but they are not visual
polish acceptance: the captured mobile frame repeats header imagery and the
desktop frame includes faded content. This slice awards functional evidence;
settled visual appearance has not been independently accepted.

The initial i18n command used the wrong working directory and failed to locate
its script; the corrected absolute-path check passes without rebuilding.
That failure, the first browser failure and all corrections remain retained.
The successful browser/ZIP evidence is in `qa/evidence/attempt-02/result.json`
and `driver-execution.json`. The owned private daemon exits 0 and releases
port 4652 and its socket. No Note/TAG write or new seed was used; ordinary
`export.plan` is the sole requested durable workflow operation.

The exact nine-file candidate is now served on port 4648, with index SHA-256
`ef2d52a79d54247f8cf1cda2bc5947cbbdee4aff7839df28bd0aa377166052b9`.
Every served candidate asset matches its full hash/length. Native PID 14580,
binary/config hashes and twenty owner file identities remain unchanged from
the preceding native rollout; lexical and semantic remain READY. The old index
is backed up and pre-existing assets are retained. See
`promotion/promotion-result.json` under the cohort directory.

Visible bulk add/remove, hidden selections, unavailable/ambiguous identities,
workspace/refresh changes, path/tag scope returns and unsaved draft branches
were source-reviewed, not separately exercised in this browser journey.
Existing tag operations were not rerun. Full Notes/Photos/Music, core phases,
retrieval quality and release qualification remain open.

## Consolidated function expansion

The next cohort implements eight useful operations together, following the
operator's request to prioritize functionality and consolidate validation:

| Surface | Added operation |
| --- | --- |
| Photos and image inspection | Direct zoom, pan, fit, actual size and transient quarter-turn rotation in the existing photo viewer; the Details viewer shares the same geometry. |
| Music | Select displayed queue occurrences, move inactive selections after the current occurrence, or remove them together; repeated tracks remain distinct and the queue stays temporary. |
| Notes | Optionally group loaded matching rows by their associated file, expand groups on demand and reuse ordinary file selection and Details. |
| Overview | Select or clear eligible displayed items in one existing block while retaining selections elsewhere. |
| Restore | Choose another retained restore point by its recorded time/source and preview that exact choice before confirmation. |
| Original takeout | Show received bytes separately from verified files/bytes, retaining the existing frozen-selection, identity and browser-memory limits. |
| Generated Notes review | Edit an explicitly generated candidate before accepting its immutable successor through the existing description operation and shared unsaved-draft guard. |
| Discovery | Refuse a query vector explicitly reported as tokenizer-truncated, explain the shorter-query action and retain available ordinary-search results and the healthy generation. |

These changes reuse existing operations and admitted first-party clients. They
add no endpoint, durable domain record, processor, index dimension, runtime
plugin loader or AI integration. Generation still requires a separately
configured provider and explicit invocation; it is never an ingest dependency.

The 41-source freeze and receipts are retained under
`dist/product-loop-completion-20261018/`. TypeScript, isolated Vite build, i18n
and diff checks pass. Focused processor/search/controlplane checks, one tagged
`go test -tags cairn_zvec_dynamic ./...`, and the native candidate build also
exit 0. Two initial Web compiler errors were corrected and their failed logs
retained. Only Web files changed during that native run; the native source
hashes remain identical, so the Go matrix was not repeated for those fixes.

The combined browser work also exposed a real modal-layer defect: the open
sticky Music player (`z-index: 30`) intercepted the Restore preview button
behind it (`20`). The shared drawer backdrop now uses `40`; this changes no
playback or recovery state. Final source freeze v4 changes only that stylesheet
from v3. Its focused continuation and preview-delivery evidence follow below.

### Bounded runtime evidence

This acceptance is a partial integrated flow plus a focused continuation, not
one clean full-script pass. The earlier failures remain in `qa/evidence/`:
they include default-closed/duplicate controls, an assertion that exceeded the
image's actual 6-pixel horizontal pan room, and the real player/drawer overlap.
A separate Photos-only diagnostic confirms pointer capture and the correctly
clamped 6/18-pixel motion; it exits 0 although its outer generic runner reports
the diagnostic's differently named result file as missing. No product pan
change was necessary.

The integrated attempt 08 reaches these operations before the Restore click
is intercepted:

- Notes grouping shows the retained 4/1 user-note rows, shares exactly two
  associated file selections with the Library, and fits a 390-pixel viewport.
- Both Notes and Overview takeout ZIPs contain exactly the selected originals;
  each member's length and full SHA-256 match the authorized fixture identity.
  Received and verified terminal counters both show 75,923 bytes and two files.
  Download HTTP status is NOT_OBSERVED; saved bytes and Download.failure supply
  the output evidence.
- Overview selects its six displayed photos out of seven and clears those
  selections without losing the separately selected Notes file.
- Details and embedded Photos controls retain the loaded Blob through
  rotation, fit, zoom and clamped pointer pan. Moving to the next selected photo
  resets its transform. The Photos 390-pixel frame has no page overflow.
- The A/B/A listening queue treats duplicate tracks as distinct occurrences.
  Batch movement/removal skips the current B occurrence and retains its paused
  Blob and playhead.

On final v4, focused attempt 10 exits 0 in 10.213 seconds. Hit-testing now lands
on the enabled Restore preview button above the still-open player. The request
uses the chosen non-default snapshot and destination; its SUCCEEDED preview
reports six files and 592,163 planned bytes. No restore apply occurs. The paused
audio Blob and playhead remain identical through planning and drawer closure,
and the queue stays open. The 390-pixel viewport remains 390 pixels wide.
Page/console errors and forbidden mutations are empty. The private daemon
exits 0 and releases its port/socket.

Root reviewed source deltas, receipts and screenshots. The final build differs
from the preceding client candidate only in the drawer layering stylesheet
and its compiled CSS/index references; JavaScript content is identical. These
checks establish the stated operations, not complete visual polish or every
race/fallback/browser branch. Generated Notes edit/accept with a real configured
provider is NOT RUN. Browser byte-progress pacing/cancellation and the full
restore apply/recovery matrix were not rerun here. Existing helper checks pass
once for bounded archive identity, extraction, failure and cancellation.

### Final local preview

All nine v4 assets are served on port 4648 with matching HTTP 200 hashes and
index SHA-256
`aaf99d28507defab8bcbb96939506ab29619885bb5e19179a0a14375471a7891`.
The old Web tree is backed up and old hashed assets remain available. The Web
promotion preserves the owner daemon/configuration, both READY index states
and all twenty listed owner file identities; see
`promotion/promotion-result-v4.json`. Native delivery and real semantic-query
continuation are recorded separately below. No core or release gate is closed.

### Native successor and real local semantic continuation

The first native candidate's real-model continuation exposed a factory-layer
failure that the controlled indexer/provider tests did not cover: a typed
query-truncation refusal closed the cached healthy ONNX worker. The following
short query was unavailable although the retained catalog index projection
still reported READY. That candidate was rolled back to the prior native
binary while keeping Web v4; a real short query verified the stable backend
before work continued. Failed receipts and the rollback remain retained.

The narrow successor changes only `onnx_provider_factory.go` and its existing
lifecycle test file. A query-only tokenizer refusal retains its session after
successful post-call admission/fence checks and a live context. The tests
verify the same worker answers the next short query without close/restart,
while changed assets/fences still invalidate it. The existing cancellation
suite, one tagged broad Go run, diff check and new native build exit 0. Final
source freeze v5 records 43 hashes; all 41 Web-cohort source hashes remain
unchanged. No Web rebuild or client matrix repetition was necessary.

The first verification runner failed before sending HTTP because it parsed an
unrelated process display as shell syntax. Another run used undeclared short
dimension names and was rejected before invoking BGE. A subsequent explicit
fusion request proved component-level truncation but did not exercise the
ordinary default-broker envelope/message policy. These retained failures are
not acceptance credit.

The final read-only default-broker sequence passes on the real configured
local ONNX/BGE + zvec profile. Its three requests contain only workspace and
query fields, with no explicit fusion override:

| Request | Observed result |
| --- | --- |
| `客厅` | SUCCEEDED; lexical returns two hits and semantic returns twenty. |
| `archive ` repeated 513 times | DEGRADED; semantic reports `QUERY_INPUT_TRUNCATED`, lexical succeeds with zero matches, and the envelope explains shortening the query while keeping keyword/filter results. |
| `客厅` again | SUCCEEDED; both components retain their original generations and hit counts. |

The repetitions are the tested input, not an inferred tokenizer threshold.
Refusal happens after actual worker coverage evidence, before vector querying;
it is not pre-inference token checking. The factory lifecycle test separately
proves no worker restart. The real sequence retains the same daemon PID 51942,
configuration, Web index, both READY projections and all twenty owner content
identities. No model install, index rebuild, owner annotation change or restore
apply occurs. The verifier exits 0; exact raw requests/responses and receipt
are in `promotion/native-request-local-refusal-acceptance/`.

Final native SHA-256 is
`af6e2c9764db7e09af2fc128165ab6c1d531f79b31748398bad8e36927f8a3fa`,
running in managed exec session 59069 with the existing persisted configuration
and storage. Web v4 remains the delivered nine-asset build above. The original
native backup is retained. This completes only the stated local request-level
fallback/recovery behavior; ranking quality, full core phases and release
qualification remain open.

## Implementation-first operations continuation

The operator requested useful feature batches before consolidated testing.
The 21-source continuation combines the previous Notes-to-Library search,
returned-source inspection and truthful restore preview changes with:

- Photos exact multi-tag AND filtering and selected-only browsing, composed
  with the existing format/name controls, shared selection, viewer and takeout.
- Music exact multi-tag and selected-only filtering across the existing loaded
  track/artist/album presentations, plus selected/displayed/group play-next
  insertion through the one temporary queue. One whole-batch eligibility and
  capacity check precedes one commit; current media is not replaced.
- Workspace-only Notes filter/sort/group context across navigation. Workspace
  identity and epoch reject callbacks from a previous workspace visit; fetched
  results and description bodies are not retained by this preference slot.

Root reviewed the changes and the unavailable-tag, active-filter removal,
identity mapping and browse-position guards. TypeScript, i18n, isolated Vite
build and diff checks exit zero in
`dist/product-operations-expansion-20261018/checks/attempt-02/`. The first
attempt stopped at duplicate translation keys; the successor reuses the
existing translations. All 21 selected sources and the complete 167-file Web
source map remain unchanged during the final build.

The unchanged backend sources retain the preceding focused description tests,
broad tagged Go test run and native build in
`dist/product-find-and-review-20261018/checks/backend/`. These tests include
the existing image-egress boundary's non-image omission and bound decodable
image admission; they do not establish real external-provider generation.

This continuation is source-reviewed and built. Its browser interaction,
queued playback and cross-navigation runtime journeys are **NOT RUN**. Local
delivery receipts are recorded separately under
`dist/product-operations-expansion-20261018/promotion/`. Build and delivery
checks do not qualify complete Photos/Music, semantic quality or a core/release
gate; the active product goal remains open.

The combined nine-asset Web candidate is now served at local port 4648 with
index SHA-256 `f4bc73e27fc0ebb21f55bbca36e097ed8bc21f8c384be7d57211211846dc8d50`.
Root reviewed and executed the reversible asset-first/index-last installer;
all nine HTTP hashes match. Native SHA-256
`e0be00ad01b172c845c9a35c4f88797647a09c557a73c4beec066358c7aa036d`
runs as PID 60269 in managed exec session 90828. The current binary and old
Web tree are backed up. Read-only delivery checks retain the persisted
configuration, both READY index projections and all twenty owner content
identity tuples. See `promotion/native-runtime.json` and
`promotion/web-delivery-result.json`. No browser interaction, actual model
generation, index rebuild, owner annotation mutation or restore apply was
performed for this continuation.

## Exact user tags in existing SavedViews — 2026-10-18

The bounded content-store §7.2 / ADR-057 successor stores each complete user
tag as a JSON string in existing `fields[]`; repeated tags are exact AND
conditions. Tag-only retrieval does not inherit a prior keyword, and keyword,
supported structured filters and tags can compose. Authorization precedes the
live-tag intersection and result ceiling; evaluation pins its lexical
generation. Existing SavedView save, recall/update and view-backed frozen
export remain the authority. Raw tag values and malformed stored conditions
remain visible, and old records may omit optional `fields` or `scope`.

Freeze-v2 covers 15 sources and two contracts; both remained unchanged. Backend
attempt 02 passes focused SavedView/page tests, broad tagged Go tests, diff
check and native build. It verifies a matching tag beyond the first 1,000
candidates and that a frozen export remains unchanged after live TAG mutation.
The first JSX syntax failure and unsigned fixture failure remain retained;
the final source closes the JSX and attempt 02 uses signed temporary metadata
without weakening production verification. Web
attempt 02 passes candidate assertions, TypeScript, i18n, isolated Vite build
and diff check. See the backend and Web receipts under
`dist/product-saved-tag-retrieval-20261018/checks/`.

Native SHA-256
`543f8a529f3982c273d3f5103acda1c644c4069e0ac646236545962817571ff1` is
delivered as PID 66200 (managed session 98478). The Web build is served
asset-first/index-last; all nine HTTP hashes match the build and the index SHA
is `90474066dd8601a5a7eaf76351e9de8728b8689b12346c5d9c97ed3669e981ad`.
Configuration, both READY index projections and twenty owner identities match
the pre-delivery baseline; see `promotion/native-runtime.json` and
`promotion/web-delivery-result.json`. The previous native binary and full Web
tree remain backed up. The first replacement attempt stopped after a transient
process-exit observation; the old managed session exited 0 and its PID and
listener were confirmed gone before replacement continued, without extra
signals or socket removal.

Browser interaction and actual owner TAG mutation are **NOT RUN**. Retained
implementation/build/delivery evidence does not close PC-04d, full canonical
query AST, portable SavedViews, Phase 6 or release qualification.

## Consolidated current-build client journeys

The 2026-10-18 batch's isolated browser continuation finished on 2026-10-19
(Asia/Shanghai). It uses the same delivered native
`543f8a529f3982c273d3f5103acda1c644c4069e0ac646236545962817571ff1` and
Web index `90474066dd8601a5a7eaf76351e9de8728b8689b12346c5d9c97ed3669e981ad`.
`dist/product-consolidated-client-20261018/validation-cohort.json` records the
15-source freeze and complete 167-file Web source map. No product source was
changed for these interactions, and no additional Go or Web build was needed.

- Photos: two exact tags intersect rather than union; selected-only composes
  with them. Removing restrictions preserves the two shared selections. A
  decoded image zooms, pans, rotates and navigates within the same scope.
- Music: the same two-tag intersection and selection retention work. Real
  fixture WAV playback continues with the same current Blob while selected
  tracks are inserted next. Seek, 1.25x speed, mute/unmute and Stop execute.
- Notes: text/tag/sort/group context survives navigation; cancelling the
  unsaved-draft warning preserves the draft. A miss containing `name:` becomes
  a quoted literal Library query. Associated-file selection returns to the
  same query and downloads a ZIP whose entry and direct original both match
  the catalog's 253-byte SHA-256 identity. Root independently read the ZIP.
- SavedViews: complete whitespace/Unicode tag values survive tag-only and
  keyword/tag save, explicit revision-2 update and later UI recall. The
  tag-only heading names its saved view. Frozen server materialization yields
  the one expected 48,044-byte WAV with its manifest SHA-256. A new source is
  explicitly planned and saved; opening it shows only `New-source-proof.txt`
  and changes the prior one-file selection to zero.

Evidence is under the cohort's `media/`, `notes/attempt-02/evidence/` and
`retrieval/` directories. SavedView checkpoints span the retained A06 and A10
drivers and actual stored view identities; they are not one uninterrupted
passing script. Earlier selector, disclosure-state and launcher-lifecycle
failures remain retained. The three old photo/favorite scripts still fail on
their recorded assumptions; the targeted actual interactions above provide
the bounded evidence. An initial claimed closed-popover selection defect was
withdrawn after hit testing showed only an intentionally open popover covered
the card. No production logic was changed to accommodate a driver.

Notes' final screenshot was not captured because its tab had already closed;
the exact download and ZIP receipts remain. These generated fixtures report
semantic UNAVAILABLE honestly. Real semantic quality, configured description
generation, full restore, large-library performance, queue-capacity/race
matrices and complete responsive/appearance acceptance were not rerun. This
closes only bounded PC-04d and the stated client checkpoints, not complete
Photos/Music, core phases or release qualification.

Root's `dist/product-consolidated-client-20261018/final-review.json` confirms
all 167 Web sources, the 15 frozen sources and both contracts remain unchanged.
The retained materialized WAV independently hashes to
`2094357095772ca6165885bc74cd2c18493a7611f2d7c81e678f807785d14c12`.
All three isolated launchers exit cleanly and ports 4861–4863 are released.
The owner preview remains on port 4648, PID 66200/session 98478, with the same
configuration, twenty listed identities, both READY index projections and
served Web index. No owner annotation mutation, model installation or index
rebuild occurs in this continuation.

## 2026-10-19 client batch — cold intake, Photos range, and Music filters

**Phase and scope:** RW-PERSONAL-UX-1 UX-P1/M1/C1 plus existing intake
maintenance. This is bounded first-party client evidence over the existing
single-owner host, not core-phase, full-domain, or release qualification.

The current Web candidate has index SHA-256
`a65ad4cf2f047675171e0749bab8b1009849fe3b225262f587882c77dc964c73`. Its
167-source map was unchanged across the check; only the seven reviewed batch
paths differ from the SavedView baseline, and both checked normative contracts
were unchanged. Current-source `tsc`, i18n, isolated Vite build, and scoped
`git diff --check` all exited 0. The build produced nine pinned assets. The
reversible asset-only delivery returned `PASSED`: all nine served assets were
HTTP 200 with matching hashes, while the owner daemon PID/native/config,
twenty listed identity tuples and both READY index projections stayed the
same. The previous Web tree is backed up. Delivery receipt:
`dist/product-client-batch-20261019/promotion/result.json`.

On a fresh isolated profile, selecting `First file.txt` produced an automatic
executable READY `STORE_EXACT` review without manual Preview. One explicit
apply succeeded. There was no `content.list` before apply and no false
unavailable-library warning. The resulting 51-byte download matched its
input SHA-256 `fab90fc6d161ae9ad47c4a5e614562b9aac6c80e338d3e94c67194d8a14d42f7`.
The owned fixture was cleaned up. Earlier harness attempts remain preserved.

The integrated media attempt records 26/26 checks passing on four retained
photos and four tracks. It covers descending local order, full displayed
checkbox ranges, shared selection across Photos/Music, composable tag/query/
availability/suffix filters and removing/clearing filters, plus downloaded
WAV playback advancing and moving to the next track. A separate Photo
partial-range check selected the first three of four displayed photos with
checkboxes; a fresh keyboard check established the first-row anchor by
Meta-click, then Shift+Space selected exactly those same three and excluded
the fourth. These Photo observations are limited to the stated paths.

The partial-range Music checkpoint is **MIXED**, not an aggregate pass: one
child attempted a Photo Control-click path and failed, while the successful
Music fixture had only three WAV rows and selected all three. It therefore
does not prove partial Music range behavior that excludes a fourth visible
track. Treat that behavior as **NOT RUN**. Earlier selector and driver
assumption failures remain retained; they are not recast as product passes.
The checkpoint audit is `MIXED_EVIDENCE`; its fixture PID 82415 exited, port
4873 was released, and its temporary profile was removed. No source changed.

Separately, `scripts/run-local.sh` and its focused/broad tagged Go checks passed
for the isolated helper startup
(`dist/product-launcher-isolation-20261019/checks/attempt-03/`). The fresh profile
started and stopped cleanly
(`dist/product-launcher-isolation-20261019/actual-launcher/receipt.txt`) but served the
older `904740…` Web index, not this batch candidate; semantic/image bundles
were unavailable and no model was installed. This is helper-startup evidence
only, not model, semantic retrieval, or release qualification.

Evidence: `dist/product-client-batch-20261019/cold-first-use/final-summary.json`,
`media/attempt-05/result.json`, `media/partial-range/attempt-07/result.json`,
`media/partial-range/attempt-08/result.json`, `build/web-candidate-receipt.json`,
and `promotion/result.json`. Durable albums/playlists, semantic quality,
broader media behavior, and all applicable core/release gates remain open.
The partial-range classification and cleanup are recorded in
`media/partial-range/audit.json` (SHA-256
`21bdfc066a347914a70c2ce3608e264e5a296cab549d0a2c5b611d15f501220d`).

## 2026-10-19 Library quick-use and Music controls — bounded current evidence

This RW-PERSONAL-UX-1 UX-M1/C1 client cohort adds disclosed Library per-row
actions and refinements to existing Music queue controls over the same
host-owned scope. It adds no core operation or durable client state. The
candidate was built from 167 Web sources; exactly eight paths differed from
the preceding client batch. TypeScript, i18n, isolated Vite, and scoped
`git diff --check` each exited 0. The two pinned normative contracts stayed
unchanged, and Vite emitted nine assets. Receipt:
`dist/product-use-continuity-20261019/build/web-candidate-receipt.json`;
candidate index SHA-256 `12ec7ac42ebfa96e365118f7132d9b69fad055ceb862b5dd5c8b69078cff8988`.

The Library action checkpoint in acceptance attempt 04 passes its bounded
checks: list and grid menus copy the exact filename or recorded path without
selection, Details, or extra command/API reads; controlled clipboard writes
and rejection feedback are observed. One explicit original download returned
253 bytes matching the catalog SHA-256
`276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73`.
Clipboard evidence is adapter-controlled; native OS clipboard permissions
were not tested. Source review also confirms missing paths remain unavailable,
directories do not offer original download, and late clipboard status is
identity/workspace-fenced; these guards were not each independently exercised
in the browser. The enclosing attempt is **FAIL**, stopping later in Photos on
a stale sort-control locator; it is not an aggregate client pass.

The focused Music continuation passes for the actual three-WAV fixture: after
selecting one Photo, Shift-click selected the first two displayed tracks,
left the third unselected, and retained the Photo selection. The Music row's
own play control started, paused, and resumed playback: pause held the same
Blob and position, and resume continued that Blob. The raw request log contains
one `/api/v1/download`; the driver's zero-valued `directGets` counters matched
another URL shape and are non-authoritative. See this cohort's
`acceptance/audio-evidence-clarification.json`. The
stronger filtered hidden-row range was **NOT RUN** after fixture cleanup.
Earlier Photos assertions stopped before completing the intended no-match
selection check, so consolidated browser evidence remains **MIXED**, not an
all-green run. Adapter-controlled clipboard success/rejection was observed;
native OS clipboard permission behavior was **NOT RUN**.

The reversible asset-only Web delivery passed: all nine served asset hashes
matched the candidate, and owner PID/native/config, twenty listed identities,
and both READY index projections stayed unchanged. Receipt:
`dist/product-use-continuity-20261019/promotion/result.json`. No core-phase
closure, release qualification, or complete-domain acceptance is claimed.
Persistent albums/playlists and all applicable core and release gates remain
open. Notes copy behavior was already present and was not changed in this
batch.

## 2026-10-19 upload progress and Stop — bounded current evidence

This intake-maintenance cohort implements sent-byte progress and explicit
Stop through the existing upload route. Only a complete confirmed receipt
can automatically prepare the existing review; saving still requires the
ordinary explicit confirmation. Aborted or unconfirmed receipts stay
unresolved, possible temporary files are disclosed, and a later preparation
failure retains known returned rows. No backend endpoint, schema, processor,
durable state, or recovery meaning changed. A cold instance has no global
staging inventory through the workspace-scoped source operation; the new
copy does not promise that unavailable reconciliation path.

Artifacts are under `dist/product-upload-control-20261019/`. The frozen
167-source Web build differs from its predecessor only in `command.ts`,
`SourceDrawer.tsx`, `SourceDrawer.css`, and `drawers.ts`. TypeScript, i18n,
isolated Vite, and scoped diff checks exited 0; source and the two normative
contract hashes stayed unchanged. See `build/web-candidate-receipt.json`.
Candidate index SHA-256:
`4820a83d97c51395b37e99f18b05aecbdf36478915a8ca0dfa4dc611d306cfa3`.

Acceptance attempt 01 is **FAIL**: its driver expected an integer size label
while the UI correctly showed `16.0 MB`. The real upload, progress and
automatic review had already succeeded. Corrected attempt 02 is **PASS**:
native browser XHR sent 16,777,421 multipart bytes, then the operator's one
explicit save succeeded. The downloaded 16,777,216-byte original independently
matches SHA-256
`341aacac661ccb210720bedaa9ead5d668fe5ea41a73532fc147c71e34040df1`.
For a second upload, an artifact-only loopback proxy held the actual daemon
receipt after accepting the body. Stop produced the expected browser abort
and an unconfirmed-result notice. Releasing that receipt created no new
`plan.ingest`, `plan.apply`, or review card. The 133,120-byte temporary file
was independently inventoried before cleanup; Stop is not a rollback claim.
Both temporary profiles and owned daemons were removed. The two attempt
receipts and raw evidence remain separate; the failed run is not suppressed.

The progress observation proves sent bytes while waiting for a receipt,
not incremental throughput under network throttling. Pasted-text Stop,
malformed receipts, late-close and post-receipt error guards were source
reviewed but not independently exercised in the browser. No Go code changed
and no unrelated backend, model-installation or Linux matrix was repeated.
`promotion/result.json` records successful reversible Web delivery: all nine
HTTP asset hashes match; owner PID/native/config, twenty content identities,
and both READY index projections remain unchanged. No complete-domain,
core-phase or release qualification is awarded.

## 2026-10-19 filtered hidden-row range — current-candidate follow-up

`dist/product-hidden-range-20261019/run/result.json` records passing focused
checks on the unchanged upload-control Web candidate, index SHA-256
`4820a83d97c51395b37e99f18b05aecbdf36478915a8ca0dfa4dc611d306cfa3`.
The temporary fixture contains four actual Photos and four generated PCM WAV
tracks. Exact user tags select the first and third source-order subjects in
each domain, hiding the middle and fourth. Shift-click selects exactly the
two displayed subjects. Clearing the filters confirms both hidden subjects
remain unchecked; returning to Photos after selecting Music confirms the
Photos selection remains. The 167-source map still matches the frozen build.
No product code changed and no new Web delivery was needed.

The first driver failed by querying Photos DOM while Music was mounted; the
failure receipt remains. Corrected checks reused the same fixture and existing
tags, rather than creating a new corpus. See `audit-note.md` in that artifact
directory for setup, hashes and cleanup. Runtime identity is tied to the
launcher-reported frozen Web root and pre-run filesystem hashes; HTTP asset
hashes and an independent post-start argv check were not captured. The initial
driver hash was recorded but its source copy was not retained. These limits
are not silently promoted to a stronger attestation. The owned daemon/profile
were cleaned up. This closes the earlier hidden-row pointer-selection evidence
gap only; no new no-match, keyboard, retrieval-quality, whole-domain or
core/release qualification is claimed.

## 2026-10-19 Music current-track return

This client-only UX-M1/C1/D1/Q1 refinement changes
`MusicLibraryExperience.tsx` and its existing `musicDaily.ts` catalog.
If the exact current audio tuple remains in the loaded host results, an
explicit action clears Music-local filters/grouping and focuses that track.
It keeps sorting, shared selection, host search and the App-owned player.
If the tuple is absent from the host scope, the page explains that instead.
Pending focus is bound to workspace, playback, browse scope, result tuples and
the expected local view; scope changes and unmount cancel it.

`dist/product-music-current-return-20261019/build/web-candidate-receipt.json`
records one passing TypeScript/i18n/isolated-Vite/diff cohort over 167 unchanged
Web inputs and exactly the two reviewed source changes. The 640 Go/module
inputs and nine core contracts still match the already-passed broad Go/build
cohort; no backend suite, model installation or Linux matrix was repeated.
The candidate index is SHA-256
`5e5040c8c5ecd9baf4bf3cea26ca6714cdbad072ab574c09df8ba3f283cac3c7`.

The isolated fixture used actual generated PCM WAV bytes and photo files.
Fifteen local checks prove direct use of the new action after selected-only,
local text filtering and Artists navigation, exact row focus, shared photo and
Music selection, and retention of the paused Blob/position without another
original read. A separate six-check suffix proves that the Beta host query
remains while Alpha is reported outside loaded results, offers no false local
recovery action, and retains its exact paused Blob. Each accepted browser
context made one original-download request. The 48,044-byte Blob matches
SHA-256 `2094357095772ca6165885bc74cd2c18493a7611f2d7c81e678f807785d14c12`.

The [aggregate](../../dist/product-music-current-return-20261019/acceptance/aggregate-result.json)
links the preserved local prefix and passing outside-host suffix. Failed
drivers remain separate: a pre-browser ArrayBuffer hashing mistake, a strict
paused-time comparison at the browser's coarse timestamp, a textbox/searchbox
role mismatch after the 15 passing local checks, and exact matching of text
that shares the Paused status line. Fresh browser contexts were required
because the held browsers had no exposed control endpoint; the same daemon,
fixture and candidate were retained, and the local recovery checks were not
replayed for the outside-host suffix. The source was not changed to fit a
driver. Index and all nine candidate HTTP asset hashes were checked.

Fixture paths were explicitly selected through the seeder's temporary
environment overrides; its static config defaults were not the selected
runtime paths. The owned daemon, browser and temporary profile were removed;
the port was released and the original wrapper failure receipt preserved.
Reversible asset-only delivery then passed without restarting owner PID 97016:
native/config and the same 20 listed identities remain, lexical/semantic are
READY, all nine live HTTP asset hashes match, and old hashed assets remain for
open tabs (73 live files). See `promotion/result.json` in the same cohort.
Root reviewed the diff, raw results and before/after screenshots. This proves
the named paused-playback interaction, not sustained active listening, every
filter independently, narrow layouts, real-provider retrieval quality, a full
Music baseline or release qualification.

## 2026-10-19 Photos shortcuts and selected information takeout

The operator asked for coherent useful-function batches before concentrated
validation. This client-only UX-P1/C1/D1/T1 maintenance batch adds exact local
tag filtering from photo cards, a disclosed per-card original-download action,
and quoted filename/source-path lists over the shared selection. It includes
the previously built selection-summary refinement in its first local delivery:
count and known size stay visible; type details expand on demand, with unknown,
non-file and unresolved states still explicit. Existing Notes body copy was
reused unchanged. No backend, durable format, query or export authority changed.

The reviewed five-source candidate passed one TypeScript/i18n/Vite/diff cohort.
The unchanged 640 Go/module files and nine contracts reuse the prior actual
broad-Go/native evidence. The browser evidence is a retained prefix plus focused
suffixes, not one uninterrupted successful script: ordinary selection after
row hover, summary keyboard disclosure and exact JSON-lines clipboard values
passed; the photo menu supports Enter/Space/Escape and focus return, with the
same shared count/known-size summary. Its original returned 3,117,146 bytes and
SHA-256 `0a5b27f33d818d70a0416decf62bbdc563df3f4dd00716823058a5cb5cd9671f`.
Document and body widths are 390 at the 390 px checkpoint.

The tag chip becomes active. All four fixture photos have that tag, so a
count-changing subset is NOT RUN. Missing-field refusal and denied clipboard
remain source-reviewed only. Failed drivers are preserved. The initial launcher
receipt was rewritten to INTERRUPTED during cleanup; its browser failure is
intact and that wrapper-history loss is explicit in the cleanup record.
The isolated fixture was removed and its port released.

Asset-only local delivery passed with all nine current HTTP hashes, unchanged
native PID/config and index readiness, and the same 20-item identity window.
The aggregate remains PASS_WITH_LIMITATION. The promotion pins the actual PASS
photo suffix, while this record retains the separate prefix evidence and all
limits. No core phase, complete domain or release is qualified.

Evidence: [root review](../../dist/product-useful-actions-20261019/final-review.json),
[build](../../dist/product-useful-actions-20261019/build/web-candidate-receipt.json),
[browser aggregate](../../dist/product-useful-actions-20261019/acceptance/aggregate.json),
[local delivery](../../dist/product-useful-actions-20261019/promotion/result.json).
