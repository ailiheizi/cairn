# First Use and Search Source Explanations — 2026-10-06

> Bounded development acceptance for the whole-product continuation. This
> record does not close Phase 4 or Phase 5, select a production repository, or
> qualify a release. The [whole-product target](whole-product-delivery-target.md)
> remains open; the [core execution plan](core-mvp-execution-plan.md) governs
> the next implementation slice.

## Scope and identity

The browser work maintains the existing bounded adapter and Phase 3 content
loop. Its exit test is an empty library followed by upload, visible unprotected
staging, explicit exact-save review and confirmation, name search, durable tag
and Notes, tag/Notes search, and original byte/SHA-256 equality. It creates no
onboarding database, operation, player, or grouping authority.

The Phase 4 slice advances the complete-discovery contract: query results retain
matched text and source while the broker aggregates subjects. Raw lexical spans
use the actual FTS5 tokenizer and prefix/accent behavior. Their offsets are local
UTF-8 byte offsets into the complete source text. Context excerpts are continuous
source windows; ellipses only indicate clipping. Derived CJK/pinyin matches do
not invent raw-text offsets. Query-only spans are excluded from serialized
index-feed facts. Fusion retains distinct source records when lexical and
semantic components return the same subject.

The dirty development checkout has Git base
`5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`. Retained Darwin arm64 builds use
Go 1.26.5 and `-tags=purego`:

| Input | SHA-256 |
| --- | --- |
| CLI | `45196f6d60c65b7dccf15b201d356da153df7a99bfd5e5e641ba3543fe2e7286` |
| Daemon | `6c068eea63045b0c931319a1c4a2a1a3111183d82077e5d456a8853bc5cdeab8` |
| Web dist tree, first-use runner hashing convention | `67b0c98b01039ca5c98e379fa70c2cd9d918d1cbbcc5351b095206fa222b6803` |
| Offline candidate artifact | `abeeb9d4a22676225b14f063bee51a1cc7a65fcb52f5e265223ebeefe6d9c607` |

Evidence is retained under `dist/whole-product-20261006/`. The source freeze
used for the Linux preparation build contains 789 files, tree digest
`38b19b44c8921089d40eb38d06bd32eea573a9df96723f29005de40e7a777482`
and archive digest
`796065c949a15027adc54a2833517f03a094c25ce04863d8ed33c2a649777f99`.
Later acceptance prose and the smoke-runner timeout correction are outside that
freeze; no production Go or Web implementation changed after these builds.

## Executed results

| Check | Result and limit |
| --- | --- |
| Fresh-profile browser journey | PASS with the retained CLI/daemon and final Web assets; exact original download is 74 bytes with SHA-256 `708d8b1a2d707d4af11fc7dbc75c1fa02d0e95263db6085ac07b04f3debe0ffa` |
| Failure visibility | PASS for source-list degradation/recovery and service offline; staging publishes no snapshot before confirmation |
| Sparse library layout | PASS for one and two files in both workspace and showcase at 1280×900 and 390×844; file names remain in the first viewport, tiles stay below 250 px and pages have no horizontal overflow |
| Existing browser regression journey | PASS for online, offline and daemon-recovered phases with exact binaries and rebuilt matching assets |
| Retained lexical generation | PASS for nine raw/pinyin/initials queries across Notes, descriptions and artifacts against `idx_f36bdcd4f7af45e30694525a4347c6a8`, without rebuilding or replacing the old baseline |
| Real offline BGE/zvec fused query | PASS with both query components SUCCEEDED; one subject retains ANNOTATION, DESCRIPTION, ARTIFACT and FILENAME sources; nine raw byte spans and their context excerpts match original text |
| Provider unavailable | PASS for explicit semantic degradation with working lexical Chinese search and exact 83-byte readback; no fixture vectors |
| Offline candidate lifecycle | PASS for exact artifact checksum admission, offline semantic install, restart, real fused/lexical queries and independent-anchor catalog-free restore of 89 matching bytes |
| Broad Go tests | PASS: `go test -count=1 -tags 'purego savingsreport' ./...`; opt-in supervised/native suites are not credited by this command |
| Whitespace | PASS: `git diff --check` at integration |
| Persistent preview | Updated at `http://127.0.0.1:4648/`; actual daemon and HTTP assets match retained builds, annotations/descriptions compare equal before and after restart; three files / 4179 bytes pass full-byte verification with `catalog_used=false` |
| Linux focused tests | Same frozen source builds offline for Linux arm64 using Go 1.26.6 in the owned Debian container; 14 selected repository tests and two catalog-free recovery-reader tests PASS for readback, corruption/tamper rejection, relocation and reopen; this is not a built-product native-model or engine qualification |
| Linux native components | PASS for real BGE inference through the private measurement seam and actual zvec native generation lifecycle; public in-process readiness remains unavailable, and the zvec lifecycle uses synthetic vectors |
| Linux supervised-worker component attempt | Real model/runtime with test-only bundle metadata; failed at control-socket accept after 36.93 seconds, exit 1; qualification BLOCKED, no SKIP credit and no default semantic capability claim |

First-use screenshots, the generated original and its downloaded copy, and
`first-use/result.json` bind the browser journey. The prior candidate result and
failed attempts are retained separately. `search/candidate-final-review.json`
and raw query logs bind the retained-generation and real fused-query results.
`package-smoke-repaired/result.json` binds the exact outer artifact and restore.
`live/runtime-final.json`, `live/web-assets-final.json` and
`live/full-byte-final.json` bind the running preview.

## Failures and remaining work

The first broad Go run failed because a daemon integration assertion still
expected a single-word excerpt. The corrected assertion verifies the complete
source, exact byte slice and stable context excerpt; the repaired broad run
passed. The first offline smoke exceeded the ordinary CLI's 15-second default
while admitting real model files. The smoke harness now gives that operation
an explicit two-minute bound, and the repeated exact-artifact lifecycle passed.
The production CLI timeout remains unchanged. Both failed logs are retained.

The real semantic rebuild remains typed DEGRADED for incomplete lexical field
coverage even though its semantic provider is AVAILABLE and the actual query
components succeed. The four missing categories are tags, duplicates, duplicate
groups and locators; the one-file test corpus contains no facts in those fields.
Their absence is reported honestly and is not evidence that these implementations
are missing. These are separate outcomes. The original runner also marked its
excerpt literal-substring check FAIL because of clipping ellipses; its raw
summary remains retained. The final exact-window verifier removes that test
assumption and checks the continuous source window and byte offsets directly.
Multi-segment derived-token
attribution, complete coverage, supported-host packaging, redistribution and
recall/latency qualification remain Phase 4 work.

Linux bubblewrap probes are blocked by container namespace permissions. No
privileged container, extra capability, VM sysctl change or weakened production
sandbox was used. Linux native archives subsequently completed and matched
the installer pins before extraction of named regular ELF members. The actual
supervised attempt timed out on a 53-byte control-socket path and did not capture
child stderr, so its immediate cause remains unproven. Independent namespace
denial probes are consistent constraints, not a proven cause of that timeout.
Its socket, private directory and processes were absent after cleanup. The
worker attempt uses test-only metadata/header descriptors rather than a
complete installed default bundle. The separate native component passes and
this attempted boundary test cannot satisfy default worker qualification.

The next Phase 4 maintenance slice addresses that concrete diagnostic gap:
detect a worker that exits before connecting, bound its diagnostic output and
reap resources promptly, while retaining nonce/peer/lease authentication and
the production sandbox. Successful component tests never bypass readiness.

Phase 5 still requires complete deployment/corpus-bound savings accounting and
one qualified production engine. Phase 6 LinkGroup remains gated. Dedicated
albums, music/video playback and document readers remain future reviewed
first-party experiences, with no completion credit from existing type filters.
The bundled interface compositions are implemented client choices; third-party
theme/plugin execution, multi-user and multitenancy remain deferred.

## Worker startup continuation

