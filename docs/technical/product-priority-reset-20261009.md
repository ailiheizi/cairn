# Product Priority Reset — 2026-10-09

> Decision and schedule, not implementation evidence. This records the
> operator's request to prioritize missing daily capabilities over successive
> polish/test rounds. ADR-023 adopts the scheduling rule within the current
> lock. The admission proposals below are **proposed**, not unlocked features.
> The core execution plan and normative release requirements remain in force.

## Product center

**One person's content library: put readable files in, find them through
familiar clues, and comfortably use or take out their original bytes.**

The initial audience is a single self-hosting NAS/home-storage enthusiast.
Any readable file can be preserved within the declared capture scope; this
does not promise that every format can be parsed or played. Identity,
protection and recovery are essential trust properties. Deduplication and
compression are supporting benefits, not the primary daily task.

A finite daily-use target has five journeys: add/protect files, find them,
return to a named query, use supported content, and take out selected originals.
This is a product target, not a new release profile or a claim that these five
journeys are already complete. Tags and the single Notes surface support all
five; interface choice changes their presentation, not their meaning.

## Actual gaps rather than another feature inventory

The following is a source inspection on this date, not a new test result.

| User task | Existing capability | Material gap |
| --- | --- | --- |
| Put files in | Upload/drop files or inspect an explicit server directory, review a plan and explicitly save exact bytes | Folder upload, large intake efficiency and consistency need a concrete task audit; do not promise them from individual-file upload evidence |
| Find and explain a result | Lexical/structured and provisioned real local semantic retrieval, tags, Notes, supported text/image inspection | A saved query currently evaluates the lexical lane; it does not preserve the full fused-search experience |
| Return to familiar content | Durable `view.save/list/evaluate` exists | Its browser entry is inside Export; the UI saves only the submitted keyword query and clears local filters on recall |
| Organize context | Single-item Notes and multi-item tag writes exist | Multi-item Notes is absent, but does not outrank retrieval/takeout merely because it is easy to implement |
| Take out originals | Single-file browser download; selected/view -> frozen manifest -> server directory -> verification | Batch originals into the browser are absent. Server-directory export is already implemented for its local scope |
| Use photos/audio | Type lenses and bounded image/text preview, suffix-derived audio facts | No dedicated gallery/album, music playback, video playback or PDF reader. A lens is not the corresponding vertical application |
| Keep files together | Minimal LinkGroup is specified | No implementation; Phase 6 admission remains gated |

Source anchors: [browser view save/recall](../../web/src/app/useExport.ts),
[export drawer](../../web/src/components/ExportDrawer.tsx),
[selection actions](../../web/src/app/useSelection.ts),
[original download](../../web/src/lib/contentDownload.ts),
[typed view fields](../../client/command/data.go), and
[view evaluation/filter mapping](../../server/controlplane/view_export_ops.go).

`SavedView` is a dynamic query: restoring its semantics is the objective,
not restoring identical membership. The current `Fields` mapping admits
entry type, content identity, duplicate group, protection mode, suffix,
language, size bounds and modification-time bounds. It has no tag filter key;
client tag/type/month controls must not be blindly serialized into ignored
fields. A semantic hit set cannot be silently saved as an equivalent lexical
query. No rename/delete operation is promised by the current view API.

## Ordered work

