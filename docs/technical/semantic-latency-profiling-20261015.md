# Local semantic latency profiling — 2026-10-15

This Phase 4 investigation measures existing components of the admitted local
ONNX/BGE + zvec path. It adds no capability, dependency or general Phase 4,
Phase 5, or release-qualification credit. The initial component-profiling
checkpoint did not change the installed profile or owner data; the later
candidate and live-acceptance evidence below records the subsequent reviewed
build and cutover separately.

## Measurements

The existing native HTTP proof records warm requests of 2.51–2.59 seconds;
the deployed owner instance separately records 2.76–2.78 seconds. The following
are direct component measurements, **not spans inside those HTTP requests**.
They used the retained bundle, an isolated config, a supervised worker and a
disposable copy of a retained collection; they are not representative-corpus
or platform qualification.

| Component | Observed time |
| --- | --- |
| Full ONNX bundle admission | 659–748 ms per pass |
| Current daemon executable SHA-256 | 92–100 ms per pass |
| Supervised worker startup | 5.015 s |
| Direct warm ONNX inference | 4.73–14.21 ms |
| Native collection opening | 1.80 s cold; 482 ms warm reopen |
| Direct vector query, 20 hits | 6.07 ms first; 0.27–0.28 ms thereafter |
| SHA-256 of the same 180,833,528 asset bytes, default arm64 build | 99–134 ms |
| The same hash with the `purego` build tag | 656–794 ms |

The factory revalidates the full bundle and executable before and after
inference. The indexer opens/closes the generation for each query. Source and
component timings therefore point to admission/opening as the dominant warm
cost; dispatch, catalog and provenance costs were not individually instrumented.

## Decision and next boundary

Keep full asset/executable checks, generation binding, cancellation recovery
and lease fencing. Skipping those checks is not an accepted performance fix.
Go's `purego` tag selects generic SHA-256 and excludes arm64 SHA2 assembly.
The pinned `zvec-go` module also requires that global tag for its dynamic
loader; the existing package assembler checks it explicitly. A Cairn-only tag
rename would not solve this collision.

SDK build-tag separation is a candidate requiring a dependency/profile review,
auditable source pin and packaging evidence. A replacement must retain exact
hash results, native loading and recovery behavior, and must not silently
reinterpret existing profile-bound generations. At the profiling checkpoint no
SDK fork, build-tag switch, new profile or library cache was implemented.
Comfortable end-to-end latency and the full Phase 4 gate remain open.

## Candidate implementation continuation

A separately reviewed local source candidate now uses `cairn_zvec_dynamic`
without global `purego`. The complete 56-file pinned upstream zvec-go source
is retained under `third_party/zvec-go`; its only code changes are build
constraints, with an added provenance note and preserved Apache-2.0 LICENSE.
The immutable upstream requirement and go.sum entry remain. A version-specific
local replacement, source digest, build/package checks and hashed `zvec-go.txt`
receipt bind the exact patch and loader tag. Source SHA-256 is
`15f6c7c021f4e5be1232c072e381c1c7c109e5b9d428857899bcb1f91fb338be`;
the new receipt SHA-256 is
`11de8e8441114dc74b0b30e21319ab683f6fee73b482b088274c099c4a0c79d2`.
The receipt changes the bundle profile and generation provider digest. Existing
generations cannot be relabelled to satisfy the new admission contract.

The parent reviewed the upstream comparison, loader guards, first-party diff,
receipt and final test-harness corrections. Focused provenance/installer checks,
source-tamper rejection, custom-tag daemon build, legacy-tag compile, shell
syntax and `git diff --check` pass. BuildInfo records the custom tag without
global `purego`; file selection excludes SDK Cgo files and the Darwin arm64
binary contains the SHA2 assembly symbol. One broad custom-tag Go cohort passed
after correcting an obsolete launcher-tag test expectation; passing packages
were cached on that rerun. This is source/build evidence, not measured latency.

The existing isolated `TestCandidateOfflinePackageSemanticLifecycle` passed
without skipping in 57.793 seconds. It builds fresh custom-tag binaries and
tests offline package/clean install, real BGE semantic rebuild and fused query
through the WebUI, description provenance, generation reopen, provider-loss
lexical fallback and full-byte snapshot verification, then a fresh generation
after provider restoration. Its first attempt stopped at an obsolete Settings
selector. The reviewed harness now opens the actual navigation/search
disclosures with UI clicks; all semantic assertions remain intact.