This later Phase 4 slice advances core-plan §8 exit 5 and content-store §9.
A child exiting before its control connection now wakes the parent promptly
and reports its exit status plus capped stderr. One waiter owns process reaping;
inherited stderr pipes and failure cleanup have bounded waits. Nonce, peer,
lease, readiness, and sandbox admission remain unchanged. This changes no
provider profile, signed record, durable schema, or user-facing surface.

The final regression test genuinely inherits stderr, requires `ErrWaitDelay`,
and proves return before its helper finishes. Leak checks use a short, exclusive
test directory. Darwin and Linux focused race runs pass, including zero/nonzero
child exit, capped output, live-child timeout, cancellation, concurrent close
and tampered readiness. The practical uncached broad Go set also passes. The
Linux source freeze predates the final Darwin-only normalization of the
test-owned temporary parent's group; its production proof is identical.

The retained Darwin daemon is now
`adae80fe9287b5dc82f50d1e196be52e646c10de9dcd18a6f5f3c6fbfb0927bb`;
the CLI remains `45196f6d60c65b7dccf15b201d356da153df7a99bfd5e5e641ba3543fe2e7286`.
The new candidate artifact is
`b684d817b8486276399f0474f28ffb26e440d1badafe0ad35acc4edddb21126a`.
Its normal offline BGE installation, restart, real semantic/lexical query and
independent-anchor catalog-free 89-byte restore pass. The unchanged browser
assets and persisted preview were retained; PID 65554 runs the new daemon at
`http://127.0.0.1:4648`. Fresh annotation/description reads are identical across
the restart; real query components and the existing 3-file/4,179-byte full-byte
verification pass, with `catalog_used: false`.

A new, ordinary Linux supervised component attempt reports
`child exited before control connection (exit code 1; stderr: bwrap: Creating
new namespace failed: Operation not permitted)`. Its test body finishes in
6.039 seconds, versus the prior 36.93-second timed-out body. This establishes
the immediate cause for the new attempt; it does not retroactively prove the
cause of the old log. The production sandbox was not relaxed. Real native
assets plus test-helper descriptors do not qualify an installed default Linux
bundle. Private worker paths are absent; two exited test-only descendant
zombies remain under the container's non-reaping PID 1, with zero open FDs
and no active worker. The Linux default-profile gate remains blocked.

Two preview-promotion harness failures are retained: an invalid CLI workspace
alias stopped before restart; a mistaken health endpoint caused automatic
rollback. Correcting the harness and using the real workspace ID/healthz route
produced the successful preview checkpoint without changing durable content.

Evidence is under `dist/whole-product-20261006/worker-startup/` and
`linux-prep/worker-startup/`, including binary identities, source inventory,
raw logs, package smoke, cleanup and the bounded `result.json`. No Phase 4,
Phase 5, production-engine, album/player, LinkGroup or release completion is
awarded by this continuation. Populated-corpus retrieval and same-profile
deployment measurements are the next acceptance work.


## Populated retrieval and deployment-cost continuation (2026-10-07)

This continuation advances Phase 4 discovery and Phase 5 measurement only.
The core execution plan remains authoritative; the whole product, both phase
qualification gates, and the later LinkGroup gate remain open.

The retained worker-startup candidate passed a real populated corpus run:
20/20 lexical fields were present and 14/14 query cases found their expected
subjects, including typed duplicate-group filtering. The default fused query
executed actual installed BGE/ONNX and in-process zvec. The separate index-loss
run moved only the owned index directory aside, retained all catalog rows, and
first observed honest degradation. Typed rebuilding produced new lexical and
semantic generations, restored all fourteen queries, and preserved the 26 old
projection files byte-for-byte. Durable Notes, descriptions, tags, protection,
snapshot and recovery records were unchanged; three STORE_EXACT file streams
still matched their expected bytes. LINK_ONLY remained explicitly unprotected
with no retained payload or fetch. Sparse control remains NOT RUN. Raw evidence:
`dist/whole-product-20261006/search/coverage-final-20261006T153530Z-aca96f5b/`,
including `index-loss-20261006T154819Z-b30cd320/summary.json`. The first index-loss
attempt treated the expected DEGRADED exit as a harness error; it is retained.

A new disposable lexical projection stores schema-v1 body/segment provenance
in the existing UNINDEXED segments field. It binds the exact joined field,
durable body and text digests, revision, workspace, subject, segmentation
profile and contiguous UTF-8 byte intervals. Existing derived CJK/pinyin tokens
map to their real source intervals; cross-segment tokens do not fabricate
segment-local highlights. Invalid metadata omits explanation while retaining
lexical candidates. Legacy array generations remain conservative. Searchable
fields, tokens, ranking, public interfaces, database schema, semantic inputs
and signed records did not change. Rune boundaries are computed once per Han
run rather than rescanned per syllable.

The frozen Darwin candidate daemon SHA-256 is
`c019eb3cd2c19231cffbaa8cb4b8be59c9aa24e283e5d590ed2706dd434db1ec`;
CLI remains `45196f6d60c65b7dccf15b201d356da153df7a99bfd5e5e641ba3543fe2e7286`.
Source inventory contains 797 files, tree digest
`a456d30c460e86e92d84901aaea25da99f21d25726dd9afb826db1c804f7461b`.
Uncached broad Go tests with purego/savingsreport and focused race tests passed.
Its outer package SHA-256 is
`b63f38a0732903d57319cd98c447de4e46ed02339fe1f9374ef067fbf593df11`.
Normal offline installation, real semantic/lexical query and independently
anchored catalog-free 89-byte restore passed. The live preview now runs this
daemon as PID 73387 with unchanged Web assets and durable text; existing
retained generations, default fused query and full-byte snapshot verification
passed. This candidate precedes the pending origin-intersection cost repair.

The real typed multi-segment runner passed 44 assertions on this candidate:
three contiguous segments over 3,066 UTF-8 bytes, raw CJK, a unique CJK bigram
and pinyin pair crossing the first boundary, initials across all three segments,
title-only pinyin without a body claim, durable tag/Notes search and immutable
prior-generation query results. Semantic execution is explicitly NOT RUN in
this lexical runner. Its successful evidence is
`dist/whole-product-20261006/search/multisegment-run-20261007-c/`.
Earlier attempts are preserved: a file was supplied where capture required a
directory, then the fixture assumed a 512-byte rather than the actual 1024-byte
segment cap. These are harness failures; neither changed production capture
or segmentation semantics.

The same-profile deployment measurement passed two actual configured ingests
of the identical 15-file, 4,213,099-byte generated QA corpus, each with installed
real semantic assets, plan/publication identity binding and catalog-free full
byte verification. Measurement retained all five configured roots, explicit
TMPDIR, online-settled SQLite sidecars, fixed CLI/daemon/Web and 50-ms sampled
allocation peaks. The original raw/zstd reports remain immutable; the later
input-artifact audit explicitly records its archive/Web binding as post-hoc.

| Quantity (bytes) | Raw development profile | zstd candidate |
| --- | ---: | ---: |
| Whole-file duplicate bytes from apply | 5,096 | 5,096 |
| Net encoded payload compression | 0 | 11,390 |
| Whole repository allocated growth | 5,050,368 | 5,046,272 |
| Incremental ingest net savings | -97,093,269 | -97,089,173 |
| Full deployment net savings | -316,225,173 | -316,221,077 |

Both full costs include 180,510,720 allocated model bytes; vector growth was
94,175,232 bytes. The sampled aggregate peak was 361,840,640 bytes, with a
180,510,720-byte temporary peak and zero settled/shutdown TMPDIR bytes. This
is sampled configured-path allocation, not an absolute instantaneous peak or
whole-volume use. Rebuild reported DEGRADED because this storage corpus has
no locator/tag/Notes/description/language facts; semantic and lexical query
components succeeded. The zstd positive-only compression counter is 11,564,
which must not replace the 11,390 net payload compression value. Payload
receipt length is distinct from filesystem allocation. Evidence and audit:
`dist/whole-product-20261006/storage/same-profile/attempt-3/`.

This small generated corpus is not representative NAS evidence and does not
select a production engine. It supports keeping useful unified retrieval and
reliable original-byte access as the product promise; storage savings remain
a separately measured claim. Linux normal supervised execution and clean-host
packaging remain open. A separately owned Debian VM has been prepared for
that validation without relaxing the existing container or host settings.


