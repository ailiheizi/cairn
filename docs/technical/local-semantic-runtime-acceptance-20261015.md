# Local Semantic Runtime Acceptance — 2026-10-15

This note records a bounded acceptance slice for the admitted Phase 4 default
local text-search path: preserve an existing owner's data across explicit
relocation, run the existing ONNX/BGE + zvec profile on the same host, retain
segment provenance, and verify exact recovery. It adds no product scope and
does not qualify a release.

## Preserved owner state and promotion

The native instance was explicitly promoted from the temporary fixture root to
`/Users/macos/.local/share/cairn`; its persisted catalog, repository, vectors,
models, and recovery paths now resolve beneath that one owner data root. The
promotion preserved the original staged snapshot at
`dist/semantic-ready-20261014/live-backup/` and a validated rollback config
pointing to the pre-promotion paths. The copy inventory reports no source
change during staging, symlinks, or skipped special files. Catalog integrity
was `ok`; the preserved workspace, source, annotation, annotation-revision,
and SavedView facts match their before-promotion row counts and digests.

The semantic bundle was copied with a schema-only profile update: its eleven
non-profile assets remained byte-identical, while the profile digest changed
to `sha256:7c0b3294b4afbc5486f661fb470e66712d1a5a29a0eed7f5b07d1868f0b14fda`.
The live config and running config agree at
`sha256:267adc163400a49eaa22a865a548b788ad2846abab81d4174f1cd9f24eb0982f`,
with `restart_required=false`. The catalog is schema 27; live status reports
four publications, ten plans, fourteen jobs, and the configured
`bge-small-zh-v1.5` / zvec local profile. Promotion evidence is retained in
ignored `dist/semantic-ready-20261014/promotion/` (`promotion-state.json`,
`durable-fact-parity.json`, `live-final-config.json`,
`live-final-status.json`, and `live-install-receipt.json`).

The pre-worker-reuse baseline daemon was
`v0.1.0-prealpha.1.0.20261014050559-d1750d916f19`,
Go 1.26.5 `darwin/arm64` with the `purego` tag; its binary SHA-256 is
`a8b07b0e3fbe82a2ab24e44f14fd1756b62f6ec8b1dad5bef6de363543fdcb56`.
The served JavaScript SHA-256 at that baseline was
`208aed7819195f90c80c0b148b2e6c0ac518c2c8548d140aacde6168a78bb960`.
The post-update identity is recorded below.

The retained fixture-derived corpus audit found 20 entries across all four current source
heads and matched one lexical filename query in each head. Both fused query
dimensions returned successfully on the current generations. A subsequent
`search.rebuild` reported `DEGRADED` because six lexical fields were absent
from this corpus (`duplicates`, `duplicate_group`, `locators`, `notes`,
`descriptions`, `language`); the coverage report correctly left them absent.
That result is not a clean complete-field qualification. Source-scope and
rebuild evidence is in ignored
`dist/semantic-ready-20261014/promotion/scope-audit/` and
`live-search-rebuild.json`.

The successful current generations were lexical
`idx_b3cb66fa7ed0996d474abe3e7bc4f44e` and semantic
`idx_7436681d798256fa48cb73abb8746887`; the audited default fused query
returned 20 hits from each component. The live browser query independently
reported the semantic component as succeeded with segment/source provenance.

## Executed acceptance

- All four retained snapshots passed `snapshot.verify --mode full-bytes`:
  20 files and 5,054,649 bytes verified. The receipts are in
  `dist/semantic-ready-20261014/promotion/qa/full-bytes-verification.json`.
- A portable reference for the eight-file snapshot was imported by an isolated
  catalog-free reader using the independently retained trust anchor. Clean
  recovery verification and restore passed; all eight paths and 3,780,475
  bytes matched the original tree. The reader exited cleanly. Details are in
  `qa/clean-reader-restore.json`; reference and anchor digests are recorded
  there without reproducing key material here.
- Headless browser use of the live local app produced a real fused Chinese
  semantic query with the ONNX/BGE + zvec component `SUCCEEDED`, a visible
  matched source segment/provenance, and a separate lexical filename fallback.
  Downloading that fallback's original returned the catalogued 253 bytes and
  SHA-256 exactly matching the retained source. Browser requests stayed on
  `127.0.0.1:4648`; the capture is
  `qa/browser-semantic-lexical-download-passing.json`, with 1280-pixel
  semantic and lexical screenshots beside it.
- The semantic profile digest above is the installed local bundle identity;
  the exact ONNX model artifact is present, but its source-weight revision is
  `NOT_VERIFIED` and delivered-model license applicability is
  `OPEN_FOR_REVIEW` in the installed profile manifest.

The compact identity and result index is
`dist/semantic-ready-20261014/promotion/qa/acceptance-summary.json`. Its binary
and served-Web hashes bind this evidence to the local build observed in this
slice. These are development-host results over a fixture-derived corpus, not
representative-corpus, platform-matrix, or release evidence.

## Post-update worker-reuse acceptance

