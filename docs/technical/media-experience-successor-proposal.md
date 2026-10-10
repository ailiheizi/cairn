# Proposed RW-MEDIA-2 Successor

The later UX-P2 client admission supplies bounded transient PNG/JPEG
renditions only; see [ADR-027](build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions).
It does not admit this proposal's retained derivatives, new photo/audio facts,
processors, curated albums or persistent playlists.

**Status: PROPOSED — not admitted, not an implementation order, and no phase or release credit.** This informative proposal requests a later product and recovery-contract review for richer first-party photo and music experiences. It does not change the current implementation lock, Phase 4/5 gates, or the normative requirements.

## Purpose and boundary

The single-person NAS experience should make retained photos and music easier to inspect and revisit while preserving one host-owned content and recovery plane. Any future client remains a presentation over authorized stable subjects and exact originals. The host continues to own subject identity, annotations and Notes, authorization, repository bytes, catalog policy, and the authenticated recovery closure. One configured repository and the existing SQLite catalog remain the operational stores; this proposal creates no second database, media server, network service, or client recovery authority.

The current UX-E2/M2 client slice may browse artist, album, and track values already returned by `audio.list`, joining those facts only to currently loaded authorized subject refs. Missing facts retain filename rows; a failed facts request is visibly unavailable. This is a projection of existing admitted facts. It does not supply new metadata extraction or coverage. RW-MEDIA-2 would separately review the following future capabilities:

- larger photo previews and recorded orientation, with bounded inspection and honest fallback to the exact original;
- useful recorded photo facts, such as capture time or camera details, only when a reviewed processor can establish them from source bytes;
- embedded music cover presentation and any additional photo/audio facts, only from reviewed extraction and representation contracts;
- curated photo albums and ordered music playlists as durable user organization.

Filenames, paths, visual appearance, and model guesses do not establish capture facts, artists, albums, covers, or membership. Missing or unsupported facts remain explicitly unknown. A preview, cover, or fact must never replace or weaken exact-original identity or recovery.

## Required contract decisions before implementation

### Derived media and recovery

The review must decide which previews are transient bounded reads and which, if any, are retained derived artifacts. A proposal cannot label retained thumbnails or covers “outside recovery” by assertion. Every admitted durable derived artifact must have a defined source subject, exact source version or other reviewed binding, processor/profile/version provenance, verification behavior, relocation behavior, and authenticated portable recovery-closure representation. Its reader and clean-install import behavior must be specified alongside the record shape. If a derived artifact cannot meet that contract, the review must choose a bounded on-demand path or leave that capability deferred.

Orientation and photo facts require a reviewed source of truth, malformed-input and unavailable outcomes, and explicit handling of conflicting or absent records. Cover extraction must not create user-visible artwork when bytes do not contain a valid supported cover. All processing remains optional to exact preservation; an extraction failure leaves the original readable and its fact state visibly unavailable or absent.

Any new processor or backfill path requires a separately reviewed signed complete-state successor contract. Arbitrary manual reruns are not authorized by this proposal. Before enabling retries or reprocessing, review the signed plan lineage, retry intent and ceiling, idempotency, reconciliation, and publication fencing against the tested Phase 3 worker contract. Facts from a new profile or generation must not silently reinterpret existing facts.

### Durable albums and playlists

The normative admission remains unresolved and explicitly separate from
LinkGroup. A concrete candidate is now recorded in the
[Durable Photo Albums and Music Playlists design](durable-media-organization-design.md).
That design proposes typed stable album/playlist subjects in the existing
catalog, albums as unordered deduplicated sets, playlists as ordered stable
occurrences (duplicates allowed), visible missing members, non-destructive
removal, and bounded size limits. These are candidate decisions for review,
not approved semantics, schema or implementation authorization. Product,
catalog/concurrency and recovery owners must accept or revise them before any
write implementation. They must not be smuggled in as LinkGroup or treated as
authorized by the Phase 6 LinkGroup design. Phase 4 and Phase 5 gates remain
prerequisites to Phase 6 and are not moved by this proposal.

Saved views remain dynamic, while any frozen takeout uses a separate `ExportManifest` that pins its admitted membership and file versions. A later album or playlist must not turn live membership into an implicit frozen export, or make export history the membership authority.

If durable organization or derived artifacts are admitted, the review must specify backward-compatible migration and restart behavior, authenticated portable publication/import, clean-install reader dependencies, corruption rejection, and relocation. Existing catalog and portable records retain their old meanings. A clean import must reconstruct available members and facts, preserve missing members explicitly, and permit exact original restore without requiring the optional media processors or browser client.

## Review checkpoints

No implementation starts until product and recovery owners have reviewed these decisions against the authoritative requirements and execution plan. The review must:

1. name the exact Phase 4/5 gate state and confirm that no Phase 6 or LinkGroup prerequisite is being bypassed;
2. settle the transient-versus-retained preview boundary and, for every retained artifact or durable fact, its authenticated closure and clean-reader shape;
3. settle processor provenance, versioning, retry/backfill lineage, fencing, and unavailable outcomes before any extraction or rerun path is enabled;
4. approve album and playlist identity, relation, ordering, duplicate-occurrence, missing-member, removal, migration, and export semantics before schema or command design;
5. identify one active phase, one normative requirement, and executable exit tests for each admitted implementation slice, then separately admit that slice in the normative client/recovery contracts and implementation order.

The review and any eventual client validation should use the supported local Mac/browser and single-person NAS workflow. Linux/network qualification detours, plugin installers, gateways, and runtime third-party loaders are outside this proposal.

## Proposed executable acceptance gates

These are gates for a future reviewed implementation; they are not current capabilities or test results.

1. Real retained photos with recorded orientation and larger bounded inspection render with the recorded orientation; absent, malformed, oversized, and unsupported cases state the limitation and retain reachable Details/original actions. Photo facts shown in browse/search trace to the admitted processor record and current stable subject.
2. A supported embedded cover is visibly attributable to its source and processor record. Missing, invalid, or unsupported covers show no invented artwork. Extraction failure does not block exact save, byte verification, or original takeout.
3. Any retained preview, cover, or new durable fact survives catalog/index loss through its authenticated portable closure, imports on a clean installation with declared reader dependencies, rejects tampering, and resolves after repository relocation. If the approved design is transient-only, executable evidence proves the bounded read and that no durable artifact or recovery claim is created.
4. Curated albums and ordered playlists preserve stable subject refs and occurrence identity/order across refresh, restart, migration, and clean import. Duplicate playlist occurrences remain distinct; missing subjects remain visible; removal is non-destructive; exact originals and protection/GC eligibility do not change.
5. A frozen export remains unchanged after album or playlist edits, and its manifest independently resolves and verifies the exact selected file versions. Re-evaluating a live view or organization does not rewrite an existing manifest.
6. Processor/profile upgrades, bounded retries, reconciliation, and concurrent publication follow the admitted signed successor and fencing contracts. Failed or unavailable processing is explicit and cannot replace a verified fact or recovery record silently.

Passing any client-level gate would establish only the specific local client behavior. It would not qualify a host, close a core phase, establish complete metadata coverage, or qualify release.
