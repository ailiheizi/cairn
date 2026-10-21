# Product Experience Ledger Through 2026-10-20

> **Historical snapshot.** This is the complete former product-experience ledger, preserved as of 2026-10-20. Its unchecked items remain historical evidence of unresolved work; checked items and receipts retain their original wording and do not establish current release or phase status. Do not use this snapshot as a current queue or as authority over normative requirements. Follow [`docs/README.md`](../README.md) and the single [Core MVP Execution Plan](../technical/core-mvp-execution-plan.md).

## Historical open work and evidence

The compact current entry at [`technical/product-experience-todo.md`](../technical/product-experience-todo.md) links to the relevant detailed sections below. All original checkboxes and evidence are preserved. For the broader unresolved gates, see [Gates](#gates), [Verification and honesty](#verification-and-honesty), and the historical SP sections.

---

# Product Experience Todo

> Status: informative progress ledger (documentation authority rank 7). It
> records task-level state above the core. It adds no MVP scope, closes no
> gate, and awards no completion credit. Requirement status is owned by the
> canonical matrix in
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md);
> narrative and gates live in
> [Product Experience Plan](../technical/product-experience-plan.md); item constraints live
> in [Product Experience Backlog](../technical/product-experience-backlog.md).

## Active batch — focused Photos and Music interaction, 2026-10-20

Scope: admitted RW-PERSONAL-UX-1 client refinement, parallel to Phase 4. The
normative client contract and core execution plan remain unchanged. See
ADR-067 and the dated interface reference review for the decisions.

- [ ] Photos: compact scene/name-tag search, visible active filters, first-screen
  photo content, and accessible existing display/selection/original actions.
- [ ] Music: clear track/album/artist browsing and primary play/shuffle actions,
  with secondary filters and queue organization available on demand.
- [ ] Shared player/scope: current title opens the same full player; keep real
  errors, result limits, favorites and playback continuity visible and usable.

Root owns one integrated Photos -> search/filter/view/original -> Music ->
browse/play/queue/immersive/return journey at 390 and 1440 px. Implementation is
integrated; browser acceptance and owner-instance delivery are pending. Reuse
the prior private fixture/profile and installed real models, without repeating
capture or index preparation. No release/core-phase credit is claimed.

## Active batch — personal media presentation and visual discovery, 2026-10-20

This batch advances Phase 4 VIS-1/2/3 and the already admitted RW-PERSONAL-UX-1
client scope, including first-party client contract §14.1. Cairn remains a
single-owner self-hosted content, description, discovery, export and recovery
plane. The batch converges on existing Photos, Music and `search.query`
capabilities; it does not add an endpoint, schema, processor, index type,
loader, runtime extension or second content authority.

- [x] Extend the existing Photos Exhibition with an explicit timed slideshow:
  3/5/10/20-second interval, pause, explicit loop, bounded loaded sequence,
  immersive entry/exit and usable host Details/original actions.
- [x] Add immersive controls to the existing Music player while retaining its
  same verified audio element, Blob, playback and transient queue.
- [x] Add Photos scene-description search and retain the existing “search by
  this image” action, using real `multimodal-clip` results from an explicitly
  installed and indexed local profile; keep original takeout unchanged.

The three client functions are implemented and locally delivered. The shared
browser journey passed in `dist/product-showcase-20261020/client/acceptance-result.json`:
timed slideshow and its pause/loop/Escape/focus behavior passed; Music retained
the same audio element, Blob and playback state while exercising controls and
queue; two Chinese scene queries ranked the expected photos first, and an image
query ranked the related interior photo ahead of an unrelated photo, using real
`multimodal-clip` provider/generation evidence; opening the
matched `a.jpg` result showed its viewer and host Details; and downloaded
`a.jpg`/`c.jpg` matched independent SHA-256/length records. The 390 px viewport
had no horizontal overflow. The retained slideshow evidence records successful
assertions before the continuation, without detailed timing metrics. Final
local delivery is recorded in
`dist/product-showcase-20261020/promotion/web-delivery.json` (index
`b7577854dcafcbb6956f2cf2468bea6b82db5356419bef7834f9f209ac57c141`); the
final `promotion/postcheck.json` is PASS. The single shared exit was: Photos ->
Exhibition -> timed play/pause/interval/loop -> immersive display and return ->
host inspection/original takeout; Music immersive operation with the same player
source; and Photos scene-text plus image-to-image search against actual CLIP,
ending with independently verified originals.

The private Darwin arm64 CLIP profile is installed and its image generation is
READY with 11 indexed originals. Postcheck retained the 20 original identity
tuples, config digest, daemon/CLI and OCR manifest, and the prior lexical and
BGE generations. The accompanying lexical rebuild remains DEGRADED because
`duplicates`, `duplicate_group`, `locators`, `notes`, `descriptions`, and
`language` are missing; this does not establish complete Phase 4 coverage. The
bundle is a private local-development installation: upstream/license conversion
was not separately asserted and redistribution review remains pending. This
batch is locally delivered; it grants no whole-product completion, Phase 4,
cross-platform or release credit.


## Active batch — saved content to searchable content, 2026-10-19

Close the admitted intake/search workflow: after a confirmed save, explicitly
prepare the existing workspace indexes from the same drawer, see the actual
search outcome, then continue to the saved source. Reuse `search.rebuild`;
index availability never becomes an exact-save prerequisite. Ordinary source
browsing remains available when search is unavailable or degraded.

- [x] Implement confirmed-plan/workspace-bound preparation and visible outcomes
  using the existing client and command, with no automatic rebuild.
- [x] Verify one ordinary capture -> explicit preparation -> body search ->
  matched paragraph -> exact-original download journey, then deliver locally.

The saved-content-to-searchable batch is implemented and locally delivered.
The DOCX browser flow in `dist/product-search-continuation-20261019/browser-client/attempt-14-prepare-search/result.json` passed capture, explicit preparation and retrieval with readable matched Details; its final-feedback screenshot was captured before React settled, so that feedback remained unverified in that run. Attempt-02 waited for and verified the final preparation feedback through the shared intake UI while passing the complete OCR journey. Neither item closes a core phase or release gate.

- [x] OCR-1: explicit pinned local bundle preparation, verification and activation.
- [x] OCR-2/3: real image recognition -> existing lexical/BGE retrieval ->
  readable OCR text/quality -> unchanged original, through the ordinary client.

Attempt-02 evidence is retained in `dist/product-image-text-20261019/client/attempt-02/result.json` and `dist/product-image-text-20261019/promotion/postcheck.json`. The local daemon reported OCR `READY` with profile digest `sha256:d633666bc2f0f28a87b6123353cbf1dd31410593f33299d6edaca6cd102e9a0c`. All four independent expected Chinese lines matched; mean confidence was 0.998004 (99.8%), with 0 low-confidence regions. Lexical FTS and the real BGE provider succeeded, and semantic results cited the same OCR artifact. The original download matched 74,634 bytes and SHA-256 `8a2fd4cc149d98b6cca5c6b2a6f2092ac664e57f58935a4849ce4b4b2d06bcfa`. Explicit preparation returned `DEGRADED`: 21/21 selected text sources were indexed with no source omissions, while overall field coverage lacked `locators`, `tags`, `notes`, `descriptions`, and `language`. The corrected decoder no longer applies softmax a second time to recognizer probabilities; its output is bound to the new profile/recognition digests, and existing records/generations were preserved rather than reinterpreted.

## Product-power milestone proposal — 2026-10-19

The operator requested substantial new product value instead of another small
affordance batch: **PDF/DOCX body search -> matched paragraph -> exact-original
takeout**, using the existing lexical/BGE, Notes and export authorities.
The missing document-body feed is now implemented; the existing BGE capability
is reused rather than counted again as a new feature.

The owner approved the [concrete milestone](../technical/product-power-content-search-proposal.md)
and ADR-063's narrow compiled PDF/DOCX processor admission. AGENTS and normative
extraction scopes are updated. CS-1/2/3 are implemented and locally delivered
on the existing preview; all other exclusions and core phase dependencies
remain unchanged.

- [x] CS-1: bounded extraction and retained producer/route/artifact evidence.
- [x] CS-2: real body-only lexical and Chinese BGE retrieval with source spans.
- [x] CS-3: ordinary browser capture/search/inspection and exact-original
  takeout, including saved retrieval after restart.

Evidence is retained under `dist/product-content-search-20261019/`: the passed
native cohort and `acceptance-api/attempt-04/verify-output/verification.json`
cover bounded extraction, body-only lexical and real Chinese BGE retrieval,
saved retrieval after restart, and exact downloads/frozen exports. Browser
`attempt-05` shows PDF and DOCX matched paragraphs and original downloads.
The final DOCX upload journey was resumed from its confirmed staged plan:
`browser-client/attempt-12-resume-staged/result.json` records successful save
and first-click source navigation; `attempt-13-final-readback/result.json`
records explicit index preparation, successful retrieval, readable Details
and matching original bytes. Earlier failed driver attempts remain retained.
The rebuild reports DEGRADED for absent lexical fields, while all 13 selected
text sources were indexed and the actual lexical/semantic query succeeded.

Root reviewed the code and screenshots. `promotion/postcheck-final.json`
confirms the local preview serves the final build with existing configuration,
CLI, 20 listed content identities and index generations preserved. Scanned-PDF OCR,
arbitrary old-capture backfill and document readers remain outside this
milestone; existing documents need explicit recapture. Following priorities
are actual visual-discovery delivery and reusable coherent sets under their
separate contracts/gates. This milestone grants no core-phase or release credit.

## Active batch — intake and discovery affordances, 2026-10-19

The next implementation-first batch closes three concrete gaps in the existing
operator loop, under ADR-062 and API/WebUI §2.2:

- Choose a browser folder, retain safe relative names and review/apply one
  bounded upload batch. Keep legacy file uploads and partial-result handling.
- Start the existing image-subject query directly from Photos. Retain the
  preceding scope on failure/unavailability; an entry is not provider readiness.
- Select a validated installed description profile into the unsaved Settings
  draft. Save/restart, network authorization and generation remain explicit.

The three source scopes are root-reviewed, implemented and locally delivered.
Focused upload tests prove hierarchy, exact bytes, ordinary plan/apply/restore,
refusals and shared bounds; broad tagged Go tests and consolidated TypeScript,
localization, build and diff checks pass on the same frozen inputs.

The private browser selected a real folder after a server/upload mode switch,
reviewed both nested paths and explicitly saved them once. A read-only endpoint
continuation verified both original lengths and SHA-256 values. The attempted
browser Details-download suffix did not pass: the source drawer remained open
after its first View saved source action and blocked the search click. Retain
that result as a UX gap, not a complete browser takeout pass. No reupload,
second save or index rebuild was used to obtain the exact-byte evidence.

The actual unavailable image query retained all seven loaded photo identities,
their order, selection and destination with a visible notice. The profile
omitted the image dimension entirely; this proves fallback behavior, not image
retrieval. The Notes chooser browser used explicitly mocked optional installed
profile metadata: its draft changed, credentials and real configuration did
not, and authorization stayed disabled. Real provider generation was not run.
Initial driver failures and corrected-attempt receipts are retained.

All nine candidate Web assets match the served preview. Owner configuration,
CLI, 20 listed content identities, both existing READY generations and 88 old
non-index assets remain intact. The private daemon was stopped with its data
retained. Evidence is under `dist/product-intake-discovery-20261019/`, including
the native/Web receipts, `folder-client/combined-result.json`, the image and
Notes results, and `promotion/postcheck-final.json`.

- [x] Follow up the observed post-save View saved source action: a confirmed
  click now waits for the finishing refresh, bound to the same plan/workspace;
  closing the drawer cancels it. The CS-3 DOCX journey above verifies the shared
  action, followed by Details and exact-original download. The earlier folder
  run remains a partial result; it was not repeated to claim a new folder pass.

No parent/core/release completion is awarded. Full image/description provider
setup, persistent media organization, new media surfaces and AI-client
integration retain their existing outstanding contracts and gates.

## Active parent tasks — functional completion batch, 2026-10-19

The operator again directs implementation before consolidated validation. The
active client batch maps directly to the existing parent tasks: PC-04 saved
retrieval editing/copy, PC-05/MF1 artist-to-album listening, and SP-2/current
Photos chronological browsing. Luna implements these three disjoint scopes
before root review and one combined check. Existing authenticated storage,
search scope, original reads and export operations remain authoritative.

- PC-04: load a stored supported query for editing; review a same-name update
  or save a distinct named copy without altering the source. Name-keyed
  `view.save` cannot provide rename/delete semantics.
- PC-05/MF1: navigate artist → recorded album → tracks, retain player and
  navigation context, and filter recorded years with explicit unknown facts.
- Photos/SP-2: browse loaded photos by recorded modification year/month, keep
  unknown dates visible, and reuse shared selection/viewer/original takeout.

All three feature implementations are root-reviewed and locally delivered.
Photos now filters recorded UTC modification years/months, including unknown
dates, with shared selection and original takeout. Music adds artist → album →
tracks, breadcrumb return and recorded-year filtering over existing facts.
Saved retrieval loads stored supported conditions for editing, reviews a
same-name update, or creates a distinct named copy with retained scope/default
policies. The copy guard checks a fresh list before name-keyed upsert; it is not
an atomic concurrency guarantee.

The final build/localization checks pass, reusing the preceding TypeScript and
unchanged helper passes after string/catalog-only corrections. Initial failures
remain retained. The private SavedView journey verifies actual update/copy
records and source preservation. The Photos/Music continuation verifies one
loaded year/month, empty unknown-date state, selection, artist/album order,
year filter and matching original/player bytes. Root viewed the screenshots;
its evidence review records the post-run count clarification and remaining
browser limits. All 660 native inputs and 12 normative inputs remain identical
to the already passing native cohort, so that suite was not repeated.

The local preview serves all nine matching candidate assets; configuration,
CLI, 20 listed identity tuples, both READY generations and 86 old non-index
assets remain unchanged. This section marks no parent task complete and adds
no persistent album, playlist, extraction, video or AI-client integration.
Evidence is under `dist/product-functional-completion-20261019/`, especially
`review/media-evidence-review.json`, the two client results, and
`promotion/postcheck-final.json`.

## Existing core operator actions — 2026-10-19

ADR-061 records two source-proven entry gaps: Settings exposes embedding
profiles/search grants but cannot authorize the existing on-demand describe
operation, and the browser has no entry for existing portable recovery-record
and public-anchor exports. The admitted implementation-first batch supplies
an opt-in separate installed describe-profile projection, bounded explicit
DESCRIBE authorization with exact matching in Details, and two separate
server-file exports inside the existing Restore review. Three Luna scopes
write the full batch before combined review and checks. No new provider,
endpoint, signed format, backup service, runtime loader or domain is admitted;
the default empty description profile remains unavailable.

The separate CLI clean-restore porcelain remains an identified contract gap:
CLI §13 documents `restore --from/--latest/--trust`, while the implemented
clean-reader path uses explicit daemon recovery-reader startup flags. This
batch does not silently narrow that target or award its completion.
The native implementation and focused/broad checks pass; the client source and
combined build are delivered with the functional batch above. Actual browser
DESCRIBE authorization/generation and a new recovery-record/anchor export pair
remain NOT RUN. No default AI-provider capability is claimed. Source/native
evidence is under `dist/product-core-operator-actions-20261019/`; final Web and
local delivery are under `dist/product-functional-completion-20261019/`.

## Later-page Photos/Music use — 2026-10-19 bounded continuation

A final-Web private suffix now reaches the previously unrun media after saved
retrieval continuation: Photos' actual card action downloads a 73-byte PNG
with matching SHA-256, and Music loads the 4,044-byte exact WAV as a player
Blob. The native element reports duration 0.25 seconds and unpaused/not-ended;
its captured time is zero, so this suffix does not prove advancing playback.
Earlier route/sequence driver failures remain retained. Root inspected both
screenshots. No owner data, product code, ingest or restore changed. See
`dist/product-media-takeout-closure-20261019/client/continuation-03/result.json`.

## Saved retrieval and restore continuation — 2026-10-19

The implementation-first cohort is written, root-reviewed and locally delivered.
Saved retrieval now continues bounded `view.evaluate` pages over the stored
lexical, structured and exact live-TAG AND conditions, instead of stopping at
200 displayed matches. The host appends only one authenticated current
projection, preserves shared selection, and retracts stale results with an
explicit refresh action. The paged authorization pass supplies recorded
regular-file lengths; a known size alone never establishes original identity
or availability. Unknown size remains absent. Legacy unpaged response shapes
remain unchanged.

Restore retains its captured workspace, plan ID/digest, copy and destination
when an apply response is lost and the drawer closes. Reopening checks that
same plan. Recorded completion is labeled as earlier evidence rather than a
fresh output-byte verification; an unexecuted plan permits an explicitly
labeled same-plan retry that may write to the original destination. The guard
is transient mounted-client state, not a persistent recovery record.

The focused paging/TAG/token/Restore checks and broad tagged Go suite pass
(2,284 passing test events, 27 passing package events, 17 skipped tests and
seven skipped packages). The candidate native pair builds. Final TypeScript,
i18n, isolated Vite and diff checks pass. The native-tested Go/contracts are
identical to the final pin; the later Web-only translation and optional-size
validation corrections have separate final Web evidence. Initial compile,
localization and driver-preflight failures remain retained.

The private Restore aggregate proves a real apply followed by a controlled
lost response, close/reopen with the original destination and same-plan status,
and independent readback of all 205 original lengths and SHA-256 values.
A separate no-execution suffix exposes an explicit same-plan retry and verifies
all 205 restored outputs. The original recorded-status text was sampled before
its async render; that UI claim is not awarded. The two raw driver failures
remain unchanged. Restore browser evidence uses the prior Web candidate whose
Restore implementation is identical to the final build.

The final-Web SavedView suffix proves 200/205 first-page results followed by
five more, 205 unique subjects and the first selection retained. The second
page includes both PNGs and the WAV. Its raw result remains FAIL: the subsequent
original-download probe used a list-row locator against the rendered grid and
timed out before downloading. Later-page original bytes, Music playback,
stale-revision and newer-search browser branches remain NOT RUN; native paging
checks cover the recorded-length projection and stale-token refusals. Earlier
selector/locale failures remain retained. Root inspected the final-page screenshot;
no fourth browser attempt was started for a green label.

Local delivery retains configuration, CLI, 20 listed identity tuples, lexical
database bytes and both READY generations. Nine candidate HTTP assets match,
and all 84 prior non-index Web files remain intact. No owner content write,
rebuild, model install, new durable schema, endpoint, processor or runtime
loader occurred. ADR-060 governs this Phase 4 discovery and existing-adapter
maintenance batch; no complete-domain, core-phase or release gate is closed.

Evidence: [final source freeze](../../dist/product-recall-and-restore-continuation-20261019/source-freeze.json),
[native checks](../../dist/product-recall-and-restore-continuation-20261019/native-checks/attempt-02/receipt.json),
[final source equivalence](../../dist/product-recall-and-restore-continuation-20261019/native-checks/attempt-02/final-source-equivalence.json),
[final Web checks](../../dist/product-recall-and-restore-continuation-20261019/web-checks/attempt-03/receipt.json),
[Restore evidence review](../../dist/product-recall-and-restore-continuation-20261019/review/restore-evidence-review.json),
[SavedView evidence review](../../dist/product-recall-and-restore-continuation-20261019/review/saved-view-evidence-review.json),
and [local delivery](../../dist/product-recall-and-restore-continuation-20261019/promotion/postcheck-final.json).

## Current Notes and reusable frozen takeout — 2026-10-19

This implementation-first Phase 4 cohort addresses two source-proven gaps:
a truncated description history could misidentify an older revision as current,
and export history exposed verification without an explicit way to materialize
the same frozen files in a new empty directory. ADR-059 records the read-only
current-description projection/paging contract and the existing-manifest client
composition. Luna implements backend paging, Notes/Details continuation and
history takeout in parallel. The root reviewed the combined implementation,
including the legacy top-level truncation compatibility, initial Details
hydration fencing and locally validated accepted-successor display. Focused
paging/token checks, the broad tagged Go suite (2,280 passing test events,
27 passing package events), native builds, TypeScript, i18n, isolated Vite and
diff checks pass on the final frozen sources. The initial test-fixture compile
error and missing translated-label attempt remain preserved separately.

The bounded synthetic Notes journey loads 200 of 205 summaries without a body
crawl, reads one body on expansion, rejects a changed-projection continuation,
keeps the independent user NOTE visible, and refreshes/continues to 206 unique
rows in Notes and Details. The SQL-seeded descriptions lack authenticated
recovery bindings: the public NOTE and invalidating description writes commit
with explicit DEGRADED publication. This is presentation evidence, not healthy
publication or recovery qualification. The acceptance did not exercise every
workspace/draft/race branch.

The explicit-selection export journey verifies two exact files, recalls the
same frozen manifest, materializes it in a new empty directory and retains its
recorded target and digest. Occupied/symlink destinations are refused without
changing a sentinel or the empty symlink target. A controlled post-apply HTTP
503 is reconciled by same-attempt verification after close/reopen, without
another write. Its raw runner remains FAIL because its final console assertion
misclassified four intentional HTTP 422 refusals; a separate evidence review
maps those exact requests and the injected 503. Earlier driver/setup failures
are retained; the journey was not replayed for a green final label. Live
SavedView membership drift and sidecar reproduction were not run in this
browser cohort. The attempt guard is transient browser-session state; it
conservatively locks even a refused write because the existing response does
not attest no-write. It is not a persistent recovery record.

Native and Web candidates are locally delivered. The unchanged configuration,
CLI, 20 content identity tuples, lexical database bytes and both READY index
generations were retained; no index rebuild or model installation ran. All nine
candidate HTTP assets match, and the 83 prior non-index files remain intact.
No new schema, recovery format, processor, index dimension or product surface
is admitted, and no complete-domain, core or release gate is closed.

Evidence: [final source freeze](../../dist/product-notes-and-export-20261019/source-freeze.json),
[native checks](../../dist/product-notes-and-export-20261019/native-checks/attempt-02/receipt.json),
[Web checks](../../dist/product-notes-and-export-20261019/web-checks/attempt-02/validation-receipt.json),
[bounded Notes receipt](../../dist/product-notes-and-export-20261019/notes-client/notes-run-receipt.json),
[export evidence review](../../dist/product-notes-and-export-20261019/export-client/attempt-06/evidence-review.json),
and [local delivery](../../dist/product-notes-and-export-20261019/promotion/postcheck-final.json).

## Function-first Photos, Music and recovery batch — 2026-10-19

The operator reaffirmed batch implementation before consolidated validation.
The ordinary-loop fixture preparation is paused; it started no daemon and
wrote no content. Three disjoint Luna implementations now address existing
client operations together:

- Photos: explicit browser fullscreen for the current bounded viewer, with
  truthful recorded modification time beside the existing time ordering.
- Music: an explicit, cancellable session sleep timer over the one shared
  verified player, plus recorded track-duration visibility.
- Recovery: find and order the returned restore points by their recorded
  source/time without changing the selected copy or authorizing another plan.

This is Phase 4 parallel client maintenance under RW-PERSONAL-UX-1 P1/M1/D1
and the existing API/WebUI restore flow. It introduces no backend operation,
durable schema, playback session, processing/index dimension, recovery format,
or domain surface. Existing byte budgets and explicit plan/apply boundaries
remain authoritative. All 12 incremental source changes were reviewed after
the whole batch was written. TypeScript, i18n, isolated Vite, diff checking
and one practical tagged Go regression pass. The Web candidate is locally
delivered with nine matching HTTP assets; native binaries, configuration and
the running owner process remain unchanged.

Bounded browser evidence is a sequenced aggregate, not one all-green run:
Photos fullscreen/next/exit/return and recorded time, exact WAV download,
timer selection/cancellation and same-Blob navigation, manual Stop and
clock-triggered deadline/notice behavior, and restore-point filtering/sorting
pass in their retained continuation attempts. The WAV has 1,440,044 bytes and
the expected SHA-256; its recorded 90-second duration is visible. Restore
filtering/sorting issues no plan/apply operation. Driver health/disclosure/
hidden-idle-control failures remain retained. An initial clocked 390 px check
measured 515 px document width; fresh 390 px and desktop-to-390 px diagnosis
both measure 390 px, with readable controls and no source/CSS change. This is
bounded viewport evidence, not blanket responsive qualification.

Evidence: [source freeze and root review](../../dist/product-functional-cohort-20261019/source-freeze.json),
[consolidated checks](../../dist/product-functional-cohort-20261019/checks/receipt.json),
[browser aggregate and retained limits](../../dist/product-functional-cohort-20261019/client/combined-result.json),
[fresh narrow-screen diagnosis](../../dist/product-functional-cohort-20261019/mobile-fix/diagnostic.json),
[resized narrow-screen diagnosis](../../dist/product-functional-cohort-20261019/mobile-fix/diagnostic-resize-order.json),
and [local Web delivery](../../dist/product-functional-cohort-20261019/promotion/result.json).
Full-domain, core and release gates remain open.

## Reuse-first intake and discovery continuation — 2026-10-19

Luna completed the selected code batch before consolidated checks. Notes now
has an explicit **Save text as a file** handoff to the existing SourceDrawer
composer. It opens the editable text field, retains existing text drafts and
uses the same prepare/upload, plan review and explicit save. It creates an
ordinary text file, not an Annotation.NOTE copy or a separate capture store.
Connection/storage, pending-intake, panel and existing settings/detail-draft
guards apply; ordinary Add/recheck behavior remains unchanged. The shortcut
has no workspace prerequisite, so it can use ordinary first-file ingest.

Current lexical readiness now uses the query path's existing config/profile
binding authority. A readable incompatible generation is UNAVAILABLE rather
than READY in both status.get and per-item projections. Missing generations,
failed rebuilds and absent Indexer wiring retain their distinct outcomes;
raw historical coverage measurement remains unchanged. No schema, public
operation, signed format or generation-profile meaning changes.

