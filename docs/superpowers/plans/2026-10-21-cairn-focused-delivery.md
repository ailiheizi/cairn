# Cairn Function Delivery Roadmap — 2026-10-21

This document is the concise, user-visible function index for the existing
Cairn delivery board. It groups the 67-row planning inventory into 28 function
cards and their subfeatures; absorbed R keys remain stable anchors for older
references. It is an informative roadmap, not a new requirement, phase order,
or implementation authorization. The root-owned [requirements](../../README.md#normative-authority)
and the [Core MVP Execution Plan](../../technical/core-mvp-execution-plan.md)
remain authoritative.

## Product boundary and status

Cairn is one person's self-hosted content, Notes, discovery, export and recovery
plane. The user loop is to protect exact bytes, retain source facts and Notes,
find material lexically, structurally and semantically, organize with admitted
first-party experiences, freeze a takeout, verify it and restore exact bytes.
All clients reuse the same owner, catalog, identity and recovery authority.
Original paths remain provenance and recovery projections.

The function inventory records **usable**, **partial**, **missing**, or
**out of scope** subfeatures based on source review and dated local evidence.
Those statuses do not mean the application was freshly run, a whole phase
closed, or a release qualified. Reuse retained journeys when they still prove
the needed outcome; use a whole-feature user journey only after an actual
implementation batch. Do not create standalone test, safety, architecture,
performance or qualification campaigns. Diagnose only a concrete functional
failure or gap.

The canonical core order remains Phase 0 → 1 → 2 → 3 → Phases 4 and 5 in
parallel after Phase 3 portable-record shapes are frozen → Phase 6 after both
gates → Phase 7 release qualification. Existing flat SavedView/export, Photos
and Music user-facing refinements need not wait for large-library completeness
or every Phase 4 field. A future LinkGroup/group-aware export successor remains
behind its actual Phase 4/5 gates. Dependencies below describe reuse or real
delivery prerequisites; they do not create extra board blockers.

**Client delivery update, 2026-10-22:** the owner requested a shared
server with specialist applications built once in the Web client, then reused
in a future desktop wrapper. The immediate UI target is computer/desktop
layout. Standard save, find/takeout, listen and photo-view workflows work by
default; extensions enhance them. Browser and desktop share settings meaning
and controls, while value synchronization is a separate undelivered concern.
No parallel native app, mobile adaptation campaign or settings store is added.
The detailed
[product-form design](../specs/2026-10-22-server-client-product-form.md) now has
bounded S1 [Music F15](#f15) and S2 [Photos F14](#f14) local delivery evidence:
domain-scoped list creation, shared reopening/takeout and navigation continuity.
S3 [complete interfaces F16](#f16) also has current layout-continuity evidence
and a documented compiled contribution example. No successor batch is active. This
changes client priority, not core phase order or media/runtime admission.

[F11](#f11) is now locally delivered after the S1–S3 continuation; [F12](#f12)
has locally delivered owner-approved bounded ML-3 scope. F03 owns concrete
retrieval gaps. F09/F10 remain delivered local baselines, reused without new
independent test campaigns. Existing exact-identity and authorization behavior
stays in place. No additional architecture or plugin-platform issue is created.

**2026-10-23 continuation:** [F13](#f13) now has a runnable offline consumer
and local acceptance using retained F12 saved content and original exports.
Programs can read ordered context and match explicitly supplied bytes without
AI. This is the selected file-example scope, not a host-connected SDK.

The [detailed staged todo](2026-10-22-desktop-web-delivery.md) is the execution
companion: S1 Music, S2 Photos, S3 interface choice, with files, callback
handoffs, step checklists and one complete journey per feature. S4 desktop
packaging and later AI/media candidates are explicitly conditional, not a new
automatic implementation queue. Music and Photos already support list creation
through the global SelectionBar; S1/S2 add clear domain-scoped entries that
exclude unrelated hidden selections.

No row authorizes a new durable schema, endpoint, processor, runtime loader,
third-party kernel code, marketplace or test framework. Runtime kernel plugins,
multi-tenancy, filesystem gateways/OpenList forks, automatic acquisition or
deletion, destructive GC, and neural codecs remain closed or future scope under
the guardrails. MCP/CLI/AI-harness integration is deferred absent a direct
request. Cold custody, P2P, specialized app/game/database/VM capture and other
future profiles below are not active implementation tasks.

## Current product convergence — 2026-10-30

The latest [owner-confirmed form](../specs/2026-10-30-input-first-private-space.md)
is an AI personal-content space: content-first Home, a bottom-centered floating
input, useful directly usable results, and specialist media destinations.
Reuse ordinary originals, Notes/TAG, Skills and lists; save useful results for
later use. An input surface does not imply general AI conversation or execution.
The local open-source experience comes first; hosted signup/commercialization,
voice/calendar, external Harness and richer domain apps remain future ideas.

The existing Linear project, M1–M10 and F identifiers are retained. Current
client sequence is **F02 continuity -> F01 save-to-use handoff -> F03 actual
retrieval gaps**. F28 keeps explanations, demonstrations and the same board in
sync with each delivery. Completed S1–S3 remain historical local evidence, not
an instruction to repeat them or start a separate desktop product. Only one
whole feature is in implementation; next cards are Todo rather than concurrent
In Progress promises. Existing core-phase dependencies remain authoritative.

M7 now means bounded local video watching, matching F17's real scope, rather
than implying anime/TV delivery. Other completed client milestones explicitly
name their foundations. M8 holds future combination examples; M9 preserves
remaining trust/storage gates; M10 covers honest onboarding and open-source
presentation. Linear percentages count card states, not universal capability.

## Function cards

Every card has a stable F anchor plus aliases for its absorbed inventory keys.
“Subfeatures” states current user-visible capability, evidence level and the
smallest intended completion. “Finished looks like” is one normal-use outcome,
not a request to build a test matrix. Exact identity remains complete-stream
SHA-256 plus logical length; local development evidence is not release proof.

### F01 · [AIL-38](https://linear.app/ailiheizi/issue/AIL-38) — Save files, folders and text in one easy flow
<a id="f01"></a><a id="r12"></a><a id="r59"></a>

**Baseline:** File/folder selection, drop, ordinary text, preview and explicit save exist; staging alone is not protection. **Outcome:** Save, find, inspect and take out content from one understandable entry.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| File, drop and directory intake | Usable; local journey evidence | Reuse upload and safe relative paths. |
| Quick text capture | Usable | Keep ordinary text capture; no Inbox. |
| Progress, stop, retry and review continuation | Locally delivered for the selected browser flow | Retain receipt/files in session; explicit retry, no upload/apply replay on reopen. |
| Post-save locate and retrieve | Locally delivered for exact uploaded batch and literal text | Open exact saved files and take out the matching original. |
| Background phone camera-roll sync | Out of scope | Keep manual phone file selection; decide a dedicated capture profile separately. |

**Reuse and steps:** Keep `SourceDrawer` and existing intake hooks/API. Unify file, folder and text review with explicit protection state; preserve recoverable cancel/failure outcomes; expose advanced paths only when needed and lead confirmed saves to the saved item.

**Finished looks like:** Save a mixed folder and a text note, find the saved target and verify its original; an unconfirmed staged item is never shown as protected.

**2026-10-31 local delivery:** The [save-to-use batch](2026-10-30-save-find-use.md#f01-bounded-local-delivery--2026-10-31)
passed folder stop/retry/review resumption, one confirmed apply, exact saved-batch
handoff and matching original download; pasted-text resumption also passed.
Receipts/browser files are session state only, and unknown outcomes remain
unconfirmed. This closes the selected F01 client scope, not all ingest profiles.

**Dependencies:** Existing intake only. **Scope:** `web/src/components/SourceDrawer.tsx` and intake hooks; no Inbox or second lifecycle. **Sources:** [API/WebUI §2.2](../../requirements/api-and-webui.md#22-familiar-browser-intake-refinement), [private-drive intake acceptance](../../technical/private-drive-intake-acceptance-20261012.md).

### F02 · [AIL-39](https://linear.app/ailiheizi/issue/AIL-39) — Make private space, floating results and specialist entry coherent
<a id="f02"></a><a id="r13"></a>

**Baseline:** Content-first private Home, shared specialist pages, floating retrieval and reusable ordinary-list results have bounded local evidence (2026-10-30). **Outcome:** Move between content, input, results and their specialist destination without losing current work.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Private Home, Library and domain pages | Locally usable | Keep content-first Home and stable dedicated destinations. |
| Floating retrieval and reusable result | Locally delivered | Real host search, adjustable ordinary lists, reviewed save/reopen and existing use actions. |
| Quiet input and loaded-media entry | Locally delivered | One maximize, outside dismissal with draft retained; enter and locate without a Details modal. |
| Scope and selection across navigation | Partial, locally joined | Fix only observed lost scope or selection. |
| Management tools shown on demand | Partial | Reduce always-visible controls. |
| Details return and current playback | Partial, locally joined | Keep the same player and return position. |

**2026-10-30 bounded delivery:** F02's baseline is now Done on the existing
Linear card after the selected assistant-continuity journey: retained draft and
attachment, menu-first Escape, explicit return focus, and expanded result/media
entry without composer focus theft or autoplay. Source FileLists are copied
before asynchronous updates/input reset. See the [actual batch record](2026-10-30-floating-results.md#product-convergence-follow-up--2026-10-30).
F01 then F03 were ordered successors. Their selected 10-31 delivery is recorded
under those cards; remaining F03 field/recall gaps stay open.

**Reuse and steps:** Reuse the existing page registry, host result scope, selection and player. State each destination's purpose; move secondary controls into disclosure; retain query, selection, draft, scroll and player state.

**Finished looks like:** Find material from the floating layer, expand/use a result, open its media destination and return with draft, results and shared playback intact. Explicit metadata/playback actions stay separate. F03 now supplies explicit fresh-query handoff for outside-scope media; other objects retain Details. F01 supplies the selected save-to-use handoff.

**Dependencies:** R12/F01 intake experience. **Scope:** `LibraryPageHost`, existing result scope and page registry; no second query authority. **Sources:** [first-party client contract](../../requirements/first-party-client-experiences.md), [domain presentation review](../../technical/domain-presentations-and-composition-20261009.md).

### F03 · [AIL-44](https://linear.app/ailiheizi/issue/AIL-44) — Find content by name, Notes, text and meaning
<a id="f03"></a><a id="r18"></a><a id="r14"></a><a id="r19"></a>

**Baseline:** Lexical, structured, matched-source and fused search exist. Real-corpus misses and field-coverage gaps remain. **Outcome:** Search familiar clues, inspect why a result matched and retrieve the original.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Name, type and tag conditions | Usable; coverage incomplete | Fill only already-promised feeds. |
| Notes and extracted text | Partial | Close observed misses and show the matched source. |
| Local BGE semantic search | Real-model local evidence | Make profile readiness, rebuild and query behavior direct. |
| Search controls and explanation | Selected floating/local flow delivered | Three previews, explicit all-file count, bounded source evidence on demand. |
| Missing-model fallback | Usable fallback | Keep lexical search and original takeout available. |

**Reuse and steps:** Reuse lexical/structured/BGE broker and matched-source projection. Use known misses to locate missing feeds, not add dimensions; distinguish UI availability from indexed-field coverage; keep model readiness and stale generations visible.

**Finished looks like:** Find representative material by name, Notes, body excerpt and paraphrase, understand its match and retrieve its original; no claim that every field is covered.

**2026-10-31 selected delivery:** The [F03 batch](2026-10-30-save-find-use.md#f03-selected-local-delivery--2026-10-31)
connects explicit cross-scope media search to fresh exact-target navigation,
refuses changed responses before scope replacement, and discloses source evidence
on demand. The existing installed BGE/CLIP bundles and an explicit rebuild made
the curated instance's paraphrase retrieval real; an original takeout matched its
independent input. This does not close the earlier larger-corpus recall misses,
all field coverage, model distribution or core/release gates.

**Dependencies:** Search uses existing saved content (R46 maps to F23). **Scope:** `server/internal/search`, current lexical feeds and search control plane; exact identity unchanged. **Sources:** [Phase 4](../../technical/core-mvp-execution-plan.md#8-phase-4-descriptions-and-complete-discovery), [real-project corpus acceptance](../../technical/real-project-corpus-acceptance-20261016.md).

### F04 · [AIL-46](https://linear.app/ailiheizi/issue/AIL-46) — Find PDF/DOCX by body and meaning
<a id="f04"></a><a id="r20"></a>

**Baseline:** Admitted CS-1/2/3 PDF/DOCX extraction has local implementation and journey evidence. No scanned-PDF OCR or arbitrary historical rerun. **Outcome:** Find by body, inspect the passage and get the original document.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| PDF/DOCX body extraction | Usable; local evidence | Reuse the admitted formats, limits and bound producer. |
| Body and paraphrase search | Partial, real BGE evidence | Close observed feed and entry gaps in existing search. |
| Matched passage and source | Usable | Show the actual extracted source. |
| Original download | Locally joined | Keep extracted text distinct from the original. |
| Scanned PDF/other Office types | Out of scope | Do not infer additional formats. |

**Reuse and steps:** Reuse approved processors, EXTRACT, BGE and original download. Preserve producer/version evidence; show the extraction source in Details; keep malformed, encrypted or over-limit input exactly saved with visible extraction fallback.

**Finished looks like:** Capture a neutral-name PDF/DOCX, search by body wording and paraphrase, inspect the matching passage after restart, and verify the original. Real BGE is required for the meaning path.

**Dependencies:** Approved CS admission only. **Scope:** Existing PDF/DOCX processor and search artifacts; no reader service. **Sources:** [CS admission](../../requirements/file-identification-and-extraction.md#cs-document-body-search-admission-2026-10-19), [content-search proposal](../../technical/product-power-content-search-proposal.md).

### F05 · [AIL-47](https://linear.app/ailiheizi/issue/AIL-47) — Search screenshots by their text
<a id="f05"></a><a id="r21"></a>

**Baseline:** OCR has Darwin local recognition/search evidence; this is not default-ready on every platform or complete lexical coverage. **Outcome:** Find a screenshot from its text, inspect recognition and retrieve the image.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Local OCR bundle and recognition | Real local evidence | Show whether the pinned local model is ready. |
| OCR text lexical/semantic search | Partial local journey | Reuse existing text search. |
| OCR text and quality in Details/Notes | UI exists; polish partial | Show provenance and partial/uncertain status. |
| Original image takeout | Locally joined | Never substitute OCR text for the image. |
| Scanned-PDF OCR/arbitrary history rerun | Out of scope | Use only admitted new capture or ordinary explicit recapture. |

**Reuse and steps:** Reuse `ocr.image.text.v1`, explicit local bundle setup and current artifacts. Present source and quality; retain distinct processing/model digests; never make OCR a save prerequisite.

**Finished looks like:** Save a Chinese screenshot, find it by its printed text and a real-BGE paraphrase, inspect OCR and verify the same original image; missing OCR leaves exact save usable.

**Dependencies:** OCR-1/2/3 admission. **Scope:** Existing OCR profile and image bounds; no new processor, service or public command. **Sources:** [OCR admission](../../requirements/file-identification-and-extraction.md#ocr-image-text-delivery-admission-2026-10-20), [image-text proposal](../../technical/product-power-image-text-proposal.md).

### F06 · [AIL-48](https://linear.app/ailiheizi/issue/AIL-48) — Find photos by scene or example image
<a id="f06"></a><a id="r22"></a>

**Baseline:** Darwin arm64 Chinese-CLIP has real local browser evidence; distribution review and cross-platform qualification remain open. **Outcome:** Search a photo by a description or related reference image.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Local CLIP bundle and image generation | Real local evidence | Explicitly install and build the optional image generation. |
| Chinese scene-text query | Locally joined | Keep direct access from Photos. |
| Query by reference image | Locally joined | Make selected-image handoff clear. |
| Result inspection/original takeout | Locally joined | Keep lexical fallback visible when unavailable. |
| Face/video indexing | Out of scope | No new dimension. |

**Reuse and steps:** Reuse the pinned Chinese-CLIP profile and Photos query, with BGE in its separate space. Explicitly install/build; expose missing/incompatible/failure states; preserve ordinary search and exact original access.

**Finished looks like:** Search distractor photos by Chinese scene description, use a reference image to find a related photo, then verify original SHA-256 and length on takeout.

**Dependencies:** VIS-1/2/3 admission. **Scope:** Existing optional CLIP profile, query and provider limits; no new schema, processor, endpoint, loader or remote inference. **Sources:** [visual-search proposal](../../technical/product-power-visual-search-proposal.md), [visual-search admission](../../requirements/content-store-views-and-exports.md#visual-search-delivery-admission-2026-10-20).

### F07 · [AIL-41](https://linear.app/ailiheizi/issue/AIL-41) — Notes, tags, favorites and batch organization
<a id="f07"></a><a id="r15"></a>

**Baseline:** One Notes surface, multi-tags, Favorite and batch actions exist; source, history and unknown reads must remain honest. **Outcome:** Add and find context across first-party pages without competing text concepts.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| User Notes, multi-tags and Favorite | Usable | Keep one Notes surface and ordinary Favorite TAG. |
| Batch add/remove | Partial local coverage | Preserve selection and report outcomes. |
| Long text, history and provenance | Partial | Continue reading and expose source when needed. |
| AI-generated Notes | Code exists; user journey unproven | Only join an existing real-profile flow if selected. |

**Reuse and steps:** Reuse `NotesSurface`, annotation operations and shared selection. Preserve user/imported/extracted/model source distinctions; disable mutation on unknown tag reads; reuse Favorite TAG and shared filtering.

**Finished looks like:** Edit Notes, tags and Favorite across Photos/Music, reread without overwriting other tags, reopen long Notes and find the item again.

**Dependencies:** Existing intake and subject actions. **Scope:** Notes and annotation clients; no weighted claim model (see F12 future subfeature only if admitted). **Sources:** [Notes decision](../../technical/notes-surface-decision.md), [first-party client contract](../../requirements/first-party-client-experiences.md).

### F08 · [AIL-42](https://linear.app/ailiheizi/issue/AIL-42) — Save common searches and continue later
<a id="f08"></a><a id="r16"></a>

**Baseline:** SavedView edit/copy/paged recall and legacy flat export exist. Only supported, submitted conditions are saved. **Outcome:** Name a recurring query, recall it and take out its results.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Save, recall, edit and copy | Locally joined | Put the existing action next to search. |
| Continue past first page | Local evidence | Preserve current query and selection. |
| Condition coverage | Partial | Explain or refuse unsupported conditions; never silently drop them. |
| Dynamic view vs fixed list/export | Usable, distinct mechanisms | State what changes live and what is frozen. |

**Reuse and steps:** Reuse `useSavedViews`, existing evaluation and export. Preserve exact TAG/type conditions; retain continuation; keep SavedView, ordinary list and frozen manifest distinct.

**Finished looks like:** Save a tag/type search, restart, recall more than one page, edit/copy it, then freeze and take out results; later catalog changes do not change the existing manifest.

**Dependencies:** None beyond existing discovery. **Scope:** `useSavedViews`, SavedRetrieval components and existing operations; no wider query semantics. **Sources:** [SavedView contract](../../requirements/content-store-views-and-exports.md#72-savedview), [current client ledger](../../technical/product-experience-todo.md#structure-cleanup-2026-10-20).

### F09 · [AIL-5](https://linear.app/ailiheizi/issue/AIL-5) — Save materials and instructions as a reusable list
<a id="f09"></a><a id="r01"></a>

**Baseline:** ML-1 locally delivered for its stated scope. **Outcome:** Save an ordered ordinary snapshot with references, frozen Notes/TAG context and exact Skill text.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Select materials and copy context | Delivered local scope | Reuse loaded content and Notes/TAG. |
| Order and repeated occurrences | Delivered local scope | Preserve occurrence order and repeats. |
| External-AI copy/import | Delivered local scope | Keep it explicit; no built-in call. |
| Confirm, reopen and unresolved rows | Delivered local scope | Keep ordinary JSON, show unresolved members. |

**Reuse and steps:** Already delivered. Preserve references/context/order; validate imported candidate before draft replacement and explicit save; reopen a reader with unresolved items visible.

**Finished looks like:** Reuse `dist/material-list-20261021/acceptance/report.md` for save/reload/open/frozen text/original verification; do not rerun just to refresh this plan.

**2026-10-31 M1 closure:** Both direct Skill-editor save and full-result save
now retain the same current document through reviewed intake. Cancelling the
editor preserves the prior result; cancellation during preparation cannot start
late intake. A real reviewed save/reload preserved exact Skill/context and
repeated order. See the [M1 continuation](2026-10-30-save-find-use.md#m1-final-resultsave-handoff--2026-10-31).

**Dependencies:** None. **Scope:** Existing MaterialList Composer/Reader and ordinary files; no list database, head or AI runner. **Sources:** [ML-1 contract](../../technical/material-list-client-contract.md), [ML-1 delivery](../../technical/product-experience-todo.md#ml-1-material-list-delivery-2026-10-21).

### F10 · [AIL-6](https://linear.app/ailiheizi/issue/AIL-6) — Play or take out a saved list
<a id="f10"></a><a id="r02"></a>

**Baseline:** ML-2 locally delivered for ordered playback/queue, unique ZIP targets and unresolved-member blocking. **Outcome:** Listen or take out originals directly from a saved result.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Ordered repeated playback/append | Delivered local scope | Reuse the verified host player. |
| Unsupported audio explanation | Delivered local scope | Show omissions. |
| Unique-original ZIP | Delivered local scope | Export each unique target once. |
| Server-directory export handoff | Review handoff only | Do not claim a list-journey server write. |
| Unresolved members | Delivered local scope | Keep rows visible and block whole-list actions. |

**Reuse and steps:** Already delivered. Revalidate loaded members; preserve audio order/repetitions under existing limits; use existing unique-target export actions.

**Finished looks like:** Reuse `dist/material-list-20261021/acceptance/ml2/report.md` for real playback/queue progress, ZIP hash checks and unchanged queue when a member is unresolved.

**2026-10-31 M1 closure:** The joined direct-save/reopen journey played the
ordered repeated list and took out two unique originals, byte-equal to separate
retained MP3 inputs. No model call or new playback/takeout mechanism was added;
existing budgets and unresolved-member behavior remain unchanged.

**Dependencies:** F09/R01. **Scope:** Existing Reader, player and export; existing 32 MiB playback and 1,000 queue limits. **Sources:** [ML-2 contract](../../technical/material-list-client-contract.md#use-saved-lists-ml-2), [ML-2 delivery](../../technical/product-experience-todo.md#ml-2-delivery-use-the-saved-result-2026-10-21).

### F11 · [AIL-8](https://linear.app/ailiheizi/issue/AIL-8) — Reuse corrected Skills in the next list
<a id="f11"></a><a id="r04"></a><a id="r03"></a><a id="r07"></a>

**Baseline:** The F11 journey now joins correction, exact old/new snapshots and explicit later guide reuse. The stale selector after editing is fixed; two ordinary method examples are documented. **Outcome:** A new list uses corrected guide B while old list A retains guide A.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Save/select ordinary Skill text | Usable | Reuse current text capture. |
| Freeze Skill into a list | Usable | Preserve exact full text. |
| Merge corrections and hand off | Locally delivered | Edit the existing guide fields, review/save the new list and Skill, explicitly reuse saved B. |
| Ready-to-use method examples | Documented | Music selection and research reading, usable by copy/paste or ordinary text saving. |

**Reuse and steps:** F11 fixed the existing selector rather than adding another instruction model. Editing the guide clears the visible verified-source choice; the original can be explicitly selected again. Ordinary capture saves the corrected guide alongside its result; source and error/retry authority are unchanged. See the [dated delivery evidence](../../technical/product-experience-todo.md#f11-skill-correction-and-reuse-2026-10-22).

**Finished looks like:** Save A, create list A, correct and save B, create a new list with B, reopen both and see their respective frozen text and unchanged originals. If documentation alone solves the issue, do not implement code.

**Dependencies:** ML-1/ML-2 baselines, not a new durable mechanism. **Scope:** Existing intake, Notes and material-list UI; no Skill library, correction record or “latest” head. **Sources:** [Skill reuse spec](../specs/2026-10-21-skill-reuse-design.md), [material-list contract](../../technical/material-list-client-contract.md).

### F12 · [AIL-10](https://linear.app/ailiheizi/issue/AIL-10) — Create a reviewable AI-organized list
<a id="f12"></a><a id="r06"></a><a id="r05"></a><a id="r08"></a><a id="r10"></a><a id="r11"></a>

**Baseline:** The ML-3 organizer is implemented and locally validated with a real provider; external copy/paste remains usable. **Outcome:** Explicitly select material and instructions, receive a real model candidate, review it, save and reuse without another model call.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| External copy/paste | Usable | Reuse; do not duplicate it. |
| Built-in real-model organization | Locally delivered | Explicit draft/context/Skill disclosure through an installed host profile and live grant. |
| Candidate references/reasons/editing | Locally delivered | Separate candidate with exact refs, frozen Skill, changes/reasons and explicit use in the editor. |
| Saved result reopen/play/takeout | Locally integrated | Reuse F09/F10; real journey verified stored list/order/Skill and exact-original ZIP without another model call. |
| Weighted facts, web research, automatic refresh | Out of scope for first delivery | Keep separate; do not imply admission. |

**Reuse and steps:** AIL-9 remains an internal contract/admission step, not a separate active card. The owner-approved [F12 specification](../specs/2026-10-22-material-ai-candidates.md) defines an explicit draft-only first input: labels, exact refs, copied/edited context and frozen Skill, without automatic original-body reads. Its narrow server candidate operation/profile/egress purpose is now admitted as ML-3. Reuse current prompt validation, editor and capture under the [implementation plan](2026-10-22-material-ai-candidates.md); real-provider delivery is recorded in the existing [feature ledger](../../technical/product-experience-todo.md#f12-real-provider-delivery--2026-10-22).

**Finished looks like:** With a real provider, authorize selected inputs, invoke, inspect/edit and confirm a candidate, reopen without AI, and use/take out originals; cancellation/refusal/stale input leaves prior material intact.

**Dependencies:** F11/AIL-8 and explicit owner admission. **Scope:** Only the subsequently reviewed files and contracts; no preselected endpoint/schema/framework or agent platform. **Sources:** [AI-control requirements](../../requirements/ai-control-and-semantic-catalog.md), [external AI requirements](../../requirements/external-ai-and-semantic-extensions.md), [current research](../../research/skill-driven-content-substrate-and-qa-20261020.md).

### F13 · [AIL-35](https://linear.app/ailiheizi/issue/AIL-35) — Let programs read saved results without AI
<a id="f13"></a><a id="r09"></a>

**Baseline:** The standalone Python consumer is implemented and locally validated with the retained saved F12 list and original exports. ML-2 host resolution remains within loaded scope. **Outcome:** A small external consumer reads order/context/references and reports which explicitly supplied originals match.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Ordinary JSON result | Usable | Keep the existing file. |
| Standalone consumer example | Locally delivered | Standard-library Python reads the unchanged format and preserves repeated occurrences, context and exact Skill. |
| Local reference/access semantics | Documented and locally demonstrated | Match explicitly supplied files by full SHA-256 and length; unavailable rows remain visible. This grants no host-local access. |
| New API/SDK/live subscription | Out of scope | First show whether ordinary files suffice. |

**Reuse and steps:** The [runnable example](../../../examples/material-list/README.md) consumes ordinary files, streams explicitly supplied originals and emits a transient JSON report. No directory scan, model call or host lookup occurs. See the [bounded plan](2026-10-23-material-list-consumer.md) and [delivery evidence](../../technical/product-experience-todo.md#f13-offline-program-consumption--2026-10-23). A new interface remains deferred until an observed consumer cannot use ordinary files.

**Finished looks like:** A small non-AI program reads an exported list, preserves repeats/order and reports inaccessible members without claiming cross-instance resolution.

**Dependencies:** F09/F10. **Scope:** Format documentation and example only unless separately admitted. **Sources:** [material-list client contract](../../technical/material-list-client-contract.md), [ordinary-list admission](../../requirements/first-party-client-experiences.md#ml-1-ordinary-material-list-snapshots).

### F14 · [AIL-49](https://linear.app/ailiheizi/issue/AIL-49) — Photos: find, view, exhibit and save selections
<a id="f14"></a><a id="r23"></a><a id="r24"></a><a id="r25"></a><a id="r26"></a><a id="r27"></a><a id="r64"></a><a id="r65"></a>

**Baseline:** The S2 local journey now joins filtering, viewer/exhibition, Notes/Favorite, scoped list saving, Reader, exact original takeout and return. Date labels use source mtime, not camera dates. **Outcome:** Find a real photo set, view it continuously, add context and preserve or take out a selection.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Wall, date and tag filters | Partial | Make compact filters and date provenance clear. |
| Continuous view/full-screen/return | Partial, locally joined | Fix only observed breakpoints. |
| Exhibition/slideshow | Locally joined | Reuse current presentation and host actions. |
| Original and multi-select ZIP | Locally joined | Keep actions reachable while viewing/selecting. |
| Saved selection | S2 locally delivered | Direct selected-matching Photos entry reuses F09; no second album model. |
| Map, face, editing, native sync, album-fill suggestions | Out of scope | Keep future ideas out of the delivered surface. |

**Reuse and steps:** S2 followed Music in the 2026-10-22 client queue. Reuse Photos,
viewer, exhibition, current subject scope, Notes/TAG and original takeout.
Connect selected Photos to the same host material-list editor and Reader;
preserve scope/focus/selection on return. Keep camera/location/similarity from
silently inventing facts. No second album model or new application framework.

**Finished looks like:** On real photos, filter and find an image, view/exhibit, add Notes/Favorite, save a selection or take out originals, then return to the same place.

**Dependencies:** Existing client admission; map/album successors are separate and not prerequisites. **Scope:** Existing Photos host; no Immich clone or destructive organization. **Sources:** [first-party client contract](../../requirements/first-party-client-experiences.md), [media successor proposal](../../technical/media-experience-successor-proposal.md), [local showcase](../../../dist/product-showcase-20261020/client/acceptance-result.json).

### F15 · [AIL-54](https://linear.app/ailiheizi/issue/AIL-54) — Music: browse, keep playing, manage queue and save a result
<a id="f15"></a><a id="r28"></a><a id="r29"></a><a id="r30"></a><a id="r31"></a>

**Baseline:** The S1 local journey now joins real artist/album browsing, verified playback, occurrence-aware queue, scoped list saving, Reader actions and cross-page continuity. Persistent playlist heads remain outside this slice. **Outcome:** Find tracks by available facts, listen across pages, arrange a transient queue and save a reusable result.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Track/artist/album/year browse | Partial | Use real metadata and filename fallback for unknowns. |
| Playback/progress/volume/cross-page continuity | Locally joined | Retain one player; supported browser audio requires full verification and a maximum 32 MiB original. Larger files use original takeout. |
| Repeat/shuffle/reorder/append | Locally joined | Keep occurrence-aware transient queue. |
| Radio/current-track entry | Partial | Clarify without disrupting current listening. |
| Saved playlist-like result | S1 locally delivered | Direct displayed/selected Music entries reuse F09/F10 ordinary lists. |
| Artwork completion/transcode/lyrics/analytics | Not complete; not all in scope | Choose only a concrete user-value gap. |

**Reuse and steps:** S1 is locally delivered under the
[2026-10-22 design](../specs/2026-10-22-server-client-product-form.md).
Track/artist/album/year browsing, repeat/shuffle/reorder and sleep timer already
have implementations; do not rebuild them. Improve the primary browse/play
hierarchy and on-demand controls. Pass explicit displayed/selected Music
targets to the existing host material-list editor, make saved-result reopening
and ML-2 actions discoverable, and preserve the same player through navigation.
Saving a selection is distinct from serializing a repeated live queue. Use
`MusicLibraryExperience`, its props, `main.tsx`/`LibraryPageHost` and existing
composer/Reader; change shared hooks only for observed integration gaps.

**Playback depth:** The present 32 MiB full-download/verification ceiling is
an honest initial bound, not the final product target. Keep a larger-media
start/seek/cancel proposal inside F15; it needs its own authorized-read and
playback-evidence contract before implementation. It is not delivered by a UI
module or by increasing the byte constant. Streaming/transcoding remains
outside this admitted client batch.

**Finished looks like:** Browse artist/album, play A/B/A, edit the queue, switch pages while playback continues, then save/reopen a list and listen again; oversized content has a clear takeout route.

**Dependencies:** Existing Music admission; no scale/Phase 4 blanket blocker for UX polish. **Scope:** Current Music client and player; no media server, streaming or playlist store. **Sources:** [first-party client contract](../../requirements/first-party-client-experiences.md), [structure-cleanup journey](../../../dist/structure-cleanup-20261021/acceptance/report.md).

### F16 · [AIL-58](https://linear.app/ailiheizi/issue/AIL-58) — Switch complete interfaces and support safe presentation contributions
<a id="f16"></a><a id="r32"></a><a id="r33"></a><a id="r34"></a>

**Baseline:** S3 validated the existing Workspace/Showcase shared query, selection, draft and player; the contribution guide now includes the actual Showcase binding. Token-only theme packages remain a separate mechanism. **Outcome:** Choose meaningfully different layouts without forking product logic.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Built-in complete shells | S3 locally delivered | Current layout-switch journey; existing takeout action remains reachable. |
| Compiled presentation registration | Implemented under trust boundary | Clarify stable slots and contribution example. |
| Query/draft/playback across switch | S3 locally validated | Same host state and paused verified source retained. |
| Data-only theme packages | Usable within ADR-032 | Keep design-token boundary. |
| Runtime third-party code/store | Out of scope | Not a missing feature. |

**Reuse and steps:** Reuse trusted compiled shell/slot registration and the host-owned query, drafts, selection, player and safety actions. Distinguish structural layout from color themes; add a contribution example only within admitted slots.

**Finished looks like:** Switch the same content between two complete layouts, find/play/annotate/take out, and return with state intact; example contribution demonstrates structure changes, not only recoloring.

**Delivery position:** After Music and Photos in the computer-layout Web client,
extract only their demonstrated common host/contribution boundaries. Reuse the
same applications, full-layout choices and settings definitions in a later
desktop wrapper. Add concrete native capabilities only when a feature needs
them; do not clone the UI, invent a platform SDK or claim cross-host setting
values already synchronize. Compiled first-party complete layouts and
data-only theme packages are different capabilities. Independently installable
executable UI remains a future design decision, not a shipped F16 subfeature.

**Dependencies:** Existing first-party shell and presentation admission. **Scope:** No widening ADR-032 or runtime code. **Sources:** [client extension guide](../../technical/client-experience-extension-guide.md), [architecture ADRs](../../technical/build-stack-and-architecture-selection.md), [product-form design](../specs/2026-10-22-server-client-product-form.md).

### F17 · [AIL-61](https://linear.app/ailiheizi/issue/AIL-61) — Watch locally saved video within a clear first boundary
<a id="f17"></a><a id="r35"></a><a id="r36"></a><a id="r37"></a><a id="r58"></a><a id="r66"></a>

**Current local delivery (2026-10-29):** The dedicated Videos destination wraps explicitly verified MP4/WebM originals up to 32 MiB in the bundled ArtPlayer, with loaded-filename search/sort and on-demand Details/download. **Outcome:** Play one supported locally saved video and take out its original.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Save/find/download video original | Existing content capability; local video takeout demonstrated | Original download matched the independently retained MP4 bytes. |
| Dedicated video page/playback | Implemented in the bounded client profile | Explicit complete-byte verification; MP4/WebM up to 32 MiB; no streaming/transcoding. |
| Pause/seek/exit/original takeout journey | Locally demonstrated with one real retained MP4 | Search/sort, pause/seek, filter without losing the player, reveal, same-Blob playback, Details, exact download and Home return. |
| Episodes/Bangumi/subtitles/chat | Future candidate | Reassess after basic watching. |
| TV/MV/sync/transcode/auto-download | Out of scope | Prefer external mature tools. |

**Reuse and steps:** Reuse the bounded verified-original hook, bundled player and host scope/Details/takeout; use clear original-only exits for unsupported files. Filename filtering and sorting project the loaded list without replacing the reader scope or player.

**Finished looks like:** Open a supported saved video, play/pause/seek, cancel and return, then verify original; the same journey explains unsupported, unauthorized or damaged content.

**Dependencies:** Owner-admitted bounded-video client refinement in the [first-party contract](../../requirements/first-party-client-experiences.md). **Scope:** No streaming server, transcoder, downloader or persistent playback progress. Multi-video next/previous is implemented but not exercised by the one-video demo. **Evidence:** [current delivery plan](2026-10-29-video-viewing-room.md). Historical sources: [media research](../../research/media-and-anime-experience-20261013.md), [media successor proposal](../../technical/media-experience-successor-proposal.md).

### F18 · [AIL-64](https://linear.app/ailiheizi/issue/AIL-64) — Save research links and materials to resume later
<a id="f18"></a><a id="r38"></a><a id="r39"></a>

**Baseline:** URLs, titles, order and saved files compose as ordinary material. A saved URL is not an archived page or session. **Outcome:** Save a research/project set, find it later and resume selected links/material.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Save URL/text/original file | Usable by composition | Reuse ordinary intake and Notes. |
| Reopen ordered set | List foundation usable | Add a fitting entry/return path. |
| Return to selected link | Partial/manual | Make link-only state explicit. |
| Browser extension/page snapshot/auto-close | Out of scope | Do not imply URL alone preserved page contents. |

**Reuse and steps:** Start with Notes plus material lists and a clear link/original distinction. Improve only observed return friction; separately decide browser capture if needed; never auto-close an unsaved source.

**Finished looks like:** Save links and originals, leave, search later, reopen selected materials and retrieve saved notes; an expired URL remains honestly only a link.

**Dependencies:** F09 ordinary lists and existing intake. **Scope:** No browser-session database. **Sources:** [short-lived context design](../../technical/task-context-and-short-lived-information-design.md), [personal information scenarios](../../research/personal-information-scenarios-and-reference-products-20261014.md).

### F19 · [AIL-66](https://linear.app/ailiheizi/issue/AIL-66) — Optional household notes, receipts and dates
<a id="f19"></a><a id="r40"></a><a id="r41"></a><a id="r42"></a>

**Baseline:** Location notes, photos and receipts can be saved/searched; no authoritative inventory or live tracking exists. **Outcome:** Find a recorded location/receipt and its evidence in the same content base.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Ordinary notes, photos and receipts | Usable by composition | Reuse files and Notes. |
| Search location/date text | Usable by existing search | Preserve date/source and the original statement. |
| Evidence grouping and correction | Usable by lists/new records | First prove existing semantics suffice. |
| Inventory/reminders/live location/Home Assistant | Missing/out of scope | No household-management platform. |

**Reuse and steps:** Use ordinary files, Notes, tags and lists; retain source/time for corrections; consider new location relation only after a real user case demonstrates the gap.

**Finished looks like:** Record an item, location and receipt; find the basis later; add a correction that remains distinguishable from the old statement; retrieve the receipt. Unknown location stays unknown.

**Dependencies:** Ordinary intake/list composition. **Scope:** No live location, inventory engine or temporal database. **Sources:** [personal information closure plan](../../technical/personal-information-product-closure-plan.md), [scenario research](../../research/personal-information-scenarios-and-reference-products-20261014.md).

### F20 · [AIL-69](https://linear.app/ailiheizi/issue/AIL-69) — Capture a short voice note
<a id="f20"></a><a id="r43"></a>

**Baseline:** Text capture exists; voice input and ASR are not delivered. OCR does not prove speech capability. **Outcome:** Speak, review/correct a transcript, save ordinary text and find it later.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Ordinary text save | Usable | Reuse F01. |
| System dictation/external client | Optional external route | Do not label it built-in. |
| Built-in voice/transcription | Missing | Select the smallest path first. |
| Review, correct and find | Underlying text flow exists; voice join missing | Save only after explicit confirmation. |

**Reuse and steps:** Compare platform dictation, external client and optional ASR; state mic/retention/remote-transfer/cost/cancel behavior; send confirmed transcript through existing intake and preserve edits.

**Finished looks like:** Real speech produces an editable preview, confirmed text is saved, reopened, found and taken out; cancellation/network failure never claims success.

**Dependencies:** F01 intake and separate bounded admission if built-in processing is selected. **Scope:** No default ASR processor or assistant. **Sources:** [AI-assisted capture direction](../../technical/content-first-product-decision.md#ai-assisted-capture-and-retrieval-direction-2026-10-15), [external AI requirements](../../requirements/external-ai-and-semantic-extensions.md).

### F21 · [AIL-70](https://linear.app/ailiheizi/issue/AIL-70) — Ask an AI client to find and return saved material
<a id="f21"></a><a id="r44"></a><a id="r45"></a>

**Baseline:** Typed query/takeout exists; an AI-client contract does not. MCP/AI-harness integration remains deferred. **Outcome:** Ask for content, clarify candidates and obtain the chosen original through host authority.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Typed query and takeout under host policy | Existing components | Reuse same identity and authorization. |
| External AI client integration | Missing/deferred | Requires direct request and a minimal access contract. |
| Ambiguity → candidate → user choice → takeout | Missing | Keep model as recommender, not authority. |
| Remote pairing/live file changes | Out of scope | Keep separate from saved-content retrieval. |

**Reuse and steps:** If explicitly requested later, choose an external client and minimal read scope; preserve host authorization and explicit user choice; deliver one request-to-file journey without agent orchestration.

**Finished looks like:** A real client clarifies a Chinese request, returns supported evidence, lets the owner choose and retrieves the exact original; cancellation/failure does not write or exceed grants.

**Dependencies:** Existing typed query and saved material; independent of built-in organizer F12. **Scope:** No code/API work in this roadmap absent direct request. **Sources:** [CLI/MCP contract](../../requirements/cli-and-mcp-contract.md), [AI-assisted capture direction](../../technical/content-first-product-decision.md#ai-assisted-capture-and-retrieval-direction-2026-10-15).

### F22 · [AIL-43](https://linear.app/ailiheizi/issue/AIL-43) — Keep browsing large libraries and return to place
<a id="f22"></a><a id="r17"></a>

**Baseline:** Windowed rendering, paging and some scroll restoration have historical measurements; old SP-2 failures are stale where later evidence supersedes them. **Outcome:** Continue past the first results, inspect an item and return without losing place.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Windowed rendering/first screen | Historical large-library evidence | Reuse current implementation. |
| Listing and SavedView continuation | Partial/local evidence | Fix a demonstrated truncated path. |
| Full-search continuation | Partial; verify current behavior | Do not equate a returned page with whole library. |
| Details return and selection | Partial | Correct observed lost position/state. |

**Reuse and steps:** Confirm current listing/search continuation before changing it; repair only real truncation/reordering/selection loss; preserve current virtualization and thumbnail budget; check return behavior on existing Library/Photos/Music/Overview surfaces.

**Finished looks like:** On an existing representative library, continue to a later item, select/open Details, return to the same place and take out that item. Record only the user-visible friction encountered.

**Dependencies:** Existing Library/scope. **Scope:** No separate benchmark campaign or Linux detour. **Sources:** [historical SP-2 measurements](../../history/product-experience-ledger-through-20261020.md), [first-party client contract](../../requirements/first-party-client-experiences.md).

### F23 · [AIL-77](https://linear.app/ailiheizi/issue/AIL-77) — Download originals as files, ZIP or directory
<a id="f23"></a><a id="r51"></a><a id="r46"></a>

**Baseline:** Single original, ZIP and flat frozen-manifest/server-directory routes have local evidence; group-relative paths and successor migration remain gated. **Outcome:** Take the right original out from any ordinary selection.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Single original download | Locally joined | Reuse identity-checked route. |
| Multi-select ZIP/unique targets | Locally joined | Offer directory/single-file fallback for budget limits. |
| Directory materialize/verify/reproduce | Partial local journeys | Make status and retry path clear. |
| Flat frozen output | Usable in current shape | Keep frozen membership independent of later query. |
| Multi-level LinkGroup paths | Future/gated | Only after Phase 4/5 and successor review. |

**Reuse and steps:** Keep current flat takeout usable now; after canonical gate, bind successor to stable subject/version and safe relative paths; refuse destination conflicts/unsafe paths and verify/reproduce against the same manifest.

**Finished looks like:** Select/freeze, change source membership, materialize in a new directory, verify and reproduce; old destinations are not overwritten and originals match SHA-256/length.

**Dependencies:** Existing export now; group-aware successor waits for Phase 4/5 and Phase 6. **Scope:** No second verification system. **Sources:** [ExportManifest §7.3](../../requirements/content-store-views-and-exports.md#73-exportmanifest), [Phase 6](../../technical/core-mvp-execution-plan.md#10-phase-6-link-groups-export-and-operator-ergonomics).

### F24 · [AIL-74](https://linear.app/ailiheizi/issue/AIL-74) — Back up and restore after loss or reinstall
<a id="f24"></a><a id="r48"></a><a id="r47"></a><a id="r52"></a>

**Baseline:** Bounded fresh-catalog/recovery-reader implementation and restore journeys exist; not all history, installations or reader dependencies are qualified. **Outcome:** Follow clear instructions to rebuild the declared catalog and restore exact originals.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Restore preview/apply/continue | Local journey evidence | Consolidate existing operator entry. |
| Backup/restore instructions | Partial evidence | State exactly what each backup contains. |
| Separate recovery record/anchor UI | Code exists; pair journey unproven | Do not claim independent retention. |
| Catalog reconstruction/clean reader | Bounded implementation evidence | State its tested scope. |
| Broader facts/cross-version qualification | Partial/open | Extend only for a concrete admitted need. |

**Reuse and steps:** Reuse recovery import, token and reader. Explain backup, trust anchor and recovery materials in plain operator steps; keep exact-byte recovery distinct from degraded metadata; rebuild disposable indexes only after core recovery.

**Finished looks like:** For the stated profile, recover materials after catalog/index/source loss using separately retained trust data, restore and verify originals, and state private-key/reader dependency limits.

**Dependencies:** Existing recovery profile and Phase 3 closure; do not introduce a second recovery database. **Scope:** Current recovery/import/reader. **Sources:** [catalog reconstruction acceptance](../../technical/catalog-reconstruction-acceptance-20261016.md), [restore manifest](../../requirements/restore-manifest.md#fresh-operational-catalog-reconstruction), [Phase 3 status](../../technical/core-mvp-execution-plan.md).

### F25 · [AIL-75](https://linear.app/ailiheizi/issue/AIL-75) — Save real space with exact dedup and simple compression
<a id="f25"></a><a id="r49"></a>

**Baseline:** Exact whole-file dedup is implemented; local-zstd is a runnable candidate, not a selected release engine. **Outcome:** Avoid duplicate bytes and measure useful lossless savings without impairing restore.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Exact whole-file dedup | Usable | Similarity never proves identity. |
| `local-zstd-v1` | Candidate | Do not call it release default. |
| Space/net-savings report | Partial | Include indexes, models, caches and retained sources. |
| Encryption/neural codec/destructive cleanup | Out of scope | Do not add an algorithm for hypothetical savings. |

**Reuse and steps:** Use existing Phase 5 RepositoryDriver and real corpus; measure net storage and exact readback; close only the selected profile's concrete corruption/rollback/reader gaps; record a dated decision.

**Finished looks like:** Save repeated/compressible material, compare complete space accounting, independently restore and verify exact originals, and explain net savings without double-counting.

**Dependencies:** Canonical Phase 5 and Phase 3 recovery profile. **Scope:** Existing driver candidates only; no new codec, destructive GC or platform detour. **Sources:** [Phase 5](../../technical/core-mvp-execution-plan.md#9-phase-5-simple-qualified-storage-savings), [operator corpus manifest](../../technical/phase5-operator-corpus-manifest.md).

### F26 · [AIL-76](https://linear.app/ailiheizi/issue/AIL-76) — Group files by relative path without copying originals
<a id="f26"></a><a id="r50"></a>

**Baseline:** Normative file-only LinkGroup shape exists; schema, operation, portable record, browser workflow and group export do not. Ordinary lists are not LinkGroups. **Outcome:** Reuse one file in multiple named groups without copying or authorizing deletion.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Ordinary list grouping | Usable, distinct feature | Reuse for current grouping. |
| Minimal current file-only LinkGroup | Missing/gated | Implement only the existing normative shape. |
| Missing members and safe export paths | Missing/gated | Keep missing/empty state visible. |
| Nested groups/roles/history/automatic grouping | Out of scope | No general Collections model. |

**Reuse and steps:** Wait for Phase 4/5 gates and reviewed successor; implement current mapping only; preserve byte ownership and bind the portable current state to existing recovery authority.

**Finished looks like:** Put the same file in two groups, edit mappings, observe missing/empty state, freeze safe-path export and restore the same current map without copying or deleting bytes.

**Dependencies:** Canonical Phase 4 and 5 → Phase 6. **Scope:** Minimal stable file links; no group history, nesting, roles or automatic grouping. **Sources:** [LinkGroup §7.1](../../requirements/content-store-views-and-exports.md#71-linkgroup), [design review](../../technical/linkgroup-design-review.md).

### F27 · [AIL-79](https://linear.app/ailiheizi/issue/AIL-79) — Install and use one self-hosted instance
<a id="f27"></a><a id="r53"></a>

**Baseline:** Native/offline package candidates and restart journeys exist; no all-platform, Linux/NAS or Docker-release qualification is implied. **Outcome:** Install a supported single-owner instance, set data locations and use the protect/find/takeout loop.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Local startup/candidate offline package | Partial local evidence | Name actual support scope. |
| Model/data path configuration | Partial | Remove hidden dependencies and explain profile state. |
| Restart and continue | Local evidence | State exact persisted paths and behavior. |
| Cross-platform release matrix | Not current functional work | Qualify only when a platform is actually selected. |

**Reuse and steps:** Reuse packages, config and quick start. Declare native/artifact roles, supported platforms and shipped dependencies; make first-run paths and missing-model fallback explicit; default to loopback and rely only on qualified remote access if exposed.

**Finished looks like:** On a declared supported package, install/configure, save/find/take out, restart and continue without hidden first-query downloads or incorrect path assumptions.

**Dependencies:** Storage profile and Phase 7 for release claims. **Scope:** Existing packaging/config/docs; no multi-tenant enterprise console or Linux-first detour. **Sources:** [Phase 7](../../technical/core-mvp-execution-plan.md#11-phase-7-release-hardening), [operator install/backup/upgrade](../../technical/operator-install-backup-upgrade.md), [security requirements](../../requirements/security-and-threat-model.md).

### F28 · [AIL-82](https://linear.app/ailiheizi/issue/AIL-82) — Keep feature descriptions and walkthroughs accurate
<a id="f28"></a><a id="r56"></a><a id="r57"></a>

**Baseline:** Product name, repository links and screenshots exist but must track actual current behavior. **Outcome:** A new user understands what is usable, what is limited, and can follow one real walkthrough.

| Subfeature | Current status | Deliver |
| --- | --- | --- |
| Project name, README and Wiki | Current bilingual story delivered | Keep links and product framing consistent. |
| Home/media/search/result screenshots | Six current real-build assets | Use the matching real build only. |
| Whole-loop walkthrough | Current three-step story delivered | Show capture → find → use/takeout; keep usable results. |
| Real user feedback | Not yet evidenced | Record actual feedback; invent no customers or demand. |

**Reuse and steps:** Maintain existing README/Wiki, links and user-provided assets; capture a walkthrough from an actual matching build; label current/optional/future and model dependencies accurately.

**Finished looks like:** A newcomer can follow current instructions through save, find and takeout and can distinguish delivered scope from future items.

**2026-10-31 delivery:** The bilingual README, quick-start/list guide and six
real screenshots now match this build. The original Linear project, 28-card
document and M2/M3/M10 descriptions were synchronized and read back; F28 is Done
for this version. Real user feedback remains unevidenced, not fabricated.

**Dependencies:** Delivered F09/F10 and current user-facing flows. **Scope:** Documentation/screenshots only; no unsolicited publication or outreach. **Sources:** [README](../../../README.md), [Wiki map](../../wiki/README.md), [product framing](../../technical/content-first-product-decision.md).

## Documentation-only disposition register

These stable R anchors remain findable but create no standalone active function
card. Their authoritative work stays in the indicated phase or boundary:

| Legacy key | Disposition | Reference |
| --- | --- | --- |
| <a id="r54"></a>R54 · Publish real performance/capacity/resource limits | Phase 7 release evidence, not a separate benchmark campaign | [Release qualification](../../requirements/release-qualification-and-traceability.md), [semantic profiling record](../../technical/semantic-latency-profiling-20261015.md) |
| <a id="r55"></a>R55 · Full product release acceptance | Canonical Phase 7 gate, not a parallel “test project” | [MVP/operator contract](../../requirements/mvp-and-operator-contract.md), [release qualification](../../requirements/release-qualification-and-traceability.md), [core order](../../technical/core-mvp-execution-plan.md) |
| <a id="r60"></a>R60 · App/game/database/VM recovery profiles | Future profiles; select one concrete need before admission | [application/game](../../requirements/application-and-game-collections.md), [database/VM capture](../../requirements/database-and-virtual-machine-capture.md) |
| <a id="r61"></a>R61 · Cold/offline custody | Future profile; not MVP recovery minimum | [cold-media requirements](../../requirements/cold-media-and-offline-custody.md) |
| <a id="r62"></a>R62 · P2P/magnet verified retrieval | Future separately admitted retriever; never automatic identity or acquisition | [P2P requirements](../../requirements/p2p-and-magnet.md), [external retrieval](../../requirements/external-source-and-retrieval.md) |
| <a id="r63"></a>R63 · Neural compression research gate | Future go/no-go only after simple storage and recovery qualify | [recovery fidelity](../../requirements/recovery-fidelity.md), [research reference](../../references/neural-compression-research.md) |
| <a id="r67"></a>R67 · History/disposition index | This plan and the root-owned README/ledger maintain the index; no separate product card | [docs map](../../README.md), [AGENTS guardrails](../../../AGENTS.md), [current todo](../../technical/product-experience-todo.md) |

## Roadmap maintenance

An absorbed R key resolves to its F anchor above. A future request should update
the existing function card and authoritative contract/ledger, not create a
competing roadmap. Current function status changes only when the relevant
user-visible result has retained, reviewable evidence; a local journey never
awards release qualification by itself.
