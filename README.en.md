# Cairn

[中文](README.md) · [English](README.en.md)

<p align="center">
  <strong>Find what you saved. Put it to use. Keep the useful results.</strong><br>
  A self-hosted AI personal-content space.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4ed8b0?style=flat-square" alt="MIT License"></a>
  <a href="#current-status"><img src="https://img.shields.io/badge/status-development_preview-8b5cf6?style=flat-square" alt="Development preview"></a>
</p>

<p align="center">
  <img src="docs/assets/screenshots/current/home-zh.jpg" alt="Cairn private-space Home with featured Photos and Music cards" width="1100">
</p>
<p align="center"><sub>A real view from the current local preview, shown in Chinese. English is available. See <a href="docs/assets/screenshots/current/README.md">screenshot notes and credits</a> for demo content and media sources.</sub></p>

[5-minute start](#5-minute-start) · [Capabilities](#capabilities) · [Wiki](docs/wiki/README.md) · [Documentation](docs/README.md)

## Capabilities

| | Cairn helps you |
|---|---|
| **Save** | Files, folders and text share one review/save flow. Reopen a review or explicitly retry a stopped upload. Exact duplicates use full-content SHA-256 and logical length. |
| **Find** | Use the floating input to search keywords, fields, tags and Notes. Explicitly prepared local models add meaning and photo-scene retrieval; match evidence opens on demand. |
| **Use** | Open a media result in its dedicated Photos, Music or Videos page and locate the item. Playback, takeout and saved results share the same material. |
| **Originals** | Download originals or use the existing export flow to materialize and verify files; original bytes can be verified on restore. |
| **Make it yours** | Choose the built-in Workspace or Content showcase interface. Home lets you change existing block visibility and the order and split of Photos/Music. See the [compiled client contribution guide](docs/technical/client-experience-extension-guide.md). |
| **Lists** | Save ordinary JSON material lists with Notes and Skill context; request and review an organization candidate, then save through the existing flow. |

### From finding to using

1. **Save something:** drop files, choose a folder or write text. Review and explicitly confirm, then open the exact saved batch.
2. **Give a clue:** the floating input returns related material while keeping your space in place. Expand match evidence when needed; explicitly open an outside-scope media result in this search's dedicated page.
3. **Use and keep the result:** open, play or take out originals, or arrange selected material as an ordinary list. Review/save it and reopen it later.

<p align="center">
  <img src="docs/assets/screenshots/current/search-zh.jpg" alt="Floating scene-description search over the private-space Home" width="49%">
  <img src="docs/assets/screenshots/current/result-zh.jpg" alt="An ordinary list result ready to adjust, play, save and reuse" width="49%">
</p>
<p align="center"><sub>Queries and evidence disclosure retain the background page; explicit result activation performs the scope handoff. Lists remain ordinary saved material.</sub></p>

### Dedicated experiences

<p align="center">
  <img src="docs/assets/screenshots/current/photos-zh.jpg" alt="Cairn Photos experience" width="49%">
  <img src="docs/assets/screenshots/current/music-zh.jpg" alt="Cairn Music experience" width="49%">
</p>
<p align="center"><sub>Photos and Music use the currently loaded content scope and shared actions.</sub></p>

<p align="center">
  <img src="docs/assets/screenshots/current/videos-zh.jpg" alt="Cairn Videos experience with bundled player" width="900">
</p>
<p align="center"><sub>Videos browses loaded files. On explicit playback, MP4/WebM originals up to 32 MiB are fully verified before being handed to the bundled player.</sub></p>

Photos supports continuous viewing and timed slideshows. Music has track browsing, a transient queue, and the shared player; supported audio originals play after verification, up to 32 MiB. Eligible tracks can show artwork embedded in their original. Videos that exceed the limit or cannot play can still be inspected and downloaded as originals. Streaming and transcoding are not provided.

### Notes, search, and lists

Names, source paths, available file facts, user tags, and Notes help you find content. PDF/DOCX body search uses extraction compiled into the application. Semantic search requires an explicitly prepared local BGE bundle; image OCR and photo scene search also require their own explicitly prepared local processing bundle or model. They are not downloaded on the first query. Programs can read lists directly. Reopen them in the result page to play supported audio or take out unique originals. In-product AI organization sends an explicitly chosen list and Skill, returns a candidate, and waits for acceptance and reviewed saving.

See the [material-list guide](docs/wiki/material-lists.md) and [detailed capability reference](docs/wiki/capability-reference.md).

## 5-minute start

For a local source preview, use Go 1.26 (or the version declared by `go.mod`), a Node.js version supported by Vite 7, npm and curl:

```bash
git clone https://github.com/ailiheizi/cairn.git
cd cairn
./scripts/run-local.sh --data-dir "$HOME/cairn-data"
```

Replace `$HOME/cairn-data` with the absolute directory where you want Cairn's configuration, library and recovery records; use one directory per instance. The first run creates the configuration, while an existing configuration and its persisted paths remain authoritative.

The script builds the daemon, CLI and WebUI, then starts the local service in the foreground; press `Ctrl-C` to stop it. Open `http://127.0.0.1:4538/`. The API listens on loopback only; do not expose it to the public network.

It does not download or install a semantic model bundle; semantic search availability depends on the existing configuration and supplied bundle. This is a local source preview, not a supported installer or release qualification.

<details>
<summary>Advanced: manually build the daemon and CLI, then start the development WebUI</summary>

```bash
go build -tags=cairn_zvec_dynamic -o bin/cairnd ./server/cmd/cairnd
go build -tags=cairn_zvec_dynamic -o bin/cairn ./client/cmd/cairn
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

Open `http://127.0.0.1:5173/`. See the [Wiki quick start](docs/wiki/quick-start.md) for configuration, source inspection, and restore details.

</details>

## Current status

Cairn is currently a local development preview, not a production release. Interfaces and capabilities depend on the current source, configuration, and locally installed models; some search features require their own local bundles. This preview does not establish production repository qualification, complete multi-platform support, or a supported release installer. Audio and video playback remain subject to format support and the stated size limits.

Image OCR and photo scene search require explicit installation of their corresponding local bundles; real retrieval has been delivered in the Darwin arm64 development profile. Upstream models and dependencies retain their own license and redistribution terms. See the [capability reference](docs/wiki/capability-reference.md), [image-text search notes](docs/technical/product-power-image-text-proposal.md), and [visual search notes](docs/technical/product-power-visual-search-proposal.md) for boundaries and evidence.

### Future directions

Future directions include more personal ways to arrange pages, playback for larger media, and curated albums and persistent playlists. These remain future directions.

## Go deeper

- [Wiki overview and quick start](docs/wiki/README.md) · [Capability reference](docs/wiki/capability-reference.md)
- [Material lists](docs/wiki/material-lists.md) · [Storage and capacity](docs/wiki/storage-and-capacity.md) · [Search and index status](docs/wiki/index-status-and-search.md) · [Recovery and boundaries](docs/wiki/recovery-and-boundaries.md)
- [Documentation map](docs/README.md) · [Content, deduplication, search, and export requirements](docs/requirements/content-store-views-and-exports.md) · [Core implementation order](docs/technical/core-mvp-execution-plan.md)
- [Screenshot and media credits](docs/assets/screenshots/current/README.md) · [Changelog](CHANGELOG.md)

## License

The source is available under the [MIT License](LICENSE). Models, tokenizers, ONNX Runtime, zvec, third-party dependencies, and install bundles retain their own licensing and redistribution terms.
