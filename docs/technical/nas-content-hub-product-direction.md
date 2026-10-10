# NAS Content-Hub Product Direction

> Status: informative product direction, recorded 2026-10-06. The operator
> selected NAS and home-storage hobbyists as the first audience. This note
> clarifies public positioning and future presentation; it does not add
> normative requirements, change the core execution order, close a gate, or
> authorize an implementation slice.
>
> Authority remains with the [MVP and Operator Contract](../requirements/mvp-and-operator-contract.md),
> [Product Requirements](../requirements/product-requirements.md),
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md),
> and [Core MVP Execution Plan](core-mvp-execution-plan.md), in that order.

## Position

**Public descriptor:** A self-hosted home for your personal content.

**Chinese slogan:** 存进自己的空间，找得到、用得上、带得走。

**First audience:** NAS and home-storage hobbyists who want personal files to
remain in their own storage and be easier to find, use, export, and recover.
This is an operator-selected direction, not a claim that market demand or
adoption has been validated.

**Current use scope:** one person self-hosts the application for their own
content. Family accounts, remote-user authentication, and multitenancy are
outside this initial direction. The [single-operator experience-pack and theme
design](single-operator-experience-pack-design.md) defines proposed contribution
boundaries and conflict handling; it does not activate a plugin runtime or
change the implementation order.

