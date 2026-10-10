# Occurrence-aware listening queue — local acceptance, 2026-10-09

## Scope and authority

This implements the admitted **UX-Q1** client slice under
[First-Party Personal Client Experiences §13](../requirements/first-party-client-experiences.md#13-ux-q1-occurrence-aware-listening-and-batch-queue-actions)
and [ADR-031](build-stack-and-architecture-selection.md#adr-031-occurrence-aware-transient-listening-and-music-batch-actions).
It advances one existing transient listening workflow. It grants no core phase,
portable-format, deployment or release credit.

The executable journey is: append A/B/A without autoplay; explicitly start;
Next reaches B and the second A; reorder while paused and remove the other A;
append selected/displayed rows without interrupting playback; retain the queue
across Photos navigation; clear the sequence without deleting or stopping the
current original; Stop and browser page reload respect the existing lifecycle.

Music supplies ordered displayed candidates to the App-owned queue. Every
insertion has a new transient occurrence identity, distinct from file identity.
There is one audio element and one editor. The helper refuses actions exceeding
1,000 entries atomically. No backend, catalog, signed record, persisted session,
processor or provider-profile change is included.

**Native playlist save/reopen/edit remains NOT IMPLEMENTED.** An exact-preserved
playlist document cannot substitute for stable native membership and current
state. The [organization design review](durable-media-organization-design.md)
records the remaining admission work. This slice also grants no curated-photo-
album or complete Photos/Music acceptance.

## Local browser evidence

The ordinary listening journey used actual locally preserved MP3 originals
`Tagged-test-A.mp3` and `Tagged-test-B.mp3`, decoded by the in-app browser.
The retained test library has 17 synthetic QA files in six sources, including
six audio rows. It is not a representative personal NAS library.

Evidence is retained below
`dist/occurrence-queue-20261009/validation/` in this checkout. DOM/audio observations
are read-only; interactions used the rendered controls. No catalog mutation was
required for this queue acceptance.

| Case | Result | Retained evidence and boundary |
| --- | --- | --- |
| Append A/B/A without autoplay | PASS | `inserted-aba.json`: three numbered occurrences; audio paused with no source. |
| Explicit start and manual Next B → second A | PASS | `next-b.json`, `next-repeated-a.json`: the active occurrence advances through positions 2 and 3 with decoded original Blob sources. |
| Paused reorder and targeted removal | PASS | `reorder-remove-state.json`: moving the second A and removing the first leaves A/B; active A remains disabled for individual removal; the same Blob and 0.352531-second position are retained. |
| Selected append under local filtering | PASS | `selected-filter-append.json`: A/B remain selected, search displays A only; one hidden selection is explicitly excluded; only A is appended and playback remains paused at the same source/position. |
| Escape closes editor without clearing selection | PASS | Observed during the integrated journey: editor closes, focus returns to its summary, and the two-item selection remains. No independent raw capture was retained for this case. |
| Play selected, then append displayed six tracks | PASS | `batch-append-state.json`: explicit selected playback replaces the queue with A/B; appending the displayed six grows it from 2 to 8 and retains the paused Blob at 0.966547 seconds. |
| Navigate to Photos | PASS | `photo-navigation-state.json`: the same eight-item queue, single audio element, source and paused position survive presentation navigation. |
| Clear sequence while original is paused | PASS | `clear-queue-keeps-playback.json`: count becomes zero while source and position remain; Stop stays available. This does not delete bytes. |
| Browser reload from a nonempty queue | Pending final-client capture | A reload after already clearing the queue is insufficient proof; final nonempty-before/empty-after evidence is required. |
| Readable narrow and desktop queue controls | Pending final-client capture | Final build corrects obsolete positional CSS sizing and gives the name button its full grid column. |
| 1,000-entry refusal, invalid input and unsupported counts | PASS in helper; browser NOT RUN | `queue-check.log` verifies whole-action refusal, distinct occurrences and filtering. It does not prove live hook overflow/fault races. |

Natural-completion repeat behavior, live overflow and unknown-size refusal,
workspace-switch cancellation, stale fetch and recovery/fault paths were not
re-executed in the browser for Q1. Earlier slice evidence is historical, not
current Q1 proof. These limits remain visible; full UX-Q1 fault acceptance and
full-domain acceptance remain open.

## Automated checks and candidate identity

- `node scripts/web-playback-queue-check.mjs`: PASS for occurrence identity,
  repeated advancement, targeted edits, shuffle, repeat, filtering, allocator
  validation and atomic 1,000-entry limits.
- `node scripts/web-i18n-check.mjs`: PASS for 26 partial catalogs, 1,854 merged
  keys and literal coverage in 78 client source files.
- `npm run build` in `web`: TypeScript and production Vite build PASS.
- `go test -tags purego ./...`: PASS once for the integrated source cohort.
  Subsequent corrections affect only queue CSS and documentation; no redundant
  Go rerun is required by this slice.
- Final whitespace and served-byte identity checks are recorded with the
  completed candidate below.

The working tree already contains extensive unrelated implementation. Evidence
is for the stated integrated dirty checkout, not a clean commit or release.
The local daemon and its persisted configuration were reused unchanged; only
the served client assets were replaced. Final asset hashes and checkout identity
are retained in `validation/artifact-identities.json`.

The functional journey initially used `index-ChTs_ZCO.js` and
`index-WzKKM_Te.css`. Final layout corrections change the build asset cohort;
the final reload, responsive captures and served-byte verification bind the
completed client separately. No claim is made that all earlier browser cases
were replayed on the final CSS build.
