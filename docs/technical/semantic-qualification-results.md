# Local Semantic Qualification Results

This document records bounded, reproducible evidence for the pinned local
`BAAI/bge-small-zh-v1.5` profile. It is not a claim that every release platform
or representative user corpus is qualified.

## 2026-09-03 Darwin arm64 run

The run used the independently installed and fully admitted semantic bundle.
It did not call the development downloader. The supervised worker loaded the
pinned ONNX Runtime, model, tokenizer, and profile; the test then embedded an
eight-case Chinese/English retrieval corpus, ran four query rounds at
concurrency four, and ranked every document vector for each query.

| Field | Result |
| --- | --- |
| Status | `PASSED` |
| Host | `darwin/arm64` |
| Go | `go1.26.5` |
| Profile | `bge-small-zh-v1.5` |
| Profile digest | `sha256:2c660a7dd5d062a75f495f3d5e9d41d2906a0391d3146fa063e41de5434d7892` |
| Semantic space | `bge-small-zh-v1.5-cosine`, float32, 512 dimensions |
| Admitted bundle bytes | `180,470,982` |
| Worker startup | `4,891.695 ms` |
| Eight-document embedding batch | `30.984 ms` |
| Query requests | `32` (`4` rounds x `8` cases), concurrency `4` |
| Concurrent query latency p50 | `23.214 ms` |
| Concurrent query latency p95 | `31.066 ms` |
| Recall at 1 | `1.000` (32/32) |
| Recall at 5 | `1.000` (32/32) |
| Peak sampled worker-descendant RSS | `384,090,112 bytes` |
| RSS sampling scope | Sum of test-process descendant RSS every `10 ms` during concurrent queries |

The executable evidence is
`TestSupervisedONNXSemanticQualification`. An explicit output path writes an
atomic `restoreweave.semantic-qualification.v1` JSON report:

```sh
RESTOREWEAVE_RUN_SUPERVISED_ONNX=1 \
RESTOREWEAVE_SEMANTIC_BUNDLE_ROOT=/absolute/path/to/bge-small-zh-v1.5/darwin-arm64 \
RESTOREWEAVE_SEMANTIC_QUALIFICATION_REPORT=/absolute/path/to/report.json \
go test -tags='purego supervised_integration' ./server/internal/processor \
  -run '^TestSupervisedONNXSemanticQualification$' -count=1 -v
```

The separate `TestRealDaemonSemanticEndToEnd` run also passed on the same
host and bundle. It copied the bundle into a clean configured models root,
removed the temporary offline source copy, started real daemon and CLI
processes, built and queried a zvec generation, preserved segment provenance,
reopened the same generation after restart, reported explicit degradation
after generation deletion, and rebuilt a new healthy generation.

## 2026-09-18 Darwin arm64 development install and live retrieval check

This is a development-host install and a live retrieval check, **not** a
qualification run: it measures no recall corpus, no latency, and no memory. The
dated qualification entry above remains the qualification evidence.

The pinned development installer (`rw semantic bundle install`) admitted the
bundle into `<data>/restoreweave/models/bge-small-zh-v1.5/darwin-arm64` with
profile digest `sha256:2c660a7dd5d062a75f495f3d5e9d41d2906a0391d3146fa063e41de5434d7892`
— byte-identical to the profile digest recorded by the 2026-09-03 run.

**Network note.** From this network `github.com` (the ONNX Runtime and zvec
release assets) resolves directly, while `huggingface.co` (the model and
tokenizer) and `raw.githubusercontent.com` (the binding header) do not. The
pinned installer worked when the daemon was started with
`HTTPS_PROXY=http://127.0.0.1:7890`; after the install the daemon runs without
the proxy. `hf-mirror.com` also resolves and serves the same model bytes.

**Live retrieval evidence** after `search.rebuild` (lexical generation
`idx_dc569d5d…`, semantic generation `idx_cea8a057…`, 8 seconds):

| Query | Lexical hits | Semantic hits | Top fused result |
| --- | --- | --- | --- |
| `度假` (holiday — absent from every document) | 0 | 7 | `demo-中文-意图.txt`, whose text is "家庭照片与旅行记录" |
| `holiday` (absent) | 0 | 7 | the same document |
| `家庭` (present) | 1 | 7 | the same document |

After a daemon restart the same query returns the same result: the semantic
generation is reopened rather than rebuilt, and `capability.list` reports
`semantic-embedding` as `AVAILABLE` (host-owned local ONNX/BGE embedding plus an
in-process zvec generation). `multimodal-clip` stays `NOT_BUILT` with its
reason, which is the honest state until an image model artifact is installed.

