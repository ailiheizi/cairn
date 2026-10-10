# Core Preview Acceptance — 2026-10-05

> Informative development evidence. This record does not close a phase or
> qualify a release. The canonical requirement matrix and Core MVP Execution
> Plan remain authoritative. The checkout is based on
> `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a` with preserved, uncommitted work.

## User result and decisions

The current product priority is **intake → find → take out**, as recorded in
[ADR-017](build-stack-and-architecture-selection.md#adr-017-content-first-daily-product-and-presentation-views).
All, Photos, and Audio present the same content library. They share identity,
tags, Notes, search, and export; they do not create independent stores or
promise a full media player. Deduplication and compression support the daily
loop. Themes and richer media applications remain deferred.

The browser now defaults a new, empty intake to file upload. Choosing files
and dropping individual files into the library or upload zone use the existing
bounded staging adapter. Staging is not protection. The user reviews the
daemon's SHA-256 identity and `STORE_EXACT` plan, then explicitly confirms its
digest-bound application. Existing server-folder and staged-source recheck
flows retain the path mode. Folder drops are refused explicitly; this slice
does not add recursive browser folder capture or change upload limits.

A regular file's inspector now offers **Download original**. This uses the
browser's native download lifecycle and the existing scoped
`content.open/read/close` dispatcher operations. It does not create a second
job/catalog/recovery state machine or replace frozen bulk export manifests.
The route authenticates the full logical identity before attachment headers,
then hashes the bounded streamed reads again and withholds the last chunk
until identity matches. Missing or corrupt objects fail visibly; cancellation
closes handles. Sequential raw and zstd reads retain a private reader rather
than repeatedly decoding from the beginning.

These choices reduce the distance between a user's file and a usable original
copy while retaining explicit protection and failure boundaries. They add no
LinkGroup schema, player, index dimension, automatic description generation,
external reacquisition, or destructive operation.

## Executed evidence

| Check | Outcome | Scope and limitation |
| --- | --- | --- |
| `go test -tags purego ./...` on Darwin arm64, Go 1.26.5 | PASS, exit 0 | Current development code; some unchanged packages used Go's cache; real-model tests require separate opt-in execution |
| Full purego Go suite on Linux arm64, Go 1.26.6, `-p 2` | PASS, exit 0 | Isolated Colima container, network disabled, checkout/module cache mounted read-only; not a NAS pilot or supported-host qualification |
| Download/session focused race checks | PASS, exit 0 | API and controlplane cancellation, integrity, lifecycle, and reader behavior; not a release concurrency or throughput benchmark |
| Real daemon ONNX/BGE + zvec supervised E2E | PASS, 97.59 s | Retained Darwin arm64 assets; installed provider without a generation reports `NOT_BUILT` |
| Real candidate outer-package semantic lifecycle | PASS, 98.51 s | Packaged CLI offline install, packaged daemon restart/reopen, Chrome Settings rebuild and real fused query with DESCRIPTION provenance; provider loss preserves lexical search and exact verification |
| Combined Chrome online/offline/recovered browser E2E, port 4644 | PASS, exit 0 | System Chrome; actual adapter and native saved downloads; synthetic fixtures and declared viewport scope |
| Notes-only disclosure and wording delta | PASS, exit 0 | Separate temporary daemon and seed, system Chrome, existing description-action E2E: collapsed default, keyboard disclosure, no 390px overflow, and preserved one-confirmation/one-request/accepted-successor UI gates; enabled provider responses are mocked |
| Final WebUI build and i18n | PASS, exit 0 | 1515 merged keys / 45 client source files; final output frozen outside the live E2E assets |
| Final extracted package and live in-app browser intake | PASS | All declared package checksums, offline-installed real bundle reopen, empty-library guidance, default Upload files, light/dark text readability, and Tab reaching a visibly outlined file control; no new OS gesture or upload-limit qualification claim |

The combined browser run checks native saved bytes and full SHA-256 for empty,
small, and 1,250,123-byte originals. A refused download opens a visible HTTP
error tab and preserves the original inspector. At 390 CSS px both takeout
actions fit the viewport. Intake checks a simulated Chromium DataTransfer
drop through real staging and planning, a successful `content.list` showing
the item absent before confirmation, full review identity, explicit exact
save, and actual Playwright file-input selection with a separately staged,
unprotected file. This is browser/API evidence, not a physical OS drag-gesture
test or representative content qualification.

The Notes delta keeps one visible, short unavailable reason and places full
technical prerequisites in a native, keyboard-accessible disclosure. A missing
available capability is reported as unavailable, without claiming that the
binary lacks an implementation. It changes no provider admission, egress,
generation, or acceptance rule. Its focused log is retained as
`description-e2e.txt` and its reviewed phone capture as
`screenshots/390-notes-final.png` in the local evidence directory. The enabled
path uses mock provider responses; this does not prove real AI generation.

The full browser command was:

```sh
CAIRN_WEB_E2E=1 \
CAIRN_WEB_E2E_API_LISTEN=127.0.0.1:4644 \
CAIRN_PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
sh scripts/web-e2e.sh
```

Its output was streamed in the agent tool transcript, not saved as a raw log.
The terminal reported online, offline, recovered, and the final PASS with exit
0. Retained screenshots are copied into the local evidence directory. The
1280px download-suite screenshot caught the finite surface entrance animation
before completion; it is not used as a steady-state promotional image. The
capture calls now disable animations; that capture-only adjustment passed
JavaScript syntax checking and changes no production CSS. Earlier mixed-file
visual evidence remains in the [product decision brief](content-first-product-decision.md#bounded-browser-maintenance-evidence).

Local Go outputs, binary BuildInfo, the retained semantic archive receipt,
screenshots, and candidate artifacts live under the ignored directory
`dist/completion-20261005-dD98vk`. It is local retained evidence, not an artifact
committed to the repository or a published release. The Linux image identity
is `sha256:0d1d3a794be25f809dd2cb3160d8c73276c4056a9f8242a138e908ddeee7b6b6`
(`docker.m.daocloud.io/library/golang:1.26.6`, Linux arm64).

## Unresolved qualification finding

The first Linux full run observed a fixture-publication failure in
`TestPortableEvidenceRejectsBrokenAnnotationAndDescriptionRevisionChains/description_two_successors`:
`portable fact closure parent binding mismatch`. The subsequent exact package
run, 50 focused Linux repetitions, 30 Darwin repetitions, and the final Linux
full run passed. The root cause has not been established. No signed lineage
check was relaxed. Keep this finding open for release qualification rather
than crediting a retry as a fix.

## Release boundary and remaining work

The artifact remains `CANDIDATE_ONLY_NOT_SUPPORTED`; its outer SBOM remains
`INCOMPLETE_NOT_RELEASE_SBOM`. Its retained license inventories do not prove
complete redistribution clearance. Generated storage is still
`directory-cas-dev-v1`, not a selected production repository.

The final local artifact is
`dist/completion-20261005-dD98vk/cairn-20261005-candidate-darwin-arm64.tar.gz`,
SHA-256 `1b1c238835c43e08c6817a67cbef9819d474f7595261bafb434ec02b677cf111`.
The isolated live preview is `http://127.0.0.1:4648/`; its local README explains
restart and persisted data paths. In-app browser review exposed hard-coded dark
text colors in the upload controls; the existing rules now use theme tokens.
The packaged light and dark controls are readable and the file input's label
shows a 2px keyboard focus outline. The browser preview retains light media
emulation; no operating system appearance or security setting was changed.

1. Phase 4: complete dependency/redistribution evidence, clean supported-host
   packaging, representative recall/concurrency/memory evidence, and default
   discovery qualification.
2. Phase 5: obtain a reviewed representative operator corpus, compare common
   exactness/net-savings evidence, implement and qualify the selected mature
   repository contract and independent reader/migration/repair closure, then
   record one release-engine decision. Installed Restic and an external
   benchmark harness are not a completed RepositoryDriver.
3. Phase 6: implement minimal LinkGroup and its authenticated portable state
   only after Phase 4 and Phase 5 close; complete group-aware export and
   successor migration. Existing flat exports do not satisfy that gate.
4. Phase 7: supported packaging, upgrade/backup/migration, performance bounds,
   operator acceptance, and full release qualification.

No representative operator sample path was supplied during this run. The
sample request remains outstanding; arbitrary personal directories and
synthetic test files are not substituted for that evidence. Local Go and
browser PASS results do not imply these remaining gates are closed, and
traffic, appeal, and retention remain hypotheses for real-user feedback.
