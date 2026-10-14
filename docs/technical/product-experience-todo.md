# Product Experience Todo

> Status: informative progress ledger (documentation authority rank 7). It
> records task-level state above the core. It adds no MVP scope, closes no
> gate, and awards no completion credit. Requirement status is owned by the
> canonical matrix in
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md);
> narrative and gates live in
> [Product Experience Plan](product-experience-plan.md); item constraints live
> in [Product Experience Backlog](product-experience-backlog.md).

Last updated 2026-10-14: bounded functionality-first client acceptance for the
2026-10-13 cohort; local Photos/Music refinements and media/anime candidate review.
Earlier SP-2 evidence remains dated 2026-10-11: on the real 11,561-item
library, `status.get` changed from 6,892 to 1,437 ms, the shell's restore-point
read from 8,080 to 1,785 ms, and wall load from 21,368 to 7,584 ms after the
kernel stopped walking every publication manifest for a count. Those results,
the earlier 9,138-item measurements and SP-1/saved-view fixes retain their own
candidate identity; this update does not re-qualify their performance.

## Convergence-phase priority order

The project is in a convergence phase (see `AGENTS.md`): close existing gaps
in the admitted core loop and admitted client surfaces before adding scope.
Within this ledger, work in this order:

1. **P0** — concrete user-visible correctness/trust failures in an admitted
   surface. Follow each detailed row's dated evidence. The older summary that
   called unsupported-format playback and the R1.4 client mislabels untested
   or open was stale: their rows record actual fixes and browser verification.
   They must not send implementation back to already-closed defects. R1.4 and
   M4 remain partial only for the residual scope their rows explicitly name.
