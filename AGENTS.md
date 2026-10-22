# Cairn Agent Guardrails

This file applies to the entire repository. Read it before planning, editing, or
delegating work. Preserve unrelated worktree changes.

## Product North Star

Cairn is a single-person self-hosted personal-content platform. Its
trusted kernel is a content, description, discovery, export, and recovery
plane. Dedicated first-party client experiences share that kernel. It is not
a normal filesystem, mount service, media-server gateway, or OpenList fork.

The ordinary user loop is:

```text
configure
-> inspect and protect content
-> retain names, facts, descriptions, and recovery references
-> search lexical + structured + semantic information
-> select a LinkGroup or SavedView
-> freeze an ExportManifest
-> materialize and verify output
-> restore exact bytes when needed
```

Original paths are provenance and recovery projections. Organization belongs
to stable subjects, tags, descriptions, minimal link groups, relations, and
saved views. Normal workflows must not require users to know workspace, root,
entry, artifact, or other internal IDs.

If a proposed change neither improves this loop nor closes one of its recovery
or safety gates, keep it outside the core queue.

Each deployed instance is one owner's trust domain: one operator, one
repository, one catalog, no multi-tenant sharing model. Competitiveness comes
from trust and verifiable recovery (exact-byte restore, signed portable
records, honest fallback states), not from feature breadth. Real local
semantic search over the operator's own content is a core differentiator, not
an optional add-on. A small number of polished flagship surfaces (Photos,
Music, Overview) sell the product better than many half-finished ones.

## Convergence Phase

Cairn is currently in a convergence phase: finish and polish the
admitted core loop and the admitted first-party client surfaces before adding
new scope. Prefer closing an existing gap (recovery, trust, a rough edge in an
admitted UX surface) over starting a new surface or integration. A runtime
third-party plugin marketplace — untrusted third-party code running inside the
application, a public extension ABI for the kernel, or a plugin store — is
explicitly out of scope, not merely deferred; see ADR-026/028 in
`docs/technical/build-stack-and-architecture-selection.md`. Compiled first-party
components registered in-repo remain the only extension model for the kernel and
for anything that can affect identity, digests, processors, recovery records, or
exports. ADR-032 admits one narrow exception on the presentation plane only: a
versioned presentation package that declares an id, a supported host range, and
the render slots or palettes it fills; is admitted whole or refused whole; and
composes at build or install time so the running application executes no
third-party code. It can never reach the recovery plane — ADR-032 states that
exclusion as a hard boundary enforced structurally, not by review. Untrusted
runtime third-party code, a general extension ABI for the kernel, and any plugin
store remain out of scope.
MCP/CLI/AI-harness integration is a real future direction but is deferred
until after this convergence phase; do not start that work without a direct
request.

### ML-1 ordinary material-list client admission (2026-10-21)

The owner explicitly requested implementation of the material/Notes/Skill/list
loop. The bounded first-party client may author and read ordinary
`cairn.material-list.v1` JSON snapshots, copy live user NOTE/TAG context, retain
one exact Skill-text snapshot, hand material to an external AI by explicit
copy/paste, and save through existing reviewed intake. See the normative ML-1
section in `docs/requirements/first-party-client-experiences.md` and its
incorporated `docs/technical/material-list-client-contract.md`.
This admits a client content convention, not a new kernel durable schema,
record, processor, endpoint, list head, membership authority or runtime loader.
Revisions are new ordinary captures; no automatic refresh or integrated AI
execution is claimed. Loaded-scope unresolved rows remain visible and exact
takeout retains existing identity verification. Other phase gates and the
broader list/guide draft remain unchanged.

### ML-2 saved-list actions (2026-10-21)

The owner's continued feature-delivery request admits one client-only successor
in the existing list Reader: explicitly play or append supported audio members
through the host-owned verified player, and take out the list's unique files
through existing frozen ZIP or reviewed server-directory export. Resolve and
revalidate all occurrences against the current loaded catalog; any unresolved
member disables whole-list actions. Audio preserves supported occurrence order
and repetitions, visibly counts non-audio/unsupported omissions, and retains
the existing 32 MiB playback and 1,000-entry queue ceilings. Takeout uses unique
existing file targets and states that repeated targets are exported once; it
does not promise occurrence or output ordering. See the ML-2 section of the
first-party client contract and incorporated material-list client contract.
No new endpoint, durable state, list head, AI runner, media server, runtime
loader or phase/release completion is admitted.

