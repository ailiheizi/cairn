# Build Stack and Architecture Selection (RW-MVP-1)

## 1. Purpose, scope, and status

This document records the concrete build-stack and package-structure decisions for the `RW-MVP-1` vertical slice: a read-only managed-archive and search profile for a self-hosted NAS data layer. It is the implementation-oriented companion to the [NAS Vertical Slice Implementation Plan](nas-vertical-slice-implementation-plan.md) and the [Open-Source Adoption and Code Borrowing](../references/open-source-adoption-and-code-borrowing.md) audit.

Scope:

- Confirm the kernel/userland split and the five active extension seams plus the reserved `RetrieverDriver` (system-architecture.md:56-63).
- Freeze or explicitly defer every component choice that the plan milestones need (repository engine, FTS5/zvec search, Processor control plane, MCP, file identification, CLI framework).
- Propose the Go package layout that implements the seams without exporting a public ABI.
- Define the concurrency, lifecycle, and storage-topology model the controller will use.
- Record the key decisions in ADR style so they can be revisited with their rationale.

Status: **informative implementation guidance**. Normative authority remains with the requirement documents ([Core Kernel and Interface](../requirements/core-kernel-and-interface.md), [Driver and Processor Interfaces](../requirements/driver-and-processor-interfaces.md), [System Architecture](../requirements/system-architecture.md)). A row marked **frozen** here is frozen because a normative document or the adoption audit already froze it; a row marked **qualification spike pending** or **open** requires its stated gate before the release binary may depend on it. `go vet` and `-race` test runs must stay clean on every merge; the current tree already keeps a single-module layout (`go.mod:1-5`).

## 2. Architectural decision overview

### 2.1 Kernel and userland are confirmed

Cairn is built as a small authoritative kernel plus replaceable, versioned userland. The kernel owns identities, accepted decisions, provenance, transactions, verification meaning, namespace meaning, and recovery semantics (system-architecture.md:38-52; core-kernel-and-interface.md:36-48). The userland is exactly the seam set declared in system-architecture.md:56-63 and driver-and-processor-interfaces.md:58-68:

- `CaptureDriver`
- capability-oriented `Processor`
- `RepositoryDriver`
- `IndexProvider`
- `QueryProvider`
- a later reserved `RetrieverDriver`

Conceptual `Processor` roles (`CLASSIFY_LEARNED`, `PARSE`, `EXTRACT`, `ENRICH`, `FINGERPRINT`, `TRANSFORM`, `VALIDATE`, `INDEX_PREPARE`) are capability roles inside one interface, not separate public wire ABIs (system-architecture.md:219-232). Presentation bindings (CLI, MCP, and later REST/WebUI) are northbound adapters, not storage-algorithm seams. Cairn does not implement filesystem mounts (system-architecture.md:69-72).

The kernel is not an empty framework: the reference distribution must ship a complete default pipeline that ingests, deduplicates, compresses, places, verifies, searches, browses, and restores without any optional plugin or WebUI (system-architecture.md:76-78; core-kernel-and-interface.md:81-83).

### 2.2 Authoritative versus replaceable

| Area | Kernel-owned (authoritative, durable) | Replaceable (userland, versioned) |
| --- | --- | --- |
| Identity | `SourceId`, `SourceViewId`, `NamespaceEntryId`, `FileVersionId`, `ContentId`, `ChunkId`, `RepresentationId`, `SnapshotId`, `PlacementId`, `IndexGenerationId`, `OperationId`, `PlanId`, `DecisionId` (system-architecture.md:148-166; core-kernel-and-interface.md:89-106). Database row IDs and repository-private object names are never canonical (core-kernel-and-interface.md:108) | Repository-private chunk, pack, and object naming (backend-owned) |
| Plans and policy | Immutable accepted plans, decisions, and fidelity choices (core-kernel-and-interface.md:123-135) | Planning heuristics; estimation models |
| Publication and recovery | RRF roots, `PREPARED_CLOSURE`, `PUBLICATION_COMMIT`, verification gates, clean-recovery meaning (system-architecture.md:300-302; core-protocol-and-reference-userland.md:366-383) | Repacking, recompression, re-encryption, transport |
| Transactions | Durable journal, idempotency, cancellation, leases, fencing, checkpoints, reconciliation (system-architecture.md:46) | Worker topology, queues, IPC (core-kernel-and-interface.md:175) |
| Namespace and access | `SnapshotTree` and `FileAccess` semantics and the empty-selector rule ("authoritative exact", never "something similar") (system-architecture.md:306-317) | Decoders, repository read adapters, gateway protocol bindings |
| Classification | Evidence ledger and the accepted classification decision; suffix and magic-byte stages are host-owned (system-architecture.md:232-246) | Learned classifiers, parsers, extractors |
| Search semantics | The stable query contract over logical subjects; generation-pinned queries; broker reauthorization (system-architecture.md:321-335) | The search store itself: schema, tokenizer, ranking, engine |

The stable read narrow waist already exists in code: `SnapshotTree` and `FileAccess` in `internal/readsvc/service.go:13-45`, the host-only policy seams in `internal/readsvc/service.go:81-102`, and the bounded adapter ports (`RepositoryReadAdapter`, `StorageRangeReader`, `RepresentationDecoder`, `NamespaceGatewayAdapter`) in `internal/readsvc/ports.go:66-181`. New engine, decoder, and gateway code must plug into these ports, never bypass them.

## 3. Technology selection matrix

Legend for the status column:

- **Frozen** — already decided by a normative document or the adoption audit; no further gate except the stated pin.
- **Qualification spike pending** — a leading choice that still has a decision-changing gate; nothing may ship until the gate passes.
- **Open / suggested** — explicitly not yet decided; the recommendation in this document is a proposal for review.

| Component | Selection | Rationale | Status |
| --- | --- | --- | --- |
| Language and toolchain | Go 1.26.0, single module (`go.mod:1-5`); `go vet` clean; `-race` enabled in the default test invocation; only `modernc.org/sqlite` as a direct dependency today | Go is the language of the existing tree (`internal/scanner`, `internal/readsvc`, `internal/store/sqlite`) and of the leading repository candidate (Kopia) and the added Go-native control (Plakar). One module keeps `internal/` private, which is the compatibility contract (core-kernel-and-interface.md:173). Race-detector tests are mandatory because the controller is concurrent (see section 5) | **Frozen** |
| SQLite and FTS5 | `modernc.org/sqlite v1.55.0` (already the sole direct dependency, `go.mod:5`) as the bundled `IndexProvider` and `QueryProvider`; one physically separate disposable database per immutable `IndexGenerationRef`; schema, row IDs, tokenizer tables, and query syntax are private (adoption doc §7, lines 238-251) | Pure-Go, CGO-free, STRICT-table SQLite is already proven in the operational catalog (`internal/store/sqlite/migrations.go`, 16 `STRICT` tables plus `schema_migrations`). FTS5 gives useful lexical search with zero new runtime. Generation-per-database gives atomic activation, bounded rollback, and cheap deletion (nas-vertical-slice-implementation-plan.md:186-191) | **Frozen** |
| Repository engine | **Kopia v0.23.1** as the leading `RepositoryDriver` candidate via library integration; **Restic v0.19.1** as the control benchmark and possible subprocess driver; **Borg 1.4.5** as a bounded local/SSH auxiliary; **Plakar** (Go, ISC) added as a second Go-native control and in-process library candidate. No engine is adopted until the qualification spike passes (adoption doc lines 62-64, 159-175; nas-vertical-slice-implementation-plan.md:164) | Kopia leads because its Go repository APIs, object reads, storage abstractions, and verification fit `RepositoryDriver` better than a CLI-only engine. Restic is a documented CLI, not a supported library. Borg is the least natural adapter but a useful compression/maintenance calibration. Plakar is the new Go-native contrast: its Kloset chunker and verify-oriented design give an in-process, permissive-license (ISC) control against Kopia. Selection is by observed correctness and operating cost, not stars or nominal ratios | **Qualification spike pending** |
| Processor control plane | Protobuf schemas + gRPC over a Unix-domain socket; large bytes travel through pre-opened file descriptors, never inline in messages; bubblewrap, namespaces, seccomp, `no_new_privs`, rlimits, cgroup v2, allowlisted environment, no network by default (adoption doc §6, lines 211-236; nas-vertical-slice-implementation-plan.md:175-176) | This is reference plumbing, not a public wire ABI: the semantic contract stays typed operations, handles, result envelopes, and artifact state. Out-of-process isolation is required for untrusted parsers (system-architecture.md:354-365) | **Frozen** as private plumbing; the wire contract remains experimental until cross-version conformance |
| MCP | Local, read-only MCP adapter over the same typed command dispatcher, using the official MCP Go SDK after pinning one license-stable revision (adoption doc line 53; core-kernel-and-interface.md:167-168) | MCP is a northbound presentation adapter, never an internal bus, scheduler, or data plane (adoption doc line 149). It binds the bounded read-only subset (status, search, namespace, content) | **Frozen** as the adapter approach; the exact SDK revision is **open until the license-stable pin** |
| File identification | Host-owned suffix rules, then bounded `file`/libmagic magic-byte evidence; magic database digest pinned; compressed-inspection and decompressor forking disabled; optional Siegfried for ambiguity/preservation depth (adoption doc lines 14, 51, 65) | Two-step evidence is a normative requirement: suffix and magic evidence must remain independently visible and auditable (system-architecture.md:232-246; core-kernel-and-interface.md:373-386) | **Frozen** (adopt and bundle); the magic database digest pin is release work |
| CLI framework | **cobra (`spf13/cobra`, Apache-2.0)** — see section 3.1 for the full reasoning and guardrails | The CLI command families are few but must stay perfectly stable in name, flags, exit codes, and JSON/JSONL output (core-kernel-and-interface.md:269-289). A closed cobra tree maps 1:1 onto the Core Command ABI families | **Open / suggested** (recommendation in section 3.1; review before freezing) |

### 3.1 CLI framework recommendation (open item)

The requirement is a **small, stable command family set**, not a large user-extensible surface (core-kernel-and-interface.md:269-289: `plan.*`, `status.get`, `job.*`, `snapshot.*`, `namespace.*`, `representation.*`, `content.*`, `search.query`, `recovery.export`, `capability.list`). Recommendation: **`spf13/cobra`** (with `pflag`), not a hand-rolled `flag`-based dispatcher.

Rationale:

1. **1:1 mapping onto the Core Command ABI.** Cobra's static tree makes every ABI command a first-class, documented object (`plan ingest`, `snapshot list`, `search query`...). The registry stays closed — no plugin registration, no `run_tool` escape hatch (core-protocol-and-reference-userland.md:225; core-kernel-and-interface.md:290).
2. **Stable flag conventions.** pflag's GNU-style parsing (interspersed flags, `--flag value`, repeatable flags, persistent flags per family) gives deterministic, scriptable command lines for the stable JSON/JSONL binding (core-kernel-and-interface.md:167). Hand-rolled `flag` parsing drifts easily across ten families.
3. **Uniform help, validation, and exit-code behavior.** Cobra centralizes usage generation and error wrapping; a single exit-code table and a single renderer (human vs `--json`/`--jsonl`) are enforced in one place, which directly serves "CLI, MCP, and later UI adapters bind the same command and authority semantics" (system-architecture.md:405).
4. **Domain precedent.** Kopia (our leading repository candidate) uses cobra; rclone and the wider backup/mount ecosystem provide battle-tested patterns for exactly this command shape.
5. **License.** Apache-2.0 is an accepted in-process license class (adoption doc §9, lines 278-297).

Guardrails if cobra is accepted:

- The command tree is code, but it is *closed*: adding a command requires a code review that changes the ABI surface; no runtime registration.
- No cobra type, flag string, or usage text enters the Core Command ABI schemas or MCP tools; the dispatcher (`internal/command`) stays framework-free.
- Human-readable text is evolvable (core-kernel-and-interface.md:172); the JSON/JSONL binding is stable and lives in one rendering layer.

Fallback position: if dependency discipline ultimately outweighs ergonomics, stdlib `flag` with a small manual subcommand table is acceptable because the family count is genuinely small — but it costs uniform help, completion, and flag consistency. The recommendation stands as **cobra** unless review finds a concrete cost.

## 4. Package layout proposal

### 4.1 Principles

- Everything under `internal/` is an unstable implementation detail (core-kernel-and-interface.md:173); this layout is a direction, not a public package promise (core-protocol-and-reference-userland.md:528).
- Package boundaries follow the seams: host packages own the seam contracts; adapter packages implement them. No adapter package may bypass the host package for a seam (mirrors the "no integration may import `internal/` or read Cairn SQLite" rule at core-protocol-and-reference-userland.md:98, applied inward).
- The existing packages stay where they are and are reused: `internal/scanner`, `internal/readsvc`, `internal/store/sqlite`. `internal/plugin` is legacy and retires (section 4.3).

### 4.2 Proposed tree

```
cmd/cairn/            CLI, controller, and recovery entry points; composition root only
internal/app/                composition root: wires config, store, journal, seams (from core-protocol-and-reference-userland.md:497)
internal/command/            typed Core Command dispatch and authorization (core-protocol-and-reference-userland.md:200-228)
internal/controller/         plan/apply/job/publication orchestration; the single writer of operations
internal/planner/            deterministic ingest, restore, and lifecycle plans
internal/operation/          journal reducers, leases, fencing tokens, reconciliation
internal/journal/            append-only durable operation log (states per core-protocol-and-reference-userland.md:285-316)
internal/rrf/                portable RRF records, roots, signatures, export
internal/identity/           content, representation, namespace, and snapshot IDs
internal/capture/            CaptureDriver host; the scanner becomes one profile behind it
internal/scanner/            existing deterministic scanner (kept; evidence source until capture hardening)
internal/identify/           host-owned Detector: suffix evidence + magic-byte evidence (ported from internal/plugin/builtin_detector)
internal/process/            Processor host: routes, staging, sealing, sandbox supervisor, result validation
internal/repository/         RepositoryDriver seam: contract types + engine adapters (kopia, later plakar/restic controls)
internal/readsvc/            existing stable read seam — SnapshotTree, FileAccess, adapter ports (unchanged)
internal/publication/        portable publication protocol (PAYLOAD / PREPARED_CLOSURE / PUBLICATION_COMMIT)
internal/namespace/          SnapshotTree implementation over the repository driver
internal/verification/       evidence validation and acceptance
internal/lifecycle/          retention, retirement, reachability, and gated GC plans
internal/indexfeed/          replayable authorized feed and IndexProvider coordination
internal/search/             bundled FTS5 IndexProvider + QueryProvider (one disposable DB per generation)
internal/query/              host query broker, generation pinning, result reauthorization
internal/annotations/        durable tag/note CRUD + portable export/import
internal/mcp/                local read-only MCP adapter (stdio) over the command dispatcher
internal/store/sqlite/       operational catalog (existing; leases, idempotency, annotations tables grow here)
internal/plugin/             LEGACY — frozen; retired at Milestone 0 (section 4.3)
spec/core/v1/                public command and event schemas (from core-protocol-and-reference-userland.md:522)
spec/rrf/v1/                 RRF schemas and canonicalization vectors
spec/extensions/             qualified external-process protocols
testdata/conformance/        cross-binding and clean-recovery fixtures
```

### 4.3 Relation to existing packages and the reference layout

| Proposed package | Replaces or maps to (core-protocol-and-reference-userland.md:496-526) | Relationship to current tree |
| --- | --- | --- |
| `internal/controller/` | `internal/command` + `internal/planner` + `internal/operation` coordination | New; owns the plan/apply job loop |
| `internal/identify/` | (new host-owned baseline stage) | **Ports** the suffix/magic logic out of `internal/plugin/builtin_detector.go`; suffix+magic are host-owned, so they must not live in a retiring plugin package |
| `internal/repository/` | `internal/repository` (Driver host) | New; the seam types plus the Kopia adapter and the read-adapter wiring into `internal/readsvc/ports.go:66-70` |
| `internal/search/` | `internal/indexfeed` + `internal/query` provider impls | New; FTS5 generation builder + query executor (adoption doc §7, lines 238-251) |
| `internal/mcp/` | `internal/binding/mcp` | New; stdio read-only adapter |
| `internal/annotations/` | (new) | New; durable whole-subject tag/note records with revision and tombstone provenance (core-kernel-and-interface.md:498-504) |
| `internal/scanner/` | `internal/capture` (eventually) | Kept as-is; remains non-authoritative evidence until retained-root capture is qualified (nas-vertical-slice-implementation-plan.md:18-21, 161-163) |
| `internal/readsvc/` | `internal/readsvc` | Unchanged; the stable read seam already implements the required contracts |
| `internal/store/sqlite/` | `internal/store/sqlite` | Unchanged; grows job-lease/idempotency usage and annotation tables |
| `internal/plugin/` | — | Retired (below) |

### 4.4 Retirement of the legacy `internal/plugin`

The legacy plugin prototype is not the implementation target: it exposes historical categories, mixes representation concerns, and predates the route, artifact, provenance, resource, and decoder contracts (nas-vertical-slice-implementation-plan.md:23-25). Retirement path (Milestone 0, nas-vertical-slice-implementation-plan.md:150-157):

1. **Freeze** — no new public behavior in its historical categories; no new callers.
2. **Port the evidence code** — `builtin_detector.go` (suffix/magic evidence) moves to `internal/identify` because suffix and magic stages are host-owned (system-architecture.md:232); the result is the same detector, owned by the kernel instead of a plugin.
3. **Delete once unreferenced** — after the milestone-0 exit condition ("the new internal model represents exactly the approved seams and Processor roles without importing legacy category or transformation enums") holds and no import of `internal/plugin` remains, delete the package. External execution is already disabled, so no ABI must be preserved (nas-vertical-slice-implementation-plan.md:25).

## 5. Concurrency and lifecycle model

### 5.1 One controller, one domain model

The reference deployment runs a long-lived local controller for scheduling, index feeds, and concurrent clients; the same core may also be composed in-process for offline recovery or single-command maintenance (core-protocol-and-reference-userland.md:145). The controller is the single writer of durable operations; adapters (CLI, MCP, later REST) only submit commands through `internal/command`, which enforces versioning, authorization, idempotency, and the closed registry (core-protocol-and-reference-userland.md:200-228).

### 5.2 Job leases, fencing, and idempotent transactions

The operation journal (core-protocol-and-reference-userland.md:285-316) is the state machine: `QUEUED -> RUNNING -> WAITING_EXTERNAL -> RECONCILING -> CANCELLING`, terminating in `SUCCEEDED`, `DEGRADED`, `BLOCKED`, `FAILED`, `CANCELLED`, or `UNKNOWN_EXTERNAL_OUTCOME`. The SQLite operational catalog already provides the two primitives this model needs:

- `Store.Idempotent` (`internal/store/sqlite/store.go:200`) records the callback's response in the same write transaction as the request, replaying identical requests and rejecting reuse with different input (`ErrIdempotencyConflict`). Every mutating command binds an idempotency key before the first external effect (core-protocol-and-reference-userland.md:227).
- `Tx.AcquireJobLease` (`internal/store/sqlite/records.go:697`) hands out a lease plus a fencing token per job row. Fencing covers staging allocation and seal, artifact admission, derivative-preference changes, and index-feed publication (driver-and-processor-interfaces.md:449): a stale worker whose fence has been replaced cannot seal or admit anything.

Crash semantics: the core never infers success from a missing response. If a driver cannot prove whether a placement, publication, or deletion committed, the job enters reconciliation and may terminate as `UNKNOWN_EXTERNAL_OUTCOME` (core-protocol-and-reference-userland.md:316). Reconciliation must be idempotent — this is exactly what the repository qualification spike tests (adoption doc lines 166).

### 5.3 The exact lane never waits for optional processing

Resource separation is normative (driver-and-processor-interfaces.md:445): optional processing is physically isolated from the exact and read paths, with reserved CPU, memory, file descriptors, and staging capacity for exact hashing, placement, browse, verification, and restore.

Consequences for the concurrency model:

- **Repository uploads do not block processors.** The mandatory exact lane (hash -> `RepositoryDriver` placement -> readback -> portable publication) runs as its own job path (system-architecture.md:250-254). Processor results are staged, sealed, host-digested, validated, and *admitted* independently; a processor that crashes, times out, or saturates its pool changes nothing about the exact lane (nas-vertical-slice-implementation-plan.md:181).
- Processor queues use per-capability concurrency ceilings, retry ceilings, crash-loop circuit breakers, automatic quarantine, and dead-lettered subjects; exhausting a processor pool must not exhaust the exact or interactive-read pool (driver-and-processor-interfaces.md:445).
- Index generation is built asynchronously from the replayable feed and activated atomically (adoption doc §7, lines 244-251); publication does not wait for it (system-architecture.md:261).

### 5.4 Recommended worker model for the MVP

| Worker | Runs in | Lifetime | Owns |
| --- | --- | --- | --- |
| Command dispatcher | controller process | long-lived | dispatch, authorization, idempotency |
| Journal reducers | controller process | long-lived | leases, fencing, reconciliation |
| Exact-lane workers | controller process (bounded pool) | job-scoped | hashing, placement, readback, publication |
| Processor supervisor | controller process | long-lived | spawns/recycles sandboxed children |
| Processor child | sandboxed process | one invocation (recycled after crash) | the single `RUN_STAGE`/`DECODE_REPRESENTATION` operation |
| Index builder | controller process | generation-scoped | replay feed -> disposable FTS5 DB |

## 6. Storage and layout

Two distinct storage domains exist, and their roles must not blur (system-architecture.md:168, 302; core-kernel-and-interface.md:149):

1. **SQLite operational catalog** (`internal/store/sqlite`) — workspaces, sources, scan generations, observations, detection evidence, plans, jobs, audit events, idempotency records, namespace roots/entries, representations, file versions, content extents, physical-locator projections, engine read refs (16 `STRICT` tables plus `schema_migrations` in `migrations.go`). It is a **rebuildable projection**: losing it must not make a committed exact snapshot undecodable. It is never the recovery authority.
2. **The repository** — the authoritative, content-addressed payload store plus the portable RRF records placed through the three canonical roles: `PAYLOAD`, `RECOVERY_CLOSURE/PREPARED_CLOSURE`, and `RECOVERY_CLOSURE/PUBLICATION_COMMIT` (system-architecture.md:300; core-protocol-and-reference-userland.md:353-361). A snapshot is logically published only after the publication-marker placement is reconciled (core-protocol-and-reference-userland.md:366-383).

