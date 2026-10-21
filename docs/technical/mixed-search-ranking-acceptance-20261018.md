# Mixed Search Ranking — 2026-10-18

Status: implemented and locally accepted for the bounded development slice.
This is not retrieval-quality qualification or Phase 4/release completion.

## Change and boundary

The former broker placed every lexical hit before semantic-only hits. The
[ADR-054 successor](build-stack-and-architecture-selection.md#adr-054-rank-mixed-search-without-concatenating-entire-components)
uses rank-only reciprocal rank fusion over the same bounded union. Its existing
provider/score labels are `query.broker.fuse.v2` and
`reciprocal-rank-fusion-k60-v1`. Each canonical subject casts one vote per
successful lane; current authorization runs once, stale candidates are removed
before compacting ranks, and supported legacy handles retain their canonical
subject mapping. The result keeps the original component generations, source
evidence, read authority and bounded continuation behavior.

Active phase: Phase 4. Requirement: content-store default fused discovery and
the QueryProvider host-ranking successor. Executable exit: a semantic-only
rank-one candidate is no longer behind 200 lexical candidates, while current
authorization, aliases, source evidence and single-lane order remain intact.
There is no new schema, endpoint, processor, index dimension, model, durable
ranking state or automatic rebuild.

## Code and concentrated checks

Root reviewed the slice against retained pre-edit snapshots, including the
authorization/alias corrections; independent read-only review accepted it.
The focused Go ranking/authorization/provenance cases pass. The broad
`go test -tags cairn_zvec_dynamic ./...`, tagged daemon build and
`git diff --check` all exit 0. Exact commands, outputs, timings and six source
hashes are in
[`candidate-validation.json`](../../dist/product-search-ranking-20261018/checks/candidate-validation.json).

Candidate daemon SHA-256:
`3bb822db3990b7ca3ac520798cf06d6f2ddd19d8051bb65553297c23967b1353`.
The baseline daemon is the preceding owner binary,
`8a6f6e24fba020fa56b1e52de48031cc50b8651d42c252d0cb66a4338c94f5c5`.
Both are Darwin arm64, built with `cairn_zvec_dynamic`; HEAD is
`d1750d916f198293bae84fb43ae9d6127e7ee86e` with retained worktree changes.

## Same-corpus observation

The private retained corpus has 104 exact files (2,486,895 bytes), three live
annotations and existing descriptions. The unchanged twelve default fused
queries and four existing controls run once on each binary. No new ingest,
metadata edit, label tuning, candidate-limit change or model install occurs.

Initial baseline startup truthfully refused stale semantic source identities.
One explicit rebuild in that private profile supplies lexical generation
`idx_36e9729feacee8c78a69e17d5e527ac1` and semantic generation
`idx_1fc10522fbbfa811bd037cd47113d73d`. Its operation-level `DEGRADED` outcome
records the corpus's absent `duplicates`, `duplicate_group` and `locators`
fields; these are not complete-baseline coverage. Selected lexical text
coverage is 215/215. Semantic coverage is 215 expected, 213 indexed, two
excluded, zero missing/unavailable, with 7,496 FULL inputs. Both subsequent
startups report lexical and semantic `READY` on those same generations.
Namespace identities, annotation facts and description summaries match the
pre-rebuild reads. Earlier stale/rebuild receipts are retained separately.

All sixteen calls on each binary exit 0 with `SUCCEEDED`. Offline comparison
of the raw hits confirms identical bounded membership, identity projections,
dimensions, construct axes and complete segment objects. All four controls
retain their full order. The candidate daemon stops with exit 0 and releases
its socket. See the
[full raw-hit audit](../../dist/product-search-ranking-20261018/candidate/current-generation/full-hit-fidelity-comparison.json)
and the [candidate receipt](../../dist/product-search-ranking-20261018/candidate/current-generation/candidate-receipt.json).

Only Q09 and Q10 change order: Q09 swaps positions three and four. Q10 has
three top-ten entrants and three exits; these are rank movements, not new
relevance judgments:

| Q10 path | Before | After |
| --- | ---: | ---: |
| `docs/requirements/security-and-threat-model.md` | 14 | 4 |
| `docs/requirements/restore-manifest.md` | 16 | 6 |
| `docs/requirements/external-ai-and-semantic-extensions.md` | 20 | 9 |
| `docs/requirements/release-qualification-and-traceability.md` | 6 | 16 |
| `docs/technical/remaining-work-and-closed-decisions.md` | 8 | 30 |
| `docs/requirements/external-source-and-retrieval.md` | 9 | 15 |

Q10's labeled content-store target moves 3→2 and its operator-contract target
11→13. The frozen expected top-ten miss set is unchanged across all twelve
queries. In particular, this policy does not repair a relevant source absent
from a bounded lane or change pure-semantic order. No general recall or
ranking-quality improvement is claimed.

The first helper comparison flags identity/provenance differences because its
baseline and candidate summaries serialized different subsets of fields.
That artifact remains intact; the raw-hit audit above compares complete
segment objects and actual identity fields without another query run.

## Remaining work

The 104-file corpus is not a representative user retrieval benchmark. Existing
semantic misses, absent field coverage, supported clean-host packaging and
default-profile qualification remain open. No index-deletion, recovery,
storage-engine or release matrix is rerun or awarded by this ranking slice.
Owner-preview deployment below is separate from the private corpus comparison.

## Existing local preview deployment

The same native candidate is installed with the preceding binary retained as
a backup. The existing owner service was absent before deployment; startup
uses its persisted config, repository/catalog, socket and `web/dist`, on
`127.0.0.1:4648`. Managed session 42063 / PID 14580 passes health and status.
All twenty owner file-identity projections match the prior retained read.
Lexical and semantic indexes report `READY`; the one actual default fused
query uses `idx_5b7869d45de6354d908dc6b313783bc0` and
`idx_2113a229cb980cf4d655c5d46772f55b`. `Cairn Notes` returns
`Cairn-Notes.txt` first, and its original download matches all 253 bytes and
SHA-256 `276a9d97a06002ca2f577535e921ce7b7bf02a360debb9f1e1d892859d27ff73`.
Config and CLI hashes remain unchanged, with no owner rebuild, ingest or
metadata edit. All 58 retained Web files are unchanged; the index and its five
references match the served bytes. See the
[separate deployment receipt](../../dist/product-search-ranking-20261018/promotion/owner-preview-receipt.json).

The stale socket cleanup records absent daemon/TCP listener, no `lsof` path
binding and HTTP refusal before unlinking; it did not capture a direct Unix
socket `ECONNREFUSED` probe. No active daemon was stopped. This deployment is
a bounded existing-data check, not an owner-catalog recovery or media/UI matrix.
