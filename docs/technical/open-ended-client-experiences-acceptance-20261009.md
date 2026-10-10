# Open-Ended Client Experiences — Local Acceptance (2026-10-09)

Status: **implemented for the stated UX-E2/M2 development slice**. Photos and
Music remain partial domains; this record closes no core phase, plugin-security
or release gate. The governing scope is
[RW-PERSONAL-UX-1 §7](../requirements/first-party-client-experiences.md#7-ux-e2m2-open-ended-bundled-pages-and-everyday-listening).

## Slice and decision

- Active track: the separately admitted client UX-E2/M2 successor, parallel to
  the existing Phase 4/5 core queue after frozen Phase 3 portable shapes.
- Normative requirement: independently registered client pages and whole shells
  share host selection/focus/Notes/player and retain one core authority.
- Exit: a usable photo wall/exhibition journey with held work; recorded music
  tags -> artist/album -> supported-set playback and queue controls; route and
  registration rejection, visible presentation recovery, and bounded resources.

The primary agent made scope and integration decisions; three GPT-6 Luna agents
implemented disjoint page, music-fact and queue files and supporting documents.
[ADR-026](build-stack-and-architecture-selection.md#adr-026-open-ended-bundled-experiences-with-one-host-authority)
records open-ended reviewed contributions and a simple default. Themes replace
whole interface composition; colors remain secondary. There is no runtime
package loader or stable public extension ABI in this implementation.

Two detailed DSH headless CLI consultation turns used the configured
`openainext / claude-opus-5-5` route, completed with exit 0 and final responses
in session `session-5d7ad39e-5d7d-42b9-b721-1850f28d1d7e`. The temporary overlay
disabled tools/computer use, did not change the global profile and was removed.
Retained prompts/responses/results/events and `consultation-record.json` live
in `dist/open-ended-platform-20261009/`. These are advice, not acceptance or
normative authority. The Bilibili reference returned HTTP 412; no claim of
viewing or reproducing that video's exact interface is made.

## Artifact identity

`dist/open-ended-platform-20261009/artifact-identities.json` records the dirty
checkout HEAD, unchanged backend candidate, configuration digest, final served
HTML and referenced JS/CSS digests. The worktree already contained extensive
unrelated changes, which were preserved. No commit or release was produced.

The local preview remains `http://127.0.0.1:4648/#v=exhibition`, serving
`dist/personal-experiences-20261009/web-dist` against the existing configured
catalog/repository. Only client source/docs/helper checks changed in this
cohort; the retained daemon was not rebuilt. Test upload added two generated
MP3 samples to that local preview library, raising its named entries from 8 to
10 and sources from 3 to 4. No retained user media was uploaded or deleted.
Their full hashes/lengths and origin are in the fixture identity record.

## Implemented scope and checks

| Check | Result and limit |
| --- | --- |
| Final TypeScript/Vite production build | PASS. Existing large-chunk warning remains (about 837 kB JS before gzip); this is not a performance qualification. |
| Translation catalog | PASS, 22 duplicate-free partials and complete literal-key coverage. |
| Page registry and hash checks | PASS, duplicate ID/route/slot, reserved host contribution, missing/extra renderer rejection; compatible Photos/Music and Exhibition routes; disabled/unknown route fallback. |
| Shell/preferences checks | PASS, duplicate IDs/renderer slots, reserved host slots, required workspace fallback, denied/invalid browser storage, compatible older preferences. |
| Music fact projection/order checks | PASS, join only current loaded subjects, absent facts/unknown groups, recorded album track-number ordering and stable unknown/tie order; original playback eligibility boundaries. |
| Queue checks | PASS, eligibility, repeated queue identities, reorder bounds, deterministic upcoming-shuffle prefix, repeat-one natural completion versus manual Next, repeat-all wrap and empty cases. |
| Audio verification helper | PASS, canonical SHA-256 identity, exact byte hash/length, size ceiling, cancellation and failure rejection. |
| `go test -tags purego ./...` at repository root | PASS, 27 tested packages. This is a practical core regression, not native-semantic or release qualification. |
| `git diff --check` | PASS. |

Final check exit codes and logs are retained in
`dist/open-ended-platform-20261009/validation/`. No Linux, deployment or
packaging experiment was part of this cohort.

## Local browser evidence

| Journey | Result and limit |
| --- | --- |
| Tagged MP3 intake -> recorded facts | PASS. Uploaded two generated 20-second MP3 samples through the actual upload/review/confirm flow. Existing extraction returned `Cairn QA Artist`, `Home Sessions`, titles and track numbers; Artists/Albums and their rows displayed those facts. Four older untagged audio entries remained in explicit Unknown groups. |
| Supported displayed set -> playback | PASS. Opening the recorded album/artist set and playing its two tracks created the actual queue and decoded MP3 in the native browser player. Manual fact refresh was exercised independently. This does not prove all native formats, retained songs or disc/compilation coverage. |
| Queue order and playback position | PASS. Reordering B before A retained the exact active Blob URL, paused position 11.296225 s and file identity. Upcoming shuffle and repeat controls were reached. Deterministic helper tests, rather than random UI order, prove shuffle permutations/boundaries. |
| Repeat-one versus manual Next | PASS in the integrated browser cohort. Seeking near the MP3's end restarted A with the same Blob; manual Next advanced to B under repeat-one. The final queue revision additionally fixes invalid/empty-set cancellation and stale updates, with focused checks. Repeat-all wrapping is helper evidence, not a separately exercised browser wrap. |
| Music -> Photos -> Exhibition | PASS on the final queue source. The paused MP3 retained the same Blob URL and 0.032 s position through page changes. |
| Exhibition selection and keyboard | PASS. Generated PNGs render in the moving window; real selection exposes shared selection actions. Next and Left Arrow moved focus B -> A. An initial artwork-container transform caused pointer hit-testing errors; moving visual transforms to the artwork button fixed actual Select clicks. |
| Shared focus, Details and Notes draft | PASS. Photos -> Exhibition retained selected A and the unsaved draft `展厅切换验收：保留此草稿`; returning to the wall retained the inspected subject and focused its image control. The agent then cleared only its own temporary draft. No durable Note was claimed. |
| Page disable -> fallback -> re-enable | PASS. Disabling Exhibition in Appearance returned to Content with all 10 rows; re-enabling restored the page entry. Visibility remains a browser preference, not content ownership. |
| Reloaded Exhibition deep link | PASS. Refresh restored `#v=exhibition` after the actual listing loaded. Unknown/disabled link parsing remains focused-helper evidence. |
| 390 x 844 viewport | PASS for the checked browse composition. Document client/scroll width was 375/375 and the final narrow gallery displayed one focused image. A paused player/queue fit that width in the shared-player run. This is not the complete mobile domain journey. |
| Injected page/shell failure | PASS in an isolated build-only fault harness. The actual PageRenderBoundary showed a notice, standard results and a wall action; the actual InterfaceRenderBoundary recovered Showcase to Workspace once, retaining ordinary slots and an externally held draft. The harness uses empty rows and proves recovery logic only, not real content, malicious-plugin isolation or current App fault retention. |

DOM state JSON, actual desktop/mobile screenshots and the isolated fault
bundle/entry/build script are retained beside the validation logs. Its temporary
loopback server and test tab were closed. The deliverable preview remains open;
temporary viewport overrides were reset and sample playback was stopped.

## Remaining product scope

- Ordinary large-photo renditions, capture-time/EXIF/orientation and embedded
  covers/new metadata extraction are proposed in
  [RW-MEDIA-2](media-experience-successor-proposal.md), not admitted or delivered.
- Curated photo albums and durable ordered playlists require reviewed
  membership, migration and authenticated portable recovery semantics. They
  are distinct from SavedView, LinkGroup and frozen ExportManifest.
- Batch original takeout remains the active useful retrieval gap. The earlier
  original-download action did not produce an observable CUA download event;
  actual takeout is still not accepted by this cohort.
- No retained-song/real-photo collection, >48-image library, live reduced-motion
  preference, unavailable-metadata browser fault or full format matrix was
  exercised. Moving-window and resource constraints are implemented; these
  coverage gaps remain explicit.
- Runtime plugins, marketplace installation, isolation, video/document domain
  readers and complete product/release qualification remain future work.

The next useful work is the complete intake -> discovery -> use -> takeout
journey and reviewed media successors in the
[active todo](product-experience-todo.md), rather than further isolated polish
or infrastructure detours. The
[source contribution guide](client-experience-extension-guide.md) explains how
another reviewed page or whole shell can be added now.
