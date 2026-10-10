# NAS Content Hub concept prototype

This is a self-contained, offline-capable interaction concept for a NAS-oriented personal content hub. It is deliberately separate from the current development WebUI and daemon. It adds no service, storage format, API, or product capability.

## Run locally

From the repository root:

```sh
python3 -m http.server --bind 127.0.0.1 4173 --directory docs/prototypes/nas-content-hub
```

Open `http://127.0.0.1:4173`. The page uses only this directory's files. It loads no remote fonts, images, scripts, APIs, or other network resources. The small WAV and MP4 files are generated demo media; playback is user-initiated through native browser controls.

## What is interactive

- Persistent desktop sidebar and mobile bottom navigation for All, Photos, Audio, Video, and Documents.
- Shared search and topic tags across all authored demo records. The `山间周末` tag connects sample photos, generated audio, a generated video, and a route document.
- A photo-forward gallery with a lead image, thumbnail grid, dates, and a compact timeline.
- Audio album/track layouts with local synthetic WAV files and native browser audio controls. Album, artist, track order, and notes are explicitly authored prototype metadata, not extracted facts.
- A video stage with native controls for a locally generated five-second abstract MP4; it is not a camera recording.
- Document list and in-page reading excerpt. Download actions demonstrate browser retrieval of bundled demo bytes; the PDF is a small locally generated placeholder, not a route guide.
- An inspection dialog with metadata, tags, editable demo Notes, focus return, Escape dismissal, and a download link. Notes live only in page memory and disappear on refresh.

The visible status badge states that this is a concept with demo content and that production media playback is not implemented. NAS capacity/status, dates, tags, locations, and media metadata are illustrative, not live device or file facts.

## Scope trace

- **Phase:** Phase 3 existing browser-product planning only; no production phase gate is advanced.
- **Requirement:** `docs/requirements/content-store-views-and-exports.md` sections 2 and 13: the ordinary content inspect/discover/export loop and traceability boundaries.
- **Exit:** one responsive offline page that presents specialized same-library content views over shared in-memory demo records, with honest prototype labeling.

This prototype is a design artifact, not evidence that a production media player, album model, NAS connection, or browser workflow has shipped or been qualified.
