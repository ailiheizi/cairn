# Editable Private Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the chosen private-space homepage usable and editable in the real frontend.

**Architecture:** Recompose the existing Overview, consuming the same host scope and actions. A small local preference model drives three built-in blocks; the host retains routing, query, selection, media reads and playback.

**Tech Stack:** Existing React/TypeScript/CSS, browser localStorage.

**Spec:** `docs/superpowers/specs/2026-10-26-editable-private-space.md`

## Global Constraints

- Single-owner content/discovery/export/recovery core; convergence and admitted first-party client only.
- No new endpoint, durable domain schema, processor, runtime loader or test framework.
- Preserve unrelated changes; no delegate commits. Report conflicts instead of broadening scope.
- Phase: first-party client parallel to Phase 4/5. Requirement: UX-C2 and the owner's editable-home successor. Exit: private-space-home browser journey.
- One acceptance owner after implementation; no separate per-component suites.
- Existing six-row/photo budgets and host identity/action boundaries remain.

## Review Focus

- Malformed or blocked localStorage must not break the page or falsely claim persistence.
- All blocks hidden still permits edit/reset and Library navigation.
- Filtered/partial scope must never be labeled complete or recent.
- Disabled domain routes stay disabled; explicit deep links keep their meaning.
- Preview count changes preserve host row identity and limit playback to displayed rows.

### Task 1: Editable private-space experience

**Files:** `web/src/components/OverviewExperience.tsx`, `OverviewExperience.css`, `web/src/i18n/overviewExperience.ts`, new `web/src/lib/overviewPreferences.ts` and optionally `web/src/components/OverviewHomeEditor.tsx`.

**Interfaces:** Keep `OverviewExperienceProps` host contract unchanged. New preference module exports typed defaults, normalization and browser read/write helpers; editing remains internal to Overview.

- [x] Recompose Photos/Music/material previews using real host data and the selected reference at `/Users/macos/.codex/visualizations/2026/10/05/01a10ab4-72f2-7252-830b-e88650adc788/cairn-variant-spaces.html`.
- [x] Add bounded local preferences and the explicit editor; reuse existing selection/Details/player actions with progressive disclosure.
- [x] Review empty/disabled/missing facts and local preference failures; report changes for integration. Do not run separate suites.

### Task 2: Host integration and one acceptance

**Files:** Existing `web/src/lib/libraryViews.ts`, `web/src/components/LibraryPresentationNavigation.tsx`, `web/src/app/useViewMode.ts` or existing route seam, `web/src/main.tsx`, affected frontend translations; `docs/requirements/first-party-client-experiences.md`.

**Interfaces:** Existing Overview mode/route and renderer; existing enabled-page preferences; Task 1 props unchanged.

- [x] Admit the bounded editable successor in UX-C2; distinguish Home from Library and use focused host composition.
- [x] Default only a genuinely unqualified launch to enabled Home, preserving explicit route restoration and query state.
- [x] Build once, then have one Luna acceptance owner run private-space-home and return screenshots/evidence. Root reviews the changed diff and screenshots, fixes actual failures, and runs `git diff --check`.
- [x] Open the verified frontend for the owner and describe working features and browser-local limits without claiming core milestone completion.

## Delivery evidence (2026-10-26)

Implemented for local desktop use, not release-qualified. `npm run build`
passed on the final frontend (`index-CMRSF0T8.js`). The `private-space-home`
Chrome journey passed against the isolated ordinary-capture fixture on port
4663: edit/cancel/save/reload/reset, bounded previews, domain navigation,
retained search scope, Library reload, actual material body, verified WAV
playback, empty results and all-hidden access. A focused follow-up verified
literal custom headings and session retention after a simulated home-preference
storage quota failure. Code review findings were fixed and re-reviewed.

Screenshots are in the ignored local evidence directory
`dist/save-find-takeout-20261026/evidence/home-*.png`; the fixture uses generated
QA images/audio/material, not personal media. Layout preferences are local to
this browser and workspace. Earlier unaccepted save/find changes remain a
separate batch; this result does not claim M2/M3 or core phase completion.
