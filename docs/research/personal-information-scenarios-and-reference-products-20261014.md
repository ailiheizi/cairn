# Personal Information Scenarios and Reference Products (2026-10-14)

> Informative research catalog. It records illustrative jobs and candidate
> experiences; it does not admit a schema, endpoint, processor, index, client
> surface, phase order, or implementation. No customer interviews, adoption
> evidence, or competitor UI trials are represented here. “Current” describes
> documented repository capability, not a claim that every deployment has the
> required bundle or that a complete user journey has passed acceptance.

## Boundary and reading guide

**Later operator correction — reuse first:** this is a catalog of jobs, not a
future feature backlog. Prefer combinations of existing files, tags, Notes,
supported search/SavedView and original takeout. A native-app proposal below
does not prevent storing a useful human-written clue/list as ordinary content.
Dates, order or locations written inside a file do not become new Cairn fields.
Retain user goals and check whether the composition meets their agreed exits;
a manual prototype is not automatically a comfortable completed experience.
Review/add only necessary missing behavior. New semantics or integration
requires admission, not abandonment of the goal. The
[corrected closure plan](../technical/personal-information-product-closure-plan.md)
replaces the earlier seven-milestone expansion with four work packages.

| Example | Existing composition | Possible missing behavior to review if needed |
| --- | --- | --- |
| Reading/research group | URL/title/order text file, shared tag, Notes and manual browser return. | Capturing/closing/reopening tabs or archived webpage contents. |
| Project material | Shared tags, supported dynamic query/SavedView, selected-original export; context/order in a file. | Project entities, task hierarchy, group Notes or ordered native membership. |
| Household location clue | Record “passport in study drawer” in a file/Notes and search it. | Knowing actual location, typed object/history or automatic correction. |
| Manual/invoice/warranty | Save originals with a shared tag and owner-written warranty Notes. | Reminder delivery or native document/item relations. |
| Food dates | Owner-maintained list and text search, even when used daily. | Calculated expiry, inventory consumption or notifications. |
| Mixed trip | Common tags/search, supported Photos/Music, selection and exact takeout. | Curated album or persistent playlist. |

Cairn's selected direction remains a single-owner self-hosted personal drive:
protect readable originals, find them through familiar clues, use them in
focused first-party experiences, and take out verified originals. The optional
household-information direction is an application over that same trusted
content, description, discovery, export, and recovery plane. It would record
and retrieve information about household objects and selected observations;
it would not control devices or execute automation. One owner and one household
do not create a multi-tenant model.

Scenarios below distinguish shared behavior from proposed application behavior.
Current shared identity, Notes, tags, search, saved retrieval, original access,
and recovery remain host-owned. The ordinary storage/recovery design remains
one configured repository and one SQLite catalog. A presentation may rearrange
the complete experience—navigation, page composition, density, task views, and
action placement—not just colors—but it cannot own content identity, search
scope, selection, player state, export policy, or recovery meaning. ADR-032's
presentation-package exception is build/install-time, versioned declarative
data, admitted whole or refused whole, with no running third-party code and no
recovery-plane access. Kernel-affecting components remain compiled first-party
code.

The present convergence priority is completing the admitted core loop and the
Photos, Music, and Overview client surfaces. This catalog contributes evidence
and a review queue; it does not expand that queue. Photos/Music client work
does not close core phases. Runtime third-party extensions, a marketplace,
general kernel ABI, device control, and AI-harness integration remain outside
the current work. Video/TV and household applications require their own review.

Status terms used here:

| Status | Meaning |
| --- | --- |
| **Current shared capability** | A documented shared operation exists; this does not assert the whole scenario is accepted. |
| **Implemented path; readiness unverified** | Code/profile exists, but required bundle, deployment readiness, or real-content execution is not established by this catalog. |
| **Partial client journey** | A bounded first-party slice exists; the complete domain task remains open. |
| **Proposal** | Illustrative future experience requiring a separate scope, contract, or admission review. |
| **Unknown** | Evidence is insufficient; do not infer support or absence. |

