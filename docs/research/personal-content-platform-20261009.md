# Personal Content Platform: Domain Experience Research and Product Target

> Status: informative research and product-target proposal, 2026-10-09.
> This document defines the intended platform breadth, not shipped capability.
> It does not revise RW-MVP-1, admit media APIs or schemas, change phase gates,
> or grant release credit. The existing core requirements remain authoritative.

## Product judgment

The intended product is **a single-person, self-hosted personal-content
platform: keep readable originals in one place, discover them through familiar
clues, and use each kind of content through an appropriate, complete domain
experience**. Its first audience is NAS and home-storage enthusiasts.

The operator's repeated requests connect three jobs: keep personal content in
their own space; find it without remembering storage paths; and enjoy or reuse
it in the way they already expect. Viewing photos and listening to music are
part of the third job. An original-download action alone does not meet that
entire product promise. Exact preservation and recovery remain the platform's
trust foundation; deduplication and compression supply supporting value.

The previous photo-wall/single-track plan describes early implementation
slices. It is too narrow as a final definition of Photos or Music. Complete
baseline workflows include curated photo albums and music artist/album
navigation, continuous listening, an editable queue, and reusable playlists.
They belong in the product target even while their contracts and implementation
remain outstanding. Advanced capabilities are recorded rather than silently
dropped, with an explicit reason for their position in the roadmap.

“Anything” has two separate meanings. Readable files in the declared capture
scope can be preserved exactly, including unknown formats. Rich viewing,
listening, extraction, or editing is format- and capability-dependent. Neither
meaning promises arbitrary application-state capture, automatic URL downloads,
or universal browser decoding.

## Evidence and limits

Luna researched official Immich, PhotoPrism, Synology Photos, Navidrome,
Jellyfin, and Plex/Plexamp material; the primary agent reviewed the synthesis
and directly opened decisive documentation. Product documentation supports
documented features, not actual usability, demand, adoption, or performance in
the operator's library. No competitor UI was exercised in this research.

The strongest retained comparisons are:

