# RestoreWeave Documentation

All project documentation is written in English.

> **Documentation status — unreleased core preview after `v0.1.0-prealpha.1`.** The current tree runs and tests the local inspect/protect/search/verify/restore workflow, including an explicit development-time installer for the fixed BGE/ONNX + zvec bundle and an optional browser client. The installer downloads pinned artifacts, verifies their digests, publishes the bundle atomically, and exposes the required restart and index-rebuild steps. A deterministic candidate-only offline artifact assembler now combines prebuilt daemon/CLI/Web assets with a retained semantic bundle and verifiable license/checksum evidence; it is not a supported installer or release qualification. RestoreWeave does not yet provide a qualified production repository or a release-qualified workflow/profile.

RestoreWeave is positioned as **a self-hosted home for your personal content**: “Keep it in your space. Find it, use it, take it with you.” Its first target is NAS and home-storage hobbyists. The formal product remains a content, description, discovery, export, and recovery plane; `RW-MVP-1` is a read-only managed archive and discovery profile. A shared content library and complete Photos/Music workflows are the product target. The admitted RW-PERSONAL-UX-1 client slice supplies dedicated Photos/Music pages, bounded original playback and transient queues; recorded artist/album navigation and transient queue controls are admitted client work; curated albums, new extraction and durable playlists remain outstanding. Video and document readers remain future work. Later NAS and enterprise profiles must qualify additional writable and distributed semantics separately. The project is not defined by a particular NAS vendor, repository engine, search engine, or AI runtime.

For the current product decisions and next-work map, start with the
[Content-First Product Decision](technical/content-first-product-decision.md).
It consolidates the operator's selected audience, daily loop, interface and
module boundaries, ADR links, and product priorities. The normative contracts
and Core MVP Execution Plan below continue to govern scope and implementation
order; older experience boards are not an independent queue.