## Bounded long-text query cost and preview continuation (2026-10-07)

This Phase 4 slice removes repeated full token-origin scans when projecting
matched description sources. Ordered highlight/origin intervals are intersected
with a two-pointer walk; merged source intervals are checked per segment by
binary search. Half-open boundaries and touching-range unions retain the
existing meaning. Token output, rank, profile digests, public interfaces,
semantic input, durable schema and authenticated recovery records are unchanged.
The dedicated tests cover interval edges and a real long Chinese query, including
pinyin without invented local spans and raw text with legitimate highlights.
Focused race and the uncached broad purego/savingsreport Go set pass.

The final frozen source tree digest is
`68da02c76d338afedf24eebe64b28656d0d9329b098323d2f5e7d49314e1edb5`
(798 files); archive digest is
`72a3d02987bee0713c029e281baa7f33709a352a224695bca85fa5f187726d0f`.
The Darwin daemon digest is
`8593f94973a5e45bc83fe5a213a390b0dd1ac3ef8af40d56138159d2e82a2c6e`;
CLI remains `45196f6d60c65b7dccf15b201d356da153df7a99bfd5e5e641ba3543fe2e7286`.
The real typed lexical runner again passed all 44 assertions against this exact
candidate, retaining identical prior-generation results. Semantic execution
is explicitly NOT RUN in that runner. Its evidence is
`dist/whole-product-20261006/search/multisegment-run-20261007-d-cost/`.

The outer-package digest is
`1102c0e6869e991add4cb1d4936e4b4342e5504e1dae92d0357814d6913fc0c6`.
Normal offline model installation, actual semantic and lexical queries, and
independently anchored catalog-free 89-byte restore pass. This candidate now
runs the local preview as PID 15047. Before/after reads preserve all durable
annotations and descriptions. Both default query components succeed with
the retained generations, an explicitly pinned prior semantic query returns
identical data, the three-file/4,179-byte catalog-free verification passes,
and both existing Web asset digests match. The browser was not forced to
reload or discard drafts. Cohort evidence, binary/source identities, smoke,
restart records and rollback-capable harness are under
`dist/whole-product-20261006/search/provenance-cost-candidate/`.

Linux binaries built from the same source archive have also been copied into
the exclusively owned Debian guest and independently hashed there. This is
build/staging evidence only. The ordinary-user namespace/bwrap proof and the
pinned Debian image's independent digest check pass; actual installed Linux
model/query, provider-loss, packaging and reader validation are still pending.
Neither this continuation nor the prior local trials closes Phase 4, Phase 5,
the LinkGroup dependency gate or the whole-product target.


## Ordinary-user Linux default attempt (2026-10-07)

The owned Debian 13.5 arm64 guest runs as UID 501/GID 1000, with its pinned
image independently rehashed and ordinary-user namespace/bwrap proof passing.
The copied CLI and daemon match the preceding Linux frozen-build digests.
This is a fresh local test host; it is not a physical NAS or release profile.

Attempt `a` failed during the official ORT runtime download with unexpected
EOF; a separate direct HEAD timed out. Attempt `b` used the already enabled
host system proxy through a temporary loopback-only SSH reverse tunnel and
per-run environment variables. No global proxy, sandbox, TLS or asset-pin
setting changed. The normal fixed installer succeeded, admitting real Linux
BGE/ONNX/zvec assets with profile digest
`sha256:54df8c61744e1d8143b900fc964818dd052c48fdf5afde32c8262f73b861d61e`.
The temporary tunnel was terminated after installation.

The default pipeline still failed: normal-user worker staging creates a bundle
directory with mode 0500 before writing its descriptor, producing permission
denied. 11 configuration, exact-preservation, Notes and lexical assertions passed, while
the semantic capability/rebuild remained visibly UNAVAILABLE. This failure is
not attributed to the provider assets or replaced with fixture vectors. The
next bounded production fix must permit controlled construction, preserve the
required read-only worker inputs, and clean only the owned temporary tree.

The unchanged admitted bundle was archived with the existing admission builder:
archive SHA-256 `ded9e0f3c8a28e951c8646c4c433a718a56ef6226a780aeaa4d8e8b66b44928b`,
84,335,608 bytes. No descriptor was hand-authored. Evidence, installer result,
worker error, source/binary binding, archive and cleanup are retained under
`dist/whole-product-20261006/linux-vm/lima-20261007/`. No temporary worker root,
daemon control socket, active daemon or proxy listener remained after attempt
`b`. Real default fused execution and offline provider-loss controls remain
pending the staging fix; Phase 4/5/6 and release gates stay open.

The current Darwin outer candidate's redistribution audit also remains OPEN:
license labels do not substitute for full upstream notices, native transitive
provenance and a complete release SBOM. Its exact outer/inner/binary identity
is bound in `dist/whole-product-20261006/linux-vm/redistribution-audit.md`.


## Current packaged-provider and clean-reader continuation (2026-10-07)

The v3 frozen source contains 803 files, tree digest
`4084c3b28a2fbfd1ed6401695ac09ce3f863a5e2c826f20505ec654a3cffaac0`, and
archive digest
`84f4202b56c0eefd3b140d4fdb518ff09d404dd26a4547d88ebece16027e16c8`.
Root independently verified the inventory and archive. Focused processor race
tests and the uncached broad `go test -count=1 -tags 'purego savingsreport'
./...` pass against the same eight hashed source inputs.

The v3 Linux candidate package was installed in the owned Debian 13.5 arm64
guest as UID 501/GID 1000 without changing its HOME or relaxing sandbox policy.
The normal installer admitted the real pinned BGE/ONNX/zvec bundle. All 29
bounded assertions pass: the real fused lexical and semantic providers return
the description source, restart/reopen retains its generation and provenance,
and the 65,673-byte exact readback matches SHA-256
`ff1d6c1e0ab3e1ac8cd59cf18507791cb07157eebc423f20ccfd57e9ab977ac8`. With the
zvec asset temporarily unavailable, title and body searches report the typed
degraded exit 5 while lexical search and full-byte verification remain usable;
restoring the asset recovers the same semantic generation. Root checked all 29
assertions. This is bounded local candidate evidence, not host qualification.

The next clean-reader trial restored three files totaling 138,214 bytes without
opening the catalog, using the signed required reader versions and separately
exported reference and trust anchor. A same-length mutation of a private copy
was refused at startup with exit 1 and a payload-specific integrity error; the
original repository object stayed byte-identical. The generated QA corpus does
not represent NAS deployment and does not select a production engine. An
earlier zstd runner reached the checks but exited with a report-projection
`KeyError: 'version'`; that failed record remains retained. The later runner
passes without a production change.

On Darwin, the final candidate-only outer package has SHA-256
`cad390ceddcca9957bc886eb58820b7576895da3ca4cf652521d9113ff8ef0ca`. The
unchanged smoke runner returned exit 0 in 44 seconds: the real semantic
provider and lexical provider each returned one hit, and an independent-anchor
catalog-free restore reproduced 89 bytes with SHA-256
`5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`.
The subsequent bounded preview promotion then ran PID 58950 from the v3 daemon
(`93dc9f4f9f4cceb308a6d357266300901325ee3ada39da8ec3472c3a8b88c400`). Its
before/after records match for annotations, tags, descriptions, fused and pinned
generations, catalog-free full-byte verification, and all six served Web
assets. The old owned preview process exited; the browser was not reloaded.
Promotion and packaged smoke remain development evidence, not release
qualification.

