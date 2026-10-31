# Save, Find and Use Convergence Plan

> **For agentic workers:** Use bounded Luna implementation, root decisions and
> review, and one root-owned acceptance journey per complete feature. The
> owner's whole-feature-first rule overrides routine per-edit TDD/suites.

**Goal:** Complete the admitted everyday save-to-use and retrieval handoffs in
existing F01 then F03, without starting future domain or AI infrastructure.

## M3 F03 field-scoped lookup — 2026-10-31

**Phase/requirement:** admitted Phase 4 discovery and bounded first-party search;
content-store §9, the existing named lexical axes and truthful query semantics.
**Owner:** root decisions/review; Luna implementation and one selected journey.

**Concrete gap:** the client compiles a field-only `name:`, `path:` or `tag:`
query into `construct_axes`, but always invokes the default fused broker.
Those axes constrain the lexical lane only; semantic/image candidates can
therefore reintroduce body/Notes matches outside the field the user specified.
The retained large-corpus ranks do not establish a model/ranking defect and
are not grounds for tuning weights or candidate depth in this batch.

**Decision:** field-only plans (`axesRestricted`) explicitly use the existing
`lexical-metadata-fts` lane. Ordinary free text and typed-filter searches retain
the existing fused experience. This is deliberate field lookup, not an implicit
fallback caused by an unavailable model. Existing prefix/phrase matching and
mixed-free-text widening rules remain unchanged. Surface those existing scope
limitations in the floating result's existing on-demand explanation, rather
than keeping them only in a hidden full search header. The explanation heading
must describe scope as well as availability, without calling a scope choice a
model failure. If several lexical axes are combined, explain that terms search
the selected fields together, not as independent per-term field predicates.

**Boundary:** `web/src/app/useSearch.ts`, `lib/searchops.ts`,
`components/SpaceAssistant.tsx`, `i18n/searchops.ts`, `i18n/spaceAssistant.ts`.
No backend, endpoint, query grammar/operator, provider, model, index rebuild,
durable format or new UI surface. Reuse result selection, continued keyword
pages, matching-source Details and exact original download. Saved-search/list
unsupported-condition rules stay unchanged.

**One exit:** reuse the existing isolated F04 profile and installed BGE with
its current generation, without recapturing/rebuilding. The pre-existing
`CedarBlue317` body belongs to `item-f.docx`; add that exact ordinary TAG once
to `item-b.docx`. Plain text finds the body target with a real semantic
component; `name:CedarBlue317` returns no filename hit; `tag:CedarBlue317`
returns only the tagged target; a filename/path scoped lookup returns the
independently expected file. Continue from the floating query into Library and
its existing keyword browse without broadening the field scope; inspect and
take out the target against its independently retained bytes. Mixed free text
and mixed field axes expose their actual limits in the existing disclosure.
No new harness, local test matrix or broad suite; inspect locally only after
an observed failure or a concrete changed invariant.

**Delivered, 2026-10-31:** Luna implemented and executed the shared journey;
root reviewed the diff, actual requests/responses and result screenshot.
The old client-shaped request reproduced the error: `construct_axes=[name]`
with no dimension returned the body-only `item-f.docx`, despite zero lexical
name hits. The revised ordinary browser request pins the existing lexical
dimension and returns zero for `name:CedarBlue317`. Exactly one ordinary TAG
write put `CedarBlue317` on `item-b.docx`; `tag:CedarBlue317` then returned only
that file, while positive filename/path queries returned `item-f.docx`.

Ordinary free text and `type:document` retained the fused broker and actual
local BGE. The Tag write updated only the lexical generation; BGE remained
available on `idx_91d1f9e8c271b0773725b2dce1c56c71` without another index build.
Mixed free-text and multiple-axis limitations appeared in the existing
**About this search** disclosure. Floating-to-Library continuation and the
explicit keyword page retained the `tags` axis and lexical lane. Details read
the exact live TAG. The downloaded `item-b.docx` matched its independent input:
36,990 bytes, SHA-256
`3fb2bbb6a8249ddf835e5e27202219abeae9628d68be931e2abd04ae0b7ee862`.

Evidence is in ignored `dist/f03-fields-20261031/`: the reproduced legacy
request, single Tag response, `journey.mjs`/`journey-result.json`, actual query
records and `floating-tag-result.png`/`library-tag-details.png`. Early driver
assumptions about single-lane response shape, TAG evidence and axis ordering
were corrected without replaying the successful write. No backend rebuild,
recapture, model preparation, local test suite or broad regression ran.
The final affected Web build, diff check and review passed; zero browser page
errors were observed. The isolated daemon was stopped and user port 4670 kept
running; refreshing it loads the shared updated Web build.

One additional product observation remains in F03: the ordinary unscoped opaque
marker query had two lexical matches, but its body target appeared fourth in
the fused answer behind image candidates with no literal marker match. This
is retained evidence for evaluating direct-word versus related-result ordering,
not proof that the earlier frozen corpus misses have the same cause and not an
instruction to tune against those labels. No ranking policy changed here.
Broader actual recall/coverage and core/release qualification remain open.

## M3 F03 OCR semantic candidate cleanup — 2026-10-31

**Phase/requirement:** admitted Phase 4 search-source lineage under content-store
§9 and the F03 OCR projection refinement in the driver/interface contract.
**Decision owner:** root. **Implementation/acceptance execution:** Luna; one
root-owned whole-feature journey, then only a focused changed-lineage check if
the user journey cannot prove rejection. F03 remains open for broader recall.

**Observed gap:** the retained F05 response contains OCR engine/model/region
JSON chunks in BGE's candidates. Current indexer sends the entire admitted
EXTRACT artifact through generic byte segmentation. Display-only suppression
does not prevent this metadata from occupying search candidates. The old
104-file description/rank misses have no established cause and do not justify
ranking or model changes in this batch.

**Smallest reuse:** preserve the original OCR artifact and lexical feed. Add
one closed, digest-bound OCR semantic-input projection within the existing v2
inventory shape. Decode the top-level text and split using the existing bounded
text cutter; each actual model input is the minimal canonical existing OCR
envelope `{schema,state,text}`. This retains the existing client decoder without
a new wire evidence type, at the cost of a few fixed envelope tokens. All
engine/geometry/duplicate-region metadata stays out of these inputs. Inventory
body identity remains the original artifact; input identity binds that body,
the projection rule, ordinal and actual canonical input digest. No source byte
span is claimed for JSON-decoded text. Query rederives and verifies the entire
set. Legacy v1 spans retain their strict rules and are never reinterpreted.
Model/worker ABI and lexical provenance stay unchanged. Explicit rebuilding is
required after the source-profile change. The client conservatively identifies
derived OCR inputs as returned fragments, retaining unknown quality.