## Scenario catalog

### A. Mixed content and retrieval

#### 1. Find one trip across photographs, a PDF, and music

- **Trigger and clues:** An owner remembers a trip and a phrase such as “Kyoto
  autumn,” but not which folder holds the pictures, itinerary PDF, and saved
  music.
- **Experience:** Search one shared library; apply one shared tag to the
  selected files; visit the Photos and Music pages while retaining the host's
  current identity and scope; select supported results for takeout. Show the
  PDF as a preview only when its actual current reader supports it; otherwise
  offer opening or downloading the original.
- **Data, processing, dependencies:** Existing file identity, shared tag,
  supported lexical/structured/Notes search, domain renderers, and export
  path. Semantic retrieval requires its real local BGE profile to be ready.
- **Reuse versus proposal:** Batch TAG, shared retrieval, Photos/Music pages,
  and original takeout are reuse. One tag associates files but does not create
  shared group Notes. PDF reading, cross-domain selection retention, and one
  end-to-end mixed-trip flow must be evidenced for the actual build.
- **Complete journey:** Find by remembered clue → tag the selected mixed set
  once → inspect photos and play eligible audio in their domain pages → open
  or download the PDF according to supported preview → freeze a supported
  takeout → verify each output against its original identity.
- **Status and unknowns:** **Partial client journey.** The product decision
  names this mixed journey as a validation target. Do not claim PDF preview,
  universal domain-selection equivalence, or whole-journey acceptance without
  current-build evidence.

#### 2. Find the photo of a visual concept

- **Trigger and clues:** “Show the red temple gate in snow,” when the owner
  remembers the image but not its filename or date.
- **Experience:** A separate image-search affordance could accept natural
  language or a reference image, return matching photos with an explanation of
  the search mode, and open the exact original through the shared host.
- **Data, processing, dependencies:** The code contains a Chinese-CLIP image
  retrieval path ([profile and model binding](../../server/internal/search/image_bundle.go),
  [generation build/readiness and query path](../../server/internal/search/image_index.go)) using profile
  `chinese-clip-vit-base-patch16` and model
  `OFA-Sys/chinese-clip-vit-base-patch16`. It requires a local image bundle,
  provider readiness, and a validated image generation. It is a distinct
  image space; its vectors must not be compared with BGE text vectors.
- **Reuse versus proposal:** Shared subject resolution, result scope, and
  original access are reusable. A ready image bundle and polished surfaced
  workflow are not established here. This is not the same as exact duplicate
  detection, and similarity must not establish identity or authorize deletion.
- **Complete journey:** Describe or provide a reference image → explicitly
  choose visual search → see results identified as approximate visual matches
  → inspect and select the intended subject → open/download and verify the
  original.
- **Status and unknowns:** **Implemented path; runtime readiness NOT RUN in
  this review.** Do not call visual search default-enabled or claim it is
  absent from code. Image-bundle installation, provider preview/readiness,
  generation validation, recall on representative personal images, and UI
  acceptance were not run here.

#### 3. Find text printed in a receipt photograph

- **Trigger and clues:** “Find the hardware-store receipt for the drill,”
  remembered from a word, store name, or amount visible in an image.
- **Experience:** Search text recognized in a photo/image, show a clearly
  labeled OCR match and source region where available, then open the image and
  its original details. This scenario does not assume PDF text extraction.
- **Data, processing, dependencies:** An optional `ocr.image.text.v1` path
  ([processor](../../server/internal/processor/ocr_text.go),
  [ONNX engine](../../server/internal/processor/ocr_onnx_engine.go), and
  [bundle readiness](../../server/internal/processor/ocr_bundle.go)) uses local
  PP-OCR detection and recognition on images. Its output can include region
  coordinates, confidence, provenance, model and runtime digests, and can feed
  the existing extracted-text/segment path. A local OCR bundle is required for
  real engine execution. This does not establish OCR-based PDF text extraction.