Search state is a third, even more disposable domain:

- **One physically separate disposable FTS5 database per immutable `IndexGenerationRef`** (adoption doc §7, lines 238-251; nas-vertical-slice-implementation-plan.md:186-187). New generations are built beside the active one, validated, atomically activated, and the prior database retained only for bounded rollback. FTS row IDs, tokenizer tables, and query syntax are never durable ABI (adoption doc line 251; core-kernel-and-interface.md:108).
- Durable whole-subject tags and notes live **outside** index state, as versioned records with authorship, visibility, revision, and tombstone provenance, with portable export/import (core-kernel-and-interface.md:498-504). They enter the portable closure per policy and must survive deleting every index database.

Recovery truth: clean recovery begins from a valid publication marker, authenticates the bound prepared closure and payload placements, and ignores orphan payloads, local pointers, and uncommitted closures (system-architecture.md:302). Nothing in the SQLite catalog or the FTS databases may become required reading for recovery (CKI-AC-15, core-kernel-and-interface.md:634).

## 7. Borrowing and adoption map

This table maps every meaningful upstream into the seam it serves and the exact borrow point. "Borrow" follows the adoption-audit categories: planned direct dependency, isolated processor, qualification candidate, selective code borrowing, or design reference (adoption doc §2, lines 31-41). Per the audit, borrows preserve Cairn identity and recovery formats (adoption doc line 124).

| Upstream | Seam / package | Borrow point and role | License / status |
| --- | --- | --- | --- |
| **Kopia v0.23.1** | `internal/repository` (RepositoryDriver) | **Direct-dependency candidate**: Go repository APIs, object reads, storage abstractions, verification. Gate: the §4 qualification spike — root/GC safety, crash reconciliation, bounded/random reads, independent SHA-256 readback, catalog-independent recovery, corruption behavior, maintenance compatibility, NAS performance (adoption doc lines 159-175) | Apache-2.0; **qualification spike pending**; GHSA-2q4c-3mrw-63c3 affects versions through v0.22.3, hence the v0.23.1 floor |
| **Plakar** (`PlakarKorp/plakar`, Kloset + ptar) | `internal/repository` (RepositoryDriver) | **New Go-native control** added alongside Restic/Borg: Kloset chunking/verification design for dedup-profile comparison; verify-oriented recovery semantics as counterevidence; in-process library candidate against Kopia's library integration. ISC license permits in-process use after review, but it ships only if the same spike gates pass (identity-safe GC, crash reconciliation, bounded reads, catalog-independent recovery) | ISC; **qualification spike pending**; exact release pin + full dependency review are spike prerequisites |
| **Perkeep** | `internal/repository` test suite; `FileAccess` read path | **Selective code borrowing** (Apache-2.0): `pkg/blobserver` for small storage interfaces and adapter conformance-test patterns; `pkg/schema/filewriter.go` for chunk-tree construction; `pkg/schema/filereader.go` for range reads and reconstruction (adoption doc lines 114-126). Do not inherit SHA-224 defaults, object identity, or publication model | Apache-2.0; every borrowed fragment records source, commit, license, and independent tests (adoption doc line 126) |
| Restic v0.19.1 | `internal/repository` (control) | Control benchmark and possible subprocess driver; chunk-offset lookup, blob caching, concurrent offset reads as read-path patterns; issue #3828 as performance counterevidence (adoption doc lines 63, 138) | BSD-2-Clause; subprocess boundary |
| Borg 1.4.5 | `internal/repository` (auxiliary control) | Bounded local/SSH compression, maintenance, and mounted-read calibration; not the leading adapter (adoption doc line 64) | BSD-3-Clause; subprocess boundary |
| Watchman / zrepl | `internal/capture`, `internal/lifecycle` | Recrawl/overflow/poison-state concepts for lossy observation; ZFS snapshot lifecycle and holds as test patterns (adoption doc lines 140-141) | MIT; design reference only |

## 8. Decision records (ADR style)

### ADR-001: Repository engine — library integration preferred over subprocess; selection gated by the spike

- **Status:** Proposed; qualification spike pending.
- **Context:** `RepositoryDriver` must place, read, verify, reconcile, and restore admitted representations (driver-and-processor-interfaces.md:325-341). Kopia exposes Go repository APIs; Restic is a documented CLI; Borg is CLI-native; Plakar is a Go library with a verify-oriented design.
- **Decision:** Prefer **in-process library integration (Kopia)** so receipts, bounded reads, and reconciliation are typed Go calls under the host's control. Keep Restic as the subprocess control and Plakar as a second Go-native library control. **No engine enters the release binary until the spike passes** (adoption doc lines 159-175): root/GC safety for Cairn's portable objects is the first and most decision-changing gate.
- **Consequences:** If Kopia's snapshot-centric GC cannot root Cairn objects safely, Plakar becomes the in-process alternative and Restic the subprocess fallback. Library integration means `internal/repository` must pin the exact engine version and hide all engine types behind the seam; no Kopia/Plakar type may reach portable records.

- **2026-10-07 accounting clarification:** Keep optional physical telemetry
  separate from exact digest-and-length readback. Placement receipts explicitly
  distinguish measured exclusive whole-object bytes from unavailable values;
  absent state is unavailable, and lost-response reconciliation cannot substitute
  logical bytes for physical bytes. Shared packed chunks cannot enter the
  whole-file compression calculation, since chunk reuse, compression, and
  repository overhead cannot be separated from those lengths alone. Independent
  in-tree filesystem measurement remains a separate report boundary. This avoids
  claiming complete space savings from an unknown zero while preserving exact
  saving during unavailable diagnostics. It adds no signed field, storage layer,
  engine registration, or repository-selection credit; ADR-001 remains proposed.

### ADR-002: SQLite FTS5 plus bundled local zvec semantic search

- **Status:** Superseded and re-accepted by the 2026-08-19 core product contract. The earlier “semantic deferred” wording is no longer active.
- **Context:** Default discovery must cover path, filename, type, metadata, checksum, duplicates, tags/notes/descriptions, processing state, extracted text, and the bundled local semantic space. Exact ingest and recovery remain independent of every index, but a release without the real local semantic generation is degraded and does not satisfy the default experience.
- **Decision:** SQLite FTS5 remains the bundled lexical/structured `IndexProvider`/`QueryProvider`; the reference local semantic generation is in-process zvec v0.6.x through `zvec-go`, one disposable collection directory per immutable `IndexGenerationRef`, with schemas kept private. Qdrant/Milvus remain service profiles; alternate stores require measured conformance.
- **Consequences:** Deleting every index degrades search only; namespace access, tags/notes, exact reads, verification, and restore stay intact, and a new generation rebuilds from durable records (nas-vertical-slice-implementation-plan.md:191).

### ADR-003: Mounting is outside Cairn

- **Status:** Accepted (closed).
- **Context:** Kernel filesystems add platform, cache, revocation, privilege, and lifecycle obligations unrelated to the content/annotation/recovery plane.
- **Decision:** Cairn exposes `ExportManifest`, `SnapshotTree`, `FileAccess`, and restore operations only. It has no mount command, mount ABI, or kernel-filesystem dependency.
- **Consequences:** Operators may use external tools against a restored directory, materialized export, or separately authorized byte stream. Those tools do not become recovery authority.

### ADR-004: Retire the legacy `internal/plugin` prototype

- **Status:** Accepted (frozen; Milestone 0 work).
- **Context:** The prototype exposes historical categories, mixes representation concerns, and lacks the current route, artifact, provenance, resource, and decoder contracts; external execution is disabled (nas-vertical-slice-implementation-plan.md:23-25).
- **Decision:** Freeze the package, add no new behavior, port `builtin_detector` (suffix/magic evidence) into the host-owned `internal/identify` package, and delete the package once unreferenced. The new internal model must represent exactly the approved seams and Processor roles without importing legacy category or transformation enums (nas-vertical-slice-implementation-plan.md:150-157).
- **Consequences:** No legacy manifest or category enum leaks into plans, routes, or RRF. The milestone-0 exit condition is a hard gate before milestone 1.

### ADR-005: CLI command families are a frozen, closed set

- **Status:** Accepted (frozen).
- **Context:** The Core Command ABI is a stable semantic contract after qualification; the registry must not accept arbitrary SQL, shell execution, plugin invocation, prompt execution, or a generic `run_tool` (core-kernel-and-interface.md:269-290).
- **Decision:** The CLI exposes exactly the ABI families (`plan.*`, `status.get`, `job.*`, `snapshot.*`, `namespace.*`, `representation.*`, `content.*`, `search.query`, `recovery.export`, `capability.list`) with stable names, exit codes, and JSON/JSONL output. New families require an ABI version change. The command tree is closed; adapters share one dispatcher (core-protocol-and-reference-userland.md:225).
- **Consequences:** CLI, read-only MCP, and any later REST/WebUI adapter produce equivalent commands, authority checks, results, and events (CKI-AC-21, core-kernel-and-interface.md:641). The CLI framework choice (section 3.1) does not affect this contract.

### ADR-006: One physically separate SQLite database per index generation

- **Status:** Accepted (frozen).
- **Context:** Index generations must be buildable beside the active one, atomically activated, and deletable under ordinary derived-data retention without rewriting history (driver-and-processor-interfaces.md:422-426).
- **Decision:** Every `IndexGenerationRef` is backed by its own disposable FTS5 database created from the replayable authorized feed; validation covers record counts, known-query fixtures, subject resolution, stale-state reporting, and authorization before atomic activation; the prior database is retained for bounded rollback (adoption doc §7, lines 238-251).
- **Consequences:** FTS row IDs are never external identity; search-store schema stays a rebuildable implementation detail (core-kernel-and-interface.md:177).

### ADR-007: Processor control plane — protobuf + gRPC over Unix socket with FD passing and host sandboxing

- **Status:** Accepted as private plumbing; wire contract remains experimental.
- **Context:** Untrusted parsers and models must run isolated (system-architecture.md:354-365); large bytes must not travel inline in control messages (system-architecture.md:144).
- **Decision:** Protobuf schemas, grpc-go over a Unix-domain socket, pre-opened input/output file descriptors for large bytes, bubblewrap, namespaces, seccomp, `no_new_privs`, rlimits, cgroup v2, allowlisted environment, no network by default, attempt-fenced host-owned staging (adoption doc §6, lines 211-236; nas-vertical-slice-implementation-plan.md:175-176). The semantic contract stays typed operations, handles, result envelopes, and artifact state; the wire encoding is experimental until cross-version conformance (core-protocol-and-reference-userland.md:81-87).
- **Consequences:** The first processor is deliberately small (bounded text/metadata extraction) and proves the protocol without embedding a heavy runtime in the core (nas-vertical-slice-implementation-plan.md:179). Processor saturation cannot stop exact hashing, placement, browse, readback, verification, or restore (nas-vertical-slice-implementation-plan.md:181).

### ADR-008: One Notes presentation over provenance-preserving text records

- **Status:** Accepted (frozen; 2026-09-02).
- **Context:** People need one simple place to read the free-form context attached to a subject. The durable model also needs to distinguish a direct operator note from an imported, extracted, or model-produced description because their source, acceptance, revision history, semantic segments, and recovery evidence differ.
- **Decision:** The browser and ordinary user documentation expose one user-facing `Notes` surface. Each row may carry a small source, producer, acceptance, revision, or editability label. User-authored notes remain the direct editable note workflow; imported, extracted, and model-produced text remains attributable evidence unless an explicit user action creates a new user note. Keep `Annotation.NOTE` and `DescriptionDocument` as separate durable record types with their existing IDs, revisions, provenance, segments, and `description.*`/`note.*` command contracts. Never copy model text into `Annotation.NOTE` solely to make it appear in Notes. AI generation remains explicit and on-demand.
- **User-interface boundary:** There is no separate Description page, setting, search mode, or second presentation state machine. This decision changes presentation only; it does not rename schemas, merge records, or make a model result a user fact.
- **Consequences:** The daily workflow stays simple while source attribution, acceptance, immutable history, indexing, export, and catalog-free recovery remain intact. API and CLI clients can still use the typed record-specific commands when they need full provenance. New UI work must extend the single Notes projection rather than reintroduce parallel labels.
- **Rejected alternative:** Physically merging every text into one record or copying AI text into annotations would duplicate bodies and discard source/producer/acceptance semantics, making search and recovery less trustworthy. Showing two user-facing concepts would add complexity without adding capability.

### ADR-009: Storage schemes and derived index status

- **Status:** Accepted as a product direction. The read-only capacity report
  and per-dimension index-status projection are implemented and tested; the
  named multi-storage scheme and production repository selection remain
  deferred until the Phase 5 repository profile is qualified. This record does
  not authorize a new public storage schema by itself.
- **Context:** Operators need an easy way to choose where a new file is kept,
  understand which exact-saving rule applies, see available disk space, and
  tell which optional analyses have run. Treating location, repository engine,
  deduplication, compression, and every index as unrelated switches would make
  the small product harder to use and could imply unsafe cross-engine mixing.
- **Decision:** Model the future user-facing choice as one named **storage
  scheme** bundling location, `RepositoryDriver` profile, exact deduplication
  policy, and compression. A default scheme is selected for new ingest; an
  explicit ingest input may choose another configured scheme. The core
  identity remains SHA-256 plus logical length, and each scheme owns its own
  physical placements. Capacity is an optional capability report with total,
  free, measured-at, and unknown/error states; an unknown value does not block
  exact protection. Keep one SQLite catalog.
- **Decision (derived indexes):** Keyword/structured search is the baseline.
  BGE remains the local text semantic profile, but optional analysis never
  blocks exact saving. Future CLIP/SigLIP image and music-feature dimensions
  have separate models, spaces, and generations and may be fused only at the
  stable-subject result layer. Per-file “not tagged”, “not built”, “queued”,
  “unavailable”, and “not applicable” are calculated system status/filter
  values, not user `Annotation.TAG` rows.
- **Consequences:** The existing capacity card and per-dimension status view
  are read-only projections and add no database or second identity system. A
  future scheme picker affects new placements only; it never silently moves
  old data or falls back to another backend. Restic/Kopia/Plakar and media
  indexes stay qualification candidates until their respective gates pass.
  The short explanation is maintained in the [Cairn Wiki](../wiki/README.md).
- **Rejected alternative:** Exposing arbitrary engine/algorithm toggles or
  storing “unindexed” as a user tag would allow combinations that have not
  passed recovery tests and would mix transient system state with the user's
  organization.

### ADR-010: Flexible domain fields without a second store

- **Status:** Accepted as a product direction (2026-09-28). Ratifying the field
  registry entry shape belongs to the normative field-registry document; this
  record authorizes no schema by itself.
- **Context:** Adding fields per media domain and expressing many-to-many links
  currently implies a migration for every change, and the operator asked
  whether a document or NoSQL store would be the better answer. A second live
  metadata store would duplicate the logical layers the freeze forbids, become
  a reader dependency that breaks clean-install recovery, lose cross-store
  atomicity with the repository, and enlarge the backup, migration, and upgrade
  surface.
- **Decision:** Keep one SQLite catalog. Durable domain fields are declared,
  versioned, namespaced entries in the field registry, carried as a typed JSON
  payload, with generated columns for whatever is queried or indexed.
  Many-to-many links are relation rows, never JSON arrays, because a relation
  must be indexable, integrity-checkable, and includable in the recovery
  closure. Rebuildable derivatives may use free-form JSON but carry generation
  and producer labels. A reader that does not know a field reports unknown and
  never infers meaning from keys.
- **Consequences:** Adding a field stays cheap without a migration per field,
  and the field registry becomes the single place that declares meaning. The
  closure keeps reading durable facts with no plugin present. Undeclared fields
  degrade honestly instead of being guessed at.
- **Rejected alternative:** Adopting a NoSQL or document database, or storing
  many-to-many links as JSON arrays inside a subject row. Both trade
  verifiability for convenience: an external document store is a second live
  metadata database and a reader dependency, and JSON arrays cannot enforce
  integrity, cannot be indexed cleanly, and cannot enter the authenticated
  closure as first-class facts.

### ADR-011: One browser stack — borrow the design language, not the framework or the code

- **Status:** Accepted (2026-09-28).
- **Context:** The operator's dominant dissatisfaction is visual, and several
  Flutter music clients look considerably better than the current client.
  Namida is the strongest reference, but its licence is a EULA that forbids
  redistributing the program under another name or licence and its README
  states the project cannot currently be built directly. Musly is a Flutter
  Subsonic client with an Apple-Music-inspired interface whose licence is
  unverified.
- **Decision:** The product client stays React with Ant Design in `web/`.
  Borrow the visual language — artwork-derived dynamic colour, dense tiled
  grids, gesture navigation, a compact fixed settings header, and
  desktop-first proportions — not the framework and not the code. A later
  desktop shell for native feel is acceptable. The OpenSubsonic facade stays
  maintenance-only plumbing, and no player or reader ships inside the daemon.
- **User-interface boundary:** One stack. No second frontend framework is
  introduced, and no third-party player code or assets are vendored.
- **Consequences:** Verification, internationalization, and theming stay in one
  place, and the visual gap is closed by design work rather than by adopting a
  codebase that cannot be built or cannot be redistributed.
- **Rejected alternative:** Forking a Flutter player or adding a Flutter client.
  It would double the frontend surface, and neither leading candidate supports
  it: Namida's licence forbids it and it does not build, and Musly's licence is
  unverified.

### ADR-012: External media is a convenience reference and never enters the recovery closure

- **Status:** Accepted (2026-09-28).
- **Context:** The operator wants a track to switch to its music video while
  listening, including third-party streams such as Bilibili, and reads MV
  pairing as "a few links". Any third-party stream depends on networks,
  accounts, regional availability, and provider terms that the product does not
  control.
- **Decision:** A track carries a link to its video: one relation to a local
  video subject, or one external reference. A local video is an ordinary
  subject — protectable, verifiable, and restorable. An external reference is a
  convenience link only: not protected, not verifiable, not restorable, and
  never a recovery dependency. It renders as external and unprotected, and
  shows unavailable rather than substituting another source. The integration is
  the provider's official iframe embed inside an enabled view; scraping,
  downloading, caching, re-hosting, anti-leech or referer circumvention, and
  any credential requirement becoming a dependency are not permitted.
- **Presentation:** Audio and video share one player surface. Switching
  cross-fades into the video with the artwork reused as a blurred full-bleed
  background, so the change reads as one continuous surface rather than a new
  page, and the blurred artwork doubles as the placeholder while the embed
  loads.
- **Current interpretation (ADR-018):** This is a deferred product direction,
  not an implemented surface in the current scope. No audio/video playback,
  albums, playlists, external video references, or pairing behavior is shipped
  in the current preview. Any later local player must first define its
  bounded content-access, authorization, streaming, cancellation, and declared
  format contract and pass the applicable phase and release gates. This note
  clarifies priority without rewriting the 2026-09-28 decision record.
- **User-interface boundary:** The switch is a view-state transition over two
  sources — local through content access, external through the iframe. It adds
  no core command, and the only durable state is the link itself.
- **Consequences:** The honest recovery story is preserved while the experience
  remains possible, and the matching rules stay simple and testable: the video
  filename contains the music filename, or the track title plus first artist,
  or the track's video id in the comment tag or filename, with symbols and
  whitespace ignored before comparison.
- **Rejected alternative:** Downloading and caching the external video for
  smooth playback, as Namida does for YouTube. It would make an unverifiable,
  permanently changing third-party artefact part of the product's promise,
  which contradicts the recovery closure.

### ADR-013: Upload channel staging and the loopback token rule

- **Status:** Accepted (2026-09-28). This authorizes a file-reception endpoint
  only. It adds no policy, job, catalog, or recovery state machine.
- **Context:** The add-source flow can only scan a host directory, so a user
  holding a file in a browser has no way in. Cairn is a self-hosted
  open-source product, not a service, so there is no multi-tenant capacity to
  defend. A tokenless endpoint would nonetheless be reachable by any local
  process and, once the listener is exposed, from off-host.
- **Decision:** One `POST /api/v1/upload` on the existing loopback adapter. The
  product imposes no quota subsystem and no default size limit; a single
  optional limit exists, unset by default, and the operator sets one only if
  they want one. Files land in a daemon-managed staging directory under the
  data root, never inside a configured source tree and never directly in the
  repository. Names are sanitized and echoed back, and the response carries the
  computed SHA-256 and logical length so the browser can show identity before
  anything is ingested; nothing is parsed at upload time. The staged directory
  is offered back as a `plan.ingest` source root, so the ordinary review and
  digest-bound apply flow still decides protection. A token is required
  whenever `api.listen` is not loopback; on loopback the endpoint may run
  tokenless because loopback is already the trust boundary.
- **Consequences:** The browser gains a real way in without weakening the review
  gate. Staged bytes are visibly unprotected until a plan protects them, and the
  same endpoint is not reachable from off-host without a token.
- **Rejected alternative:** A product-owned quota scheme, or a tokenless
  endpoint regardless of listen address. The first burdens a self-hosted
  operator with accounting they did not ask for and gains no security; the
  second becomes remotely reachable the moment the operator exposes the
  listener.

### ADR-014: Adjacent products stay clients; durable state is not duplicated

- **Status:** Accepted (2026-09-28).
- **Context:** An adjacent on-device photo application has its own platform
  photo library, on-device models, and its own database schema. Its feature set
  overlaps Cairn's photo experience, and merging it into the core was
  considered.
- **Decision:** That product stays separate and may consume Cairn's
  typed API as a client. Its platform photo library, on-device model stack, and
  database schema are not merged into the Go core, and Cairn does not
  adopt a second durable metadata store to mirror them. Shared meaning travels
  through subjects, tags, the single Notes surface, relations, and export
  manifests — never by copying rows between products.
- **Consequences:** Each product keeps a single owner for its own durable facts,
  and the recovery closure never depends on an adjacent product's database.
  Integration stays optional and later.