**Implementation boundary:** new `server/internal/search/ocr_semantic_projection.go`;
existing `indexer.go`, `semantic_source_coverage.go`,
`semantic_feed_freshness.go`; existing `web/src/lib/ocrSearchEvidence.ts`.
Only if necessary, one focused projection-lineage test file in the same Go
package, after integration. No new endpoint, schema field, durable record,
processor, provider, index dimension, runtime loader, service or test framework.

**Single exit:** reuse F04/F05/F06's stopped isolated profile, installed models
and existing independent screenshot/document inputs. Build the affected daemon
and Web. The old generation must be honestly stale/unavailable; explicitly
rebuild once without recapture or OCR reprocessing. Query the screenshot by a
predeclared Chinese paraphrase through real BGE, inspect its actual semantic
inputs/returned sources, show/copy recognized text in the ordinary floating
result/Details, reopen after restart and download the unchanged original.
Verify no engine/model/region-only semantic inputs for the known OCR artifact,
no fabricated source byte spans, unknown quality/returned-fragment labels and
unchanged ordinary DOCX body lookup. Source/model/coverage evidence is retained
in ignored `dist/f03-ocr-20261031/`; no broad backend suite or corpus matrix.

**Delivered, 2026-10-31:** Luna implemented and ran the selected user journey;
root reviewed production/test diffs, raw response evidence and the screenshot.
The retained screenshot's OCR input count fell from 12 to one FULL canonical
input, with original artifact body digest
`sha256:bf9c5bd05206852de2cd1e65671b0940f2905c4a349a967f9ffb88d57e73b1ff`
unchanged. Final isolated generation `idx_91d1f9e8c271b0773725b2dce1c56c71`
accounts for all 25 selected sources (22 indexed, three empty-text exclusions,
zero missing/unavailable). Empty PARTIAL OCR remains a valid empty-text source,
not an inference failure. No OCR processor was rerun and no file was recaptured.

The predeclared paraphrase returned `image-b.png` first through real
`query.semantic.onnx-bge-zvec.v1`, with only `schema/state/text` in its projected
OCR input and no source-byte-span claim. The ordinary floating result and
Details exposed readable/copyable recognized text; the semantic fragment had
unknown quality, while keyword evidence retained actual original OCR quality.
The unchanged `CedarBlue317` DOCX passage remained readable/copyable. A daemon
restart reused the same target projection, and the downloaded screenshot was
byte-equal to the independent F05 input: 74,634 bytes, SHA-256
`8a2fd4cc149d98b6cca5c6b2a6f2092ac664e57f58935a4849ce4b4b2d06bcfa`.
The final query additionally confirmed the final generation after the last
empty-text coverage fix; unchanged successful UI/download work was not replayed.

The three isolated rebuild attempts are retained honestly: the initial attempt
exposed a coverage reporter incorrectly demanding original byte spans; its
retry exposed valid empty PARTIAL OCR being rejected. Each affected step was
repaired, with no capture, model installation or original-download replay.
Overall rebuilding remains DEGRADED for absent lexical fields, not missing
selected semantic sources. The review also corrected a top-level schema detector
that could otherwise mistake ordinary prose examples for OCR. One subsequently
run `TestOCRSemanticProjectionLineage` checks these observed regressions and
changed digest/profile/no-span rejection invariants; it is fixture validation,
not additional real-provider evidence. No broad Go/E2E suite ran.

Evidence is retained in ignored `dist/f03-ocr-20261031/`: old-generation baseline,
three rebuild responses, actual queries, `final-result.json`, the continued
browser journey, `semantic-fragment.png`, independent original and the single
named lineage-check log. Final Web/daemon compilation and diff check passed.

The configured demo was not listening on 4670. Its generated old content-list
document referenced a stale workspace ID; the configured catalog's sole actual
`default` workspace was used without creating/importing/replacing anything.
The tested daemon now serves that existing profile on 4670. One explicit
activation rebuild reports complete semantic-source coverage and CLIP READY
(11 images); original identity sets for all 20 entries/file versions and
processor artifacts are identical before/after. The startup/Home response and
real BGE query passed; the service remains running. Activation details are in
`demo-activation.json`. Its overall state remains DEGRADED for six absent lexical
fields. This scope does not close the larger F03 card, retune ranking,
redistribute models, or qualify a core phase/release.

## M3 F06 scene and reference-image continuity — 2026-10-31

**Active phase:** admitted Phase 4 VIS-1/2/3 and first-party Photos maintenance.
**Requirement:** the visual-search admission in the content-store contract:
explicit Chinese scene and saved-image queries use the actual local CLIP
generation; unavailable inference remains honest; original identity is unchanged.
**Acceptance owner:** root; Luna implements and executes one selected browser
journey after integration. Existing model installation evidence is reused.

**Decision:** finish the existing Photos search, rather than introduce another
search page or a chat result type. Keep a compact accepted-search context in the
host: scene words or the selected reference's name, returned-result count and a
return-to-all-photos action. Preserve scene drafts across page switches in the
existing workspace session. Scope labels must disappear when the actual host
result set, workspace or refresh generation changes. A new visual answer resets
local filters/sorting so old local choices cannot conceal the new matches.
Use the existing current-result browse bookmark for viewer/Details return.

**Implementation:** `app/useSearch.ts`, `main.tsx`, `LibrarySurface.tsx`,
`LibraryPageHost.tsx`, `PhotoLibraryExperience.tsx`/`.css`,
`photo/photoTypes.ts`, `photo/PhotoViewer.tsx`, and `i18n/visualSearch.ts` only.
Expose a viewer action to find similar saved photos (PNG/JPEG, existing identity
checks); close the viewer only after an accepted response. Keep it open on
failure and show feedback there. Reuse the existing card and selection actions,
not a second selection system. No new model, data read authority, upload query,
schema, endpoint, dimension, processor, runtime loader or backend change.