The rebuild reports `DEGRADED` with "lexical field coverage is incomplete after
rebuild" and `lexical_coverage.complete=false` (`descriptions: false`) on this
development corpus, which is the coverage metric working as designed rather
than a search failure.

## 2026-09-18 Darwin arm64 installed-state and browse-path honesty check

A live check on the same development host, again **not** a qualification run.
It fixes and records three reported-state defects around the installed
bindings.

**Installed is not the same fact as unbuilt.** `capability.list` reported the
semantic dimension as `UNAVAILABLE` with "real embedding model and vector
IndexProvider are not wired" while the BGE provider and zvec binding were
installed and a `search.rebuild` produced a served generation. The dimension
now reports `NOT_BUILT` with `SEMANTIC_INDEX_NOT_BUILT` for an installed
binding that serves no generation, and keeps `SEMANTIC_INDEX_UNAVAILABLE` for
the unbound or unusable case. `IndexerReadiness` gained `SemanticInstalled`,
`SemanticState`, and `SemanticReason` beside the image dimension's existing
installed/state/reason fields, and a hybrid online binding is described as
online in both the served and the not-yet-served case. An image generation
that failed is reported `UNAVAILABLE` with the failure named in the notes; it
is no longer collapsed into `NOT_BUILT`.

**A built image generation survives a restart.** The daemon reopened only the
semantic generation at startup, so after a restart the image dimension was
reported `NOT_BUILT` ("no image generation is built for this workspace") and
dropped out of fused queries although the generation and its receipt were
intact. `WarmImageGeneration` now runs beside the semantic warm-up, and the
live daemon reports `multimodal-clip` as `AVAILABLE` after a restart without a
rebuild.

**A filter-only browse is not a failure.** An empty query text with structured
filters reached the vector dimensions, failed provider input validation, and
revoked the verified generation through the query's failure path: one browse
request left `capability.list` reporting the image dimension `NOT_BUILT` until
the next rebuild. `Fuse` now reports a text-embedding dimension as `SKIPPED`
with `QUERY_TEXT_REQUIRED` for a text-less request, and both query paths reject
an empty text with `ErrInvalidQuery` without revoking a generation.

Live transcript on the development corpus (11 files, semantic generation 15
segments, image generation 4 subjects):

| Request | lexical | semantic | image |
| --- | --- | --- | --- |
| `search.query` with `media_class=image`, no text | `SUCCEEDED`, 4 hits | `SKIPPED` / `QUERY_TEXT_REQUIRED` | `SKIPPED` / `QUERY_TEXT_REQUIRED` |
| `search.query` "蓝色的海" | `SUCCEEDED`, 0 hits | `SUCCEEDED`, 15 hits | `SUCCEEDED`, 4 hits |

`capability.list` reported `semantic-embedding` and `multimodal-clip` as
`AVAILABLE` before and after the browse request. The regression tests are
`TestIndexerReadinessRequiresZvecEvidence`,
`TestInstalledSemanticBindingWithoutRunnableBackendIsUnavailable`,
`TestDeclaredDimensionsReportInstalledOnlineSemanticBinding`,
`TestImageGenerationWarmUpRestoresReadinessAfterRestart`,
`TestFilterOnlyQuerySkipsVectorSpacesWithoutRevoking`, and
`TestImageFailureIsReportedUnavailableNotNotBuilt`.

## 2026-09-18 Egress grant admission and enforcement evidence

This is a development-host evidence record, **not** release qualification of
any online provider. The online embedding profile is now schema v2 and carries
the egress scope the requirements name: destination host, disclosed data
classes (closed vocabulary `text.segment` / `text.query`), allowed subject
classes, minimization statement, per-run request/byte/time budgets, expiry,
revocation reference, and residency/logging/retention/training/output-use
references. A v1 profile is refused by name because it cannot authorize any
disclosure.

Authorization is a durable append-only grant (migration 25: `egress_grants` +
`egress_grant_revocations`, no-UPDATE/no-DELETE triggers); a grant is live only
while unexpired and unrevoked. The provider-neutral gate
(`server/internal/search/egress_gate.go`) refuses before any network call with
stable reasons (`EGRESS_GRANT_MISSING`, `EGRESS_GRANT_EXPIRED`,
`EGRESS_GRANT_REVOKED`, `EGRESS_PROFILE_EXPIRED`, `EGRESS_PROFILE_REVOKED`,
`EGRESS_BUDGET_EXCEEDED`, `EGRESS_DATA_CLASS_DENIED`,
`EGRESS_SUBJECT_CLASS_DENIED`), enforces the run budgets, and requires a
per-request confirmation bound to the live grant unless the operator set
`semantic.send_content_without_confirmation`. Every attempt records one
append-only receipt with the destination host, redacted credential reference,
disclosed data classes, budget consumption, input and output digests,
truncation flag, output schema reference, and grant id; receipts never carry
payload text or secrets.

