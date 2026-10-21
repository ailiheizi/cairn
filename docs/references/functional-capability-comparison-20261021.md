# Functional capability comparison: Cairn and adjacent self-hosted tools

**Snapshot date:** 2026-10-21
**Purpose:** function-delivery planning only. This is a documentation-based comparison, not a product review, hands-on competitor trial, or implementation admission.

Cairn's product goal is a single-owner self-hosted place to protect personal content, keep Notes and other useful facts with it, find it again, and take out or restore verified originals. The smallest useful implementation should reuse the existing content, Notes, TAG, search, ordinary material-list, SavedView, frozen-export, and recovery paths. A comparison with a mature product is a prompt to inspect a user outcome; it is not a reason to copy that product's architecture or feature breadth.

The Cairn column below is transcribed from the 2026-10-21 function-delivery snapshot and its F-key child statuses and methods. It is roadmap/source evidence, not a fresh runtime or end-to-end verification. “Available” therefore means the snapshot describes implementation or local evidence; it does not claim release qualification. Real BGE, OCR, and CLIP behavior still depends on their separately admitted local profiles and model readiness. The ordinary ML-1/ML-2 material-list client is a JSON snapshot plus explicit external copy/paste and existing host actions; it is not a native playlist/album database or an integrated AI runner. The F mapping is traceability to the function parent, not a claim that every child is complete.

## Files and personal records

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Capture files and folders — F01 | Paperless-ngx documents UI upload and watched-folder ingestion; Nextcloud documents a browser file interface. | F01: file selection, drag/drop and directories are “available” with local-flow evidence; reuse existing upload, staging, preview and confirmation. | Close only save confirmation and handoff to find/take out. Do not add a second inbox or background phone sync. |
| Capture a quick text note — F01 | Paperless-ngx accepts documents; Karakeep accepts bookmarks and text notes. | F01: ordinary text quick-save is marked available. F07 uses the existing Notes surface. | Keep text as ordinary protected content/Notes with provenance; no parallel note product. |
| Progress, cancellation and retry after intake failure — F01 | The Paperless-ngx consumer guide describes import workflows; it does not establish Cairn's exact recovery behavior. | F01: file-level progress/continue-after-failure is partial. | Make the save outcome and safe continuation clear; unfinished staging must not be represented as protected. |
| Locate and retrieve after save — F01, F23 | Paperless-ngx documents document search and download; Nextcloud documents file browsing/access. | F01 has a partial save-to-find handoff; F23 records local download/ZIP/directory paths as partially connected. | Connect confirmation to the existing search and exact-original takeout; avoid a new content authority. |
| OCR for scanned documents — F05 | Paperless-ngx documents OCR for searchable document text. | F05 is admitted for image text only; scanned-PDF OCR is explicitly not in this delivery. | Keep the boundary visible. Do not infer scanned-PDF support from the comparison. |
| User tags and editable metadata — F07 | Paperless-ngx documents tags, document types and custom fields; Karakeep documents user tags. | F07: Notes, multiple user tags and Favorite are available; batch add/remove is partly connected. | Reuse Notes and Annotation.TAG; custom fields and another metadata model are not selected. |
| Duplicates and preserving the original — F25, F24 | Paperless-ngx FAQ documents duplicate handling and preservation of the original alongside a PDF/A derivative. | F25 marks whole-file exact deduplication available; F24 is a bounded recovery implementation with local evidence. | Cairn's identity remains complete-byte SHA-256 plus length. Derivatives or similarity never replace or authorize deletion of the original. |
| Export one or many originals — F23 | Paperless-ngx documents document download; Nextcloud describes file access through its web interface. | F23 marks single-original, ZIP and directory takeout as locally connected, and a frozen current flat result as available. | Finish the verified takeout journey and explain unique-file behavior. Do not copy source-tool export formats. |
| Rebuild or restore after loss — F24 | The cited comparison pages describe product usage, not Cairn-compatible authenticated recovery. | F24 has bounded import/reader and catalog-rebuild evidence; paired clean-install journey remains unproven in the snapshot. | Continue the existing signed portable-record closure. Competitor UX is not recovery evidence. |
| File access UI — F02, F22 | Nextcloud documents browser-based file navigation and access. | F02 shared navigation/scope and F22 pagination/return behavior are locally partial. | Reuse Cairn's loaded scope and selection; no mount, cloud sync or multi-user sharing feature is implied. |