| Product/source | Documented mechanism | Effect on this product target |
| --- | --- | --- |
| [PhotoPrism Albums](https://docs.photoprism.app/user-guide/organize/albums/) | Create/edit albums, add/remove selections, choose an album cover | A reusable human-curated photo destination is part of the intended ordinary experience |
| [Immich Search](https://docs.immich.app/features/searching/) | Metadata filters, contextual image search, OCR, people/location/camera/time clues | Preserve a broad discovery roadmap; image/context search requires separate processing rather than a text-embedding promise |
| [Immich Mobile Backup](https://docs.immich.app/features/mobile-backup/) | Selected-device-album uploads, one-way album mirroring, foreground/background behavior with OS restrictions | Phone intake is an eventual workflow; a responsive page alone is not background camera backup |
| [Navidrome Overview](https://navidrome.org/docs/overview/) | Metadata-driven browsing, compilations/discs, playlists, queue API, favorites, lyrics and client compatibility | A usable music experience needs domain navigation and a listening session, not only a play button |
| [Jellyfin Music](https://jellyfin.org/docs/general/server/media/music/) | Embedded metadata, album/disc organization, local/embedded artwork, timed/plain lyrics, format caveats | Metadata, ordering, artwork and decoding fallback require explicit design |

Synology and several Plex/Plexamp pages were available only as official search
excerpts, or their full open failed. Their detailed feature/entitlement claims
remain preliminary and are not prerequisites or decisive scope evidence here.
The [source ledger](personal-content-platform-sources-20261009.json) retains
retrieval states and unsupported inferences. The raw research and Opus
consultation evidence are retained in the local ignored
`dist/product-platform-20261009/` directory; they are not release artifacts.

## A daily platform story

An operator saves a folder containing holiday photos, music, a PDF itinerary,
and written notes. The same protected originals appear in All Content. Photos
offers a chronological wall, an album, and continuous viewing; Music offers
the relevant artist/album/track relationships and a listening queue. A shared
trip tag and one search reconnect these items without importing copies into
independent catalogs. The operator can export the chosen originals with useful
names, inspect protection status, and restore them when necessary.

That is a concrete differentiation hypothesis against running disconnected
applications. It must be demonstrated end to end. A unified sidebar or common
color palette alone does not demonstrate it; equally, the platform must offer
a worthwhile domain experience before asking someone to replace a specialist
application. Retaining specialist external clients is a legitimate option for
later integrations, with declared compatibility and authentication boundaries.

## What is shared, and what is domain-specific

| Layer | Responsibilities | Boundary |
| --- | --- | --- |
| Content and trust kernel | Original identity/bytes, protection, facts and provenance, access policy, publication, exact export and recovery | One configured repository and SQLite; no domain or theme may redefine identity, delete authority, or recovery meaning |
| Shared product services | Intake, jobs and visible outcomes, tags, one Notes surface, common search, subject references, selection and exact takeout | Domain modules use typed host operations; no independent catalog/policy/job/recovery state machine |
| Domain modules | Photo timeline/viewer/albums; music artists/albums/tracks/queues/playlists; later video and document experiences | Different interaction and data semantics are allowed only through reviewed contracts over shared subjects |
| Processors | Thumbnail/rendition generation, EXIF/audio facts, local artwork/lyrics, later OCR/image or acoustic analysis | Bounded, attributable, versioned, with explicit failure and rebuild behavior; never exact identity or save prerequisites |
| Interface experiences | Shell, navigation arrangement, density, presentation and interaction placement | Whole-interface choice keeps logical action meanings, access policy, user work, and active-player controls coherent |
| External clients/integrations | Optional protocol clients, device applications, import/export interoperability | Explicit support matrix, egress/authentication and original/derived-copy semantics; compatibility is not first-party completion |

Sharing one foundation does not mean forcing all content into the same result
row. Photo time, curated album membership, music release identity, track order,
and listening state are different concepts. Generic source folders remain
provenance and a secondary browse projection.

## Complete baseline feature map

All entries below are **product targets**, not current implementation claims.
“Baseline” means the declared domain can support an ordinary daily workflow;
an implementation slice may deliver only part of it and must retain that label.

### Shared platform

- **U-01 Intake:** drag/upload readable files and explicitly selected server
  sources, progress, failure/retry visibility and clear preservation outcomes.
- **U-02 One library:** mixed content, type/format facets, real preview/fallback,
  direct domain destinations, selection and usable empty states.
- **U-03 Discovery:** common name/text/fact/tag/Notes search and useful saved
  retrieval, with honest supported conditions and index availability.
- **U-04 Organization:** shared tags/Notes and reviewed reusable content sets;
  references across domains without byte duplication or source renaming.
- **U-05 Original takeout:** single-item and batch outputs, useful names,
  unavailable-member reporting, frozen identity and verifiable completion.
- **U-06 Trust:** visible protection/provenance, inspection and restoration;
  ordinary use without internal IDs or a mandatory technical dashboard.
- **U-07 Presentation:** consistent keyboard/mobile operation and replaceable
  complete interface composition; curated palettes remain secondary.
- **U-08 Personal deployment:** understandable local/self-hosted setup and
  operator access policy; single-person use does not mean unauthenticated
  exposure. Remote access requires its own admitted security profile.

### Photos

- **P-01 Photo library:** image-first mosaic/timeline, date grouping, density,
  jump/navigation and the source of each displayed date.
- **P-02 Useful renditions:** bounded thumbnails for ordinary large camera
  images, orientation handling, explicit supported formats and failure states.
- **P-03 Continuous viewer:** fit/zoom/full screen, next/previous in the current
  sequence, keyboard/touch operation and return to the same browse position.
- **P-04 Photo facts:** actual capture/date/camera/location fields where
  available, provenance, unknown states and source-path access.
- **P-05 Curated albums:** create/rename, add/remove selections, choose cover,
  browse the album and export; membership removal never removes original bytes.
- **P-06 Personal organization:** favorites, shared user tags/Notes and batch
  operations under reviewed durable semantics.
- **P-07 Retrieval:** supported date/type/name/tag/fact filters; search results
  retain the same viewer and organization actions.
- **P-08 Taking photos out:** original/selected-album output with honest state;
  a rendered preview must not be presented as the protected original.
- **P-09 Phone use:** comfortable mobile browse, viewing and explicit upload.
  Background camera backup is a separate delivery milestone below.

### Music

- **M-01 Music library:** tracks with title, credited artists, album/album
  artist, track/disc number and known duration/format; truthful name fallback.
- **M-02 Album/artist navigation:** recognizable cover grids and detail pages,
  ordered album tracks, compilations and multi-disc handling within support.
- **M-03 Music discovery:** artist/album/track results and supported genre/year
  filters connected to the same protected content and shared search.
- **M-04 Visible player:** now-playing identity, play/pause, seek, volume,
  previous/next, accessible errors and controls during library navigation.
- **M-05 Listening queue:** play now/next/append, inspect/reorder/remove,
  album continuation, shuffle/repeat and explicit replacement semantics.
- **M-06 Playlists:** create/rename/edit a reusable ordered sequence, with
  repeated occurrences and missing-item behavior explicitly decided.
- **M-07 Personal use:** favorites and retained listening position/session
  where admitted; shared tags/Notes and original takeout remain accessible.
- **M-08 Local metadata/artwork:** use actual embedded or admitted sidecar
  material; inspect uncertain grouping and offer correction without silently
  rewriting protected originals. Network enrichment is optional.
- **M-09 Lyrics:** use available local/embedded text, plain/timed presentation
  according to supported formats. Missing lyrics do not block listening.
- **M-10 Phone listening:** usable controls and uninterrupted controlled
  navigation; offline copies and cross-device synchronization are later
  delivery milestones with their own persistence/access contracts.

One supported track playing is an early M-04 slice. It does not complete Music.
Likewise, a mosaic alone does not complete Photos. Both require real metadata,
organization, navigation, failures, and original access across their declared
support scope.

## Recorded advanced and later capabilities

The following remain visible in the final roadmap. Their position reflects
dependencies and relevance, not a claim that the operator does not want them.

| Capability | Domain | Planned disposition and reason |
| --- | --- | --- |
| Background phone backup, resume and selected-album import | Photos/intake | Later complete mobile workflow; requires device permissions, OS scheduling, transport and verified arrival |
| People/face recognition, correction/merge/hide | Photos | Optional derived module; separate model/profile, correction, privacy and resource contract |
| OCR and contextual image search | Photos/discovery | Optional processor/index dimension; text BGE cannot stand in for image analysis |
| Calendar/map/places navigation | Photos | Later metadata-backed routes; unknown GPS/dates and optional egress must remain clear |
| RAW/HEIC/Live Photo/bursts/stacks/sidecars | Photos | Explicit compatibility milestones, preserving compound relationships and originals |
| Rotation/crop and other non-destructive adjustments | Photos | Later edit-recipe/rendition contract; protected originals remain unchanged and user edits are retained |
| Archive/hidden views and similarity review | Photos | Later organization/privacy and review semantics; hiding or similarity never authorizes original deletion |
| Slideshow/TV/casting | Photos/music | Later first-party or external-client integration, based on an actual device journey |
| Offline listening and cross-device continuation | Music | Later complete device workflow with copy, session-conflict and authentication semantics |
| Gapless playback, loudness handling and equalizer | Music | Later listening-depth milestones; state exact supported decoder/client behavior |
| Smart playlists, recent listening and discovery mixes | Music | Later rules/history semantics; domain state must be recoverable if durable |
| Sonic similarity/radio/recommendations | Music | Optional acoustic processing module; distinct from exact identity and current text index |
| External artwork/metadata/lyrics and scrobbling | Music | Explicit optional integrations with egress, correction and unavailable states |
| Secure selected sharing | Shared | Later access-policy profile with expiry/revocation; not a reason to introduce tenancy now |
| Video and document applications | Shared/platform | Subsequent domain milestones; define continuous viewing/resume/subtitles and reading/search separately |
| Runtime-installed extensions | Platform | After bundled modules prove stable capabilities, contracts and conflict handling |

Multi-tenant administration, room synchronization, gateways/mounts, automatic
external acquisition/source deletion and neural codecs remain outside the
immediate product roadmap. They require a new concrete user job before adding
another product commitment.

## Feature selection and simple presentation

For each borrowed capability, decide whether it closes an ordinary job, improves
an already complete job, belongs to a specialist external client, or introduces
an unrelated product. Preserve the operator's wanted capabilities in this map;
do not equate implementation cost with lack of value. Record the reason and
reconsideration condition for a deferred item.

The home should expose recognizable content, Add, Search, recent/resumable
work, and direct Photos/Music entrances. Photos owns its timeline/albums/viewer;
Music owns albums/artists/tracks/playlists/player. A shared search can span
domains and return into the appropriate experience. Sources, duplicates,
integrity operations and configuration belong in management, reachable when
needed. Deep tools use contextual controls; unimplemented capabilities do not
occupy the ordinary navigation as pretend working pages.

Daily simplification happens through defaults and progressive disclosure,
without removing essential domain paths. Module enablement and full interface
choices can reduce visible complexity later. Themes cannot disable access
policy or leave playback running without reachable controls.

## Delivery waves and contract reconciliation

| Wave | Visible result | Completion boundary |
| --- | --- | --- |
| Shared daily loop | Save, find again and take out real mixed content comfortably | Daily named retrieval and batch original takeout under admitted contracts; existing trust invariants remain |
| Complete Photos baseline | A personally useful photo destination | P-01 through P-09 across declared formats; a wall/viewer slice remains partial until album/organization paths work |
| Complete Music baseline | A personally useful listening destination | M-01 through M-10 across declared support; artist/album navigation, queue and playlists count as essential completion work |
| Deeper personal workflows | Phone intake, device listening, photo discovery and other domains | Each delivered as its own complete supported journey, with optional dependencies explicit |
| Stable extension ecosystem | Bundled capabilities become replaceable safely | Reviewed contracts, compatibility and conflict behavior before runtime installation |

This target is broader than the current “content/discovery/export/recovery
plane” implementation lock. The next contract work must explicitly reconcile
Product Requirements, the MVP/operator profile, content-store boundaries,
API/content-read rules, driver/processor interfaces, the execution plan and
AGENTS guardrails. Define first-party experience admission separately from
storage/recovery release qualification; retain dependency gates where data
meaning or safety requires them. No informative document silently unlocks a
player, richer collection, new index or schema.

The kernel retains exact identity, protection defaults, one authoritative
catalog/repository, provenance, authenticated recovery and visible failures.
Domain durable facts, curated album semantics, playlist ordering and progress
must have their own reviewed persistence/recovery/migration treatment in that
same authority. Derived album recognition must not be confused with human
curation or content identity. A minimal path-keyed LinkGroup, dynamic SavedView,
temporary queue, ordered playlist and frozen ExportManifest have distinct jobs.

Primary-agent decisions and review accompany bounded Luna implementation.
Local task evidence follows the delivered feature. Unrelated platform/package
experiments and counts of foundation tests do not substitute for demonstrated
domain usability, nor does a successful local demo claim release qualification.

## Opus consultation

The operator explicitly requested detailed discussion with the configured
Claude Opus 5.5 route through DeepSeek Harness CLI. Two successful discussion
turns used `openainext / claude-opus-5-5`, with exit code zero, final responses
and no tool events. A temporary private route overlay was removed afterward;
global Harness settings and product source code were not changed. The second
turn supplied the official research and challenged the first answer's overly
broad collection, metadata and format assumptions. The local record is
`dist/product-platform-20261009/consultation-record.json`.

| Discussion result | Primary-agent disposition |
| --- | --- |
| Unified ownership plus complete domain use captures the operator's goal | Adopt as the product target and ADR-024 |
| Albums, artist/album navigation, queue and playlists are baseline targets | Adopt; distinguish first complete domain release from earlier implementation slices |
| A generic ordered Collection should own all grouping | Reject; Opus accepted the correction. Share host subject/file-version references and reviewed resolution interfaces while preserving each domain's semantics |
| Every extracted fact or organization record can be rebuilt and discarded | Reject; Opus accepted the correction. Human intent and admitted durable facts need persistence/recovery; disposable indexes and renditions do not replace them |
| Existing SavedView immediately supplies smart albums/playlists | Reject; Opus accepted the correction. Query fields, ordering and domain semantics need separate admission |
| Common formats, HEIC/RAW/video/transcoding can be promised universally | Reject. Publish a verified support matrix; preserve readable exact originals even when processing is unavailable |
| Shared integration can wait until after isolated domain applications | Do not adopt that delivery separation. Each domain is built on shared search/tags/Notes/original output from its first useful release |
| Existing media exclusions conflict with the full target | Adopt as a scope-reconciliation task, not as permission to silently change normative scope |

The final model response withdrew unsupported item-count, schedule and library
size thresholds. Its remaining general claims about NAS users and predicted
specialist-app comparisons are not treated as observed demand. No generic
model statement defines a browser support matrix or proves a mobile-platform
capability. The primary agent owns the decisions above.

## Result of this research slice

Recorded: full product target, baseline and advanced capability map,
source-specific evidence limits, delivery waves, ADR-024, and expanded
Photo/Music todo completion boundaries. Not implemented: new media viewers,
players, albums, playlists, processors or interfaces. No phase status or
release qualification was changed. Research exit checks validate the local
document links, source-ledger JSON and consultation final/exit/tool-event
records; they are documentation checks, not feature acceptance tests.
