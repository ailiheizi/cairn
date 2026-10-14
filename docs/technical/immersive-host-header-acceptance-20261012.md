# Immersive host header — local acceptance, 2026-10-12

## Outcome and decision

**Implemented for the tested local client scope.** This continues
[UX-D1 §14](../requirements/first-party-client-experiences.md#14-ux-d1-full-page-photos-and-music-composition)
and [ADR-034](build-stack-and-architecture-selection.md#adr-034-focused-full-page-domain-layouts-over-shared-host-state).
It supersedes the header arrangement in the earlier
[full-page acceptance](full-page-domain-layouts-acceptance-20261012.md).

Photos, Music and Exhibition share one compact, sticky glass capsule. Its
domain navigation appears once; Photo wall/Exhibition choices stay beside
their content. The one global search opens on demand, while management,
settings, restore and trusted status share one menu. Overlays occupy no extra
layout rows. Connection failure/checking has a readable, wrapping row outside
the closed menu. The standard Library and management views keep their shell.

The operator's local Blog `Header.astro`, `GlassNavigation.astro` and
`glass-navigation.css` informed the translucent pill, spacing and selected
state. Their animation dependencies were not imported. The reason is practical:
domain content should lead, while shared navigation and tools remain easy to
reach. This refines the existing compiled presentation seam rather than
creating independent clients, routes or state authorities.

## Implementation and review

DeepSeek Harness used `sub2api / deepseek-v4.1-flash`, verified from retained
assistant source records:

- `session-49ef59a1-8620-4317-8913-fdea8035a5d7`: registry-derived navigation
  variants and focused content controls; completed with a report.
- `session-6068cdb2-7fb2-4b8d-ace2-f52dd301ffdb`: host capsule, disclosed
  search, shared navigation and shortcut wiring. Its transport ended with
  `SERVER 521` after implementation; a follow-up also failed before editing.

The root reviewer read the incremental diffs against the initial dirty tree,
then finished the browser-confirmed fixes: suggestions/history join the
overlay's flow, phone action sizing applies only to direct header buttons,
modal actions retain a visible return-focus trigger, and failures wrap without
crowding phone actions. No delegate diff was accepted without review. No
commits or staging were performed.

The nine client files changed in this refinement are `TopBar.tsx`, `main.tsx`,
`app/useSearch.ts`, `LibraryPresentationNavigation.tsx`, `LibrarySurface.tsx`
and `topbar.css`, `interface-frame.css`, `library-views.css`, `library.css`.
The search hook change only opens its native disclosure before focusing.
There is no new backend operation, schema, processor, runtime loader, dependency,
query authority or recovery format. Existing read/queue limits and verified
original playback remain unchanged.

## Executable evidence

Evidence is retained under `dist/immersive-header-20261012/validation/`.
The browser exercised the existing isolated local QA profile on port 4648;
operator content and configuration were not modified.

| Check | Result | Evidence |
| --- | --- | --- |
| Production client build | PASS | `build.log`: TypeScript + Vite, exit 0. Existing bundle-size warning remains. |
| Compiled routes/registry and translations | PASS | `registry-check.log`, `i18n-check.log`: aliases/conflicts/fallbacks; 26 catalogs, 1,882 keys, 81 client sources. |
| Broad practical Go check | PASS | `go-test.log`: `go test -tags purego ./...`, exit 0; cached results, no Go changes. |
| Light/dark Photos/Music at 390/1280 | PASS | Eight screenshots and `responsive-layouts.json`: no horizontal overflow, readable names, one domain navigation and one host input. |
| Intermediate width | PASS | `tablet-768.json`: actions fit and document width equals scroll width. |
| Native search and keyboard entry | PASS | `search-panel-390.json/png`, `operator-suggestions-390.json`, `search-keyboard.json`: visible history/suggestions; Command-K, Control-K and slash open/focus the existing field. |
| Search dismissal retains text | PASS | `search-dismiss-shortcut.json`: outside click and Escape from summary close the panel while retaining `na` and the current hash; Command-K reopens it. Existing field-specific Escape grammar is unchanged. |
| Settings return focus | PASS | `settings-focus-return.json`: closing Settings returns to the visible menu summary, not BODY or a hidden menu item. |
| Failure remains visible | PASS | `offline-390.json/png`: browser-only offline refresh shows `Unavailable`, disables Add/search and preserves document width with the menu closed. Network emulation was restored; refresh re-enabled actions. |
| Shared query across domains | PASS | `shared-query-scope.json`: `Tagged-test` returns two audio files; Photos shows zero photos and the unchanged returned scope/query rather than substituting a full-library query. Clear search remains reachable in Library tools. |
| Unsaved Notes protection | PASS | `notes-draft-guard.json`: actual browser confirmation was cancelled; Photos hash and unsaved text remained. QA draft was then cleared without saving. |
| Shared player and host navigation | PASS | `player-navigation-host.json`: one audio element, same Blob and paused position across Photos, Exhibition, Music, Sources and client Home. Management/Home revert to the standard shell. |
| Navigation during active playback | PASS | `active-playback-navigation.json`: the same source remains unpaused through Music → Photos → Music; time advances from 0.237653 to 0.942255 seconds. Playback was paused afterwards. |
| Direct Photos/Music boot | PASS | `direct-photos.json`, `direct-music.json`: old aliases normalize to focused pages with search initially closed. Existing preview tabs were explicitly reloaded to replace their old assets. |
| Served asset identity | PASS | `artifact-identities.json`: HTTP 200 and byte-identical index, JavaScript and CSS compared with the final build. |
| Whitespace check | PASS | Final `git diff --check`, exit 0. |

## Candidate and limits

HEAD is `3a46229c835cb52b8bc5442361a5caf1db120b42` with preserved prior
uncommitted work. `artifact-identities.json` records the dirty state and source
hashes. Final JavaScript is `index-BbruK3i4.js` (944,983 bytes; SHA-256
`8cc52abe47ca43203d771d193369a17b9b97c99e8fcc84238ef2b676d2d712ce`),
and CSS is `index-DQsIxXKv.css` (272,645 bytes; SHA-256
`48bf7695d1aec7a691475545712c88da40007b69c1af35ebd56c534f316c455a`).

These are local browser/client results, not core-phase or release qualification.
The QA profile has no real semantic bundle and honestly reports degraded
search; this test does not establish the default semantic capability. Album or
playlist persistence, streaming, processors, full interface packages and all
fault branches were not added or qualified. Existing original-download/read
behavior was preserved; the previous full-page acceptance retains its download
hash evidence. Real-device and screen-reader acceptance remains unrun.