## Search and retrieval

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Search names and file/type facets — F03 | Paperless-ngx documents query and filtering over stored documents; Immich documents search over photo content and metadata. | F03 lexical/structured filename, type and tag conditions are available, with coverage gaps recorded. | Fix demonstrated missed fields and explain filters; do not add a second query authority. |
| Search user Notes and extracted text — F03, F04 | Paperless-ngx documents OCR-backed text search; Karakeep documents full-text search for saved pages and notes. | F03 Notes/body matching is locally connected; F04 PDF/DOCX extraction and matched source are marked available with local flow evidence. | Close observed query or source-display gaps using current EXTRACT and Notes behavior. No new index dimension. |
| Search by meaning — F03, F04 | Immich documents contextual image search; Karakeep documents semantic search for saved content. | F03 has real local BGE evidence but incomplete corpus coverage; F04 semantic query has local model evidence. | Local BGE remains the intended default discovery profile; make readiness explicit and retain lexical fallback when it is unavailable. |
| Search words in image screenshots — F05 | Paperless-ngx documents OCR-backed search for documents; its evidence does not establish image-text UI equivalence. | F05 has local OCR recognition evidence and a connected searchable text/quality display. | Close only user-facing visibility/findability gaps. Scanned-PDF OCR and arbitrary historical reprocessing remain excluded. |
| Search images by description or reference image — F06 | Immich documents contextual CLIP search; the cited page does not establish reference-image query equivalence. | F06 has local Chinese-CLIP profile evidence and connected text/reference-image query, result view and original takeout. | Preserve separate BGE and image spaces. No face or video index is selected. |
| Show why a result matched — F03, F04, F05 | Paperless-ngx and Immich document search experiences, but the cited pages do not guarantee Cairn's provenance display. | F03 search-control explanation is partial; F04 matched segment/source is marked available; F05 OCR quality has a UI entry. | Prefer matched source/segment and model availability already in the contract; do not invent a provenance subsystem. |
| Saved searches and reopening results — F08 | Paperless-ngx documents saved views; Immich documents filters and search. | F08 save/recall/edit/duplicate and multi-page recall are locally connected; dynamic SavedView and fixed material list are distinct. | Improve supported conditions and clarity. Do not turn every transient filter into saved-query semantics. |
| Keep browsing position and selection — F02, F22 | Nextcloud documents browser navigation; Immich describes timeline/library browsing. | F02 selection/scope and F22 browse/return are partial or locally connected. | Repair return-to-context gaps within the current host scope; no new query or state authority. |
| Search when a model is unavailable — F03 | Reference products document their own search behavior; they are not evidence for Cairn's degraded-state semantics. | F03 records an existing non-model fallback. | Keep lexical/structured retrieval usable and state `NOT_BUILT` or `UNAVAILABLE`; semantic search is not an exact-save prerequisite. |

