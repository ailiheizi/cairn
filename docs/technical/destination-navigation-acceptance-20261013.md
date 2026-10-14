# Dedicated destinations and stable navigation — 2026-10-13

## Outcome and boundary

Implemented and locally tested for the existing client. The active slice is
RW-PERSONAL-UX-1 UX-C1/D1 plus the ordinary API/WebUI browse contract.
[ADR-038](build-stack-and-architecture-selection.md#adr-038-explicit-app-destinations-with-one-stable-host-header)
records the product decision. No new media destination, endpoint, schema,
provider, processor, durable state or runtime extension is admitted here.

The operator identified AutoBangumi as the closer self-hosted vertical
reference and found returning from Photos/Music to All types confusing.
The shared host now presents explicit Library, Photos, Music and Overview
destinations with names, decorative icons and active-page semantics. The
same brand/search/add/utility header is used across Library and focused pages.
The ordinary Library toolbar no longer repeats the global destination
switcher. Photo wall/Exhibition remain within Photos; type facets remain
ordinary filtering. Library preserves the current returned query/tag scope;
the rail's existing full-listing action is labelled All content.

Workspace/showcase remain the selected ordinary content frames. Photos/Music
remain immersive. Desktop Library keeps its single inline rail; focused and
compact layouts expose their rail through the menu. Search reuses the existing
one form, state and keyboard disclosure behavior. The root changed no route,
query, draft, selection or playback policy. Existing deep links still resolve.

Two local Luna agents implemented disjoint navigation and header scopes. The
primary reviewer inspected the dirty-tree baselines, deltas and final images,
and integrated `main.tsx`, the Library toolbar and labels. Screenshot review
found an isolated phone Overview row; the final CSS reduces destination
padding while retaining 44px heights. No unrelated changes were removed and
no commit/staging was performed.

## Executable evidence

Luna's report is retained at
`dist/destination-navigation-20261013/validation/qa-final.md`, with scripts,
source/build hashes, served captures and the screenshot matrix.

- PASS: final Web build, i18n/registry checks, practical broad Go suite and
  whitespace checks. Go ran once; the final CSS correction did not rerun it.
- PASS: served JS/CSS match `web/dist` exactly. Final JS is
  `index-DckYok-g.js` (`cf7a149f4902b791e2c2a8b3da3af86433812fbae76942eb5b53d9d74bd30df3`);
  CSS is `index-CmPHFcWv.css`
  (`a1645e7818eef637a99bbd9c874367927fafd7fd869c3e0290695660264c03f9`).
- PASS: Meta+K opens the search disclosure. Text survives close/reopen and
  Library→Photos→Library. One deliberate search issues exactly one
  `search.query`; switching destinations adds no query. Favorite filtering
  survives all three destinations with zero new search calls.
- PASS: the same decoded Blob original (`duration=2s`, `readyState=4`)
  remains playing through Music→Library→Photos→Music. Cancelling the unsaved
  Notes prompt preserves the draft and route. Sources, Settings and fresh-page
  legacy Photos/Music links remain usable.
- PASS: twelve clean default images cover three destinations at 390×844 and
  1280×800, each light/dark. At 390, all four destinations share one 44px row;
  there is no horizontal overflow. One header/search owner remains. Desktop
  Library has one rail; focused pages have no inline rail. Two additional
  Showcase images check the narrower Library frame at the same widths.

The old local preview stopped during acceptance. The retained fixture binary
and config hashes matched the earlier full-page acceptance. Its original
fixture launcher used six explicit `CAIRN_*` path overrides: the config itself
contained platform defaults. The restart restored those exact absolute
fixture paths before use; it did not use the owner's default store, re-seed,
initialize a catalog, rebuild the binary or migrate data. The existing
twenty-item development profile was retained and the preview remains on 4648.

## Limits

Evidence uses isolated headless Chromium with the already installed Playwright
and local Chrome. CUA remains unavailable; this is not native desktop or
real-device qualification. The fixture has no real default semantic bundle.
Full media/failure matrices, history-navigation behavior beyond fresh direct
links, large-library performance and release qualification were not awarded.
AutoBangumi acquisition, native video, Bangumi and danmaku remain candidates
in the research document, not capabilities delivered by this navigation slice.