Ignored records are under `dist/zvec-build-tag-candidate-20261015/`: candidate
`summary.json`, build/selection/provenance logs, broad-test first-failure and
passing-rerun logs, and `native/rerun-result.json` with command, source/input
hashes and native log. The native test's temporary binaries were removed by
test cleanup; its result does not assert identity with the separately retained
staged daemon. At that test checkpoint, native original-download takeout and
comparative end-to-end timings had not been tested. Later identity-matched
proofs are recorded below. The fixture is not representative recall evidence.

At this isolated-comparison checkpoint, the owner daemon, installed bundle,
catalog, configuration and active generation were not changed. The candidate
was implemented and tested in isolated clones; this paragraph describes that
checkpoint, before the later cutover documented below. The comparison advances
local timing evidence but is not representative-corpus or release qualification.

## Isolated ordinary-query comparison

The parent-reviewed V2 comparison uses independent copies of the same retained
20-file corpus, explicit typed clone-local configuration, separate model roots
and newly rebuilt generations. Both daemons run sequentially. The candidate's
new receipt-bound bundle provider digest is
`sha256:e0bd47ce5146d2dd2885261678fc27c2592e20c5af3636dfb2af6858c8b60b2a`.
The parent independently checked all five paths, 66 retained index paths per
variant, absence of symlinks and all eleven asset hashes. Only the SDK receipt
and its SBOM differ from the baseline bundle.

| Ordinary default fused query | Baseline, ms | Candidate, ms |
| --- | ---: | ---: |
| First query after restart, 星空 | 6,833.827 | 2,639.753 |
| Warm, 星空 | 2,651.049 | 598.832 |
| Warm, Cairn | 2,765.148 | 551.807 |
| Warm, 暖光 | 2,691.605 | 542.160 |
| Warm, 试听 | 2,669.354 | 476.604 |

The four warm-query medians are 2,680.480 versus 546.984 ms, an observed 79.59%
reduction. Every query succeeds with twenty real semantic hits and source
provenance; all five full ordered result-identity lists match across variants.
The actual browser-original HTTP route returns the same 426,519 bytes and
SHA-256 `b631c60a9eab2ffd6869092d17dae01d9f318114de7ee99c0df50ec3472ec1f1`.
The parent rehashed both downloaded files and checked the result identities,
semantic components and four clean daemon exits. Rebuild remains honestly
`DEGRADED` for incomplete lexical-field coverage; its semantic capability is
`AVAILABLE` and post-restart index status is `READY`.

Evidence is under `dist/zvec-build-tag-candidate-20261015/comparison-v2/`:
`preflight.json`, `root-preflight-review.json`, `comparison-summary.json`,
`root-final-review.json` and variant query/download/log files. These are a
small local development comparison, not representative recall or performance
qualification. First-query timings include process-local startup costs, not
an operating-system cold-cache experiment. The owner service is not changed
by these measurements.

The earlier `comparison/` attempt is invalid: a copied config still targeted
the retained test-state directory, and index rebuilds mutated that test
projection. Its timings cannot be used. The retained state was not overwritten
to hide the incident. The independent incident audit finds identical durable
content/annotation/description/view/publication tables and identical repository
and recovery files; differences are index projections and a fencing row. The
new run starts from pre-attempt copies, with parsed-path review before launch.

## Missing-provider declaration follow-up

A first combined missing-provider/download check exposed an existing default
declaration defect: with the real bundle absent, status correctly
reported semantic `UNAVAILABLE` and lexical results remained available, but the
fused semantic component identified `query.semantic.fixture.v1` with
`fixture-exact` and no explicit reason. That failed check stopped before
download and cannot establish the combined fallback exit. Its isolated bundle
was restored and its owned process exited; the owner service was untouched.

The reviewed declaration correction changes the unavailable default to the
local ONNX/cosine profile with `SEMANTIC_INDEX_UNAVAILABLE`. Explicit enabled
fixtures retain their fixture provider and score; installed and real-provider
branches keep their semantics. Focused regressions passed, followed by the
broad `GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` cohort. The first
combined real-bundle-absent run remains recorded as **FAILED** because its
status-level assertion expected the stable query reason code where status
returns a descriptive error string. A separate fallback-only rerun then passed
the fused semantic-component reason, lexical-hit and exact-download checks on
the final binary. The original failure receipt remains under
`comparison-v2/final-native-fallback/final-proof.json`; the successful
fallback-only receipt is under `comparison-v2/final-native-fallback/fallback-rerun/`.