## Photos

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Browse a photo wall with date and tag filters — F14 | Immich documents timeline browsing, metadata filtering, map and people-oriented features. | F14 wall/date/tag filtering is partial. | Close useful browsing gaps over existing photos/search scope; map and face experiences are explicitly not selected. |
| Search photos with natural language — F06, F14 | Immich documents natural-language search and image understanding. | F06 has local CLIP evidence and query connections; F14 is the Photos presentation. | Keep real local model readiness visible and use the admitted image profile only; no remote inference or face recognition. |
| Open an image and return to the same place — F14 | Immich documents photo viewing and timeline navigation. | F14 continuous viewing/full-screen/return has local partial flow evidence. | Polish the viewer and preserve host position/selection; do not duplicate photo records. |
| Exhibition or timed slideshow — F14 | Immich documents photo sharing/viewing features; no competitor behavior is asserted here for Cairn's exact exhibition flow. | F14 exhibition/timed playback is locally connected. | Keep the existing bounded presentation; do not expand into an album persistence model. |
| Select and take out photo originals — F14, F23 | Immich documents photo downloads/exports; Paperless-ngx documents document download. | F14 multi-select/original/ZIP is locally connected; saving a photo selection through an ordinary list still needs the Photos entry integration. | Connect selection to ML-1 and existing frozen takeout. Map, editing, native camera-roll sync and automatic albums remain unselected. |

## Music

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Browse by track, artist, album and year — F15 | Navidrome documents library browsing by artists, albums, songs, genres and related music metadata. | F15 track/artist/album/year browsing is partial, using existing audio facts. | Complete the admitted Music browse surface from current facts; no second media catalog. |
| Play originals across page changes — F15 | Navidrome documents browser playback and player continuity as part of its music-server experience. | F15 verified playback/progress/volume and cross-page continuity are locally connected. | Retain host-owned verified playback and byte/read ceilings. Cairn does not claim streaming/transcoding service behavior. |
| Queue append, reorder and repeat/shuffle — F15 | Navidrome documents playlist and playback functions. | F15 queue controls are locally connected but UX remains to converge; UX-Q1 allows transient distinct occurrences within its ceiling. | Finish one bounded transient queue. No persisted playlist database or service API. |
| Play a saved ordinary material list — F10, F15 | Navidrome supports music playlists; its persistent playlist model is distinct from Cairn's ordinary snapshots. | F10 ML-2 can play/append supported audio occurrences in order, including repetitions; F15 Music entry remains partial. | Integrate the reader action into Music. Do not represent JSON material lists as native albums/playlists. |
| Save or export a music selection — F09, F10, F15 | Navidrome documents playlists; Paperless-ngx's saved views are a different kind of query. | ML-1/ML-2 save/reopen/play and unique-file takeout exist in the snapshot; direct Music entry is partial. | Reuse ordinary material lists and existing export. Repeated targets export once; playback occurrence order is separate. |
| Lyrics, cover enrichment and transcoding — F15 | Navidrome documents cover art, lyrics and transcoding-related server capabilities. | F15 marks cover completion/transcoding/lyrics/play statistics as not fully covered and not all in scope. | Do not add a media server or enrichment pipeline in this function pass. |

