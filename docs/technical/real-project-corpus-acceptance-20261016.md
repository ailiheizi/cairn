# Real Project Corpus: Index Repair and Recovery Evidence

Status: **implemented and tested for bounded native batch-write, semantic
freshness/latency, ordinary metadata publication hooks, and recovery-reference
size/compact-selector slices, plus a bounded ordinary-metadata recovery drill
on the 104-file corpus**. That drill covers seven captured facts under one
retained authenticated parent; it does not establish broad or multi-parent
corpus recovery. Retrieval quality, full lost-catalog/history recovery, and
Phase 4/5/6/7 and release gates remain open. This project-document trial does
not qualify NAS or household recall.

## Scope and fixed inputs

The slice advances Phase 4 search-feed execution and the existing Phase 3
catalog-free recovery contract. Its exits are a real local BGE/zvec generation,
unchanged predeclared queries with honest rankings, and independently
authenticated exact-byte verification/restoration. No schema, command,
endpoint, processor, index dimension or signed format is added.

All 104 then-current Markdown files under `docs/requirements/` and
`docs/technical/` are copied: **2,486,895 logical bytes**. Each is bound by path,
full SHA-256 and length. Twelve queries and expected source passages were frozen
before execution. Two Chinese-to-English cases are explicitly exploratory.
One imported verbatim description, one operator-quoted Note and one trial TAG
are declared interventions, not naturally occurring owner metadata.

Evidence root: `dist/phase4-real-project-corpus-20261016/trial/`.

- Corpus manifest digest: `b0782531fb7921d46d5dddbff44210dd112326100833bb8c2d812fb345bf2570`.
- Query-file SHA-256: `c2f86e3df1afc7ce603e4c82b64512193a0adcff70fb322ea4cdaef18c433ce7`.
- Checkout: `main`, HEAD `d1750d916f198293bae84fb43ae9d6127e7ee86e`, retained dirty state.
- Config digest: `sha256:700f71e0c023bba4dbb8217460839507af68fa55c18c089f50b031dcf8f97ea3`.

## Reproduced failure and repair

The first actual run saved and verified all originals, but sent **7,496
documents** in one native zvec write, exceeding its **1,024-document limit**.
Semantic search correctly reported unavailable; lexical search remained usable.

`zvec_generation_purego.go` now inserts batches of at most 1,024 and requires
each batch's full success count and zero errors before flush, close and receipt
publication. Native documents are freed on success/failure. Existing publication
and exact-content contracts are unchanged.

An opt-in 2,053-document native regression fails before repair and passes
afterward. It checks receipt/coverage counts, reopens the generation and queries
the unique segment in the last batch. Its vectors are test data; real-model
evidence comes from the corpus run below. Focused native search tests, broad
`GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` and `git diff --check` pass.
Logs and root incremental-preservation review are under `batch-fix/`.
Pre-existing build-tag changes were preserved.

## Actual BGE/zvec result and retrieval limits

Candidate daemon SHA-256:
`dad44613d234512b667ae16617207ade87f95d7a2f3965a0f9e4c6d3b384787e`.
Its manifest records source hashes, Go 1.26.5, Darwin arm64 and
`cairn_zvec_dynamic`. It reuses the protected isolated profile and existing
model assets without re-ingest, metadata mutation or model installation.

One explicit rebuild takes **85.071 seconds**, publishing generation
`idx_a1b9b334e77a99e2ba6c5513a3febeaf`. Declared semantic source coverage is
complete: **214 expected, 213 indexed, one TAG excluded, zero missing or
unavailable**; all **7,496 inputs are FULL**, none truncated or unknown.
Lexical selected-source coverage is 214/214. Field-level `duplicates`,
`duplicate_group` and `locators` remain absent in this corpus.

The twelve cases each run in default-fused and declared-dimension modes, plus
four controls: **28 results**. All 31 command receipts succeed, while relevance
remains incomplete:

| Declared semantic case | First expected rank | Expected sources in top 10 |
| --- | ---: | ---: |
| Q03: catalog-free recovery | 22 | 0/3 |
| Q04: unknown-type fallback | 6 | 2/3 |
| Q05: passage/revision | 3 | 1/3 |
| Q06: link-only protection | 1 | 1/3 |
| Q07: sparse/xattr facts | 4 | 1/2 |

The controlled Note ranks first with body/source joined to its actual write;
the imported-description target ranks 12th. Exploratory cross-language targets
rank 13th and 48th. Exact filename/body and Note/TAG lexical controls rank first.
Q08's structured fused query finds both targets in the top ten, while its
lexical-only query finds neither; Q09 finds both, Q10 one of two. All misses
remain. Fetching nearly the whole corpus is not useful top-ten recall.

