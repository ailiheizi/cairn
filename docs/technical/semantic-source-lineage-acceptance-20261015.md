# Semantic Source Lineage Acceptance — 2026-10-15

Status: implemented and tested for the bounded development profile below.
This closes PC-07g only, including the owner-preview rollout successor below.
Full PC-07, Phase 4/5 and release qualification remain open. The later
[long-text successor](#long-text-source-segmentation-successor) records private
native segmentation acceptance and its identity-matched owner-preview rollout.

## Requirement and scope

- Active phase: Phase 4, complete discovery.
- Normative requirement: Content Store §§8–9 and the reviewed
  [Driver and Processor Interfaces §10 v2 successor](../requirements/driver-and-processor-interfaces.md#semantic-input-lineage-successor-development-v2).
- Executable exit: a semantic hit displays the exact source revision that
  produced its vector; selected-source and tokenizer coverage are reported
  independently of vector membership; lexical search and exact preservation
  remain available when semantic evidence is incomplete or unavailable.

The initial regression built a vector from Note revision 1, changed the live
Note to revision 2, and queried the old generation. It returned revision 2's
body. The retained pre-fix test failed as expected. The corrected query reads
the generation-bound immutable annotation history and verifies its digest;
the current annotation still controls lifecycle and tombstone eligibility.
Missing or mismatched history never falls back to the current body.

## Implementation reviewed

New semantic generations write `cairn.semantic-generation-receipt.v2` at the
existing immutable receipt path. A generation-bound selected-source inventory
records source references, canonical revisions, full-body digests, input
identities/digests and available description spans. The input set must equal
the receipt/backend identity set. Selection precedes eligibility filtering;
TAG, empty text, rejected descriptions and superseded descriptions have
closed exclusions. Invalid nonempty sources remain unavailable. This adds no
catalog schema, database, endpoint, processor, query dimension, worker ABI,
signed recovery format or runtime loader.

The native provider retains the worker's already validated text mapping,
preprocessing digests, FULL/TRUNCATED outcome and token counts. Absent optional
evidence means UNKNOWN. FULL, TRUNCATED and UNKNOWN have separate counters;
truncation or unknown consumption prevents complete source coverage without
discarding otherwise usable vectors. No tokenizer byte spans are invented.
Read and write receipt sizes remain bounded by the existing 16 MiB ceiling.

The optional `search.rebuild.semantic_source_coverage` report is bound to the
rebuilt generation/config/profile/snapshot/root. Its complete counters are
independent of at most 256 deterministic bad-outcome-first rows. Pair or
backend lifecycle failure makes semantic readiness unavailable, including a
failure detected by the final coverage probe. Source-only incompleteness can
retain `semantic_state = AVAILABLE`. Legacy v1 source coverage stays
unavailable; v1 Note hits without revision proof require an explicit rebuild.
Old receipts are neither rewritten nor assigned inferred source revisions.

Description projection preserves lexical provenance for rejected/superseded
history. A legacy segment without stored spans can receive a locally derived
full-body span only when the complete segment set contains exactly one
byte-identical whole-body segment with matching immutable bindings. Query
revalidates the same constraints. Partial/multiple segments and malformed
explicit spans cannot receive that derived proof.

## Executable evidence

Focused Go checks cover generation-pinned Note history and tombstones,
description lifecycle/lexical provenance, profile switching, legacy receipt
handling, exact inventory/input-set binding, corrupted receipts, invalid
source shapes, UNKNOWN/TRUNCATED/profile mismatches, bounded report details,
and generation-reader lifecycle failure. The invalid UTF-8 artifact case is
a classifier/summary test; SQLite refuses the invalid durable fixture.

The first broad run found four search failures caused by querying a derived
legacy whole-body span as if it had been stored in the old catalog. The query
was corrected; the exact four regressions plus the strict legacy-span test
passed. The final frozen source passed the broad command with captured exit 0:

```sh
env GOPROXY=off go test -tags=cairn_zvec_dynamic ./...
```

Logs and invocation receipts are under
`dist/semantic-source-coverage-20261015/go/`; the failed broad run is retained.
The original red Note test, an intermediate compile failure and corrected
green runs remain under `revision-test/`. `git diff --check` passes.

## Real local model proof

An isolated tagged candidate used the existing eight-file development profile
and its provisioned BGE/ONNX + zvec bundle on port 4651. No model was installed
or downloaded. Candidate SHA-256:
`19314e871a6955833762674f315fc08d015f1d23bafba0550eca35e2bf61e256`.

| Observed result | Generation A | Generation B |
| --- | --- | --- |
| Selected sources | 22 | 22 |
| FULL inputs | 17 | 16 |
| TRUNCATED / UNKNOWN inputs | 0 / 0 | 1 / 0 |
| Indexed / excluded / missing / unavailable sources | 17 / 5 / 0 / 0 | 16 / 5 / 0 / 1 |
| Source report available / complete | yes / yes | yes / no |
| Semantic runtime | AVAILABLE | AVAILABLE |
| Note revision | 1 | 2 |
| Note input / embedded tokens | 31 / 31 | 2,172 / 512 |

The selected set is eight filenames, eight EXTRACT facts, five TAG exclusions
and one Note. Generation A is `idx_f0e14d58abe62801e1ecac66df18cd6a`;
B is `idx_a56ecaf5b53012423e914ff867c48a03`. The 7,942-byte revision-2 Note
was written through the ordinary optimistic-revision API. A pinned query of A
then returned the exact revision-1 body. B reported actual native truncation;
a lexical Notes query still found the unique tail beyond the model window.
Guarded restoration retained history and created revision 3 with the original
body. The automatic post-restore generation returned that original body.

Parent review independently recomputed both inventory digests, joined all
22 rows per generation to their durable source bodies/revisions, verified all
17 input identities/digests and model counters, and checked all ten raw HTTP
request/response digests. It rechecked all 50 preexisting config/source/model/
repository/receipt files. Schema 27 and the single publication remain; new
annotation history, four semantic receipts and corresponding lexical
generations are expected. There is no new portable-publication claim for
these annotation edits.

Evidence is under `dist/semantic-source-coverage-20261015/private/`, including
build/source manifests, raw API bytes, A/B receipt copies,
`root-acceptance-check.py`, `root-acceptance-review.json` and `cleanup.json`.
One runner environment preflight refused a macOS-injected environment key
before any API call; a scrubbed process launch corrected it. The first parent
checker used the wrong artifact-state literal; correcting it to the existing
`POLICY_ADMITTED` enum required no application or profile change. Both
instrumentation failures are retained. The actual API proof ran once.

Only the owned candidate received SIGINT and exited 0. Its worker, socket,
listener and private runtime directory were removed. Parent checks confirmed
port 4651 free and owner daemon/worker 66042/67405 still running, with owner
health HTTP 200.

## Client feedback and remaining limits

The Web build passed. Seven controlled Settings cases cover ready semantic
search, lexical source gaps/unavailable evidence, an older absent-property
payload, semantic truncation, unknown consumption and unavailable semantic
source detail. All rebuild calls were intercepted. Current served/build
hashes match; the run has seven passing cases and zero page errors in
`ui/attempt-01/run.json`. Served JS is `/assets/index-BEvtjDr2.js`, SHA-256
`68a96c34a117e461e5eba693da9654edff735f0d7483525d9d27b33f3275d3d2`;
CSS SHA-256 is
`d847dd232d3cc9aa6689423e9b51bb19f044b23f819c14db5860f7954b1a1fe0`.
Parent review inspected the diff, receipts and truncation screenshot.

At the initial private acceptance, the owner preview received Web assets only;
its backend had not been replaced. The later owner rollout below supplies
that local deployment evidence. Older binaries cannot interpret new v2
receipts as v1; rollback must keep that boundary visible and rebuild disposable
generations when necessary, without rewriting source or recovery records.

The actual model corpus is fixture-derived and contains no descriptions;
description behavior has Go evidence only. Tokenizer coverage reporting does
not implement long-Note segmentation, prove representative recall, qualify
large-library performance or satisfy packaging/license/supported-host gates.
No AI capture, speech, remote-file integration, new media application or
LinkGroup was added. [ADR-044](build-stack-and-architecture-selection.md#adr-044-ai-clients-over-the-existing-content-authority)
continues to record future AI capture/retrieval. The overall goal and remaining
execution-plan gates stay open.

## Owner-preview rollout successor

The same tested daemon bytes were subsequently installed in the existing local
preview at `http://127.0.0.1:4648/`. The stable daemon SHA-256 is the candidate
hash above; its PID is 47044, with one supervised ONNX worker (47092 at final
inspection). Config digest remains
`sha256:94a335bee45f0190a24e6e0eede51f2698fec42ef658b85134d056904ea54b01`.
The profile still has one catalog, schema 27, four published roots and twenty
regular files. Its two active text annotations are TAGs; it contains no Notes
or descriptions. Historical Note correctness remains proven by the private
model run and Go regressions, not by invented owner records.

The verified old daemon/worker stopped gracefully. Before replacement, a
stopped raw catalog/sidecar set and standalone SQLite backup passed integrity
and logical parity checks. Config, old daemon/CLI, configured repository,
recovery, vectors and model assets were retained under
`dist/semantic-owner-rollout-20261015/backups/20261015T132012Z/`.
A separate matching trust-anchor copy is retained outside the configured
repository. This is local retention, not host-disaster backup qualification.

One ordinary rebuild produced semantic generation
`idx_3a680652fd194f170630b1ef114d30f3` and lexical generation
`idx_1087cf8e52401eb945ccf4b3a430251d`. Both retain all four published roots
through eight source/workspace/root bindings. Semantic coverage is available
and complete: 20 FILENAME + 20 EXTRACT + 2 excluded TAG sources, 40 FULL inputs,
zero truncated/unknown/missing/unavailable inputs. Lexical selected-source
coverage is also complete at 42/42. The rebuild operation remains DEGRADED
because its separate lexical field report has no values for duplicates,
duplicate_group, locators, notes, descriptions and language in this corpus;
lexical and semantic retrieval remain available. No empty corpus field is
invented to remove that warning.

Parent review independently recomputed the v2 inventory digest, joined all
42 source bodies/revisions to their durable records, and verified all forty
input identities, text digests and native FULL token counts. It compared the
coherent backup with the post-browser live catalog: 34 of 37 tables are
identical. The other three changes are preserved old generations plus new
index generations/root bindings, and the semantic-worker fence changing owner
with token 3 to 4. The publication-writer fence is unchanged. The normal rebuild
also maintains the existing graph projection under its unchanged profile;
this admits no new dimension or graph capability. All 66 old generation rows
and 96 preexisting vector files remain unchanged. All 58 repository, 2 recovery
and 12 model files, plus config and CLI bytes, match their baseline. There was
no schema, portable-record or authoritative fact mutation.

The final current-build browser journey passed with zero page errors:

- One default fused `星空` query returned twenty identities: two lexical hits
  and twenty real native semantic hits, bound to the new generation.
- Photos retained the returned image order and decoded `02-星空收藏.jpg` at
  1000 × 1500 pixels. Music retained all six returned audio identities in order
  without a second query.
- Ordinary Play for `Tagged-test-A.mp3` downloaded and verified the original.
  HTTP bytes and the native player Blob both measured 20,820 bytes and SHA-256
  `b62bffa19699f63ee2b5d46e05e7d5935e9fb2beb74aaf6a2773a6cf734ffef3`.
  The decoder reported readyState 4 and a twenty-second duration; Stop was
  exercised afterward.

The final browser attempt is
`client/attempts/20261015T132644Z-47906-12743/` under the rollout evidence root.
Its raw responses, four screenshots, original/player bytes, served assets and
exact execution receipt are retained. Parent review checked all fifty command
response digests, original/player bytes and served/build asset equality, and
inspected the Photos/Music screenshots. All observed operations were reads;
the browser performed no rebuild or metadata write. Two earlier browser runs
remain INCOMPLETE: an obsolete Connected-text wait and an incorrect translated
dialog name. Corrected readiness and localization-neutral selectors changed
only the ignored runner, without weakening the photo/audio exits. Two parent
checker assumptions (generation additions and root-binding columns) were also
corrected against the actual schema, with their failures retained.

`root-final-acceptance.json` records `PASS_OWNER_PREVIEW`; `stage.json` and
the rollout result retain the intermediate review-required state. This
deployment reused the previously passed broad Go cohort and unchanged tested
binary; no application source changed during rollout. The preview remains
running. Frozen ZIP/materialization and clean restore were not rerun in this
deployment slice; their earlier evidence and core/release gates remain
separate. The corpus is still a small fixture-derived development sample.

## Long-text source segmentation successor

Status: implemented and tested in an isolated development profile and deployed
as the identity-matched owner-preview successor below. This closes bounded
PC-07h only. The owner corpus has no long Notes, so the long-text branch is
proven by the private native run rather than invented owner content.

This Phase 4 slice advances Content Store §§8–9 and the reviewed text-source
refinement of the v2 interface contract. Long Notes and already selected UTF-8
EXTRACT bodies become deterministic, contiguous source spans during rebuild;
they are not copied into descriptions or new durable segment rows. The
384-byte target preserves every source byte, and actual tokenizer evidence
still determines FULL/TRUNCATED/UNKNOWN. The segmentation profile digest is
`sha256:dace160f857629029e09238fd7afe6f4f99a3284fdc5845d353860fd32d490a8`.

The reviewed implementation retains the source revision, complete body digest,
ordinal and exact span in the disposable receipt. Each derived ID is a full
64-character SHA-256 hex digest of those bindings. Query reopens and verifies
the historical source and reproducible segment set. Short/legacy whole-body
v2 inputs remain readable; unknown profiles fail closed. Optional existing
search-result provenance reaches the command and Web types without a new UI,
endpoint, schema, processor, model space, worker ABI or recovery record.

Focused tests cover UTF-8/CJK boundaries, whitespace, deterministic IDs, native
key bounds, invalid short Note text, producer attribution, historical revisions,
tombstones and malformed/gapped/profile-mismatched source evidence. The final
broad `env GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` exited 0 at
15:24:43 UTC. Its log SHA-256 is
`048741a90450f0fd3204ad0af5f9cd9281297bfbf34a791df36738f3bf1b9d00`;
production source hashes remained stable. Optional result projection checks,
the Web build and final `git diff --check` pass. The later native-test-only
lexical probe adjustment below changes no product source.

The opt-in `TestRealDaemonSemanticTextSegmentation` used the already retained
local ONNX/BGE/tokenizer/zvec assets on Darwin arm64, fresh private paths and
the ordinary daemon/CLI workflow. No installer or owner catalog was used.
Attempt 003 ran once from 15:33:33 to 15:34:07 UTC and exited 0. Candidate daemon
SHA-256 is `226270d6fa89b60d553223a155cb52b9303e23b7bb70309fefc6406cb61712da`.

| Observed result | Native evidence |
| --- | --- |
| Selected generation | `idx_6425a1cc784abaa05260dfbb6d67a540` |
| Sources / actual FULL inputs | 3 / 123; Note 61, EXTRACT 61, filename 1 |
| Missing / TRUNCATED / UNKNOWN | 0 / 0 / 0; semantic AVAILABLE and complete |
| EXTRACT suffix | `[18000,18091)`, ordinal 60, exact retained source bytes |
| Note suffix | Revision 1, `[18000,18100)`, ordinal 60 |
| Ordinary Note revision 2 | Saved; explicit generation-A query still returns the revision-1 span/body |
| Lexical fallback | Complete distinctive source-tail token returns the subject |
| Exact verification and restore | One original, 18,091 bytes; full verification and byte-identical restored output pass |
| Cleanup | No new test socket, worker temporary directory or test descendant remains |

The original SHA-256 is
`1e1babb96ec545dacbee959d597c5c85acc9fbdc6def2d4f3566a34ed9d1d27a`.
Rebuild status remains DEGRADED because optional lexical corpus fields are
absent; its selected-source coverage is complete. Parent review independently
checked all four raw receipts: 430 input occurrences across the ordinary
ingest/Note/rebuild/edit generations, complete contiguous UTF-8 source spans,
body/text/full-ID digests, native FULL/token counters, inventory and membership
digests, the three semantic query projections, asset/test identity and cleanup.
The edited generation has 122 inputs; counts are generation-specific.

Evidence is retained under `dist/long-note-segmentation-20261015/`: focused and
projection receipts, `go/final-after-pk-fix/`, the native
`attempt-003-full-tail-token/`, its sibling runner receipt/output, and
`native/root-review-attempt-003.json`. Raw receipts and all three fixture bodies
remain readable after private process and directory cleanup.

Both earlier native failures remain retained. Attempt 001 exposed a real
68-character draft ID rejected by the pinned zvec key validator; the reviewed
production fix retains the full digest as 64 hex characters and binds this
format into the profile. Attempt 002 passed semantic coverage and both suffix
hits but used a four-character interior CJK substring as a lexical token.
Existing unicode61 plus V4 character/bigram enrichment does not promise that
query shape. The final probe uses the complete distinctive tail token to
measure full-body lexical preservation. No tokenizer/query behavior was
changed, and arbitrary CJK substring search is not claimed by this result.

This is a controlled fixture-derived native proof, not representative recall,
large-library performance, supported-host or redistribution qualification.
The semantic lane remains bounded top-K. Full PC-07,
Phase 4/5 and release gates remain open. AI capture, speech and remote-file
integration remain recorded future goals in ADR-044; this slice implements
none of them.

### Long-text successor owner-preview deployment

The same native-tested daemon bytes were installed once at local port 4648
after a verified stopped catalog/repository/recovery/model backup. The apply
ran 15:47:14–15:47:26 UTC, exit 0. Daemon PID is 73542; supervised worker PID
was 73580 at inspection. The candidate hash remains `226270d6fa89b60d553223a155cb52b9303e23b7bb70309fefc6406cb61712da`.

The ordinary rebuild produced semantic generation
`idx_2113a229cb980cf4d655c5d46772f55b`: 42 selected sources, 40 FULL inputs,
two explicit TAG exclusions, and no missing/truncated/unknown inputs. The
lexical selected-source report is also complete. Optional absent corpus fields
keep the aggregate rebuild DEGRADED. The owner has twenty EXTRACT bodies of
61–253 bytes and no active Notes; no test content was inserted there.

Parent reconciliation verifies 34 of 37 catalog tables unchanged; only index
generations, root bindings and worker fencing change. All 69 prior generation
rows and 114 prior vector files remain. The semantic worker fence advances
4 -> 5; the publication writer fence is unchanged. Config, CLI and all 72
repository/recovery/model files retain their bytes. The matching anchor and
old binary are retained locally; this is not disaster-independent backup
qualification.

One real headless browser run uses the expected semantic generation. A single
default fused query, `星空`, returns twenty subjects; Photos preserves the
scope and decodes `02-星空收藏.jpg` at 1000×1500. Music preserves that scope and
plays its first eligible WAV, `试听片段.wav`. Native time advances from
0.206547 to 0.418889 seconds with `paused=false`, then Stop pauses playback.
The original response and player Blob each contain 32,044 bytes with SHA-256
`f4a4b0b67fb5c13f2e492d9fd560d7615fbdd38b0e99e1012ff5fbfb68ccaf46`.
All fifty captured commands are successful reads; page/console errors are
absent. Parent review rechecks raw response hashes, exact original/player
bytes, served/build JS/CSS equality, screenshots and post-browser authority.

Evidence is under `dist/long-note-segmentation-20261015/owner-rollout/`:
`backups/20261015T154716Z/`, `root-backend-review.json`,
`root-final-acceptance.json`, and browser attempt
`client/attempts/20261015T155442Z-74200-822/`. Earlier derived summary field
references and one parent-report relative path were corrected with the initial
reports retained; raw preflight/apply/browser evidence was unaffected.

No product source changed after the passed broad cohort and native candidate
build. This deploys the bounded text-source refinement; it does not qualify
recall, complete the remaining Phase 4/5/7 gates, add LinkGroup or implement
AI integration. PC-07i separately records the observed CJK interior-phrase
lexical query gap for a reviewed successor.
