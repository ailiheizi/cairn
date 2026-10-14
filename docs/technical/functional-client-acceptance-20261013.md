# Functional client continuation — 2026-10-13

Status: informative local development acceptance record. It grants no core
phase or release qualification. The parent Library, Photos and Music journeys
remain partial. The operator selected missing functionality before further
visual redesign; [ADR-041](build-stack-and-architecture-selection.md#adr-041-complete-useful-client-operations-before-further-visual-redesign)
records the decision and the [functional target map](content-first-product-decision.md#functional-target-map--2026-10-13)
retains the complete-domain dependencies.

## Scope and checkpoints

Local Luna agents audited and implemented disjoint scopes. The primary agent
reviewed the source against the retained pre-slice baselines, requested
corrections, and owns this evidence record. Earlier dirty work was preserved;
no commit, backend endpoint, durable schema, processor, index, runtime loader
or recovery format was added.

| Active phase | Normative requirement | Executable exit |
| --- | --- | --- |
| RW-PERSONAL-UX-1 client maintenance, UX-M1/M2/Q1 | Existing recorded audio facts, bounded verified original playback and one occurrence-aware transient queue | Sort/filter the loaded Music scope, keep selection mapped to original subjects, insert D into A/B/C as A/D/B/C without restarting A, and retain atomic queue capacity |
| Bounded API/WebUI client maintenance, UX-F1 | Content-store §2 multi-value Annotation.TAG; shared current selection; complete reads and expected revisions | Select an inclusive displayed Library range; add/reuse/remove a chosen TAG and Favorite on captured subjects, preserve unrelated facts, and refuse unavailable or incorrectly bound reads |
| RW-PERSONAL-UX-1 client maintenance, UX-P1/C1 | Existing focused photo inspection and host-owned selection | Select/deselect inside Photos and Exhibition inspection, retain the shared count, close inspection and reach the one existing batch-action region |
| RW-PERSONAL-UX-1 client maintenance, UX-R1 | Existing dynamic SavedView retrieval with truthful refusal/scope | Open the existing panel directly from File/Overview, recall a supported saved query, retain save restrictions and existing error outcomes |

## Reviewed implementation

Music supplies local title/filename, artist, album, track-number, duration and
size order. Unknown facts remain last in either direction and stable ties use
the original result order. Its availability filter reports eligibility to
attempt bounded playback, not a guarantee of browser decoding. Row actions
retain original host indices. Queue menus offer append and insert-next,
close after choosing an action and return focus to the menu summary.

Insert-next reuses the existing queue preparation/identity guard and remaining
1,000-entry capacity. It creates a distinct occurrence, inserts after the
active occurrence (or at the front when unqueued), and does not restart or
replace the active original. The queue remains transient.

Shared batch organization reads each subject's complete current annotations,
validates workspace/subject/revision binding, skips already-present exact
tags, and removes matching TAG records with expected revisions. It preserves
other tags and Notes, rereads results, reports partial/degraded/unknown
outcomes and stops later writes when reconciliation is required. Favorite
uses the ordinary invariant `Favorite` TAG. Follow-up reads cannot overwrite
a newly opened different Details subject. A successful shortcut cannot clear
an unrelated tag draft. These operations make no immediate portable backup or
publication claim.

Photo inspection toggles the current original result index in the shared
selection. Its count uses selected items across the host scope. Viewer and
Exhibition batch-action links close inspection and scroll/focus the existing
SelectionBar; they create no second selection or export flow. Missing subject
identity disables selection. Existing hidden/unresolved-selection notices and
all image read budgets remain in force.

File and Overview expose Saved retrieval directly; Photos/Music retain it in
their existing Library tools disclosure. The same panel and existing view
commands supply all save/recall behavior, including failed-recall retry access.

## Evidence and limits

Evidence is retained under
`dist/functional-completion-20261013/validation/`. The initial v2 served build
passed build, i18n and page-registry checks; its Music sorting/eligibility,
insert-next order plus active Blob/paused position, and inclusive Library
range have bounded headless-browser evidence. The practical broad
`go test ./...` passed once for the cohort. Integrated acceptance continued
on 2026-10-14 using the final v5 candidate; earlier raw failed compound
attempts remain retained and are not reported as aggregate passes.

The locally retained QA report at
`dist/functional-completion-20261013/validation/qa-report.md` records the final
independent cases. Build, i18n and page registry checks
passed. Served JavaScript `index-UJIqPBk2.js` is 982,845 bytes with SHA-256
`46eef12de591338652c29f9879a211c6536e61da4db589ae0525b6d0c3f612f4`;
stylesheet `index-D6Fkemuv.css` is 300,372 bytes with SHA-256
`43565e31633442335416141e4db4ef1d280be2564340c3c74fde8a7da73bae6c`.
Both match the actual localhost response byte-for-byte.

| Bounded result | Evidence and boundary |
| --- | --- |
| Implemented: sorted Music keyboard actions retain subject mapping | v5 trace moves from displayed B (original index 1) to A (index 0) after two animation frames, keeping B selected; all seven sort fields and unknown-last behavior have focused helper assertions |
| Implemented: insert-next preserves the active original | v2 browser sequence A/D/B/C retains the verified Blob, paused state and 1.25-second position, then manual Next starts D; final v5 menu append closes/refocuses without autoplay |
| Implemented: inclusive ordinary-Library range selection | v2 sorted rows 2–5 selected inclusively; no range semantics were added to locally filtered domain rows |
| Implemented: captured-selection TAG/Favorite operations | v5 two-subject add/re-add/remove preserves annotation identities, baseline Notes/tags, previous Favorite state and unrelated draft; test annotations were cleaned up and final snapshots matched baseline |
| Implemented: refusal on unavailable or incorrectly bound complete reads | Two injected-only v5 browser cases each read 20 subjects, visibly refuse DEGRADED or foreign-workspace records, and issue zero annotation writes; executable script and request trace are retained |
| Implemented: inspection-to-batch-action path | v5 Photos viewer and Exhibition inspector each select two image subjects, show count 2, close inspection and focus exactly one existing host batch-action wrapper |
| Implemented: daily retrieval entry and media save guard | Standalone read-only v5 evidence recalls the existing Tone query with its live caption and three current rows, then finds the Overview entry; the opened Music tools panel exposes the media-scope refusal and disabled Save view. Its loaded-scope check did not exercise a previously submitted query combination |
| Implemented: bounded responsive access | v5 Library/Photos/Music have no page/body horizontal overflow at 390/1280; separate opened-tools measurements confirm actual button-center pointer hits at both widths |

The suspected hidden Music retrieval trigger was a test setup error: the
native disclosure was closed. Opening it before checking child visibility
proved reachable controls; no CSS change was needed. The primary reviewer
also inspected the retained Photos/Library screenshots.

Final focused Music metadata and playback-queue helper checks passed. A stale
literal callback-spelling assertion failed first; it was removed along with
its behavioral PASS claim, and the remaining metadata/ordering/eligibility
checks passed on rerun. The initial failure remains retained. No application
source or served asset changed for that checker correction. Final
`git diff --check` passed; the checkout remains uncommitted at base HEAD
`3a46229c835cb52b8bc5442361a5caf1db120b42` with the prior dirty work preserved.

Residual validation remains explicit: real UI saturation through all 1,000
queue occurrences, switching Details subjects during an in-flight batch,
transport-uncertain write reconciliation, and the media-save guard combined
with a previously submitted query were not exercised. Existing pure queue
capacity checks and reviewed guards are not substitutes for those browser
journeys. These limits keep the parent domains partial; they do not erase the
tested client capabilities above.

Tests use the retained isolated 20-item local fixture and headless Chrome via
Playwright, not native desktop CUA or a real NAS. Fixture browser evidence
does not qualify semantic search, a repository provider, recovery, another
host or release. Fault-injection results are labeled injected-only. Curated
albums, durable playlists, new media facts, streaming/transcoding, video/anime
and LinkGroup are not implemented by this client continuation. Their separate
contracts and gates remain in the functional target map.