Outcome remains `COMPLETED_WITH_QUERY_MISSES_OR_UNAVAILABLE` because of these
misses. Provider availability is proven; useful recall is not qualified.
Read-only inspection also finds directly relevant recovery passages in Q03's
first four returned documents, outside its frozen expected set. That suggests
the document-level labels may be narrow; they remain unchanged. The imported
description is indexed, but is absent from the target's returned matched
segments. Numeric segment scores were not retained, so neither model weakness
nor the fixed 100-segment candidate pool is established as the cause. See
`native/batch-fixed/ranking-diagnosis.txt`; no ranking or profile was changed.
Raw receipts are in
`native/batch-fixed/runs/20261015T190516Z-2978-6a0c258f-1585-496b-b726-0a6c41883c3b/`.
Root checks raw hashes/exits, unchanged queries, generation/source counts, Note
body, byte verification and cleanup in `batch-fix/root-real-corpus-review.json`.
The private daemon exits 0; its socket/temp directory is removed.

## Independent recovery and an exposed metadata gap

The stopped original repository is copied with an identical 217-entry tree.
Its 2,710,768-byte recovery reference and 503-byte public anchor remain outside
the copy. The reader receives no catalog, signing identity, vectors or source
tree. Authenticated import, full-byte verification and digest-bound restore
pass for snapshot `snap_ff3357ce08870d6d118709ec1a92c71c`:
**104/104 files and 2,486,895/2,486,895 bytes**, `catalog_used=false`.
Root compares all actual restored paths, hashes and lengths to the frozen
manifest. Recovery inputs remain unchanged; reader exit and socket cleanup pass.
Evidence: `recovery/reader-run-7BLjIE/` and
`recovery/root-byte-reader-review.json`.

At the time of this baseline export, the three later metadata writes were **not
proven recoverable by this reference**. Its authenticated sequence-1 child
predated them; their Note/TAG/description IDs and body digests were absent.
Import-level `fact_health=COMPLETE` proved a valid child exists, not coverage of
later catalog writes. The signed capture profile still declares `PARTIAL` with
omissions. The reconciliation records each missing write separately. This is a
historical gap in that exported reference, not the current bounded test status:
subsequent focused tests cover ordinary Note/TAG/PROGRESS, annotation import,
TAG rename, and Description publication. These do not retroactively change the
older artifact or establish corpus-runtime recovery.

## Ordinary Note upsert portable recovery (bounded)

Root reviewed the ordinary Note create/revise slice as
`ROOT_REVIEWED_ORDINARY_NOTE_UPSERT_PORTABLE_RECOVERY_PASS`. The reviewed raw
run is `trial/recovery/note-upsert/runtime/attempts/20261015T202737Z-6794ce5aa2ac40489ba12935dfd885a3/run.json`
(SHA-256 `18f947aecf292a4ef48a16105018160db980da36690a21bea6e96efa523f818c`).
The actual writer committed revision 3 under the existing Note ID, with its
126-byte body digest `sha256:f7edfaa3ccc67ddfed3ac4224d90cb43e5cb4c5c781e332ff79d13011d76f268`,
then the publisher joined that exact revision to the authenticated successor.
This confirms only the handler's ordinary Note create/revise path.

The run retained one actual authenticated parent. The writer exited 0 before a
separate reader ran with no catalog and no signing key, using a separately
exported public anchor and an independent read-only repository copy. The actual
`TestActualNoteUpsertPortableRecoveryReader` run passed; it recovered the
revision-3 Note fact and verified all 104 original files / 2,486,895 bytes.
The reader was instantiated with no catalog (`Store=nil`) and no signing
identity. The root review confirms all 112 pre-existing repository
objects remained unchanged; the operation appended two objects, the 324-byte
description body and a 1,960,089-byte signed fact child. The exported recovery
reference is 4,671,340 bytes, with two inline v2 fact children of 1,950,944 and
1,960,089 bytes. Under the shared 16 MiB (16,777,216-byte) read limit, observed
headroom is 12,105,876 bytes. Static same-scale arithmetic estimates that seven
more similarly sized children would exceed that limit; this is not an executed
future-write or read test. Existing v3 parts externalize one individually
oversized child, not a cumulative inline chain. A later focused writer guard
closes the mismatch between export and read limits; aggregate history growth
remains open. This single Note reference is readable, but no claim is made that
unbounded repeated Note history is ready.