## Lists, Notes and AI-assisted use

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Save selected files with their Notes and tags — F09 | Karakeep documents user lists and tags for grouping saved links. | F09 ML-1 selection plus copied Notes/TAG context is marked delivered. | Use an ordinary `cairn.material-list.v1` JSON capture; no durable list head or membership service. |
| Preserve order and repeated occurrences — F09, F10 | Karakeep documents list organization; its page does not establish Cairn's exact occurrence semantics. | F09 order/repetition and F10 ordered playback occurrences are marked delivered. | Keep playback order/repetitions; ZIP takeout deduplicates unique file targets and does not promise occurrence order. |
| Hand context to an external AI and import a candidate — F09, F12 | Karakeep documents AI-related content assistance; its docs do not define Cairn's explicit copy/paste boundary. | F09 external copy/import candidate is delivered; F12 external copy/paste exists. | Preserve user-controlled transfer and reviewed save. This is not integrated AI execution. |
| Reopen a list and expose unresolved members — F09, F10 | Karakeep documents reopening lists; Cairn's unresolved-scope policy is its own contract. | F09 reopen/invalid-member behavior and F10 whole-list unresolved disabling are marked delivered. | Resolve against current loaded catalog; show unresolved members rather than silently dropping them. |
| Freeze a Skill text snapshot with the list — F11 | Competitor sources do not document this Cairn-specific use of reusable instruction text. | F11 ordinary Skill text is selectable and frozen to a material list. | Close genuine correction-to-next-use handoff gaps; do not add a Skill database or runtime plugin. |
| Review and save an AI-proposed list — F12 | Karakeep documents AI assistance for saved content, including generated tags/summaries in its product docs. | F12 native model organization and candidate references/reasons/review are unimplemented; saving can reuse F09 once available. | Treat as a separately admitted future client function. No weighted attributes, web verification, automatic refresh, or agent platform in this comparison. |
| Let a small program read a saved list — F13 | Karakeep exposes lists through its product/API surface; this is not evidence that Cairn should add an API or SDK. | F13 ordinary JSON is available; a standalone consumer example and clear local-reference/authorization/expiry semantics remain partial. | Prefer documentation and one small example over a new endpoint, SDK, database, or real-time subscription. |
| Keep reading/research items together — F18 | Karakeep documents bookmarking, lists, tags, search and browser/mobile capture. | F18 URL/text/file capture and ordered-list composition are available through ordinary content and lists; return-to-link is partly manual. | Demonstrate Notes plus material lists. Browser extension, page snapshot and automatic tab closure are not selected. |
| Use an AI client to find and take out files — F21 | Competitor docs describe their own APIs/clients; they do not establish Cairn's future AI access contract. | F21 typed query/takeout exists below the client; external AI client connection and ambiguity-to-choice journey are not delivered. | Deferred under convergence. No MCP/CLI/integrated executor, remote pairing, live file mutation or deletion is admitted here. |

## Video

| Subfunction / Cairn F key | Reference behavior documented by the source | Cairn snapshot and smallest useful outcome | Gap / selection |
|---|---|---|---|
| Protect, find and download video originals — F17, F23 | A general content repository can preserve files; the cited video-oriented pages are not used to claim a competitor's exact recovery behavior. | F17 says generic save/find/download exists; F23 supplies existing original and frozen-export paths. | Retain the ordinary content loop and exact original takeout. This does not amount to a video player. |
| Dedicated video page and playback controls — F17 | Jellyfin is a relevant reference category, but its library documentation could not be verified in this source pass; no detailed behavior is attributed to it. | F17 dedicated video view/playback and pause/seek/return are not implemented or not connected. | Explicitly future. Do not copy a media-server surface without a separate admission and bounded read/format decision. |
| Episode/series automation, subtitles or danmaku — F17 | AutoBangumi's official site describes RSS/download/rename automation; it is not treated as a player or a Cairn capability source. | F17 marks season/episode/Bangumi/subtitles/danmaku as future candidates. | Retain as a decision-register concern only; no downloader, scraper, subtitle processor, or domain model is selected. |
| TV, music-video, co-viewing, transcoding and auto-download — F17 | No detailed competitor claim is made from the reviewed sources. | F17 explicitly lists these outside the current delivery. | Omit from active function issues; keep exact originals accessible through generic content takeout. |

## Important differences that remain visible