**One exit:** in the existing isolated local profile, retain independently
identified neutral-named interior/reference/distractor photos; explicitly build
the existing image generation once if those images are newly captured. Use a
Chinese no-text scene query, switch away/back with draft and accepted query
intact, open a matching photo, find a related image from the viewer, and return
from viewer/Details to the same search context. Take out the expected original
and compare all bytes, SHA-256 and length with the independent input. Verify
real CLIP provider/generation responses, unavailable query preserving existing
results/reference and ordinary name search/original access in that same journey.
No broad backend suite or model/cross-platform qualification is implied.

**Delivery: implemented and locally accepted, 2026-10-31.** The selected F06
client loop is Done. Luna implemented and executed the shared browser journey;
root reviewed the diff, actual response evidence and final screenshots.

The existing isolated F04 profile received three neutral-name photos in one
ordinary plan/apply, followed by one explicit index build. The installed bundle
was reused, with no model download. Real `multimodal-clip` queries identify
`query.multimodal.onnx-clip-zvec.v1` and READY generation
`idx_0253759890468be74f74f1d5d6a8d87e` (five images). Chinese scene
`客厅里白色沙发和木质茶几` ranked the independently expected `a.jpg` first.
Reference `b.jpg` ranked `b.jpg`, then related interior `a.jpg`, then jewelry
distractor `c.jpg`, ahead of the other two images. This is the stated local
corpus result, not a general recall guarantee.

The workflow verified accepted query/draft retention through Library/Home/Photos,
resetting prior local filters/sort, explicit viewer-to-reference search, Details
return to the same Photos wall/context, and ordinary filename filtering after
**All photos**. Labelled client response faults separately demonstrated scene
and viewer unavailability without replacing the prior results; these faults are
UI evidence, not real model failures. Both downloaded originals matched their
independent inputs byte-for-byte:

- `a.jpg`: 77,263 bytes; SHA-256
  `8333aa943a16cc9d7574cbc4dc9f3ad2118e1e3f2d6cca26605ff440439c15f0`.
- `c.jpg`: 74,524 bytes; SHA-256
  `32f8ba24f91e3f6320c97bee99f3e495a1aedd76e733c99cab0adfaf06f71b89`.

Ignored evidence is in `dist/f06-20261031/`: `expected-inputs.json`, the single
plan/apply and rebuild responses, `journey.mjs`, the resumed read-only
`resume-tail.mjs`, `journey-result.json`, and
`similar-results-final.png`/`viewer-unavailable-preserved.png`. Intermediate
failures are retained: one missing import and one omitted prop handoff were
fixed; the driver was corrected to return from Details to the wall before
explicitly reopening the viewer. Failed evidence-summary writes did not replay
successful capture/download mutations; the final summary records the observed
assertions and retained files. Only the affected build/failed steps resumed.
Final Web build, visual review and diff check passed; no broad backend suite ran.

The isolated service was stopped after its PID/config were checked; demo 4670
was untouched. Overall rebuild still reports DEGRADED for absent lexical fields,
while BGE is AVAILABLE. F03's remaining coverage/recall work, model distribution,
license review, cross-platform and core/release qualification remain open.

**Architecture:** Existing SourceDrawer and useSources own the upload/review/
explicit-apply flow. Keep one transient browser upload draft/receipt on the
existing sources hook so ordinary files, like pasted text, can resume after a
panel closes. Keep verified saved-file resolution and takeout in the host.
Search continues using the existing broker and scope; F03 starts only after
F01 delivery and a concrete gap review.

**Stack:** Existing React/TypeScript, current typed commands and i18n.
**Spec:** API/WebUI section 2.2; first-party-client-experiences; existing F01
and F03 in the 28-card function plan; owner requested continued delivery.

## Constraints

- Admitted client maintenance alongside Phase 4/5, not core/release completion.
- No schema, endpoint, processor, provider, runtime loader, service or framework.
- Upload/staging is not saving. Only existing digest-bound confirmation applies.
  Unknown apply retains status-check and never offers another apply blindly.
- A late hidden upload result may retain its receipt but never auto-prepare/save.
- Preserve request-scoped accepted subsets, safe relative paths, exact uploaded
  identity, file limits, existing text budget and explicit partial review.
- Pending browser files/receipts are transient, cleared on workspace reset or
  explicit completion/new-batch continuation; they are not recovery authority.

## F01 — resume intake and use confirmed material

**Card:** AIL-38. **Requirement:** API/WebUI 2.2 and existing F01.
**Exit journey:** Folder plus text/material -> upload -> close/reopen review
without another upload -> confirm -> view exact saved batch -> open and take
out matching original; retain cancellation/unconfirmed states in that journey.

**Decision:** Preserve the ordinary upload receipt and retry material in
useSources, rather than add a staging service or persist a new queue. Reuse
existing receipt rows and plan/source binding. An in-flight transfer cannot be
silently dismissed; offer the existing Stop action, then retain its unresolved
outcome and explicit retry. Closing a ready review preserves it. New explicit
server-source work can use its normal plan; reopening Add can still review a
retained receipt explicitly. Saved completion consumes the browser draft only
once its confirmed result is handed off, never merely on close or staging.

- [x] Lift the ordinary upload draft/receipt into existing transient sources
  state, retaining rows, staging directory, error/partial state, selected browser
  files and relative-path mode. Preserve the text-specific draft semantics.
- [x] Resume a matching prepared plan/unknown check on ordinary reopen; otherwise
  show retained accepted rows and an explicit review. Keep transfer Stop and
  an explicit retry of retained files; disclose unknown old receipts honestly.
- [x] Complete confirmed save -> exact batch resolution -> open/use/takeout,
  using existing useLibrary resolver and host actions. Make failures retryable
  without silently replaying upload or plan.apply.
- [x] Integrate, build once needed, run the named whole F01 journey; diagnose
  actual failures only, review, record outcome, commit/push and update AIL-38.

**Implementation boundary:** SourceDrawer.tsx/CSS, useSources.ts, existing
intake i18n modules, and only necessary main.tsx/useLibrary.ts handoff seams.
Preserve other worktree changes. Delegates report conflicts instead of expanding
scope, do not commit and do not run independent test campaigns.

## F03 — actual retrieval and result-use gaps (next, not simultaneous)

- [x] After F01, inspect one known retrieval/use failure and agree the minimal
  reuse seam from the current broker, result scope and matched-source output.
- [x] Prefer directly usable results, on-demand source/context and honest
  model/coverage/empty/error states. Keep real semantic evidence requirements.
- [x] Any cross-background-scope media handoff must be explicit and preserve
  return/query meaning; do not invent another query authority or replace scope
  while merely typing in the floating input.
