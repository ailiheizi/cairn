# Home Video and Files Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The owner has retained Luna implementation and root decision/review ownership; proceed within this direct request without another approval round. Preserve unrelated changes; do not commit.

**Goal:** Make videos and ordinary files discoverable and useful directly from the existing private-space Home while keeping the Photos/Music composition quiet.
**Architecture:** Reuse the compiled Videos player's exact reader and transient lifecycle in a shared hook/stage. Home and Videos are mutually exclusive route mounts. Project ordinary files from the same loaded scope with existing Details and Library navigation.
**Tech Stack:** Existing React, TypeScript, CSS and lucide icons; no new dependencies.
**Spec:** Owner's 2026-10-28 request; home-video/files refinement in `docs/requirements/first-party-client-experiences.md`.

## Design and rationale

- Photos/Music retain the first row, hover split, pencil and bounded resizing.
- Below them, a responsive secondary row contains one video card and up to three ordinary-file rows. A single Library link remains; Home does not duplicate Library management.
- The video card uses a neutral film-shaped idle stage and true filename/format/size. Explicit Play reuses the existing full-original SHA-256/length-verified MP4/WebM player, at most 32 MiB. No autoplay, automatic original reads, fabricated poster, extracted frame, streaming or transcoding. The currently played frame may remain naturally visible while paused.
- Fresh/default preferences show Videos when the loaded scope contains video. Explicit saved visibility choices remain respected. Missing videos in legacy preferences gain the new default. Empty destinations do not occupy an idle card; editing may show their empty placeholder.
- Video and Files keep the existing pencil hide/add/save/cancel/reset workflow. Photos/Music remain the only resizable/reorderable pair. Entering editing, hiding the video card, changing identity/scope/workspace or navigating away cancels/disposes Home video. Re-enabling it never autoplays.
- Files means regular non-image/non-audio/non-video members of this scope: documents, notes, archives and other originals. Show name, known format and honest size; open existing Details and offer Library access. Do not claim chronological recency or fetch file bodies for snippets.
- Visible counts describe loaded scope only. Unsupported or oversized video retains clear Details/download exits. Disabled Videos pages do not gain a new playback path through Home.

## Global constraints / phase and acceptance

Single-owner content, description, discovery, export and recovery kernel; convergence phase. This is the admitted RW-PERSONAL-UX-1 client successor only, grants no core phase/release credit and adds no schema, endpoint, processor, index, runtime loader, persistent media state or test framework. Current byte/pixel/read/identity ceilings and separate host audio remain intact.

One shared acceptance owner (Luna QA, reviewed by root): `home-video-and-files`, reusing the real eight-file profile at 4670. No re-ingest, Linux work or broad regression. Implement the complete feature before this journey; investigate locally only for actual failures.

## Tasks

- [x] Luna implementation: extract shared video playback lifecycle/stage from `web/src/components/VideoLibraryExperience.tsx` into `web/src/app/useVideoPlayback.ts` and/or `web/src/components/VerifiedVideoStage.tsx` plus needed CSS, retaining Videos behavior. Keep `web/src/lib/videoPlayback.ts` verification unchanged unless a concrete defect is found and reported.
- [x] Same Luna implementation: update `OverviewExperience.tsx/.css`, `overviewPreferences.ts`, and overview/video i18n. Home shows video/files in the bounded secondary row, real metadata, existing Details/Library actions and editor controls. No main/server changes.
- [x] Root review/integration: inspect diff for shared lifecycle, identity tuple including length, no idle reads, explicit visibility preservation and quiet layout; build affected frontend once.
- [x] Luna single journey: with the retained real profile, see default video+files, explicitly play Home video with real progress, verify host-audio pause coordination, open file Details and reach Library, hide/cancel/save/reload/re-add video and files, confirm no video original read during idle/edit/re-add, and confirm dedicated Videos still plays through the same shared code. Repeat only failed affected steps. Capture actual Home and player screenshots; root reads them and runs `git diff --check`.

## Review focus

No idle original reads; saved false stays false; logical length remains part of identity; late/hidden/edited video is disposed; one video at a time and host audio coordination remains; actual file rows preserve host scope and exact Details target. These are checked in the shared journey and source review, not separate test campaigns.

## Executed evidence — 2026-10-28

Implemented for the stated local client scope. Root reviewed the complete diff, a fresh read-only review and actual Home idle/paused-video screenshots. The affected frontend build passed: `index-HwfZsYsQ.js` / `index-CI422rBr.css`. `git diff --check` passed. No backend, schema or reader changes were needed.

The one `home-video-and-files` journey reused the real eight-file profile at 4670. Fresh preferences showed video and the ordinary Files row. Idle/edit/re-add caused zero video-original requests; explicit play advanced a real video. Manual pause survived subsequent updates; host audio/video pause coordination worked. Editing/hiding/route exit disposed the preview, saved false survived reload and adding only Files, and existing Details/download/Library access worked for credits.md. The dedicated Videos page remained playable/pausable through the shared hook.

