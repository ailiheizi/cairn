# Cairn

[中文](README.md) · [English](README.en.md)

<p align="center">
  <strong>A self-hosted personal drive, made for finding and using your files</strong><br>
  Keep it in your space. Find it, use it, take it with you.
</p>

<p align="center">
  <a href="#current-status"><img src="https://img.shields.io/badge/status-unreleased_core_preview-8b5cf6?style=flat-square" alt="Status: unreleased core preview"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4ed8b0?style=flat-square" alt="License: MIT"></a>
  <a href="go.mod"><img src="https://img.shields.io/badge/go-1.26-79c2ff?style=flat-square" alt="Go 1.26"></a>
</p>

> Cairn is for NAS and home-storage hobbyists: find your content, use it through Photos, Music and Library, or take out and verify the originals; existing built-in layouts and dedicated interfaces make daily work fit personal habits. File-first intake and exact deduplication support that loop. Current `main` is an unreleased development preview after `v0.1.0-prealpha.1`, not a production release. A supported installer, production repository qualification, LinkGroup, and complete multi-platform guarantees remain open.

<p align="center">
  <img src="docs/assets/screenshots/unreleased/library-en.png" alt="Cairn library preview with content search, Notes, batch tags, and index status" width="1100">
</p>
<p align="center"><sub>Demo content in the current local development preview.</sub></p>

