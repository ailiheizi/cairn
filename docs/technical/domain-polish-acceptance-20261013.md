# Photos and Music polish — local acceptance, 2026-10-13

## Outcome and contract

This bounded client maintenance slice is implemented and locally tested under
RW-PERSONAL-UX-1 UX-P1/P2/M1/M2/Q1/D1. The product decision is
[ADR-037](build-stack-and-architecture-selection.md#adr-037-complete-existing-domain-journeys-then-review-a-personal-video-successor).
It adds no video destination, provider, backend route, schema, processor,
durable organization, runtime extension or recovery meaning. The core phase
order and all original-read, image, audio and queue ceilings remain unchanged.

Local Luna agents audited the current pages, implemented the two disjoint
component/CSS scopes, and performed integrated validation. The primary agent
reviewed the source/diffs and final images, requested fixes for overlay CSS
specificity, touch targets, disclosure focus and native checkbox keyboard
ownership, and accepted the resulting bounded changes. Existing dirty-tree
work was preserved; no commit or staging was performed.

Photos now has one domain heading, an explicit view-local count and a labelled
format disclosure that retains the active format. The default wall uses four
columns at the accepted desktop width and two on the phone. Names receive the
full caption width and a native title. Favorite and selection controls occupy
an image-corner overlay with 44px targets; selected cards remain identifiable.
Details, fallback, viewer, host indices/windowing and thumbnail budgets retain
their existing owners and behavior.

Music places its view-local count by the heading, joins browse modes and local
filtering in one toolbar, and places refresh beside recorded-facts status.
Queue actions precede the track list. Supported selection makes Play selected
primary; displayed-set actions remain in a native disclosure. Original names
remain reachable when recorded titles differ. Row selection uses a Tab-reachable
native checkbox button with Enter/Space ownership; the name control retains
the shared roving focus. The one verified host player and transient queue
remain unchanged.

## Executable evidence

Evidence is retained in `dist/domain-polish-20261013/validation/qa-report.md`,
with source/served identities, scripts and final screenshots. The isolated
existing development profile has twenty fixture items and uses no operator
content; no new fixture seeding or catalog mutation was performed.

- PASS: integrated `cd web && npm run build`, i18n (1,913 merged keys),
  page registry, practical broad `go test ./...`, and `git diff --check`.
- PASS: the index and served `index-CsgQ185G.js`/`index-3QbtdjE1.css` match
  `web/dist` byte-for-byte. SHA-256: JS
  `3cf642772f3f80f7e4be3a4997cfee90c4c12ef30b23ef7c9656c32a00a06a10`;
  CSS `35b3b63b82dea80384ec1be060da70beb020594f34b0c11507a96a9261c3bcb1`.
- PASS: actual Photos format/density, viewer next (asserted title change),
  explicit close, Details→Return and selection over the current host scope.
- PASS: Music local filtering and album browsing; Enter and Space each toggle
  the native checkbox without opening Details; explicit play and queue append.
  The browser decoded a verified Blob original (`duration=2`, `readyState=4`),
  and the same Blob source survived domain navigation.
- PASS: clean default layouts at 390×844 and 1280×800, each light and dark;
  no horizontal overflow on the phone. The eight `photos-*`/`music-*` PNGs
  show closed Details/viewer/queue and cleared transient selection/filter.

An initial QA capture retained Details/queue state and mislabeled two desktop
theme captures. Primary review rejected it as default-layout evidence. The
matrix was recaptured in clean contexts with the theme set before every shot;
prior action captures retain explicit names. A repeated header visible in one
prior capture did not reproduce in the clean queue/navigation flow: the DOM
contained one brand and one topbar. This is a non-reproduction finding, not an
unidentified source fix.

## Limits

Native CUA attachment was blocked. Browser evidence uses the repository's
already installed Playwright and local Chrome in an isolated headless context;
no framework or dependency was added. This proves local rendering/interaction,
not native desktop or real-device acceptance. The existing Vite large-chunk
advisory remains. Full codec/failure matrices, export requalification,
large-library performance, real semantic-profile qualification and release
qualification were not repeated or awarded by this client slice. Complete
albums/playlists and video/Bangumi/danmaku remain separate outstanding work.