| Related mature capability | Cairn delivery decision |
| --- | --- |
| Nextcloud-style in-place folder rename, move/copy, trash, sync and sharing | Not equivalent: Cairn keeps original paths as provenance and uses content, tags, queries and selected output. In-place filesystem mutation, sync and multi-user sharing are not this delivery. |
| A full PDF document viewer and scanned-PDF OCR | F04 delivers bounded PDF/DOCX body finding and original takeout; F05 delivers image OCR. Neither establishes a dedicated PDF reader or scanned-PDF OCR. |
| Large-file playback and server transcoding | F15 currently plays supported fully verified downloaded originals up to 32 MiB. Larger/incompatible audio can be taken out; a broader playback contract would be a later functional successor, not a hidden promise. |
| Native photo albums, maps, faces, editing and phone background backup | F14 finishes the existing gallery/viewer/slideshow and ordinary selected-list reuse. These additional photo functions are not all implemented or selected. |
| Rich metadata, cover/lyrics enrichment and listening statistics | F15 reuses captured facts and honest unknown values; these richer music functions remain incomplete or unselected. |
| Query-backed smart lists versus regenerated AI results | F08 recalls supported dynamic SavedView queries; F09/F10 retain ordinary result snapshots. Automatic AI refresh and mutable current-list heads are not implemented. |
| Whole-layout source contributions versus arbitrary installed UI plugins | F16 has trusted compiled shells/pages plus narrow presentation-data admission. Token themes do not establish runtime third-party layout components or a marketplace. |

## Deliberately omitted scope

This document compares only functions that can inform Cairn's single-owner content, Notes, discovery, material-list, takeout and recovery journeys. It does not convert competitor offerings into active work for multi-user collaboration, shared links, cloud synchronization, email ingestion, hosted services, public APIs, generic plugin ecosystems, automated downloading, transcoding, or third-party runtime code. The kernel remains compiled first-party code; ML-1/ML-2 are client conventions only. MCP/CLI/AI-harness access remains deferred pending a direct scope decision. Rich collections, nested groups, persisted playlists, image-face indexing, video indexing and automatic grouping remain separately gated or unselected.

These exclusions preserve the underlying user concerns rather than erase them: phone capture, research return-to-link, optional home records, voice capture, video playback, interoperable list consumption, richer grouping and future AI-client access remain visible under F01/F13/F17–F21/F26 in the function-delivery source. They should advance only when an owner-selected journey and its admission/dependency are clear.

## Sources and evidence limits

Reviewed 2026-10-21. These are official product documentation pages, not independent tests. Documentation branches and “latest” pages can change. No competitor was installed or exercised hands-on. Cairn status is retained in the [function delivery plan](../superpowers/plans/2026-10-21-cairn-focused-delivery.md) and its linked source and local-journey records. It is not a live application check, release qualification, or substitute for normative requirements.

| Ref | Official source |
|---|---|
| P1 | [Paperless-ngx — Usage](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md) |
| P2 | [Paperless-ngx — Advanced usage](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/advanced_usage.md) |
| P3 | [Paperless-ngx — FAQ](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/faq.md) |
| K1 | [Karakeep — Bookmarking](https://docs.karakeep.app/using-karakeep/bookmarking/) |
| K2 | [Karakeep — Lists](https://docs.karakeep.app/using-karakeep/lists/) |
| K3 | [Karakeep — Tags](https://docs.karakeep.app/using-karakeep/tags/) |
| K4 | [Karakeep — Search query language](https://docs.karakeep.app/using-karakeep/search-query-language/) |
| K5 | [Karakeep — Quick sharing](https://docs.karakeep.app/using-karakeep/quick-sharing/) |
| K6 | [Karakeep documentation home](https://docs.karakeep.app/) |
| I1 | [Immich — Searching](https://docs.immich.app/features/searching/) |
| I2 | [Immich — Features](https://immich.app/features) |
| N1 | [Navidrome — Features](https://www.navidrome.org/docs/usage/features/) |
| N2 | [Navidrome — project feature overview](https://github.com/navidrome/navidrome#features) |
| NC1 | [Nextcloud — Files web interface](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webgui.html) |
| AB1 | [AutoBangumi](https://www.autobangumi.org/) |

Paperless-ngx documentation was read from its `dev` branch; Karakeep and other documentation pages are live references. Nextcloud's `latest` page may describe an upcoming documentation target, so no release-version claim is made. AutoBangumi is cited only for the site's stated RSS/download/rename automation category, not as a player. A Jellyfin library page was not available for verification in this pass and is therefore not used to substantiate detailed video features.
