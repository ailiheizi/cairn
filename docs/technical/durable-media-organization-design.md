# Durable Photo Albums and Music Playlists — Proposed Design

**Status: PROPOSED / NOT IMPLEMENTED.** This design records a reviewable candidate for durable photo albums
and ordered music playlists. It is not an admission, implementation order, schema, public API, Phase 6
result, or release claim. The normative client contract still defers durable membership to a separate
review. Current LinkGroup, Phase 4/5 and recovery requirements remain unchanged.

This document is subordinate to AGENTS.md, the normative requirements, and the [Core MVP Execution
Plan](core-mvp-execution-plan.md). It creates no second catalog, metadata service, recovery authority, or
browser-local membership.

## Product boundary

The target workflow is deliberately small: create a named album or playlist, add existing saved photo/music
subjects, reopen it after restart, remove or reorder organization entries, and take out exact originals
through a separate frozen ExportManifest. Playback continues to use the admitted explicit bounded
downloaded-original path; this proposal adds no streaming, transcoding, remote library query, or decoder
requirement.

The implementation, if later admitted, would use the configured SQLite catalog and repository. The host owns
collection identity, authorization, conflict resolution, publication and recovery. The browser is a client
of typed host operations. User tags, Notes, descriptions, filenames and URL state are not membership stores.

This model is intentionally not LinkGroup. LinkGroup remains the planned MVP file-only safe-relative-path
mapping and keeps its Phase 4/5 prerequisites. These domain records neither emulate nor complete it, and
their work cannot claim Phase 6 qualification.

## Proposed collection identity and membership

Use typed `PhotoAlbum` and `MusicPlaylist` subject kinds in the existing host-owned subject registry, each
with a stable, nonsemantic collection ID and workspace binding. Each record has a user-visible name, an
internal monotonic revision used for optimistic concurrency, and a complete current membership state. A
revision is not a user-visible version/history feature.

An album is an unordered set of distinct stable photo `SubjectRef`s. Repeated membership of the same subject
is rejected. This first design does not retain manual order; the presentation uses an explicit ordinary host
ordering such as name or current result order and labels it accordingly. Album rename changes only its name.
Album removal removes membership only.

A playlist is an ordered sequence of occurrence records. Each occurrence has its own stable occurrence ID,
stable music `SubjectRef`, and explicit sequence position. The same subject may occur more than once and
each occurrence stays distinct through reorder, export and recovery. Reorder atomically assigns the current
contiguous order; removing an occurrence does not remove another occurrence of the same subject. Playlist
rename and occurrence edits do not rewrite source facts or the audio original.

Membership binds to stable subject refs, not file paths, filenames, content digests, client row indexes, or
copied bytes. A subject may resolve to a newer current file state under ordinary host resolution. A missing
or unavailable subject remains in the collection and is presented with an honest typed state; it is not
silently pruned or substituted by a similar file. A rescan or duplicate-content match never changes
membership identity.

## Bounds and mutation behavior

Candidate first-version ceilings are 1,000 album/playlist records per workspace, 1,000 members or
occurrences per collection, and 100,000 total relationship rows per workspace. The canonical portable
collection state is also capped at 32 MiB. These are proposed hard input/output bounds, not performance
guarantees; qualification must measure representative restart, publication and clean-import cost before the
limits are adopted. A mutation that exceeds a bound fails atomically and visibly. It never truncates or
silently omits members.

Candidate host operations are typed create, rename, add/remove member, playlist reorder, get/list, and
export selection. Names and referenced subject kinds/workspace are validated by the host. Operations require
the current internal revision (or an equivalent compare-and-swap token); a stale mutation returns a conflict
and leaves the current state unchanged. Membership and revision updates occur in one SQLite transaction.
Duplicate album refs, duplicate occurrence IDs, invalid order, cross-workspace refs and wrong media subject
kinds are rejected.

No mutation deletes or unprotects an original, changes its protection record, retires a representation, or
authorizes garbage collection. Collection deletion, if included in a later admission, must be explicit and
must remove only the collection and its relationship state. Empty collections remain until explicit
deletion. Collections are not nested and have no roles, generated membership, cover ownership, revision
browser, or separate history in this initial proposal.

## Catalog and portable recovery boundary

Store collection descriptors and membership in the one configured SQLite catalog, using typed tables/records
and indexes in the existing database. Do not store structured membership in `Annotation`, `MetadataFact`, a
`DescriptionDocument`, a saved query, or client local storage. Search support, if admitted later, is a
rebuildable projection over registered collection subjects; it is not membership authority.

