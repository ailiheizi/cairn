# Cairn server, client and application product form

**Date:** 2026-10-22
**Status:** Proposed detailed design, clarified by the owner on 2026-10-22:
build one Web client first, reuse it in a future desktop wrapper, and prioritize
the computer/desktop layout and a few standard workflows. Documentation only;
existing admissions and core phase gates are unchanged. The functional order
below updates the current client queue, not the core execution plan.

## User intent and chosen form

The owner wants one place to keep original material and useful descriptions,
find it again, and use it through comfortable specialist experiences. Ordinary
Skills and saved lists remain reusable material. Customization includes whole
layouts and interaction patterns. Mature music clients are relevant references
alongside self-hosted storage products. Delivery must improve a complete user
activity, with few concepts and extensive reuse.

Choose **one Cairn service and one shared Web client, delivered through the
browser and later a desktop wrapper**. Both use the same application modules,
settings definitions and user-visible data semantics. The client includes Library, Music and Photos;
Overview is a composed starting view. Users enter an application directly and
return without losing their place or ongoing playback. Search, Notes and
takeout remain reachable on demand. An application's own navigation can occupy
the whole page; shared state does not require permanent shared toolbars.

Keep one repository and the existing deployment shape initially. Complete the
computer-sized browser experience before packaging a desktop wrapper. The
wrapper reuses that frontend and adds only concrete host capabilities; it does
not establish another product, business-logic implementation or settings UI.
The browser's default surface can disclose fewer advanced controls while still
using the same underlying application. Desktop-only actions appear when the
host actually supplies the relevant capability.

The current UI work targets computer/desktop layouts. Do not open a phone,
tablet, TV or cross-platform packaging workstream. Choose one representative
desktop viewport for each feature journey and preserve ordinary keyboard,
scroll and resize usability; no new responsive-layout matrix is required.
A future separately authored client is an interoperability possibility, not
the planned desktop implementation. The local API does not establish remote
authentication, transport or third-party compatibility guarantees.

| Alternative | Benefit | Cost and decision |
| --- | --- | --- |
| Shared Web client with specialist applications, then desktop wrapper | One set of UI, workflows and settings; deep domain layouts plus optional host integration | Native capabilities require a narrow adapter; selected |
| Separate Music, Photos and Library products immediately | Maximum UI independence | Repeats connection, settings, discovery and integration work; later only for a concrete device/use need |
| Server only, external clients supply all experience | Smaller first-party UI commitment | Gives up the comfortable default workflow the owner wants; not the product target |

## Responsibility and retained information

| Owner | Responsibilities | Reuse boundary |
| --- | --- | --- |
| Server | Exact original content, authoritative Notes/TAG/facts, capture, lexical/structured/local semantic discovery, authorized takeout and recovery | Existing daemon, one catalog/repository and typed operations; no music/photo catalog fork |
| Shared client host | Connection and command adapter, navigation and shared result/selection context, drafts, original access, one playback session, settings UI | Same Web code in browser/desktop; existing hooks and actions retain authority |
| Environment adapter | Concrete file selection/download handoff and optional system/media integration | Browser implementation first; desktop supplies capability-specific additions later, without direct catalog access |
| Application module | Domain browsing, hierarchy, full-page layout, application-specific controls, interpretation of existing saved material | Music/Photos consume host capabilities; route changes preserve host state |
| Application extension | A bounded contribution such as a viewer layout, now-playing panel or a future lyrics display | Start with trusted compiled components; use actual application needs to define seams |

Search results and indexes remain server projections. Applications may filter
the already-loaded scope and retain local browse/scroll/focus state; they do
not create another catalog-wide search authority. The host keeps global query
meaning explicit when moving between Library and a domain page.

Originals, descriptions and saved list snapshots survive client replacement.
Temporary queue, focus and unsaved drafts are client state; preserving them
across navigation does not promise browser-restart or cross-device persistence.
The current ordinary list is an immutable saved result with explicit recapture
for changes, not a live playlist head. Saving a selected set need not preserve
the transient queue's repeated occurrences; the editor's existing ordering and
repetition controls determine the snapshot. Do not claim queue-to-list export
unless that specific handoff is delivered.