The four focused Go tests, broad tagged Go suite, native pair build and diff
checks pass on the frozen 651-input/10-contract cohort. The initial test
fixture omitted exact.Service's configured digest and was corrected without
weakening production refusal. Client TypeScript/i18n and Vite/diff pass on the
same 169 source inputs across a preserved runner-path failure and corrected
suffix. Root reviewed the combined changes. Native delivery retains the
configuration, CLI, 20 content identity tuples, prior lexical database and both
index generations with dual READY; it performs no rebuild. The Web delivery
serves all nine matching candidate assets. The bounded read-only browser smoke
passes for the new entry, text focus, Escape focus return, retained local
draft and 390 px overflow check. Root inspected that screenshot. No text was
prepared or saved in the owner instance, so this grants only handoff/draft/
focus credit, not a new end-to-end text-save claim.

Evidence: [core checks](../../dist/product-intake-takeout-continuation-20261019/checks/attempt-02/receipt.json),
[client prefix](../../dist/product-intake-takeout-continuation-20261019/client-checks/attempt-01/result.json),
[client suffix](../../dist/product-intake-takeout-continuation-20261019/client-checks/attempt-02/result.json),
[native delivery](../../dist/product-intake-takeout-continuation-20261019/promotion/result.json),
[Web delivery](../../dist/product-intake-takeout-continuation-20261019/promotion/web-result.json),
and [bounded browser smoke](../../dist/product-intake-takeout-continuation-20261019/text-entry-acceptance/result.json).
No complete-domain, core-phase or release qualification follows.

## Current captured-time product batch — 2026-10-19 (implemented and locally delivered)

The operator reaffirmed implementation-first delivery: implement a coherent
ordinary-use batch with Luna, review the combined change, then run one
proportional consolidated check. Do not interrupt each small function with a
repeated browser or platform matrix. Retain the required identity, recovery,
and release gates; this changes work cadence, not completion criteria.

The existing captured modification-time fact now feeds the lexical date facet,
Library/namespace/month projection, and Library/Photos local ordering.
Fractional seconds and valid epoch/pre-epoch dates retain their meaning;
missing dates stay unknown. Local sorting applies only to loaded rows, keeps
unknown times last and equal millisecond times stable, and never changes host
search relevance or invents image capture dates. Library keeps its existing
browser sort preference, and Photos uses its existing browse session.

The backend focused checks and actual daemon/CLI 2020/2024 boundary journey
pass. The broad run retains 26 successful packages and one new-test response-
field assertion failure; only that assertion changed before its passing
focused rerun. This is a staged aggregate, not one all-green broad run.
The local native upgrade and one ordinary index rebuild preserve 20 content
identity tuples, configuration, the prior V4 database, and the served Web tree
at that checkpoint. Both lanes report READY. The rebuild itself remains
DEGRADED for six absent field-presence values; its selected-text source
inventory is complete at 42/42. An owner query with the wrong input field is
invalid evidence; the isolated daemon/CLI test supplies the date-boundary proof.

The client batch was fully implemented before TypeScript, i18n, actual shared
parser/namespace/month/sort helper checks, isolated Vite, and diff checks ran
once and passed. All 170 frozen input paths match before and after. Root
reviewed the combined diff and delivered the nine matching candidate assets;
only the new JS asset and index changed. The single read-only browser attempt
matched that served build and loaded real content, but stopped at a driver
selector mismatch: it requested the English sort label in the Chinese UI.
The raw failed attempt is retained; no sort/viewer browser success is claimed,
and no replay was started merely to obtain a green result. The actual shared
helper checks and build remain passing evidence. No complete Photos,
core-phase or release credit is granted.

Evidence: [backend aggregate](../../dist/product-captured-time-discovery-20261019/checks/attempt-02/receipt.json),
[native delivery](../../dist/product-captured-time-discovery-20261019/promotion/postchecks.json),
[client checks](../../dist/product-next-functional-batch-20261019/checks/attempt-01/result.json),
[client delivery](../../dist/product-next-functional-batch-20261019/promotion/result.json),
and [bounded browser attempt](../../dist/product-next-functional-batch-20261019/acceptance/result.json).

## Current discovery-function batch — 2026-10-19 (implemented and locally delivered)

Following the operator's implementation-first priority, Luna implemented one
coherent discovery batch before concentrated verification. The existing visual
filter editor now exposes name, source path, recorded text language, content
hash, and duplicate conditions, with parser-checked quoting, stale-edit refusal,
and explicit submission. These are existing query capabilities, not new search
semantics. Notes offers ordinary Library search whenever its text filter is
nonempty, including when local rows already match; source/tag filters are not
carried over and unopened bodies remain lazy. Notes also renders the existing
host notice so a refused or failed search has a visible explanation.

Browser-local negative TAG and duplicate predicates now refuse missing or
changed required projections instead of presenting broad hits as filtered.
A confirmed empty TAG snapshot remains valid: excluding a nonexistent tag keeps
the candidates. Positive TAG predicates still use the daemon's lexical lane.
TypeScript, i18n, helper checks, isolated builds, and diff checks passed; the
final notice-only suffix reused unchanged helper/i18n results. The 644 Go and
nine contract inputs match the previously passing native cohort. The bounded
browser evidence combines an advanced-editor prefix with the final Notes
suffix, including one query returning an unopened imported-description segment
and visible literal-input refusal. Initial driver failures and the repaired
hidden-notice defect remain recorded. The optional shared-tag browser probe is
NOT RUN because its driver stopped before submission; its helper cases passed.
Semantic search was unavailable in the disposable fixture, so real queries
honestly returned DEGRADED. This is not semantic, core-phase, or release
qualification. Local delivery served nine matching final assets without
restarting the owner daemon or changing native binaries or config. See the
[final source freeze](../../dist/product-discovery-functions-20261019/final-source-freeze.json),
[concentrated checks](../../dist/product-discovery-functions-20261019/checks/attempt-04/receipt.json),
[notice suffix](../../dist/product-discovery-functions-20261019/checks/notes-notice-suffix/receipt.json),
[bounded browser evidence](../../dist/product-discovery-functions-20261019/acceptance/aggregate-result.json),
and [local delivery](../../dist/product-discovery-functions-20261019/promotion/result.json).

## Previous storage-report batch — 2026-10-19 (implementation, bounded acceptance, and local delivery passed)

The 13-source Phase 5 report and SavedView-policy batch adds an explicit
`doctor.check` storage projection for retained authenticated snapshot file
references and measured repository/catalog/index paths. The configured index directory may include lexical and vector generations;
the report does not claim a vector-only total.
Categories remain separate; unsupported paths, incomplete history, and unmeasured source,
temporary, or net totals stay unknown rather than becoming zero. Duplicate
reference comparison is not placement-history savings. Focused and broad Go checks and native builds passed with the same 644 Go
sources used by the final candidate. Three Web-only TypeScript, i18n, and Vite
polish checks passed on the final Web candidate.
Tests also refuse four unsupported SavedView policies while preserving existing records.
The first compile failure and later default repo-local index-layout refusal
remain preserved with their narrow fixes. The final candidate pin is
`0bb250fc3c6948919f65fe628ec07000108e4d5baf4c36afe3e86aee8a45346c`.
The final browser evidence combines a passing prefix with corrected function
and presentation continuations, not one all-green run: all eight reported checks pass,
with earlier driver failures and one synthetic unavailable UI-only case retained.
The fixture reported 170 retained reference bytes, 56 unique logical bytes,
114 bytes of duplicate-reference comparison, zero raw compression savings, and
unmeasured net savings.
Local asset promotion served nine matching assets and preserved config, the
20-item content window, 11 filtered hits, and dual READY indexes. The owner's
full storage report and recovery were not run. This is neither Phase 5
qualification nor release evidence. See the [storage report contract](../../dist/product-storage-and-policy-20261019/storage-report-wire-contract.json),
[combined Go/native/Web checks](../../dist/product-storage-and-policy-20261019/checks/attempt-03/receipt.json),
[final Web polish checks](../../dist/product-storage-and-policy-20261019/checks/web-polish-01/attempt-01/receipt.json),
[final candidate pin](../../dist/product-storage-and-policy-20261019/final-candidate-pin.json),
[bounded browser aggregate](../../dist/product-storage-and-policy-20261019/acceptance/aggregate-result.json),
and [local delivery receipt](../../dist/product-storage-and-policy-20261019/promotion/result.json).

## Previous core-function batch — 2026-10-19 complete view-backed export (bounded fixture journey and native delivery passed)

The four-source Phase 4 / legacy SavedView-export maintenance batch separates
deliberately skipped no-query material from actual provider failure for
filter-only discovery, and freezes view-backed exports by walking one pinned
lexical generation to proven exhaustion. Exact live TAG conditions are applied
before membership is accepted; ordinary `view.evaluate` stays bounded. Missing
or changing generations, invalid paging, cancellation, empty views, and an
evaluated subject that no longer resolves in its saved workspace refuse the
whole plan before a manifest is stored. The signed/manifest v1 item binding is
unchanged. Focused regressions and the broad tagged Go suite passed, and the
native daemon/CLI pair built from the same 640-source, nine-contract freeze.
The isolated CLI journey froze and verified all 1,025 matching items (64,575
bytes); every materialized filename, length, and SHA-256 matched its source.
The ordinary recall preview remained bounded at 200. After native-only
delivery and restart, both reported indexes were READY, the same 20 listed
content identities remained, and the Web tree and configuration stayed
unchanged. A read-only filter-only request changed from `DEGRADED` to
`SUCCEEDED` with the same 11 hits and components; semantic was skipped as
`QUERY_TEXT_REQUIRED`, not treated as a provider failure. This is private-fixture
evidence, not full-corpus, model-quality, or release qualification. See the
[source freeze](../../dist/product-complete-retrieval-20261019/source-freeze.json),
[focused and broad Go receipt](../../dist/product-complete-retrieval-20261019/checks-attempt-02/receipt.json),
[native/CLI build receipt](../../dist/product-complete-retrieval-20261019/build/build-receipt.json)
and [root candidate pin](../../dist/product-complete-retrieval-20261019/candidate-pin.json),
[1,025-item runtime receipt](../../dist/product-complete-retrieval-20261019/runtime/attempts/attempt-01/result.json)
and [post-restart read-only receipt](../../dist/product-complete-retrieval-20261019/promotion/post-restart-result.json).

## Previous useful-function batch — 2026-10-19 Photos and selected-list actions (implemented; bounded acceptance and local delivery passed)

The five-source RW-PERSONAL-UX-1 batch reuses Photos results and shared
selection. Ready-state card tags add or remove exact local filters without
changing host query or selection. More actions uses the existing original
route only for regular files with subject, entry and canonical content
identity. Selection keeps count and known size visible; type details expand on
demand, while unavailable items, unknown sizes and unresolved selections stay
explicit. More actions copies selected names or provenance paths as JSON-quoted
lines, preserving duplicate names; missing values disable copying and
clipboard denial is reported without extra reads or mutation. The frozen
candidate passed one TypeScript, i18n, isolated Vite and scoped diff-check
cohort. Retained browser prefixes and a focused photo suffix verify summary
keyboard disclosure, exact clipboard lists, photo-menu keys/focus, a matching
3,117,146-byte original and 390 px layout. The tag chip activates, but all
four fixture photos share that tag, so a count-changing subset remains unrun.
Missing-field and clipboard-denial paths have source review only. Earlier
harness failures remain linked; this is not one all-green full-script run.
Asset-only delivery passed with nine matching HTTP assets and unchanged owner
native/config, indexes and 20 listed identities. No core-phase, release or
complete-domain credit is claimed. See the
[source freeze](../../dist/product-useful-actions-20261019/source-freeze.json)
and [build receipt](../../dist/product-useful-actions-20261019/build/web-candidate-receipt.json),
[bounded browser aggregate](../../dist/product-useful-actions-20261019/acceptance/aggregate.json)
and [delivery receipt](../../dist/product-useful-actions-20261019/promotion/result.json).

## Previous useful-function batch — 2026-10-19 return to the current Music track (implemented; bounded acceptance and local delivery passed)

