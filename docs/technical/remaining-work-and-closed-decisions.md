# Remaining Work and Closed Decisions

> **Status:** Informative checkout record, updated 2026-09-17. The normative
> requirements and [Core MVP Execution Plan](core-mvp-execution-plan.md) remain
> authoritative. This file summarizes the current frontier; it cannot add
> scope, qualify a release, or select a repository engine.

## 1. Current product boundary

Cairn is a content protection, description, discovery, export, and
recovery plane. It is not a writable NAS, mount service, media server, OpenList
fork, or client suite.

The ordinary loop is:

```text
configure
-> inspect and protect content
-> retain names, facts, one Notes surface, and recovery references
-> search lexical + structured + semantic information
-> save a view and freeze an ExportManifest
-> materialize and verify output
-> restore exact bytes
```

The core owns content identity, protection outcomes, plans, publications,
durable facts and descriptions, search-generation truth, views, exports,
verification, and recovery meaning. Replaceable repositories, processors, and
indexes may implement work behind those contracts; they do not redefine it.

## 2. Closed decisions

| Decision | Current rule |
| --- | --- |
| Exact identity | Full logical-stream SHA-256 plus logical length |
| Default deduplication | Exact whole-content deduplication |
| Default protection | `STORE_EXACT` |
| Search authority | Embeddings and indexes are rebuildable and never authorize deletion |
| Operational metadata | Keep one configured catalog; do not add a second live metadata database without a demonstrated need |
| Recovery authority | Repository objects plus authenticated portable recovery records and an independently retained trust anchor |
| Personal semantic profile | Pinned local BGE/ONNX + in-process zvec; no Qdrant, Milvus, or Compose dependency |
| User-facing free-form text | One `Notes` surface in the browser; durable `Annotation.NOTE` and `DescriptionDocument` records remain separate for provenance, revision, and recovery |
| Garbage collection | Non-destructive reachability planning only; no deletion executor |
| Source deletion | Disabled; any future capacity release requires a reviewed migration profile and human approval |
| Filesystem gateways | No built-in FUSE, SMB, NFS, WebDAV, S3, or mount product |
| OpenList | Research or external interoperation only; never the core, storage engine, or fork base |
| Neural/RWKV codecs | Deferred research only after simple lossless storage and recovery qualification |

The old Inbox, OpenSubsonic, and OPDS compatibility experiments have been
removed. The bounded loopback `/api/v1` adapter and React client call the same
typed dispatcher and do not create another catalog, job system, or recovery
model.

## 3. Implemented and tested development scope

- Strict persisted config and explicit catalog/repository/vector/model/recovery
  paths.
- Rooted directory inspection, immutable plans, digest-bound apply, source
  revalidation, idempotent replay, and visible blocked/degraded outcomes.
- Exact SHA-256 identity, whole-file duplicate placement, exact readback, and
  original-path recovery projection.
- Durable revisioned Notes and tags, provenance-preserving Descriptions and
  semantic segments, and basic text/audio-tag/EPUB extraction. The browser
  presents the free-form text through one Notes surface.
- Complete stated lexical/structured search fields and filters, source-bearing
  segment hits, and real provisioned BGE/ONNX + zvec fusion with honest
  degradation.
- Snapshot list/diff/verify, bounded content reads, dynamic SavedViews, frozen
  ExportManifests, materialization, verification, and exact restore.
- Signed portable recovery facts and subject mappings, independent trust
  anchors, clean-install readers, tamper rejection, no-follow reads,
  cross-process fencing, unknown-outcome reconciliation, and bounded retry of
  the same signed processor plan.
- Optional loopback API, focused browser client, maintenance/recovery CLI, and
  read-only local MCP.
- Bounded upload channel into a daemon-owned staging inbox (loopback
  `POST /api/v1/upload`, 1 GiB per file, 200 files per request, process-wide
  in-flight byte ceiling). Staged bytes are daemon scratch with no protection
  record: `source.list` projects the inbox honestly, and only the ordinary
  plan.ingest -> review -> digest-bound plan.apply flow protects staged
  content.

This is a substantial core preview. It is not `RW-MVP-1` completion or release
qualification.

## 4. Runnable candidates

`directory-cas-dev-v1` remains the generated development repository.

