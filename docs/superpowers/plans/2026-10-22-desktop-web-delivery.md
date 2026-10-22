# Shared Web Client and Desktop Workflow Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` with
> Luna implementing bounded feature work and the root agent deciding and
> reviewing. Keep one acceptance owner per complete feature. Steps use checkbox
> syntax. The owner's whole-feature-first testing decision overrides routine
> per-step TDD and broad-regression templates.

**Goal:** Make the existing Web client comfortable on a computer, with complete
Music and Photos workflows, then reuse demonstrated host/settings boundaries
for full interface choices and a later desktop wrapper.

**Architecture:** One Go service remains the content authority. One React Web
implementation owns the application flows and settings UI. Music, Photos and
alternative layouts call shared host actions; concrete native integration is
added later through a thin wrapper, without another client implementation.

**Tech stack:** Existing React, TypeScript, Vite and styles; existing Go typed
operations, ordinary `cairn.material-list.v1` files and host playback/takeout.
No new dependency or desktop framework is selected by this plan.

**Spec:** [Server, client and application product form](../specs/2026-10-22-server-client-product-form.md).
The [28-card index](2026-10-21-cairn-focused-delivery.md) remains the full product
inventory; this document supplies execution detail, not another queue.

## Global constraints and execution order

- These are **client delivery stages**, not replacements for core Phases 0–7.
- Implement S1 → S2 → S3, one complete feature at a time. S4 and C1–C3 below
  are explicit future candidates, not automatically executable successors.
- Computer layout first, using one representative desktop viewport per journey;
  do not start a phone/tablet/TV adaptation or Linux/NAS qualification campaign.
- Same Web code, application semantics and setting definitions across future
  hosts; preference values do not automatically synchronize between hosts.
- Retain navigation state within the same workspace/query/result scope; a new
  scope may reset it under the existing session contract. Do not preserve stale
  targets by defeating those resets.
- Reuse ordinary Notes/TAG, saved retrieval, material-list editor/Reader,
  capture and takeout. No new playlist/album/settings database or list head.
- Keep full-file SHA-256 plus logical length, current authorization and recovery
  meanings. Music remains bounded to 32 MiB per original and 1,000 transient
  queue occurrences in this admitted batch.
- Optional enhancements are unnecessary for the four standard workflows. Existing
  compiled first-party applications are trusted client code; token packages are
  data-only, and no runtime third-party loader or marketplace is admitted.
- User-facing completion, root review, relevant evidence, commit/push and the
  existing Linear card update belong to each feature. No helper-level progress
  is reported as an additional delivered capability.

## Starting point: what can already be reused

| Existing capability | Current evidence and implication |
| --- | --- |
| File/folder/text intake, Notes/TAG, saved retrieval and original takeout | Existing implementations and bounded local journeys; reuse rather than rebuild |
| ML-1 saved lists and ML-2 playback/unique-file takeout | Locally delivered; use the existing composer, Reader and host actions |
| Music facts, track/artist/album browsing, queue, shuffle/repeat and sleep timer | Present in source; remaining usability and integration need the S1 journey |
| Photos filtering, viewer, exhibition/slideshow, selection and originals | Present with earlier local journeys; remaining continuity and entry work belongs to S2 |
| Global selected-content list creation | Already wired through `SelectionBar` in Music and Photos as well as Library; this is not an absent capability |
| Direct domain-scoped list creation | Missing from the Music/Photos local range controls; global selection can include items outside the displayed domain |
| Complete compiled layouts and token packages | Existing separate mechanisms; S3 refines layout continuity and contribution guidance, not a runtime extension engine |
| Native desktop wrapper and cross-host preference synchronization | Not delivered; neither follows automatically from using Web technology |

These are source/bounded-evidence statements, not fresh runtime acceptance.
Do not mark the steps below complete merely because some underlying controls
already exist.

**Why this order:** Music exercises both content actions and a long-lived
playback session, so completing it exposes real host ownership needs. Photos
then demonstrates which handoffs truly repeat. Full interface choices reuse
those proven flows; a desktop wrapper comes later so it can package a useful
product rather than become another implementation of unfinished workflows.

## Standard workflow and adaptation contract

| Standard workflow | Baseline result | Shared owner / enhancement seam |
| --- | --- | --- |
| Save | Choose/drop/enter text → review → confirm save → locate saved material | Existing intake host; an alternate entry uses the same review/save lifecycle |
| Find and take out | Search/filter → inspect context → choose targets → download/export | Existing query, Details and takeout; alternate views do not invent another query or export authority |
| Listen | Browse → play → adjust queue → save explicit selection → reopen/use | Music renders host facts and one playback session; layouts/panels may differ |
| View photos | Find → view/exhibit → annotate → save selection/take out → return | Photos renders the same selected subjects and host actions; alternate galleries retain return context |

