# Mixed Content Selection and Takeout Acceptance, 2026-10-15

> Informative local development evidence for PC-01 and PC-11B. This does not
> change admission, phase order, durable records or release qualification.
> The [core execution plan](core-mvp-execution-plan.md) remains authoritative.
>
> The [loaded-scope successor](#loaded-scope-successor) is the latest client
> cohort. Earlier build hashes and implementation details below describe their
> original cohorts and are retained as historical evidence.

## Shared selection across search presentations

**Implemented and tested:** a submitted mixed-content search keeps the same
temporary subject selection when moving between Photos, Music and all types.
Music discloses selections outside its displayed tracks; its playback actions
continue to use only eligible displayed audio. A replacement search drops a
selected subject that is absent from the new result scope.

The reproduced defect had two causes in `web/src/main.tsx`: presentation
navigation explicitly cleared selection, and a separate effect pruned it
against rendered media cards. The correction removes the search/tag navigation
clears and skips that media-card pruning only in search/tag mode. Existing
`useSelection` pruning against `library.hits` remains the result-scope boundary.
Draft guards and ordinary listing behavior are retained. No new selection
authority, persistent collection, endpoint or recovery meaning is introduced.

Active track: RW-PERSONAL-UX-1 UX-C1, parallel to Phase 4/5. Normative basis:
[first-party client §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope)
and [explicit-selection export](../requirements/content-store-views-and-exports.md#73-exportmanifest).

### Search-only cohort build and browser exit

The existing preview at `http://127.0.0.1:4648/` remained on daemon PID 66042.
The test used a fresh headless Chrome context and ordinary UI reads/selection;
it performed no annotation, configuration or original-content writes.

| Identity | SHA-256 |
| --- | --- |
| `web/src/main.tsx` | `778a54d428b1d305e900b041932189e3907b01324dabb7f10a94824397dd7770` |
| `scripts/e2e/search.mjs` | `7ef5b647c04093de2b4127d12a805d035e3ce2301650ea674e83f7a2ca38ab65` |
| Served `/assets/index-C4tfKwbz.js` | `85d9b37111a98aec3fb32484b89f4e47f318c5678d16b15957314d69151d18ae` |
| Served `/assets/index-DRBQWM39.css` | `d847dd232d3cc9aa6689423e9b51bb19f044b23f819c14db5860f7954b1a1fe0` |

`assertSelectionFollowsSearchPresentations` passed with these observed states:

1. Submit `a`: HTTP 200 / `SUCCEEDED`, 20 ordered daemon subjects.
2. Photos: select `Cairn-Frame-Overpixel.png`.
3. Music: retain one selection and disclose its absence from displayed tracks.
4. Select `Tone-Alpha.wav`: retain both subjects; return to all types with both
   still selected. Presentation changes issue no additional search request.
5. Submit `a suffix:png`: HTTP 200 / `SUCCEEDED`, four PNG subjects and no WAV.
   Only the selected matching photo remains. There are exactly two search
   requests across the complete test.

The parent reviewed the slice against preserved dirty pre-slice files, the
request/response identities and five states, and independently compared served
asset bytes with the built files. `npm run build`, `node --check`, the
post-browser `GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` cohort, and
`git diff --check` exited zero. The Go cohort includes 27 passing packages;
it does not qualify the client or a release by itself.

Evidence is retained under `dist/mixed-project-closure-20261015/`:

- `selection-repro/receipt.json` and screenshots reproduce the original loss.
- `selection-fix/attempt-06.json` records the passing command, exit and hashes;
  `selection-continuity.json` retains both request payloads, ordered subject
  identities and the five selection states.
- `selection-fix/root-review.json`, `served-assets-final.json`,
  `web-build-final.json` and `final-checks/receipt.json` bind review and checks.
- Earlier failures remain preserved. A pure `suffix:png` query returned PNG
  results with `DEGRADED` status; that case is separate evidence and is not
  counted as the passing replacement-query exit. Locale selector failures and
  the first incomplete product fix are not relabeled as passes.

The corpus is a retained synthetic local preview corpus, not representative
retrieval-quality evidence. The browser exit covers search mode; tag mode
shares the corrected code branches but was not separately exercised here.
Ordinary loaded-library navigation, draft refusal and disabled-presentation
cases were not newly qualified. This closes the demonstrated selection defect,
not all PC-11B work or any core phase.

## Three-file takeout in an isolated profile

A separate profile under `dist/mixed-project-closure-20261015/profile` reused
copied, digest-checked daemon/CLI binaries and the retained local BGE bundle.
The existing seed recipe generated eight synthetic files; it was setup through
ordinary ingest operations, not evidence of browser intake. No owner catalog,
repository, recovery keys or private source corpus was copied. The private
listener was `127.0.0.1:4651`; the owner preview on 4648 remained running.

Luna used native Google Chrome through CUA for the mixed UI journey. It applied
the ordinary `Mixed Project` tag individually to `Cairn-Notes.txt`,
`Cairn-Frame-Small.png` and `Tone-Alpha.wav`, and saved a Note on the text file.
The retained daemon list responses confirm those records. Luna observed the
supported PNG preview, explicit original-audio playback and three retained
selections, then used the existing frozen export and server-directory output.

The exact takeout has independently retained evidence:

- Manifest `exm_3effad17ac98bcbbec5baa22a740e6fc`, digest
  `sha256:9ea0dc17ec3c82c044b8c3caaec4724682c31b08eb3d91eaa5889c7df5a27441`.
- `export.verify` returned `SUCCEEDED`, `verified=true`, three files and
  51,365 bytes at 2026-10-15 09:22:44 UTC.
- The parent independently read each source and materialized file, compared
  complete bytes and SHA-256/length against the manifest summary, and checked
  that the destination contained exactly those three regular files.

| Original | Logical bytes | SHA-256 |
| --- | --- | --- |
| `Cairn-Frame-Small.png` | 3,068 | `493f26e26053cb8a1691259b3ec0cb553f01b33e31d0e7653b3ec5f248251eda` |
| `Cairn-Notes.txt` | 253 | `276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73` |
| `Tone-Alpha.wav` | 48,044 | `2094357095772ca6165885bc74cd2c18493a7611f2d7c81e678f807785d14c12` |

The output is original file bytes only. No sidecar was selected or generated.
The newly added TAG and Note are confirmed current catalog facts; their
portability is not established by this export or by the initial seed
publication, which predates them.

### Evidence boundaries and remaining work

The mixed run was an observed UI walkthrough, not another retained headless
trace. Photo screenshots and player accessibility state were visible during
Luna's turn but were not saved as artifacts. The player observation was a
three-second original WAV with a visible pause control. That observation does
not supply an independently retained player Blob hash for this run.

Raw startup status, capability and listing receipts confirm the private local
semantic provider and index were `READY`. Luna reported a companion CLI query
using `query.broker.fuse.v1` and `query.semantic.onnx-bge-zvec.v1`, with eight
semantic hits and zero lexical hits. Its raw search JSON, exact command and
timestamp were not retained. These reported query details do not earn a new
semantic-query acceptance credit; the separately retained
[local runtime evidence](local-semantic-runtime-acceptance-20261015.md) remains
the source for that capability. This walkthrough is not representative recall
or quality evidence.

Manual work included three individual tag actions, one Note save, finding and
selecting the three files, presentation navigation, and choosing/reviewing the
output directory. Human elapsed effort was not instrumented. Existing batch
tagging was not exercised, so this does not establish that per-file tagging is
required. Tag-restricted SavedView persistence, changed Notes/source bytes
after freezing, annotation recovery and a new exact-restore exercise were not
tested. Unsupported media has no new support claim; the private image-model
capability was unavailable and only ordinary PNG preview was observed.

Retained evidence:

- `profile/logs/ui-note-tag-action-receipt.json`, annotation/Note readbacks and
  `ui-build-start.json` record the observed setup and actual served C4 assets.
- `profile/logs/final-export-list.json`, `final-export-verify.json` and the
  materialized files bind the exact output; `root-mixed-review.json` records
  the independent parent comparison and limits.
- `profile/logs/mixed-content-journey-final.json` is Luna's summary, not a
  substitute for missing raw query or media artifacts. Its tentative runtime
  ownership attribution is superseded by `preparation/root-cleanup.json`.

Preparation failures remain recorded rather than counted as passing runs:
an undefined task-runner helper, Darwin socket paths exceeding the local
limit, loss of an unreferenced child on launcher exit, and a still-valid
five-minute semantic lease after that exit. A reviewed short private runtime
path and ordinary same-profile restart after natural lease expiry resolved
setup without catalog edits, reseeding, model installation or owner restart.
The readiness summary's Web tree digest was an old preflight value; fresh
`ui-build-start.json` and parent-served C4 hashes are the current asset evidence.

The private daemon and worker stopped, 4651 was free, and the task tab closed.
The parent found no open files under the exact short runtime and removed only
its empty directories with `rmdir`. Owner daemon PID 66042 and its worker
remained alive. All private durable data and evidence were retained.

This adds exact-output evidence and a bounded mixed UI observation. Full PC-01
remains open: the observation and missing retained query/media evidence cannot
be promoted to a complete, reproducible product or release acceptance.

## Loaded-scope successor

**Implemented and tested:** ordinary loaded-library navigation now keeps the
same selection, inspected subject and unsaved Notes draft across Photos, Music,
Overview and all types. Returning through the Library rail entry has the same
behavior. This fixes a separately reproduced loss without requiring a search
first: one successful listing stayed unchanged while Photos selection vanished
on entering Music.

Selection now resolves and prunes against the existing `library.scopeHits`,
after host tags/facets/month conditions and before media presentation. The
duplicate pruning against rendered cards is removed. Navigation within the
same host scope changes presentation without resetting data or drafts;
registered legacy page modes normalize to the content scope. The guarded
replacement path for other contexts remains. Disabled-presentation fallback
also preserves selection by construction, but its preference UI was not
separately exercised in this cohort.

The active track is RW-PERSONAL-UX-1 UX-C1/C2, parallel to Phase 4/5. This uses
the existing first-party shared-scope and same-context retention contracts;
it adds no selection authority, durable state, endpoint, provider, processor
or recovery meaning.

| Current cohort identity | SHA-256 |
| --- | --- |
| `web/src/main.tsx` | `9d8a0540242dec83e14b2e43ddbaa2bad3400f08bcf56cc741fb0ac43e953bb2` |
| `scripts/e2e/library.mjs` | `83f026f4b3834c20b23e98e267775b62667687585892ff9c078eeec752f2a1e8` |
| Served `/assets/index-9s5LABc-.js` | `380effdd494f86cb9002faf58882ee47b97357875ef680df51fbd8d0a255016d` |

The CSS remains `index-DRBQWM39.css` with the hash recorded above. The owner
daemon stayed on PID 66042 / port 4648; no daemon, CLI or model rebuild or
restart was performed. Fresh headless Chrome contexts supplied these exits:

- Ordinary loaded flow: exactly one HTTP 200 / `SUCCEEDED` `content.list`,
  20 full identity tuples, zero searches. The selected PNG stayed selected in
  Music with hidden-selection disclosure; adding a WAV produced two selections
  that survived all types and Overview. Overview mounted only a bounded photo
  window: the off-window PNG was not falsely required to have a visible
  checkbox. Returning to all types exposed both exact selected names again.
- Host PNG facet: the actual scope narrowed to four rows and dropped the WAV
  selection. Clearing the facet did not resurrect that selection.
- Unsaved Note: the same photo subject and draft text survived Photos, Music,
  all types, Overview and the ordinary Library rail return. A Sources
  departure still displayed its confirmation; cancelling preserved the draft.
- Separate fresh search context: two HTTP 200 / `SUCCEEDED` queries returned
  20 then four PNG identities, retaining and pruning selection as intended.

The parent independently reviewed the complete source/test delta, actual
request/state receipts and selected tuples against the real listing. All 79
commands in the loaded flow were successful reads; there were no annotation,
export, configuration or workspace mutations and no playback. Web build,
focused browser exit, helper syntax, the existing result-scope check, broad Go
tests and diff checks exited zero. Headless contexts closed after the run.

Evidence under `dist/loaded-scope-selection-20261015/`:

- `repro/receipt.json` records the old loaded-scope loss on the C4 bundle.
- `acceptance/attempt-07/loaded-scope-selection.json`, its
  `search-scope/selection-continuity.json`, screenshots and `run.json` bind the
  passing command, real requests, identities, drafts and served assets.
- `source-review/` retains pre-slice source, the additional rail fix, builds
  and independent served-byte comparisons. `root-acceptance-review.json` and
  `final-checks/receipt.json` bind the parent review and exact check exits.
- Earlier selector, disclosure and localized-count failures remain separate
  failed attempts; they are not counted as passing product evidence.

This closes the demonstrated loaded-scope selection/draft defect. It does not
newly exercise player output, frozen export, recovery, preference fallback,
other shells, representative retrieval quality or release qualification.
Full PC-01, PC-11B and core phase gates remain open.

## Instrumented mixed-content successor

**Implemented client composition, bounded journey tested:** one fresh headless
Chrome context reused the private eight-file profile, existing `Mixed Project`
tags and one existing Note. It did not seed content, install models, or change
the owner profile. The active track is RW-PERSONAL-UX-1, parallel to Phase 4/5;
the exit combines the existing discovery, shared presentation and frozen exact
export contracts. It does not close a core or release gate.

The final served JavaScript is `/assets/index--raXH54O.js`, SHA-256
`51141ca453d6796c751fd4a35dfd4724687fdb2dda635242e35c56a5ec6756e7`.
The CSS remains `index-DRBQWM39.css` with the hash above. The parent independently
compared both ports' HTTP asset bytes with the build. This cohort includes the
search-overlay refinement described below; it supersedes the earlier missing
raw query/media evidence only for this bounded journey.

The ordinary UI steps and retained outcomes were:

1. Submit the natural-language query recorded in the raw request. The fused
   broker returned zero lexical hits and eight real ONNX/BGE + zvec semantic
   hits, with component and matched-segment provenance. The semantic generation
   was `idx_f7f0201b85655c7ffea7e492ad7cdfb4`. Apply the existing `Mixed Project`
   tag filter to obtain exactly the TXT, small PNG and Alpha WAV; this was a
   transient filter, not a saved query or an automatically inferred group.
2. Select the PNG in Photos, open its viewer and Details, and decode its 96 by
   64 pixels. Switch to Music; the selected photo remains in the shared
   selection with the outside-track disclosure. Select and explicitly play
   Alpha WAV. The retained 48,044-byte HTTP original and actual player Blob
   equal the source bytes. The native audio element uses that Blob, has
   readyState 4, a three-second duration and advancing playback time.
3. Return to all types, select the TXT and inspect its existing Note. All three
   intended filenames remain selected. Reveal More actions, choose Export
   selected, review the three frozen exact files, then materialize and verify
   in a new private server directory.

The resulting manifest is `exm_6a7a6e3fe92a1f518bd9ebcdf63d7218`, digest
`sha256:7692b0a41a6508b169c58a53b1698b01b4745ea8d64a168dc96d0298e5e4a121`.
Both `export.apply` and `export.verify` succeeded for three files and 51,365
bytes. The parent independently compared complete source/output bytes,
SHA-256 and logical lengths: TXT 253, PNG 3,068 and WAV 48,044 bytes.

The plan request carries the three canonical `subj_*` references. The existing
summary's item field named `subject_ref` carries the corresponding frozen
snapshot-local `entry_id`, as explicitly admitted by the client contract.
The parent checked this complete mapping plus names, content IDs and lengths;
literal equality between those different reference kinds is not the contract.
No manifest format or kernel behavior was changed. Attempt 7's stricter,
incorrect assertion remains a failed harness attempt, with no apply. Earlier
selector failures remain separate failures rather than product defects or
passing evidence.

Evidence is retained under `dist/mixed-project-instrumented-20261015/`:
`attempt-8/` contains the exact runner/exit/environment, 56 browser commands,
raw request/response bytes, 12 screenshot/DOM checkpoints and actual media
Blobs; archived paths are rebased to that cohort. The parent's
`root-acceptance-review.json` binds the independently checked identities,
generation, playback bytes and output. The private output is under the reused
profile's `exports/materialized/mixed-project-instrumented-20261015-final`.

This establishes one synthetic composed find/use/takeout journey. Browser ZIP,
after-freeze changes, annotation portable publication, tag-filtered SavedView
persistence, a new recovery run, representative retrieval quality and release
qualification were not exercised. The export selected no metadata sidecar.
The image-model bundle remains unavailable; this PNG used existing bounded
original inspection. Full PC-01 and the outstanding core gates remain open.

## Search overlay continuation

The instrumented journey exposed one actual interaction cost: a submitted
query left the destination header's search overlay open, covering Filters.
The client now dismisses that overlay after the existing `runSearch` reports
that its current result committed. A refused, failed or stale request does not
dismiss it. Later field edits, focus or close/reopen interactions invalidate
the dismissal; a detached panel is ignored. Focus returns to the summary only
when it was inside the panel being hidden. This is transient presentation
behavior over the existing search intent, not a second query authority.

The parent reviewed the delta against retained dirty baselines. The production
change is confined to `web/src/components/TopBar.tsx`, SHA-256
`8f3bd6fadf66037175320a80b1734824b5142885bd400556ba45ee7d215dc716`.
The served JavaScript/CSS are the instrumented cohort above. The existing
`scripts/e2e/search.mjs` gained one focused helper; its final SHA-256 is
`bcff42451116e7fab5fd4f22454edc3ea87e41d1ec49c50ef4254493d49e214d`.

Focused headless attempt 04 passed seven checkpoints: real successful query,
automatic dismissal and direct Filters access; invalid syntax with no request;
an intentionally aborted request retaining the overlay; delayed completion
preserving a newer field edit; and outside dismissal plus keyboard reopening
that remains open after the older result commits. Four query requests were
observed, with three HTTP 200 / `SUCCEEDED` responses and the one controlled
abort. The measured inert outside-click point was outside the overlay; no
forced click or navigation was used. The parent reviewed these complete
payloads/envelopes, progress, geometry and absence of route failures.

Evidence is under `dist/search-dismissal-20261015/`: dirty `baseline/`, build
and syntax receipts, independent `root-served-review.json`,
`browser/attempt-04/` with the executed runner, exit, hashes, command envelopes,
DOM and screenshot, and `root-acceptance-review.json`. After that run, the
helper gained only an assertion that its already recorded empty route-failure
list remains empty; syntax and diff checks passed. Earlier helper failures and
the first TypeScript build failure remain failed attempts, not product passes.

Web build, focused browser checks, the existing result-scope check, broad
`GOPROXY=off go test -tags=cairn_zvec_dynamic ./...`, and diff checks exited zero.
The broad cohort used the same final TopBar bytes, before helper-only cleanup.
The parent checked all subsequent helper changes separately. Non-overlay
header variants and additional viewport/browser matrices were not exercised.

All temporary browser contexts closed. The parent stopped only the private
4651 daemon and worker, verified the port/socket were gone and removed only
its empty runtime directory. The private profile/evidence remain available;
the original owner daemon and worker stayed alive on 4648. This closes the
observed overlay obstruction, not full PC-03, Phase 4 or release qualification.
