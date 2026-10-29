# Video Viewing Room Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and Cairn testing. Luna implements; root decides and reviews. Implement the whole feature before one integrated browser journey. Delegates do not commit.

**Goal:** Find a video in the current loaded library, watch it in a focused room, explicitly switch to another supported original, and reach Details/takeout without a row of permanent management controls.

**Architecture:** Refine the existing compiled Videos destination. Keep the existing verified-video hook, ArtPlayer, workspace client session, host Details/download actions and shared scope. Search and sorting are presentation projections only.

**Tech Stack:** Existing React/TypeScript, CSS, lucide icons and bundled ArtPlayer; no new dependency.

**Spec:** [First-party client experiences](../../requirements/first-party-client-experiences.md), especially the curated video/image-first player refinement and continuous-space expansion; existing content-store identity and takeout requirements.

## Decisions and constraints

- The owner delegated feature selection and requested continued functionality. Root selects this existing surface because it currently offers only unfiltered file rows; Music queues and Photos viewing/list workflows already have implementation evidence.
- Phase: admitted personal-client convergence alongside Phase 4/5. Requirement: bounded Videos over shared current loaded content, explicit fully verified MP4/WebM playback up to 32 MiB. No core phase/release claim.
- Preserve all pre-existing dirty work. No new surface, backend route, durable schema/state, processor, index, runtime loader, integration or test framework.
- Search filename within loaded videos; sort loaded order/name/size. Clearly distinguish empty library from no local matches. Reset local filters directly. Browser-session values use existing browse ownership.
- Pass the whole host scope and complete loaded video candidates to the playback hook. Local search/sort must not cancel or redownload valid playback. Actual scope/workspace changes retain existing cleanup.
- Make the selected video, one play/resume action, and compact previous/next controls primary. Previous/next are explicit and only consider supported visible videos, with truthful ends/counts; no automatic queue or autoplay on entry/filter/sort. A hidden playing item stays visible in the stage with a clear way to reveal it.
- Preserve unsupported/oversized rows and their exact Details/original exits. Put secondary actions in keyboard-reachable disclosures; no invented poster/artwork/metadata. Reuse only the identity-matched one-session video still.
- No original reads until explicit playback/download. Replaying a ready current original reuses its Blob. Switching cancels/replaces the existing preview normally; no prefetch/cache/streaming.
- Desktop first. Keep shared green/ivory shell, existing card expansion, reduced-motion behavior, focus and visible failures. No separate media state machine.

## Task 1: Complete the Videos flow

**Allowed files:** `web/src/components/VideoLibraryExperience.tsx`, its CSS, and existing `web/src/i18n/videoExperience.ts`. Root additionally authorizes the one-line `ClientBrowseDomain` union extension in `web/src/app/ClientBrowseSession.tsx` for `videos`, so query/sort use the same result-scoped preference ownership as Photos/Music. The single video poster remains workspace-session owned. Read hook/stage/session contracts; do not edit their identity or read implementation without reporting a concrete conflict.

- [x] Add loaded-scope search/sort, result counts, clear/reset and honest empty/filter states.
- [x] Compose the existing player as the main content with a compact selectable film list; keep idle entry paused and avoid automatic reads.
- [x] Add explicit previous/next, current/hidden-current context and reveal-current action; keep current player intact across local projections.
- [x] Move per-file Details/download to on-demand controls, retaining supported and original-only paths.
- [x] Root and an independent reviewer inspect the final source diff; resolve actionable integration defects.
- [x] Build once, then run the single named **find/watch/switch/takeout** journey. Diagnose actual failures only.

## One whole-feature journey

Reuse the existing local browser environment/helpers and retained originals. Enter Videos from Home with no video read. Search/sort/reset loaded results, explicitly play a real retained supported video, pause/seek, hide it with a local filter and verify the same native element/Blob/position, reveal it and resume without a second original request. Where a second retained supported member is available, explicitly switch previous/next and observe the new exact source; a single-member scope honestly disables these actions. Reach Details and download one original, comparing complete bytes to its independently retained source. Return Home with the matching bounded poster and no remaining video element. No model, backend-wide, Linux or vendor-library test campaign.

## Review focus

Local filtering must not replace the authorized read scope or destroy playback. Hidden-current navigation must never choose an arbitrary invisible member. Unavailable rows retain original takeout. A currently ready video action must not trigger another download. Search/sort/menus and errors remain keyboard reachable.

## Delivery record

Implemented and locally exercised on the real eight-file curated demo at `http://127.0.0.1:4670/`. Build passed: `index-CSpTGXGt.js` / `index-sNslXr7N.css`; ArtPlayer chunk remains `artplayer-CJ3YDZyQ.js`. Root read the final source and screenshot; independent Luna review approved after neutral state wording, in-flow action disclosure and result-scoped preference corrections.

The named journey passed: Home/idle Videos caused no MP4 read; filename search and both sorts/reset worked; explicit playback decoded the retained real 960×540 MP4; filtering it out preserved the same native element, verified Blob and paused ~1.19-second position; reveal and Watch reused that source. Details opened/closed, one attachment download matched the independently retained 1,128,375-byte source and SHA-256 `0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451`. Returning Home disposed the video and showed its matching session still.

The demo contains one supported video: previous/next were correctly disabled. Switching between distinct video members and WebM decoding were not exercised in this journey. Those controls are implemented over the existing explicit reader; this evidence does not claim larger-media, streaming, full-film-library or release qualification. No new ingest, source mutation, model work, backend suite or vendor control campaign ran. Evidence: `dist/curated-media-20261027/evidence/video-room-report.md` and adjacent screenshots/download. README screenshots are documentation captures over the same current build, not another regression journey.