RestoreWeave remains the working name, executable identity, and configuration
identity. The name carries a recovery-first implication, while the public
product story should begin with keeping and using personal content. “Weave” is
also used by an [App Store application](https://apps.apple.com/us/app/weave-save-search-videos/id6801379247).
This is a naming observation only; no trademark search or clearance is claimed.

The product direction brings photos, audio, video, documents, and other
readable files into one content library. Content shares identity, search, tags,
one Notes surface, access, export, and recovery. Specialized galleries and
local audio/video playback are future ways to use the same content, not separate
stores or authorities. Unknown readable formats can be retained exactly within
the declared capture scope even when no preview or player supports them.

## What the current preview does

The current browser preview offers a shared library, search, tags, Notes,
scoped previews for supported content, original-file download, export, and
recovery workflows within the stated development scope. Photo and audio
controls are type filters when the library has content. There are no production
audio/video playback, real albums, or playlists. The empty initial library has
no photo/audio filter controls, which makes those views undiscoverable until
content is present. That is a current usability defect, not a product boundary.

The separate [NAS content-hub prototype](../prototypes/nas-content-hub/index.html)
is a self-contained, offline-capable interactive design prototype with
authored demo assets; its [README](../prototypes/nas-content-hub/README.md)
explains how to run it. It is deliberately separate from the production WebUI
and daemon: it has no production backend or content-library integration, and
its demo behavior is not product functionality, representative corpus evidence,
or qualification evidence.

## Product sequence

| Stage | User-facing direction | Boundary |
| --- | --- | --- |
| **Now** | Add files or a server folder, review and confirm protection, find content, maintain tags and Notes, preview supported files, download originals, export, and restore. | One library and one content authority. Current Photos/Audio are filters only. |
| **Next, after contract review and gates** | A browsable photo gallery and native local audio/video playback for declared formats, including play, pause, seek, and cancellation. | Continue using shared identity and authorized content access. No arbitrary format promise. |
| **Later** | Minimal LinkGroup and saved-view workflows for cross-media organization; materialized exports as an initial bridge to professional applications. | LinkGroup remains Phase 6 work, blocked until Phase 4 and Phase 5 close. |
| **Deferred** | Face recognition, geocoding, transcoding, fetched music/video metadata, multi-account/cloud sync, external-stream caching, and TV-style catalogs. | Revisit only with a concrete validated workflow and a reviewed contract. |

A gallery may show captured-time facts and should identify fallback values
rather than presenting filesystem modification time as capture time. This is a
product criterion only; it does not authorize new durable facts or schema.

### Minimum playback contract before implementation

A future player must reuse the existing scoped content-access authority and bind
every read to an authorized subject and immutable version. Its reviewed contract
must define bounded streaming and seek/range behavior, cancellation and handle
cleanup, integrity-failure behavior, safe media types, and supported browser /
format tuples. The browser must not receive arbitrary host paths or a bearer
token in a URL. Acceptance must use real samples for each declared format and
exercise play, pause, seek, cancellation, authorization failure, and integrity
failure. These criteria do not define an API or change the current phase lock.

External professional applications may initially consume explicit,
materialized exports. External streams, automatic fetching, caching, or
re-hosting are not implied by “use it.”

## Qualitative evidence and limits

The following public evidence informs workflow analogies and individual needs.
It is deliberately small and qualitative: no interviews, usage telemetry,
retention, payment-intent, market-size, or adoption measurements were collected.
It does not establish that one combined product is preferred or that RestoreWeave
has a unique position. Descriptions below paraphrase the cited material; they
are observations about those sources, not population-level claims.

| Evidence | Observed material | Relation to direction | What it does not establish |
| --- | --- | --- | --- |
| [Immich search documentation](https://docs.immich.app/features/searching/) | Search supports dates, tags, locations, filters, and contextual queries. | Analogy: familiar facets can help find personal media. | Does not support adopting CLIP as a default, merging products, or demand for RestoreWeave. |
| [Eagle organization documentation](https://en.eagle.cool/support/desktop/organize) | Tags and smart folders organize a personal asset library. | Analogy: shared user labels and saved criteria are understandable. | Does not validate NAS workflows or a specific implementation. |
| [Navidrome overview](https://navidrome.org/docs/overview/) | A self-hosted music server browses and plays music using curated metadata and queues. | Analogy and boundary: useful music browsing can depend on metadata work. | Does not establish that RestoreWeave should become a music server or require curated metadata. |
| [Jellyfin transcoding documentation](https://jellyfin.org/docs/general/post-install/transcoding/) | Playback may direct-play, remux, or transcode according to client and available resources. | Boundary: playback compatibility is a declared client/resource problem. | Does not justify promising arbitrary playback or adding transcoding now. |
| [V2EX NAS search discussion](https://www.v2ex.com/t/1153487) | One operator described building a global NAS search tool and using it over time. | Direct individual need: cross-folder discovery can motivate a personal workaround. | A single workaround is not scale, adoption, or willingness-to-pay evidence. |
| [V2EX photos, files, and backup discussion](https://www.v2ex.com/t/1030250) and [original-retention concern](https://v2ex.com/t/1055548) | Posters expressed interest in photo/file workflows alongside backup and concern about losing originals. | Direct individual needs: combine discovery with confidence in retained originals. | The first page of the former source is incomplete; no later unseen reply is used. These posts do not validate a market segment. |
| [V2EX app-preference discussion](https://v2ex.com/t/1229914) | One poster preferred separate storage/photo tools, moved audio to Plexamp, and objected to unused modules. | Counterexample: some users value focused applications over one all-in-one interface. | One preference does not disprove the selected audience or justify bundling every feature. |
| [V2EX music workflow discussion](https://v2ex.com/t/1061741) and [Navidrome folder/tag discussion](https://github.com/navidrome/navidrome/discussions/5781) | Individual users described manual WAV curation, Navidrome/Jellyfin use, or a fork adding folder browsing and tags. | Direct individual workflows: media discovery can involve user-maintained facts and browse preferences. | These anecdotes do not establish prevalence or a universal metadata burden. |
| [Immich chronology discussion](https://github.com/immich-app/immich/discussions/8377) | Historical comments report chronology expectations, search frustration, and a search-to-album-to-date workaround. | Boundary: photo discovery and ordering expectations can affect usability. | These 2026 comments are historical reports, not evidence about current Immich behavior or all users. |

Research used public official documentation, original public discussions, and
V2EX posts. This bounded scan did not include interviews or private groups.
The selected audience and proposition are therefore a product decision; demand
remains unverified.

## Phase and authority boundary

This is Phase 3 browser product planning against the content-store contract's
shared content model and user loop (§2 and §13). It is subordinate to the
normative documents above and does not reorder or unlock implementation phases.
The existing core plan explicitly defers players/readers and domain-specific
UI. Phase 4 and Phase 5 remain prerequisite gates for Phase 6 LinkGroup work.
Any playback implementation requires a later bounded adapter contract and the
applicable release qualification; this note supplies planning criteria only.

[ADR-018](build-stack-and-architecture-selection.md#adr-018-nas-first-content-hub-positioning-and-deferred-media-views)
records the positioning decision. [ADR-012](build-stack-and-architecture-selection.md#adr-012-external-media-is-a-convenience-reference-and-never-enters-the-recovery-closure)
remains in the history as accepted when written; its player and external-media
integration direction is deferred under ADR-017 and ADR-018. The README and
prototype asset folder are descriptive, not sources of normative scope.