The subsequent parent-reviewed isolated healthy half on the same final binary
passed five default fused queries and exact original HTTP takeout. Its cold
query was 2,239.979 ms and its four warm queries were 471.959, 486.923, 470.218
and 442.268 ms. Each returned 20 semantic-provenance hits with the same full
ordered identities as the isolated V2 baseline and candidate. Because that
initial combined runner stopped at its over-strict status-reason check, these
healthy and fallback-only results are separate receipts; the failed combined
receipt is not relabeled as a passing run.

On 2026-10-15 the reviewed binary was subsequently cut over to the running
owner instance. Before rebuilding, live status reported semantic
`UNAVAILABLE` because the prior generation's profile/dimension did not match the
requested manifest. One explicit rebuild then returned a fresh generation
`idx_96d270c857f8109c2feb064a3d696fb8` under the configured vectors path. Its
provider digest is `sha256:e0bd47ce5146d2dd2885261678fc27c2592e20c5af3636dfb2af6858c8b60b2a`,
and its config digest is `sha256:94a335bee45f0190a24e6e0eede51f2698fec42ef658b85134d056904ea54b01`.
The live generation profile digest is
`sha256:599ccbb23515259f8f2e96e4cc92ae9230cc4355855c1d074b624d4fd297a4ec`;
it binds the live generation manifest and current config, so it correctly
differs from the isolated-clone profile digest. The opened generation passed
manifest checks for the installed runtime, model, tokenizer, preprocessing,
pooling, normalization, dimension, semantic space, distance and index/query
parameters. Post-rebuild status reported lexical and semantic `READY`.

The live ordinary default fused sequence returned 20 hits for each of
`星空`, `星空`, `Cairn`, `暖光` and `试听`, with 20 semantic hits carrying
provenance each time. Every query used that exact generation and matched the
isolated baseline's full ordered identities. Observed times were 966.300 ms
for the first measured query after rebuilding, then 524.864, 520.826, 496.758
and 546.961 ms warm. These are single-run local observations, not a cold-cache
experiment or latency qualification. The existing browser original
route returned HTTP 200, 426,519 bytes and SHA-256
`b631c60a9eab2ffd6869092d17dae01d9f318114de7ee99c0df50ec3472ec1f1`.
All four current published snapshots passed `full-bytes`: 8/8 files and
3,780,475 bytes; 8/8 and 1,223,433 bytes; 3/3 and 50,680 bytes; 1/1 and 61
bytes.

The installed daemon remained PID `66042`, using binary SHA-256
`92481e7341e95c9325c91467454a7e3182eea85cea599efac3ff1f5c249f25e2` and the
reviewed live config digest above through final acceptance. Parent review of
the pre-apply and post-acceptance fingerprints confirms identical repository
files (58) and recovery files (2), with complete inventories and no symlinks.
The catalog remains schema 27. Existing content, description, annotation,
SavedView and publication records are unchanged;
the only changed tables are index generations, generation roots, publication
fences and the audit log. The existing 32-row audit prefix reproduces its
pre-apply row-set hash. Its four appended records are precisely the four
successful full-byte snapshot verifications, with matching snapshot identities,
request IDs, counts and previous-digest links. The generic comparison correctly
retains `REVIEW_REQUIRED` for that audit-table change; the separate parent
acceptance records the explicit review instead of weakening its allowlist.
This closes only the stated local-delay, semantic-query, fallback and
exact-takeout slice. It does not award general Phase 4, Phase 5 or release
qualification.

Detailed final live receipts are under
`dist/zvec-build-tag-candidate-20261015/promotion/live-validation/continuation/`;
the first live harness failure and rebuild response remain under
`dist/zvec-build-tag-candidate-20261015/promotion/live-validation/`. The final
pre-activation composition receipt is
`dist/zvec-build-tag-candidate-20261015/promotion/final-pre-activation-acceptance.json`.
The post-activation parent receipt is `promotion/root-post-activation-acceptance.json`;
`promotion/after-comparison.json` preserves the generic review-required result.
Neither the old binary/model bundle nor old generations were overwritten to
reinterpret their profile; only the stable executable was replaced, with its
old bytes retained for rollback.

## Evidence

The initial component records are in
`dist/semantic-latency-20261015/summary.json`, `component-profile.json`,
`component-profile.log`, `zvec-reopen-profile.log` and `sha-profile.json`.
Temporary helpers from that checkpoint were removed. The older runtime
acceptance cited there describes the pre-cutover `9fa0d17f…871aa2` daemon.
Current process, semantic and parent-reviewed authority evidence is in the
live-validation and promotion receipts above.
