# Retrieval and accounting continuation — 2026-10-06

Status: implemented and tested local development fixes. This informative
record grants no phase or release qualification. The primary agent selected
and reviewed the slices; Luna implemented and ran the disjoint checks. Local
Mac trial remains sufficient for these checks.

## Decisions and boundaries

| Slice | Phase / normative requirement | Executable exit |
| --- | --- | --- |
| Lexical hit explanations | Phase 4; content-store §§8–9 and execution-plan §8.2: matched durable text and source provenance | Real daemon searches on Notes, descriptions, and extracted text return only the requested field and source, including Chinese, pinyin, and initials, after reopening the same index |
| Savings evidence | Phase 5; content-store §6 and execution-plan §9: separate measured mechanisms and total overhead | A supplied peak remains a caller claim; independent external paths and invalid arithmetic cannot produce a measured deployment net |

Retrieval explanations must follow the query that actually found the content.
The previous projection ignored requested fields, used substring checks, and
did not recognize the existing pinyin enrichment. A query restricted to Notes
could therefore attribute a description or extracted artifact; a pinyin hit
could omit its source. Fix the projection over existing V4 facts rather than
adding another index, source record, or user-facing text concept.

The fix filters both construct axes and source segments, preserves raw text,
kind, producer, acceptance and IDs, and retains older description records that
carry a document ID without `SourceType`. Token-prefix attribution avoids
Latin interior matches; combining marks and private-use characters do not
create false token boundaries. Request tokenization, indexed feed, lexical
profile digest, generation shape, provider contracts, and signed formats are
unchanged. No index rebuild is required for this query-only repair.

Derived source attribution is conservative: extracted artifacts must exactly
reconstruct the joined indexed field before its existing 256 KiB enrichment
bound can be assigned to individual sources. Description pinyin attribution
requires a complete one-segment document. A middle segment of a longer Han
run must not invent a joined pinyin token. Raw segment matching remains
available. The source tokenizer approximates Unicode61 without accent folding;
some valid accent matches or split-document pinyin hits can therefore lack a
segment explanation. Complete tokenizer/span fidelity remains open; this is
not full Phase 4 provenance qualification.

A hand-entered temporary peak is review material, not a measurement. Keep
`--temporary-peak-bytes` compatible, retain its value under
`reported_temporary_peak_bytes`, and display `CALLER_REPORTED`. The temporary
category stays `UNMEASURED`. Catalog/index/model size scans remain independent
read-only observations; their existence does not bind them to the repository
run. Deployment correlation stays `UNBOUND`, and total net stays `UNMEASURED`
with a reason, even if a caller constructs four measured categories. Checked
arithmetic rejects negative inputs and overflow. Repository-only size-based
net remains separately reported. No sampling, store, service, or repository
selection was added. True peak and correlated deployment net remain unmeasured.

## Executable evidence

Retained root: `dist/retrieval-accounting-20261006/`. Checkout: `main`, HEAD
`5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, with unrelated dirty changes
preserved. Artifact hashes identify the tested dirty build.

| Check | Result and evidence |
| --- | --- |
| Search regressions | PASS; selected fields, pinyin/CJK, legacy descriptions, split Han runs, joined extracted bound, Latin prefixes, combining marks and private-use characters; `search/` contains initial failures and focused/package outputs |
| Real lexical daemon | PASS, all 9 queries; `search-real/REPORT.md` and raw responses. The old daemon failed all 9 provenance assertions. The fixed daemon reused generation `idx_f36bdcd4f7af45e30694525a4347c6a8` without rebuild or metadata/content writes during requery |
| Exact isolated bytes | PASS before/after restart, 121 bytes, SHA-256 `67700a040db4766d491399e995e58cfa617aade84fc607670cb50c9083646a54` |
| Savings runner | PASS tagged tests and actual disposable CLI; `storage/cli-run-finish/`. Claim 123 is retained; temporary/net are `UNMEASURED`, correlation `UNBOUND` |
| Broad Go | PASS, `go test -tags 'purego savingsreport' ./...`, `go-tests-final.log`; preceding uncached run also retained. Provider-gated tests may skip, so these runs do not qualify real semantic providers |
| Persistent preview | PASS, `live/`: HTTP 200, equal annotation/description data before/after, unchanged served JS/CSS hashes, full-byte snapshot verification of 3 files / 4,179 bytes |
| Actual default broker | PASS on updated preview, real `query.semantic.onnx-bge-zvec.v1` plus lexical fusion; `live/default-search-after.json`. The disposable nine-query profile had no semantic bundle and earns lexical evidence only |
| Exact candidate smoke | PASS, offline real semantic/lexical queries and independent-anchor catalog-free restore; `package-smoke/result.json`. Restored 89 bytes, SHA-256 `5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a` |

The first disposable setup used an overlong Unix socket and failed before
catalog/repository writes. Its unused partial directory remains retained; the
baseline and fixed run used a short owned socket and separate profile. Initial
search patches needed review refinements for legacy records and token
boundaries; only the final binary below is current acceptance.

## Current local build

- Daemon: `dist/retrieval-accounting-20261006/cairnd`, SHA-256
  `4196d63d2230b8151fc307fd9847f024de54dbf6148cae39a4d2e60200cedf46`.
- CLI unchanged: `dist/all-completion-20261006/integration/rw`, SHA-256
  `2a25a1cf5a2e4508fc8ef3e587b3d9b3b073e33196f6b78231f81ef71ba2a2e8`.
- Candidate: `dist/retrieval-accounting-20261006/cairn-20261006-retrieval-accounting-darwin-arm64.tar.gz`,
  SHA-256 `e150d7f8b391d23ccbe7bee1a8f469b7b27bbdd219a52fcf284f227ef1d4570c`.
- Existing preview remains `http://127.0.0.1:4648/`, with the same persisted
  profile and browser assets. Runtime metadata is in `live/runtime.json`;
  `dist/client-appearance-20261006/start-preview.sh` selects the new binary.

These fixes create no new product surface. Supported packaging/default
semantic qualification, complete provenance, representative corpus and true
deployment measurements, production repository selection, LinkGroup gates,
and release qualification remain open under the
[execution plan](core-mvp-execution-plan.md). Albums, players and third-party
runtime loading are outside the current queue. Previous browser results remain
historical acceptance for their recorded binary; a full new browser suite was
not rerun because this slice changed neither client code nor assets.