- **Reuse versus proposal:** Existing extracted-text and Notes search may
  provide shared query plumbing. OCR availability, automatic processing
  policy, result-region UI, and real corpus coverage need evidence. OCR text is
  a clue, not a new exact-identity or deletion signal.
- **Complete journey:** Search a known phrase → identify that the hit came
  from OCR and inspect the matching region → open the receipt image → select
  and export the original → verify its bytes.
- **Status and unknowns:** **Implemented path; runtime readiness NOT RUN in
  this review.** The processor and profile exist, but profile existence does
  not prove an installed bundle or a completed real-engine run. The
  [real-engine test](../../server/internal/processor/ocr_onnx_engine_real_test.go)
  explicitly skips when `CAIRN_OCR_BUNDLE` is absent. This review did not run
  bundle installation, a real recognition preview, or real-engine execution.

#### 4. Separate visually similar images from exact duplicates

- **Trigger and clues:** Several near-identical camera shots appear; the owner
  wants to compare them without losing an original.
- **Experience:** Present approximate visual neighbors as candidates for human
  inspection. Separately label exact duplicates only when the complete logical
  byte stream SHA-256 and length match.
- **Data, processing, dependencies:** Similarity can use an admitted visual
  search generation when ready. Exact identity is the frozen SHA-256 plus
  logical length rule. Filename, metadata, embeddings, perceptual similarity,
  and OCR cannot establish exact identity.
- **Reuse versus proposal:** Existing exact identity and duplicate accounting
  are shared kernel concepts. A visual-neighbor comparison UI is a proposal;
  it must not silently merge, delete, or imply byte identity.
- **Complete journey:** Inspect a cluster of approximate candidates → compare
  originals/details → separately inspect exact-duplicate status → make any
  organization choice explicitly → preserve or export the chosen originals
  under ordinary recovery semantics.
- **Status and unknowns:** Exact identity is a **current frozen contract**;
  surfaced visual clustering is a **proposal**. No similarity score can
  substitute for a digest match.

#### 5. Bring in camera-sized photos, long audio, or a large takeout

- **Trigger and clues:** A large camera image does not preview, a long audio
  file exceeds browser playback limits, or a selected export exceeds browser
  memory/byte limits.
- **Experience:** State the actual reason and available alternatives at the
  point of action: original details/download or server-directory export where
  supported. A visible bounded rendition may help inspect an image, but must
  remain tied to a verified original.
- **Data, processing, dependencies:** Existing preview, player, ZIP, and
  export ceilings apply. Raising a limit requires the applicable read,
  processor, derivative-storage, or playback contract; a camera rendition
  does not inherently require range reads. Audio/video streaming would change
  the complete-identity-before-playback boundary and needs separate review.
- **Reuse versus proposal:** Existing bounded image rendering, verified audio
  playback, browser takeout, and server-directory export are reuse where the
  file and selected scope fit their contracts. Broader limits or new streams
  are not implied.
- **Complete journey:** Attempt the task → see a truthful boundary and reason
  → use the offered eligible original/alternate export path → verify the
  result, or retain an explicit unavailable state.
- **Status and unknowns:** **Current bounded capability with partial client
  journeys.** No performance or size guarantee is inferred. Exact currently
  supported file sizes and exits must be taken from current contract and
  build-specific evidence.

#### 6. Reuse a curated photo album or ordered music playlist

- **Trigger and clues:** “Show the birthday pictures again” or “play the
  dinner sequence in this order,” including an intentional repeated track.
- **Experience:** Albums could retain curated photo membership; playlists
  could retain ordered occurrences, repeats, and missing-entry outcomes.
  Their controls belong in focused Photos/Music pages, with shared subject
  identity and takeout actions remaining host-owned.