The current portable-fact bundle validates a closed set of record kinds and rejects unknown kinds. Do not
inject collection JSON into an annotation or reinterpret an existing fact record. The proposed recovery seam
is a separate, versioned signed complete-state media-organization successor record, placed through the
existing repository record adapter and using the same catalog, repository, trust anchor, publication domain,
fencing and reconciliation contracts. It carries the full current state of all admitted albums and
playlists, stable collection/member/occurrence IDs, revisions, order, and workspace/snapshot lineage. It is
not a second operational store or a per-collection history chain.

The complete-state record is published as an authenticated successor bound to the admitted parent
publication and previous media-state digest. A portable reader validates schema, signer/trust anchor, parent
lineage, fencing, canonical digest, workspace scope, duplicate IDs, subject mappings, member types,
collection limits and playlist order before exposing the state. Concurrent writers must be fenced; a fork,
gap, stale parent or unknown outcome fails closed until reconciliation establishes the one committed
successor.

Catalog mutation and repository publication are not one physical transaction. The proposed lifecycle stages
a candidate revision without making it the active catalog state, publishes the complete signed successor,
reconciles any unknown placement outcome, then atomically activates the matching catalog projection. The
same idempotency key/candidate digest is used for bounded reconciliation. If publication is pending or
unavailable, keep the previous active state and report the proposed edit as pending/failed; do not claim it
was saved or portable. On restart, reconcile the signed head and staged candidate before accepting further
mutations. The exact candidate/activation protocol must be reviewed against the current fencing
implementation before admission.

A clean import reconstructs collections and references without SQLite, indexes, the browser, or optional
media processors. Member availability is resolved from the imported subject mappings and existing recovery
references; unavailable members remain visible. Exact original restoration remains independent of
album/playlist UI or media extraction. A reader that does not support the optional media-organization record
reports that organization state as unsupported; it must not silently claim a complete organization import.
The compatibility review must also prove that unsupported optional state does not make existing
exact-original restore unavailable. If the record format cannot provide that behavior, admission must choose
and document a new reader compatibility boundary before writing it.

## Export boundary

An explicit export from an album or playlist evaluates the live collection once, resolves every current
member/occurrence, and freezes the resolved subjects, exact file versions, source snapshot/recovery
references, output names and verification work into a separate `ExportManifest`. Duplicate playlist
occurrences need distinct safe output names or an explicit collision resolution before freeze.
Missing/unavailable members remain visible and prevent a complete-export claim; they are never omitted
silently.

After freeze, membership edits, rename, rescan, or current subject updates do not change that manifest.
Export verification and materialization use the existing frozen-manifest contract. The organization record
is not an export manifest, recovery receipt, or immutable takeout. No export result feeds back into
collection membership.

The legacy export v1 snapshot-entry handle is not a stable member or occurrence
reference. Cross-publication subject resolution and repeated-occurrence output
must be specified in a reviewed export successor; this proposal does not imply
that current flat-output operations already support them. Independently scoped
ordinary file selections retain their existing export behavior.

## Implementability review — 2026-10-09

This read-only review records current seams, not implementation evidence or
admission. Paths below are exact; tests described are future executable exits.

1. **Workspace authorization diverges at export.**
   `server/controlplane/dispatcher.go:resolveSubject` resolves a stable ref
   within an explicit workspace via
   `server/internal/store/sqlite/namespace.go:LookupLatestNamespaceEntryBySubjectRef`.
   `server/controlplane/content_ops.go:handleContentOpen` also requires
   `workspace_id`. In contrast,
   `server/controlplane/view_export_ops.go:lookupSubjectAcrossWorkspaces`
   silently selects workspace `default` for explicit export subjects.
   A reviewed media/export successor must carry and authorize the selected
   workspace end-to-end. Exit: same-workspace members resolve after republish;
   cross-workspace and unauthorized refs fail without freezing a manifest.

2. **Export v1 freezes a publication-local handle.**
   `server/controlplane/view_export_ops.go:freezeExportItems` writes
   `NamespaceEntry.ID` to `exact.ExportItem.SubjectRef`, although collection
   membership is a stable subject ref. A reviewed export successor must freeze
   the stable subject plus resolved publication/snapshot and exact file-version
   identity, then materialize that frozen version after later republish or
   membership edits. Exit: freeze, republish/edit, restart, and verify the
   original manifest still resolves and hashes the same bytes.

