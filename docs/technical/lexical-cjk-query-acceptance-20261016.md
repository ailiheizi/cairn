# Continuous CJK lexical query acceptance — 2026-10-16

Status: implemented and tested for the bounded Phase 4 development slice,
including the local owner-preview deployment. This closes PC-07i only; full
Phase 4/5, Phase 6 admission and release qualification remain open.

## Requirement and implementation

The [compiled lexical CJK query contract](../requirements/driver-and-processor-interfaces.md#compiled-lexical-cjk-query-refinement)
and [ADR-047](build-stack-and-architecture-selection.md#adr-047-prove-continuous-cjk-phrases-after-bounded-lexical-candidate-expansion)
address a demonstrated miss: `萤火浮标` was not found inside an indexed longer
Han run, although a query for that complete run worked.

The query retains original tokens and the original prefix branch. Pure Han
tokens of at least three characters gain a candidate branch using at most
sixteen distinct adjacent bigrams in the five eligible enriched axes. A
candidate must prove each expanded token against continuous original field
text or its genuine unicode61 prefix before consuming a result slot or proving
`has_more`. Typed filters and the rank/rowid order remain in force. The
continuation query digest binds `cairn.lexical-query.cjk-contiguous.v1`.

Source explanations retain UTF-8 byte spans. A verified complete description
body can explain a phrase crossing adjacent segments through local overlapping
spans. Invalid or missing mapping omits unprovable explanations while readable
raw-field hits remain available. New extracted-text interior proof is limited
to the existing 256 KiB appendix coverage; unknown artifact offsets and phrases
crossing or beyond that limit do not acquire fabricated interior spans. Actual
raw-prefix matching beyond the appendix limit remains available.

This changes query/projection code in `engine.go`, `page.go` and `cjk_query.go`.
It changes no feed/profile, tokenizer, generation format, endpoint, durable
schema, processor, source authority or recovery record. The reviewed baseline
and source hashes are retained under `dist/cjk-query-20261016/`.

## Executable evidence

Luna supplied implementation and independent tests; root reviewed both diffs,
corrected source-boundary issues and independently checked the retained
receipts. Corrected tests cover continuous interior positives, disjoint and
reordered negatives, mixed axes, legacy raw-field fallback, source spans,
extracted-prefix limits and old-policy continuation refusal. A candidate-order
probe uses the actual generated MATCH expression and verifies at least 1,000
false candidates before the first true row. Three true subjects then appear
exactly once across size-one pages, with correct final exhaustion.

All commands below passed with `GOPROXY=off`:

- `go test -tags=cairn_zvec_dynamic ./server/internal/search -run 'TestCompiledCJK|TestCJKContiguous' -count=1`
- `go test -tags=cairn_zvec_dynamic ./server/internal/search`
- `go test -tags=cairn_zvec_dynamic ./...`
- `git diff --check`

The final broad log SHA-256 is
`47b834ff6e24aed691332baae4c311ef9cdc5fc29458108db0900455cac46afe`.
Commands, exit codes, raw output and hashes are in
`dist/cjk-query-20261016/implementation/final-receipt.json`; the independent
acceptance evidence is in its sibling `independent-tests/` directory.

## Ordinary browser and exact-original proof

The reviewed candidate daemon SHA-256 is
`78bd36350827ada28f93f703130773c1443e8e10005ee12b2629100d5c0ce721`
(26,111,858 bytes). One private persisted profile on port 4652 ingests a real
18,091-byte text source and a scattered-bigram negative through ordinary
plan/apply. It deliberately has no semantic assets installed.

An ordinary Web search submits `萤火浮标` through the default fused broker.
The envelope honestly reports `DEGRADED`: lexical succeeds against generation
`idx_d8e8d53c910b29280528a55ae02f27ec`, semantic is `UNAVAILABLE`, and only the
positive source appears. Its actual EXTRACT span is `[18075,18087)`, exactly
the requested UTF-8 phrase in the original bytes. The original-download route
returns all 18,091 bytes with SHA-256
`1e1babb96ec545dacbee959d597c5c85acc9fbdc6def2d4f3566a34ed9d1d27a`,
equal to the saved content identity and input file. This validates the HTTP
download route; the browser Download button was not clicked.

Root verified all nine captured command response bodies and both served JS/CSS
assets against their raw hashes. Browser page, console and request errors are
zero. The initial runner records `INCOMPLETE` because its immediate plain TCP
bind probe returned address-in-use after successful daemon exit. That receipt
is preserved. Root subsequently observed no listener or owned PID, refused
HTTP connection, successful fresh bind, and absent owned socket/tmp. A
separate root acceptance records the resolved cleanup; no product test was
rerun or assertion relaxed. A TCP wait-state explanation remains an inference.

Evidence:
`dist/cjk-query-20261016/private-client/attempts/20261015T172256Z-82794-33029312-b24f-4c2a-b2e3-43d19509762d/`,
including the original `execution.json`, `browser.json`, screenshots,
`root-cleanup-observation.json` and `root-acceptance.json`.

## Owner-preview deployment

The same tested daemon is now served at `http://127.0.0.1:4648/`, PID 87260,
with native ONNX worker 87271. The guarded replacement first retained exact
config, old binaries, catalog/sidecars, repository, independent trust anchor,
recovery, vectors and models. It then replaced only the daemon and relaunched
the same persisted configuration and paths. No index rebuild ran.

The existing generations remain unchanged:

| Dimension | Generation |
| --- | --- |
| Lexical | `idx_5b7869d45de6354d908dc6b313783bc0` |
| Semantic | `idx_2113a229cb980cf4d655c5d46772f55b` |

The existing maintenance graph generation is also unchanged; it receives no
new product/default capability claim. An ordinary default query for `星空`
succeeds before and after restart using those same lexical and real native
semantic generations, with the same twenty subject/content identities. A
253-byte original is read and verified before and after against
`sha256:276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73`.

Root independently checked 23 raw HTTP response bodies, all 37 catalog table
fingerprints and the retained trees. Thirty-six tables are unchanged; only
`publication_fences` changes, with the semantic worker advancing 5 to 6 and
the publication writer fence remaining 12. Repository (58 files), recovery
(2), vectors (132), models (12), config and CLI bytes remain identical. The
same index records are retained. Owner evidence proves compatibility with the
existing twenty-file corpus; the private fixture proves the new CJK case.

The guarded apply and backup are retained in
`dist/cjk-query-20261016/owner-rollout/runs/20261015T173024Z-87221/` and
`backups/20261015T173028Z/`. Root's combined evidence review is
`dist/cjk-query-20261016/root-final-acceptance.json`.

## Remaining limits

This is bounded development evidence, not representative recall, performance
or release qualification. The existing appendix vocabulary and extracted
prefix limit still apply. Missing model assets remain explicitly unavailable;
this slice installs no models. AI voice capture, AI-client orchestration and
remote personal-file access remain separately recorded future directions
under ADR-044/PC-21.