- **Rejected alternative:** Merging the two. It would duplicate durable state,
  put platform photo and model stacks inside the storage core, and make
  clean-install recovery depend on an unrelated product's schema.

### ADR-015: Together-mode is a client capability over an external synchronisation service

- **Status:** Accepted (2026-09-28).
- **Context:** The operator wants listen-together and watch-together, and noted
  that the reference app integrates a synchronisation protocol plus a cloud-sync
  feature against a self-hosted server. Room, presence, and drift state are
  real-time and short-lived, which is unlike anything the core stores.
- **Decision:** Together-mode is a client capability. It coordinates playback
  position and drift through a user-deployed synchronisation service, and its
  room and presence state is ephemeral and client-side. The daemon gains no
  room, presence, or session state, and the core gains no command. It does not
  start before the music and MV work lands and the protocol and a self-hostable
  server are verified.
- **Consequences:** Real-time coordination cannot weaken or complicate the
  recovery core, and an operator who does not deploy the service simply does not
  see the feature.
- **Rejected alternative:** Putting room state in the daemon. It would add a
  durable real-time state machine to a product whose identity is verifiable
  storage and recovery, for a feature that stores nothing worth recovering.

### ADR-016: The WebUI snapshot is revalidated when its root changes

- **Status:** Accepted (2026-09-29).
- **Context:** `NewStaticHandler` read the whole web root into memory when the
  handler was constructed and served that copy forever. The snapshot was
  deliberate: it stopped a later filesystem replacement, including a symlink
  swap, from changing what the listener served. It also made a rebuilt WebUI
  invisible until the daemon restarted — the retired hashed assets kept
  answering 200 while the new ones returned 404. To an operator a successful
  build and an unchanged page are indistinguishable, so this silently froze
  every frontend change and repeatedly sent debugging in the wrong direction.
- **Decision:** Keep the validated snapshot and its reason, and give it a
  bounded lifetime. The handler stamps the root's immediate children — names,
  modification times, sizes, and entry types — and when the stamp changes it
  reassembles the snapshot through the same validation: every entry must be a
  regular file reached by a relative, non-symlink path. A root that fails
  revalidation is never served; the last validated snapshot stays in place.
- **Consequences:** A rebuild reaches the browser with no restart, and the
  failure mode of a broken or hostile replacement is the previous verified
  content rather than unverified bytes. The remaining exposure is a change
  landing between the stamp check and the read, which is narrower than the
  earlier guarantee that no replacement could ever take effect. The root here is
  a local loopback UI directory on a single-operator tool, and the practical
  gain is that the UI cannot silently freeze again.
- **Rejected alternative:** Serving the startup copy forever and documenting
  that a restart is required. It preserves the strictest reading of the old
  guarantee but cost real debugging time on every frontend change. Reading
  straight from disk on each request was also rejected: it drops the whole-tree
  validation and lets a half-written file reach a response.

### ADR-017: Content-first daily product and presentation views

- **Status:** Accepted (2026-10-05); informative product framing.
- **Context:** On 2026-10-05 the operator set the primary goal in this chat:
  readable files go in, familiar clues find them, and original files come out.
  Deduplication is an added benefit; usable, appealing daily access and adoption
  matter. The main agent decides and Luna executes. Earlier technical-center
  framing risked fragmented entry points and extra daily friction. The core
  remains a content, description, discovery, export, and recovery plane.
