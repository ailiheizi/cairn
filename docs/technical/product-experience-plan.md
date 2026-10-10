# Product Experience Plan

> Status: informative planning record (documentation authority rank 7). This is
> the operator-facing roadmap for everything **above** the core. It cannot
> reorder [Core MVP Execution Plan](core-mvp-execution-plan.md), which remains
> the only dependency-ordered implementation path. It adds no MVP scope, closes
> no gate, and awards no completion credit. Requirement status is owned by the
> canonical matrix in
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md);
> item detail and constraint notes live in
> [Product Experience Backlog](product-experience-backlog.md).

Created 2026-09-28 because the operator could not tell where the product stood
or what remained. Read this file together with the two above; do not treat it
as a third source of truth. The current experience queue is the
[Content-First Product Decision](content-first-product-decision.md), recorded
2026-10-05 and aligned on 2026-10-06; it prioritizes task flow and presentation only. It does not remove
normative MVP scope, the real local BGE semantic default, or Phase 4–7 gates.

The [2026-10-09 priority reset](product-priority-reset-20261009.md) controls
immediate work: named retrieval, batch original takeout, then reviewed narrow
photo/audio use. Its source-grounded gaps and admission decisions take priority
over the older broad sub-plan scheduling below; no phase status changes here.

## How to read this

The [whole-product delivery target](whole-product-delivery-target.md), recorded
2026-10-06, keeps the complete single-person product outcome visible across
these sub-plans. It supplies a gap map and ordinary-task acceptance outline;
implementation still follows the core plan, and partial preview evidence does
not close the overall product objective.

| Status | Meaning |
| --- | --- |
| `done` | Implemented and tested for the admitted development profile |
| `partial` | An end-to-end path works; the matrix names the remainder |
| `gated` | Inside an admitted phase but blocked by an earlier gate |
| `not started` | No implementation; design may exist |
| `out` | Outside the core queue under the current lock |

A gate is never closed by design text, a fixture, a harness, or a signed
foundation. Only executable evidence closes one.

## The product in one line

> A NAS content plane: protect exactly, find and understand it, use it, and
> restore it later.

Every sub-plan below must reuse this spine rather than replace it:

```text
Subject identity
  -> durable facts      (tags, one Notes surface, relations, minimal link groups)
  -> rebuildable derivatives (thumbnails, metadata, extracted text, vectors)
  -> views              (wall, timeline, map, player, mood preset)
  -> access / export / recovery  (unchanged, always authoritative)
```

Depth is bought in the derivative layer. Breadth is bought in the view layer.
Neither may touch identity or recovery meaning.

## Board 1 — core gates (they unlock everything else)

| Gate | What closes it | Status |
| --- | --- | --- |
| G3 Recovery closure | Admitted xattr/ACL/sparse/detection facts bound into the authenticated closure; trust anchor and clean-install reader; publication fencing and unknown-outcome reconciliation; corruption, relocation, and reader-dependency proofs | `partial` — implemented and tested for the admitted development profile. Open per the matrix: sparse extent maps, broader per-field provenance, production repository qualification, release acceptance |
| G4 Discovery | Real ONNX/BGE + zvec as the default profile, fused query, browser evidence | `partial` — lexical/structured `done`; encoder and zvec `done` for the opt-in component profile; fused default search `partial`; supported clean-host packaging and browser install/restart/real-query evidence open |
| G5 Storage | One qualified lossless repository engine and measured net savings | `not started` — engine not yet selected; `local-zstd-v1` is a candidate, required in the eventual qualified profile |
| G6 Grouping and export | Minimal file-only LinkGroup; SavedView; stable ExportManifest binding | `partial` — LinkGroup `planned` with no schema, operation, or evidence; saved views and frozen manifests work end to end but export v1 still uses a snapshot-local entry handle and a single-component output name |
| G7 Release | Packaging, migration, backup, upgrade, performance, full acceptance | `not started` |

Matrix lines: `../requirements/content-store-views-and-exports.md:800-817`.

## Board 2 — product sub-plans

| ID | Sub-plan | Gate | Status |
| --- | --- | --- | --- |
| SP-1 | Visual system and desktop shell | none (client-only) | `partial` |
| SP-2 | Dense content wall, timeline, map | G4 for facet completeness | `not started` |
| SP-3 | Ingest and workflow closure | Existing bounded upload maintenance; other work follows its core gates | `partial` |
| SP-4 | Retrieval quality | G4 | `partial`, one claim unverified |
| SP-5 | Music experience pack | G4, G6 | `not started` |
| SP-6 | MV pairing | G6 | `not started` |
| SP-7 | Photo and album experience pack | G4, G6 | `not started` |
| SP-8 | Listen and watch together | none; external service | `not started` |