If a future feature needs shared settings, listening progress or automatic
updates, specify that user outcome and its persistence semantics inside the
owning feature. Reusing file storage alone does not implement synchronization,
conflict resolution or recovery of new meaning. Disabling an application never
deletes saved originals or ordinary user-authored material.

## Standard workflows and adaptation

Deliver four recognizable workflows before expanding the extension system.
Music and Photos are currently the incomplete delivery priorities; existing
save/find/takeout operations supply their common foundation.

| Standard workflow | Default result | Extension opportunity |
| --- | --- | --- |
| Save | Select/drop files or enter text → review → confirm save → locate result | Alternative entry or capture UI submits to the same reviewed intake |
| Find and take out | Search/filter → inspect useful context → select → download/export | Alternative result presentation or detail panel uses the same authorized results/actions |
| Listen | Browse → play → manage queue → save an explicit selection → reopen/listen | Browse layout, current-track panel or future controls consume the host playback session |
| View photos | Find → view/exhibit → annotate → save selection/take out → return | Viewer/gallery arrangement consumes the same subject scope and host actions |

Use a desktop page convention rather than cloning one rigid toolbar: stable
application entry, domain navigation and primary actions, main content, and
on-demand details/secondary actions. The shared player stays reachable when
active. Applications and complete layouts may rearrange these regions while
preserving the workflow and return context.

Each standard journey must complete with optional extensions disabled. Music
lists and saved photo selections use the same existing v1 material-list save,
reopen and takeout behavior. This is a condition of the single feature journey,
not a new independent extension-test matrix.

The initial adaptation conventions are small: the existing typed server
command boundary; the client host's selected-content and action context; and
actual environment capabilities for file/media/system integration. Keep
browser behavior working as the reference implementation. Add an adapter
operation only when a delivered desktop feature requires it, rather than
inventing a generic platform SDK or empty method inventory now. A desktop file
path is not automatically a server-local path or permission to bypass intake.

## One settings system, explicit scope

Both browser and desktop use the same settings definitions, controls, defaults
and application behavior. Do not build a separate desktop configuration tree.
The target includes using the same portable UI/application choices in either
host, but shared code alone does not synchronize independently stored values.

| Setting scope | Meaning and minimal treatment |
| --- | --- |
| Instance | The server's configured repository, available processing/search profiles and other existing operator configuration; both clients read/change the same server through existing authorized operations |
| Portable client preference | Appearance, application layout and normal app options have one definition and the same settings UI; a later explicit shared/importable profile is preferable to an implicit new synchronization engine |
| Device/session | Window state, output device, local paths, OS shortcuts, credentials and temporary queue remain scoped to the host/session; exclude secrets and machine-local values from portable preference files |

Current appearance preferences live in browser localStorage. A desktop WebView
normally has a different storage area. No cross-host value synchronization,
profile export/import or persistent playback session is delivered by this
design. If selected in F16, define a minimal explicit preference handoff inside
that feature; do not silently add a settings service, durable schema or live
sync system. Reusing settings means matching meaning and controls first, with
value portability reported separately.

## Extension boundary

The useful long-term capability is replaceable experiences. Runtime execution
of arbitrary third-party plugins is one possible mechanism, not a prerequisite.

1. **Now:** trusted compiled first-party Music/Photos and complete shells use
   existing registries in the shared Web client. Improve their desktop-layout
   standard flows before extracting packages.
2. **After both applications:** document the smallest contribution contract
   actually used by both: namespaced identity and host compatibility, route or
   slot ownership, required host capabilities, local settings, activation and
   cleanup, and unavailable/fallback behavior. Reject duplicate registrations;
   retain the host's usable default layout. Do not create a generic service
   graph, new public SDK or marketplace to exercise these examples.
   One application contribution serves browser and desktop. Environment-specific
   enhancements declare their concrete host requirement and preserve the base
   workflow when unavailable; do not maintain browser/desktop copies of it.
3. **Separate future decision:** independently installable executable UI and
   third-party runtime extensions need a concrete distribution and isolation
   design. Running code in a frontend or compiling it does not make it isolated
   or harmless. Current ADR-032 packs are data-only tokens/assets; arbitrary
   components cannot be passed off as an admitted presentation pack.