The Linux redistribution sidecar remains incomplete: its 24-module, 49-source
notice comparison retains 41 unique texts and four open component rows; Web
build linkage is not attested and the release SBOM is incomplete. Its four
model-license fetch attempts returned HTTP 000 without full text; the later
upstream retrieval recorded below recovered the linked FlagEmbedding MIT text
but leaves converted-artifact applicability open. Phase 4 and Phase 5 remain
open, Phase 6 LinkGroup remains gated, and the whole-product target remains NOT
COMPLETE. The next Phase 5 work is qualification of the
existing common mature storage engine and its adapter root-retention gate,
alongside Phase 4 licensing and representative supported-host qualification.
Host-key handling belongs to the reviewed engine adapter; the experimental
in-tree AES candidate is not the next implementation path. Verify the engine
pin, advisory status and current API, and review portable recovery bindings
before implementation or default selection. This is decision preparation, not
a new security contract or qualification result. Current cohort records are under
`dist/whole-product-20261006/linux-vm/reader-closure-candidate/` and
`dist/whole-product-20261006/reader-closure-darwin-candidate/`; the compact
current ledger is `dist/whole-product-20261006/verification-ledger.json`.


## Reproducible Web build and current preview continuation (2026-10-07)

This Phase 4 maintenance record binds a clean npm-lock-conformant Web build to
a repeat build and a fresh-profile browser run. The first and repeat builds
emitted the same six UI path/length/SHA-256 tuples; the comparison is
`PASS_SIX_UI_ASSETS_IDENTICAL` (report SHA-256
`103f458d402bee6802b82eff5b59147c796526f7179cd328b86e3cc111c47903`). The
Rollup audit mapped 157 emitted modules exhaustively; five emitted package
roots have locally retained notice texts, while 15 virtual origins remain
open. The distribution notice inventory and SBOM remain incomplete. The
current six-file Web tree is
`264844018e70b0ab7b0b56169a35f30327fc39c1e42ef166ce38adf0bad38878`. This is
a new held Web cohort; the earlier Darwin v3 outer package
(`cad390ceddcca9957bc886eb58820b7576895da3ca4cf652521d9113ff8ef0ca`) and its
older Web member remain byte-for-byte unchanged.

The browser harness copy changed two path constants to point at the isolated
candidate; its assertions and user-flow steps were unchanged. It passed against
that exact Web tree and the v3 Darwin CLI/daemon. In a fresh profile it staged
a generated 74-byte file,
required explicit `STORE_EXACT` review, found it by name/tag/Notes, and
verified the downloaded original SHA-256
`ed525224d935058354bde271063f93a6116bb78558ce180a9178362b38091e67`. All eight
workspace/showcase one/two-file desktop/mobile layouts were recorded. The
runner exited 0 in 32.473 seconds, cleaned its owned temporary directory, and
left the candidate inventory unchanged. The result is bounded browser
acceptance, not release qualification.

The exact-revision model notice continuation made four bounded requests through
the pre-existing local proxy. Both model-repository LICENSE URLs returned HTTP
404. The pinned BAAI README declares MIT and says released models may be used
commercially; it links to `FlagOpen/FlagEmbedding/blob/master/LICENSE`. A later
two-request official-source retrieval bound the full 1,065-byte MIT text to
FlagEmbedding LICENSE commit `c086741f5e117b7b8ce1745ea00b6c262f281a01` (SHA-256
`587a673933425dbc36ec61268d3b954051b2d3ef3c9b322ede357976055ffdd5`). GitHub
reports that commit as unsigned; signature verification and a cryptographic
BAAI-revision-to-license-commit link are not independent normative release
gates. The pinned BAAI card declares MIT and links to the upstream license, so
the base-model license declaration and full linked text are retained. Its
mutable `master` link remains a provenance caveat. The delivered Xenova
conversion still needs a clear artifact-to-source/license mapping: the current
bundle pairs BAAI's model ID with Xenova's revision, while the pinned Xenova
card has no license declaration. The package's 300-byte LICENSE is an
attribution inventory, not the complete MIT terms; the recovered full text is
kept outside the package. Native zvec transitive notices and remaining
per-cohort SBOM/notice coverage also remain open. The audit and machine-readable
evidence table are in
[`phase4-model-license-audit-20261007`](../../dist/whole-product-20261006/phase4-model-license-audit-20261007/audit.md).
Do not reinterpret the existing profile or installed generation in place; no
redistribution clearance follows from this evidence, and Phase 4 remains open.

The first read-only promotion preflight failed its evidence guard and did not
execute (`preflight-v1` SHA-256
`6374e8655a6e815cd3217cb329b074812f6321e8d6184e90766309aac760c1d9`). The
corrected read-only preflight passed; it did not write the helper or signal a
process (`preflight-v2` SHA-256
`58dc3886f9ba43e7e6fcc9a8d9594c22ddd93fffc45e9510d103c2cb35947772`). The
subsequent bounded promotion passed and now runs PID 75212 from the same v3
Darwin daemon and CLI, with the reproducible Web tree as `--web-root`. The
independent post-check found all eight durable/query state groups equal, all
six served asset hashes equal to the held candidate, three files / 4,179 bytes
verified catalog-free, and no browser reload or local-storage/draft change.
The only helper change was the single Web-root argument. Promotion result SHA-256
`557a6f1721071ab2f52c28dfbe9ef5fe7183da4c1a5a0d4c1628fb7fcf04dd71`; independent
post-check SHA-256
`ad81b4db502fdb3672a6c5c29a611e64375860a854e7746aa8b286915ef76e6b`. This updates
the development preview only; the older outer package remains an older Web
cohort and release qualification remains open.

The isolated Kopia v0.23.1 root-retention experiment creates a fresh encrypted
repository; the candidate retention mark/check runs read-only. Its run-1
focused and race checks share content digest
`f39d56e93708fc6c765a4470d2eeb1c028ff9a7950f8c37f3e44eabe76d7c270`. Run 1
covered 13 source/copy objects (197,978 bytes), one retained latest snapshot,
14 graph objects, 15 backing content IDs and 14 cold readbacks; independent
checks verified all 13 source digests.

A separate run-2 focused and race probe passed duplicate logical-path handling
in the same candidate boundary (result SHA-256
`05c14c6e1b3dbd1d23a4c2a6ac8f7baa24c821d01bfddb6a01878054a3285c1e`). Two safe
root-level names with identical 98,304-byte contents shared one Kopia object
identity; after cold reopen both paths were enumerated and independently
read back, and a collector-shaped mark set covered both path proofs. Removing
one expected path caused the completeness check to reject the inventory. The
new test source SHA-256 is
`a008260ccc1c3db63b6042f7776c3982b76aa87813f8107260e193cf9aa77511`; run-1
frozen inputs were unchanged. This still does not qualify recursive path
mapping, arbitrary roots, stock maintenance or a production adapter. No prune
or garbage collection ran. Signed input authentication, credential closure,
adapter conformance and engine conformance remain open, so Phase 5 stays open
and no engine or key-handling default is selected.


## Bounded Kopia adapter prototype continuation (2026-10-07)

This Phase 5 candidate slice tested a subset of the existing
`repository.Driver` and `RecordDriver` contracts in the standalone, pinned
Kopia v0.23.1 module. Its frozen source binding is SHA-256
`de320dcd2861d08ed9e387425259b0ceea11acc603a6dbdba865ef0951310b15`; the
driver, test, and `go.mod` hashes are respectively
`9be8fab706216a4810bc585ac8c8d0e80be4e9bba93fe49306880bea7c2861a8`,
`e53e55479f499b7d4cd79befcb6af84e62229ea45d0caf5c0ac9107988efb041`, and
`c61bdbe40771ceb6c050a3b5482b6bda2b7646fb4ec6e7d928a88750d3b107a6`.
Compile-time assertions cover the existing interfaces. Focused tests passed in
3.100 seconds and the standalone race set passed in 16.302 seconds. The retained
root review checked the frozen source and executed results; it did not rerun the
prototype independently. Earlier offline-cache and read-only module-graph setup
failures remain retained.

The tested subset used an isolated encrypted repository to write and verify a
binary payload, two opaque test-record roles and same-byte logical keys. It
checked immutable repeats before close, fresh-cache cold reopen with stable
identity, payload/record readback and wrong-password refusal. These record bytes
were not signed RestoreWeave records. The prototype is not registered in the
production provider set and does not test signed authentication,
`exact.Service`, normal ingest, clean-reader/profile opening, unknown-flush
reconciliation, cross-process fencing, migration, physical placement measurement
or `DriverGates`. `Receipt.StoredBytes=-1` remains unavailable: packed-content
sums cannot be treated as placement increments when chunks are shared.
Plaintext private staging can survive a host crash.

