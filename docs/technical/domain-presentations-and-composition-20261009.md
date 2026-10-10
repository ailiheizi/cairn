# Domain Presentations and Shared-Scope Composition

**Status:** Informative implementation proposal for the admitted UX-C1 client
successor. It does not add normative scope beyond
[First-Party Personal Client Experiences §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope),
authorize a backend/schema change, or establish browser acceptance. Current
implementation evidence is recorded in
[the UX-C1 local acceptance](domain-presentation-acceptance-20261009.md). The
architecture record is [ADR-028](build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition).

The later [UX-C2 contract](../requirements/first-party-client-experiences.md#11-ux-c2-fixed-mixed-content-overview)
admits one fixed Overview; its [local acceptance](fixed-overview-acceptance-20261009.md)
records implementation. The reusable block SDK remains a future seam, not a
capability supplied by that fixed template.

## Decision summary

Model a domain as a grouped destination and its renderers as presentations of
one host-owned scope. Photos contains Photo wall and Exhibition. Music presents
loaded tracks and any authorized existing music facts. An independent page is
appropriate when it owns a distinct task flow, not merely a different way to
render the current domain results. A whole-interface shell arranges the
client's existing regions and state; it is not a domain or presentation.

Reusable aggregate blocks are a later, smaller composition seam: fixed host
templates may place a few blocks, each reading a declared slice of the shared
scope and issuing narrow host actions. This does not admit a free-form canvas,
layout editor, public component SDK, runtime package loader or third-party
isolation. The host still owns query, loaded-result authority, selection,
subject resolution, Notes guards, player, authorized reads and global resource
budgets.

## Registry and navigation boundaries

Keep the existing stable page IDs, short routes, modes, renderer slots and
browser-local disabled-ID meanings. A presentation record names one registered
root page and is valid only when root and child share the same loaded context
and media class. Reject absent roots, chains, cycles, context/facet mismatch,
duplicate registrations and reserved collisions before publishing the
catalog. The root relation is a registry grouping rule; it is not a content
membership relation or a durable subject link.

Group presentations under their domain in navigation and settings. The
Photos destination represents the group, while Photo wall and Exhibition have
independent presentation preferences. Disabling one must not silently change
another preference. The domain is available while at least one compatible
presentation is enabled; if none is available, hide the destination and make
any direct route fallback visible. Keep general task pages and whole-interface
shell selection in their existing separate navigation/settings roles.

Retain old `photos`, `music`, and `exhibition` route behavior. A legacy
Exhibition route can resolve to Photos + Exhibition, using history replacement
when needed to avoid a back-button loop. Do not discard existing query/tag
hash semantics or place internal subject IDs in URLs. A newly registered
presentation route may be added to the existing hash contract; unknown or
disabled presentation routes fall back visibly within the same result scope.

## One scope, multiple projections

The host owns one result scope containing the current search and tag/facet
conditions, loaded result snapshot, and relevant context. A presentation switch
is a rendering change only: it must not rerun the query, clear conditions,
change the returned set, or create parallel selection or search state. Search
order remains the server-returned relevance order. Media facets and counts
describe only the currently returned results and must say so; they do not
claim exhaustive server-library totals. Keep a direct all-types route and an
empty message such as “no photos in these returned results.” Clearing a
condition and leaving the domain remain independent actions.

Only use the same loaded library classifier for domain projections and counts.
If an existing result lacks a logical length, a current loaded row may supply
it only when workspace/namespace, stable subject reference, entry reference
and canonical content identity match as one unambiguous tuple. Missing,
conflicting, stale or mismatched information remains unknown. A projection is
transient display/action context; it does not create a durable fact or permit
substituting another row's bytes.

Save/evaluate continues to use the existing SavedView contract. If an active
domain restriction cannot be expressed by the saved query, saving must refuse
that scope rather than broaden it. A presentation change must not reset
selection, subject focus, Details/Notes drafts or active playback within the
same context. Leaving the domain continues through the existing draft guard;
workspace/snapshot replacement cancels obsolete reads and does not preserve
stale read authority.

## Fixed-template aggregate blocks

When a later admitted slice implements aggregation, start with fixed host-owned
templates and a small set of built-in blocks. Each block declares which
existing scope selector it consumes (for example a domain plus the current
query), receives data as a read-only projection, and invokes host-provided
typed actions. The host allocates one shared decode, thumbnail, Blob and
playback budget across all mounted blocks; each block must not multiply that
budget. Blocks do not own a duplicate query, selection, result cache, player or
direct file-read route.

The whole-interface shell remains a separate layout layer that rearranges
header, navigation, content and Details. Shared selection and actions stay
host-provided whether the user sees a standalone domain page or a template
block. A React error boundary can recover presentation state but cannot
confine trusted compiled code.

## Consultation disposition

Two successful `openainext / claude-opus-5-5` turns were retained at
`dist/page-presentation-composition-20261009/initial-response.md` and
`followup-response.md` (session
`session-363890e3-14fd-4cd9-8aeb-83f7bd2428e0`, exit status 0, no tool events).
They are advisory input only. This proposal adopts the distinction between
domains, presentations, task pages, fixed-template blocks and shells; it also
adopts one host scope and a shared global resource budget. It does not adopt a
fixed maximum number of pinned pages, a free-form layout, or stripping query
state from existing hashes. The current normative contract requires old route
compatibility and retained query/tag semantics. No claim is made that a
referenced Bilibili video was viewed or that its code or assets were adopted.

## Migration and acceptance gates

The current registry grouping uses the existing stable page IDs and enabled
page-ID preferences; it does not migrate or reinterpret their stored meaning.
The current preference reader normalizes to IDs in the active registry, so an
unregistered/unknown stored ID is not retained in its effective enabled set.
Do not describe unknown-preference retention as implemented. Any future
preference-schema migration must explicitly review and test how unknown values
are preserved or retired, without silently enabling a contribution. Before
such a migration, capture existing IDs, routes and local preference values.
Route fallback remains visible when an old route targets a disabled
presentation, and query/tag parameters survive route normalization. Photos is
available when Exhibition alone remains enabled, and hidden only when all its
presentations are disabled.

Executable browser acceptance should demonstrate:

1. A legacy `#v=exhibition` link opens Photos + Exhibition and returns without
   a history loop; disabled/unknown routes show a same-scope fallback.
2. Search and tag/facet conditions stay active while Photos wall ↔ Exhibition
   switches; switch and return to all types/Music without a second query or
   lost conditions. Counts and empty messages explicitly refer to returned
   results.
3. Stale, ambiguous and mismatched loaded-row tuples never fill unknown size
   or authorize a read. A matching exact tuple succeeds.
4. Same-domain focus, selection, Details/Notes draft and player remain usable;
   cross-domain transitions preserve the existing draft guard and abort stale
   work.
5. Registration checks reject missing roots, chains, cycles, incompatible
   context/media class, conflicts and invalid renderer maps. Existing enabled
   page-ID settings keep their prior meaning. If a later schema migration is
   proposed, add a separate migration check for known disabled IDs and an
   explicit unknown-ID policy before claiming migration coverage.
6. Any later aggregate template uses selectors and host actions, and a
   multi-block browser pass demonstrates the shared resource budget.

Record browser evidence per route and enabled-preference case. Registry/helper
tests alone are not experience evidence. The broader aggregate-template
acceptance remains pending until that slice is separately scheduled and
implemented. No check in this document changes core phase or release status.

## Current implementation boundary

Source now groups the Photo wall and Exhibition under Photos, keeps their
existing page-ID enabled preferences independent, provides returned-result
scope counts, and has a responsive presentation chooser. Search/tag conditions
remain on the host scope. Browser acceptance for the integrated route and
retained-work journey is recorded separately in
[the local acceptance](domain-presentation-acceptance-20261009.md); this document
does not upgrade that evidence. Music currently browses artist/album facts
returned by the existing `audio.list` projection. That is not new metadata
extraction or durable album membership.

Fixed-template aggregate pages/blocks are not implemented. There is no runtime
package loading or third-party extension isolation; registrations are trusted
compiled first-party code. Curated photo albums and durable ordered music
playlists are also not implemented. Their relations, playlist occurrence
identity/order, removal and missing-member semantics, and separate frozen
export behavior remain unresolved. Any eventual durable successor still
requires its own reviewed migration and recovery contract behind the
applicable Phase 4/5 gates. This proposal awards no phase or release credit.

The currently implemented page preferences continue using stable enabled
page IDs; a domain/presentation preference-schema migration has not occurred.
The effective reader filters IDs absent from the current registry. How a
future schema migration should preserve or explicitly retire such unknown
values remains to be reviewed. Fixed-template selectors/counts and the first
template's block set also remain open design work.

## Open design questions

The preference migration for any future domain-level toggle remains
unresolved. The aggregate-template selector/action contract, global budget
integration and first template's block set need a separate implementation
slice and browser gate. Durable photo albums and ordered music playlists need
separately reviewed relationship, occurrence/order, removal, missing-member,
frozen-export and recovery semantics.