[5-minute start](#5-minute-start) · [Core capabilities](#core-capabilities) · [Wiki](docs/wiki/README.md) · [Full documentation](docs/README.md) · [Changelog](CHANGELOG.md)

## Core capabilities

- **Find content:** keywords, structured filters, tags, and Notes work together; semantic search is available after an explicitly provisioned and verified local BGE bundle.
- **Use or take out originals:** work with content in Photos, Music or Library, download original files, or export and verify their bytes.
- **Make it your tool:** choose Workspace or Content showcase, then use dedicated interfaces such as Photos and Music in ways that fit your habits; over time, we hope to offer more ways to combine pages, layouts and presentations.
- **Keep context:** names, source paths, file facts, multiple tags, and one Notes surface stay with the content.
- **Organize in batches:** add or remove tags and favorite selected content; the ordinary Library list supports range selection in displayed row order.
- **Easy intake:** choose or drop files, review the automatically prepared batch and confirm saving originals; importing an existing NAS directory remains available.
- **Reduce duplicates:** SHA-256 of the complete content plus logical length identifies exact matches, so duplicate content is stored once.

### Future directions

We want to make content easier to find, use and take out, then help each person shape the whole tool into something they enjoy using. Here are experiences we hope to expand beyond the current preview:

- Make the path from search to using or downloading an original feel more natural and take fewer steps.
- Make Photos and Music journeys more complete, with curated albums and persistent playlists, and give video a dedicated browsing and playback experience.
- Let people combine more pages, layouts and presentations into a tool they enjoy, beyond changing colors alone.

Different interfaces will continue to share the same content, tags and search, keeping originals and recovery records reliable.

Cairn keeps original files together with their descriptions, discovery, export and recovery in one self-hosted library. Photos and Music have dedicated interfaces; other files use the general Library for retrieval and takeout. Recognized file formats are not guaranteed to preview or play. Video does not yet have a dedicated media experience; see below. Daily organization centers on content, tags and discovery, with original directories retained as provenance and recovery references.

## One complete workflow

```text
configure your space once
→ choose/drop files or inspect a NAS directory
→ confirm saving originals
→ find files through search, favorites, tags and Notes
→ use the library, Photos or Music
→ download/export originals or restore and verify their bytes
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

These screenshots show the current local development preview.

<details>
<summary>Photos browsing and inspection</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/photos-en.png" alt="Photo wall, inspection and shared selection actions" width="1100"></p>
<p align="center"><sub>Demo content in the current local development preview.</sub></p>

The photo wall, continuous viewer and Exhibition share the current content scope. The viewer and Exhibition can select photos and return to the existing batch-action area; image reads stay within the current size and pixel budgets.
</details>

<details>
<summary>Music browsing and queue</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/music-en.png" alt="Music list, sorting and queue actions" width="1100"></p>
<p align="center"><sub>Demo content in the current local development preview.</sub></p>

Sort the loaded Music list by recorded track facts and filter files eligible for a playback attempt. The transient queue supports append, insert-next, reorder, one-shot shuffle of upcoming tracks and repeat. Insert-next leaves the current track playing; browser decoding still depends on the audio format.
</details>

<details>
<summary>Add files</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/protection-plan-en.png" alt="Choose or drop files, review them and explicitly confirm saving" width="1100"></p>
<p align="center"><sub>Demo content in the current local development preview.</sub></p>

Choose or drop files to prepare the current file list for review. Staging does not mean the files are saved; only explicit Save confirmation writes content into the protected library.
</details>

## Current status

The local development preview includes a photo wall, continuous viewer and Exhibition; photo inspection can select items and jump to the shared batch-action area. Music browses tracks and recorded artist/album facts, sorts and filters the loaded list for original playback attempts, and controls a transient queue. Insert-next places a track after the current one without restarting playback; the queue also supports append, reorder, one-shot shuffle of upcoming tracks and repeat. Unknown facts stay last or in an unknown group, and browser decoding is not guaranteed. Pages and whole interfaces are registered through compiled in-repository code.

The wall and Exhibition are Photos presentations over the same search/tag results. Selection in the photo viewer and Exhibition is shared with the existing batch-action area. Music presents tracks and recorded audio facts within the same returned-result scope. Workspace and Content showcase are a separate whole-interface layout layer. Pages and layouts use in-repository code compiled into the first-party client; there is no runtime third-party package loader or isolation boundary.

Shift-click in the ordinary Library list selects an inclusive range in the currently displayed row order; local Photos/Music filtering does not widen that range. Batch add reuses an exact existing tag on a selected item, and remove affects matching `TAG` records only, preserving other tags and Notes. Stars and the shared Only favorites filter in Photos, Music and Content overview use the ordinary visible `Favorite` tag. This is a daily tag shortcut, not album or playlist membership. Each change does not immediately create a new signed portable backup. Fuller album and playlist experiences are part of the future direction above.

Content overview combines photos, audio and other content within the same search/tag scope, with shared selection, Details and playback. Each section previews at most six items and distinguishes displayed counts from scope totals; domain switches do not rerun search. Library and Overview expose the existing Saved retrieval panel directly; Photos and Music retain it in Library tools. Saving accepts only submitted, supported query conditions; media display choices and other unsupported active conditions are refused. Recall reruns a dynamic lexical query and discloses empty, degraded or foreign-scope results; it is not a frozen semantic result. Curated albums and durable playlists have a [candidate design](docs/technical/durable-media-organization-design.md) but remain unimplemented. See the [overview acceptance](docs/technical/fixed-overview-acceptance-20261009.md).

Selected originals can be downloaded in one ZIP with per-file identity checks, progress and cancellation. Photos and Exhibition provide transient PNG/JPEG thumbnails up to 8 MiB/12 million pixels and direct large-image inspection. The ZIP budget is 32 files, 32 MiB per file and 64 MiB total; larger takeout retains single-original downloads and server-directory export. Explicit image inspection remains capped at 8 MiB and original audio playback at 32 MiB. Richer photo facts and thumbnails, Music artwork and mobile experiences remain future directions.

### Video and other files

Video files currently use the general Library for preservation, search and original takeout; there is no dedicated video library or playback. Preview of other formats depends on actual support. A dedicated video experience is a future direction above.

These Photos/Music and takeout capabilities are part of the local [RW-PERSONAL-UX-1](docs/requirements/first-party-client-experiences.md) development scope; the full product and release qualification remain unfinished. See [ADR-027](docs/technical/build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions), the [extension contribution guide](docs/technical/client-experience-extension-guide.md) and [current acceptance](docs/technical/takeout-photo-acceptance-20261009.md).

### Implemented and tested (current development profile)

- TOML configuration, explicit data paths, source inspection, protection plans, and confirmed writes.
- SHA-256 + length identity, exact whole-file deduplication, Notes, multiple user tags, and keyword/structured search.
- Real BGE-small-zh + ONNX + zvec components run with an explicitly provisioned bundle; without one, the service honestly degrades to ordinary search.
- SavedView, ExportManifest, materialize/verify, signed recovery, clean reader, tamper rejection, migration, and cross-process safety evidence for the local development scope.
- Library batch organization: idempotently add tags to captured selections, remove matching tags, favorite/unfavorite in batches, and select inclusive ranges in ordinary displayed row order.
- Local Photos/Music slices: selection shared from photo inspection to batch actions, recorded artist/album browsing, bounded identity-checked original playback, loaded-list Music sorting/eligibility filters, and transient queue append/insert-next/order/shuffle/repeat. Fuller photo and music journeys are described under Future directions.
- Library and Overview directly open existing SavedView retrieval; Photos/Music keep it in Library tools. Supported queries recall dynamically, with visible refusals, empty/degraded outcomes and foreign stored scopes.
- Photos, Music and Content overview share the existing `Favorite` TAG star and filter. It creates no album/playlist membership and does not promise an immediate signed backup on each click.
- React WebUI and the loopback `/api/v1` convenience adapter, with responsive layout and Chinese localization.
- Settings → Appearance switches between bundled Workspace and Content showcase layouts over shared content, search, and Notes; palettes are independent secondary choices. See the [local acceptance record](docs/technical/client-interface-experiences-acceptance-20261006.md).

### Core qualification and technical boundaries

- `local-zstd-v1` is a runnable whole-file compression candidate, not a production repository; Restic/Kopia/Plakar have not been selected as a default engine.
- Supported offline installers, cross-platform distribution, upgrade/backup workflows, and production qualification still require independent evidence.
- LinkGroup is the minimal file-link grouping primitive in the core plan; it can enter Phase 6 only after the existing Phase 4/5 gates, and has no user-visible version history or complete workflow today.
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