- [x] Deliver one complete find -> inspect needed context -> use/takeout journey,
  then record only its actual scope and remaining core coverage.


## F01 bounded local delivery — 2026-10-31

Implemented in the existing four client files: ordinary upload rows, staging,
error/partial status, browser File references and relative-path mode now live in
one transient sources draft. Closing/reopening a ready review retains the same
plan; an in-flight transfer must be stopped or reach a receipt before dismissal.
Stopped/unconfirmed transfers retain an explicit retry and file-name disclosure,
without preparing or applying a hidden operation. Confirmed saved-batch handoff
and explicit Continue adding consume the draft; catalog/repository reset
invalidates old receipt callbacks. Existing pasted-text locking remains intact.

The selected F01 journey used a real two-file folder (159 bytes): one intercepted
request was stopped before delivery, browser files survived close/reopen, and an
explicit second request uploaded the folder with safe relative paths. A ready
review reopened with no upload or plan.ingest replay. Exactly one explicit apply
opened the exact two-member just-saved batch. Both receipt identities match the
independent inputs; the 76-byte notes original downloaded through Details matched
its independent SHA-256/length. The driver had an unnecessary hash-route assertion
and an incorrect localized download selector; only read-only download continued,
without repeating the already successful upload/apply.

The same feature's pasted-text continuation saved a literal 67-byte UTF-8 note:
its prepared review closed/reopened after one upload, preserved the literal text,
then one explicit apply opened its saved file and the actual original download
matched the independent text bytes. Evidence: `dist/f01-20261031/` journey,
receipts, plans, downloaded originals and screenshots. Web build and diff check
passed; no backend/model/broad suite ran.

Root reviewed source and outcomes; Luna found no confirmed spec/code blocker.
The epoch concern was adjudicated as intentional old-callback invalidation:
clear/reset schedules a fresh draft render before any next upload, while late
old callbacks are rejected. No new durable semantics or phase/release credit.


## F03 selected implementation — 2026-10-31

**Concrete gap:** a floating query preserves the background scope, so a matching
photo outside that scope currently opens Details instead of its specialist page.
The selected result also offers only one unlabelled snippet.

**Decision:** keep input/query projection side-effect free. A result outside the
background scope visibly says it opens this search's results. On that explicit
activation, run the same query through the existing normal search path, validate
that the exact selected subject/content is still returned before committing its
result scope, and then locate that fresh hit in the existing enabled specialist
page. This is one host-owned scope transition, not another query authority. A
failed/stale response retains the former scope and visible error; merely typing
or seeing results never changes the background. The active query is shown by
ordinary Library/Photos/Music/Videos search context and can be cleared through
its existing control. Saved-list entries have no implied search query.

Reuse existing source-label formatting in a small compiled result-list component:
necessary snippet/type and destination cue first, bounded matched-source details
on demand. No original/body read or model invocation follows from expansion.

**Files:** useSearch.ts (optional pre-commit response acceptance gate), main.tsx
(existing normal-search -> navigation handoff), SpaceAssistant.tsx/CSS and its
compiled result-list helper/i18n. Existing namespaces, annotations and media
budgets stay unchanged. Inspect the already installed local BGE bundle and
existing model readiness/rebuild path; repair only the selected local profile
configuration when needed, not provider internals or unrelated corpus recall.

**Exit:** normal host query with a limited scope -> independent floating query
and its match context -> explicit cross-scope photo/music entry -> current query
label + exact located subject -> existing original takeout. Include stale result
refusal and honest semantic coverage within this same flow; if a real BGE path
is exercised, use the already pinned local bundle and explicit existing rebuild.
No general chat, external AI, new fields or index dimensions are admitted.


## F03 selected local delivery — 2026-10-31

Implemented explicit fresh-query handoff to the existing enabled media page,
subject + content-ID + length acceptance before background mutation, and
workspace/navigation supersession. Returned match context reuses existing source
labels and bounded snippets in a compiled helper with no original reads. The
floating default shows three previews; expansion retains all returned results
and the unselected-list action names the exact regular-file count.

The selected browser journey started with a document-only `suffix:md` host scope,
then found Joel in the independent floating query. It exposed the scope hint and
source evidence without changing the background. A changed second response was
injected only for the refusal case: the former scope remained unchanged. A real
fresh response then entered Photos and focused the exact subject. Its original
JPEG download matched the independent retained 478,185-byte source (SHA-256
`140ec258d58f6742b98bbff457b8b89101c56970b5c11485401ff131698d594d`).
The Music continuation entered and focused lixound from another document-only
scope without autoplay. A disclosure-toggle driver correction resumed only that
read-only tail. No saved content or provider egress was mutated by this journey.

The isolated curated demo had overridden its model path to an empty directory.
Its launch/config now explicitly reuse the already installed pinned local model
root, `/Users/macos/.local/share/cairn/models-zvec-dynamic-candidate-20261015`;
old local configuration was retained under the ignored evidence directory. The
owned demo daemon was restarted at the same port, and one explicit existing
`search.rebuild` produced BGE generation
`idx_55283414096145bb76ee2b7927bc2eb5` (AVAILABLE) and existing CLIP generation
`idx_ae651bcdac61ee30ebb73017f7c5a66a` (READY). No model was downloaded,
new dimension added or historical processor rerun. The real paraphrase
“有湖水和高山的风景” returned SUCCEEDED: lexical 0, BGE 16, CLIP 3; the two
lake landscapes ranked first. This is small-profile development evidence, not
all-corpus recall/field completeness or a default release qualification.

Evidence: `dist/f03-20261031/` actual query/rebuild responses, journey/read-only
continuation, JPEG and screenshots. A driver initially used an unsupported
operator; the UI refused it without executing a query. The supported suffix
operator was then used. Web build and diff check passed. Root and independent
Luna review found no blocking issue; no broader suites were run.

F28 accompanies this feature: bilingual README and English quick-start/list
instructions now describe the actual save -> find -> use -> keep loop. Six
current-build JPEG screenshots were captured through actual UI navigation,
including explicit verified audio/video playback and an unsaved list-title edit;
no second capture or model request was made for that result draft. Root inspected
the Home, search and result images. Existing media credits and model/playback
limits remain. This documentation update grants no additional capability.

The original Linear project and its 28-card document now reflect these outcomes:
F01 Done for browser intake/use, F03 In Progress with this selected handoff
delivered and broader field/recall gaps retained, and F28 Done for the current
documentation version. M2/M3/M10 retain their IDs and explicit remaining limits.