## Now / Next / Later

This is the experience queue above the core. Normative requirements and their
phase gates remain in force.

```text
NOW      Shared intake -> find -> original export core
         Active browser maintenance, with honest content and reliability state

CURRENT  Maintain the two bundled whole-interface experiences and existing
         Photos/Audio lenses over shared client flows; palettes are secondary

NEXT     Reproducible local development preview and real-user workflow feedback;
         core qualification follows the Core MVP Execution Plan

LATER    Gallery first, then music experience, after reviewed contracts and
         applicable gates; extra interfaces only for an evidenced user need

DEFERRED Full player, music video, together-mode, maps, free-form dashboards,
         URL capture, and broader media-platform behavior

BLOCKED  Phase 4/5/6/7 work at the gates shown in Board 1; this overlay does
         not relax any entry evidence or qualification requirement
```

See the decision brief for the readable-file promise, support boundary, and
appeal criteria. The 2026-10-05 bounded browser maintenance slice is
implemented and tested for suffix-derived type/format cues, localized metadata,
Photos/Audio scope details, responsive toolbar wrapping, and the listed mixed
fixture/viewports. Its commands, fixture boundary, and evidence limits are
recorded in the [decision brief](content-first-product-decision.md#bounded-browser-maintenance-evidence).
SP-1 remains `partial`; this client evidence closes no normative MVP or release
gate.

## Sub-plan detail

### SP-1 Visual system and desktop shell — `partial`

- **In.** One React + Ant Design stack. Artwork-derived dynamic colour, dense
  tiled grids, gesture navigation, a compact fixed settings header, and
  desktop-first proportions. An optional later desktop shell for native feel.
- **Out.** A second frontend stack (no Flutter client); any new daemon
  operation, durable fact, or state machine.
- **Exit test.** No overlap or horizontal overflow at 707 / 1024 / 1280 / 1496
  CSS px in both themes; the first content row sits above the fold; every
  settings category is fully visible under keyboard navigation.
- **Note.** Borrow the visual language of the best-looking players, not their
  code. Namida is a design reference only: its licence is a EULA that forbids
  redistributing the program under another name or licence, and its README
  states the project cannot currently be built directly.

### SP-2 Dense content wall, timeline, map — `not started`

- **In.** Cursor pagination over `search.query`, virtualized rendering, stable
  scroll restoration on return, and thumbnails served as `ArtifactRef` through
  content access. Reuse the existing browser surfaces rather than adding new
  ones.
- **Out.** New index dimensions, durable thumbnails, or a new catalog table.
  Map aggregation is computed from stored coordinates.
- **Exit test.** A 10k-image fixture wall scrolls without full materialization;
  reopening a subject restores scroll position; no overflow at desktop widths.
- **Current limit.** The browser preview handles small text plus PNG, JPEG, GIF,
  and WebP only, bounded by a read budget and a 1 MiB fallback, and refuses
  larger content (`web/src/components/ContentPreview.tsx:46,104-107,235`).

### SP-3 Ingest and workflow closure — `partial`

- **In.** A bounded upload channel; the browser surface for similar candidates
  (its daemon side is implemented and tested); query by image; on-demand AI
  notes through the egress gate.
- **Out.** Automatic external reacquisition, source deletion, and destructive
  garbage collection.
- **Exit test.** Every surface has a real daemon and browser E2E and exposes an
  honest unavailable state instead of a silent success.
- **Status detail.** Similar-candidates browser surface in flight; query by
  image and AI notes are Phase 4. The bounded upload, staging/review/exact-save,
  library drop, and original download slice was implemented and locally tested
  on 2026-10-05; see [core preview acceptance](core-preview-acceptance-20261005.md).
  This reconciles the stale upload-decision label; it does not close SP-3 or a
  core/release gate.

### SP-4 Retrieval quality — `partial`, one claim unverified

- **In.** Pinyin and initial tokens so `lvxing` finds `旅行`, using an embedded
  Hanzi-to-pinyin table generated from a public-domain source with recorded
  provenance and digest. Confirm the CJK encoding is bigrams plus per-character
  tokens.
- **Out.** Any new index dimension; this is token enrichment, not a new field.
- **Exit test.** `lvxing` finds `旅行`; a mid-run query such as `西湖` matches
  inside `杭州西湖的备份方案备忘`; the coverage vocabulary is unchanged.
- **Verify first.** The backlog heading says CJK mid-run matching is
  implemented as lexical profile V4 while its body still describes the fix as
  not scheduled (`product-experience-backlog.md:68-100`). Resolve before
  crediting it.

### SP-5 Music experience pack — `not started`

- **In.** Audio metadata as declared, versioned, namespaced fields; mood as a
  user-declared durable tag plus a saved query preset; "radio" as a query over
  listening history and co-listening, both rebuildable; a good-looking React
  library surface.
- **Out.** A player inside the daemon; a learned mood or energy classifier; a
  new audio codec; multi-room synchronisation; adaptive streaming; external
  acquisition; DRM handling.
- **Exit test.** Tags are extracted and searchable; a mood preset returns a
  stable result set across restarts; no player surface is added to the daemon.
- **Status detail.** Above the existing `extract.audio.tags.v1` fact and the
  maintenance-only OpenSubsonic facade, nothing exists.

### SP-6 Music video link — `not started`

- **In.** One link per track: a relation to a local video subject, or an
  external reference. This is a small durable field, not a subsystem, though a
  new durable field still passes the ordinary schema checkpoint. Local matching
  rules: the video filename contains the music filename, or the track title
  plus first artist, or the track's video id in the comment tag or filename,
  with symbols and whitespace ignored before comparison.
- **Out.** Downloading, caching, re-hosting, or circumventing anti-leech or
  referer checks; any external stream entering the recovery closure; any
  credential requirement becoming a dependency.
- **Presentation.** Audio and video share one player surface. Switching
  cross-fades into the video with the artwork reused as a blurred full-bleed
  background, so it reads as one continuous surface rather than a new page.
- **Exit test.** A linked local video is found, protected, verified, and
  restored; an unreachable external reference renders unavailable and
  substitutes nothing.
- **Design record.** ADR-012.

### SP-7 Photo and album experience pack — `not started`

- **In.** The dense wall from SP-2; timeline and map facets; album-fill
  suggestions that carry a reason and undo only their own batch; deletion
  triage in which protected classes land unchecked.
- **Out.** Duplicating a full photo-management stack; face recognition;
  automatic sharing; destructive normalisation; and merging an adjacent
  product's platform photo library, on-device models, or database schema.
- **Exit test.** Every suggestion carries a reason; nothing is pre-selected;
  protected classes are unchecked by default; similarity never establishes
  identity and never authorises deletion.
- **Boundary.** An adjacent on-device photo product is recommended as a client of
  the typed API, not a merge (ADR-014).

### SP-8 Listen and watch together — `not started`

- **In.** Client-side, ephemeral room and presence state over a user-deployed
  synchronisation service, coordinating playback position and drift only.
- **Out.** Room state in the daemon; any durable room, catalog, or recovery
  state machine; turning Cairn into a streaming service.
- **Exit test.** Two clients stay within a stated drift bound; stopping the sync
  service leaves local playback correct; no durable row and no core command is
  added.
- **Verify first.** Search evidence points to a synchronisation-protocol
  integration discussion and a cloud-sync feature in the reference app, but
  this was not verified in source. Research the protocol and a self-hostable
  server before scheduling.

## Needs verification — not operator decisions

| ID | Item | Why it matters |
| --- | --- | --- |
| V1 | CJK lexical V4 status self-contradicts in the backlog | Decides whether SP-4 carries a done or an open item |
| V2 | The `AGENTS.md` lock still lists trust-anchor and publication-fencing work that the status matrix reports as working | The stale list makes "what is left" unanswerable; reconcile it |
| V3 | Musly's licence is unverified (Namida's EULA is confirmed) | Blocks any reuse of a Flutter client |
| V4 | The reference app's synchronisation mechanism is unverified | Blocks SP-8 scheduling |
| V5 | `scripts/web-e2e.sh` prints `SKIP: optional npm package playwright is not installed` and **exits 0**, so browser-layer "passes" were no-ops while Playwright was absent | Every UI claim must state whether the browser layer actually ran; the skip must be distinguishable from a pass |
| V6 | The Go semantic and zvec tests skip unless `CAIRN_ZVEC_LIBRARY` and friends are set | "`go test ./...` passes" does not mean semantic search was exercised |

## Open decisions for the operator

All five were settled on 2026-09-28. The outcome table and the ADR references
are in [Product Experience Todo](product-experience-todo.md).

## Explicitly out

Players, readers, and transcoders inside the daemon; mount or network
filesystem services; an OpenList fork; new index dimensions; richer
Collections; automatic external acquisition; source deletion; destructive
garbage collection; third-party video streaming inside the daemon; scraping or
re-hosting third-party video; a second live metadata store or any NoSQL
document database.