`local-zstd-v1` is an opt-in candidate with whole-file compression and dedup,
decode-and-hash verification, corruption and relocation handling, repair,
mechanism-separated savings reports, and copy-forward migration evidence,
including a real pre-publication process-crash/retry boundary. It is not a
selected production engine.

Whole-file exact deduplication is sufficient for the MVP. Chunking is an
unselected optional repository feature and becomes a gate only if a selected
profile uses it. Destructive collection is disabled rather than unfinished
MVP work; reachability stays `NON_DESTRUCTIVE_ONLY`.

`local-zstd-encrypted-v1` is an experimental candidate with AES-256-GCM,
host-provided key references, wrong/missing-key rejection, encrypted readback,
relocation, and key-rotation copy-forward evidence. A real pre-publication
process-crash test now proves target non-publication, retry, independent
source/target clean-reader reopening, and old/wrong-key rejection. Persisted
config and the daemon now name-reject this profile rather than treating it as a
generic unknown tuple. It is not admitted and does not close encryption release
qualification.

## 5. Near-term release work

1. **Supported offline semantic packaging:** distribute the daemon, ONNX
   Runtime, pinned BGE model/tokenizer, and zvec library without a first-query
   download. The candidate artifact assembler now produces a deterministic
   same-host archive with checksums and separated license/SBOM evidence, but
   clean supported-host installation, a complete release SBOM, redistribution
   review, and upgrade qualification remain.
2. **Production repository qualification:** measure representative corpora and
   select one lossless profile only after encryption, crash, corruption,
   repair, relocation, migration, rollback, clean-reader, capacity, and net
   savings gates pass. The qualification runner now accepts a reviewed,
   operator-supplied corpus manifest and verifies every path, length, and
   SHA-256 before an engine is opened. The same manifest can now bind both
   in-tree raw/zstd measurements to identical input bytes; the checkout still
   has no representative operator corpus or cross-platform evidence.
3. **Complete operator experience:** expose configuration, diagnostics,
   SavedViews, ExportManifests, backup, upgrade, and recovery guidance without
   requiring internal IDs in the ordinary browser flow.
4. **Release qualification:** run Linux and NAS-like acceptance for search
   coverage, latency, storage growth, recovery time, upgrade/rollback,
   packaging, and clean installation.

The bounded same-plan asynchronous retry contract is implemented and tested,
including a real process crash followed by cross-process lease takeover.
User-triggered, rerouted, or general reprocessing remains disabled and requires
a separately reviewed signed successor contract; it is not a hidden MVP
completion requirement.

## 6. Later optional directions

These directions require concrete user demand and a separately admitted
profile. They are not current release promises:

- reviewed source migration and human-approved capacity release;
- richer extractors, OCR, ASR, CLIP, and alternate embedding profiles;
- additional qualified repositories, independent copies, and tiering;
- remote enterprise administration, audit, RBAC, HA, and multitenancy;
- advanced exact-reversible representations after the simple storage and
  recovery gates close.