For all four, the desktop convention is stable app entry, domain navigation and
primary actions, main content, and on-demand details/secondary tools. The active
player remains reachable. Layouts can rearrange these regions; do not expose
every management control permanently or force every application into one page.

Existing typed commands, client action callbacks and real host capabilities
are the adaptation boundaries. Add a native adapter method only for a selected
feature. No empty generic SDK, new platform service graph or mock-only module.

## S1 — Music: browse, listen, save and reopen

**Card:** F15 / [AIL-54](https://linear.app/ailiheizi/issue/AIL-54), reusing
F02/F09/F10. **Phase:** admitted personal client track. **Requirement:**
[first-party client contract](../../requirements/first-party-client-experiences.md)
and [ML-1/2](../../technical/material-list-client-contract.md).

**Usable stage result:** A focused computer-sized Music application with clear
Tracks/Artists/Albums entry, current listening and queue; a clearly scoped
selection can be saved, found again and played or taken out through the existing
list Reader. Changing application does not restart the player.

**Files and interfaces:**

- `web/src/components/MusicLibraryExperience.tsx`: existing local datasets,
  browse hierarchy and `music-scope-actions`.
- `web/src/components/music/musicHelpers.ts`: `MusicLibraryProps`.
- `web/src/components/LibraryPageHost.tsx`: `LibraryPageHostProps` and `renderMusic`.
- `web/src/components/LibrarySurface.tsx`: thread the existing list callback to
  the media host while keeping the global SelectionBar.
- `web/src/main.tsx`: reuse `openMaterialListEditor(subjects, initialDocument?)`
  and `resolveArchiveSelectionSizes(...)`; do not copy the composer lifecycle.
- Existing `MaterialListComposer`, `MaterialListReader`, `DetailsPanel`,
  `useAudioPlayback` and `AudioPlayer` remain owners. Update only affected styles
  and localized strings alongside their surface.

### Steps

- [x] **S1.1 — Establish the first screen.** Keep existing browse modes and real
  metadata/filename fallback. Make browsing, play/current track and queue easy
  to find; put selection management and original takeout in the existing
  disclosure. Reuse current controls rather than rebuilding facts or playback.
- [x] **S1.2 — Define exact action scope.** Use existing `selectedDisplayedHits`
  for selected visible tracks and `displayedTrackHits` for the current displayed
  set. Show which set/count an action uses. Keep off-view global selection out
  of a domain-scoped action and leave the global SelectionBar's existing
  broader semantics visible.
- [x] **S1.3 — Connect the domain entry.** Add optional
  `onCreateMaterialList?: (subjects: SearchHit[]) => void` and
  `materialListCreationDisabled?: boolean` to the existing media host/Music
  props; thread the already-existing callback and disabled state from
  `LibrarySurface`. Reuse the `main.tsx` callback binding; no new command.
  Enable the domain action only under the same existing content/composer
  readiness and size/count restrictions as ordinary list creation.
- [x] **S1.4 — Finish save and review.** Open the current composer with that
  explicit set. Preserve its name, order, optional copied context/Skill and
  review/save behavior. Report confirmed capture separately from an open draft
  or staged upload. A selected set is not a serialization of the repeated live
  queue; any user-edited snapshot repetitions retain existing ML-1 semantics.
- [x] **S1.5 — Finish reopening.** Make the existing Library → saved ordinary
  file → Details Reader route understandable from Music and after successful
  capture. Reuse current navigation and visible saved content; do not create a
  new global playlist registry, silently search beyond loaded scope, or add a
  second Reader. Its play/append/takeout remain existing ML-2 host actions.
- [x] **S1.6 — Integrate continuity and useful exits.** Preserve the current
  player through Photos/Overview/Library navigation. Keep queue limits,
  unresolved-member behavior and original-takeout options for unsupported or
  oversized audio. Fix actual entry/focus/continuity gaps exposed by the full
  journey; do not rewrite shared state solely to introduce abstractions.
- [x] **S1.7 — Deliver the whole result.** Build the affected Web client with
  `npm --prefix web run build`, then run the single named **Music save/reopen
  journey** below. Reuse existing local deployment and browser helpers; diagnose
  failures locally. Root reviews the diff, records what works and what remains,
  commits/pushes and updates AIL-54. No independent suites per step.

**Music save/reopen journey:** On real retained audio, browse artist/album and
play A/B; append repeated A and edit the transient queue. Keep another subject
selected outside the current Music display, save only the explicit Music set,
and confirm the saved list excludes that off-view item. Reopen via the existing
Reader and use play/append/takeout. Navigate Photos/Overview/Library and return
with current source/position/queue intact. In that same journey retain visible
unsupported/oversized fallback and unresolved-list behavior where exercised.
Compare taken-out originals with the retained inputs. Optional enhancements
are disabled; no native wrapper is needed.

**S1 delivered locally, 2026-10-22:** the whole Music journey and the
current-build no-save continuation passed. Domain save excludes off-view
selection; a single selected track opens a one-track composer. The one captured
734-byte list (`sha256:0c9462a51487ac6789b87cdd4960dbe555aae2e54f02ce7c4b3127a71d19f8b5`)
reopened and appended its two audio members after a four-occurrence queue.
Original ZIP bytes matched both retained MP3s. After the media-disclosure
refinement, capture and ZIP evidence were reused; no second mutation was made.
The final build preserved the same six occurrences, source and paused 3.48s
position across Photos/Overview/Library. Evidence:
`dist/music-s1-20261022/acceptance/journey.log` and screenshots; final assets
`index-x-TRTQk6.js` / `index--HXH7Y6U.css`. Root reviewed the diff. This is the
bounded local workflow, not streaming or release qualification.

## S2 — Photos: find, view, save a selection and return

**Card:** F14 / [AIL-49](https://linear.app/ailiheizi/issue/AIL-49), reusing
F02/F09/F10 and S1's host callback. **Phase/requirement:** the same admitted
first-party client and ML contracts. **Prerequisite:** S1's shared handoff is
reviewed; no separate framework must be completed first.

**Usable stage result:** A focused photo application where the user finds a
set, continuously views it, adds Notes/Favorite, saves/reopens a selection or
takes out originals, and returns to the same filtered place.

**Files/interfaces:** `PhotoLibraryExperience.tsx` and its existing props/local
selection projection; `LibraryPageHost.renderPhotos`; the S1 media-host list
callback; existing photo viewer/exhibition, Details, composer/Reader and takeout.
Reuse selection projections already used by photo bulk actions; do not replace
original row/index mappings or introduce an album store.

### Steps

- [x] **S2.1 — Reuse the domain handoff.** Extend Photos' existing props with
  S1's optional list callback/disabled state and thread it from `renderPhotos`.
  The current global list action stays available.
- [x] **S2.2 — Make the saved set explicit.** Add one direct contextual save-selection
  action beside View selected photos, outside secondary filter disclosures. Resolve selected matching
  Photos only, show the count and exclude unrelated off-view global selection.
  Do not record temporary filters/viewer position as list membership authority.
- [x] **S2.3 — Close save/reopen/takeout.** Reuse the same composer, capture and
  Reader as Music. Preserve user-edited list context, unresolved rows and
  existing unique-file takeout behavior. Show the difference between looking
  at a photo rendition and taking out the exact original.
- [x] **S2.4 — Refine the computer workflow.** Keep date/tag/format filters and
  main viewing controls easy to reach. Preserve filter, focus, selection and
  unsaved-note guards through viewer/exhibition, Notes/Favorite and takeout.
  Keep missing date, unavailable preview and original fallback understandable.
- [x] **S2.5 — Deliver the whole result.** Build the affected client and run
  one **Photo selection/reopen journey**. Root reviews, records the usable
  result and gap, commits/pushes and updates AIL-49; no unrelated image/model
  or backend regression campaign.

**Photo selection/reopen journey:** Filter real retained photos by known
date/tag, select a small set, view continuously/exhibit, add a Note/Favorite,
save and reopen the selected set through the shared Reader, take out originals
and return to the same filter/focus/selection. Keep an unrelated selection out
of the saved photo set. Use the existing unavailable-preview/original fallback
in this journey where applicable. Optional enhancements are disabled.

**S2 delivered locally, 2026-10-22:** the selected matching Photos action
opens the shared composer directly, outside secondary filter disclosures.
PNG/name filtering, persisted Notes/Favorite, Exhibition navigation/slideshow,
one reviewed 959-byte list capture, Reader reopening and exact-original ZIP
passed on `index-Ci2kVb7W.js` / `index-CyK9lCIg.css`. The list contained only
Photo-A/B, excluding foreign audio/text selections. Date controls honestly name
source modification time; this journey did not prove camera capture dates.
Closing Details through Back to results restored Photo-A keyboard focus with
filter and selection intact. The initial `.is-current` assertion confused the
Details subject with browsing focus; source tracing and actual DOM focus
resolved it without a product patch. Capture was not repeated. A continuation
driver did repeat the already verified ZIP once; both outputs matched the same
retained originals and no further takeout was requested. Evidence:
`dist/photo-s2-20261022/acceptance/journey.log` and screenshots. Root reviewed
the product diff and browser screenshots. No core phase or release credit.

## S3 — Complete interface choice over the same application

**Card:** F16 / [AIL-58](https://linear.app/ailiheizi/issue/AIL-58).
**Phase/requirement:** admitted compiled first-party interfaces and ADR-032's
separate data-only package boundary. **Prerequisite:** S1/S2 demonstrate the
real common host needs. **Usable result:** two meaningfully different complete
layouts, shared settings UI, and one documented compiled contribution example.

**Files/interfaces:** existing `lib/interfaceCatalog.ts`, `InterfaceFrame.tsx`,
`InterfaceRenderBoundary.tsx`, `AppearancePreferences.tsx`, `lib/appearance.ts`,
`app/useAppearance.ts` and `ClientBrowseSession.tsx`. The existing
`AppearancePreference` definition and host state remain authoritative.

### Steps

- [x] **S3.1 — Use the existing two shells.** Make Workspace and Showcase
  express distinct navigation/layout arrangements for the same Music/Photos
  flows. Preserve standard actions and active-player reachability. Do not count
  a color change alone as a second complete interface.
- [x] **S3.2 — Keep settings single-source.** Reuse appearance/interface
  definitions and settings controls. Describe instance configuration separately
  from client preferences and device/session state. Existing localStorage
  remains local; no settings table, new endpoint or silent synchronization.
- [x] **S3.3 — Extract only a demonstrated seam.** Document the IDs and slots
  already used by the compiled catalog, same-host-build/context compatibility,
  required host callbacks, settings
  ownership, activation/cleanup and available fallback. Supply one trusted
  in-repo example reusing those mechanisms; avoid a speculative public ABI,
  generic service graph or a second module registry.
- [x] **S3.4 — Preserve defaults and failure exits.** Retain existing duplicate
  registration refusal, unknown-choice fallback and render boundary. Explain
  which host actions are unavailable; optional contributions must not remove
  default save/find/takeout/listen/view capability. A token package cannot
  supply JavaScript components or alter durable data meaning.
- [x] **S3.5 — Deliver the whole result.** Build and run one **Layout switch
  journey** using the same real saved material and host session. Reuse the
  existing interface journey/helper when applicable, adapting its relevant
  steps rather than running its unrelated historical fault campaign. Review,
  commit/push and update AIL-58 with the actual layout/contribution limits.

**Layout switch journey:** Find material, open Notes, play audio, switch the
complete layout, use the same saved list/original takeout and return with
scope, draft guard and playback preserved. Demonstrate the default usable
layout with the optional example disabled/unavailable. This proves client
composition only; no new server or runtime-plugin capability is claimed.

**S3 delivered locally, 2026-10-22:** the current S2 Web build passed a
read-only Workspace → Showcase → Workspace journey with real Track-A search,
selection, an unsaved Notes draft and the same verified player paused at 0.45s.
Unknown stored interface choice fell back to Workspace before playback.
The existing S1 saved list reopened both tracks and exposed enabled unique
original takeout; no save or download was requested. The draft was discarded
only through the existing explicit guard after continuity was proved. The QA
profile visibly reported degraded semantic coverage; this is layout evidence,
not qualification of the default semantic profile. Existing registration and
renderer boundaries were retained, not changed or fault-injected.

The contribution guide now includes the real Showcase catalog/renderer example,
host-node and settings ownership, shared focused-media composition, browser-local
preference limits and feature-level acceptance guidance. No third shell or
extension framework was needed. Root reviewed source, guide, log and screenshot.
Evidence: `dist/client-s3-20261022/acceptance/journey.log`, `journey.json` and
screenshots. The temporary daemon stopped. This completes the selected S1–S3
client batch only; it grants no core phase or release credit.

## S4 — Future desktop wrapper: reuse the delivered Web product

**Existing home:** F27 / [AIL-79](https://linear.app/ailiheizi/issue/AIL-79),
related F16. **State:** conditional future packaging, not current admitted code
work. S1–S3 deliver a usable browser product without this stage.

**Target result if selected:** the same Web build and settings UI run in a
desktop window with one concrete host benefit. No independent native UI.

- [ ] Select the first required host benefit and target platform. Evaluate a
  native file/folder picker or system media-key integration against what the
  existing browser already supplies; select only useful missing behavior.
- [ ] Choose the wrapper after that need is known. Define service connection,
  allowed native operations and distribution/update behavior in F27; do not
  assume remote access or an embedded daemon is already supported.
- [ ] Package the same Web output. Add only the selected host adapter and its
  available/unavailable behavior; preserve browser fallback and typed API use.
  A local desktop path is not automatically a server-side path or authority.
- [ ] Reuse the same setting definitions. Keep secrets, local paths and device
  state local. Decide any explicit portable preference handoff as a separate
  selected F16 subfunction; automatic sync is not implied.
- [ ] Demonstrate the already-delivered standard flow plus the one native
  benefit on the selected target. Report what browser and wrapper share and
  what the wrapper adds; no all-platform packaging matrix by default.

The wrapper plan must be completed against the chosen host before coding;
framework-specific files/signatures cannot be honestly fixed now.

## Later capability candidates: keep their functional boundaries

These retain existing cards and are not an unconditional S4 → C1 → C2 → C3
execution chain. Choose by the next concrete user need; each needs its own
complete capability contract before implementation.

| Candidate | Intended usable result | Required steps before delivery |
| --- | --- | --- |
| C1 — F11 → F12, ordinary Skill reuse then explicit AI organization | Correct instructions, select material, inspect a real AI candidate, confirm a saved result and use it without another model call | Finish only actual guide-reuse friction; define exact selected inputs/provider/transfer/cancel/stale behavior; admit the narrow runner; reuse the ordinary composer/Reader and prove one real-provider journey |
| C2 — F15 larger-media successor, then F17 video | Start/seek/cancel supported larger media while exact originals remain independently available | Select formats and useful budgets; define authorized immutable reads, verification timing, cache/cancellation; review any needed read API; implement one complete playback journey. A Web wrapper or virtual list does not provide streaming/transcoding |
| C3 — explicit preference handoff or additional client contribution | Carry selected UI choices between hosts, or add one actually requested layout/action | Define allowed portable fields/version handling or the concrete host contribution; exclude secrets/device paths; reuse settings or compiled registries; verify the single user outcome. Runtime third-party loading is outside current scope |

## Coverage of the existing product inventory

| Existing function group | Treatment in this plan |
| --- | --- |
| F01–F08 save, navigation, find, document/OCR/visual search, Notes/TAG, saved retrieval | Shared existing foundation. F02 continuity is part of S1/S2; concrete search/intake failures stay in their owning card. No blanket rebuild or new retrieval model |
| F09–F10 ordinary lists and their use | Delivered local foundation reused by S1/S2 |
| F11–F13 guide reuse, AI organizer, program consumption | Retained; C1 is conditional, and ordinary result consumption remains possible without AI |
| F14–F16 Photos, Music, complete interfaces | Current client sequence S1 Music → S2 Photos → S3 interfaces |
| F17 video | C2, not silently delivered by saving/downloading video |
| F18–F21 research sets, household information, voice, external AI file retrieval | Existing future cards; not expanded into this desktop-layout batch |
| F22–F26 large-library continuity, export, recovery, savings, LinkGroup | Existing shared capability/core queue. Reuse exact takeout; preserve actual phase gates and do not introduce LinkGroup schema from a client plan |
| F27–F28 installation and product explanation/demo | S4 only if selected; update explanation/screenshots with each actually delivered feature rather than create a separate testing campaign |

## Review focus, progress and handoff

Watch five concrete conditions within the relevant whole-feature journey:
off-view selected content entering a scoped list; draft/cancel/stale workspace
handoff; unresolved list members being silently omitted; competing/remounted
playback state; and unavailable facts/previews or oversized originals being
presented as usable media. Preserve existing behavior and diagnose observed
failures; these are not instructions for five new local suites.

Implementation tasks stay unchecked until their useful result and relevant
evidence exist. A source inspection, plan, screenshot mockup or build alone is
not a delivered feature. After each complete stage, report: what the user can
now do, its real limits, the named journey result and the code commit.

Root decides/reviews; Luna implements; one assigned owner runs the stage's
journey after integration. This plan authorizes no product code by itself and
does not alter the core phase gates. The selected **S1–S3 client batch is locally delivered** with evidence above.
No next implementation batch is active. F11 remains the next reuse-friction
candidate; integrated AI, desktop packaging and larger media retain their
separate contracts and are not automatically started.
