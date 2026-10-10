# Local product continuation acceptance — 2026-10-06

Status: implemented local maintenance and candidate evidence; not release
qualification. This informative record cannot change the normative status
matrix, signed formats, or execution-plan order.

The later [retrieval and accounting continuation](retrieval-and-accounting-acceptance-20261006.md)
supersedes the running daemon and candidate identity below. This record retains
the earlier slice's browser, recovery, and regression evidence.

The operator requested continued implementation with Luna. The primary agent
owns decisions, integration, and acceptance; Luna owns disjoint bounded code
and evidence slices. Local Mac trial remains the immediate target, with no
Linux or NAS prerequisite for this development work.

## Decisions and implementation boundaries

| Slice | Active phase / normative requirement | Executable exit |
| --- | --- | --- |
| Existing content inspector | Phase 3 browser maintenance; API and WebUI §§4.3/6: bounded content transfer and visible interaction outcomes | A real protected 1–8 MiB image renders after chunk/range and complete identity validation; larger input falls back; bad ranges, bytes, failed reads, and cancellation cannot render stale content or leak a handle |
| Existing discovery acceptance | Phase 4; content-store discovery contract and execution-plan complete field/segment feed | Real pinyin/CJK/ONNX-BGE retrieval, positive field coverage, structured subject sets, fused query, and index rebuild preserve durable facts and bytes |
| Storage evidence | Phase 5; content-store exact identity and measured recoverable savings | Mechanism-separated same-corpus raw/zstd accounting plus uncached corruption, relocation, crash/retry, migration, and independent-reader checks |
| Browser and package verification | Phase 3 browser maintenance / Phase 4 candidate distribution; API interaction principles and release-qualification §6 provenance | Explicitly enabled missing prerequisites fail; actual browser online/offline/recovered runs; package contains the unchanged Unicode notice under checksums and passes independent-anchor clean-reader smoke |

Existing image inspection is useful to the ordinary select/use/takeout loop,
but its previous 1 MiB whole-file ceiling refused common originals. The
inspector now admits PNG/JPEG/GIF/WebP up to **8 MiB** after explicit selection.
Each read remains within the host's `max_read` and a 1 MiB transport cap.
Automatic thumbnails remain **1 MiB**, their session cache remains 48 entries,
and text remains **64 KiB**. Verify handle, offset, length, EOF, complete
SHA-256, and logical length before presentation. Cancellation guards surround
reads and asynchronous hashing; each owned handle closes once. Larger files
keep the visible original-download/export route.