Focused Note tests cover two retained parents, partial/unknown publication,
missing-auth degraded saved-write behavior, and a later concurrent revision;
the response remains tied to the operation's own saved revision. Missing auth
returns the saved Note with a specific unavailable-publication warning, not a
success claim. Likewise, a TAG/delete publication failure preserves the user's
committed annotation and reports recovery coverage unavailable or unknown; it
does not roll back that saved write. The mismatched expected-revision guard
(current revision 1, expected revision 2) is tested. Delete tombstones remain
terminal under the admitted lifecycle; no later valid delete revision is
supported or claimed. The subsequent focused TAG/delete slice publishes the
committed TAG revision or delete tombstone across retained authenticated
parents, with catalog-free reader assertions. Additional bounded tests cover
TAG rename's committed target plus its tombstone, PROGRESS create/revise,
annotation imports (including NOOP/KEEP_LOCAL without an extra child and
KEEP_IMPORTED with a local successor), and Description USER/imported-kind plus
manually supplied AI_SUMMARY candidate/accepted-successor facts. They verify
saved revisions/bodies and applicable segments across retained parents; the
Description case binds creation config B under parent config A. A deliberately
invalid candidate is rejected before blob, part or closure publication.
Missing-auth and partial/unknown outcomes retain the saved write and report the
actual degraded reason. These are controlled fixture
checks, not corpus-runtime recovery. UI warning copy was refined and the
production Web build passed; no new browser acceptance is claimed here.

## Bounded reference size guard and TAG/delete publication follow-up

The final serialized recovery reference, including `self_digest`, is now
checked against the reader's existing 16 MiB cap in `MarshalRecoveryReference`
before serialization can be reported successful. This is a parity guard, not
a larger limit, new format, history pruning, or a solution for cumulative
history growth. Focused size tests cover exact-cap and one-byte-over values,
an authenticated aggregate child chain whose children individually fit but
whose reference exceeds the cap, refusal before creating output, preservation
of an existing destination, and normal v2/part-bound round trips. The
aggregate case was RED before the guard: a 16,867,660-byte reference was
exported although its 16,777,216-byte reader rejected it. Child sizes were
17,064, 5,618,107 and 11,219,046 bytes. The guard is now green in the focused
tests; total history-size policy remains open.

The ordinary TAG upsert and existing annotation-delete paths now publish the
committed revision or tombstone to every retained authenticated parent selected
by the existing helper. Focused two-parent catalog-free-reader tests assert
exact fact coverage without a catalog or signing key. Missing authentication
and partial/unknown publication retain the committed write and report the
recovery warning. A mismatched expected revision (current 1, expected 2) is
rejected before any annotation mutation or portable-child publication.
Delete tombstones remain terminal under the admitted annotation lifecycle; a
later valid delete revision is not supported or claimed. These TAG/delete tests
did not include a corpus-runtime recovery drill. The bounded follow-up tests include
TAG rename, PROGRESS create/revise, annotation import policies, and Description
body/segment publication. Flat import with a missing predecessor retains the
exact write but returns DEGRADED; it does not prove full history recovery.

Focused evidence is recorded under `recovery/reference-size/`,
`recovery/annotation-lifecycle/`, and
`recovery/metadata-publication-combined/`. The root review
(`recovery/metadata-publication-combined/root-review.json`) records the first
actual combined run at 222.017 s: 624 Go source hashes were stable and the only
failure was the unsigned CLI Description fixture expecting success instead of
the correct saved-write DEGRADED result; the other package tests, including
retained process-test evidence, passed. The actual package output is in that run's log (SHA-256
`33548ea7362b08aa3a1406ab7446f4cba97a43c3369cc0b866ec05b7d06b36b0`). The
only source change before the authorized repeat was that CLI test assertion.
The final cache-eligible combined command passed, exit 0 in 5.273 s, with 624
stable source hashes. Twenty-six package summaries were cached; the CLI
package's uncached tests took 2.253 s. Its log SHA-256 is
`7c3a04b5ad7e56768fcf01339709c866b7870c9d5b2ef71003c432bfbe798403`; receipt
`recovery/metadata-publication-combined/20261015T221528Z/run.json`. The cached
repeat is not a new corpus or process drill and, on its own, proves no
ordinary-write corpus recovery, metadata-write restore, or phase/release
closure.

Earlier root-reviewed development-preview evidence records the tested daemon
(`sha256:d707a798601bb2420900bc371c853c58657fcd541bd69911ddc8c5f0ce5b6a9f`)
on the existing local socket and port 4648, with 20 content entries, 4
snapshots and a read-only fused FTS + BGE/zvec query. Root reconciled its binary,
listener and inventories; no owner content/annotation mutation or index rebuild
was run. Its receipt is
`recovery/annotation-lifecycle/owner-rollout/evidence/owner-rollout-terminal.json`
(SHA-256 `27b42f9abebbeefcfc6ce0d3de44b67a077444c1beafde1bff1b9ff2e0052987`).
That earlier rollout predates the metadata-publication/compact-reference work.
Its receipts prove neither metadata-write recovery nor a restore drill. The
later metadata candidate update is recorded below.

