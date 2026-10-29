# Private Space Focus Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve all earlier uncommitted work and do not commit.

**Goal:** Restore the owner's selected private-space concept faithfully in the actual client, showing one photo and one playable music feature rather than a management dashboard.

**Architecture:** Existing Overview, host search/intake and verified media actions; client-only composition. Phase: admitted first-party client parallel to Phase 4/5. Requirement: UX-C2/H1, refined by the owner's explicit 2026-10-27 request. Exit: one `private-space-focus` browser journey.

**Design selected by owner:** The supplied screenshot and `cairn-variant-spaces.html` in the task visualization directory. Follow its spacing, green/ivory palettes, plain brand/search/add header, split photo feature, record-style music card, and quiet Library/material footer. The owner explicitly said implement this first, discuss additional functions afterward; no further design approval is needed.

## Owner correction: direct layout editing

The owner rejected the completed heading form and the copied Library-tools
disclosure. Supersede the earlier form-related items below: keep a pencil entry
and edit the actual cards, with bounded draggable width, draggable media order,
on-card hiding and a small menu for re-adding existing hidden blocks. Materials
stays in the footer. There is no new widget or domain capability. Legacy local
preferences stay readable; the old heading is no longer rendered or edited.

- [x] Luna replaces the form and its dead styles with direct editing; reuse
  workspace-local preferences for photoShare (35–75 percent), order and visibility,
  explicit save/cancel and graceful unavailable storage. Root reviews the diff.
- [x] Remove idle Home's Library-tools footer; existing Library management and
  active scope/error controls remain reachable.
- [x] Build once integrated and run one continuation of `private-space-focus`:
  pencil → resize → reorder → hide/re-add → cancel → save/reload → ordinary hover
  and playback. Capture normal/editing screenshots. No broad regression suite.

**Correction delivered:** Build `index-xLEeiusx.js` / `index-CAu9apcz.css` passed
compilation and the named browser continuation. Actual pointer resizing, native
drag swap, resizing with Music first, hide/re-add and cancel worked. Saved
order/proportions survived reload, and normal hover/playback resumed afterward.
The photo/track stayed stable through editing; a new random pick after page
reload is expected and is not persistent content organization. The same
acceptance/review reports below contain this evidence. No backend suite ran.

The following completed entries record the earlier delivery and are not an
endorsement of the now-superseded form interaction.

## Global constraints

### Cross-page design direction after Home acceptance

The owner accepted the private-space composition and reported a visual break
on entering the existing domains. Keep one Cairn shell: stable header actions,
consistent typography, gutters, surface colors and inspector/intake treatment.
The canvas must reach the viewport edges; constrained inner content is
intentional. The reported top strip was a collapsed child margin, repaired by
establishing the Home shell's own formatting context.

| Existing destination | First view and main task | Reveal on demand |
| --- | --- | --- |
| Home | Few content categories, one photo and one player; quiet pencil entry | In-place layout controls |
| Photos | Image wall; compact local search; open a photo into the existing immersive viewer | Format/tags/timeline/density; selection actions |
| Music | Recorded track/artist/album browsing and the existing verified player | Detailed filters/sort and the transient queue |
| Library | Find files in a clear result list and inspect/take out originals | Bulk tag/export actions on selection, secondary view/filter tools |
| Details / Add | Existing shared inspector or staged-intake drawer, with preview and primary action first | Notes, tags, facts and secondary diagnostics |

Suggested next delivery order: unify the shared shell, then refine Photos and
Music bodies with their existing functions, then reduce the Library control
stack. These are design proposals, not claims of completed work or admission
of saved albums, persistent playlists, streaming, widgets or new data access.