This refines the existing inspector; it introduces no album, player, provider,
public operation, schema, signed record, durable setting, or runtime loader.
The rationale is also recorded under
[ADR-021](build-stack-and-architecture-selection.md#adr-021-replaceable-bundled-interface-experiences-over-shared-client-flows).

## Current build and retained evidence

Checkout: `main`, HEAD `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, with prior
uncommitted work preserved. This HEAD alone does not identify the dirty build.
The retained continuation root is `dist/all-completion-20261006/`; binaries,
asset digests, logs, and package manifest bind the actual tested artifacts.

| Check | State and scope |
| --- | --- |
| TypeScript / Vite production build | PASS; current JS `index-Cz9x7w2c.js`, SHA-256 `3cb3b35b9da461032a224418892b6f2f08a5411574eea105ef32513a423c60a3`; CSS `index-Bd8xrHY8.css`, SHA-256 `438a18a706ce4e37ebf85817e52ac4847c9b14bb23eec4d79b58a04a84efa6af` |
| Client preferences and localization | PASS; static slot/preference/fallback checks; 1,544 merged translation keys across 53 client source files |
| Broad Go | PASS, `go test -tags purego ./...`, `integration/go-tests-fd-fixed.log`; ordinary provider-gated tests may skip, so this is not real-provider qualification |
| Large-image and negative browser checks | PASS on the fixed daemon and final assets; `photo-preview/final/result.json`, runtime/digests, and desktop/narrow screenshots |
| Whole browser online/offline/recovered | PASS on the fixed daemon and final assets; `integration/web-e2e-fd-fixed.log` |
| Shared interface behavior on current assets | PASS on final assets and fixed daemon, live held-status/state + injected render-fault recovery + disposable held Notes save exactly once; `integration/interface-settled-final/` |
| Provisioned real semantic Go E2E | PASS with CGO + `purego supervised_integration`, real pinned assets, and private worker temp root; no skips; 104.538 seconds |
| Exact offline candidate and clean-reader restore | PASS on the final FD-fixed candidate; `integration/package-fd-fixed-smoke/result.json`; outer SHA-256 `c277dc8184cff4e1e71bde84b9b6b3f95e4a38d99cd6394f8415d7e04427a41f` |

The first broad Go run discovered deliberately duplicated `Add` definitions in
the retained generated QA corpus, rather than a production-package failure.
The unchanged corpus was moved to `_generated-qa-corpus` so Go excludes its
sample files from package discovery; the broad command then passed. The first
whole browser run failed an obsolete five-category expectation: Settings has
six categories, including Appearance. The repaired test checks all six named
categories, their active headings, and responsive reachability. Neither
initial failure is reported as passing evidence.

## Runtime ownership follow-up

The real QA process remained alive while its HTTP listener stopped with
`accept tcp 127.0.0.1:4648: bad file descriptor`. The first interface harness
passed the live held-status/read stage, then failed when it could no longer
reach the API. A source audit identified two existing no-follow descriptor
ownership defects: nested semantic-bundle admission could close an
intermediate directory descriptor twice, and nested repository reads leaked
the root descriptor. These are concrete reader-lifetime bugs, not a reason
to add a new state store or service.

The bounded follow-up changes only ownership cleanup and adjacent regression
tests, preserving no-follow admission, exact identity, paths, profile/signed
formats, and reader semantics. The two adjacent regression tests failed before the fixes: 64 nested repository
opens leaked 64 descriptors, and concurrent nested-bundle opens invalidated a
reused directory descriptor. Both pass after the fixes, including three
concurrent stress repetitions and existing symlink/corruption/reader checks.
The baseline output was retained only in tool output and transcribed; that
limitation is stated in `verification/fd-ownership/README.md`.

The final daemon digest is
`9b5d68b25ffb32f3e91cc6f7d72cd3c3b94b51764856a8d1109c7e3f01f9b720`.
An isolated run passes 100 exact open/read/close cycles and 10 interleaved real
ONNX/BGE + zvec default queries with NOTE provenance. HTTP and Unix listeners
remain available; descriptor count is 16 before and 18 after, and no BADFD
lines occur. This bounded local stress is not a soak or concurrency release
qualification. See `search/fd-stability/REPORT.md`.

The original QA profile was reopened by the fixed daemon at 4648 (PID 73363),
retaining all three published subjects and the existing tag/Notes data. Its
configured model is ready; incomplete corpus coverage and historical attempts
stay visible. `integration/live-runtime.json` and the actual in-app-browser
screenshot record this preview. Larger-image inspection separately passes four
ranges totaling 3,147,775 bytes, exact digest reconstruction, over-budget
fallback without opening a handle, bad-range/corruption/interruption/cancel
rejection, single close, and zero-length text. The 1024-pixel square is rendered
at 264 by 264 on desktop and 310 by 310 at 390px, without horizontal overflow.

The actual provisioned Go semantic integration test requires CGO, arm64, and
`purego supervised_integration` tags in addition to real assets. An initial
command omitted the latter tag and ran no tests; it earns no credit. The next
actual test failed because this host's short `/tmp` location produced a worker
proof directory with GID 0 while the current process group is 20. The worker's
ownership/0700 proof check correctly refused it. The test now supplies its own
short, canonical, current-UID/GID private temp root and logs startup context on
first-query failure; the production security rule is unchanged. The real
semantic end-to-end test passes without skips (104.538 seconds), separately
from ordinary Go results. See `verification/supervised-semantic/` for the
exact command, artifacts, and evidence limits. Linux execution is not claimed.

The original listener failure, skipped command, failed supervised run, and
pre-fix package remain historical evidence. None is relabeled as a passing
run. Current interface error-fault acceptance additionally waits for the
submitted real Photo query to finish before selecting an item or typing a
Notes draft: the old harness clicked a stale library result while search was
still in flight. Normal query completion intentionally clears detail state;
that was not evidence of an interface-boundary reset. Retention assertions
remain unchanged after the corrected precondition.

## Discovery evidence

The isolated real-daemon corpus in `search/` finds the intended subject with
`lvxing`, `lx`, `西湖`, `xihu`, and a full Chinese filename. Real semantic
queries use the installed pinned ONNX/BGE + zvec bundle. With the provider
explicitly unavailable, lexical retrieval and exact content reads still pass;
status exposes semantic unavailability.

Its initial one-file corpus correctly reported missing duplicate/group and
locator fields. The separate `search/positive-coverage/` corpus uses typed
plan/apply to admit two exact duplicates and one credential-free external
locator, without fetching that URL. It reports all 20 declared fields present and `complete:true`. Content-ID,
duplicate-group, and size/protection/type filters select exactly the duplicate
pair; the external-fallback mode filter selects only the locator subject. The
default broker fuses one lexical hit with three real semantic hits and retains
matched ANNOTATION/NOTE provenance. Losing only the disposable derived index
directory exposes UNAVAILABLE; durable Notes/tags/descriptions and all 87 exact
bytes remain unchanged. Typed rebuild restores coverage, both components, and
the intended subject sets. Raw outputs and the exact scope are retained in
`search/positive-coverage/REPORT.md`. Corpus coverage is an observation,
not proof that every real library has every fact or every field case is
qualified. Complete segment provenance and supported-host/default-profile
qualification remain independent gates.

The existing pinyin table uses pinned Unihan data. Incorrect public-domain
wording was replaced with Unicode License V3 attribution and an included
verbatim notice. Input SHA-256 and generated table-body digest are unchanged;
no data was regenerated, lexical profile changed, or index rebuild required
by this notice correction. Candidate packaging carries the notice under
`licenses/Unihan.LICENSE.txt`, refers to it in `NOTICE`, and covers it with the
existing checksum manifest.

## Storage evidence and product implication

`storage/RESULTS.md` retains manifests and exact commands. Two copied source
subtrees were checked unchanged before and after; they are code/documentation
samples. The separate 15-file heterogeneous corpus is generated QA. Neither
is described as a representative NAS/operator corpus.

| Corpus | Logical bytes | zstd duplicate savings | zstd compression savings | zstd repository-only net savings |
| --- | ---: | ---: | ---: | ---: |
| Source code and documentation | 2,251,922 | 0 | 1,500,038 | 1,499,973 |
| Generated heterogeneous QA | 4,213,099 | 5,096 | 11,564 | 16,434 |

The read-only QA catalog bundle is 996,560 bytes, vectors 47,114,753 bytes,
and model/runtime bundle 180,473,693 bytes. Temporary peak was not measured;
deployment-wide net remains `UNMEASURED`. Repository-only savings do not
represent deployment savings. Uncached raw/zstd relocation, corruption,
process-crash retry, migration interruption, independent source/target
reader, and declared reader-closure tests passed for the admitted development
scope. No release repository is selected.

The measurements support keeping useful retrieval and original takeout as the
product's center: compressible text has meaningful savings, while this mixed
QA sample has much smaller storage savings. They do not predict all media or
prove demand, retention, or traffic success.

## Remaining gates

- Phase 4: complete admitted field/segment and source-case qualification,
  supported clean-host/default semantic profile and packaging evidence.
- Phase 5: representative operator-reviewed corpus, actual peak/deployment net,
  full repository/reader/migration release evidence and a dated engine choice.
- Phase 6: LinkGroup schema/API and group-aware export remain behind both gates.
- Phase 7: supported-host packaging, upgrades, backup, performance, and full
  release acceptance remain open.
- Albums, music/video players, new index dimensions, third-party runtime
  plugins, and tenancy remain outside the current lock. They are product
  direction, not delivered capabilities.

The current [AGENTS lock](../../AGENTS.md) and
[Core MVP Execution Plan](core-mvp-execution-plan.md) remain authoritative.
This local continuation does not claim that the entire project is finished.