The client host owns the playback session and transport. Replaceable player
controls consume it. A future alternative playback engine must bind to that
same session contract instead of each extension starting a competing player.
Presentation changes never gain direct repository, catalog, signing or
verification authority. A module can request existing authorized host actions.

Default Music and Photos are complete installed experiences, not empty plugin
slots. Advanced customization stays out of the ordinary onboarding flow.

## Client experience versus service capabilities

| User-visible result | Placement and current decision |
| --- | --- |
| Clear artist/album browsing, queue actions, sleep timer, focused playback page | Mostly existing client code; integrate and refine discoverability |
| Photos filtering, continuous viewing, exhibition and selection | Existing client code; connect saved selections and preserve return context |
| Lyrics, visualizers, shortcuts or sound processing | Potential client extensions; source/format/engine requirements must be defined before being selected |
| Fast start and seeking for larger media | Requires an explicit authorized content-read/playback design; changing UI or lifting a number is insufficient |
| Transcoding or unsupported formats | Requires actual decoding/representation capability; not a frontend plugin claim |
| Cross-device playback progress, cached offline use | Requires defined persistence/cache and access behavior; not provided by current temporary state |
| Native file picker, system shortcuts, tray or richer media integration | Possible later desktop-host additions; a wrapper does not automatically provide them, and not every item is selected |
| OCR, embeddings and retained extraction | Shared server capability profiles; replacing UI does not duplicate these pipelines |

Current music downloads and checks complete originals before playback, with a
32 MiB/item ceiling and 1,000 queue occurrences. These are present delivery
bounds, not the desired permanent ceiling for Cairn. Within F15, retain a
separate proposed larger-media successor with concrete start/seek/cancel and
original-takeout behavior. Define how authorized reads and playback verification
differ from an exact full-file download before changing the contract. No new
range endpoint, transcoder or weaker exact-export assertion is admitted here.

## Functional delivery sequence

Keep the existing feature cards; architectural cleanup and necessary validation
are steps within a useful result. WIP remains one complete feature.

| Position | Existing card | Result and minimum work |
| --- | --- | --- |
| Next | F15 Music / AIL-54, reusing F02/F09/F10 | Deliver the standard listening workflow in the shared Web implementation, computer layout first. Integrate the existing list editor and primary controls while preserving playback/context. |
| Then | F14 Photos / AIL-49, reusing F02/F09/F10 | Deliver the standard photo workflow on the same shared Web/desktop-layout foundation, reusing list and host flows. |
| Then | F16 interface choice / AIL-58 | Two meaningful compiled layouts and a small contribution example over the same host/settings. Extract demonstrated boundaries; decide desktop packaging only for a concrete host benefit. |
| Retained | F11 then F12 | Correct ordinary Skills and reviewable AI organization remain planned; F12's execution/input contract and admission are still unresolved. AI is not required to use saved results. |

F03 retrieval continues to own discovery gaps; a concrete miss blocking the
selected workflow is resolved in the relevant capability without expanding the
batch to every search or platform feature. F17 video and future larger-media
requirements remain visible, not implicitly delivered by client modularity.

### Music delivery checklist

- [ ] Make existing Tracks/Artists/Albums, current playback and queue primary;
  disclose management controls and preserve filename fallback for unknown facts.
- [ ] Pass Music's explicit displayed/selected targets into the existing
  material-list editor through the host. Preserve review, ordering and clear
  selection scope; keep this distinct from exporting a repeated live queue.
- [ ] Make reopening the saved ordinary list and invoking its existing
  play/append/takeout actions discoverable from the Music workflow, using the
  existing library/Details reader rather than inventing a playlist registry.
- [ ] Preserve the same active track, queue and navigation context while using
  Photos, Overview and Library; fix concrete observed continuity gaps.
- [ ] Explain current supported/oversized/unsupported playback outcomes next
  to useful actions; keep the larger-media successor visible within F15.

**Implementation boundary:** existing `MusicLibraryExperience.tsx`, its
`music/musicHelpers.ts` props, host composition in `main.tsx`/`LibraryPageHost`,
and existing material composer/reader. Shared `useAudioPlayback`, `AudioPlayer`
and queue helpers remain owners, changed only where the integrated flow needs
them. Introduce no new catalog, endpoint, media server, loader or playlist store.