- **Data, processing, dependencies:** Durable organization requires its own
  reviewed state, recovery, migration, missing-member, and export behavior.
  Ordered repeated playlist occurrences are not a minimal LinkGroup map. A
  transient queue is not a saved playlist.
- **Reuse versus proposal:** Existing transient Music queue, shared tags, and
  SavedView can help find or play a current set. Persistent albums/playlists
  are proposals with separate semantics; tags, SavedView, and LinkGroup must
  not be mislabeled as their substitute.
- **Complete journey:** Create named curation from visible content → reorder
  or intentionally repeat entries → restart and recover it → inspect missing
  members honestly → play/browse → export selected originals under shared
  manifest and verification rules.
- **Status and unknowns:** **Proposal.** Complete persistence, portable
  recovery, and native editing contracts remain unresolved.

### B. Household objects, documents, and dates

#### 7. Find a stored household item and its location

- **Trigger and clues:** “Where did I put the passport?” The owner remembers
  “study, second drawer,” and may have a reference photo.
- **Experience:** A future household query could show the item, latest
  confirmed location, confirmation time/source, attached photograph or
  document, and an age cue such as “may be out of date.” Editing a move should
  require explicit confirmation and visibly identify the new observation.
- **Data, processing, domain/install dependencies:** A structured object and
  location relationship/observation contract, evidence references, and
  reviewable update/history semantics in the existing single catalog. A
  plain tag plus per-item Notes is not an object/location model.
- **Reuse versus proposal:** Existing photo/file identity, Notes, tags,
  search, and export can serve as evidence and access. Household object,
  room/cabinet hierarchy, confirmed location, history, and staleness are
  proposals.
- **Complete journey:** Enter “passport” and location → attach a photo → later
  confirm its move to a safe → query again → show latest confirmed location,
  previous observation and age/source → export linked evidence and verify
  originals.
- **Status and unknowns:** **Proposal.** No household object model or
  history contract exists. Exact retention, conflict, correction, and
  staleness rules need review before implementation.

#### 8. Find an appliance manual, invoice, and warranty evidence

- **Trigger and clues:** “Fridge warranty” when the owner remembers the
  appliance but not whether the manual or invoice is a PDF or photograph.
- **Experience:** One item-focused result could associate the appliance with
  its location, manual, invoice, optional user-confirmed purchase/warranty
  dates, and any selected external observation. The user selects the needed
  evidence and takes out originals together.
- **Data, processing, domain/install dependencies:** Household item/document
  references and structured dates would need reviewed durable semantics. OCR
  on a receipt or invoice photo could improve clues when its local processor
  is ready; this does not claim PDF text extraction. PDF preview remains
  conditional on the current reader.
- **Reuse versus proposal:** Shared search, attachments as ordinary files,
  original access and verified export are reusable. Appliance entity,
  typed warranty fields, and cross-document item view are proposals.
- **Complete journey:** Search “fridge/warranty” → inspect linked item and
  evidence provenance → open a supported PDF or download it → select manual
  and invoice → create a frozen takeout → verify each original.
- **Status and unknowns:** **Proposal.** No item/document relation or warranty
  application exists. Whether warranty dates are user-entered facts or
  extracted suggestions needs a separate contract.

#### 9. Check food expiry from a known label date

- **Trigger and clues:** “Which pantry items expire this month?” with a
  photographed package label or a date explicitly entered by the owner.
- **Experience:** A bounded future list could show the entered/confirmed date,
  evidence image, source, and unknown state. A reminder is a separate
  consumption feature; first prove the owner can query an accurate list.
- **Data, processing, domain/install dependencies:** Inventory quantity and
  consumption semantics, a date field, explicit user confirmation of any
  OCR-derived candidate, and later a separately reviewed reminder delivery,
  duplication, acknowledgement, and expiry contract. Grocy documents
  inventory and expiry workflows; that reference does not make Cairn one.