The profile operations (`semantic.provider.install|list`) follow the local
bundle installer precedent — absolute local path, strict decode, declared
digest check, atomic publish, move-aside for a changed profile, restart
required, and marked implemented only when the daemon is configured with the
installer. Regression coverage lives in
`server/internal/search/egress_scope_test.go`, `egress_gate_test.go`,
`semantic_provider_installer_test.go`,
`server/internal/store/sqlite/egress_grants_test.go`,
`server/controlplane/egress_grant_ops_test.go`, and
`client/cmd/rw/egress_test.go`. Loopback HTTP stubs prove the gate order; a
real remote endpoint was not exercised and no online provider ships as a
default.

## 2026-09-18 Darwin arm64 image dimension bring-up

The image dimension (`multimodal-clip`) went from `NOT_BUILT` to `READY` on this
development host. This records what was assembled, what broke, and what the live
retrieval looked like; it is a development bring-up, not a qualification run.

**Artifact.** Chinese-CLIP ViT-B/16 from the community ONNX conversion
(`Xenova/chinese-clip-vit-base-patch16` @ `f26904860903`; upstream
`OFA-Sys/chinese-clip-vit-base-patch16`, MIT). The published export is one
combined graph, so it was split offline into the two towers this bundle admits:
`vision.onnx` (87.5 MB, `pixel_values` → `image_embeds`) and `text.onnx`
(103.4 MB, `input_ids` + `attention_mask` → `text_embeds`), both 512-d and
L2-normalized. The split used onnx 1.22.0 in an isolated environment and was
verified with onnxruntime 1.30.0 before pinning; the admitted runtime is the
same ORT 1.29.0 build the text bundle already ships (C API 29). The tokenizer is
WordPiece with a BERT normalizer (vocab 21128), and its declared
`do_lower_case=true` is recorded in `tokenizer_version` as `+lowercase`.

**What the bring-up fixed.** Three assumptions in the image code were too
strict for a real artifact and one was a real bug: the text tower contract
required three inputs (the admitted export declares two, and the attention mask
is the correctness-critical one); the vision input validator refused symbolic
axes (a dynamic export is fine because this host always feeds
3 × 224 × 224); the tokenizer loader refused a case-folding tokenizer; and the
crop loop in `PreprocessImageTensor` addressed pixels four times too far, which
panicked for any image larger than a few pixels and was not covered by a test
until now.

**Live retrieval** (image generation built over the development corpus, which
contains one colorful gradient image and one 1×1 black pixel):

| Query | Lexical hits | Image hits | Top fused result |
| --- | --- | --- | --- |
| `彩色渐变` (colorful gradient) | 0 | 2 | `demo-photo.png` |
| `彩虹` (rainbow) | 0 | 2 | `demo-photo.png` |
| `彩色照片` (colorful photo) | 0 | 2 | `demo-swatch.png` (the 1×1 pixel ranked first) |
| `photo.png` | 1 | 2 | `demo-photo.png` |

Honest reading of that table: the dimension retrieves and ranks correctly for
queries that describe the image, and it can also rank a degenerate 1×1 pixel
above a rich image for an ambiguous query. The 1×1 fixture is a poor evaluation
item; recall on a representative photo corpus remains unmeasured, and the
release SBOM and redistribution review for this artifact remain open work.

### Reproducible assembly and install

The image bundle is rebuilt by `scripts/assemble-image-bundle.sh` rather than
copied between hosts. The script installs a private ONNX toolchain (no PyTorch),
downloads the pinned export, splits it into the two admitted towers, copies the
already-admitted ONNX Runtime, writes the descriptor, notice, and SBOM with
digests computed from the bytes it produced, and can package a transport
archive. It refuses to finish without the upstream MIT licence text: an earlier
version silently fell back to a README fetch and wrote a 14-byte "404: Not
Found" into the licence asset, which is exactly the kind of dishonest artifact
this bundle must never contain.

Reproducibility evidence: a script-built bundle and the hand-assembled one agree
byte-for-byte on every factual asset — `runtime.bin` (43,184,400 bytes),
`vision.onnx` (87,539,291), `text.onnx` (103,420,097), `tokenizer.json`
(439,124), and the 1,264-byte licence — and on every declared space fact
(profile, model version, dimension, image size, token budget, vector schema,
index and query config, distance, preprocessing digest, tokenizer version).
Only the notice and SBOM text differ, which changes the provider digest: the
digest covers the whole descriptor, so a bundle with different documentation is
a different provider identity, and the image generation is rebuilt for it.

Installing the script-built archive through the daemon
(`rw image bundle install --archive …`) reports the admitted profile, destination
and asset count, marks a restart as required, then rebuilds to
`image_state: READY`, with the same Chinese image queries still returning the
described image first.