Typed optional placement measurement is now implemented and tested for the
development scope recorded in
[`phase5-typed-measurement-20261007/REPORT.md`](../../dist/whole-product-20261006/phase5-typed-measurement-20261007/REPORT.md).
The result is implemented/tested evidence only: it does not register an
adapter, change a schema or default, or select an engine. The focused race run
passed 16 tests (55.577s, exit 0; log SHA-256
`2e33740ebeb1878666b605c1a41c9c2b8d249372981de423fef99f501da6f216`) against
unchanged 532-file inputs (`cad8c5afbc02be09e28f1abaa59de7f40a0df3421b640932667fec155ef7dcb7`).
The corrected broad run passed all 34 product packages (152.405s, exit 0;
`go test -mod=readonly -count=1 -tags 'purego savingsreport' ./...`; log
SHA-256 `8ea12fa96f2f047958547d0575c392a571d3f258c226bcca74cc7ec4afd3d28d`).
An earlier broad attempt failed because generated validation sources entered
package enumeration; it is retained as a failure, and the corrected run uses
an ignored nested-module boundary without changing the root Go module.

Receipt telemetry is optional and explicitly MEASURED or UNAVAILABLE; missing
or unknown states cannot invent physical bytes. MEASURED means exclusive
whole-object length, not shared-chunk sums, allocation, repository growth or
net savings. Exact ingest and restore remain independent of that telemetry,
and the savings report remeasures in-tree object sizes from disk. Migration's
unknown/overflow handling is tested at the aggregation-helper boundary; real
migration remains limited to concrete raw/zstd factories. Phase 4 and Phase 5
remain open, Phase 6 LinkGroup remains gated, and the whole-product target
remains NOT COMPLETE. The streaming candidate evidence below advances the
bounded adapter subset only. Next come final-session-flush and process-crash
reconciliation, credential and cross-process fencing, retention, and reader
dependency closure; standard reader/profile admission follows the common gates.
Phase 4 redistribution and supported-host qualification also remain open.
Earlier Kopia prototype
results remain historical subset evidence, not complete current conformance.
Prior prototype evidence is under
`dist/whole-product-20261006/phase5-kopia-adapter-prototype-20261007/runs/focused-v3/`;
the run report is `execution-report.md`.


## Signed Kopia API interoperability continuation (2026-10-07)

The isolated Kopia candidate passed a bounded signed-record interoperability
probe through the real `exact.Service` publication and existing repository
driver APIs. After closing the writer, the test removed generated signing
material, SQLite catalog files, source fixtures, and the exact unsigned
snapshot sidecar. A fresh configuration/cache then reopened the same repository
identity; a catalog-free and signing-identity-free reader used the repository,
exported recovery reference, independent public trust anchor, and same-process
Kopia credential fixture to import and list the signed reference, verify all bytes, and restore three files
(46 logical bytes, including an empty file) without recreating a catalog.
Wrong trust anchors and a tampered reference were rejected. Unavailable shared
chunk accounting remained visibly `UNAVAILABLE` with zero optional physical
totals and did not block exact ingest.

Focused command `go test -v -mod=readonly -tags no_extra_providers -count=1
./kopiacandidate` passed (exit 0; 3.243s package run; stdout SHA-256
`9f98055f6837848418ffee6c88a595e279bb3a7232801128e0d604238a6bc200`). The
corrected race command `go test -race -v -mod=readonly -tags
no_extra_providers -count=1 ./...` passed (exit 0; 15.340s; stdout SHA-256
`06478b63d3dc5a8b5f4587a1ffa4e1ba4ed9e11a5b650cda336cd61355a8534f`). Its
package inventory contains only the isolated candidate package. The first
race attempt failed when `./...` traversed upstream dependency tests; that
failure remains recorded. The nested module boundary corrected the inventory.
The frozen candidate driver and test hashes are respectively
`e5144b971ad6416bced13d82702e209ffa6dbb898c46dbf6c0bd6e2d41226e46` and
`83a9862f67aa59fd6f0f370e165b231831642ee960837f351b2e6dd471f348cc`.

This is API-level evidence for one isolated candidate using a same-process
credential fixture. The candidate remains unregistered; the standard clean
reader/profile factory and CLI/package import paths are unavailable or untested.
Staging and crash behavior, independent credential lifecycle, cross-process
fencing, unknown-outcome reconciliation, non-destructive retention ownership, migration, complete
license closure, representative host qualification, and physical/net savings
remain open. Phase 4 and Phase 5 remain OPEN, Phase 6 LinkGroup remains GATED,
and the whole product remains NOT COMPLETE. The next Phase 5 work is adapter
streaming without plaintext staging and unknown-outcome lifecycle handling;
standard reader/profile admission remains a later gate. See the
[`phase5-kopia-signed-interop-20261007` evidence](../../dist/whole-product-20261006/phase5-kopia-signed-interop-20261007/REPORT.md),
whose result SHA-256 is
`18b456337f996bc9c5f00b586c079a8fa4262b351c91b9ff1ec82bf78241c4ae`.


## Kopia streaming and unknown-outcome candidate continuation (2026-10-07)

The isolated candidate now streams immutable object writes directly through a
Kopia object writer and SHA-256, checks expected identity and record-size
bounds, verifies the completed object independently, and publishes it into the
cumulative snapshot graph without adapter temporary plaintext files. A 32 MiB
deterministic payload crossed the opened repository's actual
`DYNAMIC-4M-BUZHASH` splitter (8 MiB maximum segment) and was confirmed
indirect; full bytes, digest, length, four record roles, cold reads, and
idempotent repeats passed. A blocked `TMPDIR` did not prevent empty, small, or
large object readback. Invalid digest, cancellation, reader error, oversize
record, and same-key/different-bytes cases failed closed and remained absent
after cold reopen (or preserved the original object for the wrong-byte case).

Unknown outcome was injected after Kopia's official `WriteSession` returned:
the operation had no receipt, its original handle was poisoned, and a
separately opened session verified the object and retried the same key without
creating a new generation. The read-only storage failure happened earlier,
during `ObjectWriter.Result`, before `SaveSnapshot`; it is not evidence of a
final-flush failure or crash recovery. Those tests remain open. The separate
signed recovery regression continues to verify exact.Service publication and
catalog-free three-file import/restore at API level; the standard profile
factory remains unavailable.

Final focused command `go test -mod=readonly -tags no_extra_providers
./kopiacandidate` passed (exit 0, 5.440s). Final standalone race command `go
test -mod=readonly -tags no_extra_providers -race ./...` passed (exit 0,
48.324s). The final source freeze `source-freeze-v3.json` binds 4,632 inputs
with zero mismatches (SHA-256
`29dc6be26b0e4c80fc1cbfc51bfc5730e62df3699e9d4bfd05672aebea1d06ae`). Driver
and test hashes are `22d996d06b34fb0c5b9a04b27463b4f7bc13aca359d59172694e2317c2594830`
and `f15f06d07923a2ff41850642b31625248d6493165302fac8543d4d7f25ef7865`.
Earlier interrupted, failed-expectation, build, and shape runs remain recorded
in the report. The full result SHA-256 is
`db0da9fcd4b1cc4995a9f9b127f62e55b6aa771b726c60b8d065fabd9d4617db`.

This remains an unregistered candidate with no physical savings claim. Adapter
plaintext behavior inside Kopia, OS cache behavior, credential isolation,
cross-process fencing, final-flush failure, actual process crash, non-destructive retention ownership,
migration, reader dependency closure, production profile admission, and release
qualification remain open. Phase 4 and Phase 5 remain OPEN, Phase 6 LinkGroup
remains GATED, and the whole product remains NOT COMPLETE. See the
[`phase5-kopia-streaming-20261007` evidence](../../dist/whole-product-20261006/phase5-kopia-streaming-20261007/REPORT.md).


