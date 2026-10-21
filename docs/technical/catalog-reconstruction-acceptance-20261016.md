# Fresh-Catalog Reconstruction Acceptance — 2026-10-16

**Status:** Implemented and tested for the bounded Phase 3 development scope.
The isolated reconstruction evidence below is not release qualification, an
owner lost-catalog test, or a keyless ordinary-daemon recovery claim. A later
local owner preview binary update is recorded separately below.

## Scope and exit

This slice implements the existing Store-backed `recovery.import` path under
[Restore Manifest §20.1](../requirements/restore-manifest.md#fresh-operational-catalog-reconstruction)
and [ADR-052](build-stack-and-architecture-selection.md#adr-052-reconstruct-the-operational-catalog-without-inventing-capture-history)
and [ADR-053](build-stack-and-architecture-selection.md#adr-053-authenticate-catalog-relations-instead-of-guessing-them-during-recovery).
The exit was an isolated real daemon/CLI journey after the original source,
catalog, and index were removed and the repository was relocated: reconstruct
names and Notes/history, rebuild lexical search, read and verify exact content,
restore exact bytes, replay without changing state, and publish again from the
reconstructed catalog for a catalog-free reader.

The publisher carries original FileVersion, admitted logical-extent, and
required Representation rows in the fixed reserved catalog-relation witness
profile over the existing signed `METADATA_FACT` record. Fresh import validates
each mapped FileVersion against exactly one witness and refuses missing or
mismatched relations. It preserves authenticated row fields and only rebinds
the local scan/observation handles. This adds no catalog schema, endpoint,
processor, or recovery envelope.

## Executable evidence

`TestRecoveryCatalogProjectionRealDaemonCLI` used temporary source, catalog,
repository, and daemon configuration. It ingested two files, wrote and revised
a Note, created a description, and exported a signed reference plus a separately
exported public trust anchor. It then removed the original source, SQLite
catalog, index directory, and original repository location; relocated the
repository; and imported the reference into a fresh catalog through the
existing daemon/CLI.

The journey verified retained paths, names, stable subject identity, exact
Note body/revision/history, description body/segments, lexical search, honest
semantic-unavailable status, full-byte snapshot verification, exact content
read, and restore output by SHA-256 and length. Replaying the same reference
reported `CatalogCreated=false` and left projected content and annotation
history unchanged. Afterward, the ordinary CLI revised the Note to revision 3,
exported a new reference with `FactHealth=COMPLETE`, and a Store-free read-only
reader validated that reference against the relocated repository and separate
anchor.

The lost-catalog journey retained the owner's signing-material store. The
separate public trust anchor was an explicit input. This is not a keyless
ordinary-daemon installation. The fixture is isolated and does not represent
the owner's full corpus or release qualification.

The filtered focused run passed across `server/internal/exact`,
`server/internal/store/sqlite`, `server/controlplane`, and
`server/cmd/cairnd`. It covers witness binding and refusal, replay/current
projection behavior, annotation-history rollback and replay, lexical rebuild,
and post-commit degraded outcomes. The exact command and structured result are
in [`acceptance-summary.json`](../../dist/product-recovery-catalog-20261016/acceptance-summary.json);
the full focused output is in
[`focused-final.log`](../../dist/product-recovery-catalog-20261016/focused-final.log).
The completed broad run also passed:

```sh
go test -tags cairn_zvec_dynamic ./...
```

The full output and exact process result are in
[`broad-authorized.log`](../../dist/product-recovery-catalog-20261016/broad-authorized.log)
and [`broad-authorized.result`](../../dist/product-recovery-catalog-20261016/broad-authorized.result).
The focused run and its command are recorded beside them in the dist evidence.

The first broad attempt is retained as regression history. It failed because
the evidence snapshot's `.go` copies were scanned as packages, the production
publication-size projection omitted the new witnesses, and the near-limit
fixture crossed into multipart output. The mixed v1/v2 failure was
traced to a test helper that retained a v2-only witness in its simulated legacy
v1 bundle. That helper now creates a genuine historical v1 fixture without
weakening production decoding. The copied snapshot files were renamed to
`.go.txt` with their bytes and SHA-256 preserved, and the snapshot manifest
paths were updated. The full first-attempt log remains at
[`broad-final.log`](../../dist/product-recovery-catalog-20261016/broad-final.log).

## Candidate identity and limits

The final source identity is the 635-file manifest
[`source-final.json`](../../dist/product-recovery-catalog-20261016/source-final.json),
SHA-256 `f63e005d835fb1fe315266c428fa0699028ab8bc38dc8c2a37a1adf4b31890e3`,
at revision `d1750d916f198293bae84fb43ae9d6127e7ee86e`. The isolated candidates
were built with Go `go1.26.5 darwin/arm64` and tag `cairn_zvec_dynamic`:

| Candidate | SHA-256 |
| --- | --- |
| `cairnd` | `cdef9ed9ecc5df963bfdac84b305e1bef277ab7a5cbf44d8e4e8ce10c2ba2d66` |
| `cairn` | `2c8f252816896eda2cc46e6b8e85734c8e654e9c86a9c068790742a9a06262bb` |

`go version -m` records the same tag and source revision, with
`vcs.modified=true`; full build commands and build info are in the dist
evidence directory. These binaries were not installed as part of the isolated
reconstruction test. A separate local owner preview update happened later and
is documented here; it did not test catalog loss or reconstruction.
Keyless daemon recovery, the owner's full corpus, and declared profile release
qualification remain unclaimed.

## Later local owner preview update (2026-10-16)

The same two candidate binaries were separately installed into the existing
local owner preview daemon after a live SQLite online backup passed
`PRAGMA integrity_check=ok`. The old daemon exited normally on `SIGTERM`; the
candidate binaries were staged, hash-verified, then installed with same-directory
atomic replacements. The existing config, socket, API address, web root,
repository, catalog, model, and index generations were retained. The candidate
started in a foreground session and reported typed status `SUCCEEDED`, catalog
`CURRENT` (schema 27), repository `OK`, and lexical and semantic indexes
`READY`.

After startup, a single Chinese semantic query returned 20 semantic hits, and
an existing 253-byte `Cairn-Notes.txt` read matched its prior SHA-256 and
content identity. The comparison receipt records unchanged config digest,
index generations, query components, and Note/subject/entry/content identity.
This is an existing-catalog continuity check, not a lost-catalog journey or a
claim that the owner corpus was reconstructed. The static web bundle was not
changed. The backup is retained separately and was not used for automatic
catalog rollback.

Startup reported the optional image capability unavailable because its bundle
was absent. The saved pre-update status had no image/capability field, so the
prior state is unknown and no regression is claimed. No image bundle was
installed. Older signed references without the ADR-053 catalog-relation
witness remain unsupported for writable fresh-catalog reconstruction; the
binary update does not backfill them. Full process, backup, and before/after
proof receipts are in [`promotion-summary.json`](../../dist/product-core-preview-update-20261016/promotion-summary.json),
[`process-receipt.json`](../../dist/product-core-preview-update-20261016/process-receipt.json),
and [`comparison.json`](../../dist/product-core-preview-update-20261016/read-proof/comparison.json).
This update grants no Phase 3 or release qualification credit.

## 2026-10-19 — Preserve description history regardless of record order

A separate two-root recovery drill exposed an actual reconstruction defect:
signed records are ordered by identity, so a description successor can precede
its predecessor. The SQLite importer attempted that order directly and failed
the predecessor foreign key. The failed transaction left all six inspected
content/history/publication tables empty; the signed input was not rewritten.

The importer now orders description inserts by predecessor dependency inside
the existing transaction. IDs, bodies, segments, immutable replay comparisons,
and signed record order stay intact. Missing predecessors and cycles refuse
the transaction. The focused
`TestRestoreRecoveryCatalogProjectionOrdersDescriptionPredecessors` covers a
three-revision reverse-ID history, exact replay, and refusal with rollback.
The broad `go test -tags cairn_zvec_dynamic ./...` passed. Its first attempt
also found archival `.go` copies under `dist`; those copies were renamed with
their bytes preserved before the successful run. That failed output remains
in `dist/product-history-recovery-20261019/fix-checks/`; the successful receipt
is in `fix-checks-attempt-02/` in the same cohort.

The patched daemon is SHA-256
`03167ef910826dbccc2d49f99c452ad825a31437430761fb75ac7d5f4fb29db1`.
The isolated build binds 640 Go/module inputs and nine normative files;
the CLI hash is unchanged. The original failed fixture was reused: import
newer B, import older A, then replay B. Current content remained B, and replay
created no duplicate catalog. Four annotation revisions (including a tag
tombstone), two description revisions, and two source-aligned segments matched
the producer's complete rows before and after a clean process restart. Both
roots independently passed full-byte verification and exact restoration of
two files / 41 bytes, including the distinct 24-byte file versions.

The executable acceptance is a linked prefix and suffix in
[`complete-result.json`](../../dist/product-history-recovery-20261019/fix-acceptance/continuation/complete-result.json).
It preserves the prefix driver's incorrect `EXACT_PROTECTED` expectation.
The original signed B record actually says `STORE_EXACT` / `EXACT_FALLBACK`
because content classification was unresolved. The suffix compares all
selected protection fields to that signed record exactly, rechecks the
already-restored bytes, and runs only the unfinished restart/readback steps.
It does not repeat import or restore. An earlier read-only driver preflight
failure is also retained separately.

The writable catalog branch retained the fixture's original signing identity.
A separate Store-free `--recovery-reader` branch restored both roots using
only the repository, references, and independently retained public anchor;
its profiles had no catalog or signing identity. Ordinary writable-daemon
startup without signing material still refuses explicitly. These are distinct
recovery paths; this evidence does not qualify keyless ordinary startup,
history-scale performance, the owner's full corpus, or release readiness.

### Local preview delivery of this fix

After source review, the successful broad run, and independent review of the
same-fixture prefix/suffix evidence, root installed the patched daemon through
a backed-up atomic replacement. The prior managed daemon exited 0 on SIGINT;
the new process is PID `97016`, managed session `78263`, with the same config,
socket, Web root, and loopback API address. No restore/import was applied to
the owner's catalog.

Read-only post-start evidence reports healthy status and lexical/semantic
`READY`. The config, CLI, all 72 Web files, and the same 20 listed
subject/entry/content/length tuples match the pre-update baseline. The daemon
hash is the patched `03167ef9…` above. This is a bounded existing-catalog
continuity check, not an owner catalog-loss drill or a full-corpus count.
Receipts are in
[`fix-promotion/post-start/`](../../dist/product-history-recovery-20261019/fix-promotion/post-start/).

All owned drill processes and sockets were gone before cleanup. The 30
synthetic repository files were archived with matching source/destination
hash maps; private signing material and catalogs were not copied into that
archive. The temporary drill profile was removed. This archival copy is not
relocation acceptance; see
[`fixture-retained/cleanup.json`](../../dist/product-history-recovery-20261019/fixture-retained/cleanup.json).