### ML-3 explicit AI material-list candidate admission (2026-10-22)

The owner approved the concrete F12 specification in
`docs/superpowers/specs/2026-10-22-material-ai-candidates.md` after review.
The bounded first-party client may explicitly send its current ordinary-list
snapshot and one frozen Skill through one new `material.organize` typed
operation on the existing local command route. A dedicated immutable organizer
profile uses the separate `ORGANIZE` purpose and `text.material_list` data
class. Reuse existing credential references, protection policy, grants and
append-only egress audit; old DESCRIBE profiles/grants do not authorize it.
The operation returns only an untrusted transient candidate. Human acceptance
updates the editor; existing reviewed capture remains the only content write.

This is the narrow exception to ML-1's external-copy-only model handoff and to
no-new-provider/operation delegation restrictions, only for the approved
organizer/config/egress/client seams. No new HTTP route, operational durable
schema, processor, candidate store, list head, runtime loader, CLI/MCP surface,
tool execution or automatic refresh is admitted. No automatic original-body,
EXTRACT, image or audio reads occur. Input/candidate occurrences are capped at
32, serialized input at 128 KiB, candidate at 512 KiB, Skill at its existing
64 KiB, one provider request and 90 seconds, with stricter profile/grant bounds
winning. Late/cancelled/stale/invalid results leave the original draft intact.
See the incorporated ML-3 client and typed-provider contracts. One real-provider
whole-feature journey is required; a fixture or configured interface is not
F12 delivery. This admission changes no core phase or release gate.

The ML-3 admission of `ORGANIZE` in the existing grant ledger includes the
mechanical migration needed to widen its existing SQL purpose CHECK only.
Preserve existing grant rows/fields/indexes/triggers/foreign keys and all prior
purpose semantics; this admits no new durable entity, column or list format.

### CS-1/2/3 document-search admission (2026-10-19)

The owner explicitly approved the narrow PDF/DOCX body-search milestone in
ADR-063. Compiled first-party PDF/DOCX text extraction, its host route/budget/
producer bindings and existing search/client integration are admitted Phase 4
work. This is the sole exception to the no-new-processor delegation rule below.
Use the existing extracted-text artifact, lexical/BGE dimensions, matched-source
display and exact takeout; add no durable schema, endpoint, reader, background
service or index dimension. Initial execution covers new captures and ordinary
explicit recaptures only. It does not admit arbitrary rerouted old-capture
processing. Limits and exits are in the document-search admission section of
`docs/requirements/file-identification-and-extraction.md`.

### OCR-1/2/3 image-text delivery admission (2026-10-20)

The owner explicitly approved the bounded image-text proposal. Phase 4 may
deliver the existing `ocr.image.text.v1` / `rapidocr-ppocr-mobile-v1` capability:
an explicit operator-run, pinned local bundle preparation/install script;
maintenance fixes needed for real recognition and existing EXTRACT lexical/BGE
integration; and readable OCR text/quality in existing client Details.
This admits no new processor, index dimension, public command, endpoint,
durable schema, service or runtime loader. Exact preservation remains
independent. Use new captures or ordinary explicit recaptures only, with the
existing image/region/text/time bounds. No first-query downloads, scanned-PDF
OCR, CLIP delivery or arbitrary historical reprocessing is admitted. Changes
to model/dictionary/processing rules must retain distinct bound digests; old
facts and generations must never be silently reinterpreted. See the normative
image-text admission and `docs/technical/product-power-image-text-proposal.md`.

### VIS-1/2/3 visual-search delivery admission (2026-10-20)