## Previous Darwin candidate and bounded Kopia flush boundary (2026-10-07)

At that point, the local preview promotion ran the Darwin CLI and daemon built
from the frozen 533-input source cohort `e7e25e255dad531e7a0fee39db0e6a4134181322d0ccdef9be0d64e9619f4363`.
Promotion retained configuration, read-only catalog state, and semantic
generation `idx_20e1ddec9b1bc247a76ee54f03802d6e`; the independent full-byte check
verified three files/4,179 bytes with no catalog use. All six served Web assets
matched before and after. The promotion did not install a model or rebuild an
index, and the full browser suite was not rerun. Evidence is in
[`current-source-preview-20261007/promotion-v1`](../../dist/whole-product-20261006/current-source-preview-20261007/promotion-v1/);
the promotion result SHA-256 is
`721a84772527746d3a670f17ba1ab82fcce7939f10502a4d12efe8bbf2ca3529`.

A separate fresh Darwin candidate passed its pinned online semantic installer
in 266.134 seconds using a daemon-scoped proxy, then the outer candidate package
`restoreweave-20261007-phase4-origin-v1-darwin-arm64.tar.gz` passed offline
semantic and lexical queries and independent-anchor catalog-free restore of
89 bytes (`5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`).
The outer package SHA-256 is
`e9aa56a86a1ee1927b59a761ef1fa4f5be1166ad59956c0ab804349ee5164c84`. The
successor semantic bundle carries a 1,979-byte LICENSE asset containing the
1,065-byte exact MIT text (SHA-256
`587a673933425dbc36ec61268d3b954051b2d3ef3c9b322ede357976055ffdd5`). The
corrected native audit establishes canonical ONNX Runtime 1.29.0 archive-member byte
identity and partial retained notice coverage, not complete native or Web
redistribution closure. The ordinary installer passed in its separately
recorded run; the retained-byte transport helper is harness-only. Both candidate trials are local
development evidence, not supported-host qualification. The source-cohort
serialized Go test run passed 34 packages in 388.768 seconds
(`0360c10f9087a2e89d1aa24f5eb483986f21d6a3bf1c0c565b37e5c9437446c5`); earlier
timeouts and failed setup attempts remain retained.

The isolated Kopia candidate now has bounded evidence at the real
`RepositoryWriter.Flush` method boundary. After `SaveSnapshot` succeeded, an
injected before-delegate error reconciled absent in a new configuration/cache,
and retry published once. A second injected response-loss error followed a
successful underlying `Flush`; cold reopen verified the committed object and
same-key retry did not advance the generation. These are wrapper-injected
boundary outcomes, not storage-device failure or child-process crash tests.
Focused tests passed in 9.649 seconds and the standalone race set passed in
57.160 seconds. The report SHA-256 is
`8b9efa7123d1bf6f8c3474dc58303b7f3904ca3834251065b6dde98ae28709dd`, and the
result SHA-256 is
`4898edf35772825b36776c90073f3360265e1f8d8bf55012757bd4abab907fec`.

Phase 4 and Phase 5 remain OPEN; Phase 6 LinkGroup remains GATED and the whole
product remains NOT COMPLETE. Crashes inside Kopia's own `Flush` and storage
device faults, new provider-loss smoke, credential lifecycle, production reader/profile admission,
redistribution review, host qualification and release qualification remain
open. The flush experiment is an unregistered candidate and makes no physical
savings claim.


## Kopia final-flush process-death reconciliation (2026-10-07)

The isolated candidate now passes two real child-process `SIGKILL` checkpoints
in the `WriteSession` path. In both cases, the child had observed successful
`SaveSnapshot` and entry into final `RepositoryWriter.Flush`; it was killed
before returning a placement receipt or closing the engine. A fresh client,
fresh cache and independent repository open observed the first publication
absent when killed before the underlying Flush delegate; retry published once
and exact readback passed. In the second case, the underlying Flush returned
success before the child was killed; cold reopen verified the object, and retry
returned `Existed` without advancing generation. The existing payload and all
four opaque record-role objects survived both cold opens.

The SIGKILL fixture uses a small generated payload. The separate 32 MiB
deterministic streaming regression verifies indirect-object splitting; it was
not the crash payload. The suite also separately retains the signed
`exact.Service` API recovery test for three files/46 bytes; the opaque record
role fixture is not proof that every signed recovery closure survives process
death. Focused tests passed in 13.697 seconds and the standalone race suite
passed in 85.124 seconds. The report SHA-256 is
`498ba44eea25e696b31ed7017f2c50e13eeec9e0060dcabd629d5ed67c73aa1c`, and the
result SHA-256 is
`4b4de11de45c50487510af0ac1ea941fea51d297f5430b8b35634ed60e592aea`.

This remains unregistered candidate evidence. Device/power faults, a crash
inside Kopia's own Flush, simultaneous-writer fencing, full credential lifecycle,
retention, migration, net-savings qualification and default/profile admission
remain open; destructive GC is not a gate. Phase 5 remains OPEN, Phase 6
LinkGroup GATED and the whole product NOT COMPLETE.


## Darwin native-notice package and current-source preview (2026-10-07)

The package cohort binds an 835-input source snapshot at tree SHA-256
`55efbff10650c3c7a78ac5c582608885ffffcda849a9c85a4611e230c0d5aa72`; an
independent overlap record confirms its 535 Go/module/license inputs exactly
match the broad-test input tree
`fd8657a9d4e11df8db9afb56e760ef8f19047303cf7dd4b005c3a9d8cdd0f3cd` (535
inputs, zero post-run mismatches). The serial broad command was
`go test -mod=readonly -count=1 -p 1 -tags 'purego savingsreport' ./...`;
28 test-bearing packages and 6 packages without tests passed in 281.978 seconds
(log SHA-256
`10fbd0c2161319c848643f327198305b6b92fec093ac68af1901ae2c5547b74f`). This is
development regression evidence for that frozen cohort.

The generated Darwin/arm64 semantic archive SHA-256 is
`2f88fe3d84befcb0dcb60fd05a4b7300c1cdfc760e5413b3815fa550ea148e63`, with
profile digest `10dd1f02843d6088efff8edb286ff2ff9fe7123232a8dcc9acaf9d17565e4642`.
The outer candidate package SHA-256 is
`c3781ab6b51e16083d99c87eb98fb60cef98653757831a9e7e16d60c783be923`; smoke
result SHA-256 is
`1f24c2633130c999cca01c467731b81fb24b6884a6688ffc6c88d3c00f2455c8`. The
smoke exercised the actual pinned BGE/zvec bundle, semantic and lexical
queries, and independent-anchor catalog-free restoration of 89 bytes with
SHA-256 `5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`.
The retained URL-mapped transport helper built this candidate; the smoke proves
package behavior, not ordinary online installer transport. Source overlap,
cross-check and smoke records are in the
[`phase4-native-bundle-notices-20261007` cohort](../../dist/whole-product-20261006/phase4-native-bundle-notices-20261007/).
The older 533-input
cohort's separate ordinary online installer PASS remains historical evidence;
no ordinary online install was run for this newer native-notices cohort.

The bundle carries a 14,867-byte LICENSE asset (SHA-256
`2d0cf767f763173302b1e9b1bb269d4136e9b5e1dde2e6ea5f5be9e6422d57f9`) and a
343,579-byte NOTICE asset (SHA-256
`4ca002a82f5153b087e02b0bf45555dc392d274ed8cff328728376332a725d84`). Exact
retained full-text bodies cross-check as follows: ONNX Runtime LICENSE 1,073
bytes / `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`;
ONNX Runtime ThirdPartyNotices 336,906 bytes /
`53d3fa5821ac016ac24dd35775c996efec86e2ae0841e9a3a5e146c0ae916845`; zvec
LICENSE 11,356 bytes /
`43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1`; zvec
NOTICE 5,020 bytes /
`332b1a498b446fab1232b671c2ba74102fc563c198dc6f53980d1282075958ad`. The
selected ONNX Runtime dylib is the canonical archive member and matches the
consumed binary. This establishes these four native text bodies in the
candidate package; converted model/tokenizer license applicability, remaining
native transitive closure, Web SBOM/notices and complete redistribution review
remain open. Candidate and broad-suite failures/attempts remain retained.