The operator's follow-up on this date explicitly requires distinct, comfortable
photo/music page experiences. The concrete task queue is now in
[Product Experience Todo](product-experience-todo.md#active-product-todo--2026-10-09),
with the [photo/audio checklist](photo-audio-experience-todo.md). The existing
type lenses do not satisfy that outcome. Design/admission work happens during
Order 1; implementation remains bounded by the current lock and the reviewed
scope of each slice.

| Order | Result and owner | Entry boundary | Executable completion criterion |
| --- | --- | --- | --- |
| 1 | **Daily named retrieval**, Luna implements; primary agent reviews | Existing SavedView convenience flow, explicitly permitted while Phase 4/5 remain open; no new schema, operation or durable authority | From existing library/navigation, save a supported named query without opening Export, refresh and reopen it in a separate browser context. Supported structured constraints and scope survive; unsupported client constraints cannot be silently dropped; lexical/dynamic behavior is visible. Adding a matching item changes membership without changing the saved query |
| 2 | **Batch originals to the user's browser**, primary agent admits the contract, then Luna implements one bounded slice | Admission proposal A below; do not relabel existing server output or trigger many unobservable downloads | Select mixed files, review the frozen selection and download one archive. Extracted names/lengths/full SHA-256 match the frozen items; collisions are explicit; cancellation, missing data and corrupt data cannot yield a complete/verified success claim |
| 3 | **Supported photos and single-track listening**, primary agent admits narrow first-party scope, then Luna implements | Admission proposal B below; media exceptions are not currently unlocked | Supported photos have a comfortable next/previous inspection path; an admitted audio sample plays, seeks, stops when leaving and retains clear context. Unsupported/failed formats remain exact-preserved and downloadable. No albums, queue or new index dimension is implied |
| 4 | **Minimal coherent groups**, after its required gate/revision decision | Existing Phase 6 LinkGroup and export-successor requirements | Current file links, missing members, reuse across groups and frozen safe-path export survive authenticated clean import; deleting a link does not delete bytes |
| Later | Music albums/queues, deeper verticals, third-party plugins, further interface compositions | Each earns a reviewed user task and contract | No generic “everything” queue; useful first-party experiences establish seams before a runtime is standardized |

The first implementation slice's triple is: Phase 4 parallel existing-client
maintenance; content-store §§2/7.2 familiar-clue, content-first retrieval plus
the core plan's explicit existing-SavedView allowance; the Order 1 journey
above. It closes that local capability only, not Phase 4 or Phase 6.

Intake efficiency enters the next slot only if a real batch task exposes a
material blocker. Batch Notes, visual refinements and copy changes accompany
the relevant journey or wait. Existing tag and server-export paths are reused,
not rebuilt and counted again as new capabilities.

## Admission proposals to settle before unrelated polish

### A. Frozen selection to one browser archive

Purpose: close the missing batch takeout destination. Review an additive
archive materializer over a frozen manifest and host-authorized exact reads,
with bounded streaming/scratch, explicit names/collisions, cancellation,
identity validation and item/final receipts. Preserve the existing attachment
download and server materialization behavior. Establish how download planning
gets a target profile without inventing a server-directory write, and how
interrupted output is distinguished from a complete archive. Do not reuse a
partial browser stream as an exact verification receipt.

This is not implemented by the existing `downloadOriginal` helper. Its API,
resource and output-profile changes require review against content-store
§§7.3/7.4 and the adapter contract before implementation. Prefer no schema
migration; if a new manifest version or typed operation is necessary, review
compatibility, migration and old-reader behavior explicitly first. No second
policy, catalog or job state machine is allowed.

### B. Narrow first-party photo/audio use

Purpose: deliver actual supported-content use rather than calling type filters
a media library. Propose an explicit development-scope exception to the current
gallery/player exclusions; changing terminology to “original delivery” does
not create that exception. Review photos first, then single-track playback,
without requiring LinkGroup for these two elementary read-only tasks.

The proposal reuses subject identity and authorized reads. Photo navigation
uses current results and bounded previews. Audio access needs reviewed content
types, browser format limits, range/seek meaning, safe response headers,
resource bounds and lifecycle/cancellation. A partial range does not prove a
whole-file identity. Active content is not admitted for inline execution.
Transient viewing/playback state remains client state; no new durable
collection or metadata authority, thumbnail store or acoustic index is implied.
Future thumbnail artifacts and EXIF extraction require their own admitted
processor contract, not an assumption that those facts already exist.

Before implementation, the primary agent must reconcile the relevant
product/operator, content/access, API, execution-plan and AGENTS boundaries,
record compatibility/migration impact and define focused acceptance. If the
current exclusion is retained, record why and a concrete reconsideration
condition. Resolve these proposals during Order 1, before starting a different
polish round. They must not sit indefinitely behind unspecified “all tests”.
The Phase 4/5 release gates are neither removed nor declared passed here.

## Execution and verification discipline

One active implementation result at a time. Before delegation, give Luna an
allowed file boundary, the phase/requirement/exit-test triple, and a short
ordinary-user demo. The primary agent decides contract questions and reviews
the integrated result; follow-up changes are driven by actual findings.

Run focused checks for changed behavior and the broadest practical Go suite
required by AGENTS once for the integrated source cohort, plus diff checking.
Repeat only for relevant new changes or failures. Integrity, authorization,
cancellation and genuine regressions remain necessary. Testing is evidence
attached to the result, not a separate feature queue or a release claim.

Stop scheduling isolated button/copy/palette rounds, new Linux VM work,
package/license expansion and repository-candidate experiments as prerequisites
to local product progress. Retain their historical evidence and normative
release obligations. Address a demonstrated data-loss/security defect when
found; do not grow a new hypothetical-failure program.

## Consultation and primary-agent decisions

Two CLI turns used the existing Harness route `openainext / claude-opus-5-5`
through `dsh headless`, with tool execution disabled and a temporary overlay.
No global model settings changed. Luna separately inspected the current source
without editing or running tests. Retained prompts/responses are under
`dist/product-priority-20261009/` (`opus-response.md` and
`opus-followup-response.md`); they are advice, not authority or feature proof.

Adopted: finite daily journeys, retrieval/takeout first, early explicit media
scope decisions, and one demonstrable capability per iteration. Corrected:
SavedViews are dynamic and currently lexical; Phase 5 includes recoverability
and migration, not only deduplication; native browser players still cross the
current exclusion; ZIP needs an actual materializer contract. Rejected as a
priority: repeating already-working server export or adding batch Notes merely
to report another feature. No allocation percentage, demand claim or phase
completion is inferred from this discussion. This round changes scheduling
documents only; no product feature or test status advances.