**One whole-feature journey after implementation:** browse real metadata by
artist/album, play A and B and queue repeated A, edit the queue, navigate other
applications and return with playback/context retained; save an explicit
selection through the ordinary list editor, reopen it and play/append through
ML-2; observe the supported-format/size fallback. The repeated transient queue
and saved selection are separate inputs unless a queue-save handoff is delivered.

### Photos delivery checklist

- [ ] Connect selected Photos to the same host list editor and saved Reader.
- [ ] Keep filter, focus and selection stable through viewer/exhibition,
  Notes/Favorite, save and original takeout.
- [ ] Refine existing full-page layouts around the actual journey; retain the
  source of date/metadata and explain missing information.

**Photos scope/journey:** `PhotoLibraryExperience.tsx`, existing photo viewer
and exhibition, host list callback and existing Reader/export. On real photos,
filter by known date/tag, view continuously, add context, save the selected set,
reopen/take out and return to the same scope/focus. No extra suites per helper
or button.

### Interface delivery checklist

- [ ] After both applications, demonstrate a complete compiled layout change
  over the same host without losing search, Notes, takeout or current playback.
- [ ] Document a contribution using the demonstrated host seam, distinguishing
  compiled code from the existing data-only package format.

F16 uses the same host actions across two compiled layouts. Its single journey
switches layout while finding, annotating, playing and taking out the same
material; it does not validate or admit a runtime third-party loader.

## Evidence, consultation and limits

Source inspection on 2026-10-22 found the expected server/client split and
existing audio/viewer controls. Music's selection-to-list entry is missing;
`main.tsx` already supplies a list callback to the generic Library host. Photos
has the analogous integration need. These are source findings, not new runtime
acceptance or evidence that all other interaction details work perfectly.

Primary client references: [Feishin](https://github.com/jeffvli/feishin) and its
[release notes](https://github.com/jeffvli/feishin/releases) for a specialist
server-connected player, lyrics, queue and fullscreen composition;
[foobar2000](https://www.foobar2000.org/?page=Overview) for configurable layouts,
keyboard control, ReplayGain and components. Documentation was inspected;
competitors were not installed or trialled. These references support selected
experience questions, not copying their entire features or licensing code.

The initial DSH headless consultation returned `EMPTY_RESPONSE`, exit 1. At the
owner's request, the configured `openainext / claude-opus-5-5` route was retried
with the clarified Web-first/desktop-layout brief. Both the retry and a
follow-up challenge completed with exit 0 and nonempty answers, with no tool
events, in session `session-bb2bbab7-16e8-44bf-a901-ebbe7f9f574e`. This identifies
the configured route, not an independent verification of the provider's model.
Records are in `dist/client-server-form-20261022/retry-01/`: `initial-result.json`,
`followup-result.json` and their response Markdown files. Temporary private
overlays were removed and global Harness settings were unchanged.

| Consultation point | Root decision after checking current code/contracts |
| --- | --- |
| Shared Web implementation, future thin desktop host, computer layout first | Adopt; this matches the owner's clarified intent |
| Four standard journeys and shared ordinary-list save/reopen/consume | Adopt; optional extensions must not be required for the baseline |
| Same settings definitions, existing operator config, local preference values initially | Adopt after the follow-up corrected an unnecessary proposal for a new SQLite key/value table |
| Uncap the queue and add Range streaming immediately | Reject as this batch's work; virtualization alone does not solve resource/read/verification limits. Keep the larger-media successor visible within F15 |
| Client plugins may register extraction or freely discard derived records | Reject; server processing and retained user/model facts retain their current semantics |
| Differences are only layout tokens | Corrected in follow-up: reuse code while allowing full layout/interaction alternatives |

The root agent owns these decisions. Luna's read-only inspection confirmed no
desktop wrapper is currently shipped and localStorage preferences do not
already synchronize between hosts. No application tests, packaging or runtime
feature verification were performed during this documentation update.

Review this detailed product shape before implementation. This document does
not widen ADR-032, remote access, integrated AI or media-streaming admission.
See [ADR-070](../../technical/build-stack-and-architecture-selection.md#adr-070-one-default-client-with-specialist-applications-over-the-shared-server)
and the [current functional plan](../plans/2026-10-21-cairn-focused-delivery.md).
