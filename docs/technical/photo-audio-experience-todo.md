# Photo and Audio Page Experience Todo

> Status updated 2026-10-09 after admission of the parallel local client
> cohort. This informative ledger follows [RW-PERSONAL-UX-1](../requirements/first-party-client-experiences.md)
> and [ADR-025](build-stack-and-architecture-selection.md#adr-025-admit-dedicated-personal-client-workflows-without-a-new-media-service).
> The proposal recorded in the historical section was written earlier on
> 2026-10-09; the accepted profile supersedes its “not admitted” and browse-only statements.
> It does not change core-phase or release qualification.
>
> **Active triple:** parallel client cohort UX-P1/M1/R1; normative contract:
> first-party client experiences; exit: documentation reports only the locally
> exercised behavior and keeps full Photos/Music and release status open.
> The primary agent owns integration and real-browser acceptance.

## Current scope and evidence — 2026-10-09

Photos now has an image-first wall over shared loaded subjects, adjustable
responsive density, loaded-format filters, retained selection indices, shared
Details/tags, bounded thumbnails and continuous inspection through the existing
inspector. Automatic thumbnail reads remain at 1 MiB and selected-image
inspection at 8 MiB. A generated 900×600 PNG decoded on the final canvas;
the browser exercised density 3→5, PNG filtering, ArrowRight to the next image,
and Escape with focus returned to the opening item. At 390×844 the Photos
document client/scroll widths were both 375 px. Details and the shared original
action were reachable, but the `_blank` download produced no browser download
event within 15 seconds, so original takeout is not accepted. Real photo
corpora, ordinary photos above 1 MiB, a large library, date/EXIF navigation,
Notes and a complete original-takeout journey remain unverified. No photo facts
or albums are inferred or persisted.

Music now has a track-oriented page and explicit bounded original playback.
Audio reads require canonical loaded SHA-256 identity, a known supported size
within 32 MiB, full-length and digest verification before native decode, with
cancellation and one active Blob. The browser exercised one retained 20-second
WAV through play/pause/seek/volume; seeking to 19.9 seconds ended the track and
advanced to the next queued item. The active queue item cannot be removed.
The same Blob, progress and duration remained through Showcase→Workspace→Showcase
and Photos navigation. At 390 px all playback controls worked and the queue fit
the 375 px document width. Stop plus clear removed the media source and hid the
idle player. Reorder, shuffle, repeat, real retained-song metadata, other
formats, and original takeout remain unverified or absent.

Named retrieval is reachable without selecting a file or opening Export. A
quiet saved query with `suffix:wav` retained workspace scope; refresh recalled
two lexical matches, while unsupported `type:audio` conditions were refused.
The browser then confirmed entry C with bytes identical to A (0 B new and
625 KiB reused), and saved-query recall returned three matches. The recalled UI
showed its stored `format=wav` condition but blocked resaving it because the
editor cannot represent that field. Separate-browser-context and full
failure-matrix cases remain unverified.

Build, i18n and audio-helper canonical identity/hash/size/cancellation checks
passed for the integrated cohort. The purego Go suite passed 27 packages; the
backend remained on the existing build-v5 and was not modified for this client
slice. These checks and the limited local browser journey grant no core phase
or release credit. See the [2026-10-09 personal experiences acceptance
record](personal-experiences-acceptance-20261009.md).

Keep one host-owned catalog/repository, exact identity as full-stream
SHA-256 plus logical length, `STORE_EXACT`, the shared tags and single Notes
surface. Browser preview, controls and the queue are transient presentation;
none establishes identity, protection, or deletion authority. No new endpoint,
processor, media database, album/playlist persistence, or index dimension is
admitted here.

## Current task state

### Photos

- [x] **P0 Admission:** the bounded wall/viewer contract is admitted by the first-party client profile.
- [x] **P1 Page:** a dedicated image-first wall and continuous-view entry are implemented over shared subjects; shared selection, Details and tags remain connected.
- [~] **P2 Wall/context:** responsive density and loaded-format filters preserve original result indices; browser exercised density 3→5 and PNG filter. Capture dates, EXIF, source-date context and date filters remain unimplemented.
- [~] **P3 Inspection:** current-result next/previous, fit/actual-size, Escape/return focus and preview fallback are implemented. Final-canvas browser evidence covers a generated 900×600 PNG, ArrowRight navigation and Escape focus return; the full keyboard/touch/failure matrix remains open.
- [~] **P4 Coverage:** the 1 MiB thumbnail and 8 MiB inspector budgets and unsupported/oversized fallback are retained. Ordinary large-photo coverage above 1 MiB has not been exercised.
- [~] **P5 Journey:** wall -> continuous view -> return is demonstrated with a generated PNG; the 390×844 document width is 375/375 and Details is reachable. The `_blank` original-download action produced no browser download event within 15 seconds, so takeout is not accepted. Real photos, Notes/tags, and larger/unsupported samples remain incomplete.

### Music

- [x] **M0 Admission:** bounded downloaded-original playback is admitted; no streaming, server media service or universal-format claim.
- [x] **M1 Page:** dedicated track rows show available filename/format/size and shared tags/Details; absent artist/album/artwork facts remain unknown.
- [ ] **M2 Metadata:** no metadata/artwork processor or enrichment is implemented.
- [x] **M3 Playback:** one 20-second WAV was decoded after full-length/SHA-256 verification; play/pause/seek/volume and visible controls during Photos navigation were exercised.
- [~] **M4 Lifecycle:** helper checks cover canonical identity, length/hash, size ceiling and cancellation. Browser exercised stop/remove/clear, disabled removal for the active item, and same-Blob retention through Photos plus Showcase→Workspace→Showcase. Unsupported decoder errors remain unverified.
- [~] **M5 Journey:** the tested WAV journey covers verified decode, controls, Photos navigation and 390 px controls/queue fit. Original takeout was not observed; real songs/metadata and Notes/tags remain unverified.
- [~] **MF2 Transient queue:** add/remove/clear, previous/next and end-to-next work in the tested session; active-item removal is disabled. Reorder, shuffle, repeat and album continuation are missing; no durable queue or playlist is claimed.

## Historical proposal — 2026-10-09, superseded by admission

The initial version of this checklist treated photo navigation and audio
playback as proposals pending an admission decision during named retrieval.
It also described Photos and Audio as suffix-classified generic library lenses.
That description records the pre-cohort state only. Current normative scope and
implementation status are listed above; the old proposal did not authorize
schema, processors, albums, playlists, or changes to recovery semantics.

## Shared acceptance and exclusions

For full-domain acceptance, add curated photo albums and supported metadata
organization; Music adds artist/album/track navigation, an editable continuous
listening queue and reusable ordered playlists. The [active product todo](product-experience-todo.md)
records those follow-up contracts and journeys. They are target requirements,
not authorized schemas or implemented features. The exclusions below constrain
this early slice; advanced capabilities remain recorded in the platform map.

Both pages must keep lexical/structured/semantic search, multi-tags, the one
Notes surface, selection, protection/recovery status, and original takeout
connected to the same subjects. A media layout changes presentation only.
Empty and filtered-empty states explain suffix-based membership honestly;
loading, unavailable, and corrupt states remain distinct. Unknown values stay
unknown. No fake result counts, cover art, durations, playback affordances, or
success badges. Do not require users to know internal IDs.

Acceptance is local to the admitted journey: focused browser interaction,
responsive behavior, keyboard/focus retention, failure/cancellation, and exact
original identity where takeout is exercised. Continue the repository's
separate release gates on their own schedule; they are not prerequisites for
this local experience decision and receive no credit from it.

Explicitly outside this checklist: album/playlist/queue persistence, automatic
grouping, unadmitted thumbnail storage or generation, EXIF extraction, audio
transcoding, acoustic fingerprints, new media embeddings, hidden background playback, remote
streaming, external reacquisition, a general media-reader framework, and
runtime-installed plugins. Reconsider each only from a concrete task and a
reviewed contract. Durable file sets remain the gated Phase 6 LinkGroup, not
an album-shaped shortcut.
