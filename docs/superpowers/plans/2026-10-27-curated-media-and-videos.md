# Curated Media and Videos Implementation Plan

Use Luna for implementation, root for decisions/review, one integrated journey after integration. Preserve prior dirty work; do not commit.

**Goal:** Replace synthetic showcase data with selected real photos and owner-owned music/artwork, plus an optional usable Videos destination.
**Architecture:** Existing React/TypeScript page registry, host scope, original-download route and SHA-256 identity. No new dependency, backend endpoint, durable schema, processor, loader or media service.
**Phase / requirement / exit:** First-party client / owner 2026-10-27 video and real-media request / one curated-media-videos journey with real photo, embedded music art, explicit verified video playback, Details/original exits and Home visibility.

## Decisions

- Home keeps its editable Photos/Music split. Videos is a fourth known local block, hidden by default, re-addable through plus, rendered below the row. Only Photos/Music resize/reorder. Existing enabled-page guards apply.
- Videos filters current loaded members. Explicit supported MP4/WebM playback downloads at most 32 MiB, verifies full length and SHA-256 before Blob playback, and discards stale/cancelled/mismatched results. One video at a time; revoke URLs on replace/exit. Larger/unsupported items retain honest Details/download exits. No autoplay, streaming, transcoding, episode state or generated posters.
- Video play pauses host audio; starting host audio pauses video. Navigation cleans video up without restarting audio.
- Home prefers explicitly favorited supported photos in the loaded scope, with no extra reads. Curated demo photographs must fit existing preview bounds.
- Copy only a few owner-offered CloudCone originals using the existing SSH alias, read-only remotely. Private music stays under ignored local demo data. Public photos retain provenance/credit. Retain the old QA profile; do not modify the owner deployment/profile.
- Artwork derives only from already verified audio bytes on explicit play: bounded MP3 APIC / FLAC PICTURE, at most 2 MiB and 12 megapixels, no new fetch or external lookup. Bind it to exact current track and revoke on change. Missing/invalid artwork cannot block playback.

## Tasks and file boundaries

- [x] Videos (Luna): new Videos component/style and bounded reader; libraryViews, LibraryPageHost, LibrarySurface, LibraryPresentationNavigation, main integration; new video i18n module/registration. Root does final artwork field hookup in main after this task.
- [x] Home (Luna): OverviewExperience/style, OverviewHomeEditor, overviewPreferences/overviewSpotlight, Overview i18n only. Optional videoDestination comes from host. Render artwork only from exact matched currentPlayback.
- [x] Artwork (Luna): bounded audioArtwork helper, useAudioPlayback, musicQueueControls types, Music/AudioPlayer UI as needed. No main/Home edits. Expose current artwork URL from hook; root passes it through currentPlayback.
- [x] Demo (root/Luna): select/copy/inspect real assets, normal intake into an isolated profile, serve local preview. No private audio committed.
- [x] Integration (root/Luna): review diff, compile, one real-media journey; actual photo/artwork/video playback and unavailable exit/navigation cleanup. No broad suite, local diagnosis only for failures.

No client result closes a core phase or qualifies release. The video cap is a bounded first slice, not full NAS/movie-server playback.

## Executed evidence (2026-10-28)

Implemented for this bounded local client profile. Root reviewed the implementation and the final screenshots. `npm run build` passed for the final `index-7oCJHLRZ.js` / `index-CDmXjY6g.css` build; `git diff --check` passed.

The single `curated-media-videos` browser journey used eight normally ingested real files at `http://127.0.0.1:4670/`. It demonstrated the selected Favorite photo, optional Home video entry, real MP3 and FLAC playback/artwork in Music and Home, explicit verified MP4 playback, audio/video pause coordination, navigation cleanup, Details and exact original download. An intercepted one-byte-corrupted response was refused before a playback Blob was created; source/catalog content was not modified.

One observed FLAC failure was diagnosed locally: its PICTURE header declared unknown (zero) dimensions although the embedded JPEG was 800×800. The fix relies on the actual JPEG/PNG dimensions while retaining all byte/pixel limits. Only the affected FLAC artwork steps were repeated after integration; the passed video/MP3/download steps were retained.

Local report and screenshots: `dist/curated-media-20261027/evidence/curated-media-videos-acceptance.md`, `home-dark-flac-cover-paused.png`, and `videos-playing.png`. Demo source/profile and private music remain ignored local files. The original 4663 QA profile is retained. This is not streaming/transcoding, large-movie playback, a closed core phase, or release qualification.