2. **P1** — the selected daily product loop: simpler intake, productive shared
   library actions, and focused Photos/Music use. The private-drive section
   below sets this client sequence; it changes no core phase order or admission.
   The operator's latest reset puts missing useful operations before another
   appearance round; [ADR-041](build-stack-and-architecture-selection.md#adr-041-complete-useful-client-operations-before-further-visual-redesign)
   and the [functional target map](content-first-product-decision.md#functional-target-map--2026-10-13)
   retain the immediate sequence and the separate full-domain dependencies.
3. **P1 validation** — focused evidence for the slice being changed and the
   genuine residual matrix in its row. Existing fixture/harness entries now
   carry later evidence; do not keep treating the earlier stale harness as a
   current blocker or repeatedly run completed matrices without a new reason.
   Cross-context SavedView access and remaining playback failure branches
   retain their explicit limits.
4. **P2** — documentation consistency and backlog grooming alongside the
   implementation that changes evidence. This summary aligns earlier dated
   records; it is not a new run or completion award.
5. **Outside this convergence queue** — new integration scope needs direct
   authorization and its own contract. Runtime third-party loading and a plugin
   store remain explicit non-goals; build/install-time presentation composition
   follows ADR-032's separate boundary.

The [whole-product delivery target](whole-product-delivery-target.md) carries
the entire-product outcome map and current parallel cohort. This ledger records
individual evidence; completing a row does not complete the whole product.

## How to read this

| Mark | Meaning |
| --- | --- |
| `[x]` | Implemented and tested for the profile the row names |
| `[~]` | Partial; something end-to-end works and the remainder is listed |
| `[ ]` | Not started |
| `[!]` | Blocked on a gate or an operator decision |
| `[-]` | Out of scope under the current lock |

A row is never `[x]` because a design exists, a fixture passes, or a harness
skipped. When a harness can skip, the row says so.

## Active product todo — 2026-10-09

### Private-drive daily loop — 2026-10-12

The current product category is **a better self-hosted private drive** for one
owner. [ADR-035](build-stack-and-architecture-selection.md#adr-035-private-drive-positioning-and-file-oriented-intake)
records the decision. The operator selected easier Add and mature interface
patterns; the [reference review](../research/private-drive-interface-reference-20261012.md)
separates documented patterns from Cairn's design choices. This is an admitted
client-maintenance queue, not a replacement core execution plan.

- [x] Lead Add with file choice/drop, automatically prepare a fully reported
  uploaded batch, and keep review/explicit save in the same file-oriented panel.
- [x] Make names/count and the next action prominent; disclose temporary paths,
  digests and storage accounting. Keep refusals, renamed names, warnings and
  unresolved outcomes visible, using the existing check path.
- [x] Return from successful saving to the unified library and verify actual
  original downloads for text, image and audio inputs.

Executable evidence: [private-drive intake acceptance](private-drive-intake-acceptance-20261012.md).
DeepSeek Harness Flash implemented the two component scopes; the primary
reviewer accepted the diffs and Luna owns the remaining browser/screenshots
review. This is tested local intake, not full-product or release completion.

Next product slices, within their existing admissions:

- [~] **Library productivity:** give browse, selection, Details and takeout a
  consistent action hierarchy. Reuse existing tags/favorites, filters and batch
  originals; the exit is find → select → use/download, including an empty
  result and an unavailable original. Do not create a new folder/sync model.
  The 2026-10-12 bounded client slice is implemented and locally tested:
  standard tools/disclosures, batch action hierarchy and row-selection
  affordances were delegated to three independent DeepSeek Harness
  `sub2api / claude-haiku-5-5` sessions. Build, registry, browser flow and
  exact-byte ZIP checks passed; see [library acceptance](library-productivity-acceptance-20261012.md)
  and the locally retained QA report at
  `dist/library-productivity-20261012/validation/qa-report.md`.
  Keep this row partial: empty-result selection and unavailable-original
  outcomes, light captures at the exact target dimensions, and broader
  large-library behavior remain unverified.
- [~] **Photos use:** make selection, inspection and original takeout feel like
  one dedicated photo application. Retain the same loaded result scope,
  original identities, incomplete-scope notices and bounded rendition budget.
  The [2026-10-13 bounded polish acceptance](domain-polish-acceptance-20261013.md)
  records the clearer wall/names/controls and real local inspection/selection
  checks; original takeout keeps its earlier separate evidence. Complete
  curated organization and large-library/real-device behavior remain open.
- [~] **Music use:** coordinate recorded track/artist/album browsing with the
  single verified player and transient queue. Finish existing queue failure
  states before admitting persistent playlists or media services.
  The same acceptance records the coherent browse/action row, native keyboard
  selection, decoded original and shared-player continuity. Persistent
  playlists and the residual playback/failure scope remain open.

Each slice still needs its own normative requirement and executable exit.
Persistent albums/playlists, richer grouping, folder mutation, sharing and
sync are separate decisions; this category wording does not admit them.
The existing correctness gaps and core/recovery gates remain in force.

Future media candidates, outside the admitted implementation queue:
[video/anime, Bangumi and danmaku review](../research/media-and-anime-experience-20261013.md)
and [ADR-037](build-stack-and-architecture-selection.md#adr-037-complete-existing-domain-journeys-then-review-a-personal-video-successor)
record the operator's 2026-10-13 request, useful domain journeys, optional
enrichment and proposed exits. They do not create a new surface or gate credit.

Dedicated-entry refinement of the current daily loop:

- [x] Give Library/Photos/Music explicit global destination entries and a
  consistent host header; keep type filtering and in-domain render styles
  separate. Label the full-listing rail action All content.
- [x] Verify retained query/tag scope without a repeated search, the same
  decoded player across the destination cycle, draft cancellation and old
  direct links; review clean 390/1280 light/dark and Showcase layouts.

Executable evidence: [destination navigation acceptance](destination-navigation-acceptance-20261013.md)
records local Luna implementation, primary review, current-build headless
browser checks and the preserved fixture restart. It grants no native-device,
new media or core/release completion.

Progressive-disclosure refinement of the same daily loop:

- [x] Place the compiled Overview inside Library's View options, retaining
  Library/Photos/Music as global destinations and Library's active state.
- [x] Disclose search history/help and secondary Library controls on demand;
  keep active restrictions, incomplete scope and grammar errors visible.
- [x] Review the final 390/1280 light/dark default/search layouts and exercise
  one search → Overview → File view without another query, plus plain/exact
  completion and refused invalid text.

Executable evidence: [progressive-disclosure acceptance](progressive-disclosure-acceptance-20261013.md)
records reviewed local Luna implementation, final served assets, screenshots
and three bounded browser assertions. History mutation and broader keyboard,
media, large-library and release coverage were not rerun. The parent Library,
Photos and Music rows remain partial.

Exhibition gallery refinement of the existing Photos presentation:

- [x] Prioritize the current photo with a stable center, quiet adjacent
  previews, compact heading, one current action row and disclosed help.
- [x] Verify first/middle/last and keyboard navigation, bounded mounts,
  neighbor focus, inspector/Details entry, selection return and a real
  unavailable preview; review 390/1280 light/dark final screenshots.

Executable evidence: [Exhibition gallery acceptance](exhibition-gallery-acceptance-20261013.md)
records reviewed local Luna implementation and headless browser checks.
It adds no photo organization, provider, core-phase or release qualification.

Functional continuation of the admitted daily loop (2026-10-13 cohort):

- [x] Add local Music title/artist/album/track/duration/size ordering and honest
  playback-eligibility filtering, retaining original subject mapping and
  unknown facts. Final keyboard trace follows the displayed sorted rows.
- [x] Insert one distinct queue occurrence after the current track without
  replacing its verified Blob or playback position; close/refocus the row
  queue menu after an action. Keep the queue transient and bounded.
- [x] Select an inclusive ordinary-Library range; add/reuse/remove an exact
  TAG and explicitly favorite/unfavorite captured subjects. Complete reads,
  revision checks, reread results, draft preservation and injected refusal
  checks retain unrelated annotations and report unavailable outcomes.
- [x] Select/deselect inside Photos and Exhibition inspection, show the same
  selected-item count, and reach the one existing batch-action region.
- [x] Expose the existing Saved retrieval entry directly in File/Overview;
  retain the media-scope save refusal inside opened domain tools.

Executable evidence: [functional client acceptance](functional-client-acceptance-20261013.md)
and its retained QA report distinguish earlier v2 evidence, final v5 build and
browser checks, and injected-only read failures. Go regression ran once;
served JS/CSS match the final build. Real 1,000-entry UI saturation, async
Details switching, uncertain-write reconciliation and additional saved-query
combinations remain unrun. Library, Photos and Music stay partial; curated
albums, durable playlists and video remain separate targets in ADR-041.

### UX-D1 — focused full-page Photos and Music (2026-10-12)

The operator explicitly selected this current presentation slice on 2026-10-12.
It refines admitted client surfaces; the core phase order remains unchanged.
The normative boundary is
[First-Party Client Experiences §14](../requirements/first-party-client-experiences.md#14-ux-d1-full-page-photos-and-music-composition),
with the rationale in
[ADR-034](build-stack-and-architecture-selection.md#adr-034-focused-full-page-domain-layouts-over-shared-host-state).

- [x] Give Photos/Music full-page composition selected by compiled metadata,
  with compatible direct links and no permanently expanded generic rail/tools.
- [x] Keep management, trusted status, shared search and original actions
  reachable; active restrictions and incomplete listing states stay legible.
- [x] Refine readable light/dark domain content and concise Music batch actions
  without changing their displayed-scope counts, omissions or transient queue.
- [x] Accept the integrated browser journey at 390/1280: direct links, controls,
  shared player through navigation, guarded drafts, scope and original actions.

Executable evidence: [local full-page acceptance](full-page-domain-layouts-acceptance-20261012.md)
records the captured light/dark layouts, one-player source/position retention,
filtered selected append, client home/management/search navigation, actual
cancelled Notes confirmation and SHA-256-matched browser original download.
The final build, registry/i18n checks, broad Go run and served-byte verification
passed. Large-library, real-device and all fault branches remain outside this
acceptance; existing incomplete-listing rendering was preserved rather than
re-qualified on the large corpus.

Header refinement of the same UX-D1 slice:

- [x] Replace the stacked search/navigation strips with one compact host
  capsule and separate in-domain display choices; keep standard Library chrome.
- [x] Accept disclosed search and management on keyboard and pointer paths,
  retaining field text, result scope, draft protection and the shared player.
- [x] Capture light/dark 390/1280 layouts and bind checks to the served assets.

Executable evidence: [immersive host-header acceptance](immersive-host-header-acceptance-20261012.md)
records eight final layouts, native search/history/operator visibility, all
three focus shortcuts, retained query text/scope, settings return focus,
cancelled Notes confirmation, visible browser-offline fallback/reconnection,
and the same unpaused original across Music → Photos → Music. Build,
registry/i18n, broad cached Go, served-byte identity and whitespace checks pass.

Implementation has been delegated through DeepSeek Harness to the explicitly
selected `sub2api / deepseek-v4.1-flash` route. Primary review and local browser
acceptance are recorded above. This row grants no album/playlist, runtime package, new query,
core-phase or release completion.

This ledger now tracks the parallel RW-PERSONAL-UX-1 client cohort admitted by
[ADR-025](build-stack-and-architecture-selection.md#adr-025-admit-dedicated-personal-client-workflows-without-a-new-media-service)
and specified in the [first-party client contract](../requirements/first-party-client-experiences.md).
Three Luna implementations covered Photos, Music, and named retrieval in
parallel; the primary agent owns shared integration and browser acceptance.
The photo/audio sub-plan retains its historical proposal, but its current
status follows this admitted profile. Local browser evidence does not close a
core phase or release gate.

### 1. Return to named content — implemented slice, partial browser scope

- [x] R1.1 Open saved retrieval through the library UI without selecting a file or opening Export.
- [x] R1.2 Save the supported quiet query and `suffix:wav` condition with workspace scope through existing view operations; refuse unsupported conditions such as `type:audio` instead of silently broadening the saved query.
- [x] R1.3 Recall through existing evaluation with lexical, dynamic semantics; the refreshed query returned two WAV matches and does not claim to freeze a semantic result set.
- [~] R1.4 Same-context refresh restored two matches; after confirming new entry C (identical bytes to A, 0 B new / 625 KiB reused), reopening the saved query returned three matches. The recalled display showed the stored format condition, and the recorded "resaving was blocked" came from the recall-state guard that forbids editing/re-saving a view while one is open (`LibrarySurface.tsx`), **not** from an unsupported condition: the stored form is the supported `suffix=wav` key, which `view_export_ops.go` implements and `supportedSavedFields` lists. An earlier wording that called that condition unsupported was wrong and is corrected here. An independent read-only audit on 2026-10-10 enumerated the failure matrix: malformed `fields_json`, a non-integer numeric value or a contradictory size range, and a scope whose workspace is gone all fail closed and visibly; a missing subject simply leaves the view's membership; an empty result reports `EMPTY`. Two paths were fail-open and are now closed: an unrecognized condition key and an entry with no `=` were silently dropped, so `view.evaluate` returned a wider unfiltered set as the view's membership and `export.plan` would freeze it. The kernel now refuses both as `invalid_input` at `view.save`, `view.evaluate` and `export.plan`; a focused Go test fails before and passes after, and the full server suite is green. Still open and reported, not fixed: recall-active is judged from the query text alone while the request also carries fields, so a plain re-search can leave the panel claiming the stored filters; the client hides a stored-but-unsupported condition from the operator; recall never compares the stored scope with the current workspace and `view.list` is not workspace-filtered; and `sort` / `output_names` / `when_missing` / `required_capabilities` are persisted but ignored at evaluation. Separate-context access (a fresh page, a second client, or a second workspace) remains unverified. Two client-side mislabels were reproduced in real Chrome on 2026-10-10 against an isolated fixture profile seeded with one supported view (`suffix=wav`) and one unsupported view (`format=wav`), and both are now recorded as open defects: (a) after recalling a view, a plain re-search submitted with the same query text re-ran without the stored conditions yet the caption `Live evaluation of saved view …` and the panel's `Saved filters …` both survived, so the displayed conditions no longer described the displayed results; (b) recalling the unsupported view failed correctly at the kernel (`view.evaluate` returned `FAILED`/`invalid_input` with `saved view condition "format=wav" is not supported by view.evaluate`, and that message did reach an alert), but the previous view's success state stayed on screen unchanged — `Opened <other view> with current lexical results.` plus `Live evaluation of saved view "<other view>"` alongside that other view's 3 rows — so a failed recall left a success claim and result set belonging to a different view. **All of these are now fixed and independently re-verified** in real Chrome against isolated fixture profiles: the recalled projection is cleared by any successful search, so after a plain re-search the live-evaluation caption was gone (`captionCount=0`) and the panel fell back to the executed request's real (empty) condition list, ending the mislabel; a recalled view now hands the panel every stored condition, so an unnameable one renders as raw `key=value` with an explicit "Stored condition this build cannot label" marker instead of being filtered away; a view whose stored scope differs from the current workspace is flagged "Other workspace" in the list and its caption/outcome state that the results came from that stored scope rather than the workspace open here, without ever rendering a raw workspace id; and a failed recall now retracts the previous view's outcome, caption and rows, replacing the column with an honest failure surface that names the refused view, shows the kernel message verbatim, and explains that the stored conditions were refused rather than dropped so the view's membership is unknown — with the supported view still recalling cleanly (`ready`, 3 rows) as a control. The strictness change was regression-checked against real stored data on 2026-10-10: a saved view created before the change (`Luna QA 音频样例`) still lists, loads and evaluates — `view.list`, `view.get` and `view.evaluate` all `SUCCEEDED`, the panel reported `ready` with "Opened … with current lexical results", and the library returned its 3 matching rows — so refusing unrecognized conditions does not break a stored supported view.

**Observed exit:** save -> leave -> refresh -> reopen the named query and its
supported constraints without internal IDs. See the [2026-10-09 personal
experiences acceptance record](personal-experiences-acceptance-20261009.md).
View rename/delete and a second durable view store remain unimplemented.

### 2. Batch original takeout

- [x] R2.1 Admit UX-T1 for one workspace, existing `export.plan` item summaries, sequential authorized reads, 32 files/32 MiB per file/64 MiB total, frozen names and all-or-nothing browser ZIP preparation. It adds no streaming endpoint, format or server ZIP receipt; see ADR-027.
- [x] R2.2 Deliver an actual browser ZIP from explicit selections using the existing frozen manifest. Progress/cancel survives navigation to Music; server-directory export and large single-original downloads remain separate actions.
- [x] R2.3 Validate every selected/frozen identity and byte length before download. Actual browser cancellation during a 17-file batch produced a cancelled state and no download event during the monitored interval; helpers cover member failure, stale/malformed manifests, limits and URL/read cleanup. UI reports prepared/requested rather than claiming disk save.
- [x] R2.4 Independently extract the actual six-file browser ZIP, compare every name/length/SHA-256 with both the selected originals and persisted frozen manifest, including a zero-byte file and distinct `Shared.txt`/`Shared (2).txt`. Full streaming/large-library archive materialization remains a future contract.

The final client also completes an actual search -> select JPEG -> ZIP journey.
Search/SavedView result sizes are resolved only from matching loaded namespace
subject/entry/content identity before preflight; unknown or mismatched rows
remain refused. See [takeout/photo acceptance](takeout-photo-acceptance-20261009.md).

**Entry:** reviewed contract/admission, not an informal rename of an existing
download. **Exit:** one ordinary select -> review -> download -> use journey.
Existing bulk tags and server materialization are reused, not counted as new.

### 3. Dedicated photo experience — implemented slice, partial journey

- [x] P0 Admit the local wall/viewer slice under RW-PERSONAL-UX-1; keep processor, fact, and durable album contracts separate.
- [x] P1 Render a distinct image-first Photos page over shared loaded subjects, with shared selection, tags, Details and original access.
- [~] P2 Provide adjustable wall density, responsive layout and loaded-format filters with original result mapping. Browser acceptance exercised density 3→5 and PNG filtering. Capture-date/source context and date controls are not implemented because no admitted photo facts supply them.
- [x] P3 Provide continuous current-result next/previous, fit/actual-size, keyboard operation, Escape focus return, and honest preview failure states. A generated 900×600 PNG decoded in the final canvas; ArrowRight advanced, Escape closed and restored focus to the opening item. The remaining keyboard/touch matrix and the multiple real-photo cases are now covered by a real-browser pass on 2026-10-10 (installed Google Chrome driven by Playwright against the isolated QA profile's 7 real PNG/JPEG subjects, including a 1800 px JPEG/PNG, a 5000 px over-pixel PNG and an EXIF-oriented JPEG): every subject rendered an image with no silent blank; pointer drags advanced/returned, clamped at both ends, and ignored a 30 px sub-threshold drag and a vertical-dominant drag; the same matrix passes under real touch input (`Input.dispatchTouchEvent` in a `hasTouch` 390×844 context); Escape closed the viewer and returned focus to the opening card. Verifying this found and fixed a real defect: the fit / actual-size controls had swapped `disabled` conditions, so "Fit to window" was disabled while at actual size and actual size was a one-way trap; each control now disables only while it is already the active mode.
- [~] P4 Preserve the 1 MiB legacy thumbnail and 8 MiB inspector limits. The separately admitted UX-P2 supplies visible-card transient PNG/JPEG renditions up to 8 MiB/12 MP; retained 1.1 MB JPEG and 3.8 MB PNG inputs rendered in Photos and Exhibition, including one native EXIF-oriented JPEG and an over-pixel fallback. Larger images and retained derivatives remain open.
- [x] P5 Browser evidence covers the generated-PNG wall/sequence and Photos at 390×844 with document client/scroll width 375/375. Details and the shared original-download action were reached, but no download event fired within 15 seconds; original takeout was **not accepted**. Root cause found and fixed: `downloadOriginal()` built the anchor `href` but never set `anchor.download`, so some narrow-viewport/mobile browsers treated the synthetic click as navigation instead of a save. Fix now sets `anchor.download`/`rel="noopener"` to match the existing `useOriginalTakeout.ts` pattern; `tsc --noEmit` is clean. The outstanding narrow-viewport re-run is now done (2026-10-10, real Chrome + Playwright at 390×844 with `acceptDownloads`): the ordinary library Details action fired a real browser download named `Empty.txt`, produced no same-tab navigation and no HTTP error; the same was repeated for a real photograph through Photos (`Large-landscape.jpg`, 1800 px JPEG) with the original filename preserved. Notes-flow coverage is tracked by the Notes/tag rows, not here.

**Exit:** a distinct, comfortable supported-photo journey. A generic image
filter, mock gallery or synthetic picture is not completion. Actual albums
require the grouping/domain contract; EXIF/magic facts are not invented from names.

**Complete Photos baseline, beyond the early viewer slice:**

- [~] PF1 UX-P2 implements bounded transient ordinary-photo renditions; no capture-time/EXIF/orientation extraction or retained derivative is added. Native browser orientation is presentation only. The remaining metadata/processor successor stays proposed.
- [ ] PF2 Admit curated album create/rename/member editing/cover/browse/export semantics without treating album removal as byte deletion.
- [~] PF3 Shared favorite star/filter uses the existing visible `Favorite` TAG across Photos, Music and Overview. Batch organization and useful supported metadata filters remain open; this is not album membership. Verified 2026-10-10 in real Chrome: the Photos wall showed `Large-landscape.jpg` starred and the Music surface showed one starred track (`Slow Morning`, Cairn QA Artist) through the same tag; the photo star survived a full page reload; the library's "Only favorites" control narrowed 17 rows to exactly 2 and reported `aria-pressed="true"`, matching the one starred photo plus the one starred track.
- [ ] PF4 Demonstrate import -> timeline -> find -> continuous view -> curate album -> original takeout, including mobile browse/upload and return position. The domain remains partial until this declared baseline works.

### 4. Dedicated music experience — implemented slice, partial journey

- [x] M0 Admit the bounded client playback contract; retain explicit size, identity, cancellation and format limits.
- [x] M1 Render track rows over shared subjects with filename, recorded size/format, tags, Details and original access; absent artist/album/artwork remain unknown.
- [ ] M2 No missing-metadata/artwork processor or enrichment path is admitted or implemented.
- [x] M3 Exercise bounded downloaded-original WAV playback with full length/SHA-256 verification, play/pause/seek/volume and visible controls while browsing Photos. This is local evidence for one tested WAV, not universal format support.
- [~] M4 Audio-helper canonical identity/hash/size/cancellation checks pass. Browser tested stop/remove/clear and retained the same Blob/time/duration through Showcase→Workspace→Showcase and Photos navigation; the active queue item cannot be removed. Code review confirms the removal-after-Stop path: `removeQueueOccurrence` refuses while a track is `current`, and the queue-row remove button disables with a "Stop playback before removing the current track" title (`AudioPlayer.tsx`); once `stop()` clears `state.track`, the same row becomes removable. Error/unsupported-format states (`unsupported-format`, `workspace-mismatch`, `track-unavailable`, `playback-permission`, hash/size/length-mismatch) surface through the player's status region and have zh-CN i18n strings in `musicExperience.ts`/`queueExperience.ts`. **Correcting an earlier claim in this row:** that region is a live `aria-live="polite"` region only when a queue notice is present (`AudioPlayer.tsx` sets `role`/`aria-live` conditionally on `playback.queueNotice`), so for an ordinary playback error the observed DOM had `role=null` and `aria-live=null` — the failure is not announced to assistive technology. That is a real open defect, not a description of working behaviour. Both live halves are now done. The removal-after-Stop half (2026-10-10, real Chrome): two occurrences of real WAV originals were queued, no item was current before playback, starting one marked exactly that occurrence current, its remove button was disabled with the title "Stop playback before removing the current track" while a non-current row stayed removable, Stop cleared the current occurrence and made that same row removable with the title "Remove from queue", and removing one occurrence removed exactly one entry (2 → 1). The unsupported-format half is covered by a new self-contained harness (`scripts/web-audio-unsupported-check.mjs`, exit 0 in both en and zh-CN): a real renamed non-audio original (a valid 165-byte PNG named `.mp3`) reached the player as an explicit error, the audio element stayed paused with `currentTime` 0, `readyState` 0 and its blob `src` removed, the toggle stayed "Play", the identity remained the attempted file, and the queue kept both entries with the attempted file still current and the other not marked playing - no silent skip and no advance. An independent oracle fed the same downloaded bytes to the browser's own decoder and got `MediaError` code 4 / `DEMUXER_ERROR_COULD_NOT_OPEN`, confirming the error is honest, while a real WAV played normally in the same player as a control. Two real defects were found in that pass and are now fixed and re-verified. First, an English locale rendered the internal code `unsupported-format` instead of a sentence, and the prepared English sentence in `musicExperience.ts` was referenced nowhere; the player now maps every typed playback code (including a parameterised `download-failed-<status>`, with an explicit generic sentence for any unregistered code-shaped token and pass-through for free-form prose) to a sentence that is itself the `t()` key, so English renders it and zh-CN resolves it, and the ten raw-code catalogue keys are gone. Second, the status element was a live region only when a queue notice existed, so an ordinary playback error was not announced; it is now `role="status"`/`aria-live="polite"` whenever it reports an error or a queue notice, and deliberately a plain element for the routine lifecycle text so ordinary play/stop transitions are not announced. Both are confirmed in real Chrome in en and zh-CN: the status shows the prepared sentence in each locale and carries the live-region attributes in both. The harness that found them now asserts those two properties instead of printing notes, and that assertion is not vacuous — pointed at the pre-fix bundle it fails with exactly `the error status element carried no role="status"/aria-live in en, zh-CN` and `the status region rendered an internal code instead of a human sentence in en: ["unsupported-format"]`, and against the fixed bundle it passes. Residual, recorded not fixed: adding `aria-live` to an existing node whose text changes in the same commit is less reliable on some assistive technology than a dedicated always-present empty live container would be, and moving to that shape needs `AudioPlayer.css` or a change to what the harness reads. The remaining error codes (`identity-unavailable`, `size-limit`, `length-mismatch`, `hash-mismatch`, `download-failed-<status>`, `empty-response`, cancellation, stale callbacks) still have only helper-level checks.
- [~] M5 A 20-second WAV was decoded and exercised through play/pause/seek/volume; seek to 19.9 s advanced to the next queued track. At 390 px, controls worked and the queue fit the 375 px document width. Original takeout was not observed, and Notes/tag flow and actual retained-song coverage remain unverified.

**Early-slice exit:** one bounded supported-track journey has local evidence.
This does not complete the Music domain.

**Complete Music baseline, beyond single-track playback:**

- [~] MF1 Existing `audio.list` facts now drive artist/album/track browsing, with filename/unknown fallbacks, manual fact refresh and recorded track-number order for selected known albums. Tagged MP3 samples were browsed and played locally. New extraction/artwork, disc/compilation support and complete coverage remain open; see the proposed RW-MEDIA-2 contract.
- [x] MF2 Transient loaded-set playback, reorder, one-shot upcoming shuffle and repeat off/all/one are implemented for UX-M2. Local MP3 evidence covers supported-set start, position-preserving reorder, repeat-one completion/manual Next and shared player navigation; deterministic helpers cover shuffle/repeat boundaries. Active-item removal requires Stop. This row is transient queue scope, not durable playlists or universal decoding.
- [ ] MF3 Admit and implement reusable ordered playlists, including create/rename/edit, repeat occurrences, missing-member handling and recovery/migration semantics.
- [~] MF4 Shared `Favorite` TAG shortcuts are implemented across Music and the other first-party views. Retained session where admitted, available local lyrics and mobile controls remain open; no fabricated facts or implicit network enrichment. The shared-tag read path is verified 2026-10-10 in real Chrome: Music renders a starred track from the same `Favorite` TAG that Photos renders a starred photo from, and the library filter reconciles to their sum.
- [ ] MF5 Demonstrate find artist -> open album -> continuous listening -> edit queue -> save/reopen playlist -> navigate other content -> control player -> take out originals. Keep queue, playlist, album, SavedView, LinkGroup and ExportManifest semantics distinct in one authoritative catalog.

### Open-ended page and interface successor

- [x] E1 Independently registered compiled pages and shell renderers reject ID/route/slot collisions; compatible Photos/Music aliases and Exhibition route resolve. This is trusted source registration, not a runtime plugin loader.
- [x] E2 Photo Exhibition navigates the complete loaded image context with at most five previews from the existing bounded thumbnail pipeline mounted. Real PNG browser checks cover selection, keyboard steps and 390 px layout; visual transforms stay on artwork so controls remain clickable. The [2026-10-13 gallery refinement](exhibition-gallery-acceptance-20261013.md) records centered first/middle/last images, ordinary-photo and unavailable outcomes under the existing UX-P2 limits, and refreshed light/dark layouts.
- [x] E3 Photos ↔ Exhibition retains shared subject focus, batch selection and an unsaved Notes draft. MP3 playback retains the same Blob/time through page switches. An isolated fault bundle exercises actual page/shell boundaries and one workspace fallback; it is not real-content or plugin-isolation evidence.
- [x] E4 ADR-026 and the source contribution guide record why the host stays authoritative and why whole shells are distinct from colors. Two DSH CLI Opus5.5 consultation turns are retained as advisory evidence.
- [ ] E5 Review and admit RW-MEDIA-2 photo renditions/facts/covers and curated album/ordered-playlist contracts, then implement their declared journeys. The successor proposal is ready, not admitted or delivered.

Evidence: [open-ended client acceptance](open-ended-client-experiences-acceptance-20261009.md).

### UX-C1 — grouped domain presentations over one returned-result scope

The normative successor is admitted in
[First-Party Personal Client Experiences §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope).
The implementation guide and architecture record are
[the contribution guide](client-experience-extension-guide.md) and
[ADR-028](build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition).
This is an implemented client refinement for the stated development scope;
[integrated browser evidence](domain-presentation-acceptance-20261009.md)
records the remaining unverified negative branch. It changes no backend
contract or phase status.

- [x] Group Photo wall and Exhibition beneath Photos while preserving their
  stable page IDs, existing routes and independent enabled/disabled preferences.
- [x] Keep keyword/tag conditions and returned result order through
  presentation switches; disclose returned-result facets and empty states,
  preserve all-types access and do not issue a second query.
- [~] Test old/unknown/disabled presentation routes, same-domain held work,
  the existing cross-domain Notes guard, and exact current loaded-row joins for
  supplementary lengths; stale or ambiguous tuples remain unknown. Routes,
  held work, scope projection and exact joins have current evidence. The
  existing cross-domain Notes guard remains in source, but CUA did not produce
  a deterministic cancellation result; that negative branch is not accepted.
  **That negative branch is now produced deterministically** (2026-10-10, real
  Chrome, no fault injection needed): with an unsaved Notes draft on an open
  Details panel, choosing the Activity rail entry raised `confirm("Discard
  unsaved note changes?")`; dismissing it left the view unchanged with the
  draft text still in the field, and accepting it navigated to
  `#v=activity` and cleared the draft. So the cancellation branch behaves as
  the guard intends. The render-fault branch was blocked, and is now unblocked:
  the harness was re-run on 2026-10-10 against a live isolated QA daemon and
  aborted before injecting anything —
  `[cairn-disposable-interface-render-fault] fault injector has one
  narrow InterfaceFrame entry point / 2 !== 1` — because `InterfaceFrame.tsx`
  had been refactored into a dispatcher delegating to `WorkspaceFrame` /
  `ShowcaseFrame` / `ImmersiveFrame`, so the injector's old anchor
  (`  const stateClasses =`) now matched twice while the harness still asserted
  exactly one. It was a stale harness, not a product failure. The injector now
  anchors on the two per-interface frame renderer signatures, keeps three
  fail-loud count guards (legacy marker === 2, renderer signature === 3, one
  match per target), and still injects nothing into `ImmersiveFrame`, matching
  the original. With that, a full run passes in both phases —
  `PASS: live interface state retention and held request` and
  `PASS: disposable render-fault recovery`, exit 0 — with the fault-injection
  build actually completing and its scenario evidence byte-identical across two
  runs (`showcase-only-once`: `faultAttempts=2`, `automaticRecovery=workspace`,
  `sharedStateRetained=true`, `mutations=0`; `persistent-shared-frame`:
  `faultAttemptsBeforeRecovery=4`, `explicitRetryAttempts=6`,
  `automaticRetryLoop=false`, `visiblePanel=true`, `mutations=0`; held-write:
  `mutationDispatches=1`, `committedNotes=1`, `duplicateMutationDispatches=0`).
  The existing 2–4 and +3 bounds were kept, not loosened; a useful consequence
  is that those bounds implicitly require the injection site to be the
  per-interface renderer (the shared dispatcher yields 12 attempts, 18 after
  retry). Still uncovered: `ImmersiveFrame`'s render-fault path, and this
  harness never exercises the Notes-guard cancellation above — that branch
  comes from the real-browser confirm evidence, not from fault injection.
- [x] After the shared-scope baseline, admit one fixed host Overview with
  read-only selectors, narrow host actions and globally shared resource
  budgets. Do not begin a free-form canvas or runtime extension framework.
- [ ] Keep the separate proposed RW-MEDIA-2 album/playlist/extraction
  successor behind its own recovery, migration and relation-design review;
  existing `audio.list` artist/album browsing does not imply new extraction.

**Exit:** preserve a real Photos wall or Exhibition through search and tag
filtering, switch to all types/Music without query loss or rerun, verify honest
returned-result counts, exercise route migration and safe tuple matching, and
retain same-domain focus/selection/Notes/player. Report route-level browser
evidence before changing any implementation mark above.

### UX-C2 — one fixed mixed-content overview

- [x] Register Overview as a browse layout separately from Photos/Music types;
  display bounded photo/audio/other sections from the same authorized result
  scope, with full-scope versus displayed counts and original selection indices.
- [x] Reuse shared thumbnail budgets, recorded audio facts, Details/selection
  and the one verified-original player. Navigation does not rerun search.
- [x] Resolve an enabled Photos presentation; disabled domains have no preview
  or playback actions and retain All types access. A valid destination clears
  only the corresponding presentation fallback warning.
- [x] Retain composed links through asynchronous restoration; render a pending
  state without broader results or thumbnails. An empty-query failure keeps
  the original link and permits a successful explicit search to recover.
- [~] Browser evidence includes mixed-content selection/Details/playback,
  shared paused playback through domain navigation, preference fallback,
  composed search/tag refresh and 390 px browsing without horizontal overflow.
  Offline/stale-request fault injection and the full mobile journey remain open.
- [x] Record the [durable album/playlist candidate design](durable-media-organization-design.md):
  album sets, ordered repeatable playlist occurrences, missing members,
  concurrency, portable publication/import and frozen export boundaries.
  This row is design delivery only; persistence remains **NOT IMPLEMENTED**.

Evidence: [fixed-overview acceptance](fixed-overview-acceptance-20261009.md).
The bounded client admission and decision are UX-C2 §11 and ADR-029. It adds
no backend operation, durable record, general block SDK or phase credit.

### UX-F1 — shared favorites through existing user tags

The admitted [normative contract](../requirements/first-party-client-experiences.md#12-ux-f1-shared-favorites-through-existing-user-tags)
and [ADR-030](build-stack-and-architecture-selection.md#adr-030-shared-favorite-shortcuts-before-durable-media-membership)
reuse the ordinary `Favorite` TAG and existing annotation operations. The
[local acceptance](shared-favorites-acceptance-20261009.md) records the tested
subset; it does not close the remaining failure, mobile or whole-domain journey.

- [x] Provide shared star/unstar and Only favorites across Photos, focused
  viewer, Music and Overview through one host-owned TAG state and callback.
- [x] Keep unknown/unavailable tag reads non-editable; preserve unrelated tags
  and Notes, and retain the explicit filtered empty state.
- [~] Browser persistence/filter/fault/mobile acceptance and focused helper/build
  evidence are limited to the cases listed in the local acceptance. Any missing
  exit case remains open; no helper-only result is promoted to full acceptance.
  Persistence, the shared-tag read path and the filter are now covered by a
  2026-10-10 real-Chrome pass (one starred photo in Photos, one starred track in
  Music through the same `Favorite` TAG, the star surviving a full reload, and
  "Only favorites" narrowing 17 rows to their exact sum); fault injection and
  the full mobile journey remain open.
- [x] Keep catalog TAG writes distinct from portable recovery freshness: a
  click does not immediately publish a new signed backup.

This shortcut is not album or playlist membership and grants no core phase or
release credit. Next, review and admit the independent durable organization,
recovery and export successors; then implement a playlist vertical slice before
albums. Do not reinterpret tags as a media schema or bypass LinkGroup Phase 4/5.

### UX-Q1 — occurrence-aware transient queue and Music batch actions

The admitted [normative contract](../requirements/first-party-client-experiences.md#13-ux-q1-occurrence-aware-listening-and-batch-queue-actions)
and [ADR-031](build-stack-and-architecture-selection.md#adr-031-occurrence-aware-transient-listening-and-music-batch-actions)
extend only the App-owned transient queue. Earlier MF2/UX-M2 checks remain
historical evidence for that narrower queue slice; they do not establish Q1.

- [x] Music actions append the currently displayed supported rows without
  autoplay; Play selected replaces and starts only the selected displayed
  supported rows. Hidden selections and unsupported omissions remain explicit.
- [x] Music opens the same global queue editor in track and artist/album views;
  no page-local queue or persistent playlist state is introduced.
- [~] Helper/build and TypeScript evidence are recorded by the integrated
  acceptance in
  [occurrence-queue acceptance](occurrence-queue-acceptance-20261009.md).
  The actual-browser repeated-occurrence journey and any failing/untested
  overflow, omission, refresh and navigation cases remain pending until that
  record confirms them. The repeated-occurrence journey and the navigation case
  are now confirmed live on 2026-10-10 in real Chrome: the same file was queued
  twice as two distinct occurrences with equal names, playing the first marked
  only that occurrence current (index 0, exactly one `.current`), the duplicate
  stayed correctly non-current and removable, removing the first repetition left
  exactly the other one, and the transient queue was unchanged across a
  Photos → Music domain navigation. The overflow, omission and refresh cases
  remain unverified.
- [x] Reject interpreting a protected playlist snapshot file as a native
  mutable playlist: upload/source identity supplies no stable current-head/CAS
  behavior. Persistent playlist semantics require their own organization,
  publication/recovery and export review; no new backend or phase is admitted.

**Next product sequence:** review the concrete curated-photo-album and durable
ordered-playlist design against signed publication/import and export contracts,
then admit a named durable slice before writes. Deliver save/reopen/use for each;
do not substitute tags, Notes or local storage for membership. The fixed Overview
was delivered first because it uses admitted current data without inventing a
durable authority. Further presentations and whole-interface shells reuse these
journeys. Runtime loading and a layout editor remain deferred.

### 5. Coherent groups and later depth

- [!] G6 Minimal LinkGroup and group-aware export successor: retain the Phase 4/5 gate and authenticated current-state/import requirements.
- [ ] Deliver the complete Photos/Music baseline above after explicit scope reconciliation; advanced photo discovery and device-listening capabilities remain in the recorded platform roadmap.
- [ ] Refine full interface experiences around these same journeys; palettes remain secondary.
- [-] Runtime plugin marketplace, multi-user tenancy, room synchronization, maps, radio/recommendations and neural compression are outside the immediate daily-use queue.

### Acceptance and stopping rule

Each implementation gets a short user demo, its phase/requirement/exit triple,
focused checks and one practical broad Go run for the integrated source cohort,
as AGENTS requires. Re-run only for relevant changes/failures. This todo changes
no feature status or phase matrix. Stop at the declared journey; do not add
small standalone polish rounds or unrelated platform/package experiments.

## Gates

### G3 — Recovery closure

- [x] Trusted anchor and clean-install import/reader — per the matrix
- [x] Cross-process publication fencing and unknown-outcome reconciliation — per the matrix
- [ ] Sparse extent maps admitted into the closure
- [ ] Broader per-field provenance
- [ ] Production repository qualification
- [ ] Release acceptance
- [x] Read the lock from its current execution-plan checkpoint: admitted trust-anchor and fencing implementations remain tested development evidence; wider release work stays open — see V2

### G4 — Discovery

- [x] Lexical and structured discovery for the stated field scope
- [x] Pinned ONNX/BGE encoder for the opt-in worker profile, with Darwin arm64 evidence
- [x] In-process zvec generation and query for the opt-in component profile
- [~] Fused default search — wired and covered by the provisioned supervised E2E
- [ ] Supported clean-host packaging of the semantic profile
- [~] Candidate package installation, restart, rebuild, and real-query evidence — 2026-10-05 Darwin arm64 real outer-package E2E passes for packaged CLI offline install and daemon restart/reopen plus Chrome Settings rebuild/default fused semantic query; full supported-host/browser installation and release gates remain open. See [dated evidence](semantic-qualification-results.md#automated-candidate-package-lifecycle-2026-10-05).
- [ ] Default-profile qualification

### G5 — Storage

- [ ] Select one candidate repository engine (none selected)
- [ ] Qualify lossless exact round-trip on that engine
- [ ] Measure net savings including indexes, thumbnails, models, caches, and retained sources
- [ ] Decide whether `local-zstd-v1` becomes the qualified compression profile

### G6 — Grouping and export

- [!] LinkGroup catalog schema — unauthorized before G4 and G5 close
- [!] LinkGroup public operation and subject-kind authorization
- [!] Group-aware export successor
- [!] LinkGroup browser workflow
- [!] Portable LinkGroup current-state record
- [~] Saved views and frozen export manifests — work end to end with exact receipts
- [ ] Stable subject and file-version binding in export v1
- [ ] Multi-component group paths in output naming
- [ ] Successor migration for export v1

### G7 — Release

- [x] Packaging — **closed 2026-10-12 for the candidate path, with the qualified
  bundle still open.** `scripts/build-offline-package.sh` builds the CLI and
  daemon with `-tags purego`, stages WebUI assets, and calls the existing
  `scripts/package-offline.sh`; `scripts/accept-offline-journey.sh` then
  extracts that artifact into a prefix that has never held Cairn, verifies all
  20 members against `checksums.sha256` (`OK` for every one), starts the
  installed daemon with no Docker and no first-query download, and reaches a
  healthy empty catalog (`publications=0`). The running instance names its own
  profiles rather than having them inferred: `directory-cas-dev-v1` +
  `identity-v1` + `STORE_EXACT` + `embedding_mode=local` /
  `bge-small-zh-v1.5` / `zvec` + `local-ed25519-v1` signing, with a
  `config_digest` the CLI reports identically, and `capability.list` naming the
  real `query.semantic.onnx-bge-zvec.v1` provider once the packaged offline
  bundle is installed (`semantic bundle install --archive`, one restart). The
  semantic provider honestly reports `UNAVAILABLE` before that install and
  `NOT_BUILT` after it, and never a fixture. What is **not** closed: the
  qualified default semantic bundle, redistribution review, the release SBOM
  (the artifact still declares `INCOMPLETE_NOT_RELEASE_SBOM` at
  `CANDIDATE_ONLY_NOT_SUPPORTED`), and non-Darwin hosts. See the
  [operator procedure](operator-install-backup-upgrade.md) and the
  [dated acceptance record](operator-journey-acceptance-20261012.md).
- [ ] Migration — **still open.** No released artifact from an earlier build was
  available to import, so no old-catalog, old-repository, or old-config
  migration was executed. The upgrade path was exercised against an
  existing *current* catalog and reopened `schema_state=CURRENT
  schema_version=27 binary_version=27` with nothing to migrate; that is
  evidence that this upgrade pair needed no migration, not that version-to-
  version migration works. One known hazard is recorded but not executed: a
  repository holding an ADR-033 part-bound record must be read by an upgraded
  binary, because an older binary refuses such a record outright.
- [x] Backup and upgrade — **closed 2026-10-12 for the candidate path.** The
  executed procedure backs up `config.toml`, `catalog.sqlite`, `repository/`,
  `recovery/`, `vectors/`, and `models/` with the daemon stopped, plus an
  independently retained `recovery export` reference and `recovery anchor
  export` anchor outside every prefix, and proves sufficiency by restoring into
  a **second** fresh prefix: 4 of 4 entries, a passing full-byte verify, and a
  source-vs-restore manifest comparison that is byte-identical. The stronger
  claim also holds: a catalog-free `--recovery-reader` over the repository plus
  the independent anchor reproduces the same exact bytes, and four negative
  controls fail closed — absent anchor (`exit 1`), tampered anchor (`exit 4`),
  a **structurally valid anchor from a different Ed25519 identity**
  (`exit 4`, which shows the retained anchor is the trust root rather than a
  file whose presence is accepted), and an absent reference (`exit 4`).
  In-place upgrade then replaces the installed pair with a freshly built one
  (`cairnd --version` before `v0.1.0-prealpha...dc34fc39`, after
  `offline-upgrade-v2`; binary SHA-256 changed), restarts on the **existing**
  data with the process stopped across the swap, and re-verifies
  `schema_state=CURRENT`, the same 4 entries, full-byte verification, recovery
  import, and a byte-identical restore. Two limits are recorded rather than
  hidden: the catalog must be backed up **quiesced** — measured on this host,
  `catalog.sqlite-wal` held 1,005,312 bytes and an online copy of only
  `.sqlite` reported 0 publications, while a clean daemon stop checkpointed the
  WAL to 0 bytes and the same copy reported 1; and `recovery.import` only
  reconciles a missing publication row against an **existing** namespace root,
  so a lost catalog is **not** currently rebuildable from the repository, which
  keeps the normative "catalog is a rebuildable projection" claim unproven
  rather than violated. See the
  [operator procedure](operator-install-backup-upgrade.md) and the
  [dated acceptance record](operator-journey-acceptance-20261012.md).
- [ ] Performance bounds — **still open.** No measured latency, throughput,
  memory, or net-savings bound was produced by this work.
- [ ] Full release acceptance

## SP-1 — Visual system and desktop shell `[~]`

**Implemented and tested, 2026-10-05:** bounded browser polish adds suffix-
derived type/format cues, localized size/type/format metadata, visible
Photos/Audio scope captions with keyboard details, and responsive toolbar
wrapping. Mixed synthetic-content E2E passed for 1496/1280/1199/1120/1024/707/390
CSS px with no horizontal overflow and the first content row visible; 1280 px
starts within 260 px. Build, web-i18n, Chrome online/offline/recovered, isolated
visual E2E, `git diff --check`, and the independently run purego Go suite passed.
Exact commands, screenshot coverage, fixture limits, and evidence boundary are
in the [decision brief](content-first-product-decision.md#bounded-browser-maintenance-evidence).
This does not close SP-1 or a normative phase/release gate.

Measured 2026-09-29 at 1280x900 after moving the space report and month picker
into compact heading popovers. The first tile was 363 px immediately before this
slice; the original baseline was about 560 px with 159 px tiles and 6 columns:

| Viewport | First tile | Tile width | Columns |
| --- | --- | --- | --- |
| 707 | 286 px | 112 px | 4 |
| 1024 | 222 px | 121 px | 6 |
| 1280 | 222 px | 119 px | 8 |
| 1496 | 222 px | 128 px | 9 |

- [x] First file tile at or before 260 px at 1280x900 — measured 222 px on 2026-09-29, then **regressed** as chrome accumulated. Re-measured 2026-10-10 before the fix: `SP-1 target failed: 1280px first tile is 399px (target <=260)`, exit 1, with 480 px at 707 and 399 px at 1024 / 1280 / 1496; on a phone the wall started at 633 px and the first file's name landed at 822 px, past the 844 px fold, which is the `web-first-use-e2e.mjs` assertion that was failing at 390×844. **Fixed and independently re-verified the same day**: `web-screens.mjs` now exits 0 with `SP-1 target passed: 1280px first tile at 231px (<=260)` and `no horizontal overflow at any captured width` (231 px at 1280, 389 px at 707, 453 px at 390), and `web-first-use-e2e.mjs` exits 0 with the 390×844 first file name at `nameBottom 695.97` (was 891.64) and 1280×900 at `413.81`. The change is presentation-only CSS: the phone header collapses from three stacked rows to two (166.4 → 102.4 px) and the library title plus its three browse-control groups share one wrapping row instead of stacking as three full-width blocks. Accepted tradeoffs of that density: phone top-bar action buttons are 36×36 (≥ WCAG 2.2 AA 24×24, below the 44 px Apple HIG target), the duplicated visible "Browse tools" caption is dropped at ≥641 px while the section keeps its `aria-label`, and the readiness strip's row height goes 26 → 21 px. Still open: the dark theme was not re-captured, the immersive page was only checked for horizontal overflow, and no real-device tap-target measurement was made.
- [x] 8 to 9 grid columns at 1280 px — 8 at 1280, 9 at 1496
- [x] Demote the `全部内容` heading from hero size — now 20 px
- [x] Let `系统字段` share the tag row instead of taking its own line
- [x] No horizontal overflow at 707 / 1024 / 1280 / 1496 CSS px
- [x] Remove the duplicated `内容库` eyebrow above the heading
- [x] Collapse the `UNKNOWN — 健康` banner — now a 26 px strip, was about 34 px
- [x] Move `空间占用` and `按月浏览` into compact heading popovers; expanding either does not move the content wall
- [x] Keep the loaded-listing scope caveat visible inside the expanded space report and timeline popover
- [x] Settings: group spacing at or below 24 px, side-by-side where the width allows — verified 2026-10-10 in real Chrome at 1280×900 and 390×844: the settings body computed `grid-template-columns: 204.797px 833.203px` (two tracks) at 1280 and a single `340px` track at 390, and no `.config-group` / `.config-advanced` / `.identity-disclosure` / `.config-notice` / `.config-section` computed margin exceeded 24 px across all six categories.
- [x] Every settings category fully visible under keyboard navigation — verified 2026-10-10 in real Chrome: all six categories (Appearance, Storage, Search, Notes, Recovery, Service) render visible with no `display:none`, `visibility:hidden` or null `offsetParent`, are keyboard focusable and non-disabled, and clicking each sets `aria-current="true"` with the matching section heading; the 390 px layout hides no category and has no horizontal overflow.
- [x] Settings config error — an instance problem, not a code problem: the preview ran on an ephemeral `/tmp` data root whose `config.toml` was cleaned away. The preview now runs on a durable data root

## SP-2 — Dense content wall, timeline, map `[ ]`

- [ ] Cursor pagination over `search.query` — **measured 2026-10-11** on a real 9,138-item library (`node scripts/web-large-library-check.mjs <image-folder>`): `search.query` for every recorded image (`filters.media_class=image`) returns exactly **1000 hits** in a **503,925-byte** response and offers **no** cursor, continuation, offset, page or total key. The client's own `type:image` search sends only `workspace_id`, `query` and `filters` — no limit and no cursor — and renders all 1000 returned hits, so it asks for and shows one truncated page. The result scope already says so ("These counts cover the returned results, which may be limited; they are not full-library matching totals."); the truncation is therefore visible, but it is not paginated and cannot be continued.
- [ ] Virtualized rendering for large result sets — **measured 2026-10-11 at 9,138 items** in real Chrome: the library wall holds **9,138 `.result-row` elements in the DOM, exactly the 9,138 items `content.list` reports**, and the Photos wall holds **9,100 `.photo-card` elements** for the 9,100 image-suffix items. Nothing is windowed: the whole library materializes (wall load 26,264 ms; JS heap 256.8 MiB used / 306.5 MiB total; Chrome process-tree RSS 749.7 MiB over 8 processes; the `content.list` response is 4,689,018 bytes requested with `workspace_id` alone). **Re-measured 2026-10-11 on the same real folder after the bounded-page and startup-sequence work, now at the whole 11,561 entries:** all 23 non-empty subfolders publish (ADR-033 lifted the per-publication entry ceiling), and the wall holds **81 `.result-row` elements** in the DOM for the daemon's 11,561 entries — windowing and the bounded first page both hold. Wall load **7,584 ms** against **21,368 ms** for the identical library and the pre-change bundle, page-load long tasks **1 (largest 91 ms, 41 ms blocking)** against **4 (largest 141 ms, 156 ms blocking)**, JS heap 30.0 MiB used, Chrome process-tree RSS 682.3 MiB over 8 processes. **The startup-sequence half of the cost was separate and is now measured per command** (`scripts/web-startup-breakdown.mjs`, same library, sequential, no browser): `status.get` **6,892 ms → 1,437 ms** (median of three) and `snapshot.list` **8,080 ms → 1,785 ms** for the identity projection and **2,044 ms** for the `latest` projection, while `content.list` (page 1, 115,393 bytes), `source.list`, `annotation.list`, `capability.list` and `job.list` all stay under 200 ms. Both slow commands walked **every** committed publication's part-bound manifest — 23 publications, 11,561 manifest entries, 85 MB of prepared-closure envelopes and 51 MB of entry parts — to report one count or one summary. `status.get` now counts authenticated commit markers plus each prepared closure head, and `snapshot.list` accepts a bounded `projection` (`identity`, `latest`) that leaves an entry-derived count **absent rather than zero**; `audio.list`, which walks every admitted processor artifact, is now read only when the Music or Content-overview presentation is selected.
- [ ] Stable scroll restoration when returning from a detail view
- [ ] Thumbnails served as `ArtifactRef` through content access — still not implemented; a thumbnail remains a transient browser rendition over `content.open` + `content.read`. Measured 2026-10-11: the library wall issues **96 preview requests** for the whole 9,138-item load (the bounded 48-item eager window, two operations per image) and **0 more** while scrolling that wall to its end; scrolling the 9,100-card Photos wall to its end added **99** further requests, because a candidate above the 1 MiB automatic-thumbnail budget is read only while its card is visible. The bound is real; what is missing is a served `ArtifactRef`.
- [ ] Timeline view over the existing date facet
- [ ] Map aggregation from stored coordinates, with no new durable table
- [ ] Exit: a 10k-image fixture wall scrolls without full materialization — **fails as measured on 2026-10-11.** The largest library reachable from the operator's real 1.8 GB / 11,561-image folder under the 16 MiB per-publication bound is **9,138 entries**: 20 of its 39 immediate subfolders published, 16 were empty, and 3 were refused by `plan.ingest` for 836, 780 and 816 entries (their image-only subdirectories hold 831, 775 and 811 files and are still above the bound), so 10,000 items was not reachable without splitting an over-ceiling folder, which this measurement did not do. At 9,138 items the wall rendered every item (see the virtualization row) and did scroll its whole 203,463-pixel height with real wheel input in 11,229 ms, but that scroll produced **70 main-thread tasks over 50 ms (largest 520 ms, 4,734 ms total blocking, largest frame gap 517 ms)** and opening Details on a visible row cost **5,654 ms to click plus 1,112 ms to render**. The "without full materialization" half of the exit test is false, and the wall is heavy even where it does work. **Re-measured 2026-10-11 at the full 11,561 entries with `node scripts/web-large-library-check.mjs "$HOME/Downloads/Pinterest"`, before and after the startup-sequence change and against one identical kept library:** wall load **21,368 ms → 7,584 ms**; page-load long tasks **4, largest 141 ms, 156 ms blocking → 1, largest 91 ms, 41 ms blocking**; the library wall scrolled its whole 257,552-pixel height with real wheel input (86 steps, 5,664 ms → 6,363 ms, bottom reached both times) with **1 long task, largest 64 ms → 0 long tasks** and largest frame gap 50 ms → 33 ms. The "without full materialization" half is still false — the DOM is windowed to 81 rows, but the wall still holds the whole loaded listing in JS and 48 thumbnails are still read eagerly — and **the post-scroll Details click fails identically before and after** (`locator('.result-row').first().locator('.result-open-copy').first()` times out after 30 s once the scroll reaches the bottom, because the harness falls back to row 0 when its visible-row probe returns -1 and the windowed wall no longer mounts row 0). That failure is pre-existing and unrelated to this change; it is recorded rather than papered over.

Current limit: explicit image inspection handles PNG, JPEG, GIF, and WebP up
to 8 MiB after complete byte verification; automatic thumbnails remain 1 MiB
and text remains 64 KiB. Larger content keeps the existing original-download
or export route. This is the bounded inspector, not an album surface.

## SP-3 — Ingest and workflow closure `[~]`

- [x] Similar-candidates daemon scan and grouping
- [~] Similar-candidates browser surface
- [ ] Query by image (Phase 4)
- [ ] On-demand AI notes through the egress gate (Phase 4)
- [x] Existing bounded loopback upload — 2026-10-05 Chrome checks file selection and library drag/drop, daemon-reported identity, staging outside protected content, and explicit digest-bound exact save. Server-folder review remains available. Transport bounds stay with the normative API contract; the historical ADR-013 proposal does not override them. See [core preview evidence](core-preview-acceptance-20261005.md).
- [x] Single-file original download — scoped existing content sessions, full identity checks, bounded native browser download, visible refusal, cancellation/reader tests, and 390px actions; no bulk/group export qualification credit.
- [ ] Honest unavailable states on every new surface

## SP-4 — Retrieval quality `[~]`

- [x] Correct the stale V4 narrative using implementation and current local evidence — see V1
- [x] Verify the embedded Unihan table, input digest, and generator; retain Unicode License V3 notice without regenerating the data
- [x] Existing pinyin and initial tokens in the lexical feed
- [x] Isolated real daemon: `lvxing` / `lx` finds the intended `旅行` subject; `西湖` / `xihu` matches inside `杭州西湖的备份方案备忘`
- [x] Coverage vocabulary and lexical profile digest unchanged by the attribution correction
- [~] Positive duplicate/locator, structured/fused, segment, and rebuild checks remain separately scoped; the full Phase 4 gate is open. See [current local evidence](local-completion-acceptance-20261006.md).
- [x] Lexical source explanations respect selected fields and preserve Chinese/pinyin/initial provenance on the same index; real daemon 9-query regression passes. Long split-document and accent-token provenance remain open. See [retrieval and accounting acceptance](retrieval-and-accounting-acceptance-20261006.md).

## SP-5 — Music experience pack `[ ]`

- [!] Blocked on G4 for audio facets and G6 for collections
- [ ] Audio metadata as declared, versioned, namespaced fields
- [ ] Mood as a durable user tag plus a saved query preset
- [ ] Radio behaviour as a query over listening history and co-listening
- [ ] React library surface borrowing the reference visual language
- [-] A player inside the daemon; a learned mood or energy classifier; a new audio codec; multi-room sync; adaptive streaming; external acquisition; DRM

## SP-6 — Music video link `[ ]`

One link per track: a local video subject, or an external reference. This is a
small durable field, not a subsystem, though adding a durable field still
passes the ordinary schema checkpoint.

- [ ] Record the link: a relation to a local video subject, or an external reference
- [ ] Local video matching: filename contains the music filename, or the track title plus first artist, or the video id in the comment tag or filename, ignoring symbols and whitespace
- [ ] External reference rendered through the provider's official iframe, labelled external and unprotected, and showing unavailable instead of substituting another source
- [ ] One player surface: switching cross-fades into the video with the artwork reused as a blurred full-bleed background
- [ ] Exit: a linked local video is found, protected, verified, and restored; an unreachable reference substitutes nothing
- [-] Download, cache, re-host, or anti-leech and referer circumvention; external streams inside the recovery closure

## SP-7 — Photo and album experience pack `[ ]`

- [!] Blocked on G4 and G6
- [ ] Dense wall from SP-2
- [ ] Album-fill suggestions, each carrying its reason, with batch-scoped undo
- [ ] Deletion triage with protected classes unchecked by default
- [ ] Exit: nothing pre-selected; similarity never establishes identity and never authorises deletion
- [x] Boundary settled: adjacent products stay clients and no durable state is duplicated (ADR-014)
- [-] A duplicated photo-management stack; face recognition; automatic sharing; destructive normalisation

## SP-8 — Listen and watch together `[ ]`

- [!] Blocked on V4: the reference app's synchronisation protocol and a self-hostable server are unverified. D5 settled that it stays a client capability (ADR-015)
- [ ] Keep the first cut simple: one host, a few guests, drift correction only
- [ ] Research the protocol and a self-hostable server before scheduling
- [ ] Client-side ephemeral room and presence state
- [ ] Position and drift coordination only
- [ ] Exit: two clients stay within a stated drift bound; stopping the sync service leaves local playback correct; no durable row and no core command added
- [-] Room state in the daemon; any durable room, catalog, or recovery state machine; Cairn as a streaming service

## Verification and honesty

- [x] Install Playwright and add `scripts/web-screens.mjs` for self-serve visual capture
- [x] V5 — An opted-in `scripts/web-e2e.sh` now fails nonzero for missing prerequisites or Playwright before builds. Explicit opt-out remains a visible skip. Current full browser results are recorded in [continuation evidence](local-completion-acceptance-20261006.md); old skipped runs earn no acceptance credit.
- [x] V6 — Ordinary Go success may include real-provider skips. The real daemon test also requires `CGO_ENABLED=1`, build tags `purego supervised_integration`, `CAIRN_RUN_SUPERVISED_ONNX=1`, and real model/tokenizer/runtime/zvec assets; verify a named test actually ran rather than accepting `[no tests to run]`; package and real-daemon query evidence is recorded separately from the broad Go run.
- [x] V7 — `server/internal/api/static.go` no longer freezes the startup copy. The validated in-memory snapshot is reassembled when the root's immediate children change, so a rebuilt WebUI is served with no restart, while a tree that fails validation is never served. Covered by `TestStaticHandlerServesRebuiltRootWithoutRestart` and `TestStaticHandlerKeepsLastValidatedSnapshotOnInvalidRebuild`, and proven live against the running daemon (create, rewrite, delete, and a full rebuild all reflected without a restart). See ADR-016
- [x] V1 — Replace contradictory V4 backlog prose with the implemented feed and dated real-daemon acceptance; no new profile or qualification claim.
- [x] V2 — The lock preserves the tested admitted Phase 3 profile and directs remaining release work from the execution-plan checkpoint. Do not repeat implemented anchor/fencing foundations, award release credit, or unlock Phase 6 from this ledger.
- [ ] V3 — Verify Musly's licence (Namida's EULA is confirmed and forbids reuse)
- [ ] V4 — Verify the reference app's synchronisation mechanism
- [x] Fix the `web-screens.mjs` layout heuristic, which measures the left nav rail and reports a constant 166 px — re-measured 2026-10-10 against a live isolated daemon: the reported symptom does not reproduce as described. `measure()` reads `.result-list:not(.list-mode) .result-row` and returned 635 / 480 / 399 / 399 / 399 px at 390 / 707 / 1024 / 1280 / 1496, not a constant; the 166 px figure matches the `header.topbar` height at 390 px, not a rail measurement. A different, real defect in that harness was found and fixed instead: it waited on the obsolete `.library-view-switch` selector and targeted `[data-view="photos"|"music"]`, which the current app does not render (the media switch is now `.library-presentation-navigation__domain[data-domain="cairn:photos"|"…:music"]`). Every media capture timed out, and because the settings walk runs after it, the settings captures were silently skipped too. Resolving the domains at runtime raised one run from 23 to 83 captures, including Photos, Music and every settings category. The harness now also reports its SP-1 enforcement instead of only printing it.

- [x] Frozen content fixture for the browser acceptance scripts — closed 2026-10-10 by `scripts/web-fixture-seed.mjs`, which builds a self-owned temporary profile, synthesizes its content deterministically in pure Node (three PNG, one of them a genuine 4096x3100 / 12.7-megapixel file over the client decode ceiling, plus a real baseline JPEG that macOS ImageIO reports as `format: jpeg`, three real PCM WAV files and one text file carrying 253 real bytes), ingests it through the ordinary `plan.ingest` + `plan.apply` path, stars exactly one photo and one audio track with the ordinary `Favorite` TAG after checking the tag list holds exactly those two, saves one view whose conditions this build supports after checking it evaluates to hits, serves the current `web/dist` with an absolute `--web-root`, and fails loudly on every missing prerequisite rather than skipping. It stops its daemon and deletes its temporary profile on success, failure and signal. Verified by running every acceptance harness against a freshly seeded instance: the eleven URL-driven ones and the self-contained `web-audio-unsupported-check.mjs` all exit 0, and cleanup was confirmed (listener released, no stray process, no temporary profile). Two limits are recorded rather than solved: the self-contained harness takes no URL, so the shape is eleven URL-driven plus one self-contained rather than twelve URL-driven; and because `web/dist` and `web/node_modules` are gitignored, a fresh checkout still needs `cd web && npm ci` (and a client build) before any harness can run, which the seed refuses on rather than fixing. The fixture ships no ONNX/BGE bundle, so its semantic search reports unavailable and must not be cited as semantic-retrieval capability evidence.
- [x] Real semantic retrieval verified end to end — 2026-10-11. `TestSupervisedONNXSemanticQualification` passes against the real pinned BGE bundle through the real supervised worker path: status PASSED, profile `bge-small-zh-v1.5`, dimension 512, eight corpus cases, **Recall@1 = 1 and Recall@5 = 1**, query P50 23.6 ms and P95 39.3 ms at concurrency four, document batch 34.6 ms, worker startup 5.75 s, peak sampled RSS 371 MB, total 10.6 s. The test is opt-in by design (`CAIRN_RUN_SUPERVISED_ONNX=1` plus a bundle root), which is why earlier passes recorded it as unverified rather than passing. What blocked it was the Cairn rename: the bundle on disk declares `restoreweave.semantic-bundle.v1`, which the renamed admission path refuses. There is **no pinned profile digest anywhere in the tree** — the pins are per-asset content digests (model, tokenizer, runtime, zvec, ONNX C API header, zvec-go receipt) plus descriptor self-consistency — and the rename changes no asset bytes, so the bundle was migrated by rewriting **only** the schema discriminator in a copy under `/tmp`: all twelve assets were verified byte-identical to the source by SHA-256 before the run, and `dist/` was not touched. Two limits stay open and are not papered over. First, the installer and download path is still unverified here, because this environment cannot reach the model host (`curl: (35) Connection reset by peer`), so what is proven is the model, tokenizer, runtime and admission path, not provisioning. Second, the profile digest is computed over a payload that begins with the schema string, so the rename changed it; nothing in the tree pins it, but any release-pinned profile digest published later must be regenerated rather than carried over.
- [x] ADR-032 Stage 2a, presentation packages as pure data — implemented 2026-10-10 and verified against its own exit test. A theme package is one JSON document of design tokens: no JavaScript, no components, no CSS text, nothing executable. Admission (`web/src/lib/presentationPackages.ts`) is a pure function over the decoded document, the build-time-injected application version, and the ids already in use, and it returns either the whole package or one refusal carrying a stable code — there is no partial admission. Unknown manifest fields are refused, so a document declaring `css`, `script` or `components` is rejected whole rather than admitted with the executable-looking part dropped. The allowlist of forty-two design tokens plus a forbidden-value rule (`;`, `{`, `}`, `@`, quotes, backslashes, control characters, `url(`, `expression(`, `image-set(`, `javascript:`, `/*`, `!important`) is the security boundary: values reach the document only through `style.setProperty`, a property assignment that a value cannot terminate, so a package cannot position an overlay, load a remote resource, or open network access. A built-in id cannot be reused, so an installed package can never shadow a built-in palette. A stored theme id survives only when it is built-in or proven by admission, which closes the hand-edited-localStorage path into `data-theme`. Tokens written by the previous package are removed before the next apply, so a stale override does not outlive the package that declared it. Verified: typecheck and build exit 0; the i18n check exits 0 at 1869 keys; `scripts/web-presentation-package-check.mjs` exits 0 across admission, host-range refusal, an unadmitted token, a declaration-escaping value (observed external requests: none), a built-in id collision, a code-bearing manifest and an absent index, with the three built-in palettes working in every case; and the recovery and export path is unchanged — the saved-retrieval provenance check and the full first-use journey (stage, STORE_EXACT, name search, tag and Notes, tag search, Notes search, SHA-256-verified original download) both exit 0. The build-composition gap in the first cut is closed: the source of truth is now `web/public/presentation-packages/`, which Vite's public directory carries verbatim into the served root, so a client rebuild preserves installed packages instead of destroying them (proven by identical SHA-256 for the source and built index and theme files). `web/vite.config.ts` admits every source package during the build by calling the same exported `admitPresentationPackage` the runtime uses, so the logic is not duplicated, and it runs before the public directory is copied, so a refusal leaves the previous output intact. A refusal fails the build and names the file and the reason; verified for a host range the application does not satisfy, a package present on disk but absent from the index, an index entry listed twice, and a token value that could escape a CSS declaration. One polished example theme ships as a real selectable theme and as the reference implementation, `community:inkstone-indigo`, which sets forty of the forty-two tokens and is admitted and visibly applied. A package may now also declare one value set per appearance, so an installed theme matches a built-in palette's capability instead of rendering one palette under light, dark and system. The manifest keeps `tokens` as its only token field: a flat map behaves exactly as before, and a map whose keys are `light` and `dark` is read as two value sets. The discrimination is sound rather than heuristic because every admitted token name begins with `--`, so a bare `light` or `dark` key can never be a token. Both sets are required — declaring only one would occupy the theme id while leaving the other appearance to a built-in palette, which is partial application and therefore refused whole — and mixing flat token names with the two sets is refused whole. Every value set passes the same allowlist and the same forbidden-value rule through one shared path. The effective appearance, not the stored preference, selects the set, and tokens written by the previous apply are removed before the next, so a token declared in only one set disappears when the other appearance takes over. The example theme now ships a genuine pair (a paper-white light variant at 14.42:1 body contrast and the original deep-ink dark variant at 15.94:1) with four swatches. Verified in the browser: the same installed theme renders `--canvas` `#fdf7ec` under light and `#151109` under dark, paints text `rgb(36, 29, 18)` versus `rgb(246, 236, 217)`, and a token declared in only one set returns to its compiled value under the other. One recorded claim was disproved by measurement and corrected rather than left standing: an earlier note held that `color-scheme` stays dark under an installed theme's light palette, which would have left native controls dark. Measured, an installed theme reports `color-scheme: light` under light and `dark` under dark, because `base.css` derives it from `data-appearance` through a rule that is not scoped to a theme; the note was corrected and the behaviour is now asserted in the harness so it cannot regress silently. Stage 2b (interface shells as build-time code packages) and Stage 3 (untrusted runtime code, which needs iframe isolation and a signing story) remain unauthorized.
- [~] An internal id still renders in one diagnostic disclosure. `SettingsDialog.tsx` shows the raw `workspace_id` as the value of the "Runtime identity" advanced disclosure (its label was renamed to "Content scope" on 2026-10-10). It sits beside the configuration path, running and persisted digests, and the service socket, so it reads as a diagnostic panel rather than an ordinary workflow; the North Star forbids requiring users to know internal ids in normal workflows, which this does not. Removing or masking the value is a behaviour change and is left as a decision rather than done silently.

- [x] A single publication is bounded by one portable-record ceiling, and an unplaceable publication is now refused before any write instead of being launched and abandoned. Measured on a real library — 11,561 images, 1.9 GB, in one tree — the largest portable record that could be placed was 16,310,074 bytes for a 742-file batch, about 22 KB per entry, while a 775-file batch and an 831-file batch both failed with `UNKNOWN_EXTERNAL_OUTCOME` / `NEEDS_RECONCILIATION` and the message "portable record exceeds 16777216 bytes". The bound is `repository.MaxRecordBytes` (`16 << 20`), now stated normatively where an operator looks (`docs/requirements/content-store-views-and-exports.md` §3.2, `docs/requirements/cli-and-mcp-contract.md` §6) and still enforced at placement. It bounds **entries**, not stored bytes, because the closure carries per-entry facts rather than payload, so a thousand small text files fail exactly as a thousand photographs do; a fixed entry count is therefore not a usable sizing rule and none is implemented. `plan.ingest` and `plan.revise` now project the two entry-scaling records from the same captured facts the apply path uses (`projectPublicationRecords` in `server/internal/exact/recovery_publication.go`) and refuse as ordinary `invalid_input` before `ensurePlanningSource` writes anything, naming the entry count, the projected size, the limit and the remedy to ingest subfolders as separate sources. The prepared closure and the manifest-derived portable fact child are projected exactly (same builders, same JSON encoding, same-width placeholders for identifiers and digests that cannot exist before apply); the post-publication child also carries records that only exist after processing runs, so those are charged a measured 6 KiB per processed file — a conservative model, not a proof, that over-reports the manifest-derived part by at most 512 bytes. Verified: `go test ./server/internal/exact/ ./server/controlplane/` green, including a test that the projection equals the records actually placed when no processor is bound, a test that the refusal leaves no workspace, source, plan, job, publication, namespace, audit or repository record, and a test that a publication projected above 90% of the bound is still planned, applied and placed under it; on the real tree `cairn ingest` now exits 4 with "applying this plan would place a 258087737-byte portable recovery record for 11713 entries, above the 16777216-byte repository record limit; ingest subfolders as separate sources so each publication stays under the limit", and the same projection accepts the 742-file batch that really fit while refusing the 777- and 833-file batches that really failed. The workaround remains the remedy: `ensurePlanningSource` keeps one workspace named "default" and one source per root keyed `local-tree:<root>`, so subfolders ingested separately accumulate one library (23 batches for this tree, every one under the ceiling). Residual, by deliberate boundary: the ceiling is not raised and the closure is not chunked or merkleized, so a single publication above roughly 750 entries is now refused with advice rather than split; and because the post-publication child depends on processing that has not run, a capability that emits materially more per file than the measured profile can still reach the placement refusal, which stays as defence in depth. Lifting the entry ceiling with a chunked or merkleized closure is a separate, separately reviewed contract. Throughput is unchanged and separate: batched ingest ran at roughly five files per second, so a 100,000-item library remains an overnight job even when batched.
- [x] Lifting the per-publication entry ceiling — closed 2026-10-11 by ADR-033, which splits an oversized record into content-addressed parts bound by the already-signed logical digest, length and counts. One source root now publishes as one publication with one namespace root, so **no projection query, index key or migration changed** — the latest-root projection stays correct, which is exactly why the bounded-instalment alternative was rejected: an instalment is its own publication with its own root, and draining a real folder left the client and index showing only the last batch (measured at 152 of 888 published entries indexed). Measured on the real 11,561-file / 1.9 GB folder: one publication, one root, `content.list` reporting 11,561 entries complete, the lexical index READY over all 11,561, 25 parts with a largest of 16,711,479 bytes under the 16,777,216 limit, and a 1,233,030-byte recovery reference that a catalog-free reader verifies byte for byte across all 1,907,860,378 bytes. `MaxRecordBytes` was not raised, and a single logical item too large to split is still refused. One operator-visible consequence is recorded rather than hidden: an older binary refuses a part-bound record outright instead of misreading it, so a repository holding one must be read by an upgraded binary.
- [~] Harness note, not a product defect: `cairn config init` writes a config whose catalog and repository point at the standard user data directory (`~/.local/share/cairn`), which is correct default behaviour but means a scripted throwaway profile must pass `CAIRN_CATALOG` and `CAIRN_REPOSITORY` (or the matching daemon flags) or it will write into the operator's real library. A measurement run here did exactly that and placed 2.4 GB there before it was noticed; the directory was confirmed to hold nothing but that run's own sources and was removed. `scripts/web-fixture-seed.mjs` already does this correctly through those environment variables.

## Operator decisions

All five were settled on 2026-09-28 and are recorded as ADRs.

| ID | Decision | Outcome | Record |
| --- | --- | --- | --- |
| D1 | Upload limits and whether loopback uploads may run tokenless | No product-owned quota and no default size limit; one optional limit, unset by default; tokenless on loopback only, token required otherwise | ADR-013 |
| D2 | External video boundary | Official iframe embed only; never in the recovery closure | ADR-012 |
| D3 | Whether an adjacent on-device photo product becomes a client | Separate product acting as a client; no merged or duplicated durable state | ADR-014 |
| D4 | MV relation timing | Wait, and reuse the sidecar-of-media shape | ADR-012 |
| D5 | Whether SP-8 is in the product | In, as a client capability over a user-deployed service; never in the daemon | ADR-015 |

## Decision records

Settled items are recorded as ADRs in
[Build Stack and Architecture Selection](build-stack-and-architecture-selection.md#8-decision-records-adr-style):

| ADR | Decision |
| --- | --- |
| ADR-010 | Flexible domain fields without a second store |
| ADR-011 | One browser stack — borrow the design language, not the framework or the code |
| ADR-012 | External media is a convenience reference and never enters the recovery closure |
| ADR-013 | Upload channel bounds and the loopback token rule |
| ADR-014 | Adjacent products stay clients; durable state is not duplicated |
| ADR-015 | Together-mode is a client capability over an external synchronisation service |
| ADR-016 | The WebUI snapshot is revalidated when its root changes |

## Out of scope

Players, readers, and transcoders inside the daemon; mount or network
filesystem services; an OpenList fork; new index dimensions; richer
Collections; automatic external acquisition; source deletion; destructive
garbage collection; third-party video streaming inside the daemon; scraping or
re-hosting third-party video; a second live metadata store or any NoSQL
document database.