## Final candidate package and clean UI rerun

The final candidate-only artifact was assembled with archive digest
`sha256:96746b0a4080f4396a86de10942d380176fce47521e69a435e028ec59a75f064`.
Its manifest records main path
`github.com/ailiheizi/restoreweave/server/cmd/restoreweaved`, `darwin/arm64`,
the exact `purego` build tag, and pinned
`github.com/zvec-ai/zvec-go` version
`v0.6.1-0.20260721023313-9199195b29da` with module sum
`h1:4wINeawyVOYz/Rj4mDJQlSAUYLkQ76QELU1dd2IEU3k=`. Input digests were
recorded for the CLI
(`c6a4d301cc75184ff0a8dba32e6cda9e3501c0d7426bbd85e324304489ddee8a`),
purego daemon
(`4993b215957ac8de59d3e8fc0c2b8849da970b7c2e70972382a942ffaf694813`),
and semantic archive
(`56fd01397f4d1bcb067583fd13589c4d06b4c1fe82d1dc179af6d427ce3670df`);
package checksums and license/SBOM paths passed verification. This remains
`CANDIDATE_ONLY_NOT_SUPPORTED`, not a release package.

Using the candidate binaries and a fresh temporary data root, offline archive
installation admitted profile digest
`sha256:2c660a7dd5d062a75f495f3d5e9d41d2906a0391d3146fa063e41de5434d7892`,
performed a graceful restart, ingested five documents, and served
`如何恢复文件` without a `workspace_id`. Lexical returned zero hits while the
real provider `query.semantic.onnx-bge-zvec.v1` returned five top-level hits
from generation `idx_0a7eebd35a42b41896cec33644c26c10`, using cosine similarity;
each result retained semantic dimension and ARTIFACT/FILENAME provenance.
An interactive browser audit against that same temporary daemon showed five
items, per-item semantic `READY`, five result/source snippets, and “BGE
installed and running”. This browser observation is candidate-run evidence,
not an automated release gate. The supervised real-BGE test also passed in
`148.65 s`. This is bounded Darwin candidate evidence and does not qualify
Linux/NAS release support.

The native Linux harness now accepts an operator-supplied archive for the same
boundary:

```sh
bash scripts/linux-qualification.sh --artifacts /path/to/evidence \
  --semantic-archive /path/to/restoreweave-semantic-bundle.tar.gz --offline
```

In this mode the script copies the archive into a clean temporary root, calls
only `rw semantic bundle install --archive`, records the archive digest, and
removes the temporary archive before the daemon restart. The original archive
is never modified. This proves the script-level offline input and retained
installed bundle path; it is still a candidate harness, not proof of a
network-isolated host or a release package.

## Candidate offline artifact assembly

`scripts/package-offline.sh` combines already-built daemon, CLI, and WebUI
assets with an operator-retained semantic bundle archive. It produces one
versioned `.tar.gz` with a candidate manifest, per-file SHA-256 checksums, the
project MIT license, and separated semantic-bundle license, NOTICE, and SBOM
evidence:

```sh
bash scripts/package-offline.sh \
  --version v0.1.0-prealpha.1 --os linux --arch arm64 \
  --rw /absolute/path/to/rw \
  --daemon /absolute/path/to/restoreweaved \
  --web-dist /absolute/path/to/web/dist \
  --semantic-archive /absolute/path/to/semantic-bundle.tar.gz \
  --output /absolute/path/to/restoreweave-v0.1.0-prealpha.1-linux-arm64.tar.gz
```

The fixture acceptance test builds the artifact twice, requires byte-identical
output on the same host, extracts it, and verifies every listed checksum and
license/SBOM path. The manifest status is
`CANDIDATE_ONLY_NOT_SUPPORTED`; the root SBOM is explicitly
`INCOMPLETE_NOT_RELEASE_SBOM`. This proves artifact assembly, not native
library execution, redistribution clearance, install/upgrade behavior, or a
supported platform package.

## Limits and remaining admission work

- The eight cases are a deterministic regression corpus, not representative
  recall evidence for a large heterogeneous personal archive.
- RSS is a 10 ms sampled peak during the concurrent query window, not an
  operating-system-enforced limit or a guarantee that a shorter transient
  peak did not occur.
- The offline source-isolation test proves there is no installer or
  first-query download in the exercised path. It is not a packet-capture or
  host firewall attestation.
- Linux/NAS supported-install runs, broader recall, longer sustained-load,
  representative heterogeneous-corpus evidence, native package
  upgrade/rollback, full SBOM and redistribution review, and supported-host
  deletion/rebuild qualification remain required before the profile is a
  release-qualified default.