Before acceptance, review caught and fixed reference-dependent autoplay on ordinary rerenders, invalid-request fencing, and Home authorizing more video candidates than it displayed. No broad suites or duplicate reader-integrity campaign were run. The final paused-frame screenshot required one explicit additional playback for demonstration, not an idle/background read.

Local evidence: `dist/curated-media-20261027/evidence/home-video-files-report.md`, `home-video-files-idle.png`, and `home-video-files-paused-frame.png`. The running preview is `http://127.0.0.1:4670/#v=content&presentation=overview`. This evidence changes no core-phase or release qualification.

## Owner follow-up — integrated video entry card

The owner rejected the extra preview frame plus side controls on Home and asked for the same content-first entry treatment as Music. This supersedes the Home inline-playback presentation above; dedicated Videos retains the existing verified player.

- [x] Luna: replace Home's nested preview/info/play/download composition with one flat, whole-surface video entry card. Keep the current media/file placement and existing visibility preferences. Filename/content cue and a small arrow sit inside the same card; both pointer and keyboard activation enter the enabled Videos destination with the host scope retained. No separate Play/download controls, no Home video hook, no original/body reads, fake poster or new backend. Keep the Files list and Photos/Music composition intact.
- [x] Root/Luna: compile, then one `home-video-entry` journey on the retained 4670 real profile: no Home video read/player, card pointer/keyboard opens Videos, actual video play remains usable there, and pencil hide/cancel/save/re-add works without accidental navigation. Capture the changed Home and check the diff. No re-ingest, reader-integrity repetition or broad suite.

Reason: Home invites entry through the content; the destination owns its playback controls. A neutral graphic is the honest fallback because this profile has no admitted video-poster source. The latest request adds no poster extraction or background content-read authority.

Follow-up delivery evidence: the `index-B9i9ZpBu.js` / `index-B2Bvy0uR.css` build passed. Root reviewed the diff and actual Home screenshots; a read-only peer review found no blocking defect. The unused Home-only compact stage branch/styles were removed; dedicated Videos retains its full verified stage. `home-video-entry` passed with zero Home video-original requests, body/arrow/keyboard navigation into the same scope, edit/save/hide/re-add and exact preference restoration, disabled-destination handling, and one real explicit playback on Videos. No content was re-ingested and the existing reader was unchanged. Report: `dist/curated-media-20261027/evidence/home-video-entry-report.md`; screenshot: `home-video-entry-final.png`. `git diff --check` passed. No core phase/release credit follows.

## Owner follow-up — image-first Home and a mature video component

The owner requested a Photos-like video image/name with fewer controls and a mature player inside the destination. Reuse the existing verified-reader and workspace-scoped client session rather than adding a poster processor or media service.

- [x] Home (Luna): within `OverviewExperience.tsx/.css` and overview i18n only, replace the icon badge/kicker/format/size row with one image-first whole-card entry and one filename caption. Hover/focus may reveal a small arrow. Matching real session poster only; otherwise a quiet neutral graphic, never an unrelated photo. Preserve disabled/edit behavior, Files and Photos/Music.
- [x] Player (Luna): pin bundled `artplayer@5.4.0` in `web/package.json`/lock and retain vendor notices. Update `VerifiedVideoStage.tsx/.css` plus a focused first-party wrapper if useful. It receives only an existing verified Blob URL; retain one native video reference, host audio coordination, cancellation and destruction. Use built-in play/pause, seek, volume, speed, focused hotkeys, PiP (when supported) and fullscreen/web fullscreen. No plugins, remote URLs, CDN scripts, streaming/transcoding, resume ledger or new reader.
- [x] Same Player task: add `web/src/lib/videoPoster.ts` with `VIDEO_POSTER_SESSION_KEY = "verified-video-poster"`, `VideoPosterSnapshot = {identity:string,dataURL:string,width:number,height:number}`, and `videoPosterIdentity(workspaceID,hit)`. Reuse existing `useWorkspaceBrowseValue` for exactly one current-workspace snapshot, not a new cache/store or browser persistence. Capture at most one real already-decoded frame per explicit verified playback, preserving aspect ratio to at most 960px on either edge and JPEG <=256KiB (encoded URL <=350KiB). Validate live instance/URL/workspace before publishing; no seeking or additional playback/read for the cover. Home reads the same field and only displays an exact identity match (workspace, entry, digest, logical length). Workspace replacement and App exit use the existing session lifecycle.
- [x] Root: review dependency/lock, source lifecycle and image identity, integrate/build; one Luna `home-cover-player` journey on the retained 4670 profile. Verify no idle Home video reads, entry into destination, real playback/seek/volume/speed/fullscreen controls and scoped keyboard pause, host audio coordination, back-to-Home actual matching poster/name, edit/disabled navigation, disposal and no new external requests. Check one real original against the unchanged verification path; do not repeat old parser/processor suites or re-ingest. Root reviews actual screenshots and `git diff --check`.