Music now offers an explicit local-filter reset and focus return when the
exact playing track remains in the host's loaded results but is hidden by
Music filters or group navigation. The action keeps sort, host search, shared
selection, and the verified player. A track outside the host result scope gets
an explanation without a misleading local reset action. The two-source Web
batch passed one TypeScript/i18n/Vite/diff cohort; unchanged Go inputs reuse
the prior successful broad receipt. The retained local journey proves the new
action, focus, photo/Music selection and paused Blob/position continuity; a
separate suffix proves the outside-host state. Driver failures remain linked.
Reversible Web delivery passed with the same native/config and 20 listed
identities, both indexes READY, and all nine current HTTP assets verified.
See the [dated acceptance](../technical/daily-client-functions-acceptance-20261018.md#2026-10-19-music-current-track-return).
This closes the named local affordance only, with no complete-domain or
core/release credit.

## Previous recovery maintenance — 2026-10-19 description history (implemented; bounded acceptance and local delivery passed)

The actual two-root clean-catalog drill found and fixed a description
predecessor insertion-order failure. The SQLite projection now inserts
predecessors before successors without changing signed order or immutable
facts. Focused regression and the broad tagged Go suite passed. The same
retained fixture now imports B then A, replays B without duplication, retains
the complete Note/TAG/Description/segment history across restart, and restores
both exact file versions. The acceptance preserves its driver failures and
compares current protection to the signed `EXACT_FALLBACK` record rather than
inventing `EXACT_PROTECTED`. The separate Store-free reader also restored both
roots without catalog/signing material. Writable catalog reconstruction kept
the original fixture signer. See the
[dated recovery follow-up](../technical/catalog-reconstruction-acceptance-20261016.md#2026-10-19--preserve-description-history-regardless-of-record-order).
The patched native daemon is installed in the local preview; read-only
continuity retained config/CLI/Web and the same 20 listed identities, with
lexical and semantic indexes `READY`. No owner recovery operation ran.
This is bounded maintenance; PC-20 and release gates remain open.

## Previous useful-function batch — 2026-10-19 upload controls (implemented; bounded acceptance and delivery passed)

The four-source intake-maintenance cohort adds real sent-byte progress and
explicit Stop to the existing upload/review/save flow. Stop or an unconfirmed
receipt remains visibly unresolved and cannot automatically prepare or save;
known returned rows survive a later follow-up error. One combined
TypeScript/i18n/isolated-Vite/diff cohort passed. Browser attempt 01 retains a
driver-only decimal-size assertion failure; corrected attempt 02 passed a
16 MiB upload, one explicit save, exact original download, and Stop while a
real accepted receipt was withheld. The local asset-only delivery passed.
Incremental throttled progress, pasted-text Stop, and malformed-receipt browser
cases were not exercised. See the dated daily acceptance; no core or release
gate or complete-domain credit is awarded.

The same frozen candidate now also has focused hidden-row range evidence:
Photos and Music each filter four real fixture items down to two nonadjacent
subjects; Shift-click selects only those displayed subjects, clearing filters
leaves the two hidden subjects unchecked, and cross-domain selection remains.
The first driver queried an unmounted Photos surface; its failure is retained,
and corrected checks reused the same fixture. Runtime identity is bounded by
the recorded launcher/frozen filesystem hashes, without HTTP asset attestation.
See `dist/product-hidden-range-20261019/audit-note.md`. This closes the earlier
filtered-range evidence gap only; no new implementation or core credit follows.

## Previous useful-function batch — 2026-10-19 Library quick-use (build and delivery passed; bounded browser evidence mixed)

The current eight-path RW-PERSONAL-UX-1 UX-M1/C1 candidate adds disclosed
Library row actions and Music queue controls over the existing host. The
combined TypeScript, i18n, isolated Vite, and scoped diff checks passed; the
reversible asset delivery passed. Library row-action/download checks and a
focused Music continuation passed, while the consolidated browser result is
MIXED after a Photos assertion/driver stop. Clipboard-native behavior and the
filtered hidden-row range remain unverified. No core-phase, release, or
complete-domain credit is claimed.

## Previous useful-function batch — 2026-10-19 (implemented; bounded acceptance passed; delivery complete)

RW-PERSONAL-UX-1 UX-P1/M1/C1 combines cold first-upload review, Photos
display-order selection, and Music filters/play-next over the existing host.
The frozen Web candidate passed one tsc/i18n/Vite/diff-check cohort and a
bounded cold/media browser acceptance; the reversible local asset delivery is
complete. Useful changes ship in coherent batches before concentrated client
acceptance, retaining necessary compile/data-safety checks without repeating
unrelated Linux or core matrices. Music partial-range exclusion is still
unverified; this earns no core-phase, release, or complete-domain credit.

Last updated 2026-10-19: bounded exact user-tag SavedView maintenance under
ADR-057 passes focused and broad backend checks, concentrated client checks,
and local delivery. The subsequent current-build fixture journeys exercise
tag-only and keyword/tag save, update, recall and exact materialization,
Photos/Music filters and playback, and Notes-to-Library ZIP takeout. PC-04d is
closed for this bounded maintenance scope; full domains and core/release gates
remain open. See the consolidated continuation in the dated daily acceptance.
The operator reaffirmed implementation in useful parallel batches before
consolidated client acceptance. The preceding batch adds local Photos/Music
tag and selected-item filters, explicit Music play-next composition and
workspace-only Notes return context; its dated record retains the specific
interactions and limits. The current build and bounded Library row-action
checkpoint are recorded below; source/build status is not complete-domain
acceptance. The
preceding function-first continuation connects Notes
associated-file selection to the same Library query and exact ZIP takeout.
The host mixed-search ranking successor is also implemented with bounded
compatibility evidence; existing semantic misses remain. The preceding batch adds Notes tag
filtering, continuous Details inspection and cooperative batch-tag progress/Stop.
The third retained-fixture integrated attempt passes after two preserved
pre-write driver failures; the reviewed Web candidate is served without
changing owner content or native state. Earlier work implemented explicit Music startup, same-original
resume and fenced Stop/replacement behavior after the stable failure-node
continuation. Earlier failed runs remain recorded with their own candidate.
The 2026-10-16 work delivered the bounded daily-client, scoped takeout,
finding/reuse, selected-content use, batch-workflow and Notes-continuation cohorts to the local preview,
following the operator's functionality-first reset; also reaffirmed the
future AI capture/retrieval direction.
The 2026-10-15 cohort records local semantic retrieval and delay improvements,
SavedView navigation and Music-size continuity, and the initial AI direction.
The earlier functionality-first Photos/Music and media/anime cohort remains dated 2026-10-13.
The same-day product-closure breakdown below prioritizes reuse of existing
operations, observed admitted-client friction, and mandatory core gates; it
does not admit new capability or award implementation or qualification credit.
Earlier SP-2 evidence remains dated 2026-10-11: on the real 11,561-item
library, `status.get` changed from 6,892 to 1,437 ms, the shell's restore-point
read from 8,080 to 1,785 ms, and wall load from 21,368 to 7,584 ms after the
kernel stopped walking every publication manifest for a count. Those results,
the earlier 9,138-item measurements and SP-1/saved-view fixes retain their own
candidate identity; this update does not re-qualify their performance.

**Phase 3 fresh-catalog slice (2026-10-16):** implemented and tested for the
bounded development profile, including the isolated lost-catalog CLI journey
and revision-3 re-publication to a Store-free reader. A separate local owner
preview binary update was later verified against the existing catalog and
repository; it did not test owner-catalog loss or reconstruction. See the
[dated acceptance](../technical/catalog-reconstruction-acceptance-20261016.md) and its
separate [promotion evidence](../../dist/product-core-preview-update-20261016/promotion-summary.json).
This does not check off PC-20, qualify keyless daemon recovery or the owner
corpus, or close a release gate.

## Convergence-phase priority order

The project is in a convergence phase (see `AGENTS.md`): close existing gaps
in the admitted core loop and admitted client surfaces before adding scope.
Within this ledger, work in this order:

1. **P0** — concrete user-visible correctness/trust failures in an admitted
   surface. Follow each detailed row's dated evidence. The older summary that
   called unsupported-format playback and the R1.4 client mislabels untested
   or open was stale: their rows record actual fixes and browser verification.
   They must not send implementation back to already-closed defects. R1.4 and
   M4 remain partial only for the residual scope their rows explicitly name.
2. **P1** — the selected daily product loop: simpler intake, productive shared
   library actions, and focused Photos/Music use. The private-drive section
   below sets this client sequence; it changes no core phase order or admission.
   The operator's latest reset puts missing useful operations before another
   appearance round; [ADR-041](../technical/build-stack-and-architecture-selection.md#adr-041-complete-useful-client-operations-before-further-visual-redesign)
   and the [functional target map](../technical/content-first-product-decision.md#functional-target-map--2026-10-13)
   retain the immediate sequence and the separate full-domain dependencies.
3. **P1 validation** — focused evidence for the slice being changed and the
   genuine residual matrix in its row. Existing fixture/harness entries now
   carry later evidence; do not keep treating the earlier stale harness as a
   current blocker or repeatedly run completed matrices without a new reason.
   Cross-context SavedView access and remaining playback failure branches
   retain their explicit limits.
4. **P2** — documentation consistency and backlog grooming alongside the
   implementation that changes evidence. This summary aligns earlier dated
   records; it is not a new run or completion award.
5. **Outside this convergence queue** — new integration scope needs direct
   authorization and its own contract. Runtime third-party loading and a plugin
   store remain explicit non-goals; build/install-time presentation composition
   follows ADR-032's separate boundary.

The [whole-product delivery target](../technical/whole-product-delivery-target.md) carries
the entire-product outcome map and current parallel cohort. This ledger records
individual evidence; completing a row does not complete the whole product.

## Daily-client functionality cohort — 2026-10-16

The operator requested substantial useful functions in parallel with Luna,
then one integrated client check, before further visual redesign or unrelated
recovery qualification. The active product work follows that order within
the admitted client track; the core gates and deferred domain contracts remain
unchanged.

### Function expansion with bounded local evidence — 2026-10-18

The operator requested a larger implementation batch before concentrated
validation. The following cohort is implemented and built. Its bounded
functional evidence is recorded in the
[dated acceptance](../technical/daily-client-functions-acceptance-20261018.md#consolidated-function-expansion);
it does not complete the full domain baselines or any core/release gate:

- Photos: expose the existing verified image viewport directly in the Photos
  viewer, including zoom, pan, fit, actual size and transient rotation. Keep one
  dialog, unchanged byte budgets and the existing original-read path.
- Music: select displayed queue occurrences and remove or move inactive
  selections together, retaining repeated tracks, the current original and
  playback position. The queue remains temporary.
- Notes: optionally group already loaded matching text by its associated file,
  with explicit expansion and the existing Details/selection actions. This is
  another presentation of Notes, not a durable grouping model.
- Overview: select or clear eligible displayed items in one fixed section
  through the host selection, retaining selections elsewhere.
- Phase 4 discovery: refuse a query vector known to be tokenizer-truncated,
  explain the input limitation and retain lexical/structured results and the
  healthy generation for a subsequent short query.

The Web build and focused/native checks pass. Partial integrated browser work
covers Notes groups, Overview selection, exact ZIP members and progress,
standalone/embedded image controls and Music occurrence batch actions. A
focused continuation verifies non-default restore planning over an open player
after fixing the modal stacking defect. Failed driver attempts and the actual
overlay failure remain retained; this is not one clean full-script run.
Prior acceptances retain their own candidate identities. The product goal and
core/release gates remain open; unrelated historical matrices were not rerun.

The same implementation-first continuation now also addresses three ordinary
loop gaps through existing operations:

- Restore: choose a retained restore point by its recorded time/source instead
  of being limited to the shell's latest point. A changed choice invalidates
  the reviewed plan while retaining the destination. This is existing recovery
  adapter ergonomics, not a new restore authority or qualification claim.
- Takeout: show streamed bytes received separately from files/bytes whose
  identities have passed verification. Preserve cancellation, captured-selection
  retry and the original browser ZIP budgets.
- Notes review: edit an explicitly generated candidate before accepting its
  immutable successor. Reuse the existing unsaved-draft guard and bind every
  request/result to its original subject. This uses the existing separately
  configured describe provider; it does not install one or enable generation
  during intake.

Restore selection and terminal takeout progress have the bounded runtime
evidence above. Generated Notes edit/review has source/build review only:
the configured-provider generation/acceptance journey was **NOT RUN** and no
provider was installed or invoked. The final v4 Web candidate is served at
the local preview; native and discovery details retain their separate receipts.
The final native successor also passes real local BGE/zvec short → truncated
long → short default searches on the same generation, after fixing the ONNX
factory's mistaken session invalidation. Admission/fence failures still fail
closed. This is request-isolation evidence, not retrieval-quality qualification.

### Finding and understanding content — 2026-10-18 continuation

The next implementation batch composes existing operations, following
[ADR-056](../technical/build-stack-and-architecture-selection.md#adr-056-compose-notes-finding-with-library-search-and-returned-evidence):

- Explicitly continue a loaded Notes miss or partial-list filter into the one
  Library search, preserving literal text and the current workspace.
- Inspect already returned matching source segments and their present
  provenance in Details, with disclosed six-at-a-time paging and no new reads.
- Label Restore counts as planned output, keeping missing values unknown and
  actual apply/verification outcomes in the existing action bar.
- Correct regular-image consent and enforce image eligibility/decoding in the
  existing describe input boundary before any provider request.

The nine client sources pass build checks. Focused description tests, the broad
tagged Go suite and the native build also pass against the eleven frozen
sources. The combined successor is delivered to the local preview; integrated
client acceptance remains pending and the source batch is not credited as an
end-to-end capability. Real-provider generation
remains separately unqualified.
The previous delivered cohort and all core/release limits remain unchanged.

### Implementation-first daily operations — 2026-10-18

The next parallel Luna batch completes useful operations in the existing
surfaces before adding another acceptance script or visual redesign:

- Photos: combine exact existing user tags and a selected-only filter with the
  current name/format controls, viewer, shared selection and original takeout.
- Music: use the same exact-tag/selected-only composition over loaded tracks
  and recorded artist/album groups; explicitly insert selected or displayed
  eligible tracks next through the existing temporary queue.
- Notes: retain text/source/tag filters, sorting and grouping while navigating
  within the current workspace, without retaining fetched bodies or creating
  another durable record. Changing workspace clears that presentation context.

The combined sources have been reviewed and built. TypeScript, i18n, Vite and
diff checks pass; the retained first attempt caught two duplicate translation
keys, which now reuse the existing catalogs. Twenty-one selected source hashes
and the complete 167-file Web source map remain unchanged during the final
build. See `dist/product-operations-expansion-20261018/checks/attempt-02/`.
No browser matrix or new Go run was performed for this client continuation;
the unchanged backend sources retain the preceding focused/broad Go evidence.
The nine-asset combined Web build is served on local port 4648, alongside the
tested image-egress native successor. Delivery checks preserve all twenty
owner file identities, the persisted configuration and both READY index
projections. Delivery receipts are in the same cohort's `promotion/` folder;
these read-only checks are not client interaction acceptance.

The active track is RW-PERSONAL-UX-1 and its
UX-P1/M2/C1/Q1 refinements. Counts describe loaded distinct subjects; filters
do not issue queries or define persistent albums/playlists. The next client
acceptance should cover the changed journeys together. Existing backend checks
need no repetition for client-only
changes. No historical matrix, OS qualification, model installation, new
backend contract or core-phase award is part of this batch.

### Useful client operations — 2026-10-18 batch

The latest Notes-to-Library cohort is implemented with bounded browser evidence:
five Note rows share two file selections, return to the original query without
another search, and produce a verified two-original ZIP. Current/captured scope
and exact row identity guards preserve the shared selection authority; unsafe
rows remain unavailable. The reviewed nine-asset Web candidate is served with
the same native process and owner data. See the
[functional acceptance and unrun limits](../technical/daily-client-functions-acceptance-20261018.md#notes-to-library-associated-file-takeout).
This adds useful composition rather than another Notes storage/editing system;
visual polish, full domain journeys and core/release gates remain open.

The later function-first organization/inspection cohort reuses existing TAG
facts to filter returned Notes, navigates exact regular-file identities in the
host-loaded Details order, and adds progress/cooperative Stop to existing batch
tag writes. A real held-response run confirms one of three writes settled and
two remained unstarted, then Notes filtering, draft-guarded inspection and exact
original takeout pass. The local preview serves the same reviewed candidate.
See the [bounded acceptance and unrun branches](../technical/daily-client-functions-acceptance-20261018.md#function-first-organization-and-inspection-cohort).
Implement useful connected operations in batches, then validate the batch;
do not reopen unrelated completed matrices. This does not award a core gate.


The same day's structured-search continuation exposes existing size ranges,
exclusive UTC modification-date bounds and recorded protection filters, plus
explicit condition removal. A real typed query and revision-1 SavedView retain
all five conditions; a resumed browser download matches the recalled original's
253 bytes and SHA-256. The dated evidence distinguishes preserved driver
failures, partial integrated flow and successful read/recall/download resume.
The reviewed Web candidate is served with unchanged owner content and native
process. See the [continuation and limits](../technical/daily-client-functions-acceptance-20261018.md#structured-search-controls-continuation).

The eight-file Photos/Music/Notes batch adds a five-item adjacent thumbnail
strip, current-Blob seek/speed/mute controls, and literal loaded-Note find with
highlight navigation. Parent-reviewed source, one integrated real fixture
journey, build/i18n, captured-exit tagged Go and diff checks pass. The same Web
candidate is served on the local preview with unchanged owner content,
configuration and native process. See the [dated scope and evidence](../technical/daily-client-functions-acceptance-20261018.md).
The included SavedView/history read-order correction is source/build-reviewed;
its delayed-response case was not part of the feature run. Full domain and
core/release gates remain open; this batch does not implement persistent
albums/playlists or add backend capabilities.

### Music startup and cancellation — bounded implementation

The four-file 2026-10-17 client cohort distinguishes verified-byte loading
from native playback startup. One hook-local native-play helper handles initial
play, resume and repeat restart. Its transient attempt identity, generation,
workspace and assigned Blob URL fence both settlement and queued state updates.
Stop, replacement and cleanup invalidate the attempt and URL before releasing
media; gesture refusal retains the verified original for an explicit retry.
The visible client shows Starting audio while acknowledgment is pending,
disables duplicate start/seek actions, and keeps Stop and replacement reachable.
The queue calls a paused/loading/failed active occurrence Current track and
uses Now playing only for acknowledged playback. No byte budgets, durable
records, endpoints or recovery authority change.

One focused run passes in English and Chinese: a real renamed non-audio
original fails with a readable localized message and the same stable live
node; real WAV playback reaches decoded, unpaused media and Pause controls;
pause/resume retains the same Blob with no additional original GET. Labeled
controlled cases delay only delivery of the browser's actually fulfilled
native play promise. They confirm the pending controls and that late results
after Stop or A-to-B replacement cannot resurrect A or clear B's pending state.
These are controlled acknowledgment cases, not browser-latency measurements.
Native repeat, gesture refusal and workspace/unmount races are source-reviewed
but **NOT RUN** in this browser cohort; the remaining Music matrix stays open.

The prior Chinese WAV observation prompted this implementation and a stronger
decoded-playback waiter; the old candidate's failed receipts are retained.
TypeScript, Vite, i18n, one focused browser run, one broad tagged Go run and
diff checks pass. Root reviewed the full source/harness deltas and checkpoint
logs, then promoted matching static assets without restarting the owner daemon
or changing its configuration or 20-item listing. Temporary harness profiles
are removed. Evidence:
`dist/product-playback-start-20261017/acceptance-summary.json`.
This is implemented for the stated local client scope, with no full-domain,
core-phase or release completion claim.

### Stable Music failure announcements — bounded implementation

The 2026-10-16/17 M4 continuation pre-mounts one empty polite, atomic status
node outside the hideable global player. Localized errors and queue notices
reuse the visible text; ordinary loading/ready/playing text stays outside the
live region. The first candidate placed the node inside the idle player's
hidden ancestor; root caught this before browser acceptance and retained that
candidate before accepting the corrected sibling placement. Playback state,
queue authority, byte limits and existing error/fallback actions are unchanged.

Both English and Chinese actual invalid-original journeys confirm the same
connected node from idle through queue setup and decode failure, readable
matching error text, retained attempted identity and queue, and independent
decoder rejection of the exact downloaded original. These changed-feature
checkpoints pass; real assistive-technology delivery is not qualified. The
initial runner fails on an obsolete queue selector. Its corrected run still
ends **FAIL** at the Chinese WAV control: the element reports `paused: false`,
`readyState: 1`, and time zero while the toggle still says Play. English WAV
has `readyState: 4` and Pause. The Chinese observation remains unresolved;
there is no blanket player or full-run pass at that candidate, and no third
browser run was made for it. The startup continuation above has separate
current-source evidence; it does not rewrite these failed runs.

TypeScript, Vite, i18n, diff checks and the broad tagged Go run exit 0.
Root reviewed source/harness deltas and checkpoint logs and promoted only the
matching static assets to the local preview. The owner daemon, configuration
and 20-item listing are unchanged; temporary harness profiles are cleaned up.
Evidence: `dist/product-player-announcement-20261016/acceptance-summary.json`.
This resolves M4's conditional-live-node structure for the stated local scope,
not the remaining playback failure matrix or a core/release gate.

### Tag edits and browsing disclosures — bounded implementation

The six-source client continuation keeps a tag edit inside its current host
scope. Removing the last occurrence of a selected tag removes that condition
only after a ready, workspace-matched vocabulary refresh; it no longer replaces
source/search rows with the global library or clears selection. Follow-up
responses also check the current Details subject and workspace after each
await, and update the current tag set functionally. An unavailable vocabulary
keeps the filter and its warning instead of being interpreted as an empty set.

Actual fixture evidence restores the same three source files after deletion.
A held real successful tag-list response after search-tag deletion cannot
replace a newer Photo filter, selected subject or unsaved Notes draft. The
original combined browser runner then fails on a harness interaction with
Details still open; that failure is retained. A separate controlled-503
continuation retains the search/tag warning, retries the actual successful
read, and explicitly clears the filter back to the same three search results.
This is checkpoint/continuation evidence, not an uninterrupted full-matrix pass.

Date browsing now explains missing dates, including a nonempty result scope
with none recorded. Date and Space report disclosures open exclusively.
The source's real recorded month and no-date search are exercised; mixed-date
coverage uses a labeled read-only response omission, not a changed corpus.
TypeScript, Vite, i18n, diff checks and the broad tagged Go run all exit 0.
Root reviewed the six deltas, receipts and screenshots, then promoted only
matching static assets to the local preview without restarting its daemon or
changing its 20-item listing. The isolated fixture is stopped and its prior
data retained. See
`dist/product-tag-continuity-20261016/acceptance-summary.json`.
This is implemented for the stated client scope and closes no core/release gate.

### Scope-consistent browsing statistics — bounded implementation

The next five-source client batch addresses the preceding source-count gap.
System facets and tag counts use the current returned/source scope and its
selected presentation. All tags counts the facet/month subset before user tags;
the timeline retains the facet/tag subset before the selected month. Space
report uses the displayed rows and labels missing sizes as a partial known-size
sum. Existing Browse tools now work in source/search contexts, and an obsolete
CSS rule no longer hides the media pages' Space report.

`namespace.list` has no captured-time field. The client can reuse a recorded
`content.list` time only from the current authorized loaded generation: one
unique entry ID, identical subject, regular-file kind, canonical SHA-256 and
known safe length. Missing, duplicate or conflicting rows remain unknown.
Only the display time is copied, after existing response/context guards; no
extra read or recovery authority is added. Already supplied times are retained.

Focused evidence combines retained checkpoints with the final candidate:
source format counts PNG/TXT/WAV each 1, All tags 3, format/clear continuity,
October selection/clear over the same three files, and visible Photos/Music/
All-types space sums of 3,068 / 48,044 / 51,365 bytes. The Notes search returns
one row and only the TXT format facet. Its month control is **NOT RUN**, since
the returned hit carries no date; multi-month switching and the unknown-size
UI branch are not independently exercised. Strict time projection passes one
positive, thirteen refusal cases and an existing-time preservation case.

Final TypeScript, Vite, i18n and diff checks pass. Initial harness failures,
missing-time/hidden-tool findings and a repaired type error remain recorded.
The one broad Go run emits passing/cached package results, but its wrapper
failed while recording the exit code; no numeric Go-pass claim is made.
Only matching static assets were promoted to `http://127.0.0.1:4648/`, retaining
the daemon, configuration, schema 27 and 20 owner items. The fixture process is
stopped and its prior data preserved. Evidence is under
`dist/product-scope-projections-20261016/acceptance-summary.json`.
This closes the stated local display gap, not a core, full-domain or release
gate. The separately observed last-active-tag deletion scope reset is addressed
by the bounded continuation above; the earlier receipt keeps its own limits.

### Shared retrieval, source continuity and takeout — bounded implementation

The next 10-source client batch replaces the export drawer's query-only save
with the same reviewed editor and supported-condition candidate as Library.
Filter-only saving, explicit same-name review and the saved scope now follow
one path. A real held save disabled source changes; its saved view was then
updated from WAV to TXT at the same ID, revision 1→2. Cancel made no view
request, and the frozen export matched all three actual TXT results. Initial
harness count/disclosure failures are retained; acceptance resumes from the
existing saved record rather than claiming an uninterrupted passing runner.

A real three-file source remains scoped through Photos, Music, All types and
local format filtering, retaining selection, unsaved Notes and verified WAV
playback. Explicit All content exits through the sidebar or Music's Library
tools return to the full listing; the sidebar draft exit prompts once.
One observed rough edge remains queued: system-facet and All-tags/date
projections can still describe the loaded global listing rather than this
source. Filtering membership itself is scoped correctly.

An actual completed export whose browser acknowledgement was intentionally
dropped is reconciled by verifying the same frozen manifest and destination,
with one apply only. Its 75,670-byte output matches the manifest SHA-256.
History restores its recorded target; changing the verification directory
invalidates the old displayed success without replanning the frozen unit.

TypeScript, Vite, i18n and diff checks pass. The one broad tagged Go run emits
only passing/cached or no-test package results; its numeric exit code was not
captured. Parent review covers source diffs, screenshots and output bytes.
Only static assets were promoted to `http://127.0.0.1:4648/`; HTTP assets match
the candidate, with the same daemon, config, schema 27 and 20 owner items.
The isolated fixture process is stopped; its reused prior data is preserved.
Evidence: `dist/product-retrieval-takeout-20261016/acceptance-summary.json`.
No full-domain, core-phase or release gate closes from this batch.

### Retained work and direct save handoff — bounded implementation

The next batch completes related operations before integration: supported
filter-only searches can be saved without dummy keyword text; saved-view list
search includes stored conditions; the daily retrieval panel explicitly reviews
same-name updates and preserves unrelated saved policy fields. Cancelling that
review makes no request. The existing export drawer's separate legacy
query-only save path is unchanged.

After a confirmed save, **View saved source** opens the existing source namespace
instead of returning to the first library page. This is a provenance view, not
a persistent group or a frozen export. Missing source identity has an explicit
All-content fallback. Namespace navigation rejects stale context and changed
drafts; an unchanged draft that the owner agreed to discard no longer blocks
navigation. Notes saves/deletes also retain unrelated editors and newer text.

All 14 changed source identities match the final TypeScript/Vite/i18n build;
focused and broad tagged Go checks pass, including cached packages. Actual
SavedView evidence covers two filter-only saves, local condition lookup,
cancel, a same-ID revision 2→3 update with retained policy, refresh/recall and
a one-item frozen export. Earlier harness failures are retained; the final
resumed chain passes and is not called one uninterrupted passing run. A separate
Notes run passes real mutation/held-response draft checks.

The intake run preserves 205 old files, then explicitly uploads/saves two
44-byte files. Neither is in the first 200 of 215 library entries; the new
handoff displays exactly those two source members and supports selection.
Notes/Tags are visible. The runner then fails on a wrong tag-input accessible
name. A continuation verifies both originals through the existing download GET
with matching SHA-256 and length; browser-native download and same-session
return to All content remain **NOT PROVEN** for this run. Navigation failure
and late-response branches are source-reviewed, not a new injected matrix.

The matching daemon and Web assets are served at `http://127.0.0.1:4648/`.
Promotion retains the owner configuration, schema 27, all 20 listed identities
and both existing lexical/real BGE+zvec generations. Evidence is under
`dist/product-retained-work-20261016/`. This adds no schema, endpoint,
processor or portable format and closes no full-domain, core-phase or release
gate.

### Notes continuation — implemented, bounded acceptance

The existing Notes surface initially reads at most 200 description summaries.
When that response is partial, the operator can explicitly request up to the
existing 1,000-record limit. Refresh retains the chosen limit. Expansion reads
only summaries; bodies remain lazy and no durable record is created. A failed
expansion retains the prior records and offers retry; a still-partial response
at 1,000 keeps its visible limit. Malformed and degraded responses preserve
the previous list in the reviewed code.

The isolated client journey verifies a controlled 200-row prefix, an injected
503 with retained records, and retry to a controlled 1,000-row list. One actual
backend description was placed at API item 201; its body, source Details and
253-byte original download were real backend reads. Parent comparison confirms
the downloaded file equals the fixture source byte for byte. An in-flight
body read completes across expansion without a duplicate request. This is
not evidence of 201 durable descriptions or a complete large catalog.

TypeScript, isolated Vite, i18n and diff checks passed; 390px layout has no
horizontal overflow. The final browser process exited 1 in a separate
controlled workspace-switch branch: the new marker was not observed and
three 422 responses followed. That branch remains **NOT PROVEN**, with its
guards source-reviewed; do not describe the whole browser harness as passing.
Earlier startup/navigation/locale-selector failures remain recorded. Malformed
and degraded-list branches were not independently injected in this acceptance.

Parent review covered both screenshots, both changed source identities and
the original bytes. Only static assets were promoted to
`http://127.0.0.1:4648/`; HTTP index/JS/CSS match the candidate and typed
`status.get` succeeds. The existing owner backend accepts the 1,000 limit but
returned zero description records, so it adds no large-catalog evidence. Its
process and binary were not changed. Evidence is under
`dist/product-notes-continuation-20261016/`, including
`notes-final-receipt.json`, `notes-result-attempt5.json`,
`final-build-identity.json`, `preview-promotion.json` and `fixture-stop.json`.
The isolated fixture was stopped and removed. No core phase, full Notes
baseline or release gate closes from this client slice.

### Batch-first workflow continuation — implemented, bounded acceptance

The operator reaffirmed implementation before repeated validation. The next
client batch combines three ordinary operations: continue adding after a
confirmed successful save; explicitly apply several user-entered tags to one
captured selection; and retain Photos/Music browsing conditions while moving
between presentations of the same host result scope. Luna implements the
disjoint slices, followed by parent integration review and focused batch
acceptance. These are existing-client compositions, not new domain stores,
media surfaces or extension mechanisms.

- **Continue adding:** two real uploads were reviewed and explicitly saved
  in the same drawer. Continue clears only the completed transient association
  and focuses the picker. Pending confirmation has no continuation entry.
  Downloads match both inputs exactly (66 and 79 bytes). UNKNOWN was not
  injected; its refusal is source-reviewed. An initial multipart-parser harness
  failure is retained separately from the successful original-byte follow-up.
- **Several tags per selection:** two exact strings, including Chinese,
  spaces and a comma, were applied to two actual audio subjects. Reapplication
  added no duplicate records; removing one tag retained the other. The selected
  ZIP contains only those originals with matching complete SHA-256 and length.
  Notes were empty before and after, so this does not prove a nonempty Note
  journey. A controlled, unforwarded DEGRADED response stopped later writes;
  it is not evidence of an actual backend failure.
- **Browse continuity:** Photos query/format/density and Music query/group/
  mode/sort/availability survive presentation changes within the host scope.
  A new global query resets these display choices without remounting the
  player: its DOM node, verified Blob, paused position and pause state remain
  identical. Returning to an album while its actual fact response is delayed
  now shows loading rather than an invented unknown album, zero count or empty
  result; it then restores the recorded two-track group. Existing 390px checks
  passed before that narrow loading correction. The final candidate separately
  passes loading, global-scope reset, player continuity and asset matching.

Final TypeScript, isolated Vite, i18n and diff checks passed. Parent review
covered the diff, screenshots, all 14 final source identities and independent
ZIP byte verification. The final static bundle is served at
`http://127.0.0.1:4648/`; HTTP assets match and typed `status.get` succeeds.
The owner daemon and catalog were not changed by promotion. Evidence is under
`dist/product-workflow-features-20261016/`, particularly
`intake-final-receipt-20261016-r1.json`, `tags-result.json`,
`browse-pre-search-scope-locator.json`, `browse-final-result.json`,
`final-assets.json` and `preview-promotion.json`. Earlier selector failures
remain recorded. The isolated fixture lacks semantic assets and retains its
honest coverage-degraded search notice. Full Go/release matrices were not rerun
for this client-only batch under the operator's batch-first instruction.
The separate fresh-catalog recovery work remains unpromoted; this batch closes
no core phase, full media-domain baseline or release gate.

- **Photos implemented and checked:** loaded-name/tag filtering and clearable
  empty results; adjacent-photo navigation; explicit slideshow with interval,
  pause and end/hidden-page exits; direct original takeout. Real retained
  images exercised navigation, SHA/length-matched download and 390px layout.
  The integrated check also found and fixed nested-viewer stacking and return
  focus; the final candidate rechecked both, including pause on enlargement.
- **Music implemented and checked:** artist/album group play, shuffle and queue
  append through the shared player; fact-based group headings and known/missing
  duration summaries; track-to-group navigation; selected/displayed shuffle;
  zero-match exits and keyboard return focus. Existing retained QA audio and
  recorded facts exercised these actions and the 390px layout. This is not
  persisted playlist/album support or a complete music metadata corpus.
- **Text preview implemented and checked:** local find, match navigation,
  wrapping, exact loaded-text copying and visible clipboard refusal. Two
  retained text files matched their verified read bytes; switching content
  cleared old search state. The existing 64 KiB ceiling remains unchanged.
- **Clipboard-file intake implemented; controlled wiring checked:** pasting a
  copied image/file into Add reuses upload, complete identity reporting and
  plan review. Text fields keep ordinary paste. The controlled check proved
  multipart bytes, no duplicate busy upload and no implicit apply; a real
  clipboard-file upload through confirmed saving was **NOT RUN** for this
  candidate. The finding/reuse successor below supplies real-backend browser
  File-event evidence; operating-system clipboard transfer remains untested.

TypeScript, the isolated Vite build, i18n and diff checks passed. The final
bundle was installed at `http://127.0.0.1:4648/` without changing the daemon or
owner catalog. Local evidence is under
`dist/product-daily-features-20261016/`: `photos-v2-receipt.json`,
`music-result.json`, `text-result.json`, and `preview-promotion.json`.
The text receipt distinguishes proxy-only 403s and controlled fake-scope 422s
from the successful real text flow. Full Go/release regression was not rerun
for this client-only cohort under the operator's batch-first instruction;
previous recovery work remains outside this preview promotion. This entry
does not close a core phase, a full domain baseline, or release qualification.

- **Browse-position continuation — bounded UX-C1/D1 acceptance:** on the final
  candidate, opening Details for item 57 in both the Photos and Music long
  lists placed the title and Back control inside the viewport. Returning and
  switching between the two presentations restored the same subject with the
  scripted scroll-offset difference below 10 px. The Music audio element,
  Blob URL, paused state and playback time were identical before and after.
  At 390 px, the Photos Details open/close journey stayed within the viewport
  width. The matching static bundle is now served from the local preview at
  `http://127.0.0.1:4648/`; HTTP assets match, typed status is SUCCEEDED, and
  owner PID/config/backend/catalog remain unchanged. This covers those
  Photos/Music paths only; it does not prove every Library/Overview shell,
  10k-item wall, workspace switch or new-query matrix. The first browser
  receipt and intermediate failed/mismatched candidates are retained in
  `dist/product-browse-position-20261016/`; see its `acceptance-summary.json`
  for exact classifications and promotion identity.

- **Late small-thumbnail visibility — bounded UX-P1/P2 client acceptance, 2026-10-16:** in an isolated controlled fixture with 72 unique generated PNGs across 76 photo positions, the initial wall mounted positions [0,48). The observed initial 48 `content.open` calls are a run measurement, not a cumulative navigation cap. After scrolling, the later `Visible-Thumb-057.png` at result index 60 decoded with intrinsic dimensions of 96×64; `Visible-Thumb-072.png` remained unread while offscreen. Its 3,112-byte original download matched the verified SHA-256, and both handles opened for the target were closed on leaving. This routes later ≤1 MiB tiles through the existing `ContentPreview`; it does not change the 1 MiB limit or the separate >1 MiB rendition path. IO-absent behavior is source-reviewed only. This fixture is not a personal photo corpus or complete Photos acceptance; 10k-item, workspace-staleness, real-album and full large-image matrices were not run. The matching static candidate is now served at `http://127.0.0.1:4648/`; typed status succeeded and the owner daemon/config were unchanged. Evidence and retained attempt classifications are in `dist/product-visible-thumbnails-20261016/acceptance-summary.json`.

- [x] **Details hierarchy — bounded PNG acceptance:** title/actions and Preview now precede secondary facts in both DOM and flex presentation. File information is a native disclosure; its unavailable/loading/empty summaries remain visible. The current candidate opens the sorted Small PNG's own Details, starts with facts closed, expands on request, and has no horizontal overflow at 390 px. Music-specific runtime ordering and failure-state injection were not rerun. See `dist/product-functional-batch-20261016/final-acceptance.json` and the parent source review; no new field or domain behavior is admitted.

### Functional batch continuation — 2026-10-16, implemented with focused acceptance

Following the operator's instruction to implement useful features together
before concentrated validation, Luna implemented these disjoint client slices:

- Library: let later small-image tiles use the existing visibility-gated
  thumbnail path, preserving its 1 MiB ceiling and original row mapping.
- Photos: sort the currently loaded matches by name or known size inside the
  existing view-options disclosure; retain host order as the default and keep
  unknown sizes last. This does not create a capture-date or album fact.
- Notes: sort loaded records by their recorded update time; fold long text
  locally while keeping the complete original body available for copying.
- Details: put title/actions and Preview before secondary facts; disclose
  existing file facts explicitly and retain unavailable states in the summary.

The final candidate passes TypeScript, isolated Vite and the existing complete
i18n check. Four real fixture images exercise name/size ordering and the sorted
Details target. Two actual Note annotations exercise recorded-time ordering,
1634-character full-body expansion/copy, and safe handling of a URL crossing the
1000-character preview boundary. Photos options, Details and expanded Notes
remain within a 390 px viewport. These are focused client checks, not a complete
domain matrix. The Library post-48 visibility path is implemented and
source-reviewed; its runtime continuation, missing-size ordering and IO-absent
branches are **NOT RUN** in this batch.

Parent review covered source deltas, screenshots and matching source/served
asset identities. The static candidate is now at `http://127.0.0.1:4648/`;
typed status succeeds with the same owner daemon and config. All 635 native
source/module hashes match the retained broad-Go cohort, so no native/release
matrix was repeated. Receipts are under
`dist/product-functional-batch-20261016/`, especially `final-acceptance.json`,
`parent-source-review.json`, `parent-native-source-reuse.json` and
`preview-promotion.json`. The initial combined harness's hidden-rail navigation
failure remains recorded; the remaining Notes actions passed via the actual
TopBar entry. This closes no core phase, full media-domain or release gate.

### Continuation actions — 2026-10-16, implemented with bounded acceptance

The next client batch closes three observed interruptions in existing actions:
Notes is absent from the existing hash writer/parser and cannot survive a page
reload; Photos delegates keyboard movement to host order even after local
filtering/sorting; failed or cancelled browser ZIP attempts require the user to
reconstruct their original selection.

The admitted implementation reuses the host route, the current visible photo
sequence with original subject/index mappings, and an explicit retry of a
captured preflight-valid takeout attempt. Retry makes a new frozen manifest and
rechecks its exact identities; it is not transfer resumption, automatic retry,
or substitution from the later selection. No schema, endpoint, processor,
index, durable queue or new domain is added.

- **Notes:** entering the existing page now writes `#v=notes`, and reload
  restores it. The first browser run exposed a real startup race: passive
  listing completion could replace already-restored Notes with Library.
  The existing success/failure guards now preserve Notes while filling the
  listing; explicit All content still follows its original path. A final
  reload with the first observed content-list request delayed by 1200 ms
  retains the same workspace, hash and real Note body. Listing-error behavior
  is source-reviewed, not separately fault-injected.
- **Photos:** Arrow/Home/End follows the displayed filtered/sorted sequence,
  Space selects the original mapped subject once without opening the viewer,
  and Enter opens that photo. A three-PNG subset sorted by descending size
  exercised desktop and 390 px navigation. The unchanged Photos source was
  checked on the pre-Notes-guard candidate; it was not rerun after that separate
  host Notes fix. Virtual-window crossings and a complete control matrix
  remain unrun.
- **ZIP:** an unforwarded controlled first-download 503 produces no archive.
  After the UI selection changes to Wide PNG alone, explicit Retry still
  plans the original Small PNG and TXT subjects. The final actual ZIP has
  exactly those two entries and 3321 payload bytes; parent extraction matches
  their complete SHA-256 identities and lengths. This proves the tested
  explicit retry, not a real storage outage, transfer resumption, cancellation
  retry, workspace switching or a full budget matrix.

Final TypeScript, Vite, i18n and whitespace checks pass. The owner preview at
`http://127.0.0.1:4648/` serves the matching final assets with successful typed
status and unchanged daemon/config. The native source set is unchanged, so
the prior captured-exit broad Go evidence is reused. Source reviews, raw
receipts, the retained initial Notes failure and the independent ZIP review
are in `dist/product-continuation-actions-20261016/`; see
`notes-route-fix/final-build-result.json`, `takeout-retry-final.json`,
`parent-source-review.json`, `parent-zip-review.json` and
`preview-promotion.json`. The initial browser trace and a separate harness
422 remain distinguishable from the final focused results. No core phase,
full domain or release gate closes from this batch.

### Existing-use recovery — 2026-10-16, implemented with bounded acceptance

This client batch closes three observed interruptions without adding another
surface or durable model:

- **Current audio retry:** the global player's Current track disclosure can
  explicitly retry a failed original with no verified URL, using the existing
  verified download path and retained queue occurrence. An isolated WAV journey
  receives a controlled unforwarded 503, navigates from Music to Photos, retries
  the same entry and plays a verified 48,044-byte Blob. Parent hashing matches
  the full Blob to its recorded identity. The same queue DOM node remains
  active, and the failed-state action fits a 390 px viewport. Existing verified
  permission failures keep ordinary Play rather than downloading again.
- **Single Notes body retry:** one failed description body can be explicitly
  reread with the existing document/subject/revision and stale-read guards.
  Hide/Show does not silently retry. Two actual description records prove one
  cached body is not reread while the other recovers from a controlled
  unforwarded 503; the filter, source, sort and row order remain unchanged.
  Parent reads independently match both stored bodies and identities. The
  original runner exits 1 only because it treats the expected 503 console
  message as unexpected; its product assertions pass. The raw failure and
  separate classification remain retained; it was not rerun for a green exit.
- **Pending accepted upload:** a known accepted staging batch blocks another
  picker/drop/clipboard/text-file upload until its existing review is resolved.
  Clearing an unuploaded literal-text draft preserves that file batch's receipt,
  refusals and review action. A controlled two-file response forwards the first
  file only and labels the second refusal as synthetic; explicit review/save,
  Continue adding and a real second upload/save then succeed. Parent comparison
  matches both original downloads to the actual uploaded files: 52 + 53 bytes.
  This proves the composition, not a real backend refusal or OS clipboard use.

TypeScript, isolated Vite, i18n and whitespace checks pass for all six changed
client files. Earlier Music/intake selector and runner failures remain in the
evidence; they did not require product changes after the build freeze. The
matching static assets are served at `http://127.0.0.1:4648/` with successful
typed status and unchanged owner daemon/config. The 635 native source/module
files match the retained broad Go cohort, so it is reused rather than rerun.
Evidence is under `dist/product-use-continuation-20261016/`, especially the
three `parent-*-review.json` records, `notes-retry-classification.json`,
`build-result.json` and `preview-promotion.json`. Cancellation/workspace races,
all-refused intake, full media/client matrices and release qualification were
not rerun. This batch closes no core phase or complete domain baseline.

### Discovery and listening continuation — 2026-10-16, implemented with bounded acceptance

This batch adds three operations to existing client surfaces:

- **Continue keyword results:** ordinary search keeps the host's fused query.
  An explicit keyword-view action captures the submitted query and conditions,
  explains that it replaces the displayed results, and selects the existing
  `lexical-metadata-fts` lane. Each further action requests at most 200 results
  with the server's opaque continuation token. Complete, more available,
  unavailable and unconfirmed completeness remain distinct. No automatic
  all-page fetch or fused/semantic completeness claim is added.
- **Load more library content from Music:** an explicit action in the existing
  listing-progress line advances the shared loaded scope. The isolated journey
  reaches all 421 entries and six music rows through two further pages. The
  current audio node, verified Blob, paused position and queue occurrence remain
  identical, with no extra original download.
- **Find recorded albums in the queue:** subject-matched existing album facts
  accompany transient tracks and participate in queue filtering. Real A/B/A
  occurrences retain their positions when filtered; clearing restores the
  original order. Missing album metadata keeps its existing filename fallback.
  Parent hashing matches the actual 12,899-byte playing Blob to its source.
  This does not create album membership or a persistent playlist.

The final candidate's real keyword pages return 200 + 200 + 10 matches, ending
in `COMPLETE`; parent inspection matches all 410 ordered names and unique
subjects to the retained corpus, and verifies each request token against its
preceding response. Screenshots cover 1280 and 390 px. The isolated fixture has
no semantic assets: its ordinary fused search honestly reports `DEGRADED` and
`BOUNDED_UNKNOWN`. This is lexical paging evidence, not semantic qualification.

TypeScript, isolated Vite, i18n and whitespace checks pass. The reviewed eight
client source identities match the served static candidate at
`http://127.0.0.1:4648/`; typed status succeeds with unchanged owner daemon and
configuration. The retained broad Go result is reused for the same 635 native
source/module files. Earlier harness failures remain retained. Album and final
listing evidence come from separate contexts; metadata rereads are not claimed
absent. Selection/Details drafts across search append, late-result takeout,
controlled cursor refusal, stale responses after a newer query and workspace
races were not accepted by this batch. No complete domain, core phase or
release gate closes. Evidence is under
`dist/product-discovery-listening-20261016/`, particularly
`parent-search-review.json`, `parent-music-review.json`, `build-receipt.json`
and `preview-promotion.json`.

- [x] **Preserve an unsubmitted search draft during initial library loading —
  bounded acceptance, 2026-10-16.** Background listing completion now retains
  the search field; explicit All content/reload still clears it. One actual
  initial eight-file response is held while `Tone` is entered, then released:
  the populated list and submittable draft coexist. Closing/reopening the
  disclosure at 390 px retains that draft. Submitting it finds three real WAVs;
  the sidebar All content action issues a real reload and clears the query.
- [x] **Continue a pure typed-filter search — bounded acceptance, 2026-10-16.**
  Existing supported server filters can enter the same explicit pageable lane
  without a text term. An actual `suffix:wav` default query and subsequent
  canonical lexical page retain empty text and the same suffix filter, returning
  three WAVs with `COMPLETE` and rowid order. Neutral matching-result copy
  explains the view change; semantic-exclusion text appears after switching.

These two follow-ups share one reviewed four-file client build and one browser
journey under `dist/product-search-continuity-20261016/`. The final static
candidate is served at `http://127.0.0.1:4648/`, with matching HTTP assets,
successful typed status and unchanged owner daemon/configuration. TypeScript,
Vite, i18n and whitespace checks pass; unchanged native sources reuse the
retained Go cohort. The isolated fixture's default searches remain honestly
`DEGRADED` with semantic unavailable. Filter-only multi-page chains, workspace
races, cursor/error injection and full domain/release matrices were not rerun;
this closes only the two evidenced client gaps. See `parent-runtime-review.json`,
`build-receipt.json` and `preview-promotion.json` for their scope and identity.

### Direct-use shortcuts — 2026-10-16, implemented with bounded acceptance

- **One selected original:** one resolved regular file with a canonical
  identity has a direct original-download action in the shared selection bar.
  It uses the existing browser-owned download stream. ZIP remains a separate
  action with unchanged identity/size budgets. The actual browser download of
  `Cairn-Notes.txt` matches its source and catalog identity: 253 bytes and the
  complete SHA-256, with no `export.plan`. Two selected files hide the single
  action and retain ZIP. Unknown/large sizes and invalid/busy states are
  source-reviewed only in this batch.
- **Move an existing occurrence next:** the single queue editor can put an
  existing occurrence immediately after the active one without inserting a
  duplicate or starting playback. Real A/B/A/C becomes A/A/B/C using the same
  four DOM occurrence nodes. The active first A, verified 48,044-byte Blob,
  audio node, paused time and original-read count remain unchanged. The current
  occurrence's shortcut is disabled; the 390 px queue fits the viewport.

The original combined runner retains its FAIL: it required an attachment event
from Page request/response observation after the real native download had
already succeeded. Saved source/download bytes and their live catalog tuple
were independently verified. A separate context supplies the two-selection
and Music evidence; this is composite acceptance. Manual Next changed the
current DOM to the distinct second A, but its completed playback was not proved
by this receipt. No extra Next run was started for a green matrix.

TypeScript, Vite, i18n and whitespace checks pass for the six reviewed client
files. Their matching static candidate is served at `http://127.0.0.1:4648/`
with successful typed status and unchanged owner daemon/configuration. Native
sources remain identical to the retained Go cohort. Evidence is under
`dist/product-direct-use-20261016/`, including `parent-runtime-review.json`,
the retained `direct-use-result.json`, `music-result.json`, saved original/Blob
bytes, `build-receipt.json` and `preview-promotion.json`. Idle/unqueued-current
reordering, full media domains and core/release qualification remain outside
this acceptance.

## Scoped selection and takeout cohort — 2026-10-16

Implemented and checked within UX-C1/T1: Photos can add, invert or clear the
current name/tag/format match set and download either that set or its selected
intersection. Music supplies equivalent current-track actions, artist/album
group selection and ZIP takeout, and direct single-original download from its
track menu. These actions preserve selected subjects outside their local
scope. Cmd/Ctrl+A uses the same local scope. Generic host-wide selection
shortcuts are hidden on these two pages so they cannot silently select items
excluded by a page-local filter.

The shared selection bar now reports file/folder/other counts, known selected
file size and unknown-size counts, with a visible unavailable total on safe
integer overflow. Library retains its ordinary all-results selection and gains
current-results inversion. The implementation reuses stable loaded subjects,
the host-owned selection, existing frozen ExportManifest and original ZIP
takeout; it does not create persistent media organization.

One isolated local daemon ingested six copied QA originals (592,163 bytes),
whose source lengths and SHA-256 were checked before ingest. Actual browser
actions produced five ZIP archives (photo match/selected and music
selected/artist/album) plus one single audio download. Every extracted member
matched the expected filename, full length and SHA-256; scope-excluded media
did not enter the ZIPs. Hidden-selection retention, local keyboard selection,
busy/empty exits and 390px layouts passed. Unknown-size and overflow display
branches used explicitly controlled responses. The apparent Library checkbox
pointer failure was resolved by hovering the row before an ordinary click;
no CSS fix was required. One photo request-aborted event is retained in the
receipt despite both complete verified archives.

TypeScript, isolated Vite, i18n and diff checks passed. The reviewed bundle was
installed at `http://127.0.0.1:4648/`; the owner's daemon and catalog were left
unchanged, and the temporary fixture daemon was stopped. Evidence is under
`dist/product-takeout-features-20261016/`: `photo-result.json`,
`music-result.json`, `music-zip-verification.json`, `selection-result.json`
and `preview-promotion.json`. This is client development evidence, not a full
Go regression, a core phase closure or release qualification. The preceding
clipboard-file real-save exit was not run in this cohort; see its successor
below.

## Finding and reusing content cohort — 2026-10-16

Implemented within the admitted shared-client track, including UX-R1 saved
retrieval and the existing explicit upload/export workflows:

- The global search disclosure now offers a visual editor for type, suffix,
  and existing-tag conditions. It edits the one visible query text and reuses
  its parser, rather than introducing another query authority. Adding a
  condition does not execute a query. Replacing a positive type/suffix is
  explicit; unrelated text and negative conditions survive. Invalid input and
  obsolete edit targets cannot silently rewrite the current query.
- Saved retrieval offers local name/query filtering, clear, name/date sorting,
  and per-row disclosure of the stored query, all stored conditions, and a
  human-readable scope. Unknown fields remain marked raw. A row can open the
  existing Export drawer directly without a current selection or submitted
  query. Opening the drawer does not freeze or apply anything; explicit
  preview still freezes the ordinary ExportManifest.
- File/image paste from the main page opens the existing upload/review flow.
  One document listener handles an initial BODY focus as well as ordinary
  page targets; text editing and modal workflows keep their own paste. Drop
  and paste share the pending-operation gate, so a confirmed successful save
  permits the next batch while unresolved plans and drafts remain protected.

The integrated browser check exposed and fixed a clipped desktop filter
panel, the initial BODY paste target, and unreadable saved-condition cards in
dark appearance. Final desktop/390px checks prove the filter form is visible
and clickable; a real fixture TAG containing spaces, canonical type
replacement, stale-target refusal and a single explicit typed search passed.
SavedView list/condition/recall checks and direct export without a selection
passed. One explicitly planned, materialized and verified WAV output matched
its 48,044-byte original and full SHA-256. The final dark card contrast was
15.16:1.

Two browser-generated File clipboard events completed real multipart upload,
plan review, explicit confirmation, lexical retrieval and original download;
both downloads matched their full input lengths and SHA-256. Same-tick
duplicate paste produced one upload, an unresolved review was preserved,
textarea text paste remained ordinary, and a subsequent drop reached an
unsaved review with no third apply. This closes the earlier real-backend
clipboard-file save gap for browser File events, **not** operating-system
native clipboard delivery. Missing fixture semantic/image providers remained
visible fallbacks; this cohort does not requalify them.

Final TypeScript, isolated Vite build, i18n and diff checks passed. The reviewed
bundle was promoted to `http://127.0.0.1:4648/`; HTTP index/asset digests match
the candidate, and the owner's daemon and catalog were not changed by the
promotion. Evidence is under `dist/product-find-reuse-features-20261016/`:
`search-filter-result.json`, `saved-retrieval-result.json`,
`byte-verification.json`, `final-recheck-result.json`, `paste-result.json`,
`candidate-identity.json` and `preview-promotion.json`, plus screenshots.
Unknown-condition and missing-date display branches were reviewed in source,
not presented as real fixture outcomes. No backend schema, endpoint, processor,
runtime extension, durable grouping or new domain surface was added. Full Go
regression and release qualification were not run for this client-only cohort
under the operator's batch-first instruction; core phase gates remain open.

## Selected-content use cohort — 2026-10-16

Implemented within the existing Photos/Music admissions and the one Notes
surface, without another backend or durable domain record:

- **Photos:** review only selected photos within the current loaded matches,
  or switch back to all current matches while retaining the current subject.
  Arrows, neighboring previews, Home/End and slideshow use that same transient
  sequence. Removing its current item can advance even when the numeric
  index remains zero; removing the final selected photo closes the viewer and
  returns focus to its wall card. Other selected subjects remain selected.
- **Music:** the current track has an always-available disclosed Details entry
  leading to existing original takeout. The host validates current or retained
  loaded source metadata against the playing workspace, entry, identity and
  length before navigation. Queue name/title/artist filtering retains original
  occurrence IDs and positions for play, move and remove; no-match and hidden
  current-track states have clear exits. The queue stays transient and bounded.
- **Notes:** filter loaded records by their existing source labels together
  with the substring filter. Copy an actual loaded body with whitespace intact
  and explicit clipboard feedback. Explicit safe HTTP(S) references are links
  outside subject-navigation buttons. Description summaries remain summaries
  until expanded, hiding really hides the body, and another expansion reuses
  the already-read body. No text is copied into another durable Note record.

Real isolated browser checks covered three non-contiguous selected photos,
sequence switching/navigation/slideshow, current/last deselection, focus
return and 390px controls. The selected ZIP contained exactly those three
filenames with matching lengths and SHA-256, excluding selected audio/text.
Music played verified audio, retained its Blob across navigation and opening
Details, and downloaded the same 20,820-byte MP3 with its exact SHA-256. An
A/B/A queue exercised original-occurrence filtering, movement, removal and
play. The retained-only source fallback was reviewed in code, not separately
proven by a real search-only/nonloaded track. A final CSS-only correction made
the dark player strip use the configured surface; 390px identity/status
contrast measured 14.52:1 / 8.20:1 with reachable controls.

Normal fixture NOTE and IMPORTED description records supplied exact browser
clipboard readback (124 and 76 UTF-8 bytes), source/substring filtering,
lazy-read/cache/hide behavior, same-subject Details and safe-link DOM checks.
Clipboard refusal, an old copy Promise after refresh, and a wrong-subject
description response were explicitly controlled branches, not real provider
failures. Description reads now reject a mismatched record/revision or old
surface generation before exposing a copyable body.

TypeScript, final Vite, i18n and diff checks passed. Existing music-metadata
and static queue checks passed; the legacy occurrence browser script failed
on a stale locator for an unexpanded menu and was not repaired or rerun.
The new actual occurrence journey above supplies this cohort's behavior
evidence. One photo GET was marked `ERR_ABORTED` by Chromium despite the
complete byte-verified ZIP; the undetermined event remains in the receipt.
No full Go/release regression was run under the operator's batch-first
instruction, and no core phase or full-domain gate is closed.

Evidence lives in `dist/product-use-context-features-20261016/`:
`photo-review-result.json`, `music-player-result.json`,
`music-final-dark-result.json`, `notes-result.json`, `candidate-identity.json`
and `preview-promotion.json`, plus screenshots and downloaded originals.
The reviewed final bundle is served at `http://127.0.0.1:4648/`; HTTP asset
digests match the candidate and typed `status.get` succeeds. The `/healthz`
path is an SPA fallback here, so its HTTP 200 is not readiness evidence. The
owner's daemon and catalog were not changed by the static promotion.

## How to read this

| Mark | Meaning |
| --- | --- |
| `[x]` | Implemented and tested for the profile the row names |
| `[~]` | Partial; something end-to-end works and the remainder is listed |
| `[ ]` | Not started |
| `[!]` | Blocked on a gate or an operator decision |
| `[-]` | Out of scope under the current lock |

A row is never `[x]` because a design exists, a fixture passes, or a harness
skipped. When a harness can skip, the row says so.

## Product closure work breakdown — 2026-10-14

The [closure plan](../technical/personal-information-product-closure-plan.md) and
[scenario catalog](../research/personal-information-scenarios-and-reference-products-20261014.md)
provide outcome context, not a second queue or scope admission. This dated
section is a priority disposition; older rows and evidence remain intact.
The operator's subsequent clarification retains the goals: use composition
to meet their agreed exits and add only necessary reviewed gaps. Lack of an
active implementation commitment is not rejection of the goal; a manual
prototype does not close a richer comfortable experience.
The [Core MVP Execution Plan](../technical/core-mvp-execution-plan.md) remains the only
implementation order, and the normative content-store and first-party-client
contracts remain authoritative.

The active packages below reuse existing operations or close a demonstrated
gap inside an admitted surface. Each claimed reuse must name the actual
operation and any manual or unsupported step. These packages add no capability,
schema, endpoint, processor, service, loader, completion credit, or release
qualification claim. A real local semantic profile remains part of the
required discovery contract; code or bundle presence alone does not prove
current readiness. Keep the product within one owner's content, description,
discovery, export and recovery authority over one configured catalog and
repository. Convergence excludes runtime third-party code, a kernel ABI and a
plugin store; ADR-032 permits only reviewed data-only presentation packages
composed at build/install time with no recovery-plane reach. MCP/CLI/AI-harness
integration remains deferred absent a direct request.

### A. Ordinary reuse journey (PC-01, PC-12)

PC-01 is one current-build mixed-content journey, not a new feature: find the
intended returned scope with `search.query`; apply existing TAG/NOTE actions
through `annotation.upsert` and read them with `annotation.list`; retain scope
through the host's selection and Photos/Music/Overview presentations; inspect
only supported previews or playback; then use `export.plan`, `export.apply`,
and `export.verify` for the selected originals. A `SavedView` may retain a
supported dynamic query through `view.save`/`view.evaluate`; it does not freeze
the result set. The frozen `ExportManifest` does. Unsupported PDF preview must
lead to existing open/download behavior, not an assumed reader. Verify each
output by SHA-256 and logical length and report unavailable members/results.

PC-12 is a user recipe over existing content: put chosen URLs, titles, desired
order and a note in an owner-authored/imported ordinary TXT, Markdown or JSON
file; protect that file through the existing exact-content path; find it with
the existing text/Notes search; select and exact-export or restore the file;
open its links manually. Do not claim parsing, URL-list reopening, a restored
browser session, or archived webpage bytes. Human-authored order, location,
date, status or other words inside a payload remain payload; they do not create
first-class domain semantics. A URL list is neither page body nor session.

**Exit evidence:** one identity-matched current-build journey records which
steps use existing operations, which links are opened manually, and which
content types are unsupported. This validates reuse and the admitted shared
host journey; it does not add a task app or new user-facing record type.
Compare that evidence with the agreed user result. If repeated manual
reconstruction still prevents comfortable resumption, retain the goal and
review a small shared interaction gap instead of calling it completed.

**2026-10-15 mixed trial:** a private three-file TXT/PNG/WAV takeout produced
51,365 exact bytes; the parent independently matched all outputs to their
manifest and source identities. UI tags/Note have retained readbacks, while
the mixed media walkthrough and companion BGE query lack retained raw
media/query artifacts. This supplies bounded evidence, not full PC-01 closure.
Changed records after freeze, tag-restricted SavedView persistence and
annotation portability were not established by the trial. See the
[mixed acceptance and explicit limits](../technical/mixed-content-takeout-acceptance-20261015.md#three-file-takeout-in-an-isolated-profile).

- [x] **PC-01a — Retain one composed mixed-content retrieval and exact takeout.**
  One current-build private browser journey now retains the raw fused BGE query,
  tag-scoped TXT/PNG/WAV identities, photo viewer/Details, exact HTTP/player
  Blob bytes, advancing native audio, shared three-file selection and Note
  inspection. UI freeze/apply/verify and parent full-byte comparisons pass for
  three files and 51,365 bytes. The existing legacy frozen-entry reference is
  checked against the captured stable-subject/entry/content/length mapping.
  See the [instrumented successor](../technical/mixed-content-takeout-acceptance-20261015.md#instrumented-mixed-content-successor).
  This closes the missing retained evidence for this synthetic composition;
  browser ZIP, after-freeze mutation, tag-filtered SavedView persistence,
  annotation portability, representative quality and full PC-01 remain open.

- [x] **PC-12a — Continue from references in a stored text record.** Existing
  bounded exact text preview now renders validated HTTP(S) references for
  explicit new-tab activation, preserving original text/order and inert unsafe
  tokens. Final-build browser UI search, no-fetch-before-click, controlled
  navigation, exact original download and independently verified two-record
  frozen ZIP pass. See [composition acceptance](../technical/composed-text-references-acceptance-20261014.md)
  for build identity, commands and synthetic-corpus limits. PC-01/full PC-12,
  capture, grouped reopening and editing remain open; no core/release credit.

- [x] **PC-12b — Save pasted text through the existing Add flow.** An optional
  disclosure creates one ordinary literal UTF-8 TXT with visible filename and
  byte count, bounded to the existing 64 KiB preview. Current-build browser
  evidence covers multibyte/ASCII refusal without truncation, draft/plan reopen,
  late upload without invisible review, one lost-response apply reconciled by
  status instead of retry, filename search, references, exact original and frozen
  ZIP takeout. See the subsequent cohort in the same
  [composition acceptance](../technical/composed-text-references-acceptance-20261014.md).
  This adds no standalone Notes, existing-file editing or browser capture;
  full PC-12 and PC-01 stay open.

### B. Demonstrable common UX friction (PC-02, PC-03, PC-06, PC-11B)

Address only a reproducible failure or a named readiness gap in the current
admitted client: PC-02 should expose existing single-original or
server-directory takeout when browser budgets are exceeded; PC-03 should keep
empty, stale, unavailable and incomplete-read outcomes truthful; PC-06 should
protect Notes drafts and subject identity across delayed operations; PC-11B
should preserve the same host-owned task state across an existing supported
shell/presentation switch. Reuse existing reads, writes, refusal and
reconciliation paths. Do not reopen fixes with dated passing evidence.

No blanket device/browser/viewport matrix is implied. Do not preselect a text
editor or linkifier; add no streaming, new budgets or persistence. First name the
observed trigger, affected existing operation and smallest current-build exit;
if none is observed, the reference remains traceability only.

- [x] **PC-02a — Continue an over-budget ZIP through existing takeout paths
  (bounded).** The refused attempt retains a complete minimal workspace-bound
  selection and exposes the existing single-original/server-directory actions.
  A real 32 MiB-plus-one-byte source is refused before plan/read, downloaded
  individually with matching bytes, then exported with the originally
  attempted small-b after current selection changes to small-a. The ordinary
  manifest/apply/verify path and independent output hashes pass. Drawer
  visibility, focus return and dismissal pass; unknown-size, malformed identity
  and complete over-count retention have focused helper evidence. Workspace
  mismatch guards are source-reviewed, not runtime-switch-tested. Web build,
  shared broad Go, final diff check, root source/raw response/output/served
  asset and screenshot review pass. See [ADR-048](../technical/build-stack-and-architecture-selection.md#adr-048-continue-budget-refused-takeout-with-the-attempted-selection)
  and the [dated acceptance](../technical/zip-refusal-continuation-acceptance-20261016.md).
  ZIP budgets and existing export/recovery authority remain unchanged; full
  PC-02, core phases and release qualification remain open.

- [x] **PC-02b — Disclose secondary server-export controls on demand
  (bounded).** Selected source, destination and Preview remain primary;
  query sources, sidecar options and history expand explicitly. Active source
  labels and errors remain visible. A real browser run proves query/selection
  invalidation, two-file exact output, visible retry after a controlled verify
  outage and history verification without another apply. Root reviewed raw
  bodies, output identities and screenshots. Final CSS-only contrast changes
  retain the accepted JS digest and pass a separate read-only layout check;
  build, i18n, shared Go and diff checks pass. See the
  [dated acceptance](../technical/export-disclosure-acceptance-20261016.md) for receipts,
  preserved harness failures and unrun limits. Full PC-02 and core/release
  gates remain open.

- [x] **PC-11B1 — Keep search selection across domain presentations.**
  A real query -> Photos selection -> Music selection -> all-types journey
  retains both subjects without another search. Music discloses hidden
  selections; a deliberate text-plus-suffix replacement drops the absent WAV
  and retains its matching photo. The parent reviewed both clearing fixes,
  real ordered identities and served bytes. Web build, focused browser exit,
  syntax, broad Go and diff checks pass. See the
  [dated evidence and limits](../technical/mixed-content-takeout-acceptance-20261015.md).
  Tag mode shares the fix but was not separately exercised; full PC-11B and
  core/release gates remain open.

- [x] **PC-11B2 — Share loaded selection and Notes drafts across presentations.**
  A real loaded-library journey keeps PNG/WAV selection through Photos,
  Music, all types and bounded Overview, with one listing and no search.
  Existing `scopeHits` supplies the sole selection resolution/pruning scope;
  a PNG facet drops the WAV and clearing it does not restore that selection.
  The same inspected photo and unsaved Note survive page and Library rail
  navigation; a cancelled Sources departure retains its draft guard. The
  separate search regression, parent source/identity/served-byte review,
  Web build, focused checks, broad Go and diff checks pass. See the
  [loaded-scope evidence](../technical/mixed-content-takeout-acceptance-20261015.md#loaded-scope-successor).
  Preference fallback UI, new output/recovery and full client/release
  qualification were not exercised; parent gates remain open.

- [x] **PC-03a — Continue directly from committed search results.** The
  destination-header search overlay now closes after its current result
  commits, allowing direct Filters access. Invalid/failed requests remain
  open, and late completion preserves newer edits or a reopened overlay.
  Parent source/served-byte review, the real mixed journey, focused browser
  cases (including controlled abort/delay), Web build, result-scope and broad
  Go checks pass. See the [overlay continuation](../technical/mixed-content-takeout-acceptance-20261015.md#search-overlay-continuation).
  Other header variants and full client/core qualification remain open.

### C. Existing experience and retrieval gaps

References: PC-04, PC-05, PC-07; conditional PC-08 and PC-11A.

- [x] **PC-04d — Retain exact user tags in ordinary saved retrieval (bounded).** The
  admitted legacy maintenance profile in content-store §7.2 and ADR-057 keeps
  full JSON-quoted tag values in existing SavedView fields, supports tag-only
  Library retrieval and composes tags with supported keywords/filters. The
  shared evaluator applies live-tag AND after authorization and before its
  result ceiling while pinning lexical pages; view-backed export freezes that
  same membership. The client previews exact tags, keeps raw values and old
  optional fields/scope compatible, and labels a recalled tag-only retrieval
  by its saved name. Focused and broad tagged Go checks, client assertions,
  TypeScript, i18n, isolated Vite build and diff checks pass. The candidate is
  locally delivered with nine matching HTTP asset hashes; the native process
  reports both lexical and semantic READY and unchanged configuration and
  twenty owner identities. Initial JSX and unsigned-fixture failures remain
  retained; the successor fixes the JSX and uses signed temporary metadata
  without weakening production refusal. Subsequent browser checkpoints retain
  the complete whitespace/Unicode tag values through tag-only and keyword/tag
  save, revision-checked update, later recall and exact frozen materialization.
  The tag-only heading uses the saved name. Successful new-source handoff
  clears the prior selection. These are sequenced fixture checkpoints across
  corrected drivers, not one uninterrupted all-green script. See
  `dist/product-consolidated-client-20261018/retrieval/` and the
  [dated acceptance](../technical/daily-client-functions-acceptance-20261018.md#consolidated-current-build-client-journeys).
  Owner data was not mutated. Full canonical-AST, portable-view and Phase 6
  qualification remain open.

PC-04 audits only conditions/options accepted by the current `view.save` and
`view.evaluate` contract; unsupported conditions must remain visible and may
not silently widen a query. PC-05 covers only remaining bounded playback,
identity, cancellation, stale-callback or transient-queue failures not already
closed by evidence. Neither a SavedView nor a transient queue becomes durable
domain membership. PC-07 reuses existing lexical/structured search and the
admitted local BGE/ONNX + zvec path, with honest semantic readiness,
field-coverage and provenance reporting; investigate a fresh corpus only for
an evidenced readiness or coverage gap. Keep lexical/structured search and
exact-original access available through semantic degradation.

- [x] **PC-04e — Edit or copy a supported stored retrieval (bounded).**
  The current browser loads/fences the stored record, edits its keyword and
  explicitly disclosed fields, reviews an update, or saves a distinct named
  copy. Actual private readbacks verify revision, scope, default policies,
  unchanged source after copy, and UI name-collision refusal. Unsupported
  policies/scopes refuse; the guard is not atomic CAS. See the functional
  completion batch above; the full PC-04 parent remains open.

- [x] **PC-04a — Disclose bounded SavedView recall.** Real UI save/list/get,
  reload and evaluation pass. At the existing 200-hit ceiling the client labels
  loaded matches and possible additional membership, with a selected-row export
  check over a separate presentation-only 200-hit fixture. The virtualized wall
  retains 200 loaded positions, not 200 mounted DOM rows. Current-build Web/i18n,
  browser, broad Go and diff checks pass; see the
  [composition acceptance](../technical/composed-text-references-acceptance-20261014.md).
  Full PC-04 stays open: this earlier repair does not supply a canonical query
  AST or axis persistence. Later bounded exact user-tag maintenance is recorded
  separately in PC-04d.

- [x] **PC-04b — Keep newer navigation and queries after delayed recall.** A
  real held SavedView evaluation reproduced a jump from Sources back to the
  old results. Recall now participates in the existing host search intent;
  stale reads/errors cannot publish, and an older recall cannot release a
  newer query's busy state. Current-build browser evidence retains Sources,
  preserves the ordinary recall's three ordered identities, and displays the
  newer query's twenty results in exact daemon order. Web build, syntax and
  focused browser checks pass; parent diff and served-asset review pass. The
  broad Go output contains 27 successful package lines, but its wrapper failed
  to capture the process exit; that run is not recorded as an exact-exit PASS.
  See the [scope successor acceptance](../technical/search-scope-size-acceptance-20261015.md#savedview-recall-scope-successor).
  This closes the demonstrated recall race only, not full PC-04 or Phase 6.

- [x] **PC-04c — Use recalled audio with its current known size.** A real
  saved-search recall returned three WAV identities without lengths, leaving
  Music Play disabled despite matching loaded lengths. Recall now reuses the
  existing exact-tuple size join with current workspace/refresh-scoped loaded
  rows. The three identities and order are unchanged, all three Play actions
  become eligible, and explicit playback of one original yields matching
  48,044-byte HTTP and player-Blob bodies with the evaluated SHA-256. The
  native decoder reports readyState 4 and a three-second duration. Web build,
  focused existing helper checks, current browser regression, captured-exit
  tagged Go cohort and parent source/bytes/served-assets review pass. See the
  [Music continuation acceptance](../technical/search-scope-size-acceptance-20261015.md#savedview-to-music-continuation).
  Missing or mismatched lengths remain unknown; this closes the demonstrated
  client gap, not full Music, persistent playlists or a core/release gate.

- [x] **PC-05a — Keep recorded Music labels in playback and the transient queue.**
  Existing subject-bound titles and artists now accompany explicit play/queue
  actions while original filenames, exact-byte checks and occurrence identity
  remain unchanged. Real Music play/append, paused Photos navigation and
  filename fallback pass with matching HTTP/Blob bytes and advancing native
  playback. Parent screenshot review found and closed clipped labels and
  narrow queue-tool overflow; final desktop/360px A/A/B evidence retains
  position-distinct accessible Play names. Web/focused checks, captured-exit
  broad tagged Go tests and parent source/bytes/assets review pass. See the
  [bounded successor acceptance](../technical/functional-client-acceptance-20261013.md#recorded-playback-label-successor--2026-10-15).
  Overview/batch wiring is reviewed, not separately browser-exercised here;
  full PC-05 and Music remain open.

- [x] **PC-07a — Enable real local semantic retrieval in the intended running
  profile.** The 2026-10-14 audit found semantic UNAVAILABLE and mismatched
  persisted/running paths. Explicit copy-forward relocation preserved the
  owner state, independently retained anchor and rollback copy; the compatible
  schema-only bundle copy preserved its eleven declared asset bytes. The
  existing installer, native startup inference and explicit rebuild now supply
  real ONNX/BGE + zvec default fused hits from all four current source heads,
  with segment provenance and matching config/runtime state. Executable local
  evidence includes 20-file full-byte verification, catalog-free exact restore
  and browser original takeout; see the
  [runtime acceptance](../technical/local-semantic-runtime-acceptance-20261015.md).
  This closes this local readiness subtask, not full PC-07 or Phase 4.

- [x] **PC-07b — Bound native worker reuse and preserve search after caller
  cancellation.** Final focused and broad Go tests pass. A real pending HTTP
  request was disconnected during native worker startup; the next request on
  the same daemon succeeded without rebuilding or restarting, followed by two
  distinct requests reusing one worker. The reviewed factory serializes one
  generation-bound session, retains full admission/executable/fencing checks,
  discards uncertain transport and plaintext handles, and re-admits after
  1,024 calls. Live port 4648 now runs the identity-matched final binary:
  default fused requests retain 20 results on the existing generation, with
  unchanged owner facts/config/anchor. See the
  [runtime acceptance](../technical/local-semantic-runtime-acceptance-20261015.md).

- [x] **PC-07c — Reduce the observed local retrieval delay.** The reviewed
  SDK build-tag correction preserves complete profile/executable validation
  while restoring arm64 SHA acceleration. The same-corpus isolated comparison
  reduced warm median query time from 2.68 to 0.55 seconds with all five full
  ordered identity lists, semantic provenance and exact HTTP takeout retained.
  The final binary also passes the broad tagged Go cohort and separate real
  healthy/fallback checks; missing semantic assets now identify the unavailable
  ONNX profile and explicit reason while lexical search and exact takeout work.

  That final binary is now active on local port 4648 with one explicit fresh
  generation. Five ordinary default fused queries retain twenty results each;
  the first measured live query took 0.97 seconds and subsequent queries
  0.50–0.55 seconds. All four existing snapshots pass full-byte verification
  (20 files, 5,054,649 bytes). Parent review confirms unchanged existing durable
  facts, repository and recovery files; four appended snapshot-verification
  audit records were individually reconciled. See the
  [dated acceptance](../technical/semantic-latency-profiling-20261015.md#missing-provider-declaration-follow-up).
  This closes the bounded local-delay slice only: the small retained corpus
  does not establish representative recall/performance or Phase 4 qualification.

- [x] **PC-07c-a — Identify the measured warm-query costs.** Direct component
  profiling found 659–748 ms per full admission, 92–100 ms per executable hash,
  about 482 ms for warm collection reopen, and 5–14 ms for warm inference.
  The pinned SDK's global `purego` tag also disables arm64 SHA acceleration.
  The [dated profiling note](../technical/semantic-latency-profiling-20261015.md) distinguishes
  component timings from HTTP attribution and retains all integrity checks.
  This closes the investigation only; PC-07c records the implemented local
  optimization and broader qualification remains open.

- [x] **PC-07d — Preserve search scope and enrich matching logical sizes.**
  Real browser checks pass both listing/search completion orders, retain
  relevance order and query text, and enrich only identical current canonical
  tuples. A pending old URL query cannot supersede a newer explicit search;
  tested explicit departures defeat late results while Photos presentation
  retains the pending query. Malformed/conflicting tuples stay unknown, and
  253-byte original takeout passes its digest check. Web/focused checks, parent
  diff/assets review and the shared broad Go cohort pass. See the
  [dated acceptance](../technical/search-scope-size-acceptance-20261015.md) for exact scope
  and unrun branches; this closes neither PC-07 nor Phase 4.

- [x] **PC-07e — Make matched metadata evidence readable on result cards.**
  Recognized image metadata in the first displayed match has a compact summary;
  existing Details retains all properties, provenance and original JSON in a
  collapsed disclosure. A fresh unseeded real-browser query preserves order,
  selection and query count, exercises keyboard access, and verifies exact
  3,117,146-byte original takeout. Focused/Web checks, parent diff/screenshots/
  served-asset review and the shared base Go cohort pass. The
  [dated acceptance](../technical/search-evidence-readability-acceptance-20261015.md) records
  the display-only recognition and fixture-corpus limits. PC-07 and Phase 4
  remain open.

- [x] **PC-07f — Verify selected lexical text sources in the built generation.**
  A generation-bound inventory and actual field/span digests distinguish
  missing sources from unavailable evidence without using the current catalog
  as an older generation's denominator. Focused tests, broad Go tests and one
  isolated actual rebuild pass; parent review independently verifies all 22
  selected sources. Four controlled Settings outcomes have current served-build
  DOM/screenshot evidence. The [dated acceptance](../technical/lexical-source-coverage-acceptance-20261015.md)
  records the exact profile, preserved failures, candidate-only backend proof
  and limits. That slice kept semantic receipt v1 unchanged; PC-07g below
  records its separately reviewed successor. Full PC-07 and Phase 4 remain open.

- [x] **PC-07g — Bind semantic matches to selected source revisions.**
  A reproduced old-vector/new-Note-body regression now returns the exact
  generation-bound historical body and honors the live tombstone gate.
  Native FULL/TRUNCATED/UNKNOWN input evidence and selected-source coverage
  remain distinct from vector membership and runtime readiness. Focused and
  final broad Go checks pass; one real private BGE/zvec run verifies revision-1
  retrieval after revision 2, actual 2,172-to-512-token truncation, lexical
  tail retrieval and guarded restoration. Parent inventory/body/digest review,
  preserved exact bytes, seven controlled Settings cases and cleanup pass.
  See the [bounded acceptance](../technical/semantic-source-lineage-acceptance-20261015.md).
  Its reviewed owner-preview successor now runs the same tested binary with
  42 selected sources, 40 native FULL inputs and unchanged authoritative facts.
  The real search -> Photos -> Music original/player-byte journey passes on
  that generation. Long-Note segmentation, full PC-07, Phase 4/5 and release
  qualification remain open.

- [x] **PC-07h — Make long Notes and selected extracts semantically findable.**
  Derived UTF-8 source-span chunks preserve immutable source revisions and the
  complete lexical body without another durable document/segment store.
  Focused lineage, malformed-proof, Unicode and producer tests and the broad
  tagged Go cohort pass; existing result projections retain optional source
  revision/span evidence and legacy omission. Parent source review passes.
  An isolated actual local BGE/zvec run and parent raw-receipt review pass:
  the long Note and extract each have 61 FULL inputs, suffix matches start at
  byte 18,000, and a pinned old Note revision, lexical tail, exact restore and
  cleanup pass. The same tested candidate is now active on local port 4648;
  one explicit rebuild and a real same-generation search -> Photos -> Music
  journey pass with verified original/player bytes and actual playback.
  Parent review confirms unchanged authoritative facts and retained prior
  generations. The owner has no long Notes: that branch remains proven by the
  identity-matched private native run. This closes only PC-07h, not full PC-07,
  Phase 4/5 or release qualification.
  See the [bounded native acceptance](../technical/semantic-source-lineage-acceptance-20261015.md#long-text-source-segmentation-successor) and
  [ADR-046](../technical/build-stack-and-architecture-selection.md#adr-046-segment-long-text-sources-without-another-durable-document-model).

- [x] **PC-07i — Close the observed multi-character CJK query gap (bounded).**
  In retained native attempt 002, `萤火浮标` returns no lexical match inside
  `月蚀之后的青铜海燕沿北冰洋暗流寻找失联的萤火浮标`, while the full tail
  token matches. The reviewed refinement now recalls bounded adjacency
  candidates and proves continuous original text before result counting.
  Focused and broad tagged Go tests pass, including more than 1,000 false
  candidates before true results, page exhaustion, source attribution,
  extracted-prefix limits and old-policy continuation refusal. One ordinary
  private Web query finds the positive EXTRACT source, excludes scattered
  bigrams, reports semantic unavailability honestly and returns identical
  original bytes. Root separately resolves and preserves the runner's initial
  immediate-port-bind cleanup failure. The tested daemon is deployed to the
  owner preview, reopening the same real semantic and lexical generations
  without rebuilding; authoritative facts and protected bytes are unchanged.
  See [ADR-047](../technical/build-stack-and-architecture-selection.md#adr-047-prove-continuous-cjk-phrases-after-bounded-lexical-candidate-expansion)
  and the [dated evidence](../technical/lexical-cjk-query-acceptance-20261016.md). This closes
  only PC-07i; the existing appendix limits and full Phase 4/5 gates remain.

- [x] **PC-07j — Repair native vector writes above the pinned batch limit.**
  An actual 104-document corpus produces 7,496 model inputs and exposes the
  native 1,024-document write limit. Bounded inserts pass the reproduced
  2,053-document native regression, focused/broad Go checks and one unchanged
  BGE corpus rebuild. Root verifies raw receipts, source counts and the Note
  body/source. This closes the batch defect only: frozen top-ten query misses
  remain. All 104 originals also restore without the catalog, while later
  Note/TAG/description writes are absent from the exported signed facts. See
  [the dated evidence](../technical/real-project-corpus-acceptance-20261016.md).

- [x] **PC-07k — Remove full semantic rebuilds from ordinary saves.**
  Focused tests prove ordinary exact/metadata writes make zero document-embedding
  calls, keep lexical results current, leave semantic NOT_BUILT before the first
  explicit build, preserve READY on TAG-only edits, and revoke default semantic
  availability when a Note revision makes the generation stale. A pinned old
  generation retains its original Note source; an explicit rebuild restores a
  new READY generation with the current Note revision and source provenance.
  The reviewed real-corpus run confirms those states over 104 files and 7,496
  FULL BGE inputs: two explicit rebuilds took 82.539/81.309 s, while apply,
  description, Note and TAG writes took 0.222–3.584 s. It retained all 24 frozen
  query results and four controls; recall misses remain (Q03 rank 22 and the
  description control rank 12). Evidence and exact command/test exits are in
  [the dated acceptance](../technical/real-project-corpus-acceptance-20261016.md#explicit-semantic-work-and-current-source-freshness).
  This closes only the bounded latency/currentness item; Phase 4, metadata
  publication into signed recovery successors, clean-reader user-metadata
  verification, retrieval quality and release qualification remain open. The
  tested candidate has not been rolled out to the owner preview.

- [x] **PC-07l — Remove whole-component starvation in mixed search (bounded).**
  ADR-054 supplies rank-only RRF over the same authorized bounded union, with
  stale-rank removal and canonical legacy-alias retention. Focused and broad
  tagged Go checks pass. The unchanged actual 104-file BGE corpus's twelve
  queries and four controls retain full raw membership, identity and source
  evidence; only two query orders change. Existing expected top-ten misses
  remain, with both upward and downward movements recorded. See the
  [dated acceptance](../technical/mixed-search-ranking-acceptance-20261018.md). This closes
  the concatenation defect only, not semantic recall, full PC-07 or Phase 4.

PC-08 is conditional evidence review of existing optional CLIP/OCR assets and
providers only when current configuration or a concrete user journey justifies
checking readiness, real execution, provenance and fallback. It admits no
default dimension, new exposure, processing policy or install UI. PC-11A is
likewise conditional review of an observed setup/status gap in existing
capabilities; it does not promise a new setup surface. Visual similarity does
not establish identity; image OCR does not claim PDF OCR. Do not reopen already
verified fixes or claim code presence as runtime readiness.

### D. Mandatory core gates (PC-20)

PC-20 remains the required core/release track and follows the existing execution
plan, not a new client milestone: preserve the tested admitted Phase 3
development profile and continue from its current checkpoint. After
portable-record shapes are frozen, complete Phase 4 real
local semantic discovery and Phase 5 recoverable storage qualification, which
may proceed in parallel only when the execution-plan entry gate allows; then
complete the gated Phase 6 LinkGroup/export successor and applicable Phase 7
declared-profile qualification. Preserve one owner, one configured
catalog/repository, exact identity, path provenance and honest
fallbacks. Current local admitted UX does not require a Linux/NAS detour, and
local UX evidence closes no core or release gate. A release claim is governed
by the normative exit evidence for its declared profile.

**Bounded recovery progress (2026-10-16):** focused ordinary-write tests cover
Note and TAG upsert/rename/delete, PROGRESS create/revise, annotation imports,
and Description create/revise/imported-kind/accepted-candidate facts. They
check saved identity/revision/body and all-parent authenticated publication,
with catalog-free reader assertions where applicable. Missing-auth and
partial/unknown publication preserve the committed write and report its actual
DEGRADED reason. A flat import with a missing predecessor is saved + DEGRADED;
full imported-history recovery is not proved. Note revision 3 has an actual
catalog-free corpus reader fact check. A later
bounded metadata-corpus drill joined seven saved facts under its one retained
authenticated parent and separately restored the exact 104-file corpus
(2,486,895 bytes) against the frozen manifest. This is one-parent evidence;
two-parent publication remains covered by focused tests. The reference fitted
the existing v2 format. See the [dated evidence](../technical/real-project-corpus-acceptance-20261016.md#2026-10-16-bounded-metadata-corpus-recovery-drill).
The recovery-reference writer refuses final v2 bytes over the existing 16 MiB
reader cap. The Unix near-limit test observed a 14,521,495-byte prepared v2 and
a 16,210,219-byte fact v2 record, refused their 30,734,625-byte expanded v2
reference, and produced a 3,014-byte v3 reference. Its separate-anchor,
no-catalog/no-key reader restored 201 files / 3,847 bytes with exact paths,
hashes and lengths; its source remained available. This is distinct from the
separate-process test that removed source/catalog/keys. Generic export keeps
fitting v2 and falls back only on typed size refusal. The final combined tagged
Go run passed; command and receipt detail are in the dated evidence. This does
not check off PC-20 or close Phase 3/4/release gates. History-scale performance,
full lost-catalog/history recovery, broader actual-corpus write-family
coverage, post-write search freshness, retrieval quality and later phases
remain open. The metadata-corpus daemon remains installed in the local owner
preview (restored PID 55134; daemon SHA-256
`bb2b077d48f7e1877ec8e72698af827d3fc00025dc8701707166de72afe3678c`); this
does not close a Phase 3/4 or release gate. See the [bounded owner-preview
rollout](../technical/real-project-corpus-acceptance-20261016.md#bounded-owner-preview-rollout-2026-10-16)
and the [compact-reference evidence](../technical/real-project-corpus-acceptance-20261016.md#compact-recovery-reference-successor-bounded).
The separately tested streaming publication follow-up is not installed and
does not establish a performance improvement; see the [bounded comparison](../technical/real-project-corpus-acceptance-20261016.md#bounded-streaming-follow-up-for-metadata-publication).
The duplicate-validation measurement and Notes text/outcome check add bounded
evidence only. The tested backend candidate remains uninstalled; the tested
Notes client is now served by the stable owner daemon. The [local recovery and
client promotion](../technical/real-project-corpus-acceptance-20261016.md#local-preview-recovery-and-client-promotion)
records the rollback of the backend rollout and the separate client update.
Neither result closes a phase or release gate
([duplicate-validation](../technical/real-project-corpus-acceptance-20261016.md#duplicate-validation-follow-up),
[Notes fidelity](../technical/real-project-corpus-acceptance-20261016.md#notes-text-and-save-outcome-fidelity)).

### Goal backlog; compose first, admit necessary gaps

These stable PC references retain user goals and potential implementation gaps.
They do not select a full domain suite or bypass admission. For the next chosen
goal, record shared pieces, the smallest necessary gap and a user-visible exit;
then schedule only the admitted gap. No checked completion or full-suite effort
estimate follows from a manual recipe or the goal's name.

| Reference | Retained outcome / possible gap | Boundary from current composition |
| --- | --- | --- |
| PC-09, PC-10 | Curated photo albums; persistent music playlists | Existing Photos/Music, facts and transient queue do not supply durable membership/order/recovery semantics. |
| PC-13, PC-14 | Task records and selected-link return experience | A user file can be found and restored; it does not provide app-level order, selective reopen, task state or browser-session meaning. |
| PC-15 | Browser capture and optional page snapshots | A URL is not captured page content; capture requires its own source, permission, identity and recovery contract. |
| PC-16 | Household item/location with attached evidence | Searchable Notes can contain a location phrase; that does not create structured inventory, typed location, correction history or evidence relations. |
| PC-17 | Confirmed food dates and reminders | Dates in a file are searchable text; they do not create accepted-date, inventory-window or notification semantics. |
| PC-18 | Selected Home Assistant observations | Ordinary files may hold manually exported data; they do not create a bounded live source integration, observation authority or history service. |
| PC-19 | Personal video and TV consumption | Photos/Music support does not establish video playback, streaming, TV integration or a media catalog. |
| PC-21 | Voice quick capture; AI-assisted file finding/takeout; authorized remote personal-file access and management | Recording the direction does not implement speech input, AI orchestration, qualified remote access, device pairing or live-file mutation. Reuse the same typed content authority; see ADR-044. |

**PC-21 direction recorded 2026-10-15, reaffirmed 2026-10-16:** preserve the
owner's goal-to-result interaction from the [product direction](../technical/content-first-product-decision.md#ai-assisted-capture-and-retrieval-direction-2026-10-15).
Choose one useful capture or find/takeout job and its smallest necessary
integration gap. Prefer an external
AI client over the existing host-owned operations; a built-in assistant and
speech/model providers remain optional later choices. The preferred first
future candidate is natural-language finding and verified takeout of already
retained content, followed by voice capture and separately reviewed paired
remote-source access. Desired exits are a
spoken record that is saved, searchable and correctable, or an authorized
natural-language request that produces the intended exact files without the
owner carrying internal IDs. Distinguish retained-content remote access,
bounded paired-source capture and live-file changes. Include ambiguity,
offline/revoked access, model/egress failure, cancellation and lost-write
reconciliation. No implementation task is admitted or checked complete by this
recording request; current convergence and phase gates remain unchanged. See
[the examples and boundaries](../technical/content-first-product-decision.md#ai-assisted-capture-and-retrieval-direction-2026-10-15).

The ordinary content loop remains useful for human-authored information: a
note saying “passport in study drawer” can be text-searchable when indexed, and
a manually recorded date can be found as text. That does not establish a
structured household inventory, confirmed location/date, reminder, or
first-class group Notes. SavedView remains a dynamic supported query; it does
not turn its changing result into ordered task links or durable membership.
Do not introduce a universal-record schema to bridge these distinct meanings.
New native semantics or integration is a scope-review trigger, not a blanket
reason to discard an outcome. After review, a necessary bounded contribution
can join the active queue under its actual contract and phase gates.

## Active product todo — 2026-10-09

### Private-drive daily loop — 2026-10-12

The current product category is **a better self-hosted private drive** for one
owner. [ADR-035](../technical/build-stack-and-architecture-selection.md#adr-035-private-drive-positioning-and-file-oriented-intake)
records the decision. The operator selected easier Add and mature interface
patterns; the [reference review](../research/private-drive-interface-reference-20261012.md)
separates documented patterns from Cairn's design choices. This is an admitted
client-maintenance queue, not a replacement core execution plan.

- [x] Lead Add with file choice/drop, automatically prepare a fully reported
  uploaded batch, and keep review/explicit save in the same file-oriented panel.
- [x] Make names/count and the next action prominent; disclose temporary paths,
  digests and storage accounting. Keep refusals, renamed names, warnings and
  unresolved outcomes visible, using the existing check path.
- [x] Return from successful saving to the unified library and verify actual
  original downloads for text, image and audio inputs.

Executable evidence: [private-drive intake acceptance](../technical/private-drive-intake-acceptance-20261012.md).
DeepSeek Harness Flash implemented the two component scopes; the primary
reviewer accepted the diffs and Luna owns the remaining browser/screenshots
review. This is tested local intake, not full-product or release completion.

Next product slices, within their existing admissions:

- [~] **Library productivity:** give browse, selection, Details and takeout a
  consistent action hierarchy. Reuse existing tags/favorites, filters and batch
  originals; the exit is find → select → use/download, including an empty
  result and an unavailable original. Do not create a new folder/sync model.
  The 2026-10-12 bounded client slice is implemented and locally tested:
  standard tools/disclosures, batch action hierarchy and row-selection
  affordances were delegated to three independent DeepSeek Harness
  `sub2api / claude-haiku-5-5` sessions. Build, registry, browser flow and
  exact-byte ZIP checks passed; see [library acceptance](../technical/library-productivity-acceptance-20261012.md)
  and the locally retained QA report at
  `dist/library-productivity-20261012/validation/qa-report.md`.
  Keep this row partial: empty-result selection and unavailable-original
  outcomes, light captures at the exact target dimensions, and broader
  large-library behavior remain unverified.
- [~] **Photos use:** make selection, inspection and original takeout feel like
  one dedicated photo application. Retain the same loaded result scope,
  original identities, incomplete-scope notices and bounded rendition budget.
  The [2026-10-13 bounded polish acceptance](../technical/domain-polish-acceptance-20261013.md)
  records the clearer wall/names/controls and real local inspection/selection
  checks; original takeout keeps its earlier separate evidence. Complete
  curated organization and large-library/real-device behavior remain open.
- [~] **Music use:** coordinate recorded track/artist/album browsing with the
  single verified player and transient queue. Finish existing queue failure
  states before admitting persistent playlists or media services.
  The same acceptance records the coherent browse/action row, native keyboard
  selection, decoded original and shared-player continuity. Persistent
  playlists and the residual playback/failure scope remain open.

Each slice still needs its own normative requirement and executable exit.
Persistent albums/playlists, richer grouping, folder mutation, sharing and
sync are separate decisions; this category wording does not admit them.
The existing correctness gaps and core/recovery gates remain in force.

Future media candidates, outside the admitted implementation queue:
[video/anime, Bangumi and danmaku review](../research/media-and-anime-experience-20261013.md)
and [ADR-037](../technical/build-stack-and-architecture-selection.md#adr-037-complete-existing-domain-journeys-then-review-a-personal-video-successor)
record the operator's 2026-10-13 request, useful domain journeys, optional
enrichment and proposed exits. They do not create a new surface or gate credit.

Dedicated-entry refinement of the current daily loop:

- [x] Give Library/Photos/Music explicit global destination entries and a
  consistent host header; keep type filtering and in-domain render styles
  separate. Label the full-listing rail action All content.
- [x] Verify retained query/tag scope without a repeated search, the same
  decoded player across the destination cycle, draft cancellation and old
  direct links; review clean 390/1280 light/dark and Showcase layouts.

Executable evidence: [destination navigation acceptance](../technical/destination-navigation-acceptance-20261013.md)
records local Luna implementation, primary review, current-build headless
browser checks and the preserved fixture restart. It grants no native-device,
new media or core/release completion.

Progressive-disclosure refinement of the same daily loop:

- [x] Place the compiled Overview inside Library's View options, retaining
  Library/Photos/Music as global destinations and Library's active state.
- [x] Disclose search history/help and secondary Library controls on demand;
  keep active restrictions, incomplete scope and grammar errors visible.
- [x] Review the final 390/1280 light/dark default/search layouts and exercise
  one search → Overview → File view without another query, plus plain/exact
  completion and refused invalid text.

Executable evidence: [progressive-disclosure acceptance](../technical/progressive-disclosure-acceptance-20261013.md)
records reviewed local Luna implementation, final served assets, screenshots
and three bounded browser assertions. History mutation and broader keyboard,
media, large-library and release coverage were not rerun. The parent Library,
Photos and Music rows remain partial.

Exhibition gallery refinement of the existing Photos presentation:

- [x] Prioritize the current photo with a stable center, quiet adjacent
  previews, compact heading, one current action row and disclosed help.
- [x] Verify first/middle/last and keyboard navigation, bounded mounts,
  neighbor focus, inspector/Details entry, selection return and a real
  unavailable preview; review 390/1280 light/dark final screenshots.

Executable evidence: [Exhibition gallery acceptance](../technical/exhibition-gallery-acceptance-20261013.md)
records reviewed local Luna implementation and headless browser checks.
It adds no photo organization, provider, core-phase or release qualification.

Functional continuation of the admitted daily loop (2026-10-13 cohort):

- [x] Add local Music title/artist/album/track/duration/size ordering and honest
  playback-eligibility filtering, retaining original subject mapping and
  unknown facts. Final keyboard trace follows the displayed sorted rows.
- [x] Insert one distinct queue occurrence after the current track without
  replacing its verified Blob or playback position; close/refocus the row
  queue menu after an action. Keep the queue transient and bounded.
- [x] Select an inclusive ordinary-Library range; add/reuse/remove an exact
  TAG and explicitly favorite/unfavorite captured subjects. Complete reads,
  revision checks, reread results, draft preservation and injected refusal
  checks retain unrelated annotations and report unavailable outcomes.
- [x] Select/deselect inside Photos and Exhibition inspection, show the same
  selected-item count, and reach the one existing batch-action region.
- [x] Expose the existing Saved retrieval entry directly in File/Overview;
  retain the media-scope save refusal inside opened domain tools.

Executable evidence: [functional client acceptance](../technical/functional-client-acceptance-20261013.md)
and its retained QA report distinguish earlier v2 evidence, final v5 build and
browser checks, and injected-only read failures. Go regression ran once;
served JS/CSS match the final build. Real 1,000-entry UI saturation, async
Details switching, uncertain-write reconciliation and additional saved-query
combinations remain unrun. Library, Photos and Music stay partial; curated
albums, durable playlists and video remain separate targets in ADR-041.

### UX-D1 — focused full-page Photos and Music (2026-10-12)

The operator explicitly selected this current presentation slice on 2026-10-12.
It refines admitted client surfaces; the core phase order remains unchanged.
The normative boundary is
[First-Party Client Experiences §14](../requirements/first-party-client-experiences.md#14-ux-d1-full-page-photos-and-music-composition),
with the rationale in
[ADR-034](../technical/build-stack-and-architecture-selection.md#adr-034-focused-full-page-domain-layouts-over-shared-host-state).

- [x] Give Photos/Music full-page composition selected by compiled metadata,
  with compatible direct links and no permanently expanded generic rail/tools.
- [x] Keep management, trusted status, shared search and original actions
  reachable; active restrictions and incomplete listing states stay legible.
- [x] Refine readable light/dark domain content and concise Music batch actions
  without changing their displayed-scope counts, omissions or transient queue.
- [x] Accept the integrated browser journey at 390/1280: direct links, controls,
  shared player through navigation, guarded drafts, scope and original actions.

Executable evidence: [local full-page acceptance](../technical/full-page-domain-layouts-acceptance-20261012.md)
records the captured light/dark layouts, one-player source/position retention,
filtered selected append, client home/management/search navigation, actual
cancelled Notes confirmation and SHA-256-matched browser original download.
The final build, registry/i18n checks, broad Go run and served-byte verification
passed. Large-library, real-device and all fault branches remain outside this
acceptance; existing incomplete-listing rendering was preserved rather than
re-qualified on the large corpus.

Header refinement of the same UX-D1 slice:

- [x] Replace the stacked search/navigation strips with one compact host
  capsule and separate in-domain display choices; keep standard Library chrome.
- [x] Accept disclosed search and management on keyboard and pointer paths,
  retaining field text, result scope, draft protection and the shared player.
- [x] Capture light/dark 390/1280 layouts and bind checks to the served assets.

Executable evidence: [immersive host-header acceptance](../technical/immersive-host-header-acceptance-20261012.md)
records eight final layouts, native search/history/operator visibility, all
three focus shortcuts, retained query text/scope, settings return focus,
cancelled Notes confirmation, visible browser-offline fallback/reconnection,
and the same unpaused original across Music → Photos → Music. Build,
registry/i18n, broad cached Go, served-byte identity and whitespace checks pass.

Implementation has been delegated through DeepSeek Harness to the explicitly
selected `sub2api / deepseek-v4.1-flash` route. Primary review and local browser
acceptance are recorded above. This row grants no album/playlist, runtime package, new query,
core-phase or release completion.

This ledger now tracks the parallel RW-PERSONAL-UX-1 client cohort admitted by
[ADR-025](../technical/build-stack-and-architecture-selection.md#adr-025-admit-dedicated-personal-client-workflows-without-a-new-media-service)
and specified in the [first-party client contract](../requirements/first-party-client-experiences.md).
Three Luna implementations covered Photos, Music, and named retrieval in
parallel; the primary agent owns shared integration and browser acceptance.
The photo/audio sub-plan retains its historical proposal, but its current
status follows this admitted profile. Local browser evidence does not close a
core phase or release gate.

### 1. Return to named content — implemented slice, partial browser scope

- [x] R1.1 Open saved retrieval through the library UI without selecting a file or opening Export.
- [x] R1.2 Save the supported quiet query and `suffix:wav` condition with workspace scope through existing view operations; refuse unsupported conditions such as `type:audio` instead of silently broadening the saved query.
- [x] R1.3 Recall through existing evaluation with lexical, dynamic semantics; the refreshed query returned two WAV matches and does not claim to freeze a semantic result set.
- [~] R1.4 Same-context refresh restored two matches; after confirming new entry C (identical bytes to A, 0 B new / 625 KiB reused), reopening the saved query returned three matches. The recalled display showed the stored format condition, and the recorded "resaving was blocked" came from the recall-state guard that forbids editing/re-saving a view while one is open (`LibrarySurface.tsx`), **not** from an unsupported condition: the stored form is the supported `suffix=wav` key, which `view_export_ops.go` implements and `supportedSavedFields` lists. An earlier wording that called that condition unsupported was wrong and is corrected here. An independent read-only audit on 2026-10-10 enumerated the failure matrix: malformed `fields_json`, a non-integer numeric value or a contradictory size range, and a scope whose workspace is gone all fail closed and visibly; a missing subject simply leaves the view's membership; an empty result reports `EMPTY`. Two paths were fail-open and are now closed: an unrecognized condition key and an entry with no `=` were silently dropped, so `view.evaluate` returned a wider unfiltered set as the view's membership and `export.plan` would freeze it. The kernel now refuses both as `invalid_input` at `view.save`, `view.evaluate` and `export.plan`; a focused Go test fails before and passes after, and the full server suite is green. Still open and reported, not fixed: recall-active is judged from the query text alone while the request also carries fields, so a plain re-search can leave the panel claiming the stored filters; the client hides a stored-but-unsupported condition from the operator; recall never compares the stored scope with the current workspace and `view.list` is not workspace-filtered; and `sort` / `output_names` / `when_missing` / `required_capabilities` are persisted but ignored at evaluation. Separate-context access (a fresh page, a second client, or a second workspace) remains unverified. Two client-side mislabels were reproduced in real Chrome on 2026-10-10 against an isolated fixture profile seeded with one supported view (`suffix=wav`) and one unsupported view (`format=wav`), and both are now recorded as open defects: (a) after recalling a view, a plain re-search submitted with the same query text re-ran without the stored conditions yet the caption `Live evaluation of saved view …` and the panel's `Saved filters …` both survived, so the displayed conditions no longer described the displayed results; (b) recalling the unsupported view failed correctly at the kernel (`view.evaluate` returned `FAILED`/`invalid_input` with `saved view condition "format=wav" is not supported by view.evaluate`, and that message did reach an alert), but the previous view's success state stayed on screen unchanged — `Opened <other view> with current lexical results.` plus `Live evaluation of saved view "<other view>"` alongside that other view's 3 rows — so a failed recall left a success claim and result set belonging to a different view. **All of these are now fixed and independently re-verified** in real Chrome against isolated fixture profiles: the recalled projection is cleared by any successful search, so after a plain re-search the live-evaluation caption was gone (`captionCount=0`) and the panel fell back to the executed request's real (empty) condition list, ending the mislabel; a recalled view now hands the panel every stored condition, so an unnameable one renders as raw `key=value` with an explicit "Stored condition this build cannot label" marker instead of being filtered away; a view whose stored scope differs from the current workspace is flagged "Other workspace" in the list and its caption/outcome state that the results came from that stored scope rather than the workspace open here, without ever rendering a raw workspace id; and a failed recall now retracts the previous view's outcome, caption and rows, replacing the column with an honest failure surface that names the refused view, shows the kernel message verbatim, and explains that the stored conditions were refused rather than dropped so the view's membership is unknown — with the supported view still recalling cleanly (`ready`, 3 rows) as a control. The strictness change was regression-checked against real stored data on 2026-10-10: a saved view created before the change (`Luna QA 音频样例`) still lists, loads and evaluates — `view.list`, `view.get` and `view.evaluate` all `SUCCEEDED`, the panel reported `ready` with "Opened … with current lexical results", and the library returned its 3 matching rows — so refusing unrecognized conditions does not break a stored supported view.

**Observed exit:** save -> leave -> refresh -> reopen the named query and its
supported constraints without internal IDs. See the [2026-10-09 personal
experiences acceptance record](../technical/personal-experiences-acceptance-20261009.md).
View rename/delete and a second durable view store remain unimplemented.

### 2. Batch original takeout

- [x] R2.1 Admit UX-T1 for one workspace, existing `export.plan` item summaries, sequential authorized reads, 32 files/32 MiB per file/64 MiB total, frozen names and all-or-nothing browser ZIP preparation. It adds no streaming endpoint, format or server ZIP receipt; see ADR-027.
- [x] R2.2 Deliver an actual browser ZIP from explicit selections using the existing frozen manifest. Progress/cancel survives navigation to Music; server-directory export and large single-original downloads remain separate actions.
- [x] R2.3 Validate every selected/frozen identity and byte length before download. Actual browser cancellation during a 17-file batch produced a cancelled state and no download event during the monitored interval; helpers cover member failure, stale/malformed manifests, limits and URL/read cleanup. UI reports prepared/requested rather than claiming disk save.
- [x] R2.4 Independently extract the actual six-file browser ZIP, compare every name/length/SHA-256 with both the selected originals and persisted frozen manifest, including a zero-byte file and distinct `Shared.txt`/`Shared (2).txt`. Full streaming/large-library archive materialization remains a future contract.

The final client also completes an actual search -> select JPEG -> ZIP journey.
Search/SavedView result sizes are resolved only from matching loaded namespace
subject/entry/content identity before preflight; unknown or mismatched rows
remain refused. See [takeout/photo acceptance](../technical/takeout-photo-acceptance-20261009.md).

**Entry:** reviewed contract/admission, not an informal rename of an existing
download. **Exit:** one ordinary select -> review -> download -> use journey.
Existing bulk tags and server materialization are reused, not counted as new.

### 3. Dedicated photo experience — implemented slice, partial journey

- [x] P0 Admit the local wall/viewer slice under RW-PERSONAL-UX-1; keep processor, fact, and durable album contracts separate.
- [x] P1 Render a distinct image-first Photos page over shared loaded subjects, with shared selection, tags, Details and original access.
- [~] P2 Provide adjustable wall density, responsive layout and loaded-format filters with original result mapping. Browser acceptance exercised density 3→5 and PNG filtering. Capture-date/source context and date controls are not implemented because no admitted photo facts supply them.
- [x] P3 Provide continuous current-result next/previous, fit/actual-size, keyboard operation, Escape focus return, and honest preview failure states. A generated 900×600 PNG decoded in the final canvas; ArrowRight advanced, Escape closed and restored focus to the opening item. The remaining keyboard/touch matrix and the multiple real-photo cases are now covered by a real-browser pass on 2026-10-10 (installed Google Chrome driven by Playwright against the isolated QA profile's 7 real PNG/JPEG subjects, including a 1800 px JPEG/PNG, a 5000 px over-pixel PNG and an EXIF-oriented JPEG): every subject rendered an image with no silent blank; pointer drags advanced/returned, clamped at both ends, and ignored a 30 px sub-threshold drag and a vertical-dominant drag; the same matrix passes under real touch input (`Input.dispatchTouchEvent` in a `hasTouch` 390×844 context); Escape closed the viewer and returned focus to the opening card. Verifying this found and fixed a real defect: the fit / actual-size controls had swapped `disabled` conditions, so "Fit to window" was disabled while at actual size and actual size was a one-way trap; each control now disables only while it is already the active mode.
- [~] P4 Preserve the 1 MiB legacy thumbnail and 8 MiB inspector limits. The separately admitted UX-P2 supplies visible-card transient PNG/JPEG renditions up to 8 MiB/12 MP; retained 1.1 MB JPEG and 3.8 MB PNG inputs rendered in Photos and Exhibition, including one native EXIF-oriented JPEG and an over-pixel fallback. Larger images and retained derivatives remain open.
- [x] P5 Browser evidence covers the generated-PNG wall/sequence and Photos at 390×844 with document client/scroll width 375/375. Details and the shared original-download action were reached, but no download event fired within 15 seconds; original takeout was **not accepted**. Root cause found and fixed: `downloadOriginal()` built the anchor `href` but never set `anchor.download`, so some narrow-viewport/mobile browsers treated the synthetic click as navigation instead of a save. Fix now sets `anchor.download`/`rel="noopener"` to match the existing `useOriginalTakeout.ts` pattern; `tsc --noEmit` is clean. The outstanding narrow-viewport re-run is now done (2026-10-10, real Chrome + Playwright at 390×844 with `acceptDownloads`): the ordinary library Details action fired a real browser download named `Empty.txt`, produced no same-tab navigation and no HTTP error; the same was repeated for a real photograph through Photos (`Large-landscape.jpg`, 1800 px JPEG) with the original filename preserved. Notes-flow coverage is tracked by the Notes/tag rows, not here.

**Exit:** a distinct, comfortable supported-photo journey. A generic image
filter, mock gallery or synthetic picture is not completion. Actual albums
require the grouping/domain contract; EXIF/magic facts are not invented from names.

**Complete Photos baseline, beyond the early viewer slice:**

- [~] PF1 UX-P2 implements bounded transient ordinary-photo renditions; no capture-time/EXIF/orientation extraction or retained derivative is added. Native browser orientation is presentation only. The remaining metadata/processor successor stays proposed.
- [ ] PF2 Admit curated album create/rename/member editing/cover/browse/export semantics without treating album removal as byte deletion.
- [~] PF3 Shared favorite star/filter uses the existing visible `Favorite` TAG across Photos, Music and Overview. Batch organization and useful supported metadata filters remain open; this is not album membership. Verified 2026-10-10 in real Chrome: the Photos wall showed `Large-landscape.jpg` starred and the Music surface showed one starred track (`Slow Morning`, Cairn QA Artist) through the same tag; the photo star survived a full page reload; the library's "Only favorites" control narrowed 17 rows to exactly 2 and reported `aria-pressed="true"`, matching the one starred photo plus the one starred track.
- [ ] PF4 Demonstrate import -> timeline -> find -> continuous view -> curate album -> original takeout, including mobile browse/upload and return position. The domain remains partial until this declared baseline works.

### 4. Dedicated music experience — implemented slice, partial journey

- [x] M0 Admit the bounded client playback contract; retain explicit size, identity, cancellation and format limits.
- [x] M1 Render track rows over shared subjects with filename, recorded size/format, tags, Details and original access; absent artist/album/artwork remain unknown.
- [ ] M2 No missing-metadata/artwork processor or enrichment path is admitted or implemented.
- [x] M3 Exercise bounded downloaded-original WAV playback with full length/SHA-256 verification, play/pause/seek/volume and visible controls while browsing Photos. This is local evidence for one tested WAV, not universal format support.
- [~] M4 Audio-helper canonical identity/hash/size/cancellation checks pass. Browser tested stop/remove/clear and retained the same Blob/time/duration through Showcase→Workspace→Showcase and Photos navigation; the active queue item cannot be removed. Code review confirms the removal-after-Stop path: `removeQueueOccurrence` refuses while a track is `current`, and the queue-row remove button disables with a "Stop playback before removing the current track" title (`AudioPlayer.tsx`); once `stop()` clears `state.track`, the same row becomes removable. Error/unsupported-format states (`unsupported-format`, `workspace-mismatch`, `track-unavailable`, `playback-permission`, hash/size/length-mismatch) surface through the player's status region and have zh-CN i18n strings in `musicExperience.ts`/`queueExperience.ts`. **Correcting an earlier claim in this row:** that region is a live `aria-live="polite"` region only when a queue notice is present (`AudioPlayer.tsx` sets `role`/`aria-live` conditionally on `playback.queueNotice`), so for an ordinary playback error the observed DOM had `role=null` and `aria-live=null` — the failure is not announced to assistive technology. That is a real open defect, not a description of working behaviour. Both live halves are now done. The removal-after-Stop half (2026-10-10, real Chrome): two occurrences of real WAV originals were queued, no item was current before playback, starting one marked exactly that occurrence current, its remove button was disabled with the title "Stop playback before removing the current track" while a non-current row stayed removable, Stop cleared the current occurrence and made that same row removable with the title "Remove from queue", and removing one occurrence removed exactly one entry (2 → 1). The unsupported-format half is covered by a new self-contained harness (`scripts/web-audio-unsupported-check.mjs`, exit 0 in both en and zh-CN): a real renamed non-audio original (a valid 165-byte PNG named `.mp3`) reached the player as an explicit error, the audio element stayed paused with `currentTime` 0, `readyState` 0 and its blob `src` removed, the toggle stayed "Play", the identity remained the attempted file, and the queue kept both entries with the attempted file still current and the other not marked playing - no silent skip and no advance. An independent oracle fed the same downloaded bytes to the browser's own decoder and got `MediaError` code 4 / `DEMUXER_ERROR_COULD_NOT_OPEN`, confirming the error is honest, while a real WAV played normally in the same player as a control. Two real defects were found in that pass and are now fixed and re-verified. First, an English locale rendered the internal code `unsupported-format` instead of a sentence, and the prepared English sentence in `musicExperience.ts` was referenced nowhere; the player now maps every typed playback code (including a parameterised `download-failed-<status>`, with an explicit generic sentence for any unregistered code-shaped token and pass-through for free-form prose) to a sentence that is itself the `t()` key, so English renders it and zh-CN resolves it, and the ten raw-code catalogue keys are gone. Second, the status element was a live region only when a queue notice existed, so an ordinary playback error was not announced; it is now `role="status"`/`aria-live="polite"` whenever it reports an error or a queue notice, and deliberately a plain element for the routine lifecycle text so ordinary play/stop transitions are not announced. Both are confirmed in real Chrome in en and zh-CN: the status shows the prepared sentence in each locale and carries the live-region attributes in both. The harness that found them now asserts those two properties instead of printing notes, and that assertion is not vacuous — pointed at the pre-fix bundle it fails with exactly `the error status element carried no role="status"/aria-live in en, zh-CN` and `the status region rendered an internal code instead of a human sentence in en: ["unsupported-format"]`, and against the fixed bundle it passes. Residual, recorded not fixed: adding `aria-live` to an existing node whose text changes in the same commit is less reliable on some assistive technology than a dedicated always-present empty live container would be, and moving to that shape needs `AudioPlayer.css` or a change to what the harness reads. The remaining error codes (`identity-unavailable`, `size-limit`, `length-mismatch`, `hash-mismatch`, `download-failed-<status>`, `empty-response`, cancellation, stale callbacks) still have only helper-level checks.

**2026-10-17 M4 continuation:** the conditional-live-node structural residual
above is addressed by [stable Music failure announcements](#stable-music-failure-announcements--bounded-implementation).
That candidate's corrected runner retains its failed Chinese WAV observation.
The separate [startup continuation](#music-startup-and-cancellation--bounded-implementation)
now passes decoded playback, same-original resume and controlled Stop/replacement
fencing in both locales. Keep M4 partial for its remaining failure matrix;
neither newer evidence nor a stronger waiter rewrites the earlier failed runs.

- [~] M5 A 20-second WAV was decoded and exercised through play/pause/seek/volume; seek to 19.9 s advanced to the next queued track. At 390 px, controls worked and the queue fit the 375 px document width. Original takeout was not observed, and Notes/tag flow and actual retained-song coverage remain unverified.

**Early-slice exit:** one bounded supported-track journey has local evidence.
This does not complete the Music domain.

**Complete Music baseline, beyond single-track playback:**

- [~] MF1 Existing `audio.list` facts now drive artist/album/track browsing, with filename/unknown fallbacks, manual fact refresh and recorded track-number order for selected known albums. Tagged MP3 samples were browsed and played locally. New extraction/artwork, disc/compilation support and complete coverage remain open; see the proposed RW-MEDIA-2 contract.
- [x] MF2 Transient loaded-set playback, reorder, one-shot upcoming shuffle and repeat off/all/one are implemented for UX-M2. Local MP3 evidence covers supported-set start, position-preserving reorder, repeat-one completion/manual Next and shared player navigation; deterministic helpers cover shuffle/repeat boundaries. Active-item removal requires Stop. This row is transient queue scope, not durable playlists or universal decoding.
- [ ] MF3 Admit and implement reusable ordered playlists, including create/rename/edit, repeat occurrences, missing-member handling and recovery/migration semantics.
- [~] MF4 Shared `Favorite` TAG shortcuts are implemented across Music and the other first-party views. Retained session where admitted, available local lyrics and mobile controls remain open; no fabricated facts or implicit network enrichment. The shared-tag read path is verified 2026-10-10 in real Chrome: Music renders a starred track from the same `Favorite` TAG that Photos renders a starred photo from, and the library filter reconciles to their sum.
- [ ] MF5 Demonstrate find artist -> open album -> continuous listening -> edit queue -> save/reopen playlist -> navigate other content -> control player -> take out originals. Keep queue, playlist, album, SavedView, LinkGroup and ExportManifest semantics distinct in one authoritative catalog.

### Open-ended page and interface successor

- [x] E1 Independently registered compiled pages and shell renderers reject ID/route/slot collisions; compatible Photos/Music aliases and Exhibition route resolve. This is trusted source registration, not a runtime plugin loader.
- [x] E2 Photo Exhibition navigates the complete loaded image context with at most five previews from the existing bounded thumbnail pipeline mounted. Real PNG browser checks cover selection, keyboard steps and 390 px layout; visual transforms stay on artwork so controls remain clickable. The [2026-10-13 gallery refinement](../technical/exhibition-gallery-acceptance-20261013.md) records centered first/middle/last images, ordinary-photo and unavailable outcomes under the existing UX-P2 limits, and refreshed light/dark layouts.
- [x] E3 Photos ↔ Exhibition retains shared subject focus, batch selection and an unsaved Notes draft. MP3 playback retains the same Blob/time through page switches. An isolated fault bundle exercises actual page/shell boundaries and one workspace fallback; it is not real-content or plugin-isolation evidence.
- [x] E4 ADR-026 and the source contribution guide record why the host stays authoritative and why whole shells are distinct from colors. Two DSH CLI Opus5.5 consultation turns are retained as advisory evidence.
- [ ] E5 Review and admit RW-MEDIA-2 photo renditions/facts/covers and curated album/ordered-playlist contracts, then implement their declared journeys. The successor proposal is ready, not admitted or delivered.

Evidence: [open-ended client acceptance](../technical/open-ended-client-experiences-acceptance-20261009.md).

### UX-C1 — grouped domain presentations over one returned-result scope

The normative successor is admitted in
[First-Party Personal Client Experiences §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope).
The implementation guide and architecture record are
[the contribution guide](../technical/client-experience-extension-guide.md) and
[ADR-028](../technical/build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition).
This is an implemented client refinement for the stated development scope;
[integrated browser evidence](../technical/domain-presentation-acceptance-20261009.md)
records the remaining unverified negative branch. It changes no backend
contract or phase status.

- [x] Group Photo wall and Exhibition beneath Photos while preserving their
  stable page IDs, existing routes and independent enabled/disabled preferences.
- [x] Keep keyword/tag conditions and returned result order through
  presentation switches; disclose returned-result facets and empty states,
  preserve all-types access and do not issue a second query.
- [~] Test old/unknown/disabled presentation routes, same-domain held work,
  the existing cross-domain Notes guard, and exact current loaded-row joins for
  supplementary lengths; stale or ambiguous tuples remain unknown. Routes,
  held work, scope projection and exact joins have current evidence. The
  existing cross-domain Notes guard remains in source, but CUA did not produce
  a deterministic cancellation result; that negative branch is not accepted.
  **That negative branch is now produced deterministically** (2026-10-10, real
  Chrome, no fault injection needed): with an unsaved Notes draft on an open
  Details panel, choosing the Activity rail entry raised `confirm("Discard
  unsaved note changes?")`; dismissing it left the view unchanged with the
  draft text still in the field, and accepting it navigated to
  `#v=activity` and cleared the draft. So the cancellation branch behaves as
  the guard intends. The render-fault branch was blocked, and is now unblocked:
  the harness was re-run on 2026-10-10 against a live isolated QA daemon and
  aborted before injecting anything —
  `[cairn-disposable-interface-render-fault] fault injector has one
  narrow InterfaceFrame entry point / 2 !== 1` — because `InterfaceFrame.tsx`
  had been refactored into a dispatcher delegating to `WorkspaceFrame` /
  `ShowcaseFrame` / `ImmersiveFrame`, so the injector's old anchor
  (`  const stateClasses =`) now matched twice while the harness still asserted
  exactly one. It was a stale harness, not a product failure. The injector now
  anchors on the two per-interface frame renderer signatures, keeps three
  fail-loud count guards (legacy marker === 2, renderer signature === 3, one
  match per target), and still injects nothing into `ImmersiveFrame`, matching
  the original. With that, a full run passes in both phases —
  `PASS: live interface state retention and held request` and
  `PASS: disposable render-fault recovery`, exit 0 — with the fault-injection
  build actually completing and its scenario evidence byte-identical across two
  runs (`showcase-only-once`: `faultAttempts=2`, `automaticRecovery=workspace`,
  `sharedStateRetained=true`, `mutations=0`; `persistent-shared-frame`:
  `faultAttemptsBeforeRecovery=4`, `explicitRetryAttempts=6`,
  `automaticRetryLoop=false`, `visiblePanel=true`, `mutations=0`; held-write:
  `mutationDispatches=1`, `committedNotes=1`, `duplicateMutationDispatches=0`).
  The existing 2–4 and +3 bounds were kept, not loosened; a useful consequence
  is that those bounds implicitly require the injection site to be the
  per-interface renderer (the shared dispatcher yields 12 attempts, 18 after
  retry). Still uncovered: `ImmersiveFrame`'s render-fault path, and this
  harness never exercises the Notes-guard cancellation above — that branch
  comes from the real-browser confirm evidence, not from fault injection.
- [x] After the shared-scope baseline, admit one fixed host Overview with
  read-only selectors, narrow host actions and globally shared resource
  budgets. Do not begin a free-form canvas or runtime extension framework.
- [ ] Keep the separate proposed RW-MEDIA-2 album/playlist/extraction
  successor behind its own recovery, migration and relation-design review;
  existing `audio.list` artist/album browsing does not imply new extraction.

**Exit:** preserve a real Photos wall or Exhibition through search and tag
filtering, switch to all types/Music without query loss or rerun, verify honest
returned-result counts, exercise route migration and safe tuple matching, and
retain same-domain focus/selection/Notes/player. Report route-level browser
evidence before changing any implementation mark above.

### UX-C2 — one fixed mixed-content overview

- [x] Register Overview as a browse layout separately from Photos/Music types;
  display bounded photo/audio/other sections from the same authorized result
  scope, with full-scope versus displayed counts and original selection indices.
- [x] Reuse shared thumbnail budgets, recorded audio facts, Details/selection
  and the one verified-original player. Navigation does not rerun search.
- [x] Resolve an enabled Photos presentation; disabled domains have no preview
  or playback actions and retain All types access. A valid destination clears
  only the corresponding presentation fallback warning.
- [x] Retain composed links through asynchronous restoration; render a pending
  state without broader results or thumbnails. An empty-query failure keeps
  the original link and permits a successful explicit search to recover.
- [~] Browser evidence includes mixed-content selection/Details/playback,
  shared paused playback through domain navigation, preference fallback,
  composed search/tag refresh and 390 px browsing without horizontal overflow.
  Offline/stale-request fault injection and the full mobile journey remain open.
- [x] Record the [durable album/playlist candidate design](../technical/durable-media-organization-design.md):
  album sets, ordered repeatable playlist occurrences, missing members,
  concurrency, portable publication/import and frozen export boundaries.
  This row is design delivery only; persistence remains **NOT IMPLEMENTED**.

Evidence: [fixed-overview acceptance](../technical/fixed-overview-acceptance-20261009.md).
The bounded client admission and decision are UX-C2 §11 and ADR-029. It adds
no backend operation, durable record, general block SDK or phase credit.

### UX-F1 — shared favorites through existing user tags

The admitted [normative contract](../requirements/first-party-client-experiences.md#12-ux-f1-shared-favorites-through-existing-user-tags)
and [ADR-030](../technical/build-stack-and-architecture-selection.md#adr-030-shared-favorite-shortcuts-before-durable-media-membership)
reuse the ordinary `Favorite` TAG and existing annotation operations. The
[local acceptance](../technical/shared-favorites-acceptance-20261009.md) records the tested
subset; it does not close the remaining failure, mobile or whole-domain journey.

- [x] Provide shared star/unstar and Only favorites across Photos, focused
  viewer, Music and Overview through one host-owned TAG state and callback.
- [x] Keep unknown/unavailable tag reads non-editable; preserve unrelated tags
  and Notes, and retain the explicit filtered empty state.
- [~] Browser persistence/filter/fault/mobile acceptance and focused helper/build
  evidence are limited to the cases listed in the local acceptance. Any missing
  exit case remains open; no helper-only result is promoted to full acceptance.
  Persistence, the shared-tag read path and the filter are now covered by a
  2026-10-10 real-Chrome pass (one starred photo in Photos, one starred track in
  Music through the same `Favorite` TAG, the star surviving a full reload, and
  "Only favorites" narrowing 17 rows to their exact sum); fault injection and
  the full mobile journey remain open.
- [x] Keep catalog TAG writes distinct from portable recovery freshness: a
  click does not immediately publish a new signed backup.

This shortcut is not album or playlist membership and grants no core phase or
release credit. Next, review and admit the independent durable organization,
recovery and export successors; then implement a playlist vertical slice before
albums. Do not reinterpret tags as a media schema or bypass LinkGroup Phase 4/5.

### UX-Q1 — occurrence-aware transient queue and Music batch actions

The admitted [normative contract](../requirements/first-party-client-experiences.md#13-ux-q1-occurrence-aware-listening-and-batch-queue-actions)
and [ADR-031](../technical/build-stack-and-architecture-selection.md#adr-031-occurrence-aware-transient-listening-and-music-batch-actions)
extend only the App-owned transient queue. Earlier MF2/UX-M2 checks remain
historical evidence for that narrower queue slice; they do not establish Q1.

- [x] Music actions append the currently displayed supported rows without
  autoplay; Play selected replaces and starts only the selected displayed
  supported rows. Hidden selections and unsupported omissions remain explicit.
- [x] Music opens the same global queue editor in track and artist/album views;
  no page-local queue or persistent playlist state is introduced.
- [~] Helper/build and TypeScript evidence are recorded by the integrated
  acceptance in
  [occurrence-queue acceptance](../technical/occurrence-queue-acceptance-20261009.md).
  The actual-browser repeated-occurrence journey and any failing/untested
  overflow, omission, refresh and navigation cases remain pending until that
  record confirms them. The repeated-occurrence journey and the navigation case
  are now confirmed live on 2026-10-10 in real Chrome: the same file was queued
  twice as two distinct occurrences with equal names, playing the first marked
  only that occurrence current (index 0, exactly one `.current`), the duplicate
  stayed correctly non-current and removable, removing the first repetition left
  exactly the other one, and the transient queue was unchanged across a
  Photos → Music domain navigation. The overflow, omission and refresh cases
  remain unverified.
- [x] Reject interpreting a protected playlist snapshot file as a native
  mutable playlist: upload/source identity supplies no stable current-head/CAS
  behavior. Persistent playlist semantics require their own organization,
  publication/recovery and export review; no new backend or phase is admitted.

**Next product sequence:** review the concrete curated-photo-album and durable
ordered-playlist design against signed publication/import and export contracts,
then admit a named durable slice before writes. Deliver save/reopen/use for each;
do not substitute tags, Notes or local storage for membership. The fixed Overview
was delivered first because it uses admitted current data without inventing a
durable authority. Further presentations and whole-interface shells reuse these
journeys. Runtime loading and a layout editor remain deferred.

### 5. Coherent groups and later depth

- [!] G6 Minimal LinkGroup and group-aware export successor: retain the Phase 4/5 gate and authenticated current-state/import requirements.
- [ ] Deliver the complete Photos/Music baseline above after explicit scope reconciliation; advanced photo discovery and device-listening capabilities remain in the recorded platform roadmap.
- [ ] Refine full interface experiences around these same journeys; palettes remain secondary.
- [-] Runtime plugin marketplace, multi-user tenancy, room synchronization, maps, radio/recommendations and neural compression are outside the immediate daily-use queue.

### Acceptance and stopping rule

Each implementation gets a short user demo, its phase/requirement/exit triple,
focused checks and one practical broad Go run for the integrated source cohort,
as AGENTS requires. Re-run only for relevant changes/failures. This todo changes
no feature status or phase matrix. Stop at the declared journey; do not add
small standalone polish rounds or unrelated platform/package experiments.

## Gates

### G3 — Recovery closure

- [x] Trusted anchor and clean-install import/reader — per the matrix
- [x] Cross-process publication fencing and unknown-outcome reconciliation — per the matrix
- [ ] Sparse extent maps admitted into the closure
- [ ] Broader per-field provenance
- [ ] Production repository qualification
- [ ] Release acceptance
- [x] Read the lock from its current execution-plan checkpoint: admitted trust-anchor and fencing implementations remain tested development evidence; wider release work stays open — see V2

### G4 — Discovery

- [x] Lexical and structured discovery for the stated field scope
- [x] Pinned ONNX/BGE encoder for the opt-in worker profile, with Darwin arm64 evidence
- [x] In-process zvec generation and query for the opt-in component profile
- [~] Fused default search — wired and covered by the provisioned supervised E2E
- [ ] Supported clean-host packaging of the semantic profile
- [~] Candidate package installation, restart, rebuild, and real-query evidence — 2026-10-05 Darwin arm64 real outer-package E2E passes for packaged CLI offline install and daemon restart/reopen plus Chrome Settings rebuild/default fused semantic query; full supported-host/browser installation and release gates remain open. See [dated evidence](../technical/semantic-qualification-results.md#automated-candidate-package-lifecycle-2026-10-05).
- [ ] Default-profile qualification

### G5 — Storage

- [ ] Select one candidate repository engine (none selected)
- [ ] Qualify lossless exact round-trip on that engine
- [ ] Measure net savings including indexes, thumbnails, models, caches, and retained sources
- [ ] Decide whether `local-zstd-v1` becomes the qualified compression profile

### G6 — Grouping and export

- [!] LinkGroup catalog schema — unauthorized before G4 and G5 close
- [!] LinkGroup public operation and subject-kind authorization
- [!] Group-aware export successor
- [!] LinkGroup browser workflow
- [!] Portable LinkGroup current-state record
- [~] Saved views and frozen export manifests — work end to end with exact receipts
- [ ] Stable subject and file-version binding in export v1
- [ ] Multi-component group paths in output naming
- [ ] Successor migration for export v1

### G7 — Release

- [x] Packaging — **closed 2026-10-12 for the candidate path, with the qualified
  bundle still open.** `scripts/build-offline-package.sh` builds the CLI and
  daemon with `-tags purego`, stages WebUI assets, and calls the existing
  `scripts/package-offline.sh`; `scripts/accept-offline-journey.sh` then
  extracts that artifact into a prefix that has never held Cairn, verifies all
  20 members against `checksums.sha256` (`OK` for every one), starts the
  installed daemon with no Docker and no first-query download, and reaches a
  healthy empty catalog (`publications=0`). The running instance names its own
  profiles rather than having them inferred: `directory-cas-dev-v1` +
  `identity-v1` + `STORE_EXACT` + `embedding_mode=local` /
  `bge-small-zh-v1.5` / `zvec` + `local-ed25519-v1` signing, with a
  `config_digest` the CLI reports identically, and `capability.list` naming the
  real `query.semantic.onnx-bge-zvec.v1` provider once the packaged offline
  bundle is installed (`semantic bundle install --archive`, one restart). The
  semantic provider honestly reports `UNAVAILABLE` before that install and
  `NOT_BUILT` after it, and never a fixture. What is **not** closed: the
  qualified default semantic bundle, redistribution review, the release SBOM
  (the artifact still declares `INCOMPLETE_NOT_RELEASE_SBOM` at
  `CANDIDATE_ONLY_NOT_SUPPORTED`), and non-Darwin hosts. See the
  [operator procedure](../technical/operator-install-backup-upgrade.md) and the
  [dated acceptance record](../technical/operator-journey-acceptance-20261012.md).
- [ ] Migration — **still open.** No released artifact from an earlier build was
  available to import, so no old-catalog, old-repository, or old-config
  migration was executed. The upgrade path was exercised against an
  existing *current* catalog and reopened `schema_state=CURRENT
  schema_version=27 binary_version=27` with nothing to migrate; that is
  evidence that this upgrade pair needed no migration, not that version-to-
  version migration works. One known hazard is recorded but not executed: a
  repository holding an ADR-033 part-bound record must be read by an upgraded
  binary, because an older binary refuses such a record outright.
- [x] Backup and upgrade — **closed 2026-10-12 for the candidate path.** The
  executed procedure backs up `config.toml`, `catalog.sqlite`, `repository/`,
  `recovery/`, `vectors/`, and `models/` with the daemon stopped, plus an
  independently retained `recovery export` reference and `recovery anchor
  export` anchor outside every prefix, and proves sufficiency by restoring into
  a **second** fresh prefix: 4 of 4 entries, a passing full-byte verify, and a
  source-vs-restore manifest comparison that is byte-identical. The stronger
  claim also holds: a catalog-free `--recovery-reader` over the repository plus
  the independent anchor reproduces the same exact bytes, and four negative
  controls fail closed — absent anchor (`exit 1`), tampered anchor (`exit 4`),
  a **structurally valid anchor from a different Ed25519 identity**
  (`exit 4`, which shows the retained anchor is the trust root rather than a
  file whose presence is accepted), and an absent reference (`exit 4`).
  In-place upgrade then replaces the installed pair with a freshly built one
  (`cairnd --version` before `v0.1.0-prealpha...dc34fc39`, after
  `offline-upgrade-v2`; binary SHA-256 changed), restarts on the **existing**
  data with the process stopped across the swap, and re-verifies
  `schema_state=CURRENT`, the same 4 entries, full-byte verification, recovery
  import, and a byte-identical restore. Two limits are recorded rather than
  hidden: the catalog must be backed up **quiesced** — measured on this host,
  `catalog.sqlite-wal` held 1,005,312 bytes and an online copy of only
  `.sqlite` reported 0 publications, while a clean daemon stop checkpointed the
  WAL to 0 bytes and the same copy reported 1; and `recovery.import` only
  reconciles a missing publication row against an **existing** namespace root,
  so a lost catalog is **not** currently rebuildable from the repository, which
  keeps the normative "catalog is a rebuildable projection" claim unproven
  rather than violated. See the
  [operator procedure](../technical/operator-install-backup-upgrade.md) and the
  [dated acceptance record](../technical/operator-journey-acceptance-20261012.md).
- [ ] Performance bounds — **still open.** No measured latency, throughput,
  memory, or net-savings bound was produced by this work.
- [ ] Full release acceptance

## SP-1 — Visual system and desktop shell `[~]`

**Implemented and tested, 2026-10-05:** bounded browser polish adds suffix-
derived type/format cues, localized size/type/format metadata, visible
Photos/Audio scope captions with keyboard details, and responsive toolbar
wrapping. Mixed synthetic-content E2E passed for 1496/1280/1199/1120/1024/707/390
CSS px with no horizontal overflow and the first content row visible; 1280 px
starts within 260 px. Build, web-i18n, Chrome online/offline/recovered, isolated
visual E2E, `git diff --check`, and the independently run purego Go suite passed.
Exact commands, screenshot coverage, fixture limits, and evidence boundary are
in the [decision brief](../technical/content-first-product-decision.md#bounded-browser-maintenance-evidence).
This does not close SP-1 or a normative phase/release gate.

Measured 2026-09-29 at 1280x900 after moving the space report and month picker
into compact heading popovers. The first tile was 363 px immediately before this
slice; the original baseline was about 560 px with 159 px tiles and 6 columns:

| Viewport | First tile | Tile width | Columns |
| --- | --- | --- | --- |
| 707 | 286 px | 112 px | 4 |
| 1024 | 222 px | 121 px | 6 |
| 1280 | 222 px | 119 px | 8 |
| 1496 | 222 px | 128 px | 9 |

- [x] First file tile at or before 260 px at 1280x900 — measured 222 px on 2026-09-29, then **regressed** as chrome accumulated. Re-measured 2026-10-10 before the fix: `SP-1 target failed: 1280px first tile is 399px (target <=260)`, exit 1, with 480 px at 707 and 399 px at 1024 / 1280 / 1496; on a phone the wall started at 633 px and the first file's name landed at 822 px, past the 844 px fold, which is the `web-first-use-e2e.mjs` assertion that was failing at 390×844. **Fixed and independently re-verified the same day**: `web-screens.mjs` now exits 0 with `SP-1 target passed: 1280px first tile at 231px (<=260)` and `no horizontal overflow at any captured width` (231 px at 1280, 389 px at 707, 453 px at 390), and `web-first-use-e2e.mjs` exits 0 with the 390×844 first file name at `nameBottom 695.97` (was 891.64) and 1280×900 at `413.81`. The change is presentation-only CSS: the phone header collapses from three stacked rows to two (166.4 → 102.4 px) and the library title plus its three browse-control groups share one wrapping row instead of stacking as three full-width blocks. Accepted tradeoffs of that density: phone top-bar action buttons are 36×36 (≥ WCAG 2.2 AA 24×24, below the 44 px Apple HIG target), the duplicated visible "Browse tools" caption is dropped at ≥641 px while the section keeps its `aria-label`, and the readiness strip's row height goes 26 → 21 px. Still open: the dark theme was not re-captured, the immersive page was only checked for horizontal overflow, and no real-device tap-target measurement was made.
- [x] 8 to 9 grid columns at 1280 px — 8 at 1280, 9 at 1496
- [x] Demote the `全部内容` heading from hero size — now 20 px
- [x] Let `系统字段` share the tag row instead of taking its own line
- [x] No horizontal overflow at 707 / 1024 / 1280 / 1496 CSS px
- [x] Remove the duplicated `内容库` eyebrow above the heading
- [x] Collapse the `UNKNOWN — 健康` banner — now a 26 px strip, was about 34 px
- [x] Move `空间占用` and `按月浏览` into compact heading popovers; expanding either does not move the content wall
- [x] Keep the loaded-listing scope caveat visible inside the expanded space report and timeline popover
- [x] Settings: group spacing at or below 24 px, side-by-side where the width allows — verified 2026-10-10 in real Chrome at 1280×900 and 390×844: the settings body computed `grid-template-columns: 204.797px 833.203px` (two tracks) at 1280 and a single `340px` track at 390, and no `.config-group` / `.config-advanced` / `.identity-disclosure` / `.config-notice` / `.config-section` computed margin exceeded 24 px across all six categories.
- [x] Every settings category fully visible under keyboard navigation — verified 2026-10-10 in real Chrome: all six categories (Appearance, Storage, Search, Notes, Recovery, Service) render visible with no `display:none`, `visibility:hidden` or null `offsetParent`, are keyboard focusable and non-disabled, and clicking each sets `aria-current="true"` with the matching section heading; the 390 px layout hides no category and has no horizontal overflow.
- [x] Settings config error — an instance problem, not a code problem: the preview ran on an ephemeral `/tmp` data root whose `config.toml` was cleaned away. The preview now runs on a durable data root

## SP-2 — Dense content wall, timeline, map `[ ]`

- [ ] Cursor pagination over `search.query` — **measured 2026-10-11** on a real 9,138-item library (`node scripts/web-large-library-check.mjs <image-folder>`): `search.query` for every recorded image (`filters.media_class=image`) returns exactly **1000 hits** in a **503,925-byte** response and offers **no** cursor, continuation, offset, page or total key. The client's own `type:image` search sends only `workspace_id`, `query` and `filters` — no limit and no cursor — and renders all 1000 returned hits, so it asks for and shows one truncated page. The result scope already says so ("These counts cover the returned results, which may be limited; they are not full-library matching totals."); the truncation is therefore visible, but it is not paginated and cannot be continued.
- [ ] Virtualized rendering for large result sets — **measured 2026-10-11 at 9,138 items** in real Chrome: the library wall holds **9,138 `.result-row` elements in the DOM, exactly the 9,138 items `content.list` reports**, and the Photos wall holds **9,100 `.photo-card` elements** for the 9,100 image-suffix items. Nothing is windowed: the whole library materializes (wall load 26,264 ms; JS heap 256.8 MiB used / 306.5 MiB total; Chrome process-tree RSS 749.7 MiB over 8 processes; the `content.list` response is 4,689,018 bytes requested with `workspace_id` alone). **Re-measured 2026-10-11 on the same real folder after the bounded-page and startup-sequence work, now at the whole 11,561 entries:** all 23 non-empty subfolders publish (ADR-033 lifted the per-publication entry ceiling), and the wall holds **81 `.result-row` elements** in the DOM for the daemon's 11,561 entries — windowing and the bounded first page both hold. Wall load **7,584 ms** against **21,368 ms** for the identical library and the pre-change bundle, page-load long tasks **1 (largest 91 ms, 41 ms blocking)** against **4 (largest 141 ms, 156 ms blocking)**, JS heap 30.0 MiB used, Chrome process-tree RSS 682.3 MiB over 8 processes. **The startup-sequence half of the cost was separate and is now measured per command** (`scripts/web-startup-breakdown.mjs`, same library, sequential, no browser): `status.get` **6,892 ms → 1,437 ms** (median of three) and `snapshot.list` **8,080 ms → 1,785 ms** for the identity projection and **2,044 ms** for the `latest` projection, while `content.list` (page 1, 115,393 bytes), `source.list`, `annotation.list`, `capability.list` and `job.list` all stay under 200 ms. Both slow commands walked **every** committed publication's part-bound manifest — 23 publications, 11,561 manifest entries, 85 MB of prepared-closure envelopes and 51 MB of entry parts — to report one count or one summary. `status.get` now counts authenticated commit markers plus each prepared closure head, and `snapshot.list` accepts a bounded `projection` (`identity`, `latest`) that leaves an entry-derived count **absent rather than zero**; `audio.list`, which walks every admitted processor artifact, is now read only when the Music or Content-overview presentation is selected.
- [ ] Stable scroll restoration when returning from a detail view — **bounded Photos/Music follow-up, 2026-10-16:** final UX-C1/D1 candidate restored the same selected subject with a scripted offset delta below 10 px after Details and cross-presentation return, including Music player continuity; 390 px Details open/close was checked for Photos. This is not evidence for the full Library/Overview surface or 10k-item acceptance; the broader SP-2 row remains open. See `dist/product-browse-position-20261016/acceptance-summary.json`.
- [ ] Thumbnails served as `ArtifactRef` through content access — still not implemented; a thumbnail remains a transient browser rendition over `content.open` + `content.read`. Measured 2026-10-11: the library wall issues **96 preview requests** for the whole 9,138-item load (the bounded 48-item eager window, two operations per image) and **0 more** while scrolling that wall to its end; scrolling the 9,100-card Photos wall to its end added **99** further requests, because a candidate above the 1 MiB automatic-thumbnail budget is read only while its card is visible. The bound is real; what is missing is a served `ArtifactRef`.
- [~] Timeline browsing over existing captured modification facts now offers loaded-year/month navigation, unknown-date filtering, and shared selection/takeout in Photos (2026-10-19 functional batch above); a fully grouped timeline and broader populated-date UI coverage remain open.
- [ ] Map aggregation from stored coordinates, with no new durable table
- [ ] Exit: a 10k-image fixture wall scrolls without full materialization — **fails as measured on 2026-10-11.** The largest library reachable from the operator's real 1.8 GB / 11,561-image folder under the 16 MiB per-publication bound is **9,138 entries**: 20 of its 39 immediate subfolders published, 16 were empty, and 3 were refused by `plan.ingest` for 836, 780 and 816 entries (their image-only subdirectories hold 831, 775 and 811 files and are still above the bound), so 10,000 items was not reachable without splitting an over-ceiling folder, which this measurement did not do. At 9,138 items the wall rendered every item (see the virtualization row) and did scroll its whole 203,463-pixel height with real wheel input in 11,229 ms, but that scroll produced **70 main-thread tasks over 50 ms (largest 520 ms, 4,734 ms total blocking, largest frame gap 517 ms)** and opening Details on a visible row cost **5,654 ms to click plus 1,112 ms to render**. The "without full materialization" half of the exit test is false, and the wall is heavy even where it does work. **Re-measured 2026-10-11 at the full 11,561 entries with `node scripts/web-large-library-check.mjs "$HOME/Downloads/Pinterest"`, before and after the startup-sequence change and against one identical kept library:** wall load **21,368 ms → 7,584 ms**; page-load long tasks **4, largest 141 ms, 156 ms blocking → 1, largest 91 ms, 41 ms blocking**; the library wall scrolled its whole 257,552-pixel height with real wheel input (86 steps, 5,664 ms → 6,363 ms, bottom reached both times) with **1 long task, largest 64 ms → 0 long tasks** and largest frame gap 50 ms → 33 ms. The "without full materialization" half is still false — the DOM is windowed to 81 rows, but the wall still holds the whole loaded listing in JS and 48 thumbnails are still read eagerly — and **the post-scroll Details click fails identically before and after** (`locator('.result-row').first().locator('.result-open-copy').first()` times out after 30 s once the scroll reaches the bottom, because the harness falls back to row 0 when its visible-row probe returns -1 and the windowed wall no longer mounts row 0). That failure is pre-existing and unrelated to this change; it is recorded rather than papered over.

Current limit: explicit image inspection handles PNG, JPEG, GIF, and WebP up
to 8 MiB after complete byte verification; automatic thumbnails remain 1 MiB
and text remains 64 KiB. Larger content keeps the existing original-download
or export route. This is the bounded inspector, not an album surface.

## SP-3 — Ingest and workflow closure `[~]`

- [x] Similar-candidates daemon scan and grouping
- [~] Similar-candidates browser surface
- [ ] Query by image (Phase 4)
- [ ] On-demand AI notes through the egress gate (Phase 4)
- [x] Existing bounded loopback upload — 2026-10-05 Chrome checks file selection and library drag/drop, daemon-reported identity, staging outside protected content, and explicit digest-bound exact save. Server-folder review remains available. Transport bounds stay with the normative API contract; the historical ADR-013 proposal does not override them. See [core preview evidence](../technical/core-preview-acceptance-20261005.md).
- [x] Single-file original download — scoped existing content sessions, full identity checks, bounded native browser download, visible refusal, cancellation/reader tests, and 390px actions; no bulk/group export qualification credit.
- [ ] Honest unavailable states on every new surface

## SP-4 — Retrieval quality `[~]`

- [x] Correct the stale V4 narrative using implementation and current local evidence — see V1
- [x] Verify the embedded Unihan table, input digest, and generator; retain Unicode License V3 notice without regenerating the data
- [x] Existing pinyin and initial tokens in the lexical feed
- [x] Isolated real daemon: `lvxing` / `lx` finds the intended `旅行` subject; `西湖` / `xihu` matches inside `杭州西湖的备份方案备忘`
- [x] Coverage vocabulary and lexical profile digest unchanged by the attribution correction
- [~] Positive duplicate/locator, structured/fused, segment, and rebuild checks remain separately scoped; the full Phase 4 gate is open. See [current local evidence](../technical/local-completion-acceptance-20261006.md).
- [x] Lexical source explanations respect selected fields and preserve Chinese/pinyin/initial provenance on the same index; real daemon 9-query regression passes. Long split-document and accent-token provenance remain open. See [retrieval and accounting acceptance](../technical/retrieval-and-accounting-acceptance-20261006.md).

## SP-5 — Music experience pack `[ ]`

- [!] Blocked on G4 for audio facets and G6 for collections
- [ ] Audio metadata as declared, versioned, namespaced fields
- [ ] Mood as a durable user tag plus a saved query preset
- [ ] Radio behaviour as a query over listening history and co-listening
- [ ] React library surface borrowing the reference visual language
- [-] A player inside the daemon; a learned mood or energy classifier; a new audio codec; multi-room sync; adaptive streaming; external acquisition; DRM

## SP-6 — Music video link `[ ]`

One link per track: a local video subject, or an external reference. This is a
small durable field, not a subsystem, though adding a durable field still
passes the ordinary schema checkpoint.

- [ ] Record the link: a relation to a local video subject, or an external reference
- [ ] Local video matching: filename contains the music filename, or the track title plus first artist, or the video id in the comment tag or filename, ignoring symbols and whitespace
- [ ] External reference rendered through the provider's official iframe, labelled external and unprotected, and showing unavailable instead of substituting another source
- [ ] One player surface: switching cross-fades into the video with the artwork reused as a blurred full-bleed background
- [ ] Exit: a linked local video is found, protected, verified, and restored; an unreachable reference substitutes nothing
- [-] Download, cache, re-host, or anti-leech and referer circumvention; external streams inside the recovery closure

## SP-7 — Photo and album experience pack `[ ]`

- [!] Blocked on G4 and G6
- [ ] Dense wall from SP-2
- [ ] Album-fill suggestions, each carrying its reason, with batch-scoped undo
- [ ] Deletion triage with protected classes unchecked by default
- [ ] Exit: nothing pre-selected; similarity never establishes identity and never authorises deletion
- [x] Boundary settled: adjacent products stay clients and no durable state is duplicated (ADR-014)
- [-] A duplicated photo-management stack; face recognition; automatic sharing; destructive normalisation

## SP-8 — Listen and watch together `[ ]`

- [!] Blocked on V4: the reference app's synchronisation protocol and a self-hostable server are unverified. D5 settled that it stays a client capability (ADR-015)
- [ ] Keep the first cut simple: one host, a few guests, drift correction only
- [ ] Research the protocol and a self-hostable server before scheduling
- [ ] Client-side ephemeral room and presence state
- [ ] Position and drift coordination only
- [ ] Exit: two clients stay within a stated drift bound; stopping the sync service leaves local playback correct; no durable row and no core command added
- [-] Room state in the daemon; any durable room, catalog, or recovery state machine; Cairn as a streaming service

## Verification and honesty

- [x] Install Playwright and add `scripts/web-screens.mjs` for self-serve visual capture
- [x] V5 — An opted-in `scripts/web-e2e.sh` now fails nonzero for missing prerequisites or Playwright before builds. Explicit opt-out remains a visible skip. Current full browser results are recorded in [continuation evidence](../technical/local-completion-acceptance-20261006.md); old skipped runs earn no acceptance credit.
- [x] V6 — Ordinary Go success may include real-provider skips. The real daemon test also requires `CGO_ENABLED=1`, build tags `purego supervised_integration`, `CAIRN_RUN_SUPERVISED_ONNX=1`, and real model/tokenizer/runtime/zvec assets; verify a named test actually ran rather than accepting `[no tests to run]`; package and real-daemon query evidence is recorded separately from the broad Go run.
- [x] V7 — `server/internal/api/static.go` no longer freezes the startup copy. The validated in-memory snapshot is reassembled when the root's immediate children change, so a rebuilt WebUI is served with no restart, while a tree that fails validation is never served. Covered by `TestStaticHandlerServesRebuiltRootWithoutRestart` and `TestStaticHandlerKeepsLastValidatedSnapshotOnInvalidRebuild`, and proven live against the running daemon (create, rewrite, delete, and a full rebuild all reflected without a restart). See ADR-016
- [x] V1 — Replace contradictory V4 backlog prose with the implemented feed and dated real-daemon acceptance; no new profile or qualification claim.
- [x] V2 — The lock preserves the tested admitted Phase 3 profile and directs remaining release work from the execution-plan checkpoint. Do not repeat implemented anchor/fencing foundations, award release credit, or unlock Phase 6 from this ledger.
- [ ] V3 — Verify Musly's licence (Namida's EULA is confirmed and forbids reuse)
- [ ] V4 — Verify the reference app's synchronisation mechanism
- [x] Fix the `web-screens.mjs` layout heuristic, which measures the left nav rail and reports a constant 166 px — re-measured 2026-10-10 against a live isolated daemon: the reported symptom does not reproduce as described. `measure()` reads `.result-list:not(.list-mode) .result-row` and returned 635 / 480 / 399 / 399 / 399 px at 390 / 707 / 1024 / 1280 / 1496, not a constant; the 166 px figure matches the `header.topbar` height at 390 px, not a rail measurement. A different, real defect in that harness was found and fixed instead: it waited on the obsolete `.library-view-switch` selector and targeted `[data-view="photos"|"music"]`, which the current app does not render (the media switch is now `.library-presentation-navigation__domain[data-domain="cairn:photos"|"…:music"]`). Every media capture timed out, and because the settings walk runs after it, the settings captures were silently skipped too. Resolving the domains at runtime raised one run from 23 to 83 captures, including Photos, Music and every settings category. The harness now also reports its SP-1 enforcement instead of only printing it.

- [x] Frozen content fixture for the browser acceptance scripts — closed 2026-10-10 by `scripts/web-fixture-seed.mjs`, which builds a self-owned temporary profile, synthesizes its content deterministically in pure Node (three PNG, one of them a genuine 4096x3100 / 12.7-megapixel file over the client decode ceiling, plus a real baseline JPEG that macOS ImageIO reports as `format: jpeg`, three real PCM WAV files and one text file carrying 253 real bytes), ingests it through the ordinary `plan.ingest` + `plan.apply` path, stars exactly one photo and one audio track with the ordinary `Favorite` TAG after checking the tag list holds exactly those two, saves one view whose conditions this build supports after checking it evaluates to hits, serves the current `web/dist` with an absolute `--web-root`, and fails loudly on every missing prerequisite rather than skipping. It stops its daemon and deletes its temporary profile on success, failure and signal. Verified by running every acceptance harness against a freshly seeded instance: the eleven URL-driven ones and the self-contained `web-audio-unsupported-check.mjs` all exit 0, and cleanup was confirmed (listener released, no stray process, no temporary profile). Two limits are recorded rather than solved: the self-contained harness takes no URL, so the shape is eleven URL-driven plus one self-contained rather than twelve URL-driven; and because `web/dist` and `web/node_modules` are gitignored, a fresh checkout still needs `cd web && npm ci` (and a client build) before any harness can run, which the seed refuses on rather than fixing. The fixture ships no ONNX/BGE bundle, so its semantic search reports unavailable and must not be cited as semantic-retrieval capability evidence.
- [x] Real semantic retrieval verified end to end — 2026-10-11. `TestSupervisedONNXSemanticQualification` passes against the real pinned BGE bundle through the real supervised worker path: status PASSED, profile `bge-small-zh-v1.5`, dimension 512, eight corpus cases, **Recall@1 = 1 and Recall@5 = 1**, query P50 23.6 ms and P95 39.3 ms at concurrency four, document batch 34.6 ms, worker startup 5.75 s, peak sampled RSS 371 MB, total 10.6 s. The test is opt-in by design (`CAIRN_RUN_SUPERVISED_ONNX=1` plus a bundle root), which is why earlier passes recorded it as unverified rather than passing. What blocked it was the Cairn rename: the bundle on disk declares `restoreweave.semantic-bundle.v1`, which the renamed admission path refuses. There is **no pinned profile digest anywhere in the tree** — the pins are per-asset content digests (model, tokenizer, runtime, zvec, ONNX C API header, zvec-go receipt) plus descriptor self-consistency — and the rename changes no asset bytes, so the bundle was migrated by rewriting **only** the schema discriminator in a copy under `/tmp`: all twelve assets were verified byte-identical to the source by SHA-256 before the run, and `dist/` was not touched. Two limits stay open and are not papered over. First, the installer and download path is still unverified here, because this environment cannot reach the model host (`curl: (35) Connection reset by peer`), so what is proven is the model, tokenizer, runtime and admission path, not provisioning. Second, the profile digest is computed over a payload that begins with the schema string, so the rename changed it; nothing in the tree pins it, but any release-pinned profile digest published later must be regenerated rather than carried over.
- [x] ADR-032 Stage 2a, presentation packages as pure data — implemented 2026-10-10 and verified against its own exit test. A theme package is one JSON document of design tokens: no JavaScript, no components, no CSS text, nothing executable. Admission (`web/src/lib/presentationPackages.ts`) is a pure function over the decoded document, the build-time-injected application version, and the ids already in use, and it returns either the whole package or one refusal carrying a stable code — there is no partial admission. Unknown manifest fields are refused, so a document declaring `css`, `script` or `components` is rejected whole rather than admitted with the executable-looking part dropped. The allowlist of forty-two design tokens plus a forbidden-value rule (`;`, `{`, `}`, `@`, quotes, backslashes, control characters, `url(`, `expression(`, `image-set(`, `javascript:`, `/*`, `!important`) is the security boundary: values reach the document only through `style.setProperty`, a property assignment that a value cannot terminate, so a package cannot position an overlay, load a remote resource, or open network access. A built-in id cannot be reused, so an installed package can never shadow a built-in palette. A stored theme id survives only when it is built-in or proven by admission, which closes the hand-edited-localStorage path into `data-theme`. Tokens written by the previous package are removed before the next apply, so a stale override does not outlive the package that declared it. Verified: typecheck and build exit 0; the i18n check exits 0 at 1869 keys; `scripts/web-presentation-package-check.mjs` exits 0 across admission, host-range refusal, an unadmitted token, a declaration-escaping value (observed external requests: none), a built-in id collision, a code-bearing manifest and an absent index, with the three built-in palettes working in every case; and the recovery and export path is unchanged — the saved-retrieval provenance check and the full first-use journey (stage, STORE_EXACT, name search, tag and Notes, tag search, Notes search, SHA-256-verified original download) both exit 0. The build-composition gap in the first cut is closed: the source of truth is now `web/public/presentation-packages/`, which Vite's public directory carries verbatim into the served root, so a client rebuild preserves installed packages instead of destroying them (proven by identical SHA-256 for the source and built index and theme files). `web/vite.config.ts` admits every source package during the build by calling the same exported `admitPresentationPackage` the runtime uses, so the logic is not duplicated, and it runs before the public directory is copied, so a refusal leaves the previous output intact. A refusal fails the build and names the file and the reason; verified for a host range the application does not satisfy, a package present on disk but absent from the index, an index entry listed twice, and a token value that could escape a CSS declaration. One polished example theme ships as a real selectable theme and as the reference implementation, `community:inkstone-indigo`, which sets forty of the forty-two tokens and is admitted and visibly applied. A package may now also declare one value set per appearance, so an installed theme matches a built-in palette's capability instead of rendering one palette under light, dark and system. The manifest keeps `tokens` as its only token field: a flat map behaves exactly as before, and a map whose keys are `light` and `dark` is read as two value sets. The discrimination is sound rather than heuristic because every admitted token name begins with `--`, so a bare `light` or `dark` key can never be a token. Both sets are required — declaring only one would occupy the theme id while leaving the other appearance to a built-in palette, which is partial application and therefore refused whole — and mixing flat token names with the two sets is refused whole. Every value set passes the same allowlist and the same forbidden-value rule through one shared path. The effective appearance, not the stored preference, selects the set, and tokens written by the previous apply are removed before the next, so a token declared in only one set disappears when the other appearance takes over. The example theme now ships a genuine pair (a paper-white light variant at 14.42:1 body contrast and the original deep-ink dark variant at 15.94:1) with four swatches. Verified in the browser: the same installed theme renders `--canvas` `#fdf7ec` under light and `#151109` under dark, paints text `rgb(36, 29, 18)` versus `rgb(246, 236, 217)`, and a token declared in only one set returns to its compiled value under the other. One recorded claim was disproved by measurement and corrected rather than left standing: an earlier note held that `color-scheme` stays dark under an installed theme's light palette, which would have left native controls dark. Measured, an installed theme reports `color-scheme: light` under light and `dark` under dark, because `base.css` derives it from `data-appearance` through a rule that is not scoped to a theme; the note was corrected and the behaviour is now asserted in the harness so it cannot regress silently. Stage 2b (interface shells as build-time code packages) and Stage 3 (untrusted runtime code, which needs iframe isolation and a signing story) remain unauthorized.
- [~] An internal id still renders in one diagnostic disclosure. `SettingsDialog.tsx` shows the raw `workspace_id` as the value of the "Runtime identity" advanced disclosure (its label was renamed to "Content scope" on 2026-10-10). It sits beside the configuration path, running and persisted digests, and the service socket, so it reads as a diagnostic panel rather than an ordinary workflow; the North Star forbids requiring users to know internal ids in normal workflows, which this does not. Removing or masking the value is a behaviour change and is left as a decision rather than done silently.

- [x] A single publication is bounded by one portable-record ceiling, and an unplaceable publication is now refused before any write instead of being launched and abandoned. Measured on a real library — 11,561 images, 1.9 GB, in one tree — the largest portable record that could be placed was 16,310,074 bytes for a 742-file batch, about 22 KB per entry, while a 775-file batch and an 831-file batch both failed with `UNKNOWN_EXTERNAL_OUTCOME` / `NEEDS_RECONCILIATION` and the message "portable record exceeds 16777216 bytes". The bound is `repository.MaxRecordBytes` (`16 << 20`), now stated normatively where an operator looks (`docs/requirements/content-store-views-and-exports.md` §3.2, `docs/requirements/cli-and-mcp-contract.md` §6) and still enforced at placement. It bounds **entries**, not stored bytes, because the closure carries per-entry facts rather than payload, so a thousand small text files fail exactly as a thousand photographs do; a fixed entry count is therefore not a usable sizing rule and none is implemented. `plan.ingest` and `plan.revise` now project the two entry-scaling records from the same captured facts the apply path uses (`projectPublicationRecords` in `server/internal/exact/recovery_publication.go`) and refuse as ordinary `invalid_input` before `ensurePlanningSource` writes anything, naming the entry count, the projected size, the limit and the remedy to ingest subfolders as separate sources. The prepared closure and the manifest-derived portable fact child are projected exactly (same builders, same JSON encoding, same-width placeholders for identifiers and digests that cannot exist before apply); the post-publication child also carries records that only exist after processing runs, so those are charged a measured 6 KiB per processed file — a conservative model, not a proof, that over-reports the manifest-derived part by at most 512 bytes. Verified: `go test ./server/internal/exact/ ./server/controlplane/` green, including a test that the projection equals the records actually placed when no processor is bound, a test that the refusal leaves no workspace, source, plan, job, publication, namespace, audit or repository record, and a test that a publication projected above 90% of the bound is still planned, applied and placed under it; on the real tree `cairn ingest` now exits 4 with "applying this plan would place a 258087737-byte portable recovery record for 11713 entries, above the 16777216-byte repository record limit; ingest subfolders as separate sources so each publication stays under the limit", and the same projection accepts the 742-file batch that really fit while refusing the 777- and 833-file batches that really failed. The workaround remains the remedy: `ensurePlanningSource` keeps one workspace named "default" and one source per root keyed `local-tree:<root>`, so subfolders ingested separately accumulate one library (23 batches for this tree, every one under the ceiling). Residual, by deliberate boundary: the ceiling is not raised and the closure is not chunked or merkleized, so a single publication above roughly 750 entries is now refused with advice rather than split; and because the post-publication child depends on processing that has not run, a capability that emits materially more per file than the measured profile can still reach the placement refusal, which stays as defence in depth. Lifting the entry ceiling with a chunked or merkleized closure is a separate, separately reviewed contract. Throughput is unchanged and separate: batched ingest ran at roughly five files per second, so a 100,000-item library remains an overnight job even when batched.
- [x] Lifting the per-publication entry ceiling — closed 2026-10-11 by ADR-033, which splits an oversized record into content-addressed parts bound by the already-signed logical digest, length and counts. One source root now publishes as one publication with one namespace root, so **no projection query, index key or migration changed** — the latest-root projection stays correct, which is exactly why the bounded-instalment alternative was rejected: an instalment is its own publication with its own root, and draining a real folder left the client and index showing only the last batch (measured at 152 of 888 published entries indexed). Measured on the real 11,561-file / 1.9 GB folder: one publication, one root, `content.list` reporting 11,561 entries complete, the lexical index READY over all 11,561, 25 parts with a largest of 16,711,479 bytes under the 16,777,216 limit, and a 1,233,030-byte recovery reference that a catalog-free reader verifies byte for byte across all 1,907,860,378 bytes. `MaxRecordBytes` was not raised, and a single logical item too large to split is still refused. One operator-visible consequence is recorded rather than hidden: an older binary refuses a part-bound record outright instead of misreading it, so a repository holding one must be read by an upgraded binary.
- [~] Harness note, not a product defect: `cairn config init` writes a config whose catalog and repository point at the standard user data directory (`~/.local/share/cairn`), which is correct default behaviour but means a scripted throwaway profile must pass `CAIRN_CATALOG` and `CAIRN_REPOSITORY` (or the matching daemon flags) or it will write into the operator's real library. A measurement run here did exactly that and placed 2.4 GB there before it was noticed; the directory was confirmed to hold nothing but that run's own sources and was removed. `scripts/web-fixture-seed.mjs` already does this correctly through those environment variables.

## Operator decisions

All five were settled on 2026-09-28 and are recorded as ADRs.

| ID | Decision | Outcome | Record |
| --- | --- | --- | --- |
| D1 | Upload limits and whether loopback uploads may run tokenless | No product-owned quota and no default size limit; one optional limit, unset by default; tokenless on loopback only, token required otherwise | ADR-013 |
| D2 | External video boundary | Official iframe embed only; never in the recovery closure | ADR-012 |
| D3 | Whether an adjacent on-device photo product becomes a client | Separate product acting as a client; no merged or duplicated durable state | ADR-014 |
| D4 | MV relation timing | Wait, and reuse the sidecar-of-media shape | ADR-012 |
| D5 | Whether SP-8 is in the product | In, as a client capability over a user-deployed service; never in the daemon | ADR-015 |

## Decision records

Settled items are recorded as ADRs in
[Build Stack and Architecture Selection](../technical/build-stack-and-architecture-selection.md#8-decision-records-adr-style):

| ADR | Decision |
| --- | --- |
| ADR-010 | Flexible domain fields without a second store |
| ADR-011 | One browser stack — borrow the design language, not the framework or the code |
| ADR-012 | External media is a convenience reference and never enters the recovery closure |
| ADR-013 | Upload channel bounds and the loopback token rule |
| ADR-014 | Adjacent products stay clients; durable state is not duplicated |
| ADR-015 | Together-mode is a client capability over an external synchronisation service |
| ADR-016 | The WebUI snapshot is revalidated when its root changes |

## Out of scope

Players, readers, and transcoders inside the daemon; mount or network
filesystem services; an OpenList fork; new index dimensions; richer
Collections; automatic external acquisition; source deletion; destructive
garbage collection; third-party video streaming inside the daemon; scraping or
re-hosting third-party video; a second live metadata store or any NoSQL
document database.