## Bounded owner-preview rollout (2026-10-16)

After the corpus drill, the reviewed 624-source metadata candidate was installed as a
daemon-only update to the existing local owner preview. PID 45199 serves the
existing config and port 4648; daemon SHA-256 is
`bb2b077d48f7e1877ec8e72698af827d3fc00025dc8701707166de72afe3678c`. The
config and existing CLI hashes are unchanged. Read-only checks returned the
same complete 20-entry content projection and four snapshots, with lexical and
semantic status both `READY`; repository, recovery, vector, and model
inventories matched the pre-stop evidence. A mode-0700 cold rollback copy
passed SQLite integrity and table-count checks. No owner metadata was changed,
and no index rebuild or extra semantic query was run. This is a bounded local
preview update, not release qualification. The startup log also records an
unavailable image capability because its configured bundle path is missing;
image capability was not assessed in this rollout. The first fixed-time
listener sample and backup receipt check returned nonzero, then same-PID
readiness and the corrected cold-backup verification passed. The pre-stop
environment comparison found only a `SHLVL` difference; no `CAIRN_API_TOKEN` was set,
and environment values were not persisted. Full command, process, inventory,
and rollback receipts are in
`trial/recovery/metadata-owner-rollout/20261016T231300Z-owner-replace/`;
terminal receipt SHA-256 is
`e24b31b86f99158a50864d988910abe3b76778312b194c755d3cb2f8b7992e66`.

## Bounded streaming follow-up for metadata publication

The reviewed Phase 3 implementation in
`server/internal/exact/subject_fact_publication.go` stops retaining every
historical closure body while resolving publication targets and checking the
published result. It retains the prior mapping and requested membership,
streams each authenticated parent through fresh validation, and holds only the
latest parsed bundle; parent and fencing checks remain in place. No recovery
format or authority changed. The focused exact/daemon test run exited 0 with
19 test declarations selected by its filters;
the final tagged broad Go run exited 0 in 234.654 seconds with 624 source
hashes stable (raw log SHA-256
`03cd6e238d2dfc5a0a3b4b6fe8ba2e69bff3123656ab9a2fff4ea44bb001f4ce`). The
production source SHA-256 is
`5f6ffb912f58221b268e9702340d15c2363656979b8dbfa324d1d512733ac73f`; the
test source SHA-256 is
`550a8cc30e1216225f4619c8794ca94799950b12659aca1539197896262547b7`.

The two-copy correctness check made one NOTE revision-1-to-2 write per
isolated copy, with no retries. A separate store- and signing-key-free reader
validated eight facts (the seven retained facts plus the new NOTE) under one
authenticated parent at sequence 9 for each copy. The comparison is a single
sequential fresh-process sample per binary, not a performance qualification;
the source profile and its prior vector files stayed unchanged:

| Measure | Before | Streaming build |
| --- | ---: | ---: |
| `Handle` wall | 8.2539265 s | 8.030684459 s |
| Outer process wall | 8.4638 s | 9.4478 s |
| Maximum RSS | 99,516,416 B | 93,650,944 B |
| Peak memory footprint | 75,891,360 B | 76,153,504 B |

The shorter `Handle` sample was accompanied by longer outer wall time; RSS was
lower while peak footprint was slightly higher. Cache state and run order were
uncontrolled, so this does not establish a speed or memory improvement. The
roughly eight-second metadata-write delay remains open. An earlier incorrectly
pointed 8.137-second diagnostic is not used as the baseline. Full comparison
receipt and raw profiles are under
`trial/recovery/metadata-write-profile/streaming-comparison/20261015T232056Z-two-copy-preflight/`;
implementation review and broad-test receipts are under
`trial/recovery/metadata-write-profile/streaming-implementation/20261016T000000Z/`.
This isolated comparison did not install its source build. The owner preview
then ran the metadata-corpus daemon identified above (PID 45199); the later
local recovery and client promotion are recorded below. No semantic query, export/restore, explicit index rebuild,
model change, or owner metadata write was part of this follow-up. It adds
bounded Phase 3 implementation evidence only; phase and release gates remain
unchanged.

## Compact recovery-reference successor (bounded)