- **Decision:** Frame the product as a personal content access tool: put files
  in, find them through familiar clues, and take them out in original form.
  Organize the client as one content library with shared identity, tags, one
  Notes surface, search, and export, presented through task-oriented views
  (mixed-file All, Photos, Audio, Details, and management). Prioritize shared
  intake/find/export first, existing Photos/Audio presentation maintenance
  next, and optional original terminal styling with limited motion later.
  Interpret “anything” as readable files inside the declared capture scope;
  unknown formats can be preserved without promising arbitrary parsing,
  playback, URL capture, or application-state capture. Keep all normative MVP
  requirements and qualification gates, including real local BGE semantic
  search and recovery, intact. The user-provided Bilibili BV1fWYW6SEw6 informs
  visual inspiration only: [operator-supplied visual reference](https://www.bilibili.com/video/BV1fWYW6SEw6/)
  (optional author project: [RhineLabUI](https://github.com/LBEILC/RhineLabUI)).
  This records the supplied references, not a claim that they were viewed or
  that their code is adopted. Their popularity is not demand evidence; IP
  assets are not to be reproduced.
- **Reasons:** A single shared library keeps identity and daily actions coherent
  while allowing focused presentation. Task-oriented views reduce navigation
  fragmentation. Shared intake/find/export advances the central user loop;
  preservation and visible failure retain the trust contract. Original styling
  can improve appeal without delaying basic use.
- **Alternatives considered:** One page per requirement would fragment
  continuous tasks and duplicate navigation. A technical dashboard as the
  center would expose implementation status instead of content and add daily
  friction. A comprehensive media platform would add players, playlists,
  albums, maps, and service expectations outside the current lock. Building a
  complete 3D theme first would delay useful content access and add motion and
  accessibility risk before its value is validated.
- **Consequences:** Product pages follow continuous user tasks; common search,
  tags, Notes, and batch actions stay shared. Selected-in-version requirements
  need acceptance across their declared support scope; a mock or entry point
  is insufficient. Deferred features need not ship in the first version.
  Traffic, appeal, and retention remain hypotheses until real user feedback.
  The recorded brief is
  [Content-First Product Decision](content-first-product-decision.md).
- **Presentation refinement (2026-10-06):** The initial optional terminal-style
  priority is historical. The selected audience is one operator self-hosting
  for personal NAS use (ADR-018); official modules precede any runtime loader
  (ADR-019); whole-interface experiences can vary physical layout/navigation
  over shared flows (ADR-021), with color palettes as a secondary layer
  (ADR-020). The consolidated current priorities are in the
  [product decision](content-first-product-decision.md). This clarification
  does not unlock a player, domain schema, or core phase.
- **Implementation follow-through (2026-10-05):** New browser intake defaults
  to bounded file staging with explicit identity review and exact-save
  confirmation; existing server-folder review remains available. Single-file
  original download composes the existing scoped content-session contract
  into a native browser stream, keeping memory bounded and the output familiar.
  [Core Preview Acceptance](core-preview-acceptance-20261005.md) records the
  executable evidence and remaining qualification gates. These changes do not
  select a release repository or unlock LinkGroup implementation.
- **Revisit when:** Real user feedback shows the daily story or view boundaries
  fail, or a proposed feature has a concrete user workflow and passes the
  existing normative, phase, and implementation gates.
- **Authority and phase boundary:** This ADR is informative and subordinate to
  the documentation authority order and
  [Core MVP Execution Plan](core-mvp-execution-plan.md). This experience queue
  does not remove normative MVP scope, the default real BGE semantic profile,
  or Phase 4–7 gates. ADR-015 remains historical; together-mode is currently
  deferred by this priority overlay. This record creates no product surface,
  schema, API, signed format, phase order, or completion credit. Active
  phase: Phase 3 existing browser maintenance planning. Requirement: content
  store §2 content-first/no internal IDs and §13 user loop. Documentation exit
  check: valid relative links, unique ADR number, and `git diff --check`.

### ADR-018: NAS-first content-hub positioning and deferred media views

- **Status:** Accepted product positioning (2026-10-06); informative only. It
  creates no implementation authorization, API, schema, phase change, or
  completion credit.
- **Context:** The operator selected NAS and home-storage hobbyists as the
  first audience and the public proposition “a self-hosted home for your
  personal content.” The product should bring heterogeneous personal content
  together while preserving one shared identity, search, tags, Notes, access,
  export, and recovery path. This choice is user direction; adoption and market
  demand remain unverified.
- **Decision:** Keep Cairn as the working name and use the public
  descriptor **“A self-hosted home for your personal content”** with the
  Chinese slogan **“存进自己的空间，找得到、用得上、带得走”**. Position
  specialized gallery, audio, video, and document experiences as a future
  client direction over the same content authority. Unknown readable formats
  may be preserved without promising parsing or playback. Existing photo and
  audio controls are type filters only; the empty initial library does not show
  them. The current development preview provides bounded preview/download
  behavior, not audio/video playback, albums, or playlists. The separate
  [self-contained interactive design prototype](../prototypes/nas-content-hub/index.html)
  uses authored demo assets and has no production backend or content-library
  integration; its [README](../prototypes/nas-content-hub/README.md) explains
  its scope and local run instructions. It does not demonstrate a shipped
  product feature or qualification evidence.
- **Experience boundary:**
  - **Now:** shared intake, content identity, search, tags, one Notes surface,
    current type filters, scoped preview, exact protection, original download,
    export, and recovery.
  - **Next, after design and applicable gates:** a browsable photo gallery with
    dates derived from declared captured-time facts (with honest fallback),
    plus local audio/video play and seek for explicitly declared formats. Do
    not use a full-file browser Blob or imply arbitrary-format support.
  - **Later:** minimal LinkGroup and saved-view ergonomics only after Phase 4
    and Phase 5 close; cross-media organization reuses those shared subjects.
    Materialized exports may be the initial bridge to professional apps.
  - **Deferred:** face recognition, geocoding, transcoding, fetched music/video
    metadata, multi-account/cloud sync, external-stream caching, and TV-style
    catalogs until a concrete workflow is validated and the relevant contract
    is reviewed.
- **Playback preconditions:** A future player must reuse the existing scoped
  content access authority; bind reads to an authorized subject/version; define
  a bounded streaming and seek/range contract, cancellation and handle cleanup,
  integrity-failure behavior, safe media types, and supported browser/format
  tuples. The browser must not receive arbitrary host paths or a bearer token
  in a URL. Acceptance must exercise real declared-format samples through
  play, pause, seek, cancel, authorization failure, and integrity failure.
  These are planning criteria, not an API design or current implementation.
- **Name:** Cairn remains the working name and existing code/config
  identity. “Weave” is also used by an App Store application
  ([listing](https://apps.apple.com/us/app/weave-save-search-videos/id6801379247));
  this record makes no trademark-clearance claim.
- **Evidence and limits:** Qualitative public evidence is summarized in
  [NAS content-hub product direction](nas-content-hub-product-direction.md).
  It supplies analogies and individual needs/counterexamples, not market size,
  adoption, retention, payment intent, or a claim of ecosystem uniqueness.
- **Authority:** ADR-018 is subordinate to normative requirements and the
  [Core MVP Execution Plan](core-mvp-execution-plan.md). It does not change the
  Phase 3 lock, Phase 4/5 qualification, or Phase 6 dependency. In particular,
  it makes ADR-012's player and external-reference direction deferred under
  current priority, not delivered behavior.
- **Revisit when:** Representative NAS users validate the shared-library job
  and a reviewed access contract plus phase gates permit a concrete client
  implementation.

### ADR-019: Bundled vertical client modules before a runtime extension framework

- **Status:** Accepted as an informative architecture direction (2026-10-06).
  It creates no public ABI, module loader, service runtime, API, schema, package
  manager, security boundary, or implementation/phase authorization.
- **Context:** The NAS content-hub direction calls for focused photo, audio,
  video, and document experiences that share one library and its identity,
  search, tags, Notes, access, export, and recovery. Existing extension seams
  describe processors and providers; a client presentation contribution is a
  different concern. The current reference profile has one local operator,
  workspace, repository, and catalog.
- **Decision:** Build any first-party vertical UI as an official bundled module
  in the existing client, composed by the host shell and calling only existing
  typed operations and scoped access. Keep core authority, authorization, and
  generic fallback with the host. Do not introduce a dynamic third-party
  runtime or marketplace until independent implementations prove the seam
  stable and secure. Same-process modules are trusted application code, not
  sandboxes. A framework selection is deferred to a measured spike; Cordis or
  another registry is not adopted by analogy.
- **Rationale:** Bundling uses the existing browser stack and avoids a second
  loader, package trust root, dependency updater, and policy surface. Explicit
  cardinality and conflict rules avoid load-order behavior. Provider
  registration must be reversible, replacements explicit, dependents cleaned
  up, and failure visibly fall back to the generic content experience.
  Framework/service examples in the linked design note are analogies only:
  lifecycle boundaries and typed extension points do not imply auth, tenant
  isolation, or sandboxing.
- **Alternatives considered:** A dynamic Cordis-like service graph brings
  lifecycle and injection concepts but its upstream API is unstable and a
  service instance is not a security boundary. A Backstage-like typed registry
  offers useful slot/cardinality ideas but its configurable duplicate override
  behavior is not selected; Cairn rejects duplicates except explicit
  reviewed replacement. A VS Code-style contribution manifest is a useful
  declaration analogy, but workspace trust does not constrain malicious code.
  Isolated browser execution would add a separate security and compatibility
  project, not merely a plugin framework choice.
- **Consequences:** Official modules follow the WebUI's surface/flow/style
  ownership. A future contribution declaration needs stable namespaced IDs,
  compatibility and dependencies, required/optional host capabilities, slot
  cardinality, typed inputs/outputs, fallback, reversible registration,
  cancellation/disposal, version/replacement, and license/resource declarations.
  Any executable third-party package later requires the signed, content-addressed,
  least-privilege isolation and revocation controls already required by the
  plugin contract. This direction does not add a privileged media processor
  family or a new content authority.
- **Authorization and tenancy:** Modules do not simplify authorization. The
  host reauthorizes search results and access; an item hidden by one view is
  not access control. Multiple themes/modules do not change the present
  single-operator profile. Family, remote-user, and tenant support remain
  outside this decision; module boundaries do not claim those properties and
  do not substitute for a separately reviewed profile.
- **Revisit when:** A measured first-party module cannot be represented cleanly
  in the existing React client, or two independent implementations establish
  a stable seam and complete the required security qualification.
- **Authority:** Subordinate to plugin-system §§2/9, ecosystem requirements
  §§3/4/8, and the Core MVP Execution Plan. Phase 3 authorizes planning only;
  this ADR does not unlock players, domain readers, remote auth, or Phase 6.
  See [single-operator experience-pack design](single-operator-experience-pack-design.md).

### ADR-020: Curated color palettes as a presentation sublayer

- **Status:** Accepted as an informative client direction (2026-10-06). It
  authorizes no theme settings, schema, executable skin API, global CSS hook,
  storage, or design-system rewrite.
- **Context:** The existing client has one token and style system and benefits
  from readable status, failure, focus, and contrast treatment across its
  surfaces. A color palette can vary this treatment without defining the
  whole interface experience.
- **Decision:** Treat themes in this ADR as curated color palettes: a secondary
  presentation sublayer using semantic tokens. A palette does not select shell
  layout, navigation composition, content rendering, or interaction placement.
  Scoped styles and palettes are not security boundaries. Preserve the current
  client stack and token system rather than requiring a rewrite.
- **Rationale:** Central semantic tokens support consistent color and status
  readability without changing content or authorization behavior. Light,
  dark, contrast, keyboard focus, reduced motion, and failure states can be
  reviewed consistently. The DeepSeek Harness styling guide is an analogy for
  centralized tokens, not a framework or style-system adoption.
- **Alternatives considered:** Independent global CSS per vertical duplicates
  design semantics and risks cascade collisions. Unrestricted CSS is
  declarative, not JavaScript execution, but can affect unrelated presentation,
  hide or overlap controls, and load remote resources; scopes reduce accidental
  collisions without guaranteeing isolation. JavaScript themes are executable
  code and would add a distinct authority surface. Forking the design system
  would add migration work without evidence that the existing tokens are
  insufficient.
- **Consequences:** Any future palette contribution declares supported modes,
  falls back deterministically to an accessible built-in palette, and passes
  contrast, focus, reduced-motion, responsive, and error-state review. Palette
  selection is disposable browser presentation state, not operator config or
  a recovery record. Do not add a second settings database. Unknown palette
  values cannot change content, annotations, interface availability, or
  authorization.
- **Revisit when:** The current token system cannot express a selected palette
  or a client profile establishes different accessibility needs.
- **Authority:** This is Phase 3 client-planning guidance only. It does not
  change the core product boundary, module trust model, or phase gates. See
  [single-operator experience-pack design](single-operator-experience-pack-design.md).
- **Bounded implementation evidence:** The first browser-only palette and
  existing-lens visibility slice is recorded in the
  [2026-10-06 client acceptance](client-appearance-and-views-acceptance-20261006.md).
  It does not implement or qualify a whole-interface experience, public theme
  format, plugin runtime, or core phase.

### ADR-021: Replaceable bundled interface experiences over shared client flows

- **Status:** Accepted as an informative client direction (2026-10-06). It
  authorizes no public UI ABI, framework, durable setting, runtime installer,
  or third-party frontend loader.
- **Context:** The operator wants structurally different interfaces, not only
  multiple colors. The same content and operations should remain usable through
  more than one first-party shell composition while the current profile remains
  one local operator and one client authority.
- **Decision:** Define an interface experience as a complete bundled client
  presentation: shell layout, navigation composition, content rendering, and
  bounded interaction placement. The initial choices are the workspace and
  showcase experiences. They are first-party trusted React layouts composed
  over the existing shared client flows and typed operations. They preserve
  stable logical navigation destinations and operation semantics while
  allowing physical menu and action positions to vary under host review. Core
  identity, Notes records, search policy, authorization, and data semantics
  remain shared.
- **State and fallback:** Experience selection reuses the existing guarded,
  origin-local browser preference key `cairn.appearance`; it adds no
  durable database or server setting. Keep existing appearance and palette
  fields compatible. Missing, malformed, or unknown experience values resolve
  to `workspace`. A selection change must not remount the client state owner,
  reset active data, or discard shared in-flight flow state.
- **Rationale:** Bundled layouts can provide meaningfully different UI
  composition while calling the same reviewed client flows and host
  operations. This keeps the interface replaceable without creating a second
  policy, catalog, recovery state machine, or authority.
- **Alternatives considered:** More color palettes cannot change information
  architecture or interaction composition. Independent clients could drift in
  shared semantics and duplicate host flows. Runtime-installed frontend code
  would require a separate stable typed host contract, compatibility rules,
  trust root, and security qualification.
- **Compatibility and safety:** First-party layouts are trusted bundled
  application code, not sandboxes. Keyboard navigation, focus visibility,
  responsive behavior, readable failures, and graceful experience-level
  exceptions are acceptance requirements. On an unknown choice or render
  failure, return to the workspace experience without changing content or
  authorization. Do not freeze physical action positions where an approved
  experience needs another arrangement; preserve the logical destination and
  operation meaning.
- **Third-party boundary:** Any third-party frontend theme or experience needs
  a separately reviewed loader, stable typed host contract, trust and
  compatibility model, and security boundary. This ADR authorizes none of
  those mechanisms and makes no security claim for framework component
  boundaries.
- **Revisit when:** Host review of the bundled experiences finds that their
  shared flows, logical destinations, or fallback cannot be preserved, or a
  separately qualified third-party use case is proposed.
- **Authority:** Subordinate to `api-and-webui.md` §§2/6 and the Core MVP
  Execution Plan. This is bounded Phase 3 browser maintenance planning and
  grants no new product surface, phase credit, public UI ABI, or core
  implementation gate. See [single-operator experience-pack design](single-operator-experience-pack-design.md).

- **Bounded implementation evidence:** [The 2026-10-06 interface acceptance](client-interface-experiences-acceptance-20261006.md) records bundled layouts and shared-state retention. Its continuation tests injected rendering failures and a held App status read; a disposable held Notes save commits once. Child DOM state, all drawers, accessibility, and broad browser/platform acceptance remain unqualified. This supplies no runtime or phase credit.
- **2026-10-06 inspection refinement:** Existing image inspection may read up to 8 MiB after explicit selection, while automatic list thumbnails retain a 1 MiB ceiling and text retains 64 KiB. Read in host-bounded chunks, verify each range and the complete SHA-256/length before presentation, and close scoped handles on success, failure, or cancellation. The choice improves ordinary use of protected content while keeping automatic reads bounded. Larger originals remain available through download/export. This is maintenance of the existing inspector, not an album or player; see [current local acceptance](local-completion-acceptance-20261006.md).

### ADR-022: Whole-product acceptance across the shared content loop

- **Status:** Accepted as an informative delivery decision (2026-10-06).
  It changes no phase gate or current implementation lock.
- **Context:** The operator requested completion of the entire personal
  product. Passing bounded preview fixes has left the relationship between
  the current library, future media experiences, and self-deployment unclear.
- **Decision:** Maintain one [whole-product outcome matrix](whole-product-delivery-target.md)
  covering intake, discovery, organization, suitable first-party views, whole
  interface choices, exact takeout, and installation/recovery. Keep the overall
  objective open when one slice passes. Each selected outcome requires an
  ordinary complete user path and executable evidence for its declared scope.
  The core execution plan remains the sole implementation order.
- **Rationale:** Shared identity, Notes, tags, access, and recovery make the
  integrated personal tool useful across content types. A finite outcome map
  preserves that product goal while the implementation follows dependency
  gates. Local and isolated Linux evidence can advance the work without a
  physical NAS prerequisite; supported-release evidence keeps its required
  host and NAS-like-source boundary.
- **Tradeoffs:** Dedicated gallery/player/reader behavior waits for reviewed
  access, format and lifecycle contracts and applicable gates. First-party
  bundled experiences precede third-party execution. Single-person deployment
  keeps multi-user/tenancy work deferred. Representative usability and storage
  evidence remain required where generated local data cannot establish them.
- **Alternatives considered:** Declaring the product complete after each
  preview improvement loses unresolved user tasks. Implementing every vertical
  immediately would bypass recovery/storage/grouping contracts. Replacing the
  core plan with another implementation checklist would create conflicting
  authority.
- **Evidence rule:** Record implemented, tested, qualified, missing and deferred
  scope separately. A passing slice closes only its tested outcome; fixtures,
  skipped tests, layouts and candidate packages do not qualify a release.

### ADR-023: Daily capabilities before successive polish rounds

- **Status:** Accepted as an informative scheduling decision (2026-10-09).
  Media/archive admission proposals remain proposed; no phase gate changes.
- **Context:** The operator reports little visible core progress despite
  repeated small UI fixes and extensive verification. Source inspection finds
  daily saved retrieval hidden inside export, missing batch browser takeout,
  and photo/audio lenses without the expected vertical use.
- **Decision:** Prioritize named retrieval, batch original takeout, then narrow
  supported photo/audio use as specified in the
  [priority reset](product-priority-reset-20261009.md). Implement the existing
  SavedView convenience journey first; resolve the archive/media admission
  proposals during that slice. Keep one user outcome active, with Luna
  implementing and the primary agent deciding contracts and reviewing results.
- **Rationale:** Repeatedly finding and using retained content demonstrates the
  product promise. Existing tag/server-export flows should be reused, rather
  than reported again as new features. A type lens does not supply playback.
- **Tradeoffs:** Proposed capabilities cannot bypass the current lock. Release
  qualification remains required but is not the immediate local work queue.
  Small polish accompanies a capability; it does not get a separate iteration.
- **Evidence rule:** A saved query restores dynamic query semantics, not fixed
  membership. Native playback, archive delivery and LinkGroup are not reported
  implemented until their admitted contracts and user journeys pass. Necessary
  checks accompany each change; repeating unchanged suites is not progress.

### ADR-024: Complete domain experiences over one personal-content foundation

- **Status:** Accepted as an informative product-target decision (2026-10-09).
  Runtime, schema, media-index and phase-order revisions remain proposals.
- **Context:** The operator clarifies that dedicated photo and music
  applications should retain their useful specialist functions. A photo wall
  and single-track player describe early slices, not the intended final
  platform. The [official-source research and Opus consultation](../research/personal-content-platform-20261009.md)
  clarify that distinction.
- **Decision:** Target one single-person self-hosted personal-content platform
  with shared preservation, subject references, discovery, tags, one Notes,
  access, exact takeout and recovery. Photos and Music supply complete domain
  workflows. Curated photo albums and music artist/album navigation, a
  listening queue and reusable playlists are baseline target capabilities;
  richer processing and device use stay recorded in the later roadmap.
- **Rationale:** Familiar domain use fulfills the operator's “use it and take
  it out comfortably” promise. Shared foundations demonstrate their value
  through cross-domain discovery, organization, output and restoration.
- **Boundary:** Do not force albums, ordered duplicate-capable playlists,
  temporary queues, dynamic SavedViews, minimal LinkGroups and frozen
  ExportManifests into one generic collection. Human curation and durable facts
  require preservation; indexes and recreatable renditions remain projections.
  All later contracts retain exact identity/protection and one catalog/repository.
- **Tradeoffs:** The target exceeds the current media exclusion and grouping
  lock. Explicitly reconcile normative scope and implementation order before
  feature code. Review first-party experience admission separately from release
  qualification, without silently bypassing dependencies. Bundled modules
  precede runtime extensions; complete interface choice precedes palette emphasis.
- **Evidence rule:** Feature documentation and model advice do not validate
  demand or usability. Demonstrate each ordinary supported workflow, report
  partial slices as partial, and do not claim release or phase completion.
  ADR-023 continues to govern the admitted immediate queue; this ADR corrects
  its narrow media slices as a definition of the final product.

### ADR-025: Admit dedicated personal client workflows without a new media service

- **Status:** Accepted 2026-10-09. Normative admission is
  [RW-PERSONAL-UX-1](../requirements/first-party-client-experiences.md), reflected
  in the MVP/operator, product, content-store, API, kernel and execution-plan
  contracts and AGENTS. This ADR explains that admission; it grants no separate
  core-phase or release credit.
- **Context:** The operator accepted the complete personal-platform target,
  asked for multiple Luna implementers, and prioritized usable local Photos and
  Music over further platform qualification. The old blanket player exclusion
  prevented a visible daily-use workflow despite existing verified-original
  reads. A generic file list was also still presented as the specialist page.
- **Decision:** Run one bounded client delivery cohort in parallel with the
  existing Phase 4/5 gates. Supply a dedicated photo wall and continuous
  inspector, a dedicated track list and App-owned bounded audio player with
  an explicit transient queue, and named retrieval outside Export. Three Luna
  implementers own disjoint components; the primary agent owns admission,
  shared wiring and integrated acceptance. Use the existing typed dispatcher,
  authorization, Notes/tags, SavedView and exact-original download routes.
- **Rationale:** Users can browse images, listen to retained audio and return
  to named content through the shared foundation immediately. Playback does
  not need a media-server policy or persistent listening catalog to demonstrate
  the product's daily loop. Local Mac/browser evidence is sufficient for this
  declared client slice and does not require Linux or physical NAS qualification.
- **Limits and tradeoffs:** Automatic thumbnails retain 1 MiB, explicit image
  inspection 8 MiB, and original audio 32 MiB. Audio is fully downloaded and
  SHA-256/length checked before native browser decoding, with one active read
  and Blob, cancellation, visible failure and original takeout fallback. Larger
  files and unsupported formats remain limited. Temporary queue changes survive
  client navigation, but refresh/workspace change clears them; they are not
  durable playlists. Album/artist navigation, curated albums, reusable playlists,
  metadata/artwork and ordinary-large-photo renditions remain full-domain work.
- **Migration and recovery:** No durable schema, public command, provider digest,
  signed format or recovery successor changes. Client previews, controls and
  queue are presentation state. Exact identity, STORE_EXACT and recovery authority
  remain host-owned. Future durable domain contracts must address migration and
  authenticated retention before their implementation.
- **Alternatives considered:** Keeping all players deferred blocks the accepted
  local-use direction; introducing streaming/transcoding or a separate media
  database adds an unnecessary service boundary. Treating every domain concept
  as a generic collection conflates temporary queues, ordered playlists,
  curated albums and dynamic queries. Replacing the core gates would overstate
  readiness and lose preservation semantics.
- **Evidence rule:** Build and focused byte/lifecycle checks establish only their
  scope. Browser actions establish only the exercised supported journey. Generated
  samples do not establish real-library usefulness, metadata coverage or a
  qualified product. Keep the full-domain todo open.

### ADR-026: Open-ended bundled experiences with one host authority

- **Status:** Accepted as an informative architecture decision (2026-10-09).
  It records the UX-E2/M2 client admission; it does not grant core-phase,
  release, runtime-extension or public-SDK status.
- **Context:** The operator wants an open-ended ceiling for complete content
  experiences, playful presentations and whole-interface choices while the
  ordinary default stays simple. The existing local client is beginning that
  work with compiled pages, an exhibition presentation and transient music
  queue controls.
- **Decision:** Add independent compile-time registries for namespaced first-
  party pages and bundled shells. Reject duplicate IDs, routes, renderer slots
  and host-reserved routes before exposing a registration. Keep the `photos`
  and `music` routes compatible and add the exhibition as another Photos
  presentation. Existing host hooks retain selection, focus, Notes and the
  single player across same-context presentation changes. An immersive shell
  may rearrange or collapse chrome; search, navigation, Details, standard
  actions and active-player controls remain reachable. Every action need not
  stay visibly onscreen. A theme may replace the full shell, layout and
  behavior; palette remains a secondary choice.
- **Authority and trust boundary:** Compiled first-party components are trusted
  same-process code, not security-isolated plugins. The host retains exact
  identity, repository and SQLite catalog, authorization, recovery,
  transactions, Notes, original takeout, network access and the one player
  instance. Pages compose existing loaded-content and typed-operation context;
  they do not create a second authority. This slice does not claim an installer,
  marketplace, stable extension ABI or protection from malicious JavaScript.
  Consider repository-local workspace packages and locally trusted build-time
  additions before separately reviewing runtime iframe isolation or external
  processor packages. Do not adopt Cordis solely to manage the current small
  compiled registry set. An admitted successor that keeps this ladder but extends
  its first step is recorded in ADR-032 below.
- **Music and queue boundary:** Artist and album browsing may use only real
  facts already returned by the existing `audio.list` projection; absent facts
  retain filename presentation. The client may play the currently loaded
  supported set and offer transient reorder, one-shot “Shuffle upcoming”, and
  repeat off/all/one. Repeat-one applies to natural completion; manual Next
  still advances. Keep the active queue item until playback is stopped before
  allowing its removal; never silently skip it during reordering. Do not put
  internal subject references in URLs in this slice. Albums, playlists,
  artwork and new processors remain separate successors requiring their own
  reviewed fact, persistence and recovery contracts.
- **Rationale and tradeoffs:** Independent compiled registries let another
  first-party page or shell arrive without another host routing branch, while
  one shared state authority keeps identity, actions and playback coherent.
  The simple default remains available as the ordinary shell. A full visual
  extension ecosystem, runtime loading and true isolation would add contracts
  and security claims unsupported by the current product. Open-endedness means
  new reviewed experiences can be added; it does not promise every file format
  or unlimited resource use.
- **Alternatives considered:** Keeping pages and shells as host switches makes
  each new presentation a core edit. A generic runtime marketplace or early
  SDK would freeze a wider trust/API boundary before bundled experiences prove
  it. Cordis adds a separate lifecycle and dependency-injection system without
  solving a current user task. Reusing LinkGroup or SavedView for albums and
  playlists would conflate their distinct durable meanings.
- **Consultation and evidence boundary:** The operator requested a detailed
  review through `openainext / claude-opus-5-5`; two successful turns are
  retained under `dist/open-ended-platform-20261009/` (`initial-response.md`,
  `followup-response.md`, their result/event files and prompts). Session:
  `session-5d7ad39e-5d7d-42b9-b721-1850f28d1d7e`. The consultation informed
  options but is not authority or acceptance evidence. Its lifecycle reference
  was [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md).
  Current executable evidence remains limited to the declared local client
  slice; this ADR awards no phase or release credit.

### ADR-027: Frozen original ZIP takeout and transient ordinary-photo renditions

- **Status:** Accepted for the separately admitted UX-T1/P2 local client
  development profile, 2026-10-09. The normative limits and exits are in
  [First-Party Personal Client Experiences](../requirements/first-party-client-experiences.md#8-ux-t1-bounded-original-zip-takeout).
- **Problem:** The dedicated pages still leave two daily tasks incomplete:
  taking selected originals away in one browser download, and recognizing
  ordinary photos larger than the original 1 MiB thumbnail ceiling.
- **Decision:** Freeze selected stable subjects with the existing `export.plan`.
  Decode its already returned JSON item summaries, match their legacy entry
  references and exact identities to the captured selection, then verify
  authorized original reads before constructing a single STORE ZIP using the
  frozen output names. Keep all progress/cancellation in the host. Refuse
  unknown identities/lengths and exceedance of 32 files, 32 MiB per file or
  64 MiB total. The browser reports prepared/requested, never disk-save or a
  server `export.verify` receipt. Large takeout retains server-directory export
  and native single-file downloads.
- **Photo decision:** Preserve the original 1 MiB thumbnail and 8 MiB inspector
  meanings. Add a distinct visible-card PNG/JPEG rendition path up to 8 MiB,
  with predecode dimensions (12 million pixels, 8192 per edge), two transfers,
  one decoder, 1024-edge output and a 48-item/24 MiB small-rendition cache.
  Complete exact identity verification precedes decoding. Keep derivatives
  transient; native orientation is presentation, not a recorded fact.
- **Why:** Existing manifest item strings already contain the frozen identity,
  length, output name and entry reference. Reusing them avoids a competing
  client membership/naming authority or backend contract. A bounded transient
  thumbnail serves recognizable daily browsing without a new processor or
  signed-artifact migration. The enforced ceilings support a reviewable first
  implementation; they do not prove browser memory or universal photo coverage.
- **Alternatives and costs:** Directly zipping current rows loses authoritative
  manifest freezing and server collision decisions. Raising the old thumbnail
  limit multiplies its original-Blob cache and decoder concurrency. A streaming
  archive endpoint and retained photo derivatives may later support larger
  libraries but need separately reviewed resource, authorization, processor
  and recovery contracts. Persistent albums/playlists and runtime extensions
  remain independent successors. This ADR grants no phase or release credit.

### ADR-028: Domain presentations and fixed-template composition

- **Status:** Informative architecture decision for the admitted UX-C1 client
  successor, 2026-10-09. The normative boundary is
  [First-Party Personal Client Experiences §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope).
  This ADR adds no backend operation, durable format, phase credit or browser
  acceptance.
- **Problem:** Treating every renderer as a top-level page confuses a domain
  with its presentation, fragments navigation and invites duplicate query or
  selection state. A free-form home canvas would add layout persistence and
  resource coordination before the shared scope and contribution seam are
  proven.
- **Decision:** Group compiled presentations under one domain destination.
  A presentation names a registered root page and must match its loaded
  context and media class; missing roots, chains/cycles and incompatible
  registrations fail closed. Preserve existing IDs/routes and local disabled
  IDs. Render the current returned search/tag scope without requerying on a
  presentation switch; retain its conditions and relevance order, disclose
  returned-result counts and keep all-types access. Supplementary loaded-row
  data joins only through an exact current workspace/namespace, subject, entry
  and canonical content-identity tuple. Unknowns stay unknown. Existing
  `audio.list` artist/album facts may power Music browsing; this does not admit
  new extraction, metadata authority, artwork or durable membership.
- **Composition boundary:** A later slice may compose read-only scope selectors
  and narrow host actions into fixed templates. All blocks share host-owned
  query/selection/player state and global resource budgets. Independent task
  pages, domain presentations and whole-interface shells remain separate
  roles. No canvas, public component SDK, runtime installer or third-party
  isolation is selected.
- **Migration and acceptance:** Normalize legacy routes without dropping
  existing query/tag hashes or internalizing subject IDs. Keep the existing
  known disabled-ID preferences unchanged and make route fallback visible.
  Retention of unknown IDs is a future migration decision, not a newly
  implemented preference guarantee; the current effective reader filters
  IDs absent from the registry. Executable acceptance covers route compatibility,
  query retention without a second request, honest returned-result facets and
  empty states, safe identity joins, held same-domain work, and registration
  and preference migration. Aggregate-block budgets need their own browser
  evidence when implemented. Current implementation status remains with the
  product todo and current browser acceptance; this ADR does not upgrade it.
- **Consultation:** Two successful `openainext / claude-opus-5-5` turns are
  retained under `dist/page-presentation-composition-20261009/`, session
  `session-363890e3-14fd-4cd9-8aeb-83f7bd2428e0` (exit 0, no tool events).
  The distinction among domains, presentations, independent task pages,
  aggregate blocks and shells, plus one shared scope/resource budget, informed
  this decision. The suggestion to strip existing query hashes and the
  suggested pinned-page cap were not adopted. Consultation is advisory, not
  evidence that external media was viewed or adopted. See the detailed
  [domain-presentation composition proposal](domain-presentations-and-composition-20261009.md).

### ADR-029: One fixed overview before a general composition framework

- **Status:** Admitted client UX-C2 development design, 2026-10-09; normative
  scope is [First-Party Personal Client Experiences §11](../requirements/first-party-client-experiences.md#11-ux-c2-fixed-mixed-content-overview).
  No backend operation, durable record or core-phase completion is admitted.
  The bounded Overview is implemented with [local acceptance](fixed-overview-acceptance-20261009.md);
  durable media organization remains proposed.
- **Problem:** Separate domain views are useful, but the personal product also
  needs one place to find and use mixed content. Starting with a layout editor
  or runtime component SDK would add configuration, lifecycle and resource
  ownership before proving this ordinary browsing workflow.
- **Decision:** Register one compiled all-types Overview layout separately from
  media-domain navigation. Fixed Photos, Music and Other sections project one
  current host scope, preserve its order, disclose total versus displayed
  counts and pass original row indices to selection actions. Each section
  previews at most six items. Thumbnails use the existing shared verified-read
  pipeline/cache; audio actions use the existing eligibility rules and global
  player. Disabled domain presentations remain disabled in the overview.
  Browse actions resolve an enabled registered presentation rather than
  hard-coding a wall that the user may have disabled.
- **Why:** This adds a useful cross-content workflow and demonstrates the
  future contribution seam with real host actions and budgets. It avoids
  parallel searches, another player and per-block byte-read caches. General
  templates, user layouts and runtime loading can be evaluated from this
  working baseline rather than introduced as an unused framework.
- **Compatibility:** Existing IDs and disabled-ID meanings stay unchanged;
  Overview is a new admitted bundled layout, enabled unless explicitly
  disabled. Old links still resolve. Incoming composed hashes are held through
  asynchronous restoration, and only the corresponding fallback warning is
  cleared when a valid user destination succeeds. All types remains reachable.
- **Durable media organization:** The independent
  [album/playlist candidate design](durable-media-organization-design.md)
  selects review candidates for album sets, playlist occurrences, concurrency
  and portable state. It is proposed, not implemented or admitted for writes.
  The signed reader currently lacks those record kinds; hiding membership in
  tags/Notes/browser storage would not deliver recoverable organization.
  LinkGroup and its Phase 4/5 dependencies retain their separate meaning.
- **Exit:** Actual mixed-scope overview -> selection/Details -> verified audio
  -> preference-aware domain and back without requery; bounded mounted photos,
  one player, composed loading link and useful narrow-screen controls.
  Browser evidence, not this ADR, awards implementation credit. Full product,
  durable albums/playlists and runtime plugins remain unfinished.

### ADR-030: Shared favorite shortcuts before durable media membership

- **Status:** Implemented local client slice under admitted UX-F1, 2026-10-09;
  normative scope is [First-Party Personal Client Experiences §12](../requirements/first-party-client-experiences.md#12-ux-f1-shared-favorites-through-existing-user-tags).
  The [local acceptance](shared-favorites-acceptance-20261009.md) records the
  observed cases and open exit evidence. No album/playlist schema, new portable
  record or core-phase credit is admitted.
- **Problem:** Users cannot quickly mark and revisit a photo or track from its
  dedicated interface. Durable albums/playlists still require reviewed typed
  membership, signed portable state and export successors; adding only tables
  or hiding membership in Notes would leave an incomplete recovery contract.
- **Decision:** Provide explicit star/unstar controls and a shared favorites
  filter through the ordinary visible `Favorite` TAG. Keep the stored value
  invariant across languages, use existing revision-checked annotation commands,
  and reread before displaying a confirmed result. Remove only that subject's
  exact matching TAG records; preserve unrelated facts. Unknown reads disable
  editing and never establish an empty collection or an unmarked coverage state.
  Same-workspace refresh retains the viewer and player; the last filtered
  favorite can disappear without broadening the retained filter.
- **Why:** This completes a useful durable-catalog organization workflow using
  an already admitted user taxonomy. One host controller serves Photos, its
  viewer, Music and Overview; each presentation adds no parallel membership
  store, annotation reader, player or byte-read authority. It gives users a
  quick action while the distinct richer membership contracts are reviewed.
- **Limits:** A favorite TAG is not an album or ordered playlist. Annotation
  writes use the existing catalog/publication lifecycle and do not guarantee
  a new signed portable backup at each click. A tag renamed away from `Favorite`
  ceases to match the shortcut; normal tag editing remains authoritative.
- **Next durable step:** The [implementability review](durable-media-organization-design.md#implementability-review--2026-10-09)
  records workspace resolution, snapshot-local export v1, repeated-occurrence
  and portable-kind gaps. Review organization/export successors before a
  separate durable admission, then implement playlist and album vertical flows.
  This does not unlock LinkGroup or change the Phase 4/5 prerequisites.

### ADR-031: Occurrence-aware transient listening and Music batch actions

- **Status:** Admitted UX-Q1 local client implementation, 2026-10-09; normative
  scope is [First-Party Personal Client Experiences §13](../requirements/first-party-client-experiences.md#13-ux-q1-occurrence-aware-listening-and-batch-queue-actions).
  The [local acceptance](occurrence-queue-acceptance-20261009.md) is pending
  completion of the integrated browser journey; helper/build evidence alone
  does not establish the full exit.
- **Problem:** Single-track actions and displayed-set playback leave a normal
  listening loop awkward: append selected/displayed tracks without interrupting
  playback, play the selected visible subset, then open and edit the same queue.
- **Decision:** Music derives ordered playable tracks from the currently shown
  rows and intersects host selection with that same subset. Add actions append
  distinct transient occurrences without autoplay; Play selected replaces the
  queue and starts only the displayed supported selection. Unsupported or
  unavailable visible tracks and selections outside the displayed subset are
  counted honestly. A direct Listening queue action opens the one App-owned
  editor from every Music browsing mode. Duplicate files remain allowed queue
  occurrences; selection, Details, favorites and query state remain shared.
- **Authority and limits:** One existing App-owned queue/player remains the
  only listening state. It stays transient, clears on refresh/workspace change,
  and is bounded to 1,000 entries. This admits no saved playlist, catalog
  schema, endpoint, recovery record or durable membership.
- **Why not a preserved playlist file:** An exact-preserved JSON snapshot can
  be portable content, but current subject continuity is keyed by workspace,
  source, path and type; the upload inbox stages a new root. Neither provides
  an editable stable playlist identity or an atomic current-head/CAS protocol.
  Filename discovery and document revision conventions would create another
  hidden authority. See the [media organization implementability review](durable-media-organization-design.md#implementability-review--2026-10-09).
  Such a file may be a user-managed snapshot, not this native queue or a saved
  playlist. Durable playlists remain behind independent organization,
  publication/recovery and export review and admission; LinkGroup Phase 4/5
  gates remain unchanged.
- **Exit:** Verify append without autoplay, open queue, distinguish repeated
  occurrences through manual Next/reorder/removal, batch append selected and
  displayed tracks without hidden-selection leakage, preserve playback through
  navigation, and visibly refuse overflow/omissions without queue mutation.
  The acceptance record must identify passed and still-open browser cases.

### ADR-032: Presentation-plane extensions with a closed recovery plane

- **Status:** Admitted 2026-10-10 by the operator as an informative architecture
  decision, which also authorized the two guardrail edits below. It adds no code,
  schema, phase credit or acceptance on its own: Stage 2 still has to earn its
  exit. It narrows two earlier statements (ADR-026's Cordis note and the
  Convergence Phase sentence in `AGENTS.md`), both of which are updated to match.
- **Problem:** The operator wants interface appearance to be extensible, so that
  presentation work — a theme, a whole-shell arrangement, a new way to browse
  already-loaded content — can improve without waiting for a first-party release
  each time. ADR-026 kept the seam compile-time and deferred runtime extension,
  which leaves the ceiling at one first-party release per interface.
- **Reference studied:** the working plugin system in the DeepSeek Harness
  installation on this machine, read from the live install rather than from any
  description of it. Its mechanisms: plugins are ordinary version-pinned packages;
  the extension "ABI" is declarative manifest metadata rather than a code
  contract; composition is layered declarative patches with the root entry list
  empty; the host and client halves are separate declared entries; the marketplace
  is itself a plugin and consults a compatibility file before offering anything;
  and policy plugins exist to guard other plugins. Its safety comes from bounded,
  declarative composition — a package adds a row to a composition tree — not from
  trusting plugin authors.
- **Decision (proposed):** Extend the presentation plane only, borrowing that
  shape but not its framework:
  1. A presentation extension is a **versioned package** that declares itself in a
     manifest — an id, the host range it supports, and which render slots or
     palettes it fills — and ships its own declarative composition file. It does
     not ship a free-form script that registers itself at runtime.
  2. The host **admits or refuses it whole**: host-version range, declared slots,
     and duplicate-id rejection against the existing registry rules. A refusal
     applies nothing; there is no partial composition.
  3. Composition stays **layered and declarative**: built-in interfaces, then
     installed presentation packages, then the operator's own overrides.
  4. An extension reaches **only** the presentation seam that already exists — the
     `shell.cairn.*` slots, the interface catalog, palettes, and read-only access
     to already-loaded content.
  5. **Stage 2 composes at build or install time, not at runtime.** The package
     contributes a declaration and its assets, and the local build incorporates
     them. The running application executes no third-party code, which is exactly
     why this stage needs no iframe isolation: there is nothing to isolate. A
     runtime loader is a Stage 3 concern, not this one.
- **Hard boundary — the recovery plane stays closed.** A presentation extension
  must never be able to influence exact identity or any digest, register a
  processor or representation, read or write the repository, catalog, recovery
  records or trust anchors, alter an export manifest or a materialized output,
  open network access, or change what a verification reports. This is not a policy
  preference: verifiable recovery is the product's reason to exist, and the
  operator has declared this line non-negotiable. Enforce it **structurally** — a
  client-side seam with no host authority — rather than by review discipline
  alone.
- **Why not untrusted runtime code yet:** ADR-026 explicitly claims no protection
  from malicious JavaScript. A runtime loader for untrusted code without iframe
  isolation would *lower* the present trust posture rather than extend it. That
  step stays separately reviewed, and this ADR does not authorize it.
- **Explicitly not adopted:** Cordis, or any general dependency-injection
  container, as the host framework. ADR-026's reasoning still holds — the registry
  set is small and the composition problem here is a list of presentation slots,
  not a service graph. The *shape* is borrowed: pinned package, declarative
  manifest, layered patch, compatibility gate. The framework and the runtime are
  not.
- **Staged ladder and exits:**
  - **Stage 1 — in-repo compiled.** Today's state. Exit: several first-party
    interfaces and palettes exist and they prove the seam.
  - **Stage 2 — locally trusted presentation packages.** The subject of this ADR.
    Exit: install a presentation package and see it applied; change its declared
    host range and see it refused whole, with no partial application; then run the
    recovery and export acceptance unchanged and show no behavioural difference.
  - **Stage 3 — untrusted third-party code.** Requires iframe isolation, an
    admission and signing story, and its own reviewed decision. Not authorized.
- **Consequences:** Presentation extensions can change only how already-loaded
  content is presented. They cannot improve or alter discovery, recovery or
  export. Community aesthetics become possible without anything entering the
  digest path. The client gains an admission step and a compatibility check that
  it does not have today.
- **Guardrail edits made on admission:** ADR-026's "do not adopt Cordis" note
  carries a forward pointer here, and the Convergence Phase sentence in
  `AGENTS.md` was narrowed to keep untrusted runtime third-party code, a general
  extension ABI for the kernel and any plugin store out of scope while admitting
  this presentation-plane case. That sentence is a guardrail, so it was edited
  only after the operator's explicit approval; the rest of this ADR authorizes no
  other guardrail change.

### ADR-033: One publication, many content-addressed record parts

- **Status:** Admitted 2026-10-11 by the operator as the convergence-phase fix
  for the measured per-publication entry ceiling. It changes the signed portable
  record shape, so it also carries the required product-requirement revision and
  the reader-dependency analysis in this section. The implementation and its
  executable evidence live in `server/internal/exact` and
  `server/internal/repository`; this ADR does not raise `MaxRecordBytes`, add a
  record role family beyond the part role below, or authorize any new surface.
- **Problem:** one publication is one complete snapshot of one source root. Its
  signed `PREPARED_CLOSURE` record embeds the whole `Manifest`, and its signed
  `PORTABLE_FACT_CLOSURE` child embeds the whole canonical portable-fact bundle.
  Both are single JSON values whose size grows with the entry count — measured
  on a real 11,561-image tree at about 22 KB per entry, dominated by per-file
  facts rather than payload — and both are placed as one record under
  `repository.MaxRecordBytes` (`16 MiB`). A root above roughly 700–800 entries
  therefore could not be published at all: `plan.ingest` projects the two
  entry-scaling records and refuses before any durable write, and placement
  refuses as defence in depth. Raising the cap only moves the wall; the cost is
  per entry, so a million entries would be tens of gigabytes of records.
- **Rejected alternative — bounded instalments.** A bounded-instalment feature
  was implemented and mechanically verified, then deliberately reverted. An
  instalment is a separate publication with its own namespace root, and the
  operational projection takes the latest root per source. Draining a real
  11,561-file folder therefore made the client and the index show only the last
  instalment: the newest lexical generation indexed 152 of 888 published
  entries. A rigorous analysis proved that distinguishing "complete snapshot"
  from "partial instalment" cannot be derived from the recovery authority
  (repository objects plus authenticated portable records) and would require
  writing that fact into a signed record. That is a larger and more dangerous
  change than making one record placeable in pieces, and it would have changed
  the projection. **Decision:** keep one publication = one complete snapshot =
  one namespace root, and make one logical record placeable as several
  independently verifiable parts.
- **Chosen successor.** A logical portable record whose canonical JSON exceeds
  `MaxRecordBytes` is placed as N content-addressed **part** records plus the
  binding record that already binds the logical value:
  1. **Prepared publication closure**, `org.cairn.prepared-envelope.v3`
     (successor to `...v2`). Its `manifest` member carries every manifest field
     *except* `entries` — including the canonical `manifest_digest` — and it adds
     `manifest_parts`: an ordered list of `{ordinal, digest, bytes, count}`.
     Each part is a `RECORD_PART` record with schema
     `org.cairn.record-part.manifest-entry.v1` carrying `logical_digest`,
     `ordinal`, `total`, and that slice's ordered `entries`.
  2. **Portable fact child**, `org.cairn.portable-fact-closure-envelope.v3`
     (successor to `...v2`). It drops the inline `bundle` and adds `bundle_parts`
     with the same descriptor shape. Each part is a `RECORD_PART` record with
     schema `org.cairn.record-part.portable-fact-bundle.v1` carrying that slice's
     ordered `records` and `attachments`.
  3. **Processor-attempt closure**,
     `org.cairn.processor-attempt-closure-envelope.v2` (successor to `...v1`). It
     drops the inline `bundle` and adds `bundle_parts` with the same descriptor
     shape. Each part is a `RECORD_PART` record with schema
     `org.cairn.record-part.processor-attempt-bundle.v1` carrying that slice's
     ordered `attempts`. This is the record a real processed root crosses first:
     an 11,561-file publication records about 23,000 terminal attempts.
  4. A new repository record role `RECORD_PART` (`recovery/parts/`) holds the
     parts. Parts are addressed by their own SHA-256, verified by the ordinary
     `VerifyRecord` readback, and are never enumerated to establish publication;
     only the binding record is discovery authority.
  The commit marker, the publisher's signed `SignedPreparedClosure`, and the
  signed `PortableFactClosureRecord` keep their field meaning and are not
  versioned: the parts are bound *through* the digests those signatures already
  cover. A record that fits is still placed whole in its existing v1/v2 shape,
  so existing bytes, digests and signatures do not change.
- **Why a missing or reordered part cannot pass.** The binding is authenticated
  by the signature that already covers the logical value: the signed
  `ManifestDigest` (also in the commit) is the digest of the **reassembled**
  manifest, and the signed `BundleDigest`/`BundleLength`/`RecordCount`/
  `AttachmentCount` describe the **reassembled** bundle. A reader concatenates
  the bound parts in ordinal order, re-derives the canonical value, and compares
  its digest and count against the signed values. A missing part is an explicit
  error naming the ordinal; a reordered, substituted or truncated part changes
  the reassembled value and fails the digest comparison. Each part also names
  the logical digest it belongs to, so a part from another record cannot be
  substituted even behind a forged binding. No catalog, index or trust in the
  repository layout is involved; the signed digest is the trust anchor.
- **Exact identity and restore are unchanged.** The identity of a restored byte
  stream is still the SHA-256 digest plus logical length of the complete logical
  stream, computed by the reader from the exact payload objects the receipt
  names. Part placement never changes a payload object, a content identity, a
  payload receipt, or a recovery reference.
- **Reader rules — explicit refusal, never a silent misread.**
  1. A reader at this version reads v1 and v2 prepared and fact records exactly
     as before; existing publications are byte-for-byte unaffected.
  2. A reader MUST refuse an unknown envelope schema, a v3 binding whose parts
     are missing, non-contiguous or unavailable, a part whose `logical_digest`
     does not match the binding, and a reassembled value whose digest or count
     does not equal the signed value. It never falls back to the partial value.  3. An **older** binary meeting a newer record refuses: the strict decoder
     (`DisallowUnknownFields`) rejects the unknown `manifest_parts` or
     `bundle_parts` member before any value is used. Authenticated discovery
     aborts on that refusal rather than skipping the record, so an old binary
     reports the repository as unreadable instead of silently showing a
     truncated snapshot.
- **Reader-dependency consequence for what is already written.** Every record
  written before this change remains readable by both an old and a new binary,
  with unchanged bytes, digests and signatures. Once a repository contains a v3
  publication, an older binary can no longer complete authenticated discovery in
  that publication domain and must be upgraded; it does not partially read the
  repository. An operator can keep an old binary usable against a repository
  whose publications are all v1/v2.
- **Bounded recovery artifacts.** `recovery.export` and the portable
  `org.cairn.recovery-reference.v2` reader artifact embed the *placed* envelopes
  and are capped at `portableRecordReadLimit` on load, so they cannot embed a
  large manifest or bundle. The reference schema is deliberately not changed
  (`cairnd --recovery-reference` requires v2); a v2 reference for a large
  publication embeds the v3 prepared envelope and the v3 fact envelopes, and the
  content-level checks that need the manifests — authenticated manifest digest,
  metadata evidence, fact-records-against-manifest — move into
  `ValidateAgainstRepository`, which already requires the repository. The
  reference alone remains a structural and signature check; the repository
  remains the recovery authority. This keeps a whole-publication recovery
  artifact bounded for a root of any practical size, which the previous
  monolithic shape already could not do above roughly 570 entries.
- **Consequences.** `plan.ingest` no longer refuses on entry count; the
  plan-time projection now refuses only the genuinely unplaceable case, where a
  single atomic item (one manifest entry or one fact record) is itself larger
  than the per-record bound. `MaxRecordBytes` is unchanged and still enforced for
  every part and every record. Nothing about the projection changes: the
  operational catalog still takes the latest root per source, one publication is
  still one complete snapshot with one namespace root, and no index key, query or
  migration is touched.

### ADR-034: Focused full-page domain layouts over shared host state

- **Status:** Implemented for the tested local client scope, 2026-10-12; the
  [acceptance record](full-page-domain-layouts-acceptance-20261012.md) identifies
  the real browser journeys, candidate identity and remaining limits. Normative scope is
  [UX-D1](../requirements/first-party-client-experiences.md#14-ux-d1-full-page-photos-and-music-composition).
- **Problem:** Photos and Music already have separate compiled renderers and
  routes, but generic library controls and management chrome surround them.
  The operator experiences a crowded toolbox rather than a focused gallery or
  listening library. Adding another route alone would leave that clutter intact.
- **Decision:** Give those two existing destinations full-page composition,
  selected by registered page metadata. Domain content and controls lead;
  library tools, management and trusted status remain reachable through narrow
  host entry points. Keep one query/selection authority, one verified player,
  existing draft guards, preferences and compatible deep links. Returning to
  the library is client navigation, so it does not restart playback.
  The 2026-10-12 header refinement consolidates domain switching and utility
  entry points in a compact glass capsule, with one disclosed global search
  and one navigation/status menu. In-domain display choices stay with their
  content. Native disclosure focus opens before the existing search shortcut
  focuses; dismissal never clears a query. Blog's local `GlassNavigation`
  design informed the spacing and translucent treatment, without importing
  its animation dependencies or changing the shared state authority.
  The [header-refinement acceptance](immersive-host-header-acceptance-20261012.md)
  records its final local browser evidence and supersedes the earlier header
  arrangement, including the phone navigation disclosure.
- **Why:** Shared content meaning does not require identical physical controls
  on every page. The existing immersive seam already permits host-controlled
  placement. Proving two useful first-party layouts improves daily use before
  expanding presentation-package machinery.
- **Limits:** This changes presentation only. It does not admit independent
  domain queries, album/playlist persistence, extraction, another catalog,
  streaming, a runtime loader, a plugin store or a new framework. Search scope
  and incomplete loading stay visible; short labels cannot widen their actions.
- **Exit:** Direct route, navigation, search/scope, original actions, guarded
  drafts and uninterrupted shared-player checks, plus light/dark responsive
  browser evidence under UX-D1. Helper/build evidence alone does not close it.

### ADR-035: Private-drive positioning and file-oriented intake

- **Status:** Implemented and tested for the bounded local intake scope on
  2026-10-12. The operator explicitly chose this positioning and requested
  simpler Add plus mature interface references. The [local acceptance](private-drive-intake-acceptance-20261012.md)
  records actual original downloads, Luna's final interface checks and the
  untested fault branches; it grants no core-phase or release qualification.
- **Problem:** The platform/category wording and technical source drawer
  make a daily action feel like configuring storage. Uploading requires a
  staging-to-path handoff even though the core can already prepare its plan.
- **Decision:** Present Cairn as a better self-hosted private drive for one
  owner. Keep files, unified discovery, original takeout and focused Photos/
  Music as the daily product. Lead browser intake with choose/drop; after a
  fully reported successful request, automatically prepare the existing plan
  for that request's staging directory and retain one explicit confirmation.
  Keep the user in one file-oriented surface; disclose technical details on
  demand. Server-directory import remains an explicit secondary choice.
- **Why:** A familiar category explains what the owner can do immediately.
  Removing a technical handoff improves the core add/find/use/takeout loop
  without weakening exact saving or multiplying storage/state authorities.
  The [reference review](../research/private-drive-interface-reference-20261012.md)
  separates documented mature-product patterns from our design choices.
- **Boundary:** This changes product language and the existing client adapter.
  It creates no endpoint, schema, processor, job/policy lifecycle or recovery
  format. Unknown/partial uploads remain unresolved, subset review is explicit,
  and unknown applies use the existing check path. It advertises no unimplemented
  folder mutation, sharing, sync, media persistence or universal playback.
  Core phase order, grouping gates and single-owner scope remain intact.
- **Exit:** Real browser selection → automatic preparation in the same panel
  → explicit save → original verification/use, with visible blocked/unknown
  outcomes and readable 390/1280 light/dark states. Client evidence cannot
  qualify a release or a core phase.

### ADR-036: Everyday library actions over the shared returned scope

- **Status:** Decision recorded 2026-10-12; integrated client acceptance in
  progress. This maintains existing API/WebUI and UX-C1/T1 admissions and
  grants no core-phase or release credit.
- **Problem:** Ordinary browsing permanently exposes tags, system fields,
  accounting and retrieval tools. Selecting files then adds several competing
  download/export/report actions and a long explanation. On a phone this
  consumes the space needed to recognize and use files.
- **Decision:** Keep navigation, favorites, sorting, layout and selection
  entry predictable. Put filters and secondary tools behind native labelled
  disclosures while showing active conditions, returned/loaded scope and
  unavailable states outside them. Once files are selected, make verified
  original ZIP takeout the primary action; retain server-directory export,
  report, image-search and tag entry as reachable secondary actions. Use a
  semantic row-selection control with a 44 px target, preserving existing
  roving keyboard and virtual listing behavior.
- **Why:** The ordinary job is find → select → use/take out. A clear next
  action makes existing capability useful without adding another content
  authority or making the familiar drive category depend on a writable tree.
  Native disclosures require no custom overlay/focus state machine. Existing
  typed callbacks still own decisions and failures.
- **Boundary:** One host-owned result/selection scope, existing Notes/tags,
  verified original access and the frozen export contract remain intact.
  No new query, endpoint, schema, processor, persistent grouping, runtime
  loader or recovery format is admitted. No unloaded catalog entries are
  silently selected. Focused Photos/Music compositions keep their existing
  host tools and shared state; common batch/row controls stay compatible.
- **Exit:** Real browse/filter/search → displayed selection → one observable
  original ZIP → independent byte verification, with keyboard selection,
  Details return, empty results, readable phone/desktop light/dark states and
  honest unavailable/partial scope. Small-model diffs are not accepted without
  primary review and executable evidence.

### ADR-037: Complete existing domain journeys, then review a personal video successor

- **Date:** 2026-10-13
- **Status:** Accepted product prioritization; future media candidates remain
  proposed and unadmitted. This ADR changes no normative phase or core gate.
- **Context:** The operator requested local Luna implementation after the
  Haiku route exhausted its quota, identified uncomfortable existing layouts,
  and asked about media libraries, Bangumi and danmaku. Existing Photos names
  are cramped and Music splits related actions across competing rows. Merely
  adding destinations would leave the actual daily journey incomplete.
- **Decision:** Refine existing Photos/Music first: image-first cards with
  full-width names and reachable controls; a coherent Music browse/action row,
  honest view-local counts and one shared verified player. Local Luna handles
  disjoint implementation and focused validation; the primary reviewer owns
  product decisions and integration. Record video/anime as the next domain
  candidates, with local retained-video use preceding optional metadata,
  sidecars, account sync and online aggregation.
- **Rationale:** Each extra capability should complete a useful journey.
  Video seeking/codecs, series/episode association, watch progress, provider
  matches and danmaku alignment require concrete contracts; the existing
  32 MiB full-original audio profile cannot become general video playback by
  changing its label. Supplementary providers must leave local originals and
  filename-based access useful when unavailable.
- **Boundaries:** No native video surface, new endpoint/schema/processor,
  runtime loader or durable organization is admitted here. External IDs do
  not establish exact identity. Current client work remains inside
  RW-PERSONAL-UX-1. Media candidates and their proposed exits are documented in
  [the primary-source review](../research/media-and-anime-experience-20261013.md).
- **Tradeoff:** This sequence favors a small number of comfortable experiences
  while leaving substantial future vertical scope explicit. Photos/Music
  polish alone does not satisfy complete albums/playlists, video or release.

### ADR-038: Explicit app destinations with one stable host header

- **Date:** 2026-10-13
- **Status:** Accepted client presentation decision; core phase order and
  admission stay unchanged. Integrated evidence is recorded separately.
- **Context:** The operator found Photos/Music switches misleading: a control
  named All types also returned from a dedicated experience, changing the
  whole header/frame. AutoBangumi was supplied as the closer self-hosted
  vertical reference. Clear app destinations should not masquerade as type
  filters or add unrelated management controls to an immersive domain.
- **Decision:** The host header consistently presents Library, Photos, Music
  and the compiled Overview destination, plus the same search/add/utility
  entries. Library means the ordinary presentation of the current returned
  scope; All content remains the explicit full-listing action in the rail.
  Type filters retain the ordinary Library composition. Photo wall/Exhibition
  remain in-domain presentation choices. Remove the duplicate global switcher
  from the Library toolbar. Preserve existing route/registry/guard ownership.
- **Why:** Stable global affordances explain where the user is and how to
  return while each destination owns its useful content layout. App navigation
  retains current query/tag conditions rather than silently expanding scope.
  Names, icons and active-page semantics express destination entry rather
  than a new filter/query authority.
- **Implementation boundary:** Workspace/showcase remain selected Library
  content frames; Photos/Music keep immersive content frames. A shared compact
  header reuses the existing search form and native disclosures. Desktop
  Library owns its rail in the frame; focused/compact layouts expose it from
  the menu, without duplicate rail mounts. One host player, existing draft
  guards, original actions and old deep links remain intact. No new endpoint,
  schema, runtime loader, provider or durable format is added.
- **Reference boundary:** [AutoBangumi](https://www.autobangumi.org/) informs
  workflow/navigation choices. RSS acquisition, downloader jobs and file
  renaming remain proposed foreign-tool concerns. This decision adds no media
  integration or automatic external download behavior.
- **Exit:** Library → Photos → Music → Library keeps the same global entry
  order and usable controls; current search/tag scope does not rerun or clear;
  decoded audio retains its source; draft guards work; one header/search/rail
  owner remains; 390/1280 light/dark and narrower Showcase layouts stay usable.

### ADR-039: Library layouts and on-demand search assistance

- **Date:** 2026-10-13
- **Status:** Accepted presentation refinement within RW-PERSONAL-UX-1
  UX-C1/C2/D1 and API/WebUI sections 5.3/6. Executable evidence is recorded
  separately; this decision changes no admission or core phase gate.
- **Context:** The operator could not distinguish Library from Overview and
  found the opened search and everyday toolbar crowded. Peer destinations
  implied separate collections even though Overview already uses the same
  returned content. Permanently exposed helpers competed with the file list.
- **Decision:** Keep Library, Photos and Music as the global destinations.
  Place File view and the enabled compiled Overview in Library's View options;
  the Chinese Overview label becomes "分类总览". Library stays active in the
  header for either layout. This supersedes only ADR-038's peer Overview
  placement; its stable header and shared-state decisions remain in force.
  Put sorting and applicable grid/list controls in View options, Favorite in
  Filters, and visible-scope bulk selection in More tools. Keep result counts,
  active restrictions, incomplete scope and actionable failures visible.
- **Search hierarchy:** Opening search first exposes the existing field and
  submit action. Recent searches and Search help require explicit expansion.
  Ordinary words and short operator prefixes do not open a palette. An exact
  operator name may offer its completion; known tag and protection values
  retain their bounded suggestions. Parsed condition editing, grammar errors
  and actual query limitations remain visible. Technical predicate mapping
  belongs inside Search help.
- **Why:** The navigation expresses one collection with different useful
  layouts. Progressive disclosure gives the file list and search task visual
  priority while retaining secondary tools at named, keyboard-reachable
  locations. Hiding an active restriction or a refused search would undermine
  that simpler interface, so those states are not optional disclosures.
- **Boundary:** Reuse the compiled registry, existing route/disabled-page
  resolution, single host query, selection, original actions and verified
  player. Recent-history expansion is transient browser interaction state;
  persistence and submission semantics do not change. No new endpoint,
  schema, processor, index, durable domain record or runtime loader is added.
- **Exit:** File view → Overview → File view retains current search/tag scope
  without another search; header ownership and original actions remain
  coherent. Blank/plain search is calm; explicit recent/help controls,
  keyboard completion, refusal and dismiss/reopen behavior work. Review
  390/1280 light/dark layouts and viewport bounds against the served build.

### ADR-040: Exhibition as a focused gallery over the existing Photos scope

- **Date:** 2026-10-13
- **Status:** Accepted client presentation refinement within
  RW-PERSONAL-UX-1 UX-E2/D1. Local acceptance is recorded separately;
  admission and core phase order do not change.
- **Context:** The operator wants Exhibition to feel like an attractive
  specialist application. Its large introductory heading, permanent
  explanations, repeated per-card actions and variable-width corridor gave
  management controls more emphasis than the photographs.
- **Decision:** Use a compact title and visible loaded-photo position, one
  centered primary image, quiet neighboring previews on desktop and a
  center-only phone stage. Center placement is stable at the beginning and
  end of the loaded scope. Previous/next controls sit beside the image; the
  current filename and one set of inspection, Details and selection actions
  sit below it. Put explanatory and keyboard guidance in Browsing help.
  Retain the host's Photo wall/Exhibition choice and normal-wall return.
- **Interaction:** A neighboring image changes focus without opening a
  management panel. The current image opens the existing bounded inspector;
  Details remains an explicit host action for Notes, tags and originals.
  Keyboard focus names the actual action, navigation endpoints are disabled
  honestly, and reduced-motion use removes transitions.
- **Why:** Exhibition offers an enjoyable way to look through personal
  images while the photo wall supports scanning and selection. A stable
  center, complete image aspect ratio, restrained framing and one current
  action row give the photographs visual priority. Loaded counts and real
  filenames retain understandable scope without invented dates or albums.
- **Boundary:** Keep the existing radius-two moving window with at most five
  mounted thumbnail components; each file has only one preview mount.
  Preserve shared identity checks, read/cache ceilings, focus, selection,
  drafts, original actions, unavailable states and player ownership. Do not
  add another inspector, read path, query, persistent album, processor,
  endpoint, runtime loader or durable state.
- **Exit:** Review 390/1280 light/dark layouts with an existing fixture photo;
  navigate first/middle/last through the loaded context by buttons and arrow
  keys; verify stable center, bounded mounts, neighbor focus, inspector and
  Details entry, retained wall selection, visible fallback and reduced motion.

### ADR-041: Complete useful client operations before further visual redesign

- **Date:** 2026-10-13
- **Status:** Accepted priority refinement within the admitted client track.
  Implementation and acceptance are recorded separately; no core phase or
  domain-state contract changes.
- **Context:** The operator explicitly moved appearance work behind missing
  functionality and asked local Luna agents to implement the remaining useful
  operations, with the primary agent deciding scope and reviewing results.
  Existing Music browsing, verified playback, transient queues and shared
  organization already supply reusable host actions.
- **Decision:** Complete practical operations over the current loaded scope:
  Music local sorting and playback-eligibility filtering, one-action insertion
  after the current queue occurrence, inclusive ordinary-Library range
  selection, and explicit batch tag/favorite addition and removal. Follow with
  easier access to existing saved retrieval and selected-photo actions.
  Defer further gallery/shell redesign until the admitted daily operations
  are usable. Fix a layout or interaction defect when it blocks these tasks.
- **Why:** These operations let an owner organize a selected set and use the
  result immediately. They reuse the same subjects, annotations and player,
  so improvements apply across Library, Photos and Music without creating
  another catalog or duplicating a host workflow. Explicit add/remove actions
  are understandable for selections containing mixed tag/favorite states.
- **Safety and scope:** Sorting and filtering retain original host indices;
  unknown facts remain unknown. Eligibility is a pre-download guard; browser
  decoding can still fail. Queue insertion creates a distinct occurrence,
  preserves the active original and position, and respects the atomic
  1,000-entry ceiling. Batch organization reads complete current per-subject
  annotations, adds only absent exact tags, removes only matching TAG records
  with expected revisions, and rereads outcomes. Unavailable reads, partial
  writes and uncertain responses remain visible. These actions make no new
  portable-publication claim and introduce no schema, endpoint or processor.
- **Full target:** Curated photo albums, durable ordered playlists and a
  personal video/anime workflow remain separately recorded product targets.
  A TAG shortcut and transient listening queue do not satisfy those targets.
  Their admission, data/recovery contracts and applicable core gates must
  precede implementation. LinkGroup remains behind Phases 4/5; new capture
  facts, streaming/transcoding and external acquisition require their own
  reviewed contracts. Runtime third-party loading remains out of scope.
- **Exit:** Sort/filter Music and act on the same subjects in visible order;
  insert D into A/B/C as A/D/B/C without restarting A; refuse overflow without
  changing playback; select rows 2–5 inclusively in displayed Library order;
  add/reuse/remove a chosen tag and Favorite on a captured selection while
  preserving unrelated annotations. Verify incomplete reads cause no writes
  for the affected item and report partial/unknown results truthfully.

### ADR-042: Separate capability, application and presentation installation

- **Date:** 2026-10-14
- **Status:** Informative architecture and product decomposition decision.
  Existing kernel and presentation boundaries are reaffirmed; broader package
  delivery and household applications remain proposals. This record adds no
  implementation admission, public ABI, schema, endpoint or completion credit.
- **Context:** The operator wants concrete personal and household scenarios,
  useful borrowing from specialist products, image/OCR retrieval, and a way
  to assemble a tool around personal habits. Current Chinese-CLIP and PP-OCR
  code must not be mistaken for absent capabilities or an enabled default.
  Calling every extension a plugin would obscure the different data,
  processing, application and presentation responsibilities.
- **Decision:** Keep capture, trusted content/subject records, processors and
  index profiles, query fusion, first-party applications and client
  presentations as logical boundaries over the existing small physical core.
  Distinguish reviewed capability/model bundles, compiled first-party app
  distributions or enablement, and ADR-032 data-only presentation packs.
  No module introduces its own content identity, catalog, policy or recovery
  authority. User-facing choices describe tasks and results rather than
  internal IDs or one service per module.
- **Discovery:** BGE text vectors and Chinese-CLIP image-space vectors retain
  independent pinned profiles and generations. OCR is text extraction that
  can supply existing lexical and semantic segments, not another visual
  embedding space. Fuse authorized subject candidates under declared ranking
  rules; never compare unrelated raw vectors or use similarity as exact
  identity. Installing assets, running a processor, building an index and
  qualifying useful retrieval are separate states.
- **Installation direction:** Stage and verify compatible bundles with
  dependency and license evidence, update explicit configuration or build
  composition, and expose actual availability. Model changes produce new
  derived generations; they do not reinterpret old facts or authorize general
  processor reprocessing outside its reviewed successor contract. Disabling
  an app, model or presentation must preserve original content and durable
  user information. A general installer and installable whole-page packs are
  not claimed as shipped.
- **Household direction:** Record item-location, appliance-paperwork,
  user-confirmed dates/reminders, bounded observations and TV consumption as
  optional future user jobs. Their entity, observation, read, device-access
  and recovery semantics need separate review after admitted convergence
  work. Saving arbitrary JSON bytes does not implement those jobs. The
  selected direction remains information storage and retrieval for one owner.
- **Why:** Separate responsibilities let an owner add a useful capability
  without another database or a fragmented workflow, and choose a different
  interface without losing search, selection, Notes or original takeout.
  Concrete end-to-end jobs are a better completion boundary than feature
  breadth or a generic plugin framework.
- **Evidence and next decision:** The [scenario catalog](../research/personal-information-scenarios-and-reference-products-20261014.md)
  links realistic jobs and official reference patterns. The [module and
  installation design](personal-information-modules-and-installation-design.md)
  links current source and distinguishes code presence from deployment and
  release qualification. No competitor UI trial, customer case, or new model
  execution is claimed. Subsequent implementation still follows the
  normative execution plan and its own admitted contract.

### ADR-043: Reuse capabilities before turning scenarios into features

- **Date:** 2026-10-14
- **Status:** Informative operator-priority decision. It supersedes the
  same-day seven-milestone/21-task expansion as a delivery commitment, not
  normative requirements or historical implementation evidence.
- **Context:** The operator wants useful scenarios that reuse the common
  platform without a feature/application for every example. Calling every
  proposal future or gated still creates an implicit promise to build it.
- **Decision:** Start with existing exact files, multiple tags, one Notes
  surface, supported search/SavedView and selection/export. Photos/Music and
  current shells present that same authority. Document capability recipes;
  compose them to meet the chosen user goal and schedule necessary admitted
  gaps. New semantics or integration triggers bounded scope review, not
  removal of the goal or automatic expansion to a domain suite.
- **Operator clarification:** The purpose is to achieve the goals simply and
  elegantly by composition, adding what is needed. Keep user outcomes,
  capability gaps and active implementation separate. A manual recipe proves
  its own steps; it does not close a requested comfortable experience that
  still requires awkward reconstruction. Necessary new behavior may be
  admitted after its real scope/authority/recovery review.
- **Boundary:** Human-written order, dates, location or progress inside content
  remain ordinary information. Native parsing/validation, business sorting,
  calculation, notification, membership or automatic updates are new behavior.
  Common applicability does not admit a universal record schema, task engine,
  generic group or external capture interface. Daily manual use is not itself
  a reason to exclude a recipe or build a domain app.
- **Work:** Four packages replace the feature pipeline: A ordinary reuse
  journey; B common friction repair only where demonstrated; C existing
  admitted experience/discovery residuals; D required core gates in their
  existing order. B may have no implementation task. PC-09/10 and PC-13–19
  retain goals and candidate gaps without assuming independent full suites.
  Select shared pieces, minimum missing behavior and a user exit before
  scheduling the next admitted slice. Existing core gates remain unchanged.
- **Examples:** A reading list is a saved text file plus tag/Notes and manual
  browser return; a household location is a searchable owner statement; a food
  list can be manually maintained. These do not claim archived webpages,
  browser sessions, native inventory/date calculations or reminders.
- **Completion:** A representative existing-operation journey records manual
  steps, lookup effort, actual mistakes and changed-record behavior, then
  takes out the selected exact bytes. New-content identity, supported dynamic
  query conditions and preview limits remain explicit. A recipe or model
  opinion awards no feature/core/release credit.
- **Why and evidence:** This keeps broad usefulness in combinations of a
  small coherent tool, rather than many new pages/state models. The
  [corrected closure plan](personal-information-product-closure-plan.md) and
  [single ledger](product-experience-todo.md#product-closure-work-breakdown--2026-10-14)
  record the change. Two configured read-only Opus 5.5 CLI consultations
  returned final responses with exit 0 and zero tool events; their advice
  was checked against repository contracts, including corrected field,
  frequency, SavedView and update assumptions. No product implementation,
  runtime/model readiness or release qualification changed this round.

### ADR-044: AI clients over the existing content authority

- **Date:** 2026-10-15; reaffirmed 2026-10-16
- **Status:** Informative product direction and preferred architecture for
  later review. The operator requested recording voice capture, AI-assisted
  file finding/takeout and remote personal-file management. No implementation,
  new command, schema, processor, remote profile or phase admission is granted.
- **Context:** Requiring the owner to translate a short spoken intent into
  searches and file operations would miss the intended low-effort experience.
  Client versus server is a responsibility split: interaction and planning
  need not become a second content authority or mandatory model service.
- **Decision:** Prefer an external AI client as the initial integration
  candidate. It accepts speech/text, interprets intent and coordinates scoped
  requests. The existing Cairn service owns authorization, retrieval, plans,
  exact storage/output and verification. A later built-in assistant uses the
  same client boundary; optional local/online speech or model providers do not
  receive kernel authority. Preserve one owner, one catalog/repository and
  recovery independent of the AI client or model.
- **Integration choice:** Client integration and an optional service-hosted
  assistant may coexist, but the first useful slice needs only one. Evaluate
  completed capture or verified takeout, not the presence of chat or a model
  endpoint; no service-hosted agent is selected by this direction record.
  The 2026-10-16 reaffirmation keeps the existing AI client as the preferred
  starting point and a service-hosted assistant optional; transport and vendor
  remain undecided.
- **Alternatives:** A mandatory server-side agent/model platform adds an
  independent lifecycle and unnecessary default resource/credential exposure.
  A client that directly reads the catalog, repository or unrestricted source
  filesystem bypasses the existing trust and recovery contracts. Neither is
  selected. A future built-in client remains possible without either design.
- **Interaction:** Complete bounded reads and accepted quick-capture presets
  without repeated intermediate prompts. Ask only for material ambiguity or
  authority not already granted. Show progress, cancellation and the actual
  saved/prepared/verified or unavailable outcome. Transcription and AI-inferred
  facts keep their provenance; a new text record and a Note on an existing
  subject reuse their respective existing mechanisms.
- **Remote and privacy boundary:** Reading retained content remotely, pairing
  a bounded source, and modifying live remote files require separate review.
  Search permission grants no shell, source deletion, signing keys or general
  filesystem access. Microphone capture/retention, model egress, source scope,
  output destination and revocation are explicit. No automatic cloud fallback
  or whole-library upload is implied. Existing AI nonprivilege and qualified
  remote-profile requirements remain authoritative.
- **Why:** This directly improves the product's find/use/takeout advantage
  while reusing the trusted content plane. Voice is another capture method;
  conversational retrieval is another client interaction. Neither needs an
  independent inventory, universal record, file manager or recovery service.
- **Next reviewed slice and exits:** PC-21 first chooses the smallest useful
  end-to-end job and its permitted operations. Later evidence must show spoken
  capture -> saved/searchable/correctable record, or natural-language request
  -> authorized candidates -> intended exact output; include ambiguity,
  provider/remote unavailability, cancellation and unknown-outcome handling.
  The [product direction](content-first-product-decision.md#ai-assisted-capture-and-retrieval-direction-2026-10-15)
  records the concrete examples. This record does not claim ASR, an AI/MCP
  integration, remote capture or file control is shipped, and does not reorder
  the core execution plan.

### ADR-045: Bind semantic matches to their selected source revisions

- **Date:** 2026-10-15
- **Status:** Implemented and tested for the bounded development profile in
  [the dated acceptance](semantic-source-lineage-acceptance-20261015.md).
  The same tested binary has a reviewed local owner-preview rollout. Full
  Phase 4 and release completion remain open.
- **Context:** Semantic receipt v1 proves subject/segment membership but cannot
  distinguish successive bodies under one stable Note ID. Querying that old
  vector and reopening the current Note can attribute new text to an old
  embedding. The ONNX worker also already reports truncation and token counts,
  which the search adapter currently drops.
- **Decision:** Use the separately versioned v2 successor in
  [Driver and Processor Interfaces §10](../requirements/driver-and-processor-interfaces.md#semantic-input-lineage-successor-development-v2).
  Keep one existing receipt path and commit a generation-local candidate
  inventory before filtering, exact source revisions/digests, input identities
  and validated optional tokenizer coverage evidence. Preserve immutable Note
  history for matched text; the live record still controls tombstones and
  lifecycle. Truncated or unknown token consumption cannot claim full source
  coverage, even when all submitted input identities exist in zvec.
- **Alternatives:** Reopening the current Note silently changes a hit's
  provenance. Timestamps or a different lexical generation cannot establish
  which bytes an old vector used. A second text catalog or copying Note bodies
  into a new durable record would duplicate authority. None is needed because
  immutable annotation revisions already exist.
- **Compatibility:** Read v1 under its original pair-only meaning. An old Note
  hit without revision proof reports semantic unavailability and a rebuild
  reason; lexical/structured discovery and exact preservation remain usable.
  New builds do not rewrite old receipts, model spaces, catalog schemas or
  recovery formats. The worker ABI remains unchanged; its validated result
  facts cross an optional host-side search field.
- **Why:** A found result must explain the content that actually produced it.
  This closes an admitted discovery/provenance gap without adding a domain
  application, AI integration or recovery dependency. Missing evidence remains
  explicit rather than receiving an inferred completeness claim.

### ADR-046: Segment long text sources without another durable document model

- **Date:** 2026-10-15
- **Status:** Implemented and tested for the bounded development profile in
  focused and broad tagged Go cohorts and an isolated actual BGE/zvec run.
  The same tested candidate also passes owner-preview deployment and the
  existing search/Photos/Music/exact-original journey. No core or release
  gate is closed by this record; see the
  [native acceptance](semantic-source-lineage-acceptance-20261015.md#long-text-source-segmentation-successor).
- **Context:** A Note or admitted text extract currently becomes one semantic
  input. Honest 512-token truncation reporting preserves trust but leaves its
  later text outside semantic retrieval. Durable description segments already
  have a separate, revision-bound model; copying Notes into descriptions or
  adding segment rows for every rebuild would create unnecessary authority
  and recovery changes.
- **Decision:** Derive deterministic, contiguous UTF-8 source-span inputs for
  long Notes and already selected textual extracts at rebuild time under the closed
  `cairn.semantic-text-source-segmentation.v1` profile. Its conservative
  384-source-byte target prefers sentence/whitespace boundaries and retains
  every source byte. Whitespace attachment can exceed the target; tokenizer
  FULL/TRUNCATED/UNKNOWN still comes from actual provider evidence. This is
  not a claim that a byte limit guarantees a tokenizer limit.
- **Identity and provenance:** Keep the complete immutable source body and
  revision authoritative. Bind profile, source, subject, revision, body,
  ordinal, exact span and text digest in derived IDs and the existing v2
  receipt inventory. Query reopens that immutable source and reproduces the
  segment set before returning matched text. Optional provenance on the
  existing search result exposes the source revision and byte span. Current
  Note lifecycle, artifact admission and root authorization remain gates.
- **Backend encoding:** The first actual-native attempt rejected a draft
  68-character `txt_` plus full-hash ID. The retained native zvec library's
  validation patterns cap document keys at 64 characters. Encode the full
  SHA-256 as 64 hexadecimal characters without a prefix and bind that encoding
  into the segmentation profile; do not shorten the digest or change content
  identity. The draft failed before owner deployment and receives no native
  acceptance credit.
- **Compatibility:** Preserve short and legacy whole-body v2 inputs. Unknown
  segmentation profiles fail closed. Old readers may refuse newly segmented
  receipts, so retain the prior binary/generations and use an explicit rebuild;
  never rewrite old receipts. Lexical full text, durable description segments,
  the model/semantic space, worker ABI and recovery records remain unchanged.
- **Why:** This makes more retained text findable through the shared discovery
  plane without another user concept, durable schema, processor or service.
  The [v2 contract refinement](../requirements/driver-and-processor-interfaces.md#semantic-input-lineage-successor-development-v2)
  defines the bounds; the existing core plan remains the implementation order.
- **Exit:** Demonstrate suffix-only semantic matches beyond the former model
  prefix with actual local BGE inputs and verified revision/span digests;
  retain old-generation historical Note text after edits, honor tombstones and
  reject malformed/gapped/profile-mismatched evidence. Prove lexical and exact
  original access remain available. A controlled sample is implementation
  evidence, not representative recall or release qualification.

### ADR-047: Prove continuous CJK phrases after bounded lexical candidate expansion

- **Date:** 2026-10-16
- **Status:** Implemented and tested for the bounded development slice,
  including the owner-preview rollout; full phase/release gates remain open.
  This advances Phase 4 discovery without changing its gate or phase order.
- **Problem:** The retained long-text native attempt 002 cannot find the
  interior phrase `萤火浮标` lexically, although its full source sentence is
  indexed and a complete-token query succeeds. The existing V4 appendix has
  single-character and adjacent-bigram tokens; it has no arbitrary-length
  interior token for the original four-character query.
- **Decision:** Keep original query tokens. For a pure Han token of at least
  three characters, preserve the original prefix branch and add a candidate
  conjunction using at most its first sixteen distinct adjacent bigrams from
  the current enriched axes. Require continuous original-text proof before
  counting a returned hit or `has_more`. Multiple ordinary query tokens retain
  their existing AND and axis semantics. Continue scanning candidate pages
  through rejected fragments until there is a full page plus one proven hit
  or the stream ends.
- **Provenance and paging:** Explain actual source text and UTF-8 byte spans;
  fragment co-occurrence is not a phrase match. Existing verified
  description-field mapping may explain an actual same-body segment boundary.
  Bind `cairn.lexical-query.cjk-contiguous.v1` into continuation query identity
  so an old BM25 position cannot cross query-policy changes. The tokenizer,
  index feed/profile, stored source records and recovery formats do not change.
- **Why:** Splitting into unordered bigrams alone produces false positives.
  Filtering a finished limited page loses real later matches. Replacing the
  lexical feed or adding another search store is unnecessary for this observed
  gap. Candidate expansion plus source proof reuses existing generation and
  paging machinery and keeps Latin/pinyin behavior and original access intact.
- **Limits and exits:** Existing appendix vocabulary and extracted-prefix
  bounds remain visible; no unindexed universal substring coverage is claimed.
  Prove interior matches, fragmented/reordered negatives, source attribution,
  same-body boundary spans, over-1,000 rejected candidates before real hits,
  stable multi-page exhaustion, typed filters and old-policy token refusal.
  The [query contract](../requirements/driver-and-processor-interfaces.md#compiled-lexical-cjk-query-refinement)
  governs the implementation. The [dated acceptance](lexical-cjk-query-acceptance-20261016.md)
  records reviewed focused/broad Go tests, ordinary private browser fallback,
  precise source spans and exact originals, followed by owner deployment on
  unchanged lexical/semantic generations. This closes PC-07i only and grants
  no full Phase 4/5 or release qualification.

### ADR-048: Continue budget-refused takeout with the attempted selection

- **Date:** 2026-10-16
- **Status:** Implemented and tested for bounded UX-T1/PC-02a; no core-phase or
  release qualification.
- **Problem:** ZIP budget or unknown-size refusal leaves only an error and
  Dismiss, interrupting takeout despite existing alternative output paths.
- **Decision:** Validate the complete explicit identity set, retain only its
  minimal immutable workspace-bound client projection on preflight budget
  refusal, and expose the existing original download/server export drawer.
  A changed visible selection cannot silently replace the attempted set.
  Invalidate on reset/new attempt/workspace change and preserve ordinary
  readiness, review and verification. Invalid identities or post-plan failures
  acquire no bypass. The retained set is not an ExportManifest.
- **Why:** Raising browser limits would increase memory exposure without
  solving the task. Recapturing current selection can export unintended files.
  Reusing the existing explicit plan/apply/verify path gives large-file users a
  practical exit without another backend, lifecycle, durable state or authority.
- **Evidence:** [The dated acceptance](zip-refusal-continuation-acceptance-20261016.md)
  records a real oversized original, changed-selection two-file export, exact
  byte verification, focus/dismissal, focused/build/broad checks and the limits
  of workspace/runtime evidence.

### ADR-049: Publish user metadata over all retained authenticated subject parents

- **Date:** 2026-10-16
- **Status:** Contract clarification; focused tests cover ordinary Note/TAG
  upsert and rename/delete, PROGRESS create/revise, annotation imports, and
  Description publication for the bounded development slice. A bounded actual
  corpus drill now joins seven saved facts under one retained authenticated
  parent and restores the 104 originals; this is not broad corpus coverage or
  full Phase 3/release closure. See the
  [dated evidence](real-project-corpus-acceptance-20261016.md#2026-10-16-bounded-metadata-corpus-recovery-drill).
- **Problem:** The initial 104-file reference predates later Note, TAG and
  description writes, so its authenticated child does not cover those catalog
  facts. That is a historical artifact gap; later bounded tests now exercise
  the ordinary publication hooks described in the dated evidence.
- **Decision:** Reuse that publisher after admitted metadata mutations. Cover
  every retained authenticated committed parent whose signed subject mapping
  contains an affected stable subject. Resolve fixed parents from authenticated
  records, not latest roots or an index. Join the operation's own committed
  revision/digest/tombstone to each verified successor before claiming coverage.
  The normative rule is in Restore Manifest section 20.1; old record formats and
  exact publication meaning are unchanged.
- **Why:** Latest-only selection would leave a subject's other retained recovery
  paths without its later user facts. A separate metadata service or store would
  duplicate authority. Existing signed complete-state successors already carry
  revision history, attachments, parent bindings, fencing and reconciliation.
- **Failure and concurrency:** Keep the committed user write and return its
  identity with an explicit degraded result if any required publication is
  missing, failed or uncertain. Do not retry a Note/description mutation to
  recover publication. A later concurrent revision does not substitute for
  evidence of this operation's own saved revision. Process loss between stores
  leaves coverage unproven; no queue, new state machine or silent recovery claim
  follows from this decision.
- **Exits:** Focused multi-parent/missing-mapping/idempotency and mutation-failure
  tests, then ordinary Note/TAG/description writes exported and imported by a
  clean catalog-free reader with exact revision/body joins. Preserve full-byte
  restore and explicit partial/unknown outcomes. Bounded tests now cover the
  listed Note/TAG/PROGRESS/import/Description hooks, including saved-write
  behavior on publication failure; Note additionally has an actual corpus-reader
  fact check. The separate seven-fact corpus drill is bounded to one retained
  parent. Missing-predecessor import
  is saved + DEGRADED and does not prove complete history recovery. Existing
  Phase 3/4/5/6/7 gates remain in force.
- **Evidence (2026-10-16):** Root-reviewed run
  `trial/recovery/note-upsert/runtime/attempts/20261015T202737Z-6794ce5aa2ac40489ba12935dfd885a3/run.json`
  saved Note revision 3 under its exact ID/body digest, published one actual
  retained parent, and passed a separate reader against an independently
  retained anchor/repository copy. The reader was instantiated with no catalog
  (`Store=nil`) and no signing identity; it verified 104 files / 2,486,895
  bytes; this Note run verified the fact and original-file hashes but did not
  restore bytes. A separate bounded corpus drill covers seven own facts under
  one retained parent and restores 104 originals; the reference fit v2 at
  16,466,616 bytes. Two-parent publication remains focused-test evidence. See
  the [dated evidence](real-project-corpus-acceptance-20261016.md#2026-10-16-bounded-metadata-corpus-recovery-drill).
  Focused tests exercise multi-parent publication,
  partial/unknown failure, missing auth and revision concurrency; focused
  reader tests verify exact facts across retained parents without catalog or
  signing key. The bounded 2026-10-16 follow-up adds PROGRESS, imports, TAG
  rename and Description coverage, including saved writes on publication
  failure. Missing-predecessor import is saved + DEGRADED, not a full
  history-recovery proof. The final combined tagged Go run passed; its command,
  timing and cache limits are recorded in the dated evidence. This is bounded
  test evidence, not a phase or release completion claim.

### ADR-050: Preserve description creation configuration across retained parents

- **Date:** 2026-10-16
- **Status:** Contract clarification; the focused signed A/B-parent regression
  is implemented and green for the bounded development reader. Older-reader
  interoperability and release qualification remain open.
- **Problem:** A description created under configuration B cannot be published
  unchanged to a retained configuration-A parent because the current reader
  equates its creation digest with the parent's manifest digest. This conflicts
  with immutable revision provenance and ADR-049's all-parent coverage.
- **Decision:** Validate the description's own nonempty SHA-256 creation digest
  independently of each parent's manifest configuration. Duplicated provenance
  must agree with the payload. Keep authenticated membership, signatures,
  revision lineage, producer bindings, body digests and attachments unchanged.
  Restore Manifest section 20.1 defines the clarified rule.
- **Why:** Rewriting either digest would falsify history. Configuration changes
  affect new work; a later fact about an existing subject can legitimately have
  been created under another configuration. No new format, schema, store or
  migration is needed to preserve those existing fields.
- **Compatibility:** Existing bytes and field meanings remain unchanged, but
  older readers with the stricter equality check can reject the newly usable
  metadata combination or its exported reference. Use the tested reader binary;
  do not claim old-reader interoperability or release qualification.
- **Exits:** The same exact description revision is authenticated under signed
  A/B parents with distinct configuration digests by a reader without a catalog
  or signing key. Missing/malformed creation digests, conflicting duplicated
  provenance, changed signatures, body/attachment corruption and cross-subject
  facts remain rejected. Preserve both exact parents and their original bytes.
- **Evidence:** The focused signed A/B configuration-digest test passes; malformed
  and missing digests, duplicated-provenance mismatch, signature/body damage,
  and cross-subject facts are rejected. Existing field meanings and bytes remain
  unchanged. Focused Description publication tests also verify USER, imported,
  and manually supplied AI_SUMMARY candidate/accepted-successor facts with
  body/segment coverage under retained parents and creation config B while the
  parent retains config A. The candidate was supplied directly in a test; this
  is not model integration. Older readers with the former strict equality
  check may reject this valid combination; use the tested reader binary. This
  is not release evidence.

### ADR-051: Compact recovery selectors over unchanged authenticated records

- **Date:** 2026-10-16
- **Status:** Implemented and tested for the bounded Phase 3 development
  slice, with focused cases, combined tagged Go evidence and a separate-process
  restore regression. Not release-qualified; history-scale performance, old
  reader interoperability and full catalog reconstruction remain open. Restore
  Manifest section 20.1 defines the exact successor.
- **Problem:** The actual two-child Note reference is 4,671,340 bytes. A signed
  regression has individually bounded children of 17,064, 5,618,107 and
  11,219,046 bytes, but its 16,867,660-byte v2 reference exceeds the 16 MiB
  reader cap. The writer guard prevents unreadable success; repeated ordinary
  metadata writes still need a usable independently retained reference.
- **Decision:** Admit explicit `org.cairn.recovery-reference.v3` descriptors for
  the existing prepared record and every selected fact successor. Pin the full
  exported prefix, independently read/hash/authenticate each selected record,
  and keep existing strict repository fork handling. Validate sequentially
  without retaining every historical body. Preserve all existing signed records
  and individually bounded v1/v2 placement; this is no history compaction.
- **Compatibility:** Explicit v2 APIs remain v2-only. Generic export chooses v2
  when it fits and v3 only for a typed v2 size refusal; other errors propagate.
  Import reports the actual schema; startup accepts typed v2/v3 with an
  independent anchor. Service migration validates/copies a v3 input as v3;
  existing small v1/v2 outcomes remain unchanged. No CLI migration operation is
  added. Old readers reject v3; their interoperability is not claimed.
- **Why:** Raising the cap just moves the same failure. Rewriting small signed
  children into parts would change existing placement/digests, and dropping
  predecessors would weaken history. Repository-only discovery would remove
  the explicit independently retained selector. Digest descriptors reuse the
  existing authority without adding a store, service or signed record format.
- **Exits:** A generic export of the measured over-bound aggregate becomes a
  bounded v3 artifact; a catalog/key-free reader verifies the frozen exact
  metadata prefix and exact originals with the separate anchor. Test near-limit
  prepared records, valid suffix exclusion, post-head forks, missing/corrupt
  records/parts/attachments, unknown roles/schema/extensions, cancellation,
  typed-only fallback, destination preservation and v1/v2 compatibility. All
  checks and totals precede output creation. The bounded evidence now covers
  aggregate fallback, frozen prefix/suffix/fork behavior, corruption, parts,
  cancellation, compatibility and real daemon/CLI exact restore after deleting
  source/catalog/keys. The Unix near-limit fixture measured a 14,521,495-byte
  prepared v2 record and a 16,210,219-byte fact v2 record; the expanded
  30,734,625-byte v2 reference was refused and generic export emitted a
  3,014-byte v3 reference. A separate-anchor, catalog/key-free reader restored
  201 files / 3,847 bytes while the source remained available. This is the
  bounded large-prepared/near-limit-fact aggregate case; no exact prepared-size
  sweep was run. [Dated acceptance](real-project-corpus-acceptance-20261016.md#compact-recovery-reference-successor-bounded)
  records the combined Go pass and remaining limits. This is separate from packaging, metadata/catalog
  reconstruction, history-scale performance and release qualification.

### ADR-052: Reconstruct the operational catalog without inventing capture history

- **Date:** 2026-10-16
- **Status:** Implemented and tested for the bounded Phase 3 development
  scope; not release-qualified. The lost-catalog daemon/CLI journey and
  rev3 re-publication are recorded in the
  [dated acceptance](catalog-reconstruction-acceptance-20261016.md). The
  normative policy is in [Restore Manifest section 20.1](../requirements/restore-manifest.md#fresh-operational-catalog-reconstruction).
- **Problem:** Current import authenticates portable records and can repair a
  missing publication row against a staged root, but an empty catalog stays
  empty. Exact-reader restore alone does not recover the ordinary Library,
  Notes and search experience. Portable content/fact records also do not
  contain every original scan, observation or physical descriptor field.
- **Decision:** Reuse the existing Store-backed import and existing tables for
  one atomic authenticated reconstruction. Preserve stable content/fact IDs
  and exact revision/body/lifecycle records. Mark necessary new local FK rows
  as reconstruction provenance; leave sources LOST with opaque locators and
  scans incomplete. Preserve unknown facts honestly and refuse ungrounded
  required relations. Rebuild disposable search through existing index code.
- **Currentness:** A writable reconstruction requires the selected fact head
  to remain current for its parent under existing publication coordination.
  A later valid suffix is not silently selected. A retained root need not be
  the newest root publication; independent source snapshots still matter.
  Store-free historical read/restore is unchanged.
- **Historical captures:** Protection is already one current row per stable
  subject. Preserve the distinct signed manifests and recovery routes, and
  select that current row by authenticated publication order. Reversed import
  order must not turn a valid older capture into a conflict or replace the
  newer current content. Reuse identical shared immutable descriptions and
  other rows by exact comparison. This adds no protection-history schema.
- **Why:** Fabricating completed scans or live source locations would turn a
  recovery projection into unsupported evidence. A second recovery database
  or rewritten signed format is unnecessary for the grounded existing rows.
  A chat, fixture or publication-row-only import is not the missing outcome.
- **Exit:** With source and original catalog absent, use the existing CLI to
  populate a fresh catalog, browse retained names/subjects, read exact Notes
  and description history, search the rebuilt lexical fields, and verify
  exact takeout/restore. Prove replay, atomic conflict/corruption refusal,
  current-head fencing, historical-reader preservation and unavailable facts.
  No phase/release credit precedes that evidence.

### ADR-053: Authenticate catalog relations instead of guessing them during recovery

- **Date:** 2026-10-16
- **Status:** Implemented and tested for the bounded Phase 3 development
  scope; not release-qualified. Authenticated relation projection, refusal,
  replay and post-recovery publication evidence are in the
  [dated acceptance](catalog-reconstruction-acceptance-20261016.md).
- **Problem:** The reconstruction draft guessed representation ownership and
  access fields because signed subject mappings contain IDs, not the original
  catalog relation rows. Exact bytes do not prove these missing historical facts.
- **Decision:** Use one fixed, reserved, kernel-only typed-value profile of the
  existing METADATA_FACT contract. Sign the actual immutable FileVersion,
  admitted logical extents and required Representation rows, bound to the
  existing snapshot/root/subject mapping. Strictly validate these relations
  before the existing atomic catalog transaction. Keep them snapshot scoped,
  outside ordinary current metadata and cross-parent current-head comparison.
- **Compatibility:** This adds payload semantics while retaining the existing
  signed envelope, record kinds and catalog schema. Store-free exact recovery
  continues for old references; an old reference without grounded required rows
  cannot claim fresh-catalog reconstruction. No original record is rewritten,
  no provider is installed and no physical ownership is inferred from config.
- **Why:** Refusing every positive reconstruction would leave the requested
  Library/Notes recovery unfinished. Guessing ownership would make it unsafe.
  A namespaced authenticated fact reuses the existing authority and avoids a
  second operational store or general extension system.
- **Exit:** New publications reconstruct the lost catalog from authenticated
  relation facts and pass the ADR-052 ordinary CLI journey. Missing/mismatched
  witnesses refuse catalog writes; legacy Store-free exact reading remains
  available. The profile and replay/conflict/byte results require executable
  evidence before any completion claim.

## 9. Open gates before the release binary

| Gate | Blocks | Owner of the evidence |
| --- | --- | --- |
| Repository qualification spike (Kopia v0.23.1 with Restic/Plakar controls) — adoption doc §4 | the first release `RepositoryDriver` | `internal/repository` spike harness |
| MCP Go SDK revision with completed, reproducible license state | the MCP adapter pin | license/supply-chain review (adoption doc §9) |
| CLI framework review (cobra recommendation) | freezing the CLI binding | this document, section 3.1 |
| libmagic database digest pin | the bundled magic stage | release inventory (adoption doc §9) |
| Processor sandbox + first deterministic processor conformance | milestone 2 exit | `internal/process` |
| Capture hardening (retained-root, `openat2`/equivalent) | scanner output becoming authoritative | `internal/capture` / `internal/scanner` |

## 10. References

- [System Architecture](../requirements/system-architecture.md)
- [Core Kernel and Interface Requirements](../requirements/core-kernel-and-interface.md)
- [Driver and Processor Interfaces](../requirements/driver-and-processor-interfaces.md)
- [Core Protocol and Reference Userland](core-protocol-and-reference-userland.md)
- [NAS Vertical Slice Implementation Plan](nas-vertical-slice-implementation-plan.md)
- [Open-Source Adoption and Code Borrowing](../references/open-source-adoption-and-code-borrowing.md)
- [Documentation index](../README.md)


### ADR-054: Rank mixed search without concatenating entire components

Decision date: 2026-10-18. Status: implemented and locally accepted for the bounded development slice; not retrieval-quality or release qualification.

The existing fusion broker preserved membership and provenance but placed the
whole first component before later-only subjects. A high-ranked semantic hit
could consequently appear after hundreds of lexical matches. This obstructs
ordinary find-and-use even when both providers return valid candidates.

Use the versioned host rank-only policy in the QueryProvider contract:
`query.broker.fuse.v2`, `reciprocal-rank-fusion-k60-v1`. Reciprocal rank fusion
uses provider order instead of calibrating unlike scores; k=60 is fixed rather
than tuned to this corpus. The primary reference is
[Cormack, Clarke and Buettcher, SIGIR 2009](https://cormack.uwaterloo.ca/cormack/cormacksigir09-rrf.pdf).
The paper motivates the mechanism; it is not evidence for Cairn's recall.

Keep all authorized union members and original component/source provenance.
Use one contribution per subject per dimension, deterministic tie handling,
unchanged per-lane ceilings, and unchanged single-lane/fallback order. Apply the
existing current-subject authorization projection exactly once before the final
rank order; compact the surviving component ranks so stale/unresolvable hits
cannot cast a vote or shift visible relative ranks. Only original candidates
can survive this intersection; the ranking helper never grants access. Retain
the resolver's proven original-ID to canonical-SubjectRef mapping so supported
legacy index hits survive, while alias/stable duplicates cast only one vote
per component. Existing generations require no rewrite for this compatibility. No model,
reranker, raw-score blending, new dimension, schema, endpoint, durable ranking
state or automatic rebuild is admitted. Existing index generations and frozen
exports are not rewritten. Single-dimension search and lexical continuation
keep their existing order and policy.

Rejected alternatives: increasing semantic K leaves concatenation intact;
interleaving gives repeated cross-component matches no shared evidence;
blending FTS/cosine values assumes an unqualified calibration; a learned
reranker adds a provider/model and corpus-tuning work outside this slice.

Active phase: Phase 4 complete discovery. Normative requirement: content-store
§9.2 default host fusion and QueryProvider host ranking/provenance boundaries.
Executable exit: many lexical candidates plus a distinct semantic rank-one
subject no longer bury that subject behind the whole first lane, while bounded
membership, exact source/authorization facts and fallback order are retained.
Compare the unchanged retained real corpus and frozen queries before/after;
do not change labels, raise candidate limits or count fixture vectors as a
real semantic capability. This decision closes no core or release phase.

The [dated acceptance](mixed-search-ranking-acceptance-20261018.md) records
focused/broad checks and the unchanged actual BGE corpus comparison. Full raw
membership, identity and source evidence match; two queries change order,
including both upward and downward movements. The expected top-ten miss set
does not improve, so the result establishes the mechanism and compatibility,
not a general retrieval-quality gain.

### ADR-055: Refuse silently truncated semantic queries per request

Decision date: 2026-10-18. Status: implemented and tested for the bounded local
profile, including the real default-broker long/short continuation below.
This decision awards no discovery or release completion credit.

A long query can be accepted by the embedding worker while only its tokenizer
prefix influences the vector. Document truncation already has source-coverage
evidence; silently treating a partial query as the complete user's intent has
no equivalent user-visible qualification.

Discard a query vector explicitly reported as tokenizer-truncated before zvec
querying. Use an input-specific error that retains the existing invalid-query
classification and maps to `QUERY_INPUT_TRUNCATED` in the existing component
reason field. Explain the shorter-query action through the existing degraded
response and client message path. Egress refusals retain their higher-priority
message. Other available lanes continue, and this request-level refusal does
not revoke a verified generation or require restart.

This follows Phase 4's truthful discovery fallback and the QueryProvider
contract. It adds no model, index dimension, command, schema, provider method
or signed field; document truncation retains its separate coverage meaning.
Worker inference may already have run before coverage is returned; this is
refusal of the partial result, not a claim of pre-inference token checking.

Rejected alternatives are silent prefix ranking, guessing tokens from a browser
character count, and marking a healthy provider globally unavailable. The
executable exit is an explicitly truncated query with no zvec query, a visible
reason and available ordinary-search fallback, followed by a successful short
query without restart. Controlled provider cases must be identified as fixtures
and cannot qualify actual BGE tokenizer behavior or retrieval quality.

The first real-model continuation exposed another boundary: the ONNX factory
treated the typed query refusal as a fatal worker error even though the indexer
retained the generation. The factory now retains that one query-only refusal
only after its ordinary post-call admission, fence and live-context checks
pass. Changed assets/fences and other failures still invalidate the session.
Existing lifecycle tests cover both outcomes; the focused and tagged broad Go
suites pass. On the final native candidate, ordinary default-broker searches
run short → tokenizer-truncated long → short without restarting the daemon:
the long request has actionable DEGRADED guidance and available lexical output,
and both short requests succeed on the same real BGE/zvec generation. See the
[dated acceptance](daily-client-functions-acceptance-20261018.md#native-successor-and-real-local-semantic-continuation).
This qualifies only the stated request-isolation behavior, not retrieval quality
or the complete default/release profile.

### ADR-056: Compose Notes finding with Library search and returned evidence

Decision date: 2026-10-18. Status: accepted; source/build review and local
delivery complete, consolidated client interaction acceptance pending.
This is existing client/description maintenance,
not new scope or a phase/release completion award.

Notes filters the rows and bodies already loaded in that view. Raising its
list ceiling or hydrating every body would add cost without making it the
full-corpus query authority. When nonempty Notes text has no loaded match or
the list is partial, offer one explicit action into the ordinary Library search
in the same workspace. Disclose that Notes source/tag filters do not carry
over. Literal text must not silently become search operators; reuse the current
parser and refuse a conversion it cannot represent safely. Keep existing
workspace, navigation, busy and unsaved-draft guards.

The result's already returned source segments belong beside inspection, so
Details gains a default-closed, six-at-a-time view of those excerpts and their
present provenance fields. Page through returned segments without another
query or body hydration. Absent evidence creates no explanation, and semantic
similarity does not imply a literal highlighted match. Structured image
metadata retains its existing presentation. This adds neither a second Notes
concept nor another description record or search index.

The same review found two truthfulness defects in existing actions. Restore
preview must describe planned output rather than verified restored bytes;
missing counts remain unknown. Description confirmation must warn for actual
regular JPEG/PNG subjects, and the host must independently admit image input
before egress: eligible names, identity-checked bytes and the existing shared
image decode limits. A broad `image.bytes` grant never makes arbitrary file
bytes an image. Non-image extracted-text description remains available; corrupt
image input fails before the provider. Exact preservation and old records are
unaffected. No provider is installed or enabled by these repairs.

Rejected alternatives are another Notes search engine, automatic searches on
filter typing, copying matched/generated text into a second Note, mounting all
returned excerpts, broadening disclosure wording to excuse arbitrary-byte
egress, and treating a restore plan as completed verification. The executable
exits are a Notes miss followed by the existing Library query and exact takeout,
bounded returned-source inspection, truthful restore preview, and image/text
payload separation through the existing describe dispatcher.

### ADR-057: Retain exact user tags in existing saved retrieval

Decision date: 2026-10-18. Status: bounded legacy SavedView maintenance is
implemented and locally delivered, with the stated current-build fixture
browser checkpoints exercised. Owner data was not mutated. No core/release
gate is awarded.

A reusable retrieval should retain the Library's actual tag constraints.
Refusing them is safe but leaves a central daily operation incomplete. Store
one complete tag value as a JSON string after `tag=` in the existing `fields[]`;
repeated fields mean exact AND over current live annotation values. Preserve
case, whitespace and Unicode. Keep the existing record, save/update/evaluate
commands, workspace authorization and export freeze authority.

Intersect authorized lexical pages with one live workspace tag read before
applying the existing result limit. Pin the first admitted generation for the
whole evaluation. Reuse a private bounded lexical enumeration for tag-only
views; ordinary empty searches remain refused. No new index/table, provider
ABI, backend route, grouping primitive or query AST is introduced. Failed
reads or continuations return failure rather than a successful partial set.

Rejected alternatives are FTS prefix substitution, filtering only the first
bounded candidate set, silently dropping tags on save, pretending tags are a
durable album/playlist, and changing a live saved query's membership inside an
already frozen export. Older builds continue to refuse unknown conditions.
The exit is tag-only and keyword/structured/tag retrieval through save,
recall/update and the same view-backed frozen export, including exact values,
multiple tags, a match beyond the first candidate page and live tag changes.
Full canonical AST, portable SavedViews, LinkGroup and release gates stay open.
The frozen 15-source successor passes its focused and broad tagged Go checks,
native build and five client checks; receipts are under
`dist/product-saved-tag-retrieval-20261018/checks/`. Native SHA-256
`543f8a529f3982c273d3f5103acda1c644c4069e0ac646236545962817571ff1` runs as
PID 66200 (managed session 98478), with both owner index projections READY.
The client candidate is delivered locally with nine matching HTTP asset hashes
and index SHA-256
`90474066dd8601a5a7eaf76351e9de8728b8689b12346c5d9c97ed3669e981ad`; the
persisted configuration and twenty owner content identity tuples are unchanged.
See `promotion/native-runtime.json` and `promotion/web-delivery-result.json`
for the final runtime identity and unchanged before/after projections.
The preceding native binary and complete old Web tree are backed up. The first
native replacement attempt stopped on a transient process-exit observation;
the managed old session exited 0 and its PID and listener were confirmed absent
before replacement continued, with no extra signal or socket removal. These
delivery checks alone do not establish browser acceptance or close a
core/release gate. The later
[consolidated client continuation](daily-client-functions-acceptance-20261018.md#consolidated-current-build-client-journeys)
records the actual bounded save/update/recall/materialization and new-source
handoff checks, preserved driver failures and unrun limits.

### ADR-058: Bind modification-time discovery to the captured source fact

**Status:** Accepted, 2026-10-19; implementation and release evidence are
separate from this decision.

The lexical index used an observation's `ObservedAt` as its modification-time
facet, while Library rows read `mod_time` from captured namespace metadata.
A document last modified in 2020 and imported in 2026 could therefore appear
old in the Library but fail a search for files modified before 2021. A fresh
catalog reconstruction would introduce yet another observation timestamp.
Those timestamps are useful capture provenance, but cannot answer a source
modification-time question.

Read the existing captured namespace `mod_time` through one shared, pure
decoder for the lexical facet and Library projection. Missing or invalid time
stays absent without hiding the file from text search. Valid epoch and
pre-epoch times remain valid; fractional precision remains in the captured
metadata. The index uses its existing exclusive millisecond comparisons.
This needs no live stat, observation lookup, schema, endpoint, new date field,
processor, or recovery record.

Use the distinct `fts5-metadata-v5` lexical profile for the corrected feed,
retaining V4 text enrichment. Existing generations keep their recorded bytes
and digest and fail closed under current wiring until the ordinary rebuild
creates a new generation. Rewriting old index cells or retaining V4's digest
would obscure which timestamp produced a result. Substituting ingest time or
adding another operational metadata store would preserve the original error
or duplicate authority. Exact saving and recovery remain independent of a
searchable timestamp.

The bounded exit is ordinary daemon/CLI ingest of files whose captured
modification dates differ from today's observation time, correct existing
time-filter results and Library dates, and refusal of an old-profile generation
without modifying it. Missing/invalid time remains text-findable. This decision
does not close Phase 4, select a production repository, or qualify a release.

### ADR-059: Page authoritative current Notes and reproduce frozen takeout

**Status:** Accepted, 2026-10-19; implementation evidence remains separate.

A bounded description-history prefix cannot establish which revisions are
current: its next page may contain the successor that hides its final row.
Keep the legacy history read intact and add an explicit current-only, pageable
summary projection to the existing `description.list`. Determine leaves in
SQLite against the full chain, return no bodies, and bind continuation to one
read-consistent summary projection using the existing token authority. Catalog
changes invalidate continuation instead of silently splicing different states.
The global Notes list loads further pages explicitly; subject Details use the
same currentness authority. This needs no schema, durable cursor, processor,
index dimension or new surface. Increasing a history ceiling alone would retain
the error; fetching every long body would make ordinary browsing unnecessarily
expensive. Older services may visibly refuse the new fields; the client must
not fall back to calling a truncated revision a current Note.

A previously frozen export is also a useful unit of reuse. Keep history's
default action as verification, and offer a separate explicit action to write
those same frozen files into a newly specified empty destination. Reuse the
existing `export.apply` and automatic verification with the same manifest ID,
digest, members, names and sidecar policy; never reevaluate its SavedView or
rewrite its recorded target. The server retains no-follow, collision and
empty-destination enforcement. An uncertain write stays bound to its attempted
manifest and destination until verified; a new action cannot silently clear
that uncertainty. This is legacy flat-manifest client maintenance, not the
Phase 6 LinkGroup or manifest-successor admission.

The bounded exits are more than 1,000 descriptions with a chain crossing the
old ceiling, truthful continuation/currentness and source-bound body reads;
and history -> explicit new destination -> same frozen bytes -> verification,
with changed live view membership, occupied/symlink destinations and lost
responses handled without inventing success or a second write. No core phase
or release qualification follows from this decision.

### ADR-060: Continue saved retrieval and retain uncertain restore attempts

**Status:** Accepted, 2026-10-19; implementation and acceptance are separate.

A saved search that cannot continue beyond its first 200 matches stops the
ordinary find/select/use loop. Add optional read-only paging to the existing
`view.evaluate`, preserving the old unpaged input/result. Reuse the existing
lexical and exact live-TAG evaluation; do not translate stored conditions into
a different text search. Authenticate one ordered authorized-result projection,
view revision/definition, resolved workspace, lexical generation and relevant
TAG facts with the existing process-local continuation authority. Stream the
private bounded lexical pages, retain canonical identities plus one requested
window rather than all result bodies, and calculate exact counts/fingerprint.
An authenticated ordinal within that fingerprint is a disposable cursor, not a
durable view version or a second metadata service. Changed projections require
fresh evaluation. The first-party client appends only matching scope/revision/
projection pages and exposes restart after staleness; newer searches/navigation
retain their existing host-intent priority. Frozen exports remain separate.
The per-page full projection scan is an explicit development tradeoff; this
admission does not establish history-scale latency or release performance.

Closing the Restore drawer must not erase an unconfirmed write and silently
allow another destination. Keep that captured plan/workspace/digest/snapshot/
destination across close/reopen in transient client state. Offer status and
explicit continuation of that same original plan through existing `plan.get`
and idempotent `plan.apply`; never replan, reroute or infer fresh byte
verification from a stored completion flag. If status says no execution was
recorded, label an explicit same-plan retry as a possible write; if it names an
existing execution, the kernel remains the sole reconciliation authority.
Failed or mismatched status leaves the attempt unresolved. This neither adds a
persistent attempt log nor enables general reprocessing.

Exits are >1,000 eligible saved matches with exact TAG/structured conditions,
no duplicates, stale/tampered/expired refusal and current host selection/use;
and lost restore response -> close/reopen -> original-plan confirmation with
no second destination plan/write. These are existing Phase 4 discovery and
legacy SavedView/restore maintenance, with no durable schema, provider ABI,
endpoint, processor, index dimension or recovery-record change. LinkGroup,
canonical-AST/portable SavedView, full media and release gates remain open.


## ADR-061: Close existing describe-authorization and recovery-artifact entry gaps

Status: Accepted, 2026-10-19. Implementation evidence is recorded separately.

The Details Notes flow already confirms and stores on-demand describe candidates,
and the daemon already binds installed describe providers. Settings lists only
embedding profiles and creates only DOCUMENT/QUERY grants, so the ordinary owner
cannot issue the DESCRIBE grant that Details needs. Add an opt-in, read-only
separate describe-profile projection to the existing provider list. Keep legacy
embedding rows unchanged; unreadable optional metadata is explicit. Settings
issues a separately disclosed DESCRIBE grant bounded by the installed profile,
and Details selects the grant matching its configured profile tuple. Listing,
configuration, permission and per-request confirmation remain separate actions.
This completes access to the existing operation without installing a model,
inferring generation from BGE, or adding an AI-client integration.

The required portable recovery record and independently retained public anchor
also exist only as headless operations. Compose their two explicit file exports
inside the existing Restore review, with saved-copy time/source labels and new
server file paths. Keep results independent: neither contains the repository
bytes, proves a separate failure domain, attests a valid pair, or changes the
health headline. Do not add a browser artifact-read endpoint, automatic import,
backup service or export ledger. This makes existing recovery evidence retainable
without asking an ordinary browser user to enter internal IDs.

The batch is Phase 4 description/local-client maintenance plus existing Phase 3
adapter composition. No durable schema, signed format, provider ABI, endpoint,
processor, index dimension or runtime loader changes. Full provider use needs an
explicitly installed configured healthy profile; the default stays unavailable.
LinkGroup, persistent media, full clean-reader porcelain and release gates keep
their existing contracts and implementation order.

## ADR-062: Complete folder intake and existing discovery setup affordances

Status: Accepted, 2026-10-19. Implementation evidence is recorded separately.

An ordinary owner should be able to choose a folder without losing the names
that distinguish its files. Extend the existing bounded multipart upload with
explicit `relative_files` parts; keep legacy `files` rewriting unchanged.
Strict relative paths are retained in one private request-scoped staging
directory. Conflicts and unsafe paths are refusals, never implicit renames or
flattening. Existing count/byte limits, receipts, partial-result review and
digest-bound apply remain the only intake lifecycle. Empty directories and
filesystem metadata are outside browser transfer. This adds input support to
an existing adapter, not a filesystem service, durable group or endpoint.

Image-query dispatch and installed description-profile discovery already
exist. Compose them where needed: a Photos action passes an existing image
subject to the host search path, and Settings lets the owner select a validated
installed description profile into the existing configuration draft. A failed
or unavailable image query retains the preceding result scope. Choosing a
profile does not save configuration, restart, grant network permission or
generate text; those remain distinct explicit actions. No optional image or
description provider becomes available merely because an entry is exposed.

These are existing Phase 2 intake, Phase 4 discovery/description and admitted
client maintenance slices. They introduce no durable schema, signed format,
processor, index dimension, runtime extension or AI-client integration. They
do not qualify a core phase or admit persistent albums, playlists or video.

## ADR-063: Make document body search the next substantial product milestone

Status: Accepted by the owner, 2026-10-19. Narrow CS-1/2/3 implementation
admission; the bounded implementation and local product acceptance are now
recorded in the linked milestone/task ledger. Core/release gates remain open.

The operator requests larger improvements to product capability. Prioritize
finding PDF/DOCX files from their body content, with a matched paragraph and
exact-original takeout. The current pack recognizes these formats but does not
extract their body text; plain-text search and existing optional CLIP wiring
must not be relabelled as new capabilities.

The [concrete milestone proposal](product-power-content-search-proposal.md)
defines extraction, real lexical/BGE retrieval, ordinary browser use and exact
takeout as one outcome. Reuse the existing extracted-text, source-span, index,
Notes and export authorities. Do not add a chat surface, second catalog/index
service, document reader or mandatory online model. New captures and ordinary
explicit recaptures come first; rerouted old-capture processing stays excluded
until separately admitted.

The owner approved the narrow PDF/DOCX exception to the new-processor
delegation boundary. The corresponding agent and normative extraction scopes
are updated. Review parser budgets, producer/profile bindings, route
selection and artifact/recovery compatibility before delegating implementation.
The decision changes no phase order and awards no completion credit.
Visual discovery and coherent reusable sets follow under their existing
separate gates; persistent media goals remain open.

## ADR-064: Deliver the existing optional image OCR as a complete retrieval workflow

Status: Implemented and locally delivered on Darwin arm64, 2026-10-20. The
owner-approved OCR-1/2/3 admission passed its real-model browser journey;
Phase 4 and release qualification remain open.

The delivered local outcome finds an image by text inside it, reads the
recognized text and takes out the exact original. The existing
`ocr.image.text.v1` and `rapidocr-ppocr-mobile-v1` capability is locally
available after explicit operator bundle preparation and daemon restart.

The owner approved the [bounded image-text proposal](product-power-image-text-proposal.md).
Deliver an explicit operator-run preparation/install script for pinned assets,
maintain the existing recognition and EXTRACT lexical/BGE path where real
execution reveals gaps, and show readable attributed OCR text and quality in
existing Details. Reuse the configured models root and compatible local
runtime. Installation, successful recognition and index readiness remain
separate facts; changed assets/rules retain distinct bound digests.

This is a narrow exception to the execution plan's deferred OCR packs. It adds
no processor, index dimension, public command, endpoint, schema, service or
runtime loader. It covers new image captures or ordinary explicit recaptures;
scanned-PDF OCR, CLIP and arbitrary old-capture processing remain excluded.
Exact saving and takeout stay independent of OCR, with honest unavailable,
empty, partial and low-confidence outcomes. Existing bounds remain unchanged.

The local exit passed once: ordinary image capture -> local recognition ->
explicit search preparation -> image-text lexical and real BGE paraphrase
retrieval -> readable OCR result -> length/SHA-256-matching original. Evidence
is `dist/product-image-text-20261019/client/attempt-02/result.json`; the local
postcheck is `dist/product-image-text-20261019/promotion/postcheck.json`. Mean OCR
confidence was 0.998004 (99.8% in Details); the exact original was 74,634 bytes
with SHA-256 `8a2fd4cc149d98b6cca5c6b2a6f2092ac664e57f58935a4849ce4b4b2d06bcfa`. Search preparation visibly returned `DEGRADED` because field coverage
for locators, tags, notes, descriptions and language remains incomplete, even
though all 21 selected text sources were indexed and both queries succeeded.
The corrected probability decoder and changed OCR profile/output digests do not
reinterpret prior records; older images need ordinary explicit recapture. This
decision changes no core phase gate or release qualification and keeps scanned-
PDF OCR, CLIP and automatic historical backfill outside the queue.

## ADR-065: Deliver visible photo-show and listening workflows over existing clients

Status: Accepted, 2026-10-20. Implemented and locally delivered with the
shared browser evidence in the product-experience ledger; no core-phase or
release qualification claim.

The owner requests substantial features that are immediately visible and useful
in a product demonstration. Complete two cohesive client workflows: explicit
timed photo slideshows with immersive presentation, and an immersive music
player with the existing transport and transient queue. Both remain inside
the current Photos/Music destinations and share host content, original access
and one audio player. The normative client refinement specifies their bounds.

This choice can deliver a visible result without inventing collection
membership, disguising a saved query as an ordered playlist, or bypassing
LinkGroup's prerequisites. Curated albums and persistent playlists retain
their separate proposed contracts. The existing CLIP delivery is separately admitted by the owner-approved
VIS-1/2/3 proposal. Its model and discovery evidence remain independent of
these presentation changes.

Keep preview budgets, verified-original audio, scope/focus continuity and
unavailable outcomes. Opening and closing the music layout must retain the
same audio element and Blob. Neither workflow creates a schema, processor,
endpoint, runtime loader, durable media fact or recovery authority. One shared
browser journey checks both complete workflows before local delivery.


## ADR-066: deliver visual retrieval through the existing local image space

Status: Accepted by the owner, 2026-10-20; implemented and locally delivered.
Real-model browser and owner-instance readback evidence is recorded in the
[visual-search proposal](product-power-visual-search-proposal.md#local-delivery-evidence-2026-10-20).
This does not qualify a core phase or release.

Users often remember what a photo shows rather than its filename or visible
words. OCR and BGE text retrieval cannot honestly substitute for visual image
matching. Deliver the existing Chinese-CLIP profile and its separate image
space, with a scene-description field in Photos and the existing image-query
action. The host owns both operations, authorization and returned results.

Prepare and install pinned local assets explicitly, restart, then explicitly
build a fingerprint-bound image generation from authorized saved PNG/JPEG
originals. Rebuilding this derived index is distinct from historical processor
reprocessing; source bytes, processor facts and earlier generations keep their
identities. Missing visual models leave lexical search and exact takeout usable
and produce a visible unavailable result, without pretending text-only results
are visual matches. No implicit downloads or remote image inference are added.

This reuses the present provider, index, dispatcher and original-download
contracts rather than adding another search authority, service or schema.
Darwin arm64 local delivery is the admitted initial scope. The selected
community ONNX conversion has no separate license declaration; retain its
provenance and uncertainty alongside the pinned base-model declaration. Local
use evidence is not redistribution or cross-platform release qualification.

Acceptance uses independent neutral-named real photos and distractors: Chinese
scene retrieval, image-to-image ranking, then exact SHA-256/length original
takeout through the ordinary browser, alongside the admitted media client
journey. The proposal and normative discovery admission govern the bounds.


## ADR-067: Give Photos and Music their own interaction hierarchy

Status: Accepted, 2026-10-20; implementation in integrated browser acceptance.

The operator wants a comfortable professional photo/music product over one
trusted personal-content plane. Adding separate rows for every admitted
capability made content harder to reach. A narrow-layout search input also
expanded vertically because a desktop flex basis became a column height.

Keep the current destinations, host query scope, content/fact authority and
verified player. Photos leads with pictures and a compact search location;
scene retrieval and local name/tag filtering remain distinct, with their own
inputs and visible active conditions. Music leads with Songs/Albums/Artists
and play/shuffle actions, while the current track opens the existing full
player. Existing density, filters, recorded source dates, ordering, selection
and original takeout remain reachable through labelled disclosures. Loading,
unavailable states, active scope and incomplete result notices stay visible.

Borrow interaction patterns from the official Photos, Immich, Navidrome and
Music references in the [interface review](../research/private-drive-interface-reference-20261012.md#photos-and-music-interaction-refinement--2026-10-20).
Do not import their full feature lists as obligations: persistent albums or
playlists, recommendations, faces and extra metadata extraction require their
own contracts. Layout specialization cannot create another query authority,
media service, schema, processor, plugin runtime or recovery plane. Unknown
music facts and photo dates retain honest fallbacks instead of decorative facts.

This makes existing capabilities easier to use without duplicating backend
policy or weakening exact-original verification. The exit is one shared
browser journey across photo search/filter/view/return and music browse/play/
queue/immersive return at wide and narrow widths. The Cairn testing skill
applies; no unrelated backend regression or core/release completion is implied.

## ADR-068: Reuse ordinary files for bounded organized-result snapshots

Status: Accepted for ML-1 implementation, 2026-10-21, following the owner's
explicit instruction to implement the material/Notes/Skill/list loop.

The product direction is to organize existing material once and let people or
programs reuse that result without another AI call. The current kernel has
exact capture, Notes, discovery and takeout, but no generic current-document
replacement transaction or guide-aware organizer. A service container such as
Cordis would not supply those missing data semantics.

Adopt the [ML-1 ordinary-file client contract](material-list-client-contract.md):
one bounded JSON result with ordered exact references and contextual text,
optionally retaining the exact Skill text used. Keep Note/TAG context copying,
manual arrangement and explicit external-AI copy/paste in one focused editor.
Save generated JSON and Skill text through ordinary reviewed capture; reopen
through a bounded, identity-checked reader. An ordinary program can read the
same JSON without any model invocation.

Choose explicit result snapshots for the first delivery. A revised result is a
new ordinary capture, preserving previous inputs/results. Do not invent a
current-list head, overload DescriptionDocument/Annotation with hidden
membership, reinterpret LinkGroup/SavedView/ExportManifest, or mutate source
Notes and Tags. Digest plus length pins original bytes; local handles are
lookup hints, and unresolved members remain visible within the stated loaded
scope. The reader's takeout uses existing original verification.

This narrower decision ships useful composition without adding a database,
endpoint, processor, runtime loader, scheduler or AI execution engine. It does
not reject the broader guide/refresh design: persistent heads, concurrent
replacement and automatic organization need their own reviewed successor.
The [normative client admission](../requirements/first-party-client-experiences.md#ml-1-ordinary-material-list-snapshots)
defines limits and one integrated user journey; no phase or release gate closes.
