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
third-party plugin marketplace — installable third-party extensions, a
public extension ABI, or a plugin store — is explicitly out of scope, not
merely deferred; see ADR-026/028 in
`docs/technical/build-stack-and-architecture-selection.md`. Compiled
first-party components registered in-repo remain the only extension model.
MCP/CLI/AI-harness integration is a real future direction but is deferred
until after this convergence phase; do not start that work without a direct
request.

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

Before every implementation slice:

1. Read `docs/README.md`,
   `docs/requirements/content-store-views-and-exports.md`, and
   `docs/technical/core-mvp-execution-plan.md`.
2. Inspect the worktree and preserve changes not owned by the slice.
3. State one active phase, one normative requirement, and one executable exit
   test that the slice advances.
4. Confirm that the slice is inside the current lock or the explicitly
   admitted `RW-PERSONAL-UX-1` client profile, and creates no other new surface.

Re-read the core execution plan at these boundaries:

- before changing a durable schema, public command, provider interface, or
  signed format;
- before starting the next implementation slice;
- after a test reveals that the planned contract is incomplete;
- before changing any status matrix or calling work complete.

Before finishing a slice:

1. Run focused tests proportional to the change, then the broadest practical
   Go test set.
2. Run `git diff --check`.
3. Verify config, paths, enums, signed fields, and profile digests against the
   normative documents.
4. Check that failures and unavailable providers remain visible and fail
   closed where recovery meaning is affected.
5. Check that no fixture or harness is reported as a real default capability.
6. Update status prose only when executable evidence changed. Use
   `implemented` for tested implementation and `qualified` only after the
   stated release gate passes.

Every delegated task must include these guardrails, its allowed file/scope
boundary, and its phase/requirement/exit-test triple. Agents must report
conflicts instead of silently broadening scope.

## Subagent and Model-Drift Guardrails

When delegating to a subagent or a different/cheaper model, the delegating
prompt must restate: this file's North Star and Convergence Phase section,
the exact file/scope boundary, the phase/requirement/exit-test triple, and
"report conflicts instead of broadening scope; do not commit". The delegate
must not introduce a new durable schema, endpoint, processor, runtime loader,
or test framework, and must not mark a todo-ledger row `[x]` without stating
the executable evidence. The reviewer (the delegating agent or the human)
reads the diff before accepting it; an unreviewed subagent diff is not
finished work. MCP/CLI/AI-harness integration work must not be started by a
delegate without a direct human request, per the Convergence Phase section
above.
