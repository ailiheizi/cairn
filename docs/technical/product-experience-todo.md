# Product Experience Todo

> Current entry point for the informative client progress ledger. This page is navigation, not a new plan or a normative status source. The Core MVP Execution Plan remains the only implementation order.

## Current direction

### Function-level delivery and board (updated 2026-10-22)

Use the [Cairn Linear board](https://linear.app/ailiheizi/project/cairn-15f834de8536),
[function delivery plan](../superpowers/plans/2026-10-21-cairn-focused-delivery.md),
the [Chinese function overview](https://linear.app/ailiheizi/document/cairn-功能交付能用什么补什么交付成什么样-1fa39dca65df),
and [mature-product capability comparison](../references/functional-capability-comparison-20261021.md).
The 67-row draft has been consolidated into **28 functional deliverables and
127 subfeature states**. Design and necessary validation belong inside each
feature. Pure research and release records are not active product tasks.
The Core MVP Execution Plan still owns core phase order.

| Delivery position | Function | Current scope |
| --- | --- | --- |
| Existing delivery | F09 / [AIL-5](https://linear.app/ailiheizi/issue/AIL-5), ML-1 | Ordinary saved list snapshots, locally delivered |
| Existing delivery | F10 / [AIL-6](https://linear.app/ailiheizi/issue/AIL-6), ML-2 | Saved-list playback and unique takeout, locally delivered |
| **Next client candidate** | F15 / [AIL-54](https://linear.app/ailiheizi/issue/AIL-54), complete Music use | Todo; browse/listen/queue/save/reopen over shared host; design for review |
| Then | F14 / [AIL-49](https://linear.app/ailiheizi/issue/AIL-49), complete Photos use | Backlog; view/annotate/save selection/takeout/return |
| Then | F16 / [AIL-58](https://linear.app/ailiheizi/issue/AIL-58), complete interface choice | Backlog; derive the smallest compiled seams from Music/Photos |
| Retained sequence | F11 / [AIL-8](https://linear.app/ailiheizi/issue/AIL-8), then F12 / [AIL-10](https://linear.app/ailiheizi/issue/AIL-10) | Skill reuse remains planned; integrated AI still requires its contract/admission |
| Relevant capability gaps | F03 global retrieval | Resolve actual misses affecting the chosen workflow |

The owner requested planning a shared server and specialist client applications
on 2026-10-22. The [detailed product-form design](../superpowers/specs/2026-10-22-server-client-product-form.md)
is for review. This changes client priority, not the core phase order. No new
architecture/testing issue is added and no runtime plugin or media service is
admitted. Source inspection confirmed Music already has metadata browsing,
queue controls and sleep timer; the selection-to-list/reopen handoff and
interaction hierarchy are the chosen delivery seams.

AIL-7 and AIL-9 are retained as merged records, not standalone design tasks.
No product implementation is active during this requirements/planning batch.
The [superseded complete idea draft](../history/whole-product-planning-draft-20261021.md)
preserves historical goals; its rows are not another queue. Canceled planning
cards mean merged or documentation-only, not successful feature completion.

Read-only source inspection confirms standalone text saving, Skill selection
and frozen guide capture already exist. The proposed refinement uses one
ordinary guide with corrections merged into it; it must not rebuild those
capabilities or introduce a second instruction type. See the
[design for review](../superpowers/specs/2026-10-21-skill-reuse-design.md).
If no actual gap remains, document the current combination and move on.
Design status does not authorize new interfaces, an executor or a current head.

At most one complete feature enters implementation. Each continuation names
the functional result, existing subfeatures, actual gap and normal-use finish.
Unrelated tests, platforms, refactors and
new surfaces do not enter the batch. Completion requires evidence, review and
commit/push; update this ledger and the same Linear issue together.

After the repository review, the owner selected the bounded material/Notes/Skill/list client loop. ML-1 snapshots and ML-2 playback/takeout actions are implemented with local evidence below. Their [normative admission](../requirements/first-party-client-experiences.md#ml-2-use-saved-lists-through-existing-host-actions) and [client contract](material-list-client-contract.md#use-saved-lists-ml-2) reuse ordinary files and host-owned actions without changing the core phase gates.

The broader product direction remains reuse of ordinary stored material—originals, descriptions, Skills, and program-readable lists—with repeated corrections retained in an ordinary document. ML-1 implements a bounded JSON result snapshot; persistent current-list heads, automatic refresh and an integrated AI executor remain proposals in the [2026-10-20 research](../research/skill-driven-content-substrate-and-qa-20261020.md) and [material/list draft](material-list-and-guidance-draft.md).

The earlier Photos/Music interaction polish is paused, not complete. Its remaining acceptance and delivery state is preserved under [the focused Photos/Music batch](../history/product-experience-ledger-through-20261020.md#active-batch--focused-photos-and-music-interaction-2026-10-20). OCR and visual-search work has local delivery evidence, with limits and unresolved qualification gates recorded in the [searchable-content batch](../history/product-experience-ledger-through-20261020.md#active-batch--saved-content-to-searchable-content-2026-10-19) and [media/visual-discovery batch](../history/product-experience-ledger-through-20261020.md#active-batch--personal-media-presentation-and-visual-discovery-2026-10-20). Those records do not qualify a phase or release.

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