## M1 final result/save handoff — 2026-10-31

Owner requested M1's complete loop before further M2/M3 work. This is one
admitted Phase 4/5 parallel ML-1/2/3 client maintenance batch: the ordinary list
and frozen Skill must remain the result used after editing, reviewed saving,
reopening and verified playback/takeout. No backend, durable format, model call
semantics, budgets or core/release gate changes.

Decision: both the Skill editor's direct save and the expanded result's save
use the same transient assistant result/save tracking. The host acknowledges
whether intake accepted the handoff; refusal must preserve the editor/result,
and upload preparation never implies confirmed capture. Preserve the prior
result behind a Skill editor so cancelling returns directly to it. Existing
JSON snapshot comparison is correct: unchanged saved content remains saved,
while changed content becomes a new ordinary draft. Do not clear it merely
because the editor was opened.

- [x] Implement in `SpaceAssistant.tsx`, `MaterialListComposer.tsx`,
  `MaterialListResult.tsx`, `main.tsx`, and existing translations if needed.
  Pass the exact document and its prepared files together through a compiled
  callback; track that list file's digest/length and matching draft JSON. Only
  current catalog confirmation may mark it saved. Surface save failures in the
  existing full result and keep the current result intact on host refusal.
- [x] Build and run one existing-environment `m1-result-save-use` journey:
  saved material -> exact Skill in editor -> direct review save -> cancel and
  resume -> one explicit apply -> returned current result -> reload/reopen ->
  order/context/Skill intact -> supported play and original takeout. Reuse prior
  real-provider candidate evidence because this change adds no provider path;
  do not spend another model call merely to validate client handoff. Compare
  taken-out bytes with independently retained source files.
- [x] Root and Luna review, `git diff --check`, then update existing M1/F09/F10
  records with the actual outcome. Root owns one acceptance;
  no delegate builds a separate test suite. Preserve unrelated worktree files.

Actual outcome: the current Skill-editor document now passes together with its
generated files through the shared result-save handoff. The host returns an
accept/refuse result; refusal leaves the editor/result intact. Editor cancellation
propagates its AbortSignal through the hash/preparation boundary, so a late
preparation cannot open intake or replace the prior result. The full result also
shows save errors. Unchanged saved JSON remains saved; revised JSON is a draft.

The existing port-4670 journey created `M1closure20261031` with a literal Skill,
three occurrences over two independently retained MP3 sources, one explicit
reviewed apply and no model request. Cancel/reopen retained the same upload/plan;
the newest result stayed pending until catalog confirmation. Refresh/reopen
preserved the Skill, order, repetition and reason, and actual verified audio
advanced. ZIP contained exactly two unique originals, byte-equal to the separate
3,522,969-byte and 7,084,053-byte source files. Evidence is in ignored
`dist/m1-20261031/` (journey, receipts, expected snapshot, ZIP, source comparison,
screenshots). A read-only cancellation tail delayed only local list-byte
preparation, closed the editor, then released it: zero upload/apply, original
saved result unchanged. It did not replay successful mutations. Final Web build,
root/Luna review and diff check passed. Prior ML-3 real-provider evidence remains
applicable; this change did not alter model execution, grants or candidate rules.

This closes the selected M1 client loop. Continue existing M2 daily-use and M3
retrieval gaps; no future refresh, general AI, domain service or core/release
qualification is implied.

## Composer scroll refinement — 2026-10-31

The owner reported the native scrollbar in the floating input. Its fixed 46px
height left three text lines at 93px scroll height, and a short single-line
height could expose a native track with platform/zoom rounding. The composer
now measures its text, grows from 46px to the existing 110px ceiling and only
enables vertical scrolling beyond that ceiling. Width-only ResizeObserver
updates avoid height feedback; ordinary draft, focus and search semantics stay
unchanged. Shared scrollbars have thin themed thumbs and transparent tracks,
with forced-color fallback and no replacement scroll engine.

The selected compose/search journey passed for empty, three-line, long text,
expand/return with exact draft preservation, zoom, shrink and actual search.
No browser exceptions occurred. The built real dark UI screenshot is retained
at `dist/scrollbar-refinement-20261031.png`; build and diff check passed. This
is frontend presentation maintenance, not a core phase or media-budget change.

The owner subsequently still saw a native track with two lines. A freshly loaded
Chrome page measured the two lines at 70px with hidden overflow, but composer
scrollbar painting had only inherited the shared thin theme. The composer now
explicitly suppresses both standard and WebKit scrollbar painting/gutter; long
text keeps ordinary scrolling. The selected fresh-build journey used the exact
`测试\n测试` input: 70px content/height, no painted bar or gutter. A 593px long
body stayed bounded at 110px, wheel and keyboard navigation worked, and
expand/return retained the draft with no browser errors. Evidence is retained in
`dist/composer-scrollbar-hidden-journey-20261031.log` and
`dist/composer-two-lines-no-scrollbar-20261031.png`. The user's existing embedded
tab could not be inspected through the unavailable browser connector, so these
are fresh Chrome observations, not a claim of inspecting that live tab.

## M2 F08 saved-search continuation — 2026-10-31

Active batch: admitted Phase 4/5 parallel first-party SavedView ergonomics under
content-store §7.2 and F08. Goal: save the explicitly submitted floating query,
reload, open the named current evaluation in Library and use/take out results.
Existing dynamic keyword/structured semantics stay distinct from ordinary fixed
lists, semantic ranking and frozen exports. No backend or persistent format
change, new query authority, model call or runtime package is needed.

Decision: add on-demand Save this search and Saved searches access in the
existing floating layer. Reuse `buildSavedRetrievalCandidate` with the submitted
floating query and no hidden background filters; reuse `SavedRetrievalEditor`
and `useSavedViews` for naming, exact conditions, same-name review, edit/copy,
readiness and revision checks. Only explicit recall replaces the host scope
through its normal paged flow and shows Library. Creating/opening the saved
search panel must not change background scope. Same-library saved rows use their
stored workspace; failed/unknown states are visible. Explain that saved searches
rerun supported keyword/filters, rather than freezing semantic results.

- [x] Wire one compiled `FloatingSavedSearches` projection and existing host
  props/callbacks in `SpaceAssistant.tsx`/`main.tsx`; add existing i18n/CSS only
  as needed. One new component may reuse existing editor; no second save or
  evaluation implementation. Keep management and forms hidden by default.
