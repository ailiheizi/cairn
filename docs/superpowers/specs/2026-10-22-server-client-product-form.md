# Cairn server, client and application product form

**Date:** 2026-10-22
**Status:** Proposed detailed design following the owner's direction to plan a
shared server and client-side applications/extensions. Documentation only;
existing admissions and core phase gates are unchanged. The functional order
below updates the current client queue, not the core execution plan.

## User intent and chosen form

The owner wants one place to keep original material and useful descriptions,
find it again, and use it through comfortable specialist experiences. Ordinary
Skills and saved lists remain reusable material. Customization includes whole
layouts and interaction patterns. Mature music clients are relevant references
alongside self-hosted storage products. Delivery must improve a complete user
activity, with few concepts and extensive reuse.

Choose **one Cairn service, one default client, and replaceable applications
inside that client**. The default client includes Library, Music and Photos;
Overview is a composed starting view. Users enter an application directly and
return without losing their place or ongoing playback. Search, Notes and
takeout remain reachable on demand. An application's own navigation can occupy
the whole page; shared state does not require permanent shared toolbars.

Keep one repository and the existing deployment shape initially. Logical
separation does not require new processes, packages or installations. A future
independent client can consume the same content contracts once actual external
access, compatibility and distribution requirements are settled. A local API
is not evidence that remote authentication, transport or supported third-party
client compatibility is already delivered.

| Alternative | Benefit | Cost and decision |
| --- | --- | --- |
| Default client containing specialist applications | Consistent install, selection, Notes, playback and original access; deep domain layouts | Requires disciplined shared ownership; selected |
| Separate Music, Photos and Library products immediately | Maximum UI independence | Repeats connection, settings, discovery and integration work; later only for a concrete device/use need |
| Server only, external clients supply all experience | Smaller first-party UI commitment | Gives up the comfortable default workflow the owner wants; not the product target |

## Responsibility and retained information

| Owner | Responsibilities | Reuse boundary |
| --- | --- | --- |
| Server | Exact original content, authoritative Notes/TAG/facts, capture, lexical/structured/local semantic discovery, authorized takeout and recovery | Existing daemon, one catalog/repository and typed operations; no music/photo catalog fork |
| Client host | Connection and command adapter, navigation and shared result/selection context, drafts, original access, one playback session, device preferences | Existing hooks and host actions; no alternate policy or content identity |
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

## Extension boundary

The useful long-term capability is replaceable experiences. Runtime execution
of arbitrary third-party plugins is one possible mechanism, not a prerequisite.

1. **Now:** trusted compiled first-party Music/Photos and complete shells use
   existing registries. Improve their real flows before extracting packages.
2. **After both applications:** document the smallest contribution contract
   actually used by both: namespaced identity and host compatibility, route or
   slot ownership, required host capabilities, local settings, activation and
   cleanup, and unavailable/fallback behavior. Reject duplicate registrations;
   retain the host's usable default layout. Do not create a generic service
   graph, new public SDK or marketplace to exercise these examples.
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
| Next | F15 Music / AIL-54, reusing F02/F09/F10 | A coherent browse → listen → queue → save selection → reopen/listen workflow in its own page. Integrate the existing list editor, simplify control hierarchy and preserve playback/context. No backend rewrite. |
| Then | F14 Photos / AIL-49, reusing F02/F09/F10 | Find → continuously view/exhibit → annotate → save selection/take out → return to the same place. Reuse the same list and host flows. |
| Then | F16 interface choice / AIL-58 | Two meaningfully different compiled layouts using the shared host, plus a contribution example within current admission. Extract only boundaries proven necessary by Music/Photos. |
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

One actual DSH headless consultation used the configured
`openainext / claude-opus-5-5` route. It returned `EMPTY_RESPONSE`, exit 1, with
no model advice and no tool events. No Opus endorsement is claimed. Local
metadata is `dist/client-server-form-20261022/initial-result.json` and the error
is in `initial-events.jsonl`. The temporary private overlay was removed and
global Harness settings were unchanged. Decisions here are the root agent's,
informed by Luna's source inspection and the owner's direction.

Review this detailed product shape before implementation. This document does
not widen ADR-032, remote access, integrated AI or media-streaming admission.
See [ADR-070](../../technical/build-stack-and-architecture-selection.md#adr-070-one-default-client-with-specialist-applications-over-the-shared-server)
and the [current functional plan](../plans/2026-10-21-cairn-focused-delivery.md).