The live preview has separately been promoted to PID 57237 from the same
535-input source tree. CLI SHA-256 is
`aa87a00c22dc9261e440b14f4399a2a295a04e0a5eb5c3d4ab2b5f638ac8ad77`; daemon
SHA-256 is
`52b87e4d1e7a885b59a13d6d49b22e1b2e0aaaa59e08f4fe8ea3b4e9d9f179e4`. The
promotion retained config, tags/Notes, descriptions, jobs, fused and pinned
search generation `idx_20e1ddec9b1bc247a76ee54f03802d6e`, and all six served Web
asset identities; catalog-free full-byte verification passed for 3 files / 4,179
bytes. The promotion did not install the new semantic bundle or rebuild the
index: the previous live bundle and generation remain installed. Promotion
result SHA-256 is
`ebe80bae2cec0e570bb1b7a90bcc624d128168db1dcb2d07ce5d8de812f08fdf`.
Provider-loss smoke for the new package cohort and the full browser suite were
not run. The [promotion record](../../dist/whole-product-20261006/native-source-preview-20261007/promotion-v1/promotion-result.json)
contains the before/after observations. This is a bounded development
promotion, not release qualification.

## Current-interface full-text package successor (2026-10-07)

A v2 outer package now binds the exact current six-file live Web asset set to
the same Darwin CLI/daemon and native semantic bundle. Its SHA-256 is
`cc75e62c357182df74b8c3216cede4233239fef749ead39556d18ddbe07e9c89` and its
size is 102,159,596 bytes. The unchanged isolated smoke passed in 43.214
seconds: offline install and restart, real BGE/ONNX Runtime plus zvec semantic
search, SQLite FTS lexical search, and independent-anchor catalog-free restore
of 89 bytes (`5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`).
It used the existing CLI `aa87a00c22dc9261e440b14f4399a2a295a04e0a5eb5c3d4ab2b5f638ac8ad77`
and daemon `52b87e4d1e7a885b59a13d6d49b22e1b2e0aaaa59e08f4fe8ea3b4e9d9f179e4`.

The archive contains 191 retained full-text records totaling 841,257 bytes:
53 Go/native/toolchain/project records and 138 Web records. All 26 current
linked Go module tuples matched BuildInfo; five Web package roots were
attributed, four with nonzero rendered bytes, and all five have retained full
text. Root cross-check verified all 209 checksum entries in the 210-member
archive, all text lengths and hashes, and the exact six Web asset hashes against
the current live tree. Package input hashes showed no drift across assembly.

This remains a bounded candidate package. The frozen helper reports Web build
linkage `NOT_ATTESTED`; 26 component rows remain `UNKNOWN`, and the SBOM is
incomplete. Native transitive/per-file closure and model-conversion applicability
remain unresolved. The prior `c3781ab6...be923` archive and its smoke remain
historical: its JavaScript and `index.html` differ from current live Web bytes.
The earlier v1 full-text package attempt failed checksum-name preflight before
install; it is retained alongside the corrected v2. The smoke did not restart
the live PID 57237 or replace its installed semantic bundle/generation.
Ordinary online installation, provider-loss and full browser acceptance were
not run for v2. Report SHA-256 is
`0fe14efd644db74317b2abf81c19fb4f16f78314da70a0171217294cdbc8c632`, result
SHA-256 is
`97e7dcd3e484ec6603804e925cd08833cb63d20e7ed9b10c2a2534fa9a220b13`, and the
root package cross-check SHA-256 is
`dbad7d408e428747fda22fef61a879dbf0b742122c21a448047679eb0fbf296e`. Phase 4
and Phase 5 remain OPEN, Phase 6 LinkGroup GATED, and the whole product NOT
COMPLETE.

## Kopia storage-flush fault and concurrent-writer evidence (2026-10-07)

The isolated Kopia candidate passed two injected faults at the actual
filesystem `blob.Storage.PutBlob` call after `SaveSnapshot` and entry into the
real final `RepositoryWriter.Flush`. The first fault returned before delegating
a 4,298-byte pack write. The second delegated that storage write successfully
then returned an injected response-loss error. In both cases, a fresh Kopia
open with a different config/cache observed the target tuple absent; identical
retry published once and exact digest, length and bytes read back. The seeded
payload and all four seeded record-role objects survived both cold opens.
Focused tests passed in 11.071 seconds and the standalone race suite passed in
89.203 seconds. The report SHA-256 is
`5f6a8bb8d9b4dfea46e450d6a9741ccf9023193a387a6c0369b44419dac8473c`; result
SHA-256 is
`a4b7725cecdf735d068bab72fc4d8684a9faffdc29875eb375279070b67a4c9f`. These
faults exercise the storage method boundary, not physical device or power loss;
unreachable partial pack data may remain. No maintenance or destructive
collection ran.

A separate two-process barrier proof reproduced a concurrent publication bug.
Both writers independently observed generation 2, both returned success for
distinct generation-3 roots, and an independent cold open rejected the fork.
The test exited 0 because it asserts that expected bad outcome; this is conflict
reproduction, not a safety pass. Outcome SHA-256 is
`5fae54459533ea165c56d96d1c0e962e8dc486a6828e513a1b7805a04b5b3dc5` (report
SHA-256 `8cbe9f2525f9a1de5ff4c56b77df68b987b835dcc11776324ab061e9c123d68d`).
A later isolated host-owned serialization candidate is reported below; its
cooperating local-process result is not production wiring or remote-locking
qualification. Device/power faults are untested evidence scope, not a new gate.
Credentials, retention ownership, migration, production registration/profile
admission and savings qualification remain open. Phase 4 and Phase 5 remain OPEN, Phase 6
LinkGroup GATED, and the whole product NOT COMPLETE; destructive GC is not a
gate. See the [storage-fault report](../../dist/whole-product-20261006/phase5-kopia-storage-flush-fault-20261007/REPORT.md)
and [concurrent-writer report](../../dist/whole-product-20261006/phase5-kopia-concurrent-writer-proof-20261007/REPORT.md)
for the raw cohort records and limits.


## Kopia host-gate and storage-I/O crash continuation (2026-10-07)

A separate, local cooperating-process candidate used a shared OS `flock` gate
across refresh, snapshot-root enumeration, immutable write/readback, root
publication, reconciliation and receipt handling. The same gate covered
empty-root initialization. Its candidate-driver freeze is
`d757324eaca355f2b5421bb2c205a305414cc412c74d37c20572162d36c7ffcb`; the
10-file copied input manifest is SHA-256
`edcc5dd190f357f0219903166684b998560a1fa1e12ad1d9f7ea897140da0fad`. Focused
Go package output reported PASS in 14.871 seconds and the race package output
reported PASS in 104.448 seconds. The retained aggregate logs do not contain
per-child receipts, generations or PIDs, and the tee pipeline exit field was
not retained. This fixture covers cooperating local processes only, not
production registration, remote/NAS locking or non-cooperating writers. It
reuses the existing transaction-coordinator rationale: the host gate owns root
publication atomicity while Kopia owns the object/snapshot format and
repository encryption. No API, schema, profile, default or new normative
obligation was introduced. See the [candidate report](../../dist/whole-product-20261006/phase5-kopia-host-serialization-20261007/REPORT.md)
and [machine result](../../dist/whole-product-20261006/phase5-kopia-host-serialization-20261007/result.json).