- [x] Build then run one `floating-saved-search` journey: submit supported
  type/keyword query, save/reload, open current Library evaluation, edit/copy
  through existing revision checks, use a result and verify downloaded original
  against independent input. Existing continuation/export evidence remains for
  untouched code; only diagnose real failures or changed invariants locally.
- [x] Root/Luna review, diff check, update existing F08/M2 records with actual
  delivery and remaining limits, then commit/push. Preserve all unrelated files.

Actual local delivery: the floating menu now exposes same-library named searches,
and a submitted result can open the existing name/condition review without
changing its background. Save, edit/copy and same-name revision confirmation
reuse the existing editor and operations. A client acceptance predicate on the
existing recall path rejects superseded navigation before installing results;
other callers retain their prior behavior. Only explicit recall enters Library.

The port-4670 journey saved `suffix:mp3` while unrelated unsent text remained in
the composer: the durable record had empty keyword text and exactly
`suffix=mp3`, and the Home route/draft stayed unchanged. Reload found it; editing
and copying to a `lixound` query kept the suffix and original record. Cancelling
same-name confirmation wrote nothing; explicit update created revision 2 of the
copy with query `Summer`. A held real evaluation was superseded by Home
navigation without restoring the old search. Opening the updated name then
showed exactly one Library result and located its Music row. The first driver
incorrectly expected a Details modal after that intentional media entry; only
the read-only download tail was corrected and resumed, with no replay of the
three confirmed view writes. The 7,084,053-byte original matched the independently
retained MP3 (SHA-256
`694c479a448fc41bb4367e4fa4c3edc155c3732e1947adc104c831957d30c509`).
Evidence is retained in `dist/f08-20261031/` (save responses, journey/read-only
tail, source comparison and screenshots). No capture/apply or model operation
ran. Root/Luna review, affected Web build and diff check passed. Untouched paged
recall and view-backed frozen export retain the prior stated evidence; this is
the F08 client-entry closure, not arbitrary condition support or core/release
qualification. M2 still owns F07/F22 and M3 still owns concrete retrieval gaps.

## M2 F07 manual context continuation — 2026-10-31

Active batch: Phase 4/5 parallel admitted first-party client maintenance under
content-store §8, the one-Notes decision and ordinary TAG/Favorite contracts.
Goal: explicitly open a media item's existing Notes/tags, retain and reread
context, organize several selected items and find/use them again.

Concrete gap: ordinary Music-name activation now correctly locates the media
destination, but its row menu only exposes queue/download actions. Unlike
Photos/Videos, `renderMusic` does not pass the existing host `onOpenHit` inspector
callback. Thus a stopped Music item has no direct row action for Notes/tags.
Add one **Notes and tags** item inside the existing overflow menu; do not change
normal name activation, start playback, create another editor, or broaden reads.

- [x] Pass optional `onOpenHit(hit)` through `LibraryPageHost` and existing
  `MusicLibraryProps`; call it from the Music row overflow menu using the same
  menu-close helper. Keep the existing host Details/Notes/annotation lifecycle.
- [x] Integrate the complete manual context workflow, fixing only observed
  connected failures. No new endpoint, durable schema, processor, provider,
  index dimension, UI surface or test framework. AI description execution is
  not selected by this manual-context batch.
- [x] Build then use one `media-context-find-use` journey on the current
  isolated profile: stopped Music -> explicit Notes/tags -> save/reread/edit
  long user text and exact tags -> Photo context/Favorite -> selected batch
  tags -> reread without losing other context -> find and use/take out the
  original with independent byte comparison. Reuse unchanged prior trust/read
  evidence; diagnose locally only after an actual failure or changed invariant.
- [x] Root/Luna diff review and diff check; update existing F07/M2 status with
  executable outcomes/limits, then commit/push. Root is the single acceptance
  owner; delegates do not run separate suites. Preserve unrelated files.

Actual local delivery: stopped Music's overflow menu now has a host-owned
Notes/tags action. The inspector receives the exact row, closes its menu and
receives focus; name navigation and playback remain separate. Its menu label
now describes general item actions instead of implying queue-only content.

The current port-4670 workflow saved and revised a literal long Music note,
reopened all 7,690 UTF-8 bytes exactly, and retained its independent user tag.
Favorite was toggled and restored to its original false state. Two explicit
Music selections received one exact batch tag, then had only that tag removed;
both selections, the other user tag and full note remained. Photo Details saved
another ordinary user note. A fresh `F07context` query found Summer with returned
`kind=NOTE`, `source_type=ANNOTATION` and the saved annotation ID: actual note
coverage, not an inference from filenames or semantic score. Its 7,084,053-byte
takeout matched the independent MP3 source and its known SHA-256.

Evidence is in `dist/f07-20261031/`: literal expected bodies, successful write
responses, current-source search response, browser segments, screenshot and
original. One driver selected the datalist input by textbox role instead of its
label, then another missed the Photo card's hover disclosure. Each correction
resumed only the pending tail; the two successful note writes and subsequent
confirmed tag operations were not replayed. All ten confirmed annotation
responses succeeded; no original capture/apply, remote AI generation or model
profile changes occurred. Root/Luna review, Web build and diff check passed.
Existing unknown-read protections and description provenance remain unchanged.

The admitted manual F07 loop is closed. Optional AI-generated Notes and a new
history browser were not selected or claimed by this batch. M2's remaining
function card is F22; M3's broader field/recall work is still open.

## M2 F22 continue browsing and return — 2026-10-31

Active batch: Phase 4/5 parallel first-party client maintenance under the shared
loaded/search scope contract, content-store discovery and SavedView §7.2. The
user outcome is to continue a submitted floating search in Library, browse
later matching items, inspect one, return to its position with selection intact,
and take out the original. This closes an existing connection; no new query,
pagination authority, endpoint, durable model or runtime package is admitted.

Decision: add one explicit **Continue in Library** action to floating results.
It runs the submitted query through the existing host `runSearch` and opens the
existing Library. Do not use an unsent composer draft or background filters.
The host's ordinary keyword/filter continuation, ranked-results return and
honest semantic/coverage limits remain visible; this does not paginate semantic
suggestions or turn returned results into a claim of full coverage. Gate result
installation by the existing navigation epoch and workspace before mutation.
Keep the floating draft/results available on failure or return. Share the
saved-search handoff's local busy/error/collapse wrapper rather than duplicate
it; leave ordinary result-open semantics unchanged.

