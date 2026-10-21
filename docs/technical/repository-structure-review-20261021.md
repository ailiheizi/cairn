# Repository Structure Review — 2026-10-21

This is an informative review of the current working tree, not a new product
plan, an assertion that every line is defect-free, or release qualification.
The review started on `main` at `d1750d916f198293bae84fb43ae9d6127e7ee86e`
with extensive pre-existing uncommitted work. Those changes were preserved.

## Scope and method

The review covered the non-ignored tracked and added source inventory across
the whole repository, rather than only the previously extracted UI modules:

| Partition | Baseline inventory and review |
| --- | --- |
| Browser client | 194 files under `web/src`, plus build, dependency and presentation-package inputs |
| Go client, server and shared config | 621 Go files, including 329 production files, across 33 package directories |
| Documentation | 163 files, including 143 Markdown files; entry points, authority and historical status reviewed |
| Scripts and repository support | 74 non-ignored script files, root files, agent/editor instructions, workflow and config |
| Bundled dependency | 59 files under `third_party`, including source provenance, patch note and license |

Inventory, import/reference analysis, duplicate-block candidates and Markdown
file-target checks covered these partitions. Manual inspection followed their
owning flows and every reported duplicate candidate; this was not a claim of
line-by-line formal verification of all files. Generated builds, caches,
databases, model bundles and retained local acceptance output were excluded
from production-source findings.

The initial scan found no empty source files or byte-identical complete
first-party production files. A scan of repeated blocks of at least 16
nonblank, noncomment lines and 450 characters produced 39 candidates. That
threshold is only a discovery aid: smaller shared policies were also reviewed.
The local production Go import graph had no cycle; the browser review found
no runtime import cycle or confirmed orphan runtime module. The Markdown
file-target scan found no missing relative target; it did not certify every
external URL or fragment anchor.

## Changes accepted in this review

- Saved retrieval lists and their editor now use one condition projection in
  `web/src/lib/savedRetrievalConditions.ts`, retaining the existing field
  encoding, translation, unknown-field fallback and formatting.
- Tags, duplicate review and selection reports now share protection-outcome
  ordering and answer interpretation in `web/src/lib/protectionAxis.ts`.
  Their requests, scopes, cancellation guards and local error presentation
  remain with the existing owners. A lexical generation must still have
  answered before its protection projection is treated as available.
- Tags and duplicate review share the status-to-workspace candidate order in
  `web/src/lib/workspace.ts`. Their existing browser-local preference and
  status request handling are unchanged.
- Photos' feature-local types now live in
  `web/src/components/photo/photoTypes.ts`, removing the children's type-only
  dependency back into the parent experience. The parent retains its type
  re-export for existing consumers.
- The command adapter now detects a body exceeding its existing 4 MiB limit
  before dispatch. Previously it could accept the valid truncated prefix.
- Multipart upload now refuses unsupported form fields and stops before
  draining a sticky refusal. The daemon session bounds discarded part content
  using its existing per-file allowance; exceeding that allowance rolls back
  the request. Small per-file skips can still be reported while subsequent
  valid files are staged. This bounds the discarded remainder separately
  from bytes already consumed by staging; it is not a new total-request byte
  limit. Staging remains unprotected until ordinary ingest is applied.
- `.cursor/rules/owned-surface.mdc` no longer always applies retired Inbox,
  OPDS and OpenSubsonic scope instructions. It points to the current guardrails
  and sole execution order. The WebUI architecture document also no longer
  claims that only StatusPanel issues scoped reads or copies an obsolete CSS
  import list.

No durable schema, signed record, endpoint, processor, model generation,
runtime extension mechanism or independent state store was introduced.

## Similar code deliberately retained

| Candidate group | Disposition |
| --- | --- |
| Command DTOs and storage/search projections | Explicit boundary mappings, not a second record authority; keep internal types out of the public command contract |
| Client/server socket framing | Separate transport ownership and error identities; bounds currently agree |
| Prepared/publication and recovery-reference records | Distinct signed objects, versions and locator/authentication paths; do not unify their formats by textual similarity |
| Plain and zstd repository repair | Shared safety steps currently agree; encoding, verification and receipts remain profile-specific |
| Latest-publication SQL in namespace projections | Head selection currently agrees; flat content, roots and provenance listings deliberately differ |
| Handler input checks and extractor result scaffolding | Existing common decoder/validator or ordinary per-owner boilerplate; no competing implementation found |
| Platform capture and ONNX peer handling | Build-tag alternatives with different operating-system guarantees and ABIs |
| Historical SQLite migrations | Upgrade history must preserve earlier schemas and their evolving constraints |
| Description refresh and pagination | Different lifecycle and stale-response guards, despite similar error cleanup |
| Bundle admission and online provider I/O | Shared mechanics with distinct profile, authorization and response policies |
| Independent acceptance drivers | Small setup/fixture patterns do not justify another test framework |
| Legacy `server/internal/plugin` | Explicitly deprecated reference prototype, with no production importer; active identification rules live in `internal/identify` |

Recovery-attempt validation, repository repair safety and source-head SQL are
real policies worth reviewing together if either copy changes. This review
found no current divergence in them. Extracting a broad abstraction solely to
reduce repeated lines would add risk without closing a demonstrated gap.

The pinned `go.mod` replacement for `third_party/zvec-go` is intentional and
documented by `CAIRN-PATCH.md`; it is not an accidental second dependency
implementation. The source copy was untracked at review time, so any later
delivery must include all intended source and license files. This review did
not stage or commit the unrelated accumulated work.

## Verification

The current Web build and daemon build passed. One isolated user journey
passed: ordinary upload and digest-bound exact capture, filename search and
verified original download, Photos viewing, a two-photo selection report,
Tags protection, exact-duplicate protection, and existing SavedView recall
and editor conditions. The 98-byte uploaded sample's SHA-256 and length
matched its returned original. Successful upload/capture mutations were
reused while correcting the acceptance driver's navigation and assertions.

Duplicate review preserved both subjects' `EXACT_FALLBACK` values and matched
the daemon's same-generation protection-axis queries. The command body cap
returned 413; unsupported multipart fields returned 400 and left the actual
catalog-parent inbox unchanged. Focused checks then covered the affected
no-dispatch/read-limit and rollback invariants, including the existing
oversized-file skip followed by a valid file and mixed-field count refusal.
No full test suite was run. `git diff --check` passed.

Commands, outputs, screenshots and limitations are recorded in
`dist/repository-review-20261021/acceptance/report.md`. Build output was
observed, but not retained as a separate log. The temporary daemon was stopped;
owner previews were not redeployed. Semantic and image model bundles were
absent in this isolated profile and remained visibly unavailable. Existing
media playback and recovery qualification evidence is not rerun or upgraded
by this structural review; no core phase or release gate is closed.

## Ongoing ownership

Use `docs/README.md` for authority and `webui-architecture.md` for browser
responsibilities. Keep shared pure projections in `lib`, flow state and
coordination in `app`, feature-local rendering/types with their media feature,
and transport handling in the adapter. Staging bounds remain daemon-owned;
repository identity and authenticated recovery remain below the client.
Historical records remain evidence, not parallel execution queues.
