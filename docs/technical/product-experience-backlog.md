# Product Experience Backlog

> Status: informative planning record (documentation authority rank 7). It
> records operator-requested product work with its constraint status; it adds
> no MVP scope, closes no phase gate, and cannot reorder the core plan. Each
> item names its current constraint under the existing locks
> (`docs/requirements/*` and `docs/technical/core-mvp-execution-plan.md`).

Created 2026-09-18 from the operator's product review. Items move out of this
document when they enter an implementation slice; entry requires the usual
phase/requirement/exit-test triple.

Current experience priority is the
[Content-First Product Decision](content-first-product-decision.md), recorded
2026-10-05, with its current decision map and ordered next work. Shared
intake, familiar-clue retrieval, and original export lead. The two bundled
interface experiences are current bounded client maintenance; curated palettes
remain secondary. Gallery comes before music after reviewed contracts and
applicable core gates. This ordering preserves normative MVP scope, default
real BGE semantic search, phase gates, and historical ADRs (including ADR-015,
whose together-mode capability is currently deferred). Current interface
evidence and limits are in the [acceptance record](client-interface-experiences-acceptance-20261006.md).
The 2026-10-05 bounded browser polish slice is implemented and tested for its
listed UI details and synthetic mixed-content viewports. Its exact commands,
reviewed screenshots, fixture limitations, and evidence boundary are in the
[decision brief](content-first-product-decision.md#bounded-browser-maintenance-evidence).
This does not validate demand or appeal, opaque-format parsing/playback, or any
normative phase/release gate. Earlier browser evidence remains scoped to its
own stated slice.

## In flight this cycle

| Item | Shape | Constraint status |
| --- | --- | --- |
| Similar candidates (not identity) | Optional bounded scan computes a 64-bit perceptual hash per image; candidate groups by Hamming distance; audio groups by declared artist/title + duration ≤ 2 s. Every payload restates: similarity never establishes identity and never authorizes deletion. | Phase 4; content-store duplicate contract. Daemon implemented and tested; browser surface this cycle. |
| Query by image (以图搜图) | `search.query` gains an image subject-ref query input; the stored multimodal generation is scored with a vision-tower query vector; filter-only and text-only behavior unchanged; input errors never revoke a generation. | Phase 4; no new dimension (the multimodal dimension already serves this space). |
| On-demand AI notes (`description.generate`) | OpenAI-compatible describe profile; runs only through the egress gate with a live grant and per-request confirmation; admits an immutable `AI_SUMMARY`/`AI_ANALYSIS` revision at `accepted=false`; honest `DESCRIPTION_PROVIDER_UNAVAILABLE`. | Phase 4; `content-store-views-and-exports.md` §DESCRIBE_SUBJECT; egress contract per `driver-and-processor-interfaces.md` §12. |

## Accepted, queued (operator-approved)

1. **Upload / add-file channel.** Implemented and tested for the existing
   bounded loopback adapter on 2026-10-05: file selection and library drop,
   unprotected staging, identity review, and explicit exact-save confirmation.
   Server-folder intake remains available. See [core preview evidence](core-preview-acceptance-20261005.md).
   The following historical proposal is retained for context; it does not
   override the current normative API limits or award release qualification:

   - **Endpoint.** One bounded `POST /api/v1/upload` on the existing loopback
     adapter, same token as every other call. It is file reception only: it
     adds no policy, job, catalog, or recovery state machine.
   - **Landing.** Files land in a daemon-managed staging directory under the
     data root (`<data>/inbox/<date>-<random>/<safe-name>`), never inside a
     configured source tree and never directly into the repository.
   - **Bounds.** No product-owned quota and no default size limit (ADR-013).
     One optional limit exists, unset by default, for an operator who wants
     one.
   - **Safety.** Names are sanitized to a safe display name (path traversal,
     control characters, and reserved names rejected or rewritten and echoed
     back); the response carries the computed SHA-256 + length so the browser
     can show the identity before anything is ingested; nothing is parsed or
     processed at upload time.
   - **Review.** The staged directory is offered back as a `plan.ingest`
     source root; the ordinary review → digest-bound apply flow takes over.
     The upload never bypasses plan review, and an un-ingested staging
     directory is visible (and cleanable) in the sources surface.
   - **Browser.** The add-source dialog gains an "upload files" mode using a
     real file picker / drag-drop; it shows per-file identity and then offers
     the protect plan for the staged batch.
   - **Honesty.** The staged area is a plain host directory the daemon owns;
     until a plan protects it, the bytes have no protection record, and the
     UI says so in the same wording the link-only flow uses.

   Settled by ADR-013: the product owns no quota, so loopback uploads may run
   tokenless, and a token is required whenever the listener is not loopback.
   Staged bytes stay visibly unprotected until reviewed.
2. **Pinyin search — implemented and locally tested.** The existing lexical
   feed enriches CJK text with pinyin and initials from the embedded,
   digest-recorded Unihan table. The 2026-10-06 isolated real-daemon check
   finds `旅行` through `lvxing` and `lx`, and finds a middle-of-run `西湖`
   through Chinese or `xihu`. Unicode License V3 attribution is retained
   beside the table and in candidate packages. This is lexical enrichment,
   not a new index dimension or Phase 4 qualification. See the
   [continuation evidence](local-completion-acceptance-20261006.md).
3. **LinkGroup review.** The operator asked to "look at" link groups. The
   minimal LinkGroup is planned Phase 6 and stays blocked until the Phase 4
   and 5 gates close; the permitted work now is a design-review pass over
   `docs/requirements/content-store-views-and-exports.md` and the execution
   plan so the schema/operation/browser flow spec is ready — no schema or API
   implementation before the gates.

## Chinese mid-run matching — implemented (lexical profile V4)

The existing V4 feed emits adjacent CJK bigrams plus individual-character
and pinyin tokens. This addresses the earlier V3/raw `unicode61` prefix-only
limitation without adding a field or index dimension. The earlier token-shape
probes explained the choice; they are historical motivation, not the current
implementation status. Changing the lexical profile requires rebuilding its
projection, never rewriting durable Notes or content identity.

On 2026-10-06, a real isolated daemon found `西湖` and `xihu` inside
`杭州西湖的备份方案备忘`, and found the intended subject through `lvxing` and
`lx`. Real ONNX/BGE + zvec retrieval and provider-unavailable lexical fallback
were checked separately. The narrow attribution correction leaves the pinned
Unihan input and generated table body unchanged. See the
[continuation evidence](local-completion-acceptance-20261006.md).

These checks establish development-scope behavior. They do not establish
complete field/segment coverage or close the supported-host/default-profile
qualification gate.

## Reader closure: keeping an old encoding readable years later

The operator asked whether Cairn can follow F3's encoder/decoder idea so
that an encoding retired years from now can still be read. The answer is that
the shape is **already frozen** and the remaining work is narrower than it
sounds:

- An `EXACT_REVERSIBLE` representation already must carry a portable
  `RecoveryRecipe` naming the codec/profile ID, implementation digest,
  model/tokenizer/dictionary digests, coder profile, framing digest, encoded
  payload placement, decoded length, and validator profile, with the proof
  `encoded placement -> pinned decoder -> complete byte stream -> SHA-256 +
  length == source ContentIdentity`
  (`docs/requirements/content-store-views-and-exports.md:232-236`). That is the
  encoder/decoder pair, with a byte-exactness requirement F3 does not make.
- The signed portable fact closure and the recovery reference already carry
  `RequiredReaderDependencies` (`server/internal/exact/recovery_closure.go:226`,
  `recovery_reference.go:71`; populated from the repository capability profile,
  e.g. `restoreweave.repository.local-zstd-v1` plus
  `klauspost/compress/zstd@v1.18.7`), so a reader can state what it needs.
- The retirement rule is frozen: "A repository driver, decoder, model,
  tokenizer, or dictionary cannot be removed while any retained representation
  or recovery recipe depends on it"
  (`docs/requirements/driver-and-processor-interfaces.md:479`).

**Status: the three missing pieces are implemented and tested** (see the
commit that carries this note). `reader.closure` declarations now ride the
existing read-only `capability.list` as a `reader-closure` row kind — one row
per admitted dependency stating its role, retention class, ordered decoder
artifacts with digests, rebuild and verify procedure, and decoder support
window, or a typed refusal with the caller action. A frozen decoder fallback
resolver implements the order below and refuses with typed reasons that
direct the caller to the next `RecoveryReference` rather than a weaker
fidelity class. Conformance vectors are committed as golden files: 17 signed
record vectors (accept plus reject per family, including a validly signed
closure naming an unadmitted dependency) and golden payload bytes for the
identity and zstd codecs, all regenerable byte-for-byte from the production
signers.

What was missing before those landed was:

1. **Retention or reproduciblity, proven per dependency.** The requirement is
   "retained, reproducibly rebuildable from a complete retained closure, or
   both" (`docs/requirements/restore-manifest.md:1520`). Today each dependency
   is a name plus a version string; nothing records where the decoder bits
   live, how to rebuild them, or how to verify a rebuild.
2. **An explicit decoder fallback order** — native implementation with a
   matching digest, then the retained pinned decoder, then refuse and fall
   through to the next recovery reference — instead of leaving the order
   implicit.
3. **Conformance vectors** (accept and reject cases) per signed record family,
   so "any independent reader" is an executable claim rather than an
   aspiration. Both this and item 2 are already listed above as F3 takeaways.

Constraint carried forward: restorable content never executes. Whatever is
retained is an admitted, digest-recorded capability kept *outside* the payload;
F3's embedded decoder — executable code inside the data file — stays rejected.

## Browser-side quick wins (no daemon change, use existing facts)

4. **Timeline browse**: month-bucketed capture/modified-time histogram over
   the loaded listing; clicking a bucket filters. Browser-side projection,
   labelled as such.
5. **Space report**: largest subjects / largest media classes over the loaded
   listing plus the daemon's read-only capacity report. Honest about the
   loaded-page scope.
6. **Deep links**: search terms, active facets, and selected view encoded in
   the URL so a refresh or a share keeps the context.
7. **Empty-state onboarding**: a three-step guide (add source → protect →
   search) when the library is empty.
8. **PWA manifest + icons**: installable on the phone; the 390 px layout
   already exists.

## Small daemon additions (projections of existing facts)

9. **Album / artist facets**: library facets derived from the durable
   `extract.audio.tags.v1` facts (facet, not a player surface).
10. **Verification freshness**: surface the age of the last full-bytes
    verification and a gentle re-verify reminder; `UNKNOWN` stays honest.
11. **Export presets**: remember the last destination directory and sidecar
    choice per workspace as a browser-local default.

## Decisions needed before scheduling

12. **Phone camera-roll ingest**: needs the upload channel (1) first, plus a
    decision about how a phone source is represented (one staging source per
    device? provenance labels?).
13. **Compression**: stays optional and off the critical path per operator
    decision; `local-zstd-v1` remains the opt-in candidate and the neural
    codec stays disabled.

## Explicitly out (unchanged locks)

Players, readers, transcoders, mount/network filesystem services, OpenList
forks, new index dimensions, richer Collections, automatic external
acquisition, destructive GC. Also out: third-party video streaming inside the
daemon or core, scraping or re-hosting of third-party video, and any external
stream entering the recovery closure.

## Domain experience packs: photo/album and music/MV (decomposition)

Decomposed 2026-09-28 from an operator request that also asked how a deep
vertical and a wide horizontal can be the *same* product. Informative, same
rank as the rest of this file: it adds no MVP scope, authorizes no schema,
command, or API, and no item below may be reported as implemented. Every item
names its constraint.

### Already specified — cite, do not restate

- Audio, video, and image packs with their explicit defer lists:
  `RW-AUDIO-1` and §6.1 (ecosystem-and-vertical-apps.md:243-257),
  `RW-VIDEO-1` (ecosystem-and-vertical-apps.md:263), `RW-IMAGE-1` and §6.4
  (ecosystem-and-vertical-apps.md:293-299).
- The shared abstractions a new domain must reuse rather than replace:
  `SubjectRef`, `SegmentRef`, `CollectionRef`, `ArtifactRef`, plus namespaced
  domain fields such as `audio.artist` (ecosystem-and-vertical-apps.md:134-141).
- Players and readers are separate clients or bounded UI modules over typed
  catalog and access APIs; they never read repository packs, SQLite tables, or
  host paths directly (ecosystem-and-vertical-apps.md:382).
- Ecosystem build order: universal Inbox/catalog and exact file-shaped access
  first, then prove the ecosystem with **music and books**, then video, then
  application retrieval (ecosystem-and-vertical-apps.md:478).
- Audio fingerprint from `decentralized-music` or Chromaprint is optional
  near-match evidence and never exact identity
  (ecosystem-and-vertical-apps.md:254; the operator authorized reuse in
  references/decentralized-music-audit.md:174).
- beets is already recorded as an isolated music-metadata processor candidate
  under MIT (references/ecosystem-application-adapters.md:28).
- Timed text already has its carrier: the sidecar-of-media relation plus the
  validated progress envelope (client-and-facets-design.md:117). MV pairing
  should reuse this shape instead of inventing a relation kind.
- Audio tags are already extracted as `extract.audio.tags.v1` facts — a facet,
  not a player surface (this file, "Small daemon additions", item 9).

### Genuinely new, and its classification

Photo/album pack:

1. **Dense wall view (view-only).** Cursor pagination over `search.query`,
   virtualized rendering, and stable scroll restoration on return. Needs a
   thumbnail `ArtifactRef` served through content access; adds no durable fact
   and no new index dimension. Exit test: a 10k-image fixture wall scrolls
   without full materialization, and reopening a subject restores position.
2. **Timeline and map facets.** Within the `RW-IMAGE-1` scope already stated.
   Map aggregation is computed from stored coordinates; it must not become a
   new durable table.
3. **Album-fill suggestions (durable proposal, user decision).** Reuse time,
   location, and the existing similarity-candidate machinery; every suggestion
   carries its reason; only explicit confirmation writes; undo is scoped to
   the batch. Similarity never establishes identity and never authorizes
   deletion.
4. **Deletion-candidate triage.** Protected classes arrive in a separate
   bucket, unchecked, with no bulk-select and nothing pre-selected. Bounded by
   the exact-identity freeze and the content-store duplicate contract.
5. **Boundary with adjacent photo products.** An adjacent on-device photo
   product lives in another repository with its own platform photo library,
   on-device models, and database schema. It stays a separate product and may
   become a *client* of the typed API (ADR-014). Do not merge that stack or
   schema, and do not create a second durable metadata store. The image pack is
   explicitly scoped as a processor pack plus selective integration, not a
   reason to duplicate a full photo-management stack
   (ecosystem-and-vertical-apps.md:295).

Music/MV pack:

6. **Track and album browse (already scoped).** The cheapest path to a
   *beautiful* library is an existing OpenSubsonic client over the optional
   loopback facade (`restoreweaved --facade-listen`), which already carries
   artist/album/song listing and `search2`/`search3`
   (experience-completion-plan.md:30, :69) with a pinned Supersonic method
   sequence (:33). Honesty: those adapters are **maintenance-only**,
   "adapter-harness-complete; not a client product", and do not constitute
   client-experience qualification.
7. **Mood and context playback.** Mood is a user-declared durable tag plus a
   `SavedView` or query preset. A learned mood/energy classifier stays out of
   the default profile and out of the core; it would be a later index
   dimension, never an identity or deletion input.
8. **MV pairing.** Audio subject ↔ video subject is a durable relation; reuse
   the sidecar-of-media shape (client-and-facets-design.md:117). A local MV is
   an ordinary protectable, verifiable, restorable subject.
9. **External stream (e.g. Bilibili).** Convenience reference only: not
   protected, not verifiable, not restorable, and never a recovery dependency.
   It must render explicitly as external and unprotected, and it must show
   unavailable rather than substitute another source when unreachable. The only
   acceptable integration is the provider's official embed player inside an
   explicitly enabled view. No scraping, downloading, caching, or re-hosting;
   no referer or anti-leech circumvention; no credential requirement may become
   a dependency.
10. **Audio-to-video switching while listening.** A view-state transition with
    two sources — local through content access, external through the embed.
    It is never a core capability.

### The unification axis

A deep vertical and a wide horizontal are the same product because they live
in different layers of one spine:

| Layer | Contents | Change cost | Owner |
| --- | --- | --- | --- |
| Subject identity | SHA-256 digest plus logical length | Frozen | Core |
| Durable user facts | Tags, one `Notes` surface, relations, minimal link groups | Versioned, closure-bound | Core |
| Rebuildable derivatives | Thumbnails, audio tags, lyrics, waveform, fingerprints, embeddings | Disposable, generation-scoped | Processor / index contracts |
| Views | Dense wall, timeline, map, player, mood radio | Presentation only | Client / UI |
| Access, export, recovery | Unchanged | Frozen | Core |

Rule: adding a domain adds an `ArtifactRef` type and a view. It never adds a
catalog, a state machine, or a durable store. Depth is bought in the
derivative layer; breadth is bought in the view layer; neither may touch
identity or recovery meaning.

### Constraint status

Everything above sits behind the Current Implementation Lock. Core order comes
first (Phase 3 closure evidence, then the Phase 4 and Phase 5 gates), and
LinkGroup schema and API remain unauthorized until those gates close. No item
here grants scope or completion credit.

### Decisions needed from the operator — settled 2026-09-28

> Every item below was decided on 2026-09-28 and recorded as ADR-012 through
> ADR-015. The outcome table lives in
> [Product Experience Todo](product-experience-todo.md); the records live in
> [Build Stack and Architecture Selection](build-stack-and-architecture-selection.md#8-decision-records-adr-style).

14. **External-video boundary.** Confirm "official embed only" and that no
    external stream may enter the recovery closure. Default: as stated in
    item 9.
15. **An adjacent photo product's place.** Client of the typed API, a separate
    product, or a merge. Settled: a separate product acting as a client
    (ADR-014).
16. **MV relation timing.** Whether pairing waits for the admitted
    relation/progress-envelope work or is scheduled earlier. Recommendation:
    wait, and reuse the sidecar-of-media shape rather than inventing a
    parallel relation kind that the closure would later have to reconcile.

### Recorded decisions (2026-09-28)

These settle items above. Each names its normative home, because this file
cannot create a rule itself.

17. **Client stack — the React WebUI continues.** Borrow the visual language of
    the best-looking players (artwork-derived dynamic colour, dense tiled
    grids, gesture-driven navigation) into the existing React + Ant Design
    client; do not adopt a second frontend stack. A later desktop shell for
    native feel is acceptable. Namida is a **design reference only**: its
    licence is a EULA that forbids redistributing the program under another
    name or licence, and its README states the project cannot currently be
    built directly. No code is copied. Musly (dddevid/Musly), a Flutter
    Subsonic client, remains an unadopted alternative with an unverified
    licence.
18. **Field flexibility without a second store.** Durable domain fields are
    declared, versioned, namespaced entries in the field registry
    (external-ai-and-semantic-extensions.md:274), carried as a typed JSON
    payload inside the one SQLite catalog, with generated columns for whatever
    is queried or indexed. Many-to-many links are relation rows, never JSON
    arrays, because a relation must be indexable, integrity-checkable, and
    includable in the recovery closure. Rebuildable derivatives may use
    free-form JSON but carry generation and producer labels. A reader that does
    not know a field reports unknown; it never infers meaning from keys. No
    NoSQL or external document store is admitted: it would be a second live
    metadata database and a reader dependency that breaks clean-install
    recovery (mvp-and-operator-contract.md:348, :446). Ratifying this belongs
    in the normative field-registry document, not here.
19. **Music playback is not written here.** The OpenSubsonic facade stays
    maintenance-only plumbing; no player ships inside the daemon. A beautiful
    library surface is React-side work over the typed API.
20. **MV matching rules, borrowed as a pattern.** A local MV pairs when its
    filename contains the music filename, or the track title plus first artist,
    or the track's video id carried in the comment tag or filename; symbols and
    whitespace are ignored before comparison. External video stays
    convenience-only per item 9 — no download, no cache, no re-hosting.
21. **Mood playback is resolved, not hard.** Mood is a user-declared durable
    tag plus a saved view or query preset. The "radio" behaviour is a query
    over listening history and co-listening, both rebuildable derivatives, so
    no mood or energy classifier is required and none enters the default
    profile. The difficulty the operator flagged was inferring mood, not
    playing by one.