The ADR-051 selector is implemented and tested for this development slice.
Generic signed export retains byte-identical v2 output when it fits, and uses
`org.cairn.recovery-reference.v3` only after a typed v2 size refusal. Explicit
v2 APIs retain their version and bound. V3 references unchanged signed prepared
and fact records, authenticates the frozen ordered prefix, and validates
history sequentially without retaining every historical bundle. Import,
service-level migration and existing clean-reader startup report/accept the
actual supported schema; no new command or catalog authority was added.

An earlier combined run for the compact-selector changes passed in 225.33 s
with 618 stable Go source hashes; its log SHA-256 is
`7cee366c3de0888e9422e539b8da64715c1519fa2e3e738f82c5ab4a84d4b1d8`. This
receipt predates the final 624-source combined run documented above. Its log is
under `recovery/compact-reference/combined/`, with review in
`recovery/compact-reference/root-review.json`; it remains the source of the
separate-process test output described next.

Its separate-process regression used one controlled 48-byte original and two
5,600,000-byte Note bodies created as test data. Those catalog writes are not
ordinary user-write runtime evidence or representative owner metadata. The
expanded v2 reference was 16,867,500 bytes; its three placed fact records were
17,041, 5,618,084 and 11,219,023 bytes, each below the unchanged 16 MiB record
cap. Generic export produced a 3,715-byte v3 artifact (SHA-256
`42f5edf34709785cf8e2b935db7334f401521a4255811d56bd7472c287b3c563`).
The separately supplied public anchor was 503 bytes (file SHA-256
`0f3097ed74df83cb2884c8b902fac48ec009cddb43bd30666af9eb1f16f08c34`).

Before starting the fresh daemon, the test removed its original source tree,
SQLite state and private signing material. Real CLI processes then imported v3
with `COMPLETE` selected-prefix health and `catalog_created=false`, verified
full bytes with `catalog_used=false`, planned/applied restore, and checked the
exact output path set plus 48 bytes / SHA-256
`1feb2cb1e65f8adcc283ff370b0de15067bd0dc2edf230f600bcf73eda74eab1`.
The repository's ten-file hash inventory stayed unchanged; the reader exited
0 and released its socket. The fresh daemon and CLI hashes are respectively
`b81ac8064efec4412a9b2b145c398eb207dcada3a6aef554b5bc2e751b6150bc`
and `d6e2f02b355e88f9531ea4ae754096acedc47b1ede26505bbbbbd25adc3efbd9`.
Raw CLI JSON and binary identities are in the combined log at lines 179–339;
this run supersedes the earlier pre-tightening output excerpt.

Focused cases plus the combined suite cover v2 byte compatibility, exact size
arithmetic, exact-cap/one-byte-over refusal, empty-prefix/non-null arrays,
unknown fields/roles/schema/extensions, wrong anchor/repository, selected
record or body-attachment corruption/absence, already-canceled contexts, no-create/no-
overwrite admission refusal, valid suffix exclusion and a known authenticated
post-head fork. The existing 2,500-file prepared/fact-parts fixture also checks
v3 success, rejection of a truncated prepared part or missing fact part, and
success after repair, without adding a second large fixture. The negative JSON
mutation helper has a successful no-op control and recomputes the typed digest;
well-shaped descriptor substitutions must decode before repository rejection.

The Unix near-limit fixture exercises an actual v3 selector with a 14,521,495-byte
prepared v2 record and a 16,210,219-byte fact v2 record, each below the existing
16 MiB per-record bound. The expanded 30,734,625-byte v2 reference was refused;
generic export emitted a 3,014-byte v3 selector. With a separate public anchor
and no catalog or signing key, the reader restored 201 files / 3,847 bytes with
exact path/hash/length while the source remained available. This closes the
planned bounded large-prepared/near-limit-fact aggregate fallback assertion; no
exact prepared-record cap sweep was run. History-scale performance, old-reader
interoperability, full metadata/catalog reconstruction and release qualification
remain unproved. This slice does not close PC-20 or any whole core/release phase.
These compact-reference tests add no browser acceptance, AI integration,
Linux, package or model-install validation.

## Remaining work

### Explicit semantic work and current-source freshness

The reviewed native latency/currentness continuation used a fresh isolated
profile, the unchanged manifest (`b0782531…bf2570`, 104 files / 2,486,895
bytes), unchanged query file (`c2f86e3d…433ce7`, 12 cases), and candidate daemon
SHA-256
`6e264d90e3991ca71ef4bf75499609117db78038ce39f42578d485dce481dc1b`. The
setup's first invocation exited 2 before config, daemon, or ingest; the retained
isolated continuation then completed with direct exit 0. It saved 159 command
receipts with raw stdout/stderr, hashes and exits; root reviewed their joins,
the unchanged 24 frozen-mode queries plus four controls, and the cleanup. The
review is `trial/latency-fix/root-native-latency-review.json` with status
`ROOT_REVIEWED_BOUNDED_LATENCY_FRESHNESS_PASS_WITH_RECALL_MISSES`.

