# Content-First Product Decision

> Status: informative product decision, recorded 2026-10-05 and updated 2026-10-12. It clarifies the
> presentation and prioritization of the existing product contract. It does not
> add requirements, alter phase order, close a gate, or award completion credit.
> Normative requirements and the [Core MVP Execution Plan](core-mvp-execution-plan.md)
> remain authoritative.
>
> Decision records: the dated ADRs below, including the current ADR-035 public positioning and intake decision.

## Operator priority update (2026-10-14)

The operator's product priority is to help one owner **find content, use it or
take out exact originals, then tailor the client to personal habits**. Intake
and exact deduplication support that user loop. This restates presentation and
priority only; it adds no durable organization, backend/API behavior, or new
surface. Existing compiled layouts, registered Photos/Music presentations, and
selectable JSON color-theme packages are current client capabilities. Broader
packages that add pages or whole-interface compositions remain the bounded
design direction in
[ADR-032](build-stack-and-architecture-selection.md#adr-032-presentation-plane-extensions-with-a-closed-recovery-plane),
consistent with the shared client flows in
[ADR-021](build-stack-and-architecture-selection.md#adr-021-replaceable-bundled-interface-experiences-over-shared-client-flows)
and the fixed presentation composition boundary in
[ADR-028](build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition).
It does not mean runtime third-party loading, a plugin marketplace, or any
extension of the trusted recovery plane. This note does not change phase order
or grant implementation or completion credit.

The longer product direction is to make retrieval feel easier, make Photos and
Music more complete (including curated albums and persistent playlists), add a
dedicated retained-video experience, and give the operator more ways to shape
the whole client through presentation-only packages. These are future product
directions, not shipped capabilities or new implementation admission; any work
continues to require its existing contract and phase gates.

## Product promise

**2026-10-12 presentation decision:** the operator selected the familiar
category **a better self-hosted private drive**. Keep one personal space for
files, shared discovery/takeout and focused photo/music experiences. Ordinary
adding must feel like choosing files, not configuring a storage engine. See
[ADR-035](build-stack-and-architecture-selection.md#adr-035-private-drive-positioning-and-file-oriented-intake)
and the [mature interface reference review](../research/private-drive-interface-reference-20261012.md).
This supersedes the older public descriptor while preserving the trusted
kernel, declared capability limits and phase order.

The [ADR-036 library decision](build-stack-and-architecture-selection.md#adr-036-everyday-library-actions-over-the-shared-returned-scope)
turns this into the next existing-client slice: readable shared scope, easy
selection, one primary original-takeout action and secondary tools on demand.
Dedicated domain pages retain the same host authority and common actions.

**Audience:** one self-hosted operator using a NAS or home storage for their
own content. This is a selected direction, not validated market demand. Keep
Cairn as the working name; brand and traffic hypotheses remain
unvalidated.

**Product target: a self-hosted personal-content platform. Keep readable
originals in one place, find them through familiar clues, use each kind through
its own complete domain experience, and take originals out safely.**

The ordinary daily story is **intake → find → use → take out**. Traffic and discovery
are product hypotheses, not validated demand. Deduplication and compression
provide background value; exact preservation, visible failure, and recovery
closure remain the basic trust contract.

The first promise behind “anything” is: any readable file within the declared
capture scope can be captured and preserved exactly. Unknown formats remain
fully preservable when readable. This does not promise arbitrary parsing,
playback, URL capture, or application-state capture.

## Product shape

Cairn targets one content foundation with professional domain experiences.
Shared identity, tags, the single Notes surface, search, and export apply across
views. Existing media lenses are projections over the same content, not
complete photo/music applications. Complete domain targets and pending scope
reconciliation are recorded in the dated update below; this does not admit
new runtime or durable schemas.

| User job | Surface | Priority | Completion boundary | Exit evidence |
| --- | --- | --- | --- | --- |
| Add and protect files | Intake and protection flow | Now | Declared readable scope; exact outcome and failures visible | Accepted scope completes end to end; failures remain explicit |
| Recognize and retrieve content | All: mixed files | Now | Familiar clues across names, facts, Notes, tags, and supported search | Real content can be found through shared search |
| Inspect and organize an item | Details | Now | Preview, tags, Notes, provenance, protection, single-item export | Actions resolve to the same stable subject and visible state |
| Browse visual material | Photos | Next | Thumbnails and full-size support within admitted capabilities | Supported content opens; unsupported content says why |
| Browse audio files | Audio | Next | File browsing and declared facts | Honest file experience; no promise of full player, playlists, or album management |
| Operate and audit the library | Management | Now | Sources, duplicates, activity, verification, settings | Status and actions expose actual scope and outcomes |
| Use the interface | Workspace and content-showcase experiences | Now | Two bundled layouts over shared client state and typed operations; logical actions and policy stay shared while physical placement may differ under host review | Ordinary switching, unknown-choice fallback, injected rendering-failure recovery, and shared App state during a held status request are locally tested; see [interface acceptance](client-interface-experiences-acceptance-20261006.md#2026-10-06-continuation-in-flight-operations-and-render-failures) |
| Personalize presentation | Curated palettes and reduced-motion behavior | Secondary | Presentation choices support the layouts without changing shared content or operation meaning | Usability and status meanings remain clear |

Search, tags, Notes, and batch actions are shared capabilities across these
surfaces. Reliability work stays in the background while its state remains
visible to the user. A selected-in-version requirement must be accepted across
its declared support scope; an entry point, mock, or partial demo is not
completion. Deferred work need not ship in the first version.

## Priorities

| Horizon | Work |
| --- | --- |
| **Now** | Complete useful admitted Library/Photos/Music operations around intake, finding, organization, playback and original takeout. The operator's 2026-10-13 reset puts functionality before further visual redesign; ADR-041 and the functional target map below define the next work. Continue the core only in execution-plan order. |
| **Next** | Finish the remaining admitted daily journeys, then review curated albums and durable playlists against their data/recovery contracts and applicable gates. Existing dedicated gallery and bounded player implementations are early domain slices, not complete-domain acceptance. |
| **Blocked / deferred** | Full player, music video, listen/watch together, maps, free-form dashboards, URL capture, and broader media-platform behavior. Existing ADRs remain historical decisions; they do not override current priorities or implementation locks. |

This experience queue does not remove or reduce any normative MVP requirement.
The real local BGE semantic default and Phase 4–7 recovery, discovery, storage,
grouping/export, and release gates remain in force. The accepted 2026-09-28
ADR-015 decision remains in the history; together-mode is currently deferred
by this priority overlay. This record does not authorize a new product surface,
schema, API, signed format, or phase completion claim.

## Operator priority update (2026-10-07)

The operator confirms that current work is experience-first: use the local
Mac/browser preview to improve the existing intake, search, preview, original
takeout, and whole-interface choice. Docker is the selected deployment
direction, not a request to start Docker packaging now. The current experience
does not need a separate Linux VM/host qualification, archival/source/licensing
audit, or repository-candidate expansion as a prerequisite. Check platform or
container compatibility when a concrete deployment issue or release
requirement calls for it; this does not claim that containers remove runtime
or architecture differences and does not qualify container delivery.

This dated priority governs immediate scheduling, including older “work
currently admitted” and following-gates descriptions below; their recorded
Linux, package, and storage findings remain historical evidence. Continue
necessary regression, security, and correctness checks for changed user
workflows, preserve exact identity, recovery, phase, schema, and media locks,
and address any demonstrated data-loss bug. Gallery, player, and LinkGroup work
remain gated. This update adds no capability, requirement, or phase credit.

## Operator priority reset (2026-10-09)

The operator requests missing daily capabilities instead of successive small
polish/test rounds. [ADR-023](build-stack-and-architecture-selection.md#adr-023-daily-capabilities-before-successive-polish-rounds)
and the [priority reset](product-priority-reset-20261009.md) govern immediate
scheduling: daily named retrieval first, batch browser original takeout next
through an admitted materializer contract, then narrow photo/audio use through
an explicit scope revision. Resolve the latter proposals during the first
slice. Existing bulk tags and server-directory export are reused, not rebuilt.
Do not interpret the older maintenance lists below as a mandate for another
isolated polish round. This updates scheduling only; media/archive proposals
remain unadmitted and all existing phase/recovery/release gates retain meaning.

## Operator platform clarification (2026-10-09)

The operator asks for the useful functions and comfortable interaction of
specialist photo and music applications within the same personal platform.
The [research and detailed Opus discussion](../research/personal-content-platform-20261009.md)
and ADR-024 clarify the full target: Photos includes a timeline, real
renditions, continuous viewing and curated albums; Music includes
artist/album/track navigation, a controlled player, queue and playlists.
Their common tags, Notes, search, subject access, original output and recovery
remain shared. Higher-level processing, phone workflows, other domains and
extensions stay explicitly recorded as later capabilities.

The earlier “narrow photo/audio use” is a first implementation slice, not the
completion boundary for the full domain. Existing browse-only rows and
maintenance schedules in this document are historical current-contract
boundaries, not a reason to permanently shrink the target. The current media
exclusion, LinkGroup gates and immutable-byte authority still apply to code.
The next scope-reconciliation work must align the normative contracts and
implementation order explicitly; this informative clarification changes no
gate or implemented status.

## Current decision map

- [ADR-024](build-stack-and-architecture-selection.md#adr-024-complete-domain-experiences-over-one-personal-content-foundation) records the [complete platform target](../research/personal-content-platform-20261009.md). Photo albums and music artist/album navigation, queue and playlists are intended baseline workflows; a mosaic or single-track player is an early slice. Normative admission remains outstanding.
- [ADR-023](build-stack-and-architecture-selection.md#adr-023-daily-capabilities-before-successive-polish-rounds) adopts the [2026-10-09 priority reset](product-priority-reset-20261009.md): daily named retrieval first, followed by batch browser takeout and narrow photo/audio use through explicit admission reviews. No isolated polish round substitutes for those missing capabilities.
- [ADR-022](build-stack-and-architecture-selection.md#adr-022-whole-product-acceptance-across-the-shared-content-loop) and the [whole-product delivery target](whole-product-delivery-target.md) retain the complete single-person product outcome through staged implementation. A passing preview slice closes only its tested scope; the full objective remains open across unresolved discovery, storage, grouping, deployment and reviewed media-experience gates.
- [ADR-017](build-stack-and-architecture-selection.md#adr-017-content-first-daily-product-and-presentation-views): one content authority and task-focused views, rather than a separate catalog per vertical or a page per requirement. Identity, tags, one Notes surface, search, access, and export are shared under the [content-store model and user loop §§2/13](../requirements/content-store-views-and-exports.md#2-product-model).
- [ADR-018](build-stack-and-architecture-selection.md#adr-018-nas-first-content-hub-positioning-and-deferred-media-views): NAS/home-storage audience and deferred media behavior; [NAS direction](nas-content-hub-product-direction.md) records the unvalidated positioning.
- [ADR-019](build-stack-and-architecture-selection.md#adr-019-bundled-vertical-client-modules-before-a-runtime-extension-framework): official bundled experiences first; third-party UI ABI, installer, and framework remain deferred pending a stable seam and trust/security review.
- [ADR-020](build-stack-and-architecture-selection.md#adr-020-curated-color-palettes-as-a-presentation-sublayer): palettes are secondary presentation choices.
- [ADR-021](build-stack-and-architecture-selection.md#adr-021-replaceable-bundled-interface-experiences-over-shared-client-flows): full interface experience includes shell, navigation, content presentation, and bounded interaction placement; shared logical actions and policy may have different physical placement under host review.
- [Experience design](single-operator-experience-pack-design.md), [interface acceptance](client-interface-experiences-acceptance-20261006.md), [WebUI adapter architecture §2](../requirements/api-and-webui.md#2-adapter-architecture), and [interaction principles §6](../requirements/api-and-webui.md#6-interaction-principles) define the boundary and current evidence. The acceptance record applies to the bounded workspace/showcase implementation only. No multi-user or tenancy model is introduced; UI modules do not solve authentication.

## Ordered next work

1. **Immediate client functionality:** complete the admitted operations in the 2026-10-13 functional target map below. Local Luna agents own bounded implementation and proportional verification; the primary agent reviews decisions, diffs and evidence. Run checks for the changed journey and concrete residual defects. Earlier passing matrices retain their dated evidence.
2. **Core gates in parallel where permitted:** preserve the implemented and tested Phase 3 admitted development profile and continue from the current execution-plan checkpoint. Only after its portable record shapes are frozen may Phase 4 discovery packaging and supported-host/search qualification proceed alongside Phase 5 representative recoverable storage qualification. Existing implementation and candidate artifacts are inputs to that qualification, not permission to repeat completed work or claim release completion. Phase 6 LinkGroup work remains behind both Phase 4 and 5.
3. **Development preview and feedback:** start with a reproducible local trial on the current Mac, as clarified by the operator on 2026-10-06. Exercise deployment, add/find/use/export, and backup/restore without waiting for a Linux or NAS host. Collect actual supported-host evidence before making later Linux/NAS support claims; local trial results are development evidence, not release qualification.
4. **Later product polish:** gallery first, then music, after reviewed contracts and applicable core gates. Do not infer albums, players, new schema, or LinkGroup implementation from design work. Revisit runtime frameworks or interface counts only when a real workflow requires them.

Each implementation slice must state its phase, normative requirement, and executable exit test. Keep implemented evidence separate from qualified release claims.

The primary agent owns scope, contract decisions, and acceptance. Luna handles
bounded implementation slices with explicit file ownership; the primary agent
reviews integration and current-build evidence before updating status. A
vertical feature list, supported-format matrix, or public plugin contract is
refined at its reviewed stage, rather than treated as already frozen by this
direction document.

## Appeal and evidence

The experience should make content recognizable, show content directly on the
first screen, keep hierarchy, density, and typography consistent, work with a
keyboard and on narrow screens, and use short, honest status language. An
ambiguous failure must remain visible. Opening must not be blocked by an
intro, decryption ceremony, or looping animation.

The operator-supplied [Bilibili visual reference](https://www.bilibili.com/video/BV1fWYW6SEw6/)
(and optional author [RhineLabUI project](https://github.com/LBEILC/RhineLabUI))
is visual inspiration and demo reference only; this records the supplied links,
not a claim that they were viewed or that their code is adopted. The client
should develop an original visual language and must not reproduce protected IP
assets. The reference's popularity is not evidence of Cairn demand.
Promotion should demonstrate mixed-file intake → retrieval
from familiar clues → original export. Value, appeal, and retention require
feedback from real users; traffic success must not be claimed in advance.

## Scope discipline

Register requirements and record their disposition, but do not create one page
per requirement. Pages and views should follow continuous user tasks; shared
capabilities should remain shared. Keep the established requirement matrix and
phase gates as the acceptance authority. Record implemented, planned, deferred,
and blocked work honestly, with evidence attached to the actual scope.

## Local continuation

The [2026-10-06 local continuation](local-completion-acceptance-20261006.md)
records 8 MiB explicit image inspection with 1 MiB thumbnail bounds, current
real retrieval checks, measured recoverable storage, and verification fixes.
Retrieval and takeout remain the product center; compression is auxiliary.
Neither these local checks nor a polished interface closes release gates.

## Bounded browser maintenance evidence

A bounded client polish slice is implemented and tested. It adds suffix-derived
type icons and format cues; readable localized size, type, and format metadata
with ellipsis and a full-title affordance; visible Photos/Audio scope captions
with keyboard-accessible details; and responsive toolbar wrapping from 901 to
1199 px. It adds no tile reads, providers, backends, schema, players, or state
machines. This is maintenance of the current browser adapter, not new core
capability or release qualification.

The isolated mixed-content visual E2E used a temporary daemon and the current
build. Synthetic inputs included PNG/JPEG, text, opaque PDF/ZIP/audio, and an
invalid-image fallback. At 1496, 1280, 1199, 1120, 1024, 707, and 390 CSS px,
there was no horizontal overflow and the first content row remained visible;
at 1280 px it began within 260 px. Screenshot review covered All at 1280 in light and dark themes, All/light at
1120, 1024, phone at 390, List at 1496, and Photos at 1280. The 1120 capture
settles resize before taking the screenshot; fresh-page and resized captures
showed one topbar within x=28..1092 and y=10..84, with scrollY=0 and document
width 1120. The final mixed visual QA passed after this capture-only timing
adjustment; production code did not change for it. The E2E assertions and
screenshots establish only the stated fixtures, viewports, and client behavior.
They do not demonstrate parsing or playback of opaque formats, demand, appeal,
retention, or any core phase or release gate.

Reported validation passed: `npm --prefix web run build`,
`node scripts/web-i18n-check.mjs` (1498 merged keys / 44 TSX files),
`git diff --check`, Chrome online/offline/recovered E2E with
`CAIRN_PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' CAIRN_WEB_E2E=1 scripts/web-e2e.sh`,
`node scripts/web-content-visual-e2e.mjs`, and the independently run
`go test -tags purego ./...`. The latter is a repository-level check, not proof
of a browser feature or release qualification. The prior browser slice and its
separately scoped evidence remain historical.

## Core loop follow-through

The 2026-10-05 follow-through makes ordinary new intake start with file upload,
adds individual-file drop into the existing staging/review flow, and keeps
server-folder and staged-source review available. Staging remains unprotected
until an explicit digest-bound `STORE_EXACT` confirmation. Original download
uses the existing content-session contract and native browser streaming with
complete identity validation. These choices give users familiar input and
output actions with bounded memory and visible outcomes.

Real packaged semantic install/restart/query, full Darwin and isolated Linux
Go checks, focused race checks, and the combined Chrome online/offline/recovered
workflow passed for their stated development scope. Exact commands, fixture
limits, the unresolved Linux fixture finding, local candidate artifacts, and
the still-open release gates are recorded in
[Core Preview Acceptance](core-preview-acceptance-20261005.md).


## Open-ended client experiences — 2026-10-09 successor

The operator's ceiling is open-ended: complete domain experiences, unusual
content presentations and replaceable whole interfaces share one personal
content foundation. Keep a simple default and add useful reviewed experiences
without another policy/catalog/recovery authority. This does not mean unlimited
resource use or automatic support for every format.

[ADR-026](build-stack-and-architecture-selection.md#adr-026-open-ended-bundled-experiences-with-one-host-authority)
records two actual DSH CLI Opus5.5 consultation turns and the selected tradeoffs.
[UX-E2/M2](../requirements/first-party-client-experiences.md#7-ux-e2m2-open-ended-bundled-pages-and-everyday-listening)
admits compiled page/shell registries, a bounded moving-window Exhibition,
existing-fact artist/album browsing and transient queue controls.
[The acceptance](open-ended-client-experiences-acceptance-20261009.md) distinguishes
actual local implementation from full-domain and release gaps. The
[contribution guide](client-experience-extension-guide.md) explains the current
source extension seams. The [RW-MEDIA-2 proposal](media-experience-successor-proposal.md)
prepares large-image previews, covers and durable albums/playlists separately;
it grants no implementation admission. Runtime packages and a public SDK remain
later reviewed milestones. Earlier “Next” tables describe their dated scope;
the admitted client successor and active todo are the current experience map.

## Convergence addendum — 2026-10-10

The product is now in a convergence phase: finish and polish the admitted
core loop and first-party client surfaces (Photos, Music, Overview) before
adding new scope. "Runtime packages and a public SDK remain later reviewed
milestones" above should not be read as a near-term plan — a runtime
third-party plugin marketplace (installable third-party extensions, a public
extension ABI, or a plugin store) is explicitly out of scope for this phase,
consistent with ADR-026/028. The compiled, in-repo `CaptureDriver` /
`Processor` / `RepositoryDriver` / `IndexProvider` / `QueryProvider` contracts
in [plugin-system.md](../requirements/plugin-system.md) are a separate,
already-admitted extension seam for first-party/reviewed implementations and
are not affected by this addendum. MCP/CLI/AI-harness integration is deferred
until after this convergence phase. See `AGENTS.md` for the current
guardrails.

## Functional target map — 2026-10-13

The operator asked to finish missing functionality before another visual
redesign. [ADR-041](build-stack-and-architecture-selection.md#adr-041-complete-useful-client-operations-before-further-visual-redesign)
records the decision. This map retains the complete product target while
distinguishing client work that can run now from work requiring a reviewed
successor; it grants no admission or completion by itself.

| User job | Next concrete capability | Implementation boundary |
| --- | --- | --- |
| Organize the same files from any destination | Add an absent tag, remove a chosen tag, explicitly favorite/unfavorite a captured selection; ordinary-Library inclusive range selection | Existing annotation commands, complete reads, expected revisions and shared selection; current functional wave |
| Listen comfortably to the files already saved | Local title/artist/album/track/duration/size order, readable eligibility filter, insert as next occurrence | Existing recorded facts and bounded verified original player; current functional wave |
| Use a selected photo set without leaving the journey | Reach the one host batch-action surface from the photo workflow and focused exhibition | Next admitted ergonomics slice; retain one selection, export path and current read budgets |
| Find a useful set again | Reach existing saved retrieval beside Library search/results | Next admitted ergonomics slice; reuse current view commands and supported-query/refusal semantics |
| Keep curated photo albums | Named membership, understandable missing members, organization and original takeout | Separate reviewed domain successor; do not represent ordinary tags as durable albums or implement gated LinkGroup prematurely |
| Keep permanent playlists | Named ordered entries, repeated-track semantics, unavailable entries and restoration after restart | Separate reviewed persistence/recovery successor; the transient queue remains visibly transient |
| Watch a personal video/anime library | Dedicated library and episode journey, optional Bangumi metadata and danmaku | Candidate in ADR-037 and the media/anime review; needs its own admitted client/read/enrichment contracts |
| Add alternative enjoyable presentations | Compiled first-party presentations or ADR-032 build/install composition over host slots | Existing presentation-plane boundary; no runtime third-party code or recovery access |
| Trust the complete product | Real semantic discovery, recoverable storage, grouping/export and release qualification | Existing normative core plan and gates; local client results cannot close them |

The selected immediate sequence is the current functional wave, photo batch
action access, then saved retrieval access. Persistent albums/playlists and
video remain visible targets with their dependencies; no temporary substitute
is counted as their completion. Each implementation slice still states its
normative requirement and executable exit. The todo ledger records only
reviewed, current evidence and keeps the parent domain journeys partial.

The [functional client acceptance](functional-client-acceptance-20261013.md)
records the local 2026-10-13/14 implementation of that immediate sequence,
including source review, final build identity, actual browser cases and
injected-only read refusal. It leaves the full-domain persistence/media targets
and the expressly unrun fault/large-queue combinations open.