The owner explicitly approved the concrete visual-search proposal in
`docs/technical/product-power-visual-search-proposal.md`. Phase 4 MAY deliver
the existing optional `chinese-clip-vit-base-patch16` / `multimodal-clip`
implementation on the current Darwin arm64 host: review and pin real model,
export-tool, runtime and license inputs; explicitly prepare/install a bundle;
build a separate image generation on operator request; and complete existing
Photos text/image-query and exact-original takeout. Maintenance fixes needed
for this real profile are admitted. This adds no dimension type, processor,
public command, endpoint, durable schema, recovery format, runtime loader or
external service. BGE remains a separate space. An explicit index build may
derive vectors from authorized saved originals through the existing bounded
provider; it does not rerun historical file processors or reinterpret existing
facts/generations. No implicit downloads, remote image inference, face/video
indexing, arbitrary historical reprocessing or release qualification is admitted.
This narrow successor overrides the earlier OCR admission's exclusion of CLIP
delivery only for this stated profile and workflow. Other exclusions remain.

## Frozen Decisions

- Exact identity is the SHA-256 digest of the complete logical byte stream plus
  its logical length.
- Default deduplication is exact whole-content deduplication. Embeddings,
  similarity, perceptual hashes, filenames, metadata, and RWKV/Transformer
  output never establish exact identity or authorize deletion.
- `STORE_EXACT` is the default protection mode.
- `LINK_ONLY` requires an explicit decision and remains visibly
  `LINK_ONLY_UNPROTECTED` until independently reacquired and verified.
- Unknown or failed derived processing does not block readable exact
  preservation. It produces an explicit fallback or unavailable outcome.
- The personal default discovery profile includes real local semantic search:
  pinned ONNX Runtime, `BAAI/bge-small-zh-v1.5`, and in-process zvec. Fixture
  vectors do not satisfy this requirement. Qdrant, Milvus, and Docker Compose
  are not personal-profile dependencies.
- Keep the physical storage choice simple: the current profile has one
  configured repository and one SQLite catalog. A future named storage scheme
  may bundle location, repository engine, exact deduplication, and compression
  for new placements, but it must not silently move old data or create another
  live metadata store. Repository capacity is a read-only optional report;
  `UNKNOWN` (with a reason when available) must not block exact saving.
- Per-file tag and index coverage are calculated status projections, not user
  tags or a new durable state store. The baseline is lexical + structured
  search; the local BGE semantic profile may run in the background or on
  demand, never as an exact-save prerequisite, and reports `READY`,
  `NOT_BUILT`, or `UNAVAILABLE` honestly. Future image/music dimensions keep
  separate models and generations and remain outside the current default.
- User, imported, extracted, and model-produced descriptions are durable,
  versioned content. AI description generation is an explicit, on-demand
  `DESCRIBE_SUBJECT` operation and is not an implicit ingest dependency.
- The user-facing free-form text concept is one `Notes` surface. User-authored,
  imported, extracted, and model-produced text is shown there with an optional
  source label; do not add a separate Description screen, setting, or search
  concept. Keep the durable source records distinct when provenance, acceptance,
  or recovery evidence needs them, but do not copy AI text into a second
  `Annotation.NOTE` merely for presentation.
- Daily organization is content-first and multi-tag-first. Source directories
  remain provenance and recovery projections. Reuse durable `Annotation.TAG`
  facts for user tags; deterministic type and format facets remain system
  fields. Machine classification must be explicit, attributable, previewed,
  and confirmed before it changes user-visible tags.
- The only planned MVP grouping primitive is a minimal `LinkGroup`: one stable
  group subject plus a current map from safe group-relative paths to stable
  file links. A file may appear in multiple groups without copying bytes.
  Changes update the current map; the group has no user-visible versions or
  revision chain. When a fixed point in time is needed, `ExportManifest`
  freezes the selected file versions separately. Group descriptions, tags,
  notes, search, and export reuse the existing subject mechanisms. Membership
  is not ownership and never authorizes byte deletion. A missing member stays
  visible as missing/unavailable, and an empty group remains until explicitly
  deleted. The initial profile has file members only: no nested groups, roles,
  dependency graph, or automatic AI grouping. Richer Collections remain
  deferred.
- The operational catalog and every search index are rebuildable projections.
  Repository objects plus authenticated portable recovery records are the
  recovery authority.
- Keep the physical core small: one configured SQLite catalog may hold the
  durable metadata and rebuildable search tables; the content repository holds
  file bytes and admitted representations. Do not add a second live metadata
  or recovery database merely to mirror the logical layers. Signed portable
  recovery records are backup artifacts emitted from the catalog/publication,
  not another operational service.