Ordinary exact apply took **3.584 s**; imported description, initial Note,
initial TAG, revised Note and second TAG took **0.222, 0.222, 0.229, 0.314 and
0.353 s** respectively. These are one-run observations, not a paired historical
comparison or a causal performance claim. The first explicit local BGE/zvec
rebuild took **82.539 s** and the second **81.309 s**. Both indexed all **7,496
FULL** model inputs with zero missing, unavailable, truncated or unknown inputs.
Source coverage was 214 expected / 213 indexed / 1 TAG excluded after the first
build, then 215 / 213 / 2 TAGs excluded after Note revision 2; the generations
were `idx_aece7b4a1f3f6b3b3d32741293125836` and
`idx_5fb50d09039af64b88083a82ca0e4a3c`.

Observed currentness is explicit: after exact ingest, lexical was READY and
semantic was NOT_BUILT; adding `Phase4Latency` retained the same READY semantic
generation; revising the existing Note made semantic UNAVAILABLE as stale while
current lexical and default-fused fallback still found revision 2 (the fallback
returned DEGRADED, CLI exit 5). A query pinned to the first generation retained
revision 1's exact Note body and annotation identity. The second explicit
rebuild published a new READY generation. Its returned semantic hit contained
one segment with `source_type=ANNOTATION`, source ID
`ann_c525dee07ed5c75d36196a2c0fa42378`, and the exact revision-2 Note body.
The matched generation inventory separately binds that Note ID to revision 2
and body digest `sha256:84fd5bb49697bf7d9d457dfb471dab201550757302f3566e6fba6e89ab863fdf`;
the result exposes no `text_source_provenance` object for this legacy short-Note
row. The revised Note body is **111 bytes**, SHA-256
`84fd5bb49697bf7d9d457dfb471dab201550757302f3566e6fba6e89ab863fdf`. Its
retained origin says it is a verbatim text excerpt from the operator's voice-
capture request, with no recorded audio or ASR claim.
There were exactly two intentional explicit rebuilds; ordinary writes did not
wait for them.

This proves the admitted on-demand semantic-work/currentness slice and closes
only PC-07k. It does not mean semantic inputs or query quality are complete:
there were 0/5 semantic-only primary cases with all expected sources in the
top ten; Q03's first expected result remained rank 22 and the description
control rank 12. The focused `TestSemanticEmbeddingIsExplicitAfterOrdinaryWrites`
also observed zero document-embedding calls for ordinary exact/metadata writes
and preserved lexical freshness; that counter-based test is separate evidence,
not a count from the native corpus run.

Focused freshness/control-plane tests and
`env GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` are retained under
`trial/latency-fix/`. The first zsh wrapper exited 1 after the Go command had
finished, when it tried to assign zsh's readonly special `status` variable.
Root authorized one identical cache-eligible repeat captured directly through
Python: return code 0 in 2.791 s, with log SHA-256
`e95c1b08518c23c1fde9aa83d84196280c31a4744423cf3bc7f2076f7a665c8e`. No
additional run was made.
The raw native run is under
`native/latency-fixed/attempts/20261015T194730Z-11906-67108d68-fd38-4cdd-b1c3-2837ce8c00e4/`.

### Remaining recovery and qualification gaps

Historical byte-verification evidence: the latency run's full-byte VERIFY
receipt reports `catalog_used=false` and passes 104 files / 2,486,895 bytes;
the earlier authenticated clean-reader trial likewise restored and verified
all 104 originals without the catalog. Those initial byte-only runs did not
prove metadata recovery from their then-exported sequence-1 child, which
predated later writes; that remains true of the historical artifacts. The
subsequent ordinary Note create/revise evidence above supersedes the gap for
Note only: revision 3 was joined to a signed successor and its fact verified by
a catalog-free reader; that Note run did not perform exact restore. The earlier
independent reader trial did restore and verify all 104 originals. Subsequent
bounded focused tests cover the listed metadata hooks with saved revision/body
joins and all-parent checks, but they are controlled fixtures, not corpus-runtime
writes. Do not infer corpus recovery from these tests, the Note proof, or a
child's `fact_health=COMPLETE` alone.