- **Reuse versus proposal:** Image storage, OCR candidate extraction when
  ready, shared search, and original verification may be reusable. Food
  inventory, expiry query, and reminders are proposals.
- **Complete journey:** Capture label → show extracted date and uncertainty →
  owner confirms or corrects → query dates within a chosen window → inspect
  evidence → only after a distinct review, opt into a reminder and see its
  delivery/acknowledgement state.
- **Status and unknowns:** **Proposal.** No food inventory, expiry query, or
  reminder workflow is established. Never invent a date from an unreadable or
  unconfirmed label.

### C. Observations, TV, AI, and whole-interface choice

#### 10. Review a selected Home Assistant observation

- **Trigger and clues:** The owner wants to recall whether a selected sensor
  was unavailable during a past period, without asking Cairn to control it.
- **Experience:** A future read-only record could display a room breadcrumb
  alongside the observed state, original source, observed and received time
  where available, context, and explicit `unknown`/`unavailable` states. The
  room breadcrumb and source/time emphasis are our proposed UI; they are not a
  claim about Home Assistant's screen. A historical snapshot is not a live
  dashboard.
- **Data, processing, domain/install dependencies:** Explicitly configured
  bounded entity/event selection and cadence; mapping of Home Assistant
  state, attributes, timestamps, and context; source-truth boundary remains
  Home Assistant. High-frequency data should not become one file per message
  or a new time-series service. A concrete use case may justify windowed
  original archives with retrieval at the archive's actual granularity.
- **Reuse versus proposal:** Existing preservation and search could apply to
  explicitly selected archive files. The read-only connector, mapping,
  retention, cadence, and snapshot view are proposals.
- **Complete journey:** Configure a narrow selection and bound → capture a
  chosen snapshot/window → inspect it later with source/time and unknown
  states intact → export the retained original if one exists → restore and
  verify without claiming live state.
- **Status and unknowns:** **Proposal.** No HA integration exists. Do not
  copy a state JSON blob and call it a semantically correct device model;
  device/area relations and state-object context need deliberate mapping.

#### 11. Browse personal photos, music, or video on a television

- **Trigger and clues:** The owner wants a living-room way to browse the same
  personal photo collection, play verified music, or watch retained video.
- **Experience:** A future TV client would consume the same identity and
  user-selected scope. It would show clear unsupported/unavailable outcomes
  and could provide photo exhibition, audio playback, and a separately
  reviewed video experience.
- **Data, processing, domain/install dependencies:** Safe single-owner device
  access, deployment and authentication, supported file/profile behavior,
  playback, and—if streaming requires it—range/transcode semantics. A TV
  presentation must not create a second media catalog or bypass original
  verification policy.
- **Reuse versus proposal:** Shared catalog, Photos/Music presentations,
  search and identity are conceptual reuse. A TV application, remote access,
  streaming, and video player are proposals. Current browser bounds do not
  imply a TV path.
- **Complete journey:** Authenticate as the one owner → select an existing
  result set → browse a supported domain → play only through a qualified
  verified path → see refusal/reason for unsupported content → return to
  original access and export.
- **Status and unknowns:** **Proposal.** No TV client, secure remote access,
  or retained-video playback is established. Client format support and
  complete-identity verification boundaries need review.

#### 12. Turn natural-language input into a confirmed household record

- **Trigger and clues:** “The spare key is in the blue box in the hall closet,”
  or a photo showing a label and the item location.
- **Experience:** A future assistant could propose fields with cited input
  evidence and uncertainty, show a review screen, and write only after an
  explicit owner confirmation. Corrections and source/time remain visible.
- **Data, processing, domain/install dependencies:** A reviewed household
  record contract and provenance plus a separately selected model or
  extraction provider. The provider and accepted-fact contract are independent
  of DSH/MCP/AI-harness integration; those integrations remain separately
  deferred. BGE semantic search is retrieval, not generation: it does not
  extract household facts or establish them as true.