- Do not add complexity for hypothetical failures. Add a new durable store,
  service, or recovery mechanism only when a concrete user workflow requires
  it and an executable test demonstrates the need.
- Experimental RWKV/Transformer compression is never enabled silently. Until
  its exact-reversible profile is qualified, it remains opt-in and must show a
  clear warning that missing database/recovery backups or decoder dependencies
  can make compressed data unrecoverable.
- Storage, catalog, vector, and recovery locations come from persisted config.
  They never implicitly use a client process's current directory. `.` is an
  input source only when the user explicitly supplies it.
- Repository, embedding, processor, and index implementations are replaceable
  behind the narrow contracts in
  `docs/requirements/driver-and-processor-interfaces.md`. Their profile and
  version digests must be recorded; replacement cannot reinterpret old facts.
- FUSE/mount services, network filesystems, neural codecs, and external
  reacquisition are separate future or foreign-tool concerns, not hidden core
  dependencies.

## Documentation Authority

Resolve conflicts in this order:

1. `docs/requirements/mvp-and-operator-contract.md`
2. `docs/requirements/product-requirements.md`
3. `docs/requirements/content-store-views-and-exports.md`
4. `docs/requirements/core-kernel-and-interface.md`
5. Topic-specific normative requirements, including recovery, security, CLI,
   and release qualification contracts
6. `docs/technical/core-mvp-execution-plan.md`, the only implementation order
7. Other technical plans, completion plans, fixture documents, and research

`docs/README.md` is the reading map. Informative documents can explain a
decision but cannot add MVP scope, reorder phases, weaken a normative contract,
or award completion credit. Recovery evidence details belong to
`restore-manifest.md` and `recovery-fidelity.md`; content, deduplication,
discovery, view/export, and GC semantics belong to the content-store contract.

## Current Implementation Lock

The admitted Phase 3 Recovery Closure profile is implemented and tested for
the stated development scope. It is not release-qualified. Work in this order:

1. Complete the admitted xattr/ACL/sparse/detection fact profile and bind
   description, annotation, processor-artifact, and portable subject-mapping
   records into the authenticated closure. Terminal processor attempts use a
   signed complete-state successor chain. The admitted worker may perform only
   bounded automatic retry of the same signed plan with retry intent,
   idempotency, reconciliation, fencing, and retry ceilings bound to that
   tested lineage. Do not enable arbitrary manual, rerouted, or general
   reprocessing without a separately reviewed successor contract.
2. Complete independently retained trust-anchor handling and the clean-install
   import/reader workflow.
3. Add cross-process publication fencing or leases and unknown-outcome
   reconciliation.
4. Prove corruption rejection, relocation, and reader-dependency behavior for
   every admitted portable record.

Phase 4 and Phase 5 may start in parallel only after the Phase 3 portable
record shapes are frozen. Phase 4 supplies real ONNX/BGE + zvec, complete
search fields, segment provenance, and fused query. Phase 5 measures and
qualifies simple recoverable storage savings. Phase 6 supplies minimal
LinkGroup, SavedView, and ExportManifest ergonomics. This documentation
decision does not authorize LinkGroup schema or API implementation before the
Phase 4 and Phase 5 gates close. Phase 7 supplies packaging, migration,
backup, upgrade, performance, and full release qualification.

The following remain outside the core queue:

- FUSE, mount, SMB, NFS, WebDAV, or S3 gateway behavior;
- an OpenList fork, dependency, or alternate core;
- new Inbox, OpenSubsonic, OPDS, player, or domain-reader surfaces; the
  portable Phase 3 recovery reader is required core work. A bounded local
  `/api/v1` adapter and browser client may call the typed dispatcher, but they
  must not add a second policy, job, catalog, or recovery state machine;
- new acoustic, graph, multimodal, or other index dimensions;
- richer Collections, nested groups, dependency graphs, roles, ratings, or
  automatic grouping beyond the minimal planned LinkGroup;
- RWKV, Transformer, arithmetic, or other neural codec implementations;
- automatic external download/reacquisition, source deletion, or destructive
  garbage collection.

