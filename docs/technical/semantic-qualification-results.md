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