- [x] Connect `SpaceAssistant.tsx`, `main.tsx` and existing i18n entries only.
  Reuse host search and Library paging/position state; do not add another list
  implementation or change stored search semantics.
- [x] Repair the observed ordinary-wall return gap in `ResultList.tsx` by
  registering its existing virtual window with `useBrowsePosition`, as Photos
  already does. The real 230-file flow retained selection but moved the last
  item from 673px to 1,014px after closing Details, including after two frames:
  the unregistered wall fell back to raw scroll offset across layout changes.
  Bind subject anchors, current presentation/sort signature and existing
  `revealIndex` for unmounted anchors. Do not add another position registry.
- [x] Build and run one `continue-find-inspect-return-use` journey with real
  multi-page data in an isolated existing or reused development profile:
  floating query -> Library keyword continuation -> later item selection ->
  Details -> same position/selection -> independently checked original. Include
  stale-navigation rejection for the new async handoff; reuse untouched saved
  view and paging evidence rather than repeat a full regression campaign.
- [x] Root/Luna review and diff check; update the existing F22/M2 records only
  from observable delivery, then commit/push. Root owns the one journey; no
  delegated suites or broad backend checks. Preserve unrelated changes.


Actual local delivery: the floating query has an explicit Library handoff with
pre-install navigation/workspace rejection. Its shared wrapper retains the
public SavedView callback's boolean result while treating superseded work as a
silent non-navigation. The ordinary result wall registers stable subject anchors
in the existing browse registry; host query/filter scope and layout/sort changes
invalidate old positions, while continuation does not discard the anchor.

The current binary captured 230 distinct small original text files into an
isolated port-4671 profile through one ordinary plan/apply. The port-4670 curated
demo was not populated or restarted. The real query continued through 200 then
30 keyword matches. Selecting file 230, opening Details and returning retained
selection and the same visible subject anchor (offset -51.56px before, -51.77px
after); the selected file remained fully visible. Its downloaded 82 bytes were
identical to the independent input, SHA-256
`2b71c124aaa197017a6303da9371d5608e3256f5ddc6f8512e5a09d91f84180c`.
A failed handoff preserved results/unsent text; a held real search superseded by
Home navigation did not install its results. No remote model request ran, and
this profile honestly reported the unavailable semantic generation.

Evidence remains in `dist/f22-20261031/`: the one successful capture response,
search page responses, original failure and resumed read-only browser segments,
return geometry, source/takeout and screenshot. The driver first omitted hover
before the disclosed selection target. After correcting that, the actual raw
scroll return failure was reproduced with settled frames and repaired. A strict
clicked-tile pixel comparison also detected legitimate row-height remeasurement;
the final check instead proves the same visible subject anchor/offset, selection,
a fully visible target and exact takeout. It does not claim identical geometry
for every tile. Only the affected read-only tail was repeated; capture was never
replayed. The shared-wrapper compile mismatch was corrected without broadening
its downstream callback. Root/Luna review, final Web build and diff check passed.

F22's admitted client continuation closes M2's current five cards. Retained
listing/SavedView/large-scale evidence is not requalified by this 230-file flow.
Unlimited semantic continuation, general performance claims and core/release
completion remain outside it. M3/F03 continues the concrete field/recall work.

## M3 F04 readable returned passages — 2026-10-31

Active batch: Phase 4 discovery and admitted first-party client maintenance,
under content-store §8/9 and CS-1/2/3. Outcome: find a neutral-name PDF/DOCX by
content or meaning, read and copy the returned passage, and take out its exact
original. Existing processors, source lineage, query bounds and BGE are reused.

Concrete gap: Details renders `matched_excerpt || matched_text` and truncates it
again at 280 characters, even when the broker supplied a longer exact passage.
The floating layer also has no explicit inspector action for its returned
evidence: default media entry correctly locates a specialist page, but an
already-loaded library item need not carry that floating hit's segments.

Decision: keep concise excerpts, then disclose a read-only returned passage
inside the existing source section. Copy uses the unchanged returned text with
visible success/failure feedback. Label it as returned text, not a complete
document/page. Add an explicit **View match details** action inside the existing
floating evidence disclosure, using the returned hit and current host Details;
do not attach hidden evidence state to a specialist page or change default
media activation. No new original read is performed to expand or copy text.

- [x] Add one small shared `MatchedSourceText.tsx` component for preview,
  on-demand returned passage and copy feedback; use it in the existing generic
  and document matched-source rendering in `DetailsPanel.tsx`. Existing source
  paging is reused with one document passage at a time; technical provenance
  stays available on demand. Generic/OCR page sizes and OCR-specific
  interpretation stay unchanged. Style within the
  existing Details styles and i18n; plain React text, no HTML rendering.
- [x] Wire `onInspect` from `SpaceAssistant.tsx` through the optional
  `FloatingSearchResults.tsx` callback to the guarded host inspector in `main.tsx`.
  Reuse the existing open/error/collapse lifecycle, preserving draft/results
  on failure. Explicit inspection bypasses list-reader/media routing only;
  normal title activation continues its current navigation.
- [x] Build and run one `document-passage-find-use` journey using real captured
  neutral-name PDF/DOCX, the existing real local BGE profile and a long returned
  passage. Verify body wording/paraphrase, actual source, expanded non-prefix
  text and exact copied text, restart/reopen and original byte equality. Verify
  the new explicit floating inspector preserves returned evidence and input;
  reuse existing OCR/visual evidence where unchanged. Root owns this journey;
  investigate only observed failures or changed invariants, with no broad suite.
- [x] Review root/Luna diff, run diff check, update F04/M3 in existing records,
  commit and push. No new schema, endpoint, processor, provider, index dimension,
  durable state, reader service, runtime package or test framework. Preserve
  unrelated changes; this batch grants no full-recall or release qualification.


Actual local delivery: a small read-only source component keeps the excerpt and
reveals the returned text without clipping it again. Copy preserves that text
exactly and reports clipboard denial. The floating disclosure explicitly opens
its returned hit in the current host inspector; media/list title behavior is
unchanged. Inspecting the same captured subject refreshes only its requested
segments after entry/content checks, keeping unsaved Notes in the current
lifecycle. Different subjects use the normal draft-leave and subject-read gates.
Document passages use existing paging with one visible segment; source metadata
is disclosed on demand, rather than repeating long producer IDs by default.