- **Reuse versus proposal:** Existing Notes and search can hold user-authored
  text; extracted/model-produced durable descriptions have their own
  provenance contract. Structured object/location facts and confirmation
  workflow are proposals.
- **Complete journey:** Submit text/photo → receive a clearly provisional
  candidate with evidence → accept, edit, or reject each field → confirmed
  record shows who/when/source → later search and export linked evidence.
- **Status and unknowns:** **Proposal.** No AI household entry flow exists.
  AI-harness integration is deferred; automatic write, silent inference, and
  unreviewed tag changes are excluded.

#### 13. Choose a complete interface around a task

- **Trigger and clues:** The owner alternates between leisurely photo browsing
  and dense household/document maintenance and wants each to feel natural.
- **Experience:** A browsing shell could open Photos into a wall/exhibition and
  keep secondary management actions disclosed. A task shell could foreground
  dense rows, details, filters, and batch operations. Both retain the same
  search, selection, Notes, current Music player, original actions, and
  recovery states. A future versioned presentation package could declare
  complete page compositions and action slots as data, after the applicable
  review.
- **Data, processing, domain/install dependencies:** Current built-in layouts
  and registered Photos/Music presentations exist; broader fixed package
  composition is bounded by ADR-032. Package admission is whole-or-refuse at
  build/install; package data cannot run code or reach recovery. No package
  may hold private parallel selection/query state.
- **Reuse versus proposal:** Existing layouts, domain pages, and palettes are
  current. Whole-page composition packages are a proposal, not just a larger
  theme selector and not a public runtime extension system.
- **Complete journey:** Preview a browsing/task layout → apply it → perform
  search, selection, Details/Notes, player, and original takeout → switch
  layout → verify the same host-owned subject/scope/player state → restore the
  default if desired.
- **Status and unknowns:** **Current layouts; broader composition proposal.**
  A candidate must improve a complete task. Visual competitor patterns below
  are documented capabilities, not firsthand observations of their UI.

### D. Short-term task context

#### 14. Put a reading/research task aside and return later

- **Trigger and clues:** The owner has several related browser tabs, a PDF and
  a note for one investigation. They want to close the tabs without forgetting
  why the material was collected, then resume by a familiar task title.
- **Experience:** Use an ordinary owner-authored/exported record with chosen
  URLs, titles, human order and an explanation. Shared tags/Notes and supported
  search find the record and related files. Inspect/download originals and
  manually open chosen links. This needs no native task view; it does not
  preserve webpage contents or authenticated browser state.
- **Reuse versus proposal:** Existing exact file preservation, tags/Notes,
  admitted text search, original export and restore apply to the record file.
  Dedicated context meaning, selected-tab capture, parsing, return automation
  and page archiving are unscheduled ideas, not follow-on delivery tasks.
- **Complete journey:** Choose links → save a named record → confirm success →
  deliberately close the chosen source tabs → find the record later → review
  and reopen chosen references → take out/restore the captured record. Failed
  or unknown saves must not close source tabs; a missing destination leaves
  its captured reference intact. Short-term use does not authorize expiry.