The observed 104-document Note reference remains 4,671,340 bytes. The Unix
near-limit fixture measured a 14,521,495-byte monolithic prepared v2 record and
a 16,210,219-byte fact v2 record (neither uses parts); their expanded v2
reference was 30,734,625 bytes and was refused. Generic export produced a
3,014-byte v3 selector (SHA-256
`01b789dc6f279864e6ca72c65213acb70bec2f425029f19ccea39a203c672355`). A
separately anchored reader with no catalog or signing key restored 201 files /
3,847 bytes with exact paths, hashes and lengths. The source remained
available; this test is distinct from the separate-process test that removed
source, catalog and keys. It demonstrates the bounded large-prepared/near-limit-
fact aggregate fallback; no exact prepared-record size sweep was run. Existing import
reconciles an already staged namespace, rather than rebuilding a lost catalog.
Normative §3.2 keeps small placed records in v1/v2 and parts for individually
oversized records; compact v3 changes the containing reference, not signed
child records. History-scale performance, full lost-catalog reconstruction,
broader corpus-runtime metadata coverage and retrieval quality remain open.

## 2026-10-16 bounded metadata corpus recovery drill

The isolated drill used a stopped-source repository copy for one 104-file
snapshot: 2,486,895 original bytes, manifest
`sha256:bc17506d2bfd3a235bbb2938318021026af174d143b8fdcb60807261eb99745c`.
The post-write export is the existing **v2** recovery reference, 16,466,616
bytes; it is not a compact-v3 artifact. The strengthened catalog-free
factreader matched seven committed facts against the one authenticated retained
parent at closure sequence 8: the TAG rename target and source tombstone, two
PROGRESS revisions, one imported NOTE, and two USER Description revisions.
The Description checks include the captured creation configuration, exact
predecessors (empty for revision 1 and the first document ID for revision 2),
acceptance and visibility, attached body bytes, and segments. The matcher used
the independent public anchor with no catalog or signing identity. Its direct
`go run` returned 0 in 3.265 seconds; stdout SHA-256 is
`c53b306ba31a07204142d8e18683276d63bbfdb5e0dba662fe87e8ba960bce4d`. The
authoritative matcher source/input hashes and receipt are recorded in
`recovery/metadata-corpus-drill/20261015T222646Z-449ad5ab35/run.json` under
`factreader_postwrite_coverage_v5`; prior matcher attempts remain preserved as
harness/input corrections, not product failures.

The separate clean-reader CLI imported the v2 reference with exit 0 and
`catalog_created=false`; full-byte verification returned exit 0 with
`catalog_used=false`, 104/104 files and 2,486,895 bytes. Restore plan and apply
both returned exit 0. Root compared the restored exact path set, hashes and
lengths with the frozen manifest. The reader process exited 0 and its socket
and temporary directory were removed. The writer was stopped with SIGINT after
the writes; its OS exit status was not captured and remains unknown. The source
profile stayed unchanged, and the recorded 624-Go-source inventory remained
stable. Raw command output and per-operation receipts are in the same
`metadata-corpus-drill/20261015T222646Z-449ad5ab35/` evidence directory.

