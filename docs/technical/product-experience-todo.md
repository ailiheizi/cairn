# Product Experience Todo

> Current entry point for the informative client progress ledger. This page is navigation, not a new plan or a normative status source. The Core MVP Execution Plan remains the only implementation order.

## Current direction — synchronized with Linear, 2026-10-30

Cairn is an **AI personal-content space**: find and use saved content more
easily, retain its source/context, and keep useful results as ordinary material
for later use. The immediate goal is an enjoyable single-owner self-hosted
open-source product. General AI execution, hosted signup and commercialization
remain future ideas. The [confirmed product decisions](../superpowers/specs/2026-10-30-input-first-private-space.md)
keep content on Home and a bottom-centered floating input above it; a generic
chat page does not replace the private space.

Use the existing [Linear project](https://linear.app/ailiheizi/project/cairn-15f834de8536),
[Chinese feature overview](https://linear.app/ailiheizi/document/cairn-功能交付能用什么补什么交付成什么样-1fa39dca65df)
and [28-card functional index](../superpowers/plans/2026-10-21-cairn-focused-delivery.md).
The original F identifiers remain stable. The historical 127 subfeature states
are an inventory, not 127 newly selected promises or a current completion score.
Each card distinguishes existing usable behavior, an actual gap, minimal reuse,
and the result the user receives. Core phase order remains unchanged.

### Current delivery sequence

| Position | Capability and existing card | User-visible delivery |
| --- | --- | --- |
| Latest locally delivered baseline | F02 / [AIL-39](https://linear.app/ailiheizi/issue/AIL-39) | Home content, floating input, expanded result and specialist-page entry feel continuous; draft/results survive returns; metadata stays on demand |
| Next whole feature | F01 / [AIL-38](https://linear.app/ailiheizi/issue/AIL-38) | Save files/text, understand progress and cancellation, continue review, then find and use the saved material |
| After that | F03 / [AIL-44](https://linear.app/ailiheizi/issue/AIL-44) | Close concrete retrieval misses and result-use gaps; show useful results first, matched source and advanced controls on demand |
| Alongside each delivery | F28 / [AIL-82](https://linear.app/ailiheizi/issue/AIL-82) | Product definition, current screenshots/walkthrough and Linear agree with what is usable; no separate testing/research project |

At most one whole feature enters implementation. F02's bounded baseline is now
Done after the named journey; F01 is the next Todo, followed by F03. Earlier F01/F03
In Progress labels were planning drift, not evidence that several batches were
running; they are now the ordered Todo successors. A completed baseline card
does not promise every mature-product feature or release qualification.

### Existing capabilities to reuse

- F09–F13: ordinary material/Notes/TAG/Skill/list snapshots, reviewed save,
  reopening, verified playback/unique-original takeout, explicit ML-3 model
  candidate and an offline program consumer. No separate list service or head.
- F14/F15: focused Photos/Music, selection-scoped saved results and shared host
  actions; the S1–S3 [desktop-Web plan](../superpowers/plans/2026-10-22-desktop-web-delivery.md)
  is retained as completed historical evidence, not the current priority order.
- F17: bounded actual video watching was delivered locally on 2026-10-29;
  [the Videos plan](../superpowers/plans/2026-10-29-video-viewing-room.md)
  limits it to explicit verified MP4/WebM originals up to 32 MiB. It is not
  Bangumi, a TV client, streaming/transcoding or an automatic downloader.
- The 2026-10-30 [floating-results plan](../superpowers/plans/2026-10-30-floating-results.md)
  records real retrieval -> adjustable ordinary list -> playback/ZIP -> review
  save -> reopen, plus quiet input/outside dismissal and exact loaded-media
  entry. Reuse its existing original-byte evidence, not a new save/export run.

### Milestone meanings

M1–M10 retain their IDs and are delivery themes, not an instruction to start
all ten or an alternative core execution order.

| Milestone | Current meaning |
| --- | --- |
| M1 | Material, Skill and reusable-result foundation; ML-1/2/3, not general AI |
| M2 | Current private-space and everyday-use convergence; F02 then F01 |
| M3 | Retrieval and context; F03 then only actual admitted F04–F06 gaps |
| M4 | Photos baseline: view, slideshow, selected result, takeout |
| M5 | Music baseline: sustained listening, transient queue and saved result |
| M6 | Coherent interfaces and compiled presentation contribution; not a runtime plugin platform |
| M7 | Bounded local video watching baseline; the former anime/TV title was too broad |
| M8 | Future composition examples, voice and external clients; not activated |
| M9 | Existing trusted storage/takeout/recovery plus remaining core work under its original gates |
| M10 | Local onboarding and truthful open-source presentation |

Future household, reading/research, calendar, voice and music-context examples
reuse ordinary material, Notes, Skills and lists where possible. They are not
new domain services in the active queue. Full themes can change layout and
interaction; current contribution remains trusted compiled code or restricted
presentation data. Runtime third-party code and a plugin store stay outside
scope. The shared Web implementation remains computer-first, with no current
native-wrapper, mobile or Linux/NAS detour.

## 2026-10-30 bounded delivery and plan synchronization

The current assistant return/entry refinement and its one named whole-feature
journey are recorded in the [same floating-results plan](../superpowers/plans/2026-10-30-floating-results.md#product-convergence-follow-up--2026-10-30).
The selected flow passed with draft/attachment retention, menu-first Escape,
explicit composer return and located media entry without focus theft or autoplay.
The FileList snapshot fix closes a real attachment intake failure. No new
capture/export/model mutation or broad test suite was run. Root and independent
Luna review found no blocking issue. Linear readback preserved all 28 functional
IDs and ten milestone IDs; F02 is the delivered baseline, F01/F03 are ordered
Todo, and F28 still owns the remaining current walkthrough/README work. This
synchronization grants no new scope or release credit.

## F13 offline program consumption — 2026-10-23

Implemented and locally validated: **saved ordinary list → offline program →
ordered context and explicitly supplied original matches**, without another
model call. The [Python standard-library example](../../examples/material-list/README.md)
keeps every occurrence, including repeats and unavailable members, and retains
the full parsed document and exact embedded Skill. Complete SHA-256 plus
logical length determines a local match; filenames and local subject hints do
not. A match describes supplied bytes at read time, not catalog availability,
server authorization or a signed recovery proof.

One combined offline journey used the retained 1,947-byte F12 saved list
(`cef1d8aaf6669ad3edffafaae9f3c8c5b84166f7b6e5bfcb0b6467a0b3d81ffd`)
whose identity had already been verified by saved-content readback, and the
previously exported Source-A/B originals. It read B → A with original context
and the 573-byte Skill intact. Labelled local variants demonstrated B → A → B
without deduplicating occurrences, visible missing members, rejection of
same-name wrong bytes, and clean malformed-guide/over-budget outcomes. The
same journey covered the two parser gaps found during review: deeply nested
invalid JSON and valid integer-valued numeric lengths. All retained inputs
were unchanged. No new capture, export or provider request was made.

Evidence: `dist/material-list-consumer-20261023/journey-result.json` and
adjacent per-case stdout/stderr; script SHA-256
`056e3fe623919698d2cb033cfd382f45af1a3c1b2fb0d16881bad7833d4177dd`.
Root inspected the diff and evidence; independent Luna review passed after
the bounded corrections. Only the selected consumer journey and diff checks
ran. No application build, broad suite, SDK, endpoint or durable format was
added; this grants no core-phase or release qualification.

## F12 candidate-flow design checkpoint — 2026-10-22

The owner requested the next feature after F11. Root and Luna inspected the
existing prompt/validator/composer and online description provider. No current
operation returns an ephemeral material-list candidate: `description.generate`
writes a subject description and cannot be repurposed for this task.

The [F12 specification](../superpowers/specs/2026-10-22-material-ai-candidates.md)
and [ADR-071](build-stack-and-architecture-selection.md#adr-071-admit-one-explicit-material-list-ai-candidate-operation)
define one explicit server-mediated candidate from the current draft and Skill,
followed by human editor acceptance and ordinary capture. They name the needed
new typed operation, immutable organizer profile and separate egress purpose /
data class. No model call, application build or test ran; this is design, not a
delivered capability. This design checkpoint preceded the owner approval
recorded below; the core phase gates remain unchanged.

## F11 Skill correction and reuse — 2026-10-22

Implemented and locally validated: **choose an ordinary guide A → merge a
correction B → review/save → explicitly reuse saved B next time**, while the
old result keeps A. The file selector now derives from its verified source;
editing clears the displayed choice and selecting A again rereads it normally.
The existing composer saves the new list and ordinary Skill together. The
[guide](../wiki/material-lists.md#correct-and-reuse-a-saved-skill) supplies music
and research-reading examples as plain text, not executable modules.

The current-build journey reused the retained ML-1 list/guide and Source-A/B.
One `plan.apply` captured the new 1,363-byte list B and 311-byte Skill B. Reader
reopening confirmed old list A still contains exact 174-byte guide A and list B
contains the distinct exact guide B. A later draft explicitly selected saved B
and closed without saving. Source identities and live Notes/Tags were unchanged.
The confirmed capture was retained across a narrow drawer-close driver repair;
no repeated capture or export occurred. Evidence:
`dist/skill-reuse-20261022/acceptance/journey.log`, `capture-success.json` and
screenshots; Web assets `index-DNw40pUM.js` / `index-CyK9lCIg.css`.

Root reviewed the code, examples, log and screenshot. Only the affected Web
build and the named full journey ran, with no backend rebuild or local-test
campaign. The temporary daemon stopped. Existing 64 KiB guide and exact-read
bounds remain; integrated AI, automatic refresh and mutable list heads are not
delivered. This client result grants no core phase or release qualification.

## S1 Music delivery — 2026-10-22

Implemented and locally validated: **displayed/selected Music tracks → ordinary
list → reopen/use**, retaining the single player across navigation. Music now
has scoped save actions and a clear route back to the existing Library/Reader.
Global selection tools in media pages disclose on demand; their count and
scope remain visible, and existing programmatic selection actions still open
and focus them. Ordinary Library actions remain expanded.

The integrated journey observed real audio title/artist/album facts, verified
playback, a repeated/reordered four-entry queue, one reviewed list capture,
Reader append to six entries and exact original ZIP takeout. The final-build
continuation additionally opened a composer containing only Track A despite
foreign selections, closed without saving, and retained source/position/queue
through Photos/Overview/Library. Prior successful capture/ZIP results were
reused after the layout refinement. Driver role/text corrections did not repeat
confirmed mutations. Evidence: `dist/music-s1-20261022/acceptance/journey.log`
and `screenshots/`; the isolated daemon stopped cleanly.

Only the affected Web builds and named journey ran. Server schema, processing,
endpoints, original verification and 32 MiB/1,000 queue limits are unchanged.
No core phase or release qualification is claimed. S2 subsequently reused the
same callback, editor/Reader and selection disclosure.

## S2 Photos delivery — 2026-10-22

Implemented and locally validated: **current matching selected Photos → ordinary
list → reopen/takeout → return**. View selected and Save selected photos as list
are visible together when photos are selected; secondary filters and global
selection tools disclose on demand. Foreign audio/text selections stay outside
the photo list. No second album or selection store was added.

The integrated journey used PNG/name filters, persisted Notes/Favorite,
Exhibition navigation/slideshow, one reviewed list capture and Reader reopening.
Taken-out Photo-A/B matched independently retained SHA-256 digests and lengths.
Back to results restored Photo-A keyboard focus, filter and selection. The
initial focus assertion inspected the Details highlight instead of browsing
focus; the actual return path passed without a code change. One continuation
driver repeated the successful ZIP once; both outputs were verified, while the
list was captured only once. Date labels report source mtime, not camera dates.
Evidence: `dist/photo-s2-20261022/acceptance/journey.log` and screenshots;
current assets `index-Ci2kVb7W.js` / `index-CyK9lCIg.css`.

Root reviewed the source and screenshots. Only the affected Web build and
named journey ran; no backend, model, schema or recovery change was made.
S3 subsequently checked layout continuity and documented the existing seam.

## S3 complete-interface delivery — 2026-10-22

The existing Workspace and Showcase now have current-build continuity evidence
and a worked compiled contribution example in the
[extension guide](client-experience-extension-guide.md). Both compose the same
host-owned content/actions/settings; focused Photos/Music keep their shared
immersive frame. Browser-local preference values do not automatically sync.

The read-only journey retained real Track-A query/selection, an unsaved Notes
draft and verified paused playback at 0.45s through Workspace → Showcase →
Workspace. Unknown stored interface choice fell back to Workspace. The saved
S1 list reopened both tracks and exposed takeout without another download;
Notes were explicitly discarded only after the switch check. No content
mutation occurred. The QA profile reported degraded semantic coverage, so this
proves layout continuity, not a qualified semantic installation. Existing
registry/render-failure boundaries were unchanged and not fault-injected.
Evidence: `dist/client-s3-20261022/acceptance/journey.log`, `journey.json` and
screenshots. Root reviewed the guide, source, log and screenshot; no new build
was needed after the documentation-only S3 changes.

S1–S3 are locally delivered. The later F11 continuation is recorded above;
native packaging, integrated AI and larger media remain conditional.
No core phase or release qualification is claimed.

## ML-2 delivery — use the saved result (2026-10-21)

Implemented and locally validated: **open a saved list → listen or take out its files**.
Implementation belongs to the existing Reader and host actions. It preserves
supported audio occurrence order/repetition, reports audio omissions, and uses
unique targets for frozen original takeout with explicit repetition semantics.
An unresolved member blocks whole-list actions and remains visible.

- [x] Ordered playback and queue append use the current verified player. The
  journey observed Track B's verified identity and advancing playback, then
  the six distinct queue occurrences `B,A,B,B,A,B` after append.
- [x] Unique-original ZIP takeout produced Alpha.txt, Track-A.mp3 and Track-B.mp3
  once each, with independent SHA-256 and length matches. Server export review
  opened with those three targets, then closed before preview or output write.
- [x] The mixed-list journey passed on the final frontend build. A saved list
  with one unresolved member retained both rows, disabled all four whole-list
  actions and left the queue unchanged. Root reviewed the code; Luna implemented
  and ran the shared journey.

Local evidence is in `dist/material-list-20261021/acceptance/ml2/report.md`,
`journey.log` and screenshots. Both ordinary list files were captured once;
driver path, text-case and scrolling corrections reused those captures. The
ZIP click initially obscured by the fixed header had not started an export;
normal scrolling made it reachable. The final journey passed without product
source repairs. Only the affected frontend build and user journey ran, with no
backend rebuild or broad regression suite. The isolated daemon stopped. These
results grant no core phase or release qualification.

The earlier post-ML-2 queue proposed two focused candidates in order: make ordinary Skill and
correction-document creation/reuse easier, then define an explicit AI organizer
that reads selected material/instructions and returns a reviewable candidate.
They are candidates requiring their own bounded contract, not authorization for
an AI runner, automatic refresh, a mutable list head or another platform. The
core phase plan remains the implementation authority. The 2026-10-22 client
queue above supersedes their immediate priority without deleting either goal.

## ML-1 material-list delivery — 2026-10-21

Implemented and locally validated: select saved files, copy live user Notes and
Tags as result context, retain an optional ordinary Skill text, arrange a list
manually or explicitly copy/import an external-AI result, and save through the
existing reviewed intake. Saved lists reopen with ordered occurrences, context
and instructions; resolved members use verified original takeout. Programs can
read the ordinary JSON without invoking AI. See the [user guide](../wiki/material-lists.md)
and [ADR-068](build-stack-and-architecture-selection.md#adr-068-reuse-ordinary-files-for-bounded-organized-result-snapshots).

The isolated whole-feature journey passed, including rejected foreign refs
leaving the draft intact, explicit save confirmation, reload/reopen, independent
SHA-256/length verification of both originals, and unchanged source Notes/Tags.
The revised-snapshot editor and light/dark/narrow layouts were checked after
integration. Targeted boundary checks rejected malformed and oversized inputs
and retained unresolved occurrences. The final read-only smoke confirmed the
list is primary and raw JSON stays closed by default. Evidence and screenshots:
`dist/material-list-20261021/acceptance/report.md`. The temporary daemon stopped;
no broad regression suite ran.

This delivers immutable result snapshots with explicit external-AI copy/paste.
It does not deliver a mutable current-list head, automatic refresh, an integrated
AI executor, semantic/image provider qualification or a closed core/release gate.

## Whole-repository review — 2026-10-21

The [review record](repository-structure-review-20261021.md) covers the browser,
Go client/server/config, scripts, documentation, editor instructions and bundled
dependency. Shared SavedView condition formatting, protection-axis interpretation
and review-workspace fallback now have single owners; Photos types no longer
depend back on their parent. Retired always-applied scope instructions and stale
architecture prose were corrected. Distinct recovery records, platform code,
historical migrations and boundary DTOs were deliberately retained.

The same review repaired command-body truncation and unbounded multipart
discard paths. The integrated current-build journey passed, including ordinary
upload/capture/search/exact takeout, Photos, Tags, duplicate protection,
selection report and SavedView recall/editor conditions. Focused request-limit
and rollback checks passed after that journey. Evidence and limits are in
`dist/repository-review-20261021/acceptance/report.md`; this is structural
maintenance, with no new capability, phase closure or release qualification.

## Structure cleanup — 2026-10-21

Implemented and reviewed: Photos card/viewer rendering and Music row/group
rendering now have feature-local modules; both reuse stable-subject target
deduplication. Single and queued tag actions share their preparation guards.
SavedView evaluation and condition parsing have one module and common query
preparation, while paged browsing and exhaustive export retain their distinct
semantics. Two unreferenced backend helpers were removed. Five older product
plans are explicitly historical and point to the current direction and sole
core execution order.

The selected isolated journey passed with current Web and daemon builds:
Photos viewing and contiguous selection, single/queued Tags with rereads,
Music grouping and actual advancing playback on one shared audio element,
suffix plus exact-TAG SavedView save/recall, then view-backed frozen export.
Both exported images matched independent source SHA-256 and length. The final
selection integration and playback confirmation reused successful captures,
Tags, SavedView and export results without repeating durable mutations.
Evidence: `dist/structure-cleanup-20261021/acceptance/report.md` and its logs
and screenshots. The temporary daemon was stopped after acceptance.

This is maintenance of existing capabilities, not delivery of the material/list
draft, resumed media expansion, semantic/image profile qualification, or a
closed core/release gate.

## Structure cleanup — 2026-10-20

Implemented: SavedView persistence and paged recall now belong to
`web/src/app/useSavedViews.ts`; frozen takeout and write/verify coordination
remain in `useExport.ts`, composed by the shell. The
[architecture map](webui-architecture.md) records this boundary. Current
documentation entry points are separated from the complete historical records.

The web build and isolated browser journey passed: save a retrieval, freeze
and verify takeout, reload and recall, then run the same ordinary search and
clear the recall claim. Both exported files matched independent source bytes
and SHA-256 values. Local evidence is retained at
`dist/structure-cleanup-20261020/acceptance/journey.json` and `journey.png`.
After an older daemon lacked the current paging reply, the same journey
continued with the current-source daemon and an explicit lexical rebuild;
confirmed saves and export writes were reused. This does not validate semantic
search, all pagination races, or release qualification. The owner previews
on 4648/4654 were not redeployed.

## Historical unresolved work

The full ledger is preserved in [Product Experience Ledger Through 2026-10-20](../history/product-experience-ledger-through-20261020.md). Unchecked items and their original evidence remain there. Major goals map to the current function plan; they are neither a parallel queue nor automatically complete. Start with its [open batch and priority record](../history/product-experience-ledger-through-20261020.md#active-batch--focused-photos-and-music-interaction-2026-10-20), [core gates](../history/product-experience-ledger-through-20261020.md#gates), [verification and honesty limits](../history/product-experience-ledger-through-20261020.md#verification-and-honesty), and [out-of-scope record](../history/product-experience-ledger-through-20261020.md#out-of-scope).

## Compatible historical anchors

These aliases keep existing repository links working. Each takes readers to the same detailed section in the historical ledger.

<a id="active-batch--intake-and-discovery-affordances-2026-10-19"></a>

- [Intake and discovery affordances](../history/product-experience-ledger-through-20261020.md#active-batch--intake-and-discovery-affordances-2026-10-19)

<a id="active-batch--personal-media-presentation-and-visual-discovery-2026-10-20"></a>

- [Personal media presentation and visual discovery](../history/product-experience-ledger-through-20261020.md#active-batch--personal-media-presentation-and-visual-discovery-2026-10-20)

<a id="active-parent-tasks--functional-completion-batch-2026-10-19"></a>

- [Functional completion parent tasks](../history/product-experience-ledger-through-20261020.md#active-parent-tasks--functional-completion-batch-2026-10-19)

<a id="active-product-todo--2026-10-09"></a>

- [Active product todo](../history/product-experience-ledger-through-20261020.md#active-product-todo--2026-10-09)

<a id="current-captured-time-product-batch--2026-10-19-implemented-and-locally-delivered"></a>

- [Captured-time batch](../history/product-experience-ledger-through-20261020.md#current-captured-time-product-batch--2026-10-19-implemented-and-locally-delivered)

<a id="current-discovery-function-batch--2026-10-19-implemented-and-locally-delivered"></a>

- [Discovery-function batch](../history/product-experience-ledger-through-20261020.md#current-discovery-function-batch--2026-10-19-implemented-and-locally-delivered)

<a id="current-notes-and-reusable-frozen-takeout--2026-10-19"></a>

- [Notes and frozen takeout](../history/product-experience-ledger-through-20261020.md#current-notes-and-reusable-frozen-takeout--2026-10-19)

<a id="function-first-photos-music-and-recovery-batch--2026-10-19"></a>

- [Photos, Music, and recovery batch](../history/product-experience-ledger-through-20261020.md#function-first-photos-music-and-recovery-batch--2026-10-19)

<a id="goal-backlog-compose-first-admit-necessary-gaps"></a>

- [Goal backlog](../history/product-experience-ledger-through-20261020.md#goal-backlog-compose-first-admit-necessary-gaps)

<a id="private-drive-daily-loop--2026-10-12"></a>

- [Private-drive daily loop](../history/product-experience-ledger-through-20261020.md#private-drive-daily-loop--2026-10-12)

<a id="product-closure-work-breakdown--2026-10-14"></a>

- [Product closure work breakdown](../history/product-experience-ledger-through-20261020.md#product-closure-work-breakdown--2026-10-14)

<a id="product-power-milestone-proposal--2026-10-19"></a>

- [Product-power milestone proposal](../history/product-experience-ledger-through-20261020.md#product-power-milestone-proposal--2026-10-19)

<a id="reuse-first-intake-and-discovery-continuation--2026-10-19"></a>

- [Reuse-first intake and discovery continuation](../history/product-experience-ledger-through-20261020.md#reuse-first-intake-and-discovery-continuation--2026-10-19)

<a id="saved-retrieval-and-restore-continuation--2026-10-19"></a>

- [Saved retrieval and restore continuation](../history/product-experience-ledger-through-20261020.md#saved-retrieval-and-restore-continuation--2026-10-19)

## F12 implementation admission — 2026-10-22

The owner approved the exact F12 scope, including the new typed operation,
organizer profile and distinct egress boundary. ML-3 is recorded in the agent,
client, provider and operation contracts. Backend and client implementation run
in parallel under the [single implementation plan](../superpowers/plans/2026-10-22-material-ai-candidates.md).
The owner authorized the existing local DSH Sub2API `deepseek-v4.1-flash`
connection for real-provider acceptance, using a credential reference only.
Connection metadata was found; no model call or feature acceptance has occurred.
No implementation or phase completion credit is awarded by these documents.

## F12 real-provider delivery — 2026-10-22

Implemented and locally validated: select ordinary exact saved material,
copy/edit Notes context and one Skill, explicitly inspect/authorize disclosure,
receive a separate AI candidate, use it in the ordinary editor, confirm one
capture, reopen the result and take out the exact originals. Settings > Notes
selects the installed organizer profile; private credentials stay server-side
references. Manual and external copy/paste organization remain available.

The real route was the owner-authorized local DSH Sub2API connection,
`deepseek-v4.1-flash`, with an honest `not-reported-by-provider` revision.
The passing journey used an immutable 8,192-output-token / 90-second profile,
explicit `ORGANIZE` / `text.material_list` grant, retained Source-A/B and their
copied Note, and an exact 573-byte corrected Skill. The candidate followed the
explicit requested title and B→A order, added request-based reasons, retained
the Note and Skill, and introduced no foreign refs. Candidate acceptance did
not save automatically. One `plan.apply` saved the 1,947-byte ordinary list and
573-byte ordinary Skill. Reopening did not invoke AI. Reading stored list bytes
through `content.open` → `content.read` verified SHA-256/length, title, order,
Skill and context. ZIP takeout independently matched Source-A (107 bytes) and
Source-B (103 bytes); source annotations remained unchanged.

Existing ignored evidence is in `dist/material-ai-20261022/acceptance/`:
`organize-success-05.json`, `capture-success-05.json`, `journey-success-05.json`,
`original-takeout-05.zip`, the saved-byte readback and local boundary-check
records, and `screenshots/f12-final-reader-with-reasons.png`. The boundary
continuation used local response interception only: cancellation/late response,
edited-draft staleness and foreign refs left the draft unchanged and created no
capture or actual provider request. It is client evidence, not real inference.

Four real provider requests occurred during development: a malformed response,
a valid but unchanged candidate from ambiguous instructions, a provider HTTP
520, and the passing explicit-Skill journey. The earlier protection-class
refusal sent nothing. No automatic retry or model call on reopen is claimed.
The upstream 520 remains a possible external failure; it is reported without
changing the draft or saving a candidate. Grants are per-run budgets and remain
live until expiry/revocation, not single-use tokens.

The existing grant-ledger CHECK-only migration was additionally checked with
one focused genuine-v27 migration test because the journey fixture had no old
grants to preserve. The test retained a prior DESCRIBE grant/revocation and
constraints while permitting ORGANIZE; the existing closed-vocabulary check
also passed. No broad Go/E2E suite, new test framework, model fixture claim,
core-phase closure or release qualification follows. The current ref resolver
uses the existing latest-workspace listing; its lookup cost can grow with the
catalog and is not a new indexed lookup capability.

Feature implementation and delivery notes were pushed to main in `27e99d5`; AIL-10 and the existing Chinese functional delivery plan now record this bounded result. The final documentation-only record adds no new application behavior.