- **Status and dependencies:** **Current ordinary-file reuse; dedicated app
  proposal.** The [task-context design](../technical/task-context-and-short-lived-information-design.md)
  distinguishes this from file-only LinkGroup, dynamic SavedView, frozen
  ExportManifest and caches. PC-12 reuse and PC-13–15 unscheduled ideas in the
  [closure breakdown](../technical/product-experience-todo.md#product-closure-work-breakdown--2026-10-14)
  retain this distinction without a staged app/capture commitment.
- **Reference uncertainty:** The exact “Later On” product is unidentified.
  Tablerone, OneTab and Tab Stash are verified comparable patterns below;
  no identity, adoption, hands-on UI or equivalent Cairn capability is claimed.

## Reference-product matrix

These references establish documented product patterns only. They are not
hands-on evaluations, quality rankings, customer evidence, or claims that Cairn
has equivalent functionality. “Borrow” entries are proposals/inferences for
review, not accepted requirements.

| Reference and official source | Documented pattern relevant to these scenarios | Candidate experience to study for Cairn | Boundary: what not to copy or infer | Evidence limit |
| --- | --- | --- | --- | --- |
| [Nextcloud Files](https://nextcloud.com/files/) | File storage and sharing within a broader platform; official materials document cross-app unified search and applications. | **Our proposal:** enter through familiar file tasks, keep search available across destinations, and expand advanced filters only when requested. | Do not infer that a single search field alone creates consistent identity, authorization, selection, or verified export. Do not copy sharing/multi-user scope into Cairn's one-owner model. | Official product page and prior official-doc review; no UI trial in this work. |
| [Immich search documentation](https://docs.immich.app/features/searching/) and [documented advanced-filter screenshot](https://docs.immich.app/assets/images/advanced-search-filters-c201f96631a94cc39f4cd7a6d114448e.webp) | Search documentation covers image context/CLIP and metadata clues, including OCR text, camera facts, time, descriptions, and tags; it links an advanced-search filter image. | **Our proposal:** start with a plain clue search, then expand advanced filters; separate filename/metadata/OCR clues from approximate visual-concept search and explain the match type. The linked pixels were not inspected here. | Do not conflate visual similarity with exact identity, or import face/people features as current Cairn behavior. Do not claim visual style or hands-on quality. | Official documentation and its linked screenshot asset; the documented filter pattern is cited, not a visual trial. |
| [Navidrome overview](https://www.navidrome.org/docs/overview/) | Music-server functionality includes metadata, playlists, queue/client ecosystem, and transcoding in the prior official review. | **Our proposal:** keep domain-focused artist/album/track navigation with the shared player continuously available; distinguish transient queue from reusable ordered playlist. | Do not treat client ecosystem, transcoding, or server streaming as present in Cairn; do not use folder grouping as playlist semantics or copy quantitative quality claims. | Official documentation as captured in the source record; no client trial here. |
| [Jellyfin project](https://github.com/jellyfin/jellyfin) | The official project presents media-server functionality and clients; the prior strategy research used the repository as fallback after media-doc transport failure. | **Our proposal:** keep Photos/Music/Video task pages focused while one host-owned player remains available across navigation; study domain-focused layout and playback continuity, not a visual style claim. | Do not infer a supported Cairn stream/range/transcode contract, format coverage, or equivalent clients. Do not copy client-ecosystem breadth or quantitative quality claims. | Official repository fallback; the cited media documentation was unavailable during prior research. No UI trial. |
| [Home Assistant state object](https://www.home-assistant.io/docs/configuration/state_object/) | A state object carries state, attributes, timestamps, and context; device/area are not properties of the state object itself. | **Our proposal:** preserve source and observation time, model unknown/unavailable explicitly, and show a room breadcrumb when a reviewed mapping supplies one. Design mapping rather than copying an arbitrary JSON object. | Do not present Cairn as controller, automation engine, live mirror, or time-series system. A breadcrumb is a Cairn UI suggestion, not an HA state-object field. | Official documentation verified in the research record; no integration test or UI trial. |
| [Grocy](https://grocy.info/) | Product materials cover household inventory/expiry and equipment/manual information, with customization/API and feature controls documented by its public materials. | **Our proposal:** lead an inventory view with items due soon, keep equipment evidence under an item-focused view, and let an owner enable only the household capabilities they choose so unused features stay out of the way. | Do not claim Cairn should reproduce a broad household-management suite, or that a date/reminder is reliable without confirmation and delivery semantics. Capability enablement is a Cairn proposal, not a claim about Grocy's exact UI. | Official public product/documentation patterns cited by prior research; no UI trial or feature-by-feature audit here. |
| [Tablerone selected-tab saving](https://tabler.one/help-and-support/multiple-ways-to-save-tabs/amp/) and [session guide](https://tabler.one/help-and-support/tag/getting-started/) | Selected tabs can be saved to sessions; closing after save is configurable. The guide lists selective reopening, tags, Notes and import/export. | **Our proposal:** one named research context with explicit selection, save confirmation and selective return. | No automatic close, assumed page capture or browser-secret retention. Do not identify it as the user's “Later On.” | Official documented behavior; no extension installation or trial. |
| [OneTab](https://www.one-tab.com/) | Save tabs as a list, restore individual/all links and import/export lists. | **Our proposal:** begin with a compact link list and portable record rather than a project-management suite. | A restored URL list does not recreate page bytes, login or full browser state. | Official product page; no quality or resource-saving claim adopted. |
| [Tab Stash](https://josh-berry.github.io/tab-stash/) | Bookmark-backed groups support search and selective restore. | **Our proposal:** keep return-to-task actions lightweight and leave detailed organization disclosed. | Reusing Cairn authority does not mean browser bookmarks become another Cairn catalog or recovery authority. | Official project page; no integration or UI trial. |

## Unscheduled questions raised by the examples

These are questions, not priority rankings, an implementation queue or later
delivery stages. First use the ordinary recipe and identify a concrete gap;
only a separately reviewed request can schedule additional behavior.

| Question | Possible user benefit | Current gap | Boundary if separately requested |
| --- | --- | --- | --- |
| Complete mixed trip and large-item paths | Find, use, and take out real mixed content | Journey and bounds need current-build proof | Existing client/core gates; exact supported PDF and export/playback scope |
| Ready visual search and OCR search | Retrieve images by visual idea or printed text | CLIP/OCR code exists; deployment readiness and real-content acceptance unknown | Bundle/readiness evidence, generation/provenance, result UI; keep image vectors separate from BGE |
| Reusable albums and ordered playlists | Return to curated photo sets and listening order | Transient queue/tags do not persist those meanings | Separate durable membership, repeats/order, missing entries, recovery and export contract |
| Household item/location lookup | Find stored items and attached evidence | No item/location application contract | User evidence, structured record/history/staleness semantics, one-catalog mapping |
| Appliance paperwork | Retrieve manual/invoice/warranty evidence together | No item-document relation or warranty fields | Household contract, PDF truthfulness, evidence provenance and portable recovery |
| Food dates and reminders | Answer “what expires soon?” and optionally prompt later | No inventory/date/reminder flow | Start with user-confirmed dates and query; separately review delivery, repeat, acknowledgement and expiry |
| Selected HA observations | Recall a chosen past state | No connector or state mapping | Narrow scope/cadence, source/time/context mapping, unknown states, archive granularity |
| TV and whole-interface packages | Use the same library in another room and choose task-shaped pages | No TV/streaming; broader page composition remains proposal | Safe owner access and media contract; ADR-032 package boundary and host-owned state |

## Source and status notes

This catalog also reflects the locally retained product-direction discussion
and consultation record under `dist/product-strategy-20261014/` (not published
as repository documentation). Its current public authority is the
[README](../../README.md),
[Content-First Product Decision](../technical/content-first-product-decision.md),
[content/view/export contract](../requirements/content-store-views-and-exports.md),
[first-party client contract](../requirements/first-party-client-experiences.md),
and [Core MVP Execution Plan](../technical/core-mvp-execution-plan.md). The
[personal-information modules and installation design](../technical/personal-information-modules-and-installation-design.md)
contains the current code/status audit for the optional CLIP and OCR paths.
Scenario status must be refreshed from current source, configuration, bundle,
and acceptance evidence before any implementation or public claim. This
research catalog awards no phase credit and changes no normative status.