This is one retained parent; focused two-parent assertions are separate test
evidence. It does not prove a fresh SQLite catalog rebuild or post-write search
freshness. Most non-Description operations report rounded 3–6 second server
durations; Description create/revise took 6.90 and 7.41 seconds wall time.
These are still visible UX latency concerns. No owner instance was deployed
for this isolated drill; the later daemon-only preview rollout is recorded in
[the bounded owner-preview receipt](#bounded-owner-preview-rollout-2026-10-16).

The accepted read-only semantic candidate diagnostic used the same frozen
queries, embedded each query once, and reused each vector at K=100 and K=500.
The rank correction was post-processing only, without another embedding or
vector query. It changed neither the production K=100 limit nor expected labels.
For both Q03 and the Description
control, the K=100 results were an exact prefix of K=500, so expanding K could
not change their first-distinct-subject top ten. Q03's restore-manifest source
remained at distinct-subject rank 22, cold-media at rank 28, and
recovery-fidelity entered the K=500 result at rank 58; none reached the top
ten. The Description control's target subject ranked 12, but its expected
Description segment was absent through K=500. This diagnostic does not
establish general recall or model weakness. The frozen semantic-only primary
set remains 0/5 on the strict all-expected-sources-in-top-ten criterion; no golden labels
were changed. Evidence is
`trial/semantic-candidate-diagnostic/postprocessed-rank-summary.json` and
`trial/semantic-candidate-diagnostic/root-candidate-order-review.json`
(accepted bounded read-only diagnostic).

Accordingly, the drill closes only the observed seven-fact, one-parent corpus
case. Broader retained-parent/write-family coverage, post-write discovery
freshness, fresh catalog reconstruction, retrieval quality, and all release
qualification remain open.

Retain retrieval-quality and full recovery gaps. Full lost-catalog/history
reconstruction, index loss, provider loss, profile switching and the
supported-release matrix are not rerun. No new
browser/media/AI surface or Linux/Docker exploration is included. Phase 4/5,
gated Phase 6 and Phase 7 remain open.

## Duplicate-validation follow-up

The bounded Phase 3 publisher now avoids repeating deterministic record
validation for the same decoded bundle within one scan; independent parent reads,
manifest checks, signatures, attachments, fencing and own-revision behavior
remain. Focused tests passed (11.368 s); the tagged broad suite passed
(247.641 s, log SHA-256
`acc6b9bc448afe0c8fda9ceb713fb206b9e2c31e0bb426b8a5b6711f810ecd12`). The
pre-run wrapper inventory covered 583 Go files and omitted 41 third-party
files; complete post-run hashes covered 624 files. This does not establish a
complete 624-file pre/post comparison. The tested implementation and test
hashes are `2cc204aaf5faef45f5324116e3cf0a3c6bca441181310b8364f448651295b0ad`
and `46fb4c5aa4d728574f0ead29f6a9d66f591c9d87bb79b48bbfaf39eb33cfe1c8`.

Four unprofiled, isolated NOTE revision-1-to-2 saves succeeded. Four separate
catalog/signing-key-free readers each verified eight facts under one retained
parent at sequence 9. `Handle` samples were 8.078/8.093 s before and
6.929/7.122 s with the change (two samples per version; descriptive only,
not a performance qualification). Each ordinary save also refreshed its
clone-local lexical and graph generations; semantic search remained
`UNAVAILABLE`. No explicit rebuild, semantic query, model operation or owner
write was run. The original source profile and its eight vector files were
unchanged. Raw operation, reader and inventory receipts are in
`trial/recovery/metadata-write-profile/duplicate-validation-comparison/20261015T235000Z-unprofiled-prep/runs/execution-02/`.
An earlier pre-dispatch executable-mode failure and an initial receipt-field
check mismatch are retained as harness issues; the first successful mutation
was not repeated. The tested source and Notes client bundle were not installed
in the owner preview by this comparison.

## Notes text and save-outcome fidelity

The bounded headless client check preserved entered Note text on create, edit
and duplicate-member Note creation, rejected blank-only input without a write,
and retained TAG trimming and optimistic identity behavior. A `DEGRADED` result
kept the saved Note visible and exposed its follow-up reason; the five-target case recorded one
saved/degraded result and four failures across five requests, without retry.
The mock-route run exited 0 in 5.788 s (log SHA-256
`d9e50a7460fcdbb36daf9e38fe5fbbac4b0b6ab663ab46034e2cc9037a3ff5dc`). It
validates client payload and outcome handling, not backend publication or an
owner write. The reviewed source and built bundle are recorded under
`trial/notes-input-fidelity/root-review.json`; neither had been installed in
the owner preview at this check. These bounded results do not close PC-20 or
any phase or release gate.

## Local preview recovery and client promotion

The later backend-candidate rollout did not complete. Its verifier treated the
existing `status.data.index` array as an object and incorrectly triggered
rollback; the rollback waiter then treated an exited zombie as a live process.
This temporarily interrupted the local preview. These orchestration errors do
not establish a candidate product regression. The previous `bb2b077d...3678c`
daemon was restored and is running as PID 55134 with the original argv/config.
Restart used the explicitly approved trusted app execution environment with
`CAIRN_API_TOKEN` absent; equality with the discarded original environment is
not claimed. No catalog or repository data was restored over current data.

Independent read-only checks returned 20 complete content items, four snapshots,
schema 27 `CURRENT`, repository OK and lexical/semantic `READY`. All repository
(120 entries), recovery-record (2), vector (144) and model (14) paths, modes and
file hashes match their pre-stop inventories. The cold rollback set remains
retained. The incident and primary review are in
`trial/recovery/metadata-write-profile/duplicate-validation-owner-rollout/20261016T001737Z-local-3a1aaebe/`.

The separately accepted Notes client was then promoted without another daemon
restart: its assets were published first, old hashed assets retained, and
`index.html` replaced atomically last. HTTP-served index, JS and CSS hashes match
the isolated tested bundle (JS SHA-256
`f94939e0ddad2cb4d266d76777158d6a6bfea99b25fc4b9743c324b28296c396`).
The publication receipt and old-client backup are in
`trial/notes-input-fidelity/web-promotion-evidence/attempt-20261016-01/`.
Thus the Notes text/outcome fixes are available in the local preview; the
streaming/duplicate-validation backend candidate remains uninstalled. The
measured candidate latency must not be attributed to the running owner daemon.
All core phase and release gates remain unchanged.
