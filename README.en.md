# Cairn

[中文](README.md) · [English](README.en.md)

<p align="center">
  <strong>A self-hosted home for your personal content</strong><br>
  Keep it in your space. Find it, use it, take it with you.
</p>

<p align="center">
  <a href="#current-status"><img src="https://img.shields.io/badge/status-unreleased_core_preview-8b5cf6?style=flat-square" alt="Status: unreleased core preview"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4ed8b0?style=flat-square" alt="License: MIT"></a>
  <a href="go.mod"><img src="https://img.shields.io/badge/go-1.26-79c2ff?style=flat-square" alt="Go 1.26"></a>
</p>

> Cairn is for NAS and home-storage hobbyists, with the proposition “a self-hosted home for your personal content.” Keep it in your space. Find it, use it, take it with you. Current `main` is an unreleased development preview after `v0.1.0-prealpha.1`, not a production release. A supported installer, production repository qualification, LinkGroup, and complete multi-platform guarantees remain open.

<p align="center">
  <img src="docs/assets/screenshots/unreleased/library-en.png" alt="Cairn content-first library with search, tags, Notes, protection, and index status" width="1100">
</p>
<p align="center"><sub>The development WebUI populated with sanitized demo data built from this repository's documents.</sub></p>

[5-minute start](#5-minute-start) · [Core capabilities](#core-capabilities) · [Wiki](docs/wiki/README.md) · [Full documentation](docs/README.md) · [Changelog](CHANGELOG.md)

## Core capabilities

- **Add and review:** choose files or a server folder, inspect the plan, and confirm exact preservation.
- **Find content:** keywords, structured filters, tags, and Notes work together; semantic search is available after an explicitly provisioned and verified local BGE bundle.
- **Keep context:** names, source paths, file facts, multiple tags, and one Notes surface stay with the content.
- **Take originals with you:** preview supported content, download original files, or export and verify their bytes.
- **Reduce duplicates:** SHA-256 of the complete content plus logical length identifies exact matches, so duplicate content is stored once.

The product direction brings photos, audio, video, documents, and other readable files into one library with shared identity, search, tags, Notes, access, export, and recovery, with a suitable way to browse each kind. Cairn remains a content, discovery, export, and recovery plane. It is not a cloud-drive filesystem, mount service, or OpenList fork. Unknown formats can be preserved within the declared capture scope without a promise of parsing or playback.

## One complete workflow

```text
configure storage
→ inspect a source
→ preview and approve a protection plan
→ save exact content and reuse duplicates
→ search, tag, and maintain Notes
→ export or restore and verify the original bytes
```

## 5-minute start

Use Go 1.26 (or the version declared by `go.mod`) and a Node.js version supported by Vite 7:

```bash
git clone https://github.com/ailiheizi/cairn.git
cd cairn
go build -tags=purego -o bin/cairnd ./server/cmd/cairnd
go build -o bin/cairn ./client/cmd/cairn
bin/cairn config init --path ./cairn.toml
```

Enable the local WebUI API:

```toml
[api]
enabled = true
listen = "127.0.0.1:4534"
```

Start the daemon and frontend in separate terminals:

```bash
# Terminal 1
bin/cairnd --config ./cairn.toml --socket /tmp/cairnd.sock

# Terminal 2
cd web
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The API is currently a loopback convenience adapter; do not expose it directly to the public network. See the [Wiki quick start](docs/wiki/quick-start.md) for configuration, source inspection, and restore details.

## Real interface

<details>
<summary>Show the storage-plan preview used while adding a source</summary>

<p align="center">
  <img src="docs/assets/screenshots/unreleased/protection-plan-en.png" alt="A real pre-save storage plan showing logical size, new bytes, and duplicate reuse" width="1100">
</p>

The preview writes no file bytes; duplicate reuse and expected new storage are explicit before confirmation.
</details>

## Current status

The local client includes a photo wall, continuous viewer and immersive exhibition, plus music tracks/artists/albums, verified original playback, queue ordering, one-shot upcoming shuffle and repeat controls. Artist/album groups use recorded audio tags; absent facts keep filenames and explicit unknown groups. Independent compiled page and whole-interface registries let reviewed experiences keep expanding while the default stays simple.

The wall and Exhibition are two Photos presentations over the same current search/tag results; Music also presents tracks and existing audio facts within that returned-result scope. Workspace and Content showcase are a separate whole-interface layout layer. Pages and layouts accept trusted code compiled into the first-party client only; there is no runtime third-party package loader or isolation boundary.

Stars and the shared Only favorites filter in Photos, Music and Content overview use the ordinary visible `Favorite` user tag and existing tag operations. This is a daily tag shortcut, not album or playlist membership. Tags are stored in the existing catalog; each click does not immediately create a new signed portable backup. Curated albums and persistent repeat-capable playlists still need independent organization, recovery and export contract review.

Content overview combines photos, audio and other content within the same search/tag scope, with shared selection, Details and playback. Each section previews at most six items and distinguishes displayed counts from scope totals; domain switches do not rerun search. Curated albums and durable playlists have a [candidate design](docs/technical/durable-media-organization-design.md) but remain unimplemented. See the [overview acceptance](docs/technical/fixed-overview-acceptance-20261009.md).

Selected originals can now be downloaded in one ZIP with per-file identity checks, progress and cancellation. Photos and Exhibition provide transient PNG/JPEG thumbnails up to 8 MiB/12 million pixels and direct large-image inspection. The ZIP budget is 32 files, 32 MiB per file and 64 MiB total; larger takeout retains single-original downloads and server-directory export. Explicit image inspection remains capped at 8 MiB and original audio playback at 32 MiB. Local browser evidence includes a mixed-original ZIP, duplicate names, an empty file, large images and native orientation. Curated albums, capture-date/EXIF extraction, retained derivatives, cover extraction, durable playlists and the full mobile journey remain open. See [ADR-027](docs/technical/build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions), the [extension contribution guide](docs/technical/client-experience-extension-guide.md) and [current acceptance](docs/technical/takeout-photo-acceptance-20261009.md). This is the local [RW-PERSONAL-UX-1](docs/requirements/first-party-client-experiences.md) scope; the full product and release qualification remain unfinished.

### Implemented and tested (current development profile)

- TOML configuration, explicit data paths, source inspection, protection plans, and confirmed writes.
- SHA-256 + length identity, exact whole-file deduplication, Notes, multiple user tags, and keyword/structured search.
- Real BGE-small-zh + ONNX + zvec components run with an explicitly provisioned bundle; without one, the service honestly degrades to ordinary search.
- SavedView, ExportManifest, materialize/verify, signed recovery, clean reader, tamper rejection, migration, and cross-process safety evidence for the local development scope.
- Local Photos/Music slices: wall/viewer/exhibition, recorded artist/album browsing, bounded verified original playback, transient queue ordering/shuffle/repeat, and named lexical retrieval. Curated photo albums, durable playlists and the complete mobile workflow remain open.
- Photos, Music and Content overview share the existing `Favorite` TAG star and filter. It creates no album/playlist membership and does not promise an immediate signed backup on each click.
- React WebUI and the loopback `/api/v1` convenience adapter, with responsive layout and Chinese localization.
- Settings → Appearance switches between bundled Workspace and Content showcase layouts over shared content, search, and Notes; palettes are independent secondary choices. See the [local acceptance record](docs/technical/client-interface-experiences-acceptance-20261006.md).

### Candidate, planned, or explicitly out of scope

- `local-zstd-v1` is a runnable whole-file compression candidate, not a production repository; Restic/Kopia/Plakar have not been selected as a default engine.
- Supported offline installers, cross-platform distribution, upgrade/backup workflows, and production qualification still require independent evidence.
- LinkGroup is the later minimal file-link grouping primitive; it has no user-visible version history and its full workflow is not implemented yet.
- Image CLIP/SigLIP, acoustic indexing, RWKV/Transformer compression, and destructive GC are not part of the current default core; reachability remains `NON_DESTRUCTIVE_ONLY`.

“Implemented and tested” means evidence for the stated checkout scope, not production support. See the [content, deduplication, search, and export contract](docs/requirements/content-store-views-and-exports.md) and the [core execution plan](docs/technical/core-mvp-execution-plan.md) for the complete status matrix.

## Go deeper

- [Wiki overview](docs/wiki/README.md): plain-language guidance for daily use and boundaries.
- [Detailed capability reference](docs/wiki/capability-reference.md): configuration, storage, search, Notes, recovery, and status details.
- [Quick start](docs/wiki/quick-start.md) · [Storage and capacity](docs/wiki/storage-and-capacity.md) · [Index status and search](docs/wiki/index-status-and-search.md) · [Recovery and boundaries](docs/wiki/recovery-and-boundaries.md)
- [Documentation map](docs/README.md): requirements, ADRs, technical plans, and qualification records.
- [Content Store, Views, and Export Requirements](docs/requirements/content-store-views-and-exports.md) · [Core MVP Execution Plan](docs/technical/core-mvp-execution-plan.md)
- [Changelog](CHANGELOG.md)

## License

The source is available under the [MIT License](LICENSE). Model weights, tokenizers, ONNX Runtime, zvec, third-party dependencies, and future install bundles retain their own licensing and redistribution terms.