Keep RestoreWeave as the working name and use the public descriptor **“A self-hosted home for your personal content.”** Its Chinese slogan is **“存进自己的空间，找得到、用得上、带得走”**. “Weave” is also used by an App Store application; no trademark clearance is claimed. See the informative [NAS content-hub product direction](technical/nas-content-hub-product-direction.md) and [ADR-018](technical/build-stack-and-architecture-selection.md#adr-018-nas-first-content-hub-positioning-and-deferred-media-views) for the experience boundary and evidence. Recovery remains the trust contract behind the product.

The initial product direction is **one person self-hosting for their own use**.
The [whole-product delivery target](technical/whole-product-delivery-target.md)
and [ADR-022](technical/build-stack-and-architecture-selection.md#adr-022-whole-product-acceptance-across-the-shared-content-loop)
keep intake, retrieval, first-party views, whole-interface choice and
self-deployment in one outcome map while preserving the core phase gates.
[Single-Operator Experience-Pack and Theme Design](technical/single-operator-experience-pack-design.md),
[ADR-019](technical/build-stack-and-architecture-selection.md#adr-019-bundled-vertical-client-modules-before-a-runtime-extension-framework),
[ADR-020](technical/build-stack-and-architecture-selection.md#adr-020-curated-color-palettes-as-a-presentation-sublayer),
and [ADR-021](technical/build-stack-and-architecture-selection.md#adr-021-replaceable-bundled-interface-experiences-over-shared-client-flows)
record official bundled-module boundaries, conflict handling, replaceable client
interfaces, and their secondary color palettes. The [research report](research/single-operator-plugins-and-themes-20261006.md)
compares DSH/Cordis and other extension/theme systems. These documents are
informative planning; they add no runtime, remote-user profile, or phase credit. The
[bounded client acceptance](technical/client-appearance-and-views-acceptance-20261006.md)
records the implemented built-in palettes and existing photo/audio lens
visibility slice. The [interface-experience acceptance](technical/client-interface-experiences-acceptance-20261006.md)
records the implemented workspace/showcase layouts, shared-state retention, and
responsive checks, with a continuation covering rendering failures and held
shared operations. Both are local client evidence only. The
[local development preview](technical/local-development-preview-20261006.md)
records the reproducible Mac trial, exact candidate identity, offline semantic
install, and independent-anchor clean-reader restore evidence. The
[local continuation acceptance](technical/local-completion-acceptance-20261006.md)
records larger bounded image inspection, real discovery checks, recoverable
storage measurements, and verification/provenance repairs without phase credit.
The [retrieval and accounting continuation](technical/retrieval-and-accounting-acceptance-20261006.md)
records query-scoped source explanations, truthful peak/deployment accounting,
the updated local daemon, and exact candidate acceptance. It grants no phase
or release credit.
The [first-use and source-explanation acceptance](technical/first-use-and-source-explanations-acceptance-20261006.md)
records the final-build empty-library journey, sparse layouts, retained-generation
queries, real fused source provenance, offline candidate recovery and current
preview identity. The whole-product target remains open.

For a shorter, user-facing tour, start with the [RestoreWeave Wiki](wiki/README.md). It is a navigation and explanation layer only; the requirement documents and ADRs below remain the single source of truth.

The core owns durable identity, policy, transactions, provenance, verification, and recovery meaning. Capture, file identification, extraction, fingerprinting, transformation, storage placement, indexing, and query ranking are replaceable where their algorithms genuinely vary. The reference distribution must still ship useful defaults; the project is a product with extension points, not an empty framework.

For the immediate product queue, read the
[2026-10-09 priority reset](technical/product-priority-reset-20261009.md):
daily named retrieval first, then batch original takeout and reviewed narrow
photo/audio use. ADR-023 stops successive isolated polish rounds; it does not
unlock the proposed archive/media contracts or close a release gate.

The operator's subsequent [platform clarification and specialist-app research](research/personal-content-platform-20261009.md)
and [ADR-024](technical/build-stack-and-architecture-selection.md#adr-024-complete-domain-experiences-over-one-personal-content-foundation)
define the full product target: a shared personal-content foundation with
complete photo and music experiences. Albums, artist/album navigation, queues
and playlists are baseline target work; the earlier media checklist describes
initial slices only. The [active todo](technical/product-experience-todo.md)
retains those complete workflows and the explicit scope-reconciliation task.
The target clarification grants no phase credit. The subsequent normative
[RW-PERSONAL-UX-1 client profile](requirements/first-party-client-experiences.md)
now admits its first bounded Photos/Music and SavedView development slice.
Albums, playlists, processors, media endpoints and release qualification remain
outside that initial admission; implementation evidence is recorded separately.
The [personal client acceptance](technical/personal-experiences-acceptance-20261009.md)
records the implemented Photos wall/viewer, Music player/transient queue and
daily saved retrieval, with local browser evidence and the remaining full-domain
gaps. [ADR-025](technical/build-stack-and-architecture-selection.md#adr-025-admit-dedicated-personal-client-workflows-without-a-new-media-service)
records their resource limits and shared-authority decision.

The subsequent [ADR-026](technical/build-stack-and-architecture-selection.md#adr-026-open-ended-bundled-experiences-with-one-host-authority)
and [extension contribution guide](technical/client-experience-extension-guide.md)
record open-ended reviewed pages and whole shells over one host authority.
The UX-E2/M2 [acceptance](technical/open-ended-client-experiences-acceptance-20261009.md)
records Exhibition, recorded artist/album browsing and queue controls. The
[media successor proposal](technical/media-experience-successor-proposal.md)
keeps retained photo derivatives, cover extraction and durable albums/playlists
reviewable but explicitly unadmitted. Runtime extension loading and a public
SDK remain future work; the default is still a useful personal product.

The subsequent [ADR-027](technical/build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions)
and normative UX-T1/P2 successor admit bounded browser ZIP takeout from the
existing frozen manifest and transient ordinary-photo thumbnails. Their
[local acceptance](technical/takeout-photo-acceptance-20261009.md) records
actual ZIP extraction/hash checks, large PNG/JPEG rendering and cancellation;
they add no backend format or core/release completion credit.

The admitted [UX-C1 domain-presentation contract](requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope)
groups renderers under one domain and keeps one returned-result scope.
[ADR-028](technical/build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition)
records the architecture boundary; the informative
[domain-presentation composition proposal](technical/domain-presentations-and-composition-20261009.md)
and [contribution guide](technical/client-experience-extension-guide.md)
describe migration and later fixed-template boundaries. These documents add
no implementation or browser-evidence credit. The
[UX-C1 local acceptance](technical/domain-presentation-acceptance-20261009.md)
records grouped navigation, held scope/work, routes, preferences and remaining
unverified branches. Album/playlist persistence and new extraction remain
separate unresolved successors; that UX-C1 cohort did not implement aggregate
templates or runtime loading.

The admitted [UX-C2 fixed-overview contract](requirements/first-party-client-experiences.md#11-ux-c2-fixed-mixed-content-overview)
and [ADR-029](technical/build-stack-and-architecture-selection.md#adr-029-one-fixed-overview-before-a-general-composition-framework)
define one mixed-content layout over shared scope/actions/budgets. Its
[local acceptance](technical/fixed-overview-acceptance-20261009.md) records the
implemented bounded Overview and remaining branches. The
[durable album/playlist design](technical/durable-media-organization-design.md)
settles review candidates but remains proposed, with no persistence writes or
new portable-record admission.

The admitted [UX-F1 shared favorite shortcut](requirements/first-party-client-experiences.md#12-ux-f1-shared-favorites-through-existing-user-tags)
uses the existing visible `Favorite` TAG across Photos, Music and Overview;
the [ADR-030 implementation record](technical/build-stack-and-architecture-selection.md#adr-030-shared-favorite-shortcuts-before-durable-media-membership)
and [local acceptance](technical/shared-favorites-acceptance-20261009.md)
cover the current client slice and its evidence limits. This is catalog tag
organization, not album/playlist membership or an immediate signed backup per
write. Durable albums and ordered playlists still require reviewed organization,
recovery and export contracts before implementation.

The admitted [UX-Q1 occurrence-aware queue successor](requirements/first-party-client-experiences.md#13-ux-q1-occurrence-aware-listening-and-batch-queue-actions)
adds Music batch actions to the one transient player queue. [ADR-031](technical/build-stack-and-architecture-selection.md#adr-031-occurrence-aware-transient-listening-and-music-batch-actions)
records its authority boundary and why a protected playlist document does not
provide native current-state editing. The [local acceptance](technical/occurrence-queue-acceptance-20261009.md)
is pending integrated browser evidence; no persistent playlist or core-phase
credit follows from queue work.

## Recommended reading order

1. [Product Requirements](requirements/product-requirements.md) defines the product, target users, product promise, functional scope, and roadmap.
2. [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md) freezes the content-first storage model, default deduplication, embedding policy, view/export semantics, and replaceable seams.
3. [MVP and Operator Contract](requirements/mvp-and-operator-contract.md) freezes the first exact profile and its acceptance tests.
4. [System Architecture](requirements/system-architecture.md) defines runtime components, data flow, and authority boundaries.
5. [Core Kernel and Interface Requirements](requirements/core-kernel-and-interface.md) defines durable core ownership and compatibility policy.
6. [Driver and Processor Interfaces](requirements/driver-and-processor-interfaces.md) defines replaceable capture, processing, storage, indexing, and related extension behavior.
7. [File Identification and Extraction](requirements/file-identification-and-extraction.md) defines the extension, magic-byte, structural, and optional learned evidence ladder.
8. [Namespace and Content Access](technical/namespace-and-content-access.md) defines how physically transformed or deduplicated data maps back to a file-shaped recovery projection.
9. [Security and Threat Model](requirements/security-and-threat-model.md) defines the active filesystem, parser, repository, and interface security gates.
10. [Release Qualification and Traceability](requirements/release-qualification-and-traceability.md) defines the compatibility tuple and evidence required before a profile ships.
11. [Core MVP Execution Plan](technical/core-mvp-execution-plan.md) is the only dependency-ordered implementation path for configuration, protection, recovery, descriptions, search, storage, and exports.
12. [Remaining Work and Closed Decisions](technical/remaining-work-and-closed-decisions.md) records current status and decisions that must not be reopened.
13. [Implementation Completion Plan](technical/implementation-completion-plan.md) is a host/platform and repository-qualification record; it cannot reorder the core plan.
14. [NAS Vertical Slice Implementation Plan](technical/nas-vertical-slice-implementation-plan.md) preserves earlier slice detail but cannot reorder the core plan.
15. [WebUI Architecture](technical/webui-architecture.md) is the informative module map, ownership rules, and surface checklist of the browser client. It cannot add product scope or a daemon operation.
16. [Experience Completion Plan](technical/experience-completion-plan.md), [Index Dimension Plan](technical/index-dimension-plan.md), [Foreign App Jobs](technical/foreign-app-jobs.md), and [Tool-Core Wedge Plan](technical/tool-core-wedge-plan.md) are optional adapter, fixture, or ecosystem history. They do not add requirements or completion credit. [Product Experience Plan](technical/product-experience-plan.md), [Product Experience Todo](technical/product-experience-todo.md), and [Product Experience Backlog](technical/product-experience-backlog.md) are the operator-facing roadmap, progress ledger, and item record above the core; none can reorder the core plan, and requirement status stays with the canonical matrix. The [Content-First Product Decision](technical/content-first-product-decision.md) records the current user-facing promise and experience priority overlay; [NAS Content-Hub Product Direction](technical/nas-content-hub-product-direction.md) records positioning and future presentation boundaries. These informative documents do not reduce normative MVP scope or alter phase gates.
17. [Whole-Architecture Open-Source Reference](technical/architecture-open-source-reference.md) records how each layer may consume open source without changing durable contracts.
18. [Ecosystem and Vertical Applications](requirements/ecosystem-and-vertical-apps.md) and [Ecosystem App Interface](technical/ecosystem-app-interface.md) define later bounded domain experiences over the same data plane.

## MVP-defining requirements

- [Product Requirements](requirements/product-requirements.md)
- [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md)
- [MVP and Operator Contract](requirements/mvp-and-operator-contract.md)
- [CLI and MCP Contract](requirements/cli-and-mcp-contract.md)
- [System Architecture](requirements/system-architecture.md)
- [Core Kernel and Interface Requirements](requirements/core-kernel-and-interface.md)
- [Security and Threat Model](requirements/security-and-threat-model.md)
- [Release Qualification and Traceability](requirements/release-qualification-and-traceability.md)

The MVP reference profile is self-hosted and NAS-oriented. It accepts local or mounted filesystem roots under a declared capture-consistency class. A Linux host or container is the reference deployment shape, but no specific distribution, NAS brand, or filesystem is a product-wide requirement. Optional platform capture profiles qualify independently.

The target `RW-MVP-1` release includes persisted operator configuration, deterministic suffix and magic-byte identification, exact hashing and duplicate accounting, explicit exact/link-only protection outcomes, one release-qualified repository engine, complete captured metadata and recovery references, durable descriptions and annotations, default lexical/structured/local-semantic search, minimal link groups, saved views, export manifests, verification, and restore. A link group is a current file-membership map from safe group-relative paths to stable file links; it reuses existing subjects, descriptions, annotations, search, and export rather than creating another catalog or content store. It has no user-visible version history: when a fixed point in time is needed, an ExportManifest freezes the selected file versions. Unknown or failed content processing falls back to exact preservation. RestoreWeave does not ship a filesystem projection or mount service; external tools consume materialized exports or authorized reads. The development profile now exercises the existing loop end to end, but link groups remain planned, and supported packaging, repository selection, cross-platform qualification, and full release acceptance remain open; see the canonical status matrix in [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md) and the [Core MVP Execution Plan](technical/core-mvp-execution-plan.md).

## Current status at a glance

| Area | State |
| --- | --- |
| Product definition and normative requirements | Documented and internally reviewed |
| Filesystem scanner, namespace records, and read service | Foundations implemented and tested |
| Exact repository, protection records, plan/apply executor, publication, and clean restore | The admitted development profile has implemented and tested Ed25519 prepared/commit records, signed processor-attempt and portable-fact children, portable subject mapping and body attachments, catalog-free restore, independent-anchor clean-install import/reader, recovery tokens, cross-process fencing, unknown-outcome reconciliation, bounded same-plan processor retry with restart/resume and real process-crash/takeover evidence, raw/zstd corruption and relocation handling, explicit host-owned repair, and identity-preserving copy-forward profile migration with signed clean-reader restore evidence. The raw and zstd repositories remain development/candidate profiles; production qualification, encryption release admission, broader crash/migration rollback, representative corpus and release-host evidence, broader per-field provenance, sparse extent maps, complete reader closure, and external reacquisition remain open. Whole-file deduplication is sufficient, optional chunking is unselected, and destructive GC remains disabled with `NON_DESTRUCTIVE_ONLY` planning. Arbitrary manual or rerouted reprocessing remains disabled by design. A separate encrypted zstd profile supplies experimental key-boundary evidence only |
| Durable descriptions | Append-only revisions, bounded CLI/API, source-aligned semantic segments, config/provider/segmentation profile binding, and portable authenticated recovery exist for the admitted profile; lifecycle and model-provider admission remain |
| Processor host and default extraction pack | In-process host plus UTF-8 text EXTRACT; Linux sandbox and Tika/ffprobe pack remain |
| SQLite lexical + zvec semantic generations | Lexical/structured feed and real local BGE/ONNX + zvec generations are implemented and tested with a provisioned verified bundle; fixture providers remain opt-in, and supported model packaging remains open |
| Capacity and analysis status | Read-only repository capacity (with explicit unknown/error state) and per-item tag/lexical/semantic index status are implemented and tested; they are rebuildable projections and do not block exact preservation |
| Minimal link groups | Planned for Phase 6; no catalog schema, typed operation, subject-kind/search authorization, group-aware export successor, browser workflow, portable recovery record, or executable acceptance evidence exists yet |
| CLI and read-only MCP | Target interfaces; foundations exist; not a release qualification |
| Demand, net savings, NAS performance, and long-term operations | Unverified; require corpus benchmarks and operator pilots |

## Normative cross-phase interfaces

- [Driver and Processor Interfaces](requirements/driver-and-processor-interfaces.md)
- [External AI and Semantic Extensions](requirements/external-ai-and-semantic-extensions.md)
- [File Identification and Extraction](requirements/file-identification-and-extraction.md)
- [Recovery Fidelity](requirements/recovery-fidelity.md)
- [Namespace and Content Access](technical/namespace-and-content-access.md)
- [Core Protocol and Reference Userland](technical/core-protocol-and-reference-userland.md)
- [NAS Vertical Slice Implementation Plan](technical/nas-vertical-slice-implementation-plan.md)
- [Build Stack and Architecture Selection](technical/build-stack-and-architecture-selection.md)
- [Restore Manifest Extended Schema](requirements/restore-manifest.md)
- [Operations and Lifecycle](requirements/operations-and-lifecycle.md)

The baseline discovery product fuses lexical and structured fields with a local text embedding generation. Path provenance, filename, type, captured metadata, checksum, duplicates, durable tags, one user-facing `Notes` surface, versioned descriptions, processing state, available extracted text, and semantic similarity all resolve to stable subjects. The browser presents direct notes and descriptive text under that one Notes label; the backend keeps their durable record types separate when source, revision, or recovery provenance requires it. Coverage is reported per field and dimension. User annotations and descriptions are durable records with portable closure requirements; they are not disposable index documents. This presentation rule is frozen in [ADR-008](technical/build-stack-and-architecture-selection.md#adr-008-one-notes-presentation-over-provenance-preserving-text-records). A minimal file-only LinkGroup is planned for the MVP organization loop; richer Collections, CLIP, acoustic, graph, multimodal ranking, ratings, roles, nested groups, and relationship graphs are staged extensions. See [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md) for the LinkGroup boundary, default ONNX/zvec profile, and replacement policy.

## What is deliberately outside `RW-MVP-1`

Writable NAS protocols, automatic source deletion or pruning, P2P and magnets, remote LLM services, CLIP/OCR/ASR, neural or perceptual replacement, distributed vector services, database/VM/application-consistent capture, HA, multitenancy, enterprise governance, public remote REST/WebUI exposure, remote workers, mutation-capable MCP, and A2A are future profiles rather than hidden MVP obligations. A small loopback `/api/v1` adapter and browser client are optional convenience surfaces over the typed command ABI.

## Extended profiles

These documents preserve later requirements and design work. Documents already listed in the MVP or cross-phase sections above contain active requirements there; the remaining documents below do not add MVP obligations unless an MVP-defining document explicitly activates them.

- [Protection Policy and Planning](requirements/protection-policy-and-planning.md)
- [Application and Game Collections](requirements/application-and-game-collections.md)
- [Database and Virtual Machine Capture](requirements/database-and-virtual-machine-capture.md)
- [External Source and Retrieval](requirements/external-source-and-retrieval.md)
- [Cold Media and Offline Custody](requirements/cold-media-and-offline-custody.md)
- [Peer-to-Peer and Magnet](requirements/p2p-and-magnet.md)
- [Optional REST and WebUI Adapters](requirements/api-and-webui.md)
- [Ecosystem and Vertical Applications](requirements/ecosystem-and-vertical-apps.md)
- [Ecosystem App Interface](technical/ecosystem-app-interface.md)

P2P and magnet retrieval remain non-core. Perceptual media substitution, neural compression, VAE or RWKV-style codecs, automatic source deletion, writable NAS behavior, built-in filesystem/network gateways, and enterprise control-plane features require separately qualified profiles. External tools may present a materialized export or authorized read stream; they are not RestoreWeave storage or plugin interface families.

## Supporting designs

- [External AI and Semantic Discovery](requirements/ai-control-and-semantic-catalog.md)
- [Extension System](requirements/plugin-system.md)
- [Processing, Index, and External Automation Runtime](technical/processing-index-and-agent-runtime.md)
- [Universal Content Catalog Model](technical/universal-content-catalog-model.md)

## Research and references

- [NAS Product Power Review](references/nas-product-power-review.md)
- [Thin-Core Product Research Audit](references/thin-kernel-product-research.md)
- [Competitor and Component Research](references/competitor-research.md)
- [Open-Source Adoption and Code Borrowing](references/open-source-adoption-and-code-borrowing.md)
- [Borrowed Projects Catalog](references/borrowed-projects-catalog.md)
- [Experience Completion Plan](technical/experience-completion-plan.md)
- [Index Dimension Plan](technical/index-dimension-plan.md)
- [Whole-Architecture Open-Source Reference](technical/architecture-open-source-reference.md)
- [Ecosystem Application and Adapter References](references/ecosystem-application-adapters.md)
- [Demand Research](references/demand-research.md)
- [Historical AI and Runtime Research](references/ai-native-product-and-runtime-research.md)
- [Product Completeness Review](references/product-completeness-review.md)
- [Multimodal Fidelity Research](references/multimodal-fidelity-research.md)
- [Neural Compression Research](references/neural-compression-research.md)
- [Decentralized Music Audit](references/decentralized-music-audit.md)
- [Peer-to-Peer and Magnet Research](references/p2p-and-magnet-research.md)
- [Naming Research](references/naming-research.md)
- [Product Experience Backlog](technical/product-experience-backlog.md) records operator-requested product work with its constraint status; it adds no scope by itself
- [F3 Paper Review](technical/f3-paper-review.md) records how the F3 data-format paper compares with RestoreWeave's frozen decisions: what it validates, what cannot be adopted, and the two design notes it justifies
- [Notes Surface Decision Brief](technical/notes-surface-decision.md) answers "should RestoreWeave be a notes app" with three costed options and a recommendation; it adds no scope
- [LinkGroup Design Review](technical/linkgroup-design-review.md) freezes the LinkGroup contract review, the design questions with their blocked candidates, and a proposed order for the Phase 6 slices; it adds no scope and authorizes no implementation

## Benchmark and qualification runs

- [Repository Engine Qualification Spike — Kopia / Restic / Plakar](technical/qualification-spike-results.md)
- [Phase 5 Operator Corpus Manifest](technical/phase5-operator-corpus-manifest.md)
- [Local BGE/ONNX Semantic Qualification](technical/semantic-qualification-results.md)
- [Core Preview Acceptance, 2026-10-05](technical/core-preview-acceptance-20261005.md) records the current intake/download/browser development evidence and remaining release gates
- [Local Development Preview, 2026-10-06](technical/local-development-preview-20261006.md) records persistent local trial instructions and a digest-bound offline candidate smoke

## Documentation authority

When documents conflict, use this order:

1. The current MVP and Operator Contract for the first qualified release.
2. Product Requirements for product scope and priority.
3. Content Store, Views, and Export Requirements for durable content, deduplication, default discovery, view/export, and GC semantics.
4. Core Kernel and Interface Requirements for authority and compatibility boundaries.
5. Topic-specific normative requirements.
6. Extended profiles and research documents.

Platform examples never create global product requirements. An operating-system or filesystem-specific statement applies only to its explicitly named qualification profile.