The latest storage-I/O crash cohort killed its owned process while the actual
filesystem `PutBlob` method was held at the final `WriteSession` Flush
boundary. The corrected report, machine result, and root-reviewed raw cross-check agree;
both focused and race raw logs found the target tuple absent before retry in both modes: before storage delegation
(94-byte target) and after the underlying 95-byte write succeeded but before
`PutBlob` returned. Both retries reported `Existed=false`, advanced generation
6 to 7, and passed exact readback; the baseline payload and four record roles
also survived both cold opens. The race run passed in 102.165 seconds. The
source freeze binds 4,634 inputs with zero post-run mismatches
(`0e0bce4a3bd2411850d15632bdb6ecde718a9fa42c70c02f5c131a93329dbf21`). Focused
and race raw log hashes are respectively
`0160b79e96fb4698ff9a15075ad16562b0dcde7a48a50c93c56ab01b91eba2ce` and
`94cb23534ba375c5ce6c00e6b251b7eccadfae24a0e1d05d28e3a9d96f415f4d`; the
root-reviewed [raw-case cross-check](../../dist/whole-product-20261006/phase5-kopia-storage-flush-process-crash-20261007/root-review/raw-case-crosscheck.json)
is SHA-256
`cf1a4458c62b5e280cf3abbe368f8de7ced3a1f9018d86fc06c1b2527abe6c55`. The
corrected [report](../../dist/whole-product-20261006/phase5-kopia-storage-flush-process-crash-20261007/REPORT.md)
hashes to `f453dc1d1c12f68672b190f2f713b0ec860708ddcb1417cf9de572327be312e0`;
its corrected machine result hashes to
`2713b4f05533c3d7e666987ed4271f1d081dab9a49ebb17c1a1aeebd71e74b27`.

This new storage-I/O crash test does not inherit the older, separate
process-death case after a successful whole Flush, which observed a committed
object and an idempotent retry. Its small 94/95-byte records are not the
separate 32 MiB streaming fixture. These remain isolated candidate tests; physical device and power loss are not
simulated by this evidence and do not add a gate. Corruption, credentials,
reader/profile admission, migration, non-destructive retention ownership,
package/corpus savings and release gates remain open. The existing root-publication failure and its repaired local
cooperating-process experiment are recorded separately; neither earns Phase 5
qualification.

## Kopia credential-backed signed-reader candidate (2026-10-07)

An isolated child-process candidate now exercises the real signed recovery
sequence with a fresh reader config/cache and an external public trust anchor.
Before reader startup, the writer catalog, signing material, source, config,
cache and unsigned snapshot sidecar were removed. The correct credential
imported the recovery artifact, listed one snapshot, performed full-byte
verification and restored three files totaling 46 bytes; it made no repository
writer calls, created or used no catalog, and left the repository inventory
unchanged. Missing and mode-refused credentials failed before connection;
wrong credentials failed authentication before driver/service/output, while a
private cache remained; a missing candidate root was rejected before adapter
Open.

Both focused and race runs passed with captured exit code 0 (3.181s and
116.845s). Each run retained five child PIDs and outcomes. The sentinel scan
reported no credential or secret digest in 77 successful file-scan operations
per run. The 227-input candidate freeze has zero post-run drift
(`eabf905ace8f16fdaf8c4b0c00da5f713059e3a791a411590360b5e3cd1fe1cb`). The
report SHA-256 is
`879c90cdae4ec3a9dcb8b95e51325af1ba11a297aedd41f8f07fff840d1db946`, focused
result SHA-256 is
`d05dd4b28d9f38a702b294bd5487034c1b310c5281f3a63e7792a04b2fd5700b`, and the
root review SHA-256 is
`0961c426dd20fba09fa7a27dd4851a9b23767683b2116a7c0a114b2e01d9d7a9`.

This is a bounded local credential fixture, not OS secret-store integration or
production profile admission. It does not prove erasure of in-memory password
copies, a separate disaster domain, or remote-host behavior; the five child
cases share one test executable. Production credential lifecycle and standard
reader/profile admission remain open. A separate bounded cold-relocation and
one-pack-byte-corruption candidate is now recorded below; it does not close
signed/profile corruption or relocation requirements. Phase 4 and Phase 5 remain
OPEN, Phase 6 LinkGroup GATED, and the whole product NOT COMPLETE. See the
[`phase5-kopia-credential-reader-20261007` report](../../dist/whole-product-20261006/phase5-kopia-credential-reader-20261007/REPORT.md).



## Kopia cold relocation and private-pack corruption candidate (2026-10-07)

The isolated Kopia v0.23.1 candidate cold-opened a byte-identical relocated
repository containing 12 files / 33,578,521 bytes. It read back a 32 MiB
indirect payload (six leaves) and an opaque prepared-closure record; inventory
remained unchanged. A second repository copy had exactly one persisted pack byte
flipped (XOR 1). Verify rejected that copy and its full-stream read failed
before returning any payload bytes. Focused, race, and package runs passed with
exit 0 in 8.028, 22.077, and 16.686 seconds. The 2,437-input freeze had zero
post-run drift; root review checked the archive entries and three run copies,
with no inode aliases. The unchanged driver hash is
`d757324eaca355f2b5421bb2c205a305414cc412c74d37c20572162d36c7ffcb`.

This is bounded local candidate evidence, not an enforced read-only open, a
signed Restore API test, coverage of all portable roles or corruption classes,
standard reader/profile admission, or release qualification. The root-reviewed
result also confirms the 535-input production cohort and live PID 57237 were
unchanged. See the [candidate report](../../dist/whole-product-20261006/phase5-kopia-corruption-relocation-20261007/evidence/RESULTS-v3.md),
[machine summary](../../dist/whole-product-20261006/phase5-kopia-corruption-relocation-20261007/evidence/summary-v3.json),
and [root review](../../dist/whole-product-20261006/phase5-kopia-corruption-relocation-20261007/root-review/result.json). Broader signed/profile corruption and relocation, production credential lifecycle, standard reader/profile admission, migration, non-destructive retention ownership, and common engine qualification remain open.


## Kopia pin context (2026-10-07)

The isolated, unregistered probe retains Kopia v0.23.1 at verified tag commit
`72ec08fd8edb86c67ed27099bf1b955e1f308ffa`; its module checksum is
`h1:0+V5Au8fD+190vQbklG0DaWD6I4clmbwlmJTqtI0y0Q=`. The retained upstream
Apache-2.0 LICENSE is SHA-256
`cd83acc95b12c0ee2a9271950b7f23be45294483b9e12869ef0d31fc9e8248f8`.
[GitHub release](https://github.com/kopia/kopia/releases/tag/v0.23.1) marks it
latest and calls out a data-loss race fix. The reviewed
[GHSA-2q4c-3mrw-63c3](https://github.com/kopia/kopia/security/advisories/GHSA-2q4c-3mrw-63c3)
and [GHSA-j5vm-7qcc-2wwg](https://github.com/kopia/kopia/security/advisories/GHSA-j5vm-7qcc-2wwg)
ranges exclude v0.23.1; this is not broad vulnerability assurance. Kopia's
license does not close transitive notices. The check selects no engine/default
and awards no qualification.


## Copy-forward and current Linux package checkpoint (2026-10-07)

A bounded Kopia copy-forward candidate passes focused, package, and race runs
(exit 0; 9.888s, 18.530s, 141.203s). It copies three payload objects (39
logical bytes) and one each of four signed record roles, then independently
imports, lists, fully verifies, and restores from stage and final target; the
source is checked before copying and after rollback. Partial stage and canceled
copy refuse publication. The 4,674-input freeze and source inventory stayed
unchanged. This is a local candidate, not profile/default admission, savings,
or full migration qualification. [Report](../../dist/whole-product-20261006/phase5-kopia-copy-forward-20261007/REPORT-final.md),
[result](../../dist/whole-product-20261006/phase5-kopia-copy-forward-20261007/result.json),
[root review](../../dist/whole-product-20261006/phase5-kopia-copy-forward-20261007/root-review/result.json).

The first current-source Linux arm64 package archive was blocked before guest or
runtime testing: two ONNX Runtime `tar_member` provenance paths include a
leading `./` absent from the exact source archive headers. The license and
notice bytes match, but those source paths do not. The archive is
`9b1b4a9aa7d2851c1efe1c0ca1075f369a1d51665b674096d738cb7f7d8ced13`; runtime
status is NOT RUN. Source selection was separately repaired before build: the
consumed 835-member archive matches all 535 current Go inputs; the earlier
534/535 archive remains historical. A production provenance-path correction
is pending.