The reviewed worker-reuse candidate is active on the same owner data at
`127.0.0.1:4648` (daemon PID 68127). Its daemon SHA-256 is
`9fa0d17f441ee416030fa36a7a1cb6c51996efef30561d7d90a068a124871aa2`; the CLI
SHA-256 remains
`2df793a232938f2bdcec0168c2283ed75c12c45d7c9158d08b84830c3ae828e4`. The
config digest, catalog facts, trust anchor, and semantic generation are
unchanged. Served HTML, JS, and CSS hashes match the prior first-party web
assets (HTML `86a3055ef725569ca41b66eaba1023c54d8676d95a8ec41745c34cde272eccb1`,
JS `208aed7819195f90c80c0b148b2e6c0ac518c2c8548d140aacde6168a78bb960`, CSS
`408af5363bcf46346afac5e50b4754305477030bc97de00e6b05a2c0e036729a`); the
runtime candidate changes no WebUI. The factory owns bounded serialized
sessions bound to the exact generation, with lifecycle and asset validation;
an interrupted startup does not poison a later valid request. Activation and
identity evidence is in ignored
`promotion/worker-reuse-live/activation.json`.

The native acceptance script exercised the candidate on an isolated catalog
and the installed model bundle. A query against the rebuilt generation returned
20 semantic hits in 2.774 s before restarting that daemon. Startup reopened the
compatible generation. A genuine pending TCP abort during new-worker
startup was followed by a successful same-daemon retry with 20 hits in 7.176 s;
two subsequent requests also returned 20 hits through the same worker PID in
2.506 s and 2.595 s. The cancellation path discarded the interrupted worker
and preserved the healthy semantic generation. This clone-only proof cleared
two stale copied process-lease projections in its own catalog; it is not
cross-process fencing or recovery qualification. Evidence is in
`query-worker-fix/root-native-proof3/receipt.json`.

The completed post-deployment headless browser pass at 1280×900 used the actual
current UI and workspace. The default fused Chinese query returned a
successful semantic component with 20 hits and filename/artifact segment
provenance; the lexical component honestly reported zero hits for that query.
Searching
`Cairn-Notes.txt` and using the existing original-download action returned 253
bytes with SHA-256
`276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73`, matching
the retained original. Requests stayed on the current loopback origin. The
response/identity record and single screenshot are in ignored
`promotion/worker-reuse-live/web-qa/acceptance.json` and
`semantic-fused-1280.png`.

The focused processor/search tests and broad `cd server && go test -tags
purego ./...` passed for the candidate (exit 0), and the native candidate build
receipt binds the deployed daemon and CLI hashes. These are code and local
runtime checks only. At that checkpoint, the first query after restart took
about 6.8 s and warm queries about 2.8 s. The later build-tag optimization and
live cutover are recorded below and supersede those current-latency figures.
Build/test records are in ignored
`query-worker-fix/checks/focused-receipt.json` and `final-receipt.json`.

## Remaining gates

The subsequent [local-delay acceptance](semantic-latency-profiling-20261015.md#missing-provider-declaration-follow-up)
records the reviewed final binary now serving port 4648, a fresh config-bound
real semantic generation, observed live queries of 0.97 s then 0.50–0.55 s,
unchanged existing durable owner records and four full-byte snapshot checks.
PC-07c is implemented for that bounded local improvement; representative
performance and quality qualification remain open.
Phase 4 remains open for complete required lexical-field coverage,
clean-install/offline package
qualification, model/source and license review, deterministic retrieval
quality, latency and memory limits, and supported-platform evidence. The
local host's `READY` state and a real semantic hit establish operation here,
not those release gates.

The [component profiling](semantic-latency-profiling-20261015.md) now separates
model inference from admission/hash and collection-opening costs. It identifies
the pinned SDK's global `purego` build-tag collision with arm64 SHA acceleration.
The later reviewed source-receipt/profile change and explicit new generation
preserve integrity validation; the profiling finding alone did not authorize
reinterpreting old generations.

The bounded primary-source follow-up checked the pinned
[BAAI model-card declaration](https://huggingface.co/BAAI/bge-small-zh-v1.5/commit/7999e1d3359715c523056ef9478215996d62a620),
[associated MIT text](https://github.com/FlagOpen/FlagEmbedding/blob/c086741f5e117b7b8ce1745ea00b6c262f281a01/LICENSE),
and [Xenova artifact revision](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/75c43b069aac4d136ba6bc1122f995fedcfd2781).
Those records do not establish the exact BAAI weight revision consumed or a
reproducible conversion record for the delivered artifact. Original-weight
verification and delivered-artifact redistribution review remain open; the
installed profile/NOTICE were not rewritten. The ignored investigation record
is `dist/model-provenance-20261015/notes.json`.

The fresh browser capture exposed a listing/search completion race behind
unknown result-card lengths and lost query/order. The subsequent
[search-scope acceptance](search-scope-size-acceptance-20261015.md) records its
implemented UX-C1 repair: both completion orders, current exact-tuple size
enrichment, explicit departure and presentation behavior, and exact original
takeout pass on the current served build. PC-07d is closed for that bounded
client scope; representative retrieval and release qualification remain open.

Phase 5 repository qualification and Phase 7 packaging, migration, upgrade,
backup, performance, and full release qualification also remain open. This
slice makes no completion claim for Phase 3 release qualification, Phase 4,
Phase 5, Phase 6, or Phase 7. See the normative Phase 4 profile and its
qualification requirements in
`docs/requirements/content-store-views-and-exports.md` §9.3 and the order in
`docs/technical/core-mvp-execution-plan.md`.
