# Personal Experiences Local Acceptance — 2026-10-09

## Scope and identity

This record covers the first `RW-PERSONAL-UX-1` client cohort: dedicated Photos,
bounded original-audio playback and a transient queue, and daily SavedView
access. It is implemented local development work, not complete Photos/Music,
a media-server profile, a closed core phase, or release qualification.

- Active track: the admitted personal client cohort alongside Phase 4/5.
- Normative requirement: [first-party client experiences](../requirements/first-party-client-experiences.md), UX-P1, UX-M1 and UX-R1.
- Exit journey: retained image -> wall/continuous viewer -> return; retained
  supported audio -> explicit playback/controls -> client navigation -> stop;
  supported named query -> save -> refresh -> recall.
- Decision and limits: [ADR-025](build-stack-and-architecture-selection.md#adr-025-admit-dedicated-personal-client-workflows-without-a-new-media-service).
- Checkout: `/Users/macos/Documents/other_project/restoreweave`, branch `main`,
  base HEAD `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, dirty before this cohort.
  Unrelated changes were preserved; HEAD alone does not identify this build.
- Preview: `http://127.0.0.1:4648/`, original configured local catalog/repository
  and daemon candidate. Only the served browser build was replaced. Its web root
  is `dist/personal-experiences-20261009/web-dist`; reproducible launch arguments
  are in that directory's parent `start-preview.sh`.
- Source/build hashes and local logs are retained under
  `dist/personal-experiences-20261009/`. These are local evidence artifacts, not
  a release distribution.

Three Luna implementers owned disjoint Photos, Music and saved-retrieval
components. The primary agent owned admission, shared integration and browser
acceptance. No endpoint, durable schema, signed record, provider/profile digest,
second catalog or recovery authority was added. SHA-256 plus logical length,
STORE_EXACT, host authorization and existing typed operations remain unchanged.

## Implemented behavior

Photos supplies a distinct wall, density and loaded-format controls, shared
selection/Details, and a focused next/previous viewer with fit/actual-size
controls and Escape/focus return. It reads only existing bounded verified
previews: up to 48 automatic thumbnails at 1 MiB each and explicit inspection
at 8 MiB. It invents no EXIF, capture date, album or location.

Music supplies real track rows and one App-owned player, retaining identity,
play/pause, progress, seeking, volume, stop and a transient queue while navigating
the client. Explicit play requires a canonical loaded SHA-256 identity and known
logical length up to 32 MiB. A hard-bounded original read is checked for full
length and digest before a Blob is admitted to the native browser decoder.
Unsupported or unavailable playback retains Details/original access. Queue
add/remove/clear, previous/next and end-to-next are implemented; refresh clears
the queue. An active item must be stopped before removal.

Saved retrieval is reachable without selection or Export. Save previews the
submitted query and supported conditions; list/recall reuse existing SavedView
operations and workspace scope. Unsupported active filters refuse saving.
Recalled conditions that this editor cannot represent also refuse re-saving;
users can run a fresh supported search. Evaluation is lexical and dynamic,
not a frozen semantic result list.

Browser acceptance also exposed an intake defect: the client used zero new
unique bytes as proof of no work. A new filename containing already-saved bytes
was therefore unconfirmable. `useSources` now treats an executable capture as
empty only when its file count is zero. Applied, nonexecutable and unknown-outcome
guards still take precedence; confirmation uses the original digest-bound plan.

## Executable checks

| Check | Result and scope |
| --- | --- |
| `npm --prefix web run build` | PASS, TypeScript and final Vite build. Existing chunk-size warning remains; no runtime or performance claim follows. |
| `node scripts/web-i18n-check.mjs` | PASS, 1,678 merged keys and 59 client source files. See `i18n-check.log` for the output. |
| `node scripts/web-audio-playback-check.mjs` | PASS: canonical identity, verified length/hash/MIME, malformed identity and known oversize pre-fetch refusal, body ceiling/cancellation, mismatch and abort propagation. Mocks do not prove decoding. |
| `node scripts/web-client-preferences-check.mjs` | PASS for the existing bundled interface/preferences boundary; not a runtime third-party plugin test. |
| Source action-bar boundary assertions | PASS for duplicate-only, empty, blocked, awaiting/unknown and applied branches; real UI result is recorded below. |
| `go test -tags purego ./...` | PASS, 27 test packages. Run once for the integrated cohort; no backend code changed in this cohort. |
| `git diff --check` | PASS after integration; final documentation check is retained with the evidence. |

## Browser journeys

The existing QA source retained a 1x1 PNG, a short WAV and a Markdown file.
The browser upload/review/confirm flow then saved two generated 900x600 PNGs
and two generated 20-second mono WAVs. Their SHA-256/length inventory is in
`fixtures/fixture-identities.json`. These controlled samples establish behavior,
not representative personal-photo/music-library coverage or listening quality.

| Journey | Result and practical limit |
| --- | --- |
| Photos wall, density and PNG filter | PASS, the loaded three-image sequence remains connected to shared subjects. |
| Open -> next/previous -> return | PASS, generated PNGs decoded; final canvas removes duplicate inner chrome. ArrowRight moves to the next image, Escape restores focus to the opening card. |
| Photos at requested 390x844 viewport | PASS, visible wall/actions, document client/scroll width both 375 px after scrollbar allowance; screenshot retained. No full touch matrix claim. |
| Supported audio playback | PASS, native decoder reported 20 seconds; play/pause, seek to 19.9 seconds and volume changes were exercised. Physical listening quality was not assessed. |
| Player during Photos navigation | PASS, the same audio Blob and visible controls remained active. |
| Transient queue | PASS, two tracks, previous/next, ended advancement, stop/remove/clear. Clearing an idle queue hides the bar and leaves no source. Reorder/shuffle/repeat are missing. |
| Save and recall after refresh | PASS, `Quiet` with `suffix=wav`, named `Luna QA 音频样例`, recalled two lexical matches after a same-context refresh. Unsupported `type:audio` disabled save. |
| Duplicate-only intake with a new name | PASS, `Quiet-test-C.wav` has A's exact bytes; review offered confirmation, then reported 0 B new unique logical/content bytes and 625 KiB reused. Library grew from seven to eight named entries; A and C both remained visible. |
| New matching SavedView member | PASS, recall returned three matches after C was admitted. A subsequent refresh/recall showed the stored `Format: wav`; re-saving recalled conditions remained blocked. Separate browser-context access remains untested. |
| Music at requested 390x844 viewport | PASS, client/scroll width both 375 px, seek/play/pause/volume were operated and the queue panel remained within the page. Active queue removal was disabled until stop. |
| Bundled interface change | PASS, showcase -> workspace -> showcase retained the same loaded Blob, paused progress and duration, with reachable player controls. Photos navigation and final ended advancement to B also passed. |
| Final stop and clear | PASS, audio `src` removed and player hidden after queue clear. |
| Photos Details/original exit | Shared Details and original button reached. BLOCKED acceptance: the existing `_blank` attachment action produced no download event on the originating CUA tab within 15 seconds, with no visible application error. No resulting file was obtained for hash comparison; this is not a passed takeout journey or proof of a route defect. |

Screenshots are retained in `dist/personal-experiences-20261009/validation/`.

## Remaining product work

The [product todo](product-experience-todo.md) and
[Photos/Music todo](photo-audio-experience-todo.md) remain the complete target
map. Curated albums, reliable capture-time/EXIF/orientation and ordinary-large
photo renditions, artist/album navigation, music metadata/artwork, reusable
ordered playlists, favorites and retained listening state are missing.
Queue reorder/shuffle/repeat and one browser batch-original archive are also
outstanding. Existing download/server materialization is not that archive.

NOT RUN: representative real photo/song corpus, unsupported/native-decoder
format matrix, full empty/error/unavailable UI matrix, separate browser-context
SavedView access, remote deployment and release qualification. Existing preview
UNKNOWN verification status was not upgraded by these client checks. Full core
phase/repository/LinkGroup/release gates remain governed by the execution plan.

The next product cohort should first settle shared photo/music metadata and
bounded rendition admission, then implement curated albums and artist/album
navigation, followed by reusable ordered playlists. Batch browser takeout remains
a parallel core daily-use priority after its delivery contract is admitted.
Runtime plugins, multi-user tenancy and platform qualification are not the next
experience work. Admission and executable exits must precede durable changes.
