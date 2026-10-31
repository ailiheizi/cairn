# M5 Music Daily Use Implementation Plan

> **For agentic workers:** Use subagent-driven development; Luna implements,
> root decides and reviews. One runner owns the whole-feature journey. Follow
> Cairn testing: integrate first, then verify the useful outcome.

**Goal:** Save an ordered listening queue as ordinary material, find it again
inside Music, and listen or take out the originals without rebuilding it.

**Architecture:** Compose the App-owned occurrence queue, ordinary ML-1 composer
and reviewed capture, Music's existing presentation, and the ML-2 Reader/actions.
There is no playlist database, mutable list head or persistent listening session.

**Tech stack:** Existing React/TypeScript client and host command adapter.

**Spec:** [ML-1/2](../../technical/material-list-client-contract.md) and
[first-party client contract](../../requirements/first-party-client-experiences.md#ml-2-use-saved-lists-through-existing-host-actions).

## Phase, requirement and one exit

Active phase is the admitted first-party client track alongside Phase 4/5.
ML-1/2 and UX-Q1 require exact-reference resolution, ordered repeated occurrences,
explicit snapshot capture, bounded verified playback and unique-original takeout.
This is the selected deeper M5/F15 delivery after the completed S1 baseline;
it neither closes M3 nor awards any core phase or release qualification.

**Whole-feature exit:** A/B/A queue -> review/cancel without changing listening
-> explicitly save one three-occurrence ordinary snapshot -> refresh -> find
the candidate inside Music -> explicitly validate/read -> play and advance
through A/B/A -> append -> take out two unique originals and compare their bytes
with independent sources -> return through other presentations without losing
the active player. In the same journey, demonstrate honest over-limit and
unresolved exits and metadata-only candidate listing.

## Decisions and limits

- Saving selected/displayed tracks and saving the current queue are separate
  explicit actions. The queue action freezes its current order and repetitions;
  saving or cancelling must not replace, stop or reorder listening.
- Resolve each queue occurrence against current host-loaded catalog identity
  and length. Local handles are hints. Any unresolved occurrence disables the
  entire snapshot action; do not guess a replacement or silently drop a row.
- Queue stays transient with its existing 1,000-entry ceiling. Ordinary lists
  retain 200 occurrences / 512 KiB JSON / 64 KiB Skill limits; more than 200
  queued entries are refused, never truncated to fit. Existing verified
  playback remains at 32 MiB per original.
- Music adds one on-demand Saved lists subview over host-loaded regular files
  ending in `.cairn-list.json`. Names identify candidates, not validated format
  or music-only membership. No candidate body is read until explicitly opened
  through the existing Reader. This subview does not change shared search scope
  or infer completeness beyond loaded content.
- Reopen the existing Reader directly inside Music after an explicit candidate
  click, with a return to candidate files; avoid unrelated Details metadata. Reuse
  list playback/append and frozen unique-file takeout. Repetitions play in order
  but repeated file targets are exported once; output order is not promised.
- No backend, schema, provider, endpoint, new media read authority, automatic
  tag write, runtime loader, native playlist or browser-local membership store.
- Why this stage: the missing queue-to-reuse handoff interrupts everyday
  listening. A complete save/find/use loop improves product value more than
  continuing unrelated small recall adjustments inside F03.

## Implementation and delivery

- [x] `main.tsx` and `AudioPlayer`: one queue-snapshot host action, exact loaded
  resolution, existing composer/dirty guards and visible refusal reasons.
- [x] `MusicLibraryExperience`, Music props and Library host: one compact saved
  candidate entry/subview, host catalog input and inline existing Reader entry.
- [x] Affected styles/translations: clear primary listening actions; list and
  management information on demand. Existing selected/displayed saving remains.
- [x] Integrate the whole stage, build Web once, run the named journey with
  real audio and independent original hashes; diagnose actual failures only.
- [x] Root reviews diff/screenshots, runs `git diff --check`, records usable
  outcome and remaining gaps, syncs F15/M5 and commits/pushes authorized work.

## Remaining after this stage

Lyrics, automatic cultural context, streaming/transcoding, playback history,
native playlists and automatic list refresh are not delivered here. M3 recall,
M9 takeout/recovery and M10 setup keep their actual separate status; M8 future
apps do not enter implementation because of this Music stage.

## Delivered — 2026-10-31

Luna implemented the integrated client and ran the single selected journey;
root reviewed the actual diff, logs and screenshots, with an independent Luna
read-only review finding no blocker. Web compiled with only the existing
large-chunk warning. No backend build or unrelated suite ran.

The real MP3 A/B/A queue produced three ordered occurrences in the composer.
Cancelling preserved the paused source and 0.94s position. One explicit reviewed
capture saved `Music daily queue 20261031.cairn-list.json`, 1,050 bytes,
SHA-256 `4f6d2ca1c7cb25729fea523475b2da32f8b0c39471dab8a1802ab9e1ff3e6e22`.
Refreshing cleared the live queue/source but retained that ordinary file.
Music candidate listing made no original-file read; the explicit click loaded
and validated the same snapshot directly inside Music. Actual playback advanced
through distinct occurrences 1→2→3 (A/B/A), and append retained the first sequence.

The ZIP contained exactly the two unique original targets. Both matched their
independent input lengths and SHA-256 digests: A, 20,820 bytes,
`b62bffa19699f63ee2b5d46e05e7d5935e9fb2beb74aaf6a2773a6cf734ffef3`;
B, 20,857 bytes,
`65b8d3b0598caa3cd07d403201e659338f9227161641151e89490c66d356a520`.
An existing unresolved list retained its missing row and disabled whole-list
actions. A 201-occurrence queue was refused without a partial draft, capture or
queue change. Photos→Music return preserved source, paused position, queue and
saved-list candidate context. Reader viewport, document and body widths were
all 1,440px.

Evidence lives in ignored `dist/music-daily-20261031/`: `build.log`,
`capture-stage.log`, `journey-resume.log`, `return-continuation.log`, the reused
journey driver and screenshots. The initial helper needed Chrome/selector,
empty-player and original-download-observer corrections; the already successful
capture and original takeout were not repeated. No product changes were needed
after the selected build. The isolated acceptance daemon stopped; the user's
4670 preview remained live and loads this Web build on refresh.

One layout observation remains outside this stage's completed Reader flow:
the composer screenshot with underlying Music management expanded measured
2,008px across a 1,440px viewport. This is not evidence of a Reader overflow;
its cause was not isolated against the previous build and remains a concrete
composition gap, not a claim that all Music
layouts or the entire mature-player feature set are finished.