- Single-owner content/discovery/export/recovery core; convergence only. No new schema, endpoint, processor, runtime loader, dependency, or test framework.
- First paint shows one photo, one music card and Library/material entry. Remove visible batch actions, tag/format badges, counts, tables and configuration scaffolding from Home. Existing functions remain reachable in domain pages or intentional disclosures.
- Choose a random eligible photo and audio item from the current loaded authorized scope. Keep each selection stable through hover, preference edits and player updates; scope changes may select again. Never autoplay or read more content on hover.
- Render one verified photo thumbnail only; use existing host music metadata and one verified audio player. Play/Pause reflects the exact matching host playback tuple/status. No fake titles, durations, covers, recency or claims of whole-library coverage.
- Desktop hover/focus expands the photo/music card by reallocating the shared row width. No overlay or scale-only imitation. No oscillation, clipped essential controls or unbounded layout shift. Reduced-motion and no-hover input retain usable static cards.
- Homepage preferences remain available on demand, with title/visibility/save/cancel and ordering of the two media features. Materials remains in the fixed footer with visibility only. Remove preview-count controls because this surface now always spotlights one item. Existing stored counts may be ignored without changing content.
- Keep current query/filter/partial-list/error states truthful and visible when applicable. Empty/default Home should not mount general management bars; never CSS-hide actual errors or unresolved selection work.

## Task 1: Actual private-space scene (Luna)

Files: OverviewExperience.tsx/css, OverviewHomeEditor.tsx, overviewExperience i18n, optional overviewSpotlight helper. Add optional `queueControls?: MusicQueueControls` to Overview props; host will supply it. Existing `renderThumbnail`, `onNavigate`, `onOpenHit`, `onPlayTrack` remain authorities.

- [x] Recreate the selected layout, bounded random spotlights and record artwork with real track name/facts and Play/Pause.
- [x] Reallocate sibling width on hover/focus; preserve stable choices, reduced motion and text overflow.
- [x] Move home editing into an understated footer disclosure, remove count controls and management UI, retain honest empty/disabled exits and at most two ordinary material links below.

## Task 2: Quiet host shell (Luna)

Files: TopBar.tsx, new PrivateSpaceShell.css, LibrarySurface.tsx, LibraryPageHost.tsx, main.tsx, only additive homepage strings in a new i18n module if required. No touching Task 1 files.

- [x] For active Overview only, add `cairn-private-space` app-shell class, plain brand/search/add header matching reference (no domain capsule). Reuse the existing single search form with assistance on focus/interaction; keep navigation/settings behind one discreet menu.
- [x] Suppress the empty-home general tool/favorites strip, leaving active query/filter/load/error and selection outcomes available. Put general library tools in an intentional footer disclosure.
- [x] Pass existing musicQueueControls as Overview queueControls; no new player or data request.

## Task 3: One integrated acceptance and visual review

- [x] Build after integration, then Luna runs private-space-focus using retained isolated port4663 profile. Check exact one photo/track, hover reallocates width and restores, no extra reads on hover, play/pause uses host, photo/music/Library entry, visible search and Add open existing flows, edit remains on demand, active no-result scope and empty states remain clear.
- [x] Capture settled light/dark desktop screenshots and compare directly with the chosen concept. Root reviews changed diff and screenshots; diagnose only actual failures. Run git diff --check, record evidence; no broad tests or core milestone claims.

## Evidence

Implemented for the admitted client scope on 2026-10-27. `npm run build` and
`git diff --check` passed. The named `private-space-focus` browser journey ran
against the retained isolated synthetic library on port 4663: stable card
identities, sibling width reallocation, explicit verified playback/pause,
domain and Library navigation, Enter search, intake open/close, and local
heading save/reload/reset. Materials-only visibility was checked after the
review correction. Photos are synthetic test patterns and audio is a short WAV;
this is UI evidence, not a media-catalog or semantic-profile qualification.

Reports and screenshots: `.superpowers/sdd/2026-10-27-private-space-focus/acceptance-report.md`
and `review-report.md`. Root inspected the actual default and expanded desktop
screenshots and the changed source. Follow-up fixes were limited to observed
caption sizing, the inert Materials reorder/empty state, and light-header CSS
precedence. No backend suite was run and no core phase/release credit is claimed.