The explicitly admitted `RW-PERSONAL-UX-1` local client track in
`docs/requirements/first-party-client-experiences.md` is an exception to the
player/domain-reader exclusion above: dedicated Photos presentation and
bounded continuous inspection, Music presentation and explicit bounded
downloaded-original playback, and existing daily SavedView access may run
parallel to Phase 4/5. It adds no backend endpoint, schema, processor, index,
durable domain state, remote profile or recovery meaning. Photo read budgets
remain unchanged; audio is capped and fully identity-checked before playback.
Album/playlist persistence, media streaming/transcoding and LinkGroup remain
behind their separately reviewed contracts and gates. No client result closes
a core phase or qualifies release.

Its explicitly admitted UX-E2/M2 successor also permits compiled namespaced
client page/presentation registration, a bounded photo exhibition, existing
audio-fact browsing, and transient queue reorder/shuffle/repeat/play-loaded-set.
It still admits no runtime third-party loader, new processor/durable format,
album/playlist persistence, backend endpoint or recovery authority.

Its UX-T1/P2 successor permits bounded browser ZIP takeout through the existing
frozen ExportManifest summary and original-download route, and visible-card
transient PNG/JPEG renditions under the byte, pixel, concurrency and cache
ceilings in the same normative client contract. It adds no new manifest shape,
processor, retained derivative, receipt or recovery authority. Single original
and server-directory export remain available beyond browser memory budgets.

Other existing adapters are maintenance-only. A fixture, mock, protocol handshake,
interface, or signed foundation is not a shipped capability or a closed phase.

Its UX-C1 client refinement permits domain-grouped compiled presentations over
one host-owned loaded/search/tag result scope, compatible client deep links and
identity-matched transient size projections. It does not admit a new query
authority, saved-query semantics, runtime loader or durable domain record; the
first-party client contract defines its limits and exits.

Its UX-C2 successor admits one fixed compiled mixed-content overview with the
same scope, host actions, global thumbnail budget and verified player. It adds
no durable domain organization, runtime loader or recovery authority. The
first-party client contract defines bounded blocks and loading/fallback exits.

Its UX-F1 shortcut permits explicit favorite/unfavorite through the ordinary
visible `Favorite` user TAG and shared filtering over existing annotations.
Unknown tag reads remain unavailable and disable mutation. It adds no durable
membership model, immediate portable-publication claim or backend contract.

Its UX-Q1 successor permits distinct transient queue occurrences and batch
append/play actions within the displayed Music scope, with one controlled
queue editor and a 1,000-entry ceiling. It adds no persistent playlist,
document-head convention, schema, endpoint or signed format.

## Mandatory Work Checkpoints

### Product delivery and testing order (owner decision, 2026-10-19)

#### Function-level issue rule (owner clarification, 2026-10-21)

Issues track a user capability and the subfunctions needed to use it. Each
issue states existing usable/partly connected/missing behavior, the smallest
reuse-based implementation, and what the owner can do after delivery. Merge
design and necessary validation into that feature's checklist; do not create
standalone testing, speculative hardening, architecture or qualification work
as apparent product delivery. Keep distant profiles and research in the idea
record unless a concrete feature needs them. Compare mature products to find
relevant gaps, then narrow; their feature lists do not expand scope. Deliver
and integrate first, demonstrate the useful outcome, and investigate locally
only for actual failures or concrete changed invariants. Existing trust
contracts and release gates still apply when affected or actually qualifying
a release; do not turn them into an unrelated campaign for ordinary UX work.

Use [Cairn testing](.agents/skills/cairn-testing/SKILL.md) when selecting,
writing, or running tests. The delivery unit is a complete user-visible
feature, not an individual button, handler, file, or test case.
This owner decision replaces older routine-development instructions that
prescribe focused-then-broad testing for every slice. Explicit release
qualification gates remain applicable when actually qualifying a release.

Implement and integrate the whole admitted feature first. Then run one
explicitly selected end-to-end or integration journey against its user-facing
acceptance criteria. Use local tests afterward only to diagnose an observed
failure or cover a concrete, changed invariant that the journey cannot prove.
If the journey passes and no such gap remains, continue delivery rather than
expanding the test set. Compilation needed to run the feature is a prerequisite,
not a reason to start a separate validation campaign.