The isolated port-4671 profile saved seven independent originals once, then
explicitly built its real installed BGE/CLIP generation. The daemon was stopped
and restarted before the browser workflow. Neutral-name `item-a.pdf` and
`item-b.docx` were found from body wording and their predeclared paraphrases;
the semantic components succeeded through `query.semantic.onnx-bge-zvec.v1`.
A longer DOCX returned 568 characters with `CedarBlue317` at position 538. The
browser exposed and copied that exact returned text, including the non-prefix
clue. A refused clipboard write showed failure; a later real write/read matched.
Explicit same-subject inspection preserved an unsaved note without writing it.
Media evidence opened Details with its returned source; normal image activation
still entered Photos. Expanding/copying did not increase `content.open` reads.

All three downloads matched independent inputs: 25,870-byte PDF, 36,990-byte
DOCX, and 37,018-byte long DOCX. Their SHA-256 values and actual commands/results
are retained with the source corpus, browser journey/log and final read-only
passage continuation under `dist/f04-20261031/`. The final continuation checked
source disclosure and next/previous text after the one-passage refinement; the
successful capture, index build and provider journey were not replayed. The
first browser driver waited for the empty composer's submit button to become
enabled; correcting it to await the enabled composer fixed that driver timeout.
No browser capture/apply or annotation mutation occurred. Root/Luna review,
final affected Web build, visual inspection and diff check passed.

F04's bounded local client scope is Done. Selected lexical sources are 14/14,
while overall rebuild remains DEGRADED for absent fields; this does not claim
full field presence, all-corpus recall, a new PDF reader, scanned-PDF OCR, model
redistribution qualification or core/release closure. F03 stays active, and
F05/F06 retain their screenshot/visual work. The port-4670 demo was not populated
or restarted by the acceptance run; it serves the updated shared Web build.

## M3 F05 readable and reusable screenshot text — 2026-10-31

Active batch: Phase 4 discovery and admitted first-party client maintenance,
under content-store §8/9 and OCR-1/2/3. Outcome: capture a neutral-name Chinese
screenshot, find it from printed text or a paraphrase, read/copy the recognized
text with honest quality/fragment state, and take out the same original image.

Concrete gaps: floating evidence currently prints the raw OCR JSON envelope,
while its useful-preview filter skips JSON altogether. Details decodes that
same OCR schema but has no recognized-text copy action and clips long returned
text at 6,000 characters. Reuse `searchOcrEvidence`; do not add another parser or
fetch full originals to display/copy already-returned text.

- [x] In `FloatingSearchResults.tsx`, use the existing OCR decoder for the
  useful preview and evidence disclosure. Keep malformed/unrecognized structured
  envelopes out of user-facing prose. Show existing partial/fragment/unknown
  labels when appropriate; default media title activation stays unchanged.
- [x] Extract the existing passage clipboard action into one shared
  `CopyTextButton.tsx`, used by `MatchedSourceText.tsx` and the current OCR
  Details block. Copy the exact decoded returned text, with visible denial.
  Preserve recognition state/quality; an optional full returned-text disclosure
  may extend the existing 6,000-character preview without another read. Reset
  feedback when its subject/source/text changes. No editor or second Notes
  record is created.
- [x] Build then run one `screenshot-find-read-use` journey on the existing
  isolated environment: ordinary new-image capture, explicit search preparation
  with installed real OCR/BGE, printed-text and paraphrase search, readable
  floating evidence, explicit Details, exact copy, quality/fragment disclosure,
  refresh and exact-original takeout. Reuse earlier unchanged bundle-absence
  and trust evidence. Root owns the whole journey; diagnose actual failures
  only, with no broad suite or new harness.
- [x] Root/Luna review, diff check and existing F05/M3 status update, then
  commit/push. No schema, endpoint, processor, provider, index dimension, durable
  record, model download, historical processor rerun, runtime loader or test
  framework. This grants no full-field/recall or release qualification.


Actual local delivery: the floating layer decodes OCR with the existing helper,
keeps only readable image evidence in prose, and prefers a complete decoded
record over fragments for the same known source. The original returned hit is
unchanged for inspection. A shared clipboard component copies the exact returned
string, reports denial and ignores late feedback after text changes, a newer
copy or unmount. The existing document passage uses the same helper. OCR keeps
its short preview and can disclose longer returned text without another read;
no Notes record, processor or new inference path was created.

The retained F04 port-4671 environment supplied seven existing distractors.
One neutral-name screenshot was newly captured once, and explicit preparation
used installed real PP-OCR/BGE/CLIP assets. OCR recognized all four independently
declared lines with TEXT, four regions, 0.998004 mean confidence, zero low
confidence regions and no truncation. Printed query `七月十二日` and paraphrase
`冰箱里的牛奶最迟应该在什么时候喝掉？` found that same source. The full decoded text
copied exactly; a rejected clipboard write remained a failure. The real BGE
result contained a shorter returned text fragment: it was readable/copyable as
that fragment, and its absent quality remained unknown. Refresh found the same
saved image. Its 74,634-byte download matched independent SHA-256
`8a2fd4cc149d98b6cca5c6b2a6f2092ac664e57f58935a4849ce4b4b2d06bcfa`.
The shared preview/copy continuation also found the existing long DOCX by body
and copied its returned passage correctly. Copy/quality did not add content
reads. Browser work performed no capture/apply or annotation mutation; the one
new-image setup capture was not replayed.

Evidence is retained in `dist/f05-20261031/`: independent screenshot and expected
visible lines, successful capture/preparation, whole browser journey/log,
decoded text/quality, original, screenshot and final read-only floating tail.
Visual review after the first journey found a semantic OCR JSON tail that did
not begin with an opening brace and escaped the initial presentation filter.
It now remains outside default image prose; other source kinds retain their
ordinary text path. The final driver initially counted legitimate filename and
image evidence as extra OCR paragraphs; it was corrected to require exactly one
full decoded OCR text plus only the independently known filename text. The
unchanged successful capture/index/copy/download steps were not repeated.
The tail passed and complete hit evidence still reached Details. Root/Luna diff
review, final affected Web build, visual review and diff check passed.

F05's local client scope is Done. Selected lexical source coverage is 17/17,
while overall field absence remains DEGRADED. No model inputs, profile digests,
processor rules or recovery authority changed; no historical processing or
first-query download ran. This does not qualify general recall, cross-platform
model distribution or a release. F03 and F06 retain their stated remaining work.
The user-facing port-4670 demo was not populated or restarted.