Decision evidence: ArtPlayer's official option/event documentation supports the controls and focused hotkeys; npm registry reported 5.4.0 with bundled TypeScript definitions, one option-validator dependency and MIT licensing. Sources: https://artplayer.org/document/en/start/option ; https://artplayer.org/document/en/advanced/event ; https://github.com/zhw2590582/ArtPlayer/blob/master/LICENSE . Compiled vendor UI is a build dependency, not the rejected runtime plugin model.

This narrowly supersedes the previous blanket poster-extraction exclusion only for one transient still of an already authorized, verified, user-played video. There is no background or Home original read, persisted derivative, backend operation, processor, new video format, phase credit or release qualification.

## Owner steering — expand the content into its application

The owner accepted ArtPlayer and requested emotional continuity: Music and other content should enlarge into their dedicated experience rather than abruptly switch. Keep the player/poster work and add motion to the same delivery batch.

- [x] Luna motion: existing Home category entries (Music, Photos, Videos; Library when its existing wrapper permits) expand into the corresponding first-party surface; the app Home return shrinks into the matching card. Keep the shared header, one host audio element, loaded/search scope, URLs, history/deep links and existing browse-position ownership. Use the browser same-document View Transition API, no animation dependency, new page or duplicate live media. Motion is about 360–440ms and uses the actual source/destination rectangles; reduced-motion and unavailable API keep a correct immediate path. Rapid interaction skips/settles old motion without duplicate navigation. Restore usable heading/card focus; do not intercept text input or interfere with menus.
- [x] Source ownership: new `web/src/lib/contentSpaceTransition.ts` and `web/src/styles/content-space-transition.css`; `main.tsx` only imports/helper and explicit UI navigation wiring (leave programmatic/hash restore immediate); `LibraryPageHost.tsx` and, if needed, `LibrarySurface.tsx` only neutral target markers/wrappers; `OverviewExperience.tsx` only origin markers and stable session spotlights. Do not touch the parallel player's files. Retain existing dirty work.
- [x] Reuse existing workspace browse session to retain the current Home random photo/music identities across a round trip, bounded to the current loaded scope. No persistent selection/index or new reads. This makes returning visibly lead back to the same content.
- [x] Merge into the single `home-cover-player` journey: observe real expansion and reverse transition with a short clip/mid-transition screenshot, correct Music/Photos/Videos destinations, no page reload or duplicate native audio, stable Home identity, and reduced-motion fallback. Validate changed paths only; no new suite or re-ingest.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition and https://react.dev/reference/react-dom/flushSync . Any synchronous React flush is restricted to the explicit browser-API navigation callback; never hash-restore effects or playback updates. Existing core phases and release gates are unchanged.

## Image-first player and continuous-space delivery evidence

Implemented for the bounded local first-party client. Root reviewed the complete dependency/code diff and actual Home/player/transition captures. Independent read-only reviews found no remaining blocker. Final build passed: `index-CJznqwlx.js`, `index-C6ZjSgsU.css`, lazy bundled `artplayer-CJ3YDZyQ.js`. The verified reader is unchanged. ArtPlayer's ordinary volume UI preference uses its own localStorage key; automatic progress resume is disabled.

The combined `home-cover-player` journey demonstrated real named card→surface and reverse geometry, stable header, preserved Home spotlights and native audio node/source with advancing time, and reduced-motion navigation. The player consumed one verified Blob; actual play/pause/seek/volume/rate/focused keyboard/fullscreen/PiP controls worked in the tested Chrome profile. Returning Home disposed video and showed the matching 960×540 JPEG (59,215 encoded characters) without another original read. Home idle still performs no video read.

One actual integration defect was fixed after the failed step: an absent poster must be passed to ArtPlayer as an empty string, not `undefined`. Only that constructor fallback changed between the motion/audio build and final player build. Existing passed motion evidence was reused. Some diagnostic driver retries were avoidable (incorrect event listener, early audio measurement, closed/hidden controls and premature context closure); their explicit read requests are reported honestly, including the initially unknown count. No source/catalog mutations or re-ingest occurred. Future component acceptance should keep one browser context through the whole user flow and prioritize Cairn-owned connections over repeated verification of vendor controls.

Report: `dist/curated-media-20261027/evidence/home-cover-player-report.md`. Root inspected `home-cover-player-artplayer-controls-dark.png`, `home-cover-player-home-poster-paused-dark.png`, and the native transition captures. `git diff --check` passed. This is local client implementation evidence, not streaming/large-media support, a closed core phase or release qualification.