3. **Export v1 cannot represent repeated occurrences.**
   `server/internal/exact/export_manifest.go:ExportManifest.Validate` rejects
   duplicate `SubjectRef` and `OutputName`; `exact.ExportItem` has no occurrence
   identity. A reviewed successor must bind each playlist occurrence to a
   distinct item and safe unique output name, with explicit collision handling.
   Exit: repeated track occurrences survive reorder/removal and freeze as
   separately verifiable outputs; ambiguous names fail visibly before freeze.

4. **Durable organization is outside current portable records.**
   Annotation writes such as `server/controlplane/catalog_ops.go:handleAnnotationUpsert`
   update SQLite; they do not imply immediate publication into the authenticated
   portable chain. `server/internal/exact/portable_fact_closure.go` validates a
   closed record-kind set (including rejecting unknown kinds at its record
   validation switch). A separately reviewed organization successor must define
   staged SQLite state, signed publication, fencing/reconciliation, activation,
   clean import, and old-reader behavior without weakening exact restore.
   Exit: crash/unknown publication outcomes reconcile idempotently, clean import
   reconstructs state, and an old reader reports unsupported organization while
   still restoring originals. No fixture establishes this behavior today.

Proceed in this order: independent organization and export contract review,
then explicit admission, then a playlist vertical slice, then albums. This work
does not implement or complete LinkGroup and does not bypass its Phase 4/5
gates or earn Phase 6 credit.

## Migration and review gates

### Native state versus ordinary playlist documents — decision review

The 2026-10-09 three-Luna review rejected using ordinary protected JSON/M3U
files as the native playlist control plane. Such files may be stored and
restored as ordinary exact content, but existing browser upload creates a new
staging source. It does not update the prior source/path subject in place.
Finding the active edition by title, suffix, hidden tag or browser preference
would introduce an implicit current-head and concurrency protocol. Embedding
playlist IDs/revisions in file bodies does not remove that protocol. File
interchange is a separate feature and must not be labeled native save/edit.

The native candidate remains typed playlist descriptors and ordered occurrence
relationships in the existing catalog, with the separately reviewed signed
complete-state organization successor, activation/reconciliation and clean
import. No arbitrary workspace scan, source overwrite, TAG/Notes membership,
or second database is admitted by this decision review.

Native membership/playback and occurrence-complete exact takeout can have
separate executable exits. Native save/reopen/edit/play may be admitted only
after its own durable/recovery contract is reviewed; its first slice can omit
playlist export entirely. Existing single-original actions stay available.
The v1 export limitations must block a playlist-wide frozen-export claim,
without being disguised as an existing capability or forcing a new media
server. The export successor still requires independent review before its
implementation. This separation is a candidate implementation boundary,
not native-state admission or an alteration of the Phase 6 LinkGroup gate.

The admitted UX-Q1 occurrence-aware transient queue is a reusable client
listening foundation: repeated files retain separate insertion identities.
It supplies no native membership, saved session or organization recovery
evidence. The proposed native record/operation shapes above remain unimplemented.

Before any schema or command implementation, review and admit this successor against the applicable
normative client and recovery requirements. Preserve existing portable record meanings and schema readers.
Migration must be transactional, restart-safe, idempotent, and leave all exact-content, annotation,
saved-view, LinkGroup and ExportManifest state unchanged. No prior free-form tag/note/description is
auto-converted into membership. Failed migration rolls back and leaves original restore available.

Required focused acceptance before calling this durable feature implemented:

1. Create/rename/add/remove album; duplicate album membership is rejected;
   restart preserves its stable refs and explicit empty state.
2. Create a playlist with a repeated track, verify distinct stable occurrence
   IDs and order, reorder/restart, then remove one occurrence without changing
   the other.
3. Make members missing/unavailable and verify they remain visible through
   query, process restart, migration and clean import. Conflicting revisions
   and stale concurrency tokens are rejected without lost updates.
4. Exercise the candidate portable record's signature, tamper, schema, parent,
   fork/gap, workspace, invalid-ref, bad-order and bound rejection. Reopen from
   a clean install with the independent trust anchor and no SQLite/index/client
   state; verify exact originals independently.
5. Simulate publication pending, process crash and unknown placement outcome;
   reconcile idempotently, expose pending failure visibly, and prove no
   unportable candidate becomes active.
6. Freeze export, edit the collection, and verify the old manifest still
   materializes/verifies its frozen exact versions and names. Missing members
   block complete export; destructive byte/protection/GC behavior never occurs.

These are future gates, not current results. Phase 4/5 LinkGroup prerequisites remain exactly as specified
by the core plan. Durable media-organization work needs an explicit independent core/recovery admission and
a named phase/exit before implementation; no phase or release status changes here.