The product direction for future named storage schemes is recorded in
[ADR-009](build-stack-and-architecture-selection.md#adr-009-storage-schemes-and-derived-index-status)
and summarized in the [Cairn Wiki](../wiki/README.md). The current
read-only capacity and per-dimension index-status projections are implemented
and tested; the named-scheme configuration remains deferred. This direction
does not add a second catalog, change exact identity, or move CLIP/music
indexes into the current default profile.

## 7. Not in the core queue

- Built-in filesystem or network-storage gateways.
- An OpenList fork or alternate path-first core.
- Embedded players, readers, or media applications.
- Automatic external reacquisition or autonomous source deletion.
- Destructive GC before a separately authorized and qualified lifecycle
  profile; the current implementation remains `NON_DESTRUCTIVE_ONLY`.
- New acoustic, graph, or multimodal default dimensions during the current
  implementation lock.
- RWKV, Transformer, arithmetic, or other neural codec implementation before
  lossless repository and recovery qualification.

## 8. Status vocabulary

- **implemented and tested:** executable evidence exists for the stated scope;
- **candidate:** runnable and measurable, but not release-qualified;
- **release default:** mandatory behavior of a qualified distribution;
- **planned:** no shipped capability claim;
- **closed non-goal:** intentionally outside the current product.

A fixture, interface, test handshake, or provisioned local component is not a
supported installer or a production-qualified release by itself.

## 9. Deferred external integration boundary (informative)

This section is informative only. It records a boundary the operator raised; it
adds no MVP scope, reorders no phase, authorizes no LinkGroup or adapter work,
and awards no completion credit.

Operators have asked for Cairn content to reach Salt Player, common NAS
playback surfaces, Kazumi, and Animeko. These are external tools, not core
scope. [docs/README.md](../README.md) states the governing rule verbatim:
"External tools may present a materialized export or authorized read stream;
they are not Cairn storage or plugin interface families." The excluded
surfaces already recorded in section 7 above (lines 157-158: embedded players,
readers, or media applications; automatic external reacquisition or autonomous
source deletion) and in the `AGENTS.md` excluded-surface list apply unchanged.

Such a tool may only consume a materialized export or an authorized read
stream. Cairn MUST NOT grow a media server, DLNA/UPnP, SMB/NFS/WebDAV/S3
gateway, transcoder, embedded player, scraper, torrent, or automatic
reacquisition surface to serve one.

Any external handoff depends on three prerequisites that are not closed by
recording this note:

1. **Durable, digest-stable sidecar policy.** The frozen `ExportManifest`
   digest already covered the requested sidecar policy, but the catalog
   projection did not persist it, so a manifest planned with a non-empty policy
   failed later apply and verify with a conflicting digest. That persistence
   defect is fixed: the policy is stored, read back on every manifest path, and
   passed into the rebuilt manifest, so the digest now survives a store reopen.
   The frozen digest field set is unchanged. One policy value now has a
   materializer: `handoff-v1:manifest-json` writes exactly one derived
   `restoreweave-export.json` file beside the frozen subject files,
   `export.apply` reports the sidecar files it wrote, and `export.verify`
   recomputes the sidecar from the frozen manifest and compares it
   byte-for-byte, so a missing or altered sidecar is a verification failure and
   never a clean verify. Every other non-empty policy value fails as
   `invalid_input` at plan time and is refused by apply and verify instead of
   being ignored, so an operator who asks for a sidecar never silently receives
   none. The sidecar is derived output that states so in its own document; it
   is not identity, it is never a frozen item, and it changes no subject file
   byte, no frozen field, and no digest. Other handoff profiles (music
   `.lrc`/m3u, anime NFO, sticker `pack.json`, citation files) still have no
   materializer.
2. **Minimal file-only `LinkGroup`.** Per the Core MVP Execution Plan, Phase 6
   supplies the minimal `LinkGroup`, and per `AGENTS.md` it may not be
   implemented before the Phase 4 and Phase 5 gates close. An album or series
   handoff is maintainable only when it follows a stable group membership that
   is frozen into a fresh manifest as the group changes, instead of a one-shot
   ad-hoc selection that a later rescan cannot reproduce.
3. **Explicit export output-naming and collision policy.** The reviewed policy
   now exists for the legacy flat-output export v1 path. `export.plan` honors a
   supplied `output_name` when the frozen set is exactly one regular file (the
   value is trimmed and must already be a safe single destination-relative
   component; a blank, separated, or traversal value fails as `invalid_input`),
   rejects a single `output_name` for a multi-file selection with an explicit
   reason instead of silently ignoring it, and disambiguates repeated base
   names deterministically as `clip.mkv`, `clip (2).mkv`, `clip (3).mkv` (or
   `notes`, `notes (2)`) in ascending subject-reference order, so planning the
   same set always freezes the same names and the same frozen item set.
   Collision grouping is case-insensitive because destination filesystems
   (macOS, Windows, and most NAS SMB shares) may not be able to hold
   `Clip.mkv` and `clip.mkv` at once. Unicode NFC/NFD normalization is still
   out of scope and remains a recorded limitation, and the policy stays
   single-component and snapshot-local, so it does not anticipate the Phase 6
   `ExportManifest` successor. An external tool that must place dozens of files
   predictably can now rely on the frozen layout, but this closes only the
   naming prerequisite; the LinkGroup and qualified-repository prerequisites
   above remain open.

Season/episode or album/artist hierarchies are richer Collections. They remain
deferred and are not the minimal `LinkGroup`; they require a separately
admitted profile.