Do not turn mutable business rules, UI wording/layout, internal call sequences,
or third-party library internals into numerous local tests. Verify the useful
outcome and actual side effects of the whole feature. Exact-byte preservation,
recovery, and other applicable trust boundaries still require evidence when
affected; demonstrate them in the same journey where practical, without
duplicating already-covered assertions.

Run only affected checks. Do not automatically run `go test ./...` or a full
E2E suite for every slice. A broader regression run needs a stated concrete
cross-cutting impact, an applicable release gate, or an explicit user request.
E2E journeys remain opt-in and individually named. Documentation, translation,
layout, test-driver, or report-only changes do not justify rerunning unrelated
backend tests. Reuse still-applicable results; changing an evidence filename,
source-list hash, or status document alone does not invalidate tested code.

Keep validation lightweight: reuse the existing journey, environment, and
helpers; combine related inputs and assertions in one run. A failing test
driver should be repaired narrowly, then resume or repeat only the affected
journey. Do not restart successful ingest/export mutations blindly, weaken
assertions, or launch a new full regression campaign to repair a selector.
Do not create a new harness, matrix, freeze/receipt pipeline, or acceptance
document per minor change merely to demonstrate activity. Report the usable
capability, its remaining gap, and relevant evidence; test counts are not
product progress.

Before every complete feature batch (not every internal edit):

1. Read `docs/README.md`,
   `docs/requirements/content-store-views-and-exports.md`, and
   `docs/technical/core-mvp-execution-plan.md`.
2. Inspect the worktree and preserve changes not owned by the slice.
3. State one active phase, one normative requirement, and one executable
   whole-feature acceptance journey that the batch advances. Subtasks share
   this journey rather than each inventing a separate test campaign.
4. Confirm that the slice is inside the current lock or the explicitly
   admitted `RW-PERSONAL-UX-1` client profile, and creates no other new surface.

Re-read the core execution plan at these boundaries:

- before changing a durable schema, public command, provider interface, or
  signed format;
- before starting the next complete feature batch;
- after a test reveals that the planned contract is incomplete;
- before changing any status matrix or calling work complete.

Before finishing a feature batch:

1. Run the selected whole-feature journey after implementation and integration.
   Check observable results and actual side effects against independent expected
   outcomes. A real provider is required where the capability depends on one.
2. Investigate failing steps locally. Add or run a focused test only for that
   failure or a specific uncovered invariant; state what it proves. Do not
   duplicate coverage merely because another file or branch changed.
3. Run `git diff --check`. For documentation-only work, review the changed
   instructions and links; do not run application tests or builds.
4. Review affected config, paths, enums, signed fields, and profile digests
   against the normative documents. Check applicable failure/unavailable
   outcomes in the same journey where possible.
5. Do not report fixture/harness success as a real default capability, or a
   passing backend check as proof that the user-facing workflow works.
6. Update status prose only when executable evidence changed. Use
   `implemented` for tested implementation and `qualified` only after the
   stated release gate passes.

Every delegated task must include these guardrails, its allowed file/scope
boundary, and its phase/requirement/exit-test triple. Agents must report
conflicts instead of silently broadening scope.
Delegate implementation first and share one batch acceptance owner. Delegates
must not independently create overlapping local suites or run broad regression
sets. Routine read-only diagnosis and test-driver corrections within the
assigned scope do not require a new permission round; report actual product
failures and unresolved mutation outcomes promptly.

## Subagent and Model-Drift Guardrails

When delegating to a subagent or a different/cheaper model, the delegating
prompt must restate: this file's North Star and Convergence Phase section,
the exact file/scope boundary, the phase/requirement/exit-test triple, and
"report conflicts instead of broadening scope; do not commit". The delegate
must not introduce a new durable schema, endpoint, processor, runtime loader,
or test framework (except the explicitly admitted CS PDF/DOCX processors above),
and must not mark a todo-ledger row `[x]` without stating
the executable evidence. The reviewer (the delegating agent or the human)
reads the diff before accepting it; an unreviewed subagent diff is not
finished work. MCP/CLI/AI-harness integration work must not be started by a
delegate without a direct human request, per the Convergence Phase section
above.
