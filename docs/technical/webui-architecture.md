# WebUI Architecture

> **Status:** Informative. This document describes how the browser client is
> organized. It adds no product scope, no daemon operation, and no durable
> state: the client remains the bounded local `/api/v1` adapter described in
> `docs/requirements/mvp-and-operator-contract.md` and
> `docs/technical/core-mvp-execution-plan.md`. Where this document and a
> normative requirement disagree, the requirement wins.

The browser client (`web/`) is a projection of the daemon catalog. It renders
what the typed dispatcher returns, keeps browser-local conveniences (layout,
sort, recent searches, recents destinations) in `localStorage`, and never owns
membership, protection, recovery evidence, or a saved view.

## 1. Module map

This is a responsibility map, not an exhaustive file inventory. Follow the
owning flow before adding a new component or another copy of its state.

| Responsibility | Current code entry |
| --- | --- |
| Shell and flow composition | `web/src/main.tsx` |
| Command transport and operation names | `app/command.ts`, `lib/operations.ts` |
| Content projection and shared browse scope | `app/useLibrary.ts`, `app/useLibraryViews.ts`, `app/ClientBrowseSession.tsx` |
| Query and submitted-result state | `app/useSearch.ts`; `lib/searchops.ts`, `lib/resultScope.ts` |
| Selection, detail drafts, Notes and Tags | `app/useSelection.ts`, `app/useDetails.ts`, `app/useLibraryDrafts.ts` |
| Saved query records, editing and paged recall | `app/useSavedViews.ts`; `lib/savedRetrievalCandidate.ts`, `lib/savedRetrievalEdit.ts`, `lib/savedRetrievalConditions.ts`, `lib/savedViewPages.ts` |
| Frozen takeout, write/verify state and history | `app/useExport.ts`; `components/ExportDrawer.tsx` |
| Browser original takeout and restore | `app/useOriginalTakeout.ts`, `app/useRestore.ts` |
| Intake and configured sources | `app/useSources.ts`; `components/SourceDrawer.tsx` |
| Ordinary list snapshots and Skill context | `components/material/MaterialListComposer.tsx`, `MaterialListReader.tsx`; `lib/materialList.ts`, `lib/materialListIO.ts`; shell-owned draft session and existing intake |
| Shared player and recorded music metadata | `app/useAudioPlayback.ts`, `app/useMusicMetadata.ts`; `lib/playbackQueue.ts` |
| Registered presentation and appearance | `lib/interfaceCatalog.ts`, `lib/presentationPackages.ts`, `app/useAppearance.ts` |
| Rendering and surface interaction | `components/`; domain pages consume host-owned scope and actions |
| Data shapes and reusable helpers | `lib/`; byte-access helpers use the existing host contracts, never a second content authority |
| Localized strings | `i18n.ts` aggregates `i18n/` surface catalogs |
| Styles and cascade | `styles/index.css` is the ordered import entry; surface styles remain with their owners |
| Browser journey helpers | `scripts/e2e/harness.mjs`, `scripts/e2e/support.mjs`, `scripts/e2e/<surface>.mjs` |

`SavedView` and `ExportManifest` are separate responsibilities: the first saves
conditions evaluated against current content; the second freezes one takeout.
They share a drawer and some navigation, so `useExport` exposes a compatibility
facade to existing consumers. `main.tsx` creates both hooks and supplies the
saved-view flow to the export coordinator. No second copy of the saved-view
state lives in the export hook.

This split is browser organization only. It introduces no command, persistent
record, list format, or backend state machine.

### Feature-local media components

Photos keeps browse state, result-windowing, selection anchors, viewer focus,
keyboard/swipe handling and slideshow effects in `PhotoLibraryExperience`.
`components/photo/PhotoCard.tsx` and `PhotoViewer.tsx` render the existing card
and dialog using those controlled values and callbacks. They do not acquire
an independent content scope or read budget. Their shared types live in
`components/photo/photoTypes.ts`, so children do not import the parent flow.

Music keeps browse state and host-player coordination in
`MusicLibraryExperience`. `components/music/MusicRows.tsx` renders recorded
track/group actions; `musicHelpers.ts` holds its local types and calculations.
The shared player and metadata flows remain the owners of playback and facts.

Both domains use `lib/subjectHits.ts` to retain the first hit per nonblank,
trimmed stable subject reference. This deduplicates action targets, not content
bytes or distinct subjects that happen to contain identical bytes.
`useSelection` prepares single-tag and queued-tag mutations through one private
helper; each operation retains its own writes, progress and reconciliation.

`lib/protectionAxis.ts` owns the existing protection-outcome order and pure
response interpretation shared by Tags, duplicate review and selection
reports. Each consumer retains its own request scope, pending/stale guards and
error presentation. `lib/workspace.ts` shares only the Tags/Duplicates status
fallback order; it does not select a workspace or hold another copy of it.

The purpose is to make ownership visible without a general component framework
or a second copy of state. Feature-local rendering can change independently
while host scope, read limits and mutation guards remain in their existing flows.

The ML-1 list editor owns only a transient ordered draft and copied user Notes
and Skill text. Its generated Files pass back to the existing Add flow for
review and capture. The Details reader validates a bounded ordinary file and
resolves exact identities against the loaded library. It owns no list head,
membership store, AI runtime or independent takeout policy. See the
[client contract](material-list-client-contract.md).


The shell owns only: the locale and translator, the one notice, the busy flag,
the query text and last submitted query, the service projection
(`status`/`statusData`/`capabilities`/`snapshotRef`/`workspaceID`), the open
surface flags (including the compact workspace panel), the drawer focus trap,
the document-level search shortcut, and the ordered composition of each flow's
reset. Everything else belongs to a flow.

Below the one compact boundary (`max-width: 640px`, asked through
`app/useCompactLayout.ts` and by the stylesheet itself), the shell mounts the
same `WorkspaceRail` element and the same `StatusPanel` inside
`WorkspaceRailPanel` instead of inline, and the topbar renders the one button
that opens it. Selecting a view in the panel closes it and runs the same
handler the desktop rail runs, and all three drawers' behaviours (focus into
the panel, Tab trap, Escape, backdrop dismissal, `drawer-open`, focus return)
come from the shell's existing drawer effect rather than a second copy.

The shell composes existing flows. Refactoring that wiring should preserve
visible behavior and each flow's ownership of pending work and stale responses.

## 2. Ownership rules

1. **One surface per component file.** A surface owns its markup, its local
   state (or the flow that holds it), and its styling. Current examples include
   `StatusPanel`, `TagsSurface`, `DuplicatesSurface`, `NotesSurface`, the
   library and source surfaces, drawers, viewer, and settings. Follow the
   current shell composition rather than treating this list as exhaustive.
   `StatusPanel` directly issues its narrow read-only operations
   (`snapshot.list`, `export.list`, `doctor.check`). Other focused surfaces also
   issue scoped reads through `app/command.ts`: Tags reads annotations, content,
   and protection facts; Duplicates reads the content listing and member facts.
   The viewer owns bounded content-byte reads. These surfaces do not own a
   second query policy or read another surface's state.
2. **Cross-surface state lives in an `app/` flow with a typed interface.**
   Components never reach into another component's state. When two surfaces
   share a fact (the selected subject, the current hits, the export selection),
   the shell passes the owning flow down as a prop.
3. **Every daemon call goes through `app/command.ts`.** Operation names come
   from `lib/operations.ts`; a surface never builds an operation string inline.
4. **Styles follow surface or shared presentation ownership.** The ordered CSS
   import entry is `web/src/styles/index.css`; its current imports cover the
   shared shell, library, drawers, status, verification, activity, duplicate
   and tag surfaces, search/report, appearance, library views, and interface
   frame. Treat that file as the source of truth for import order and coverage;
   this document does not maintain a second fixed import list. Some components
   also keep a colocated stylesheet. Preserve the established cascade when a
   style file is added or its owner changes.
5. **A surface change stays inside that surface.** Changing the export drawer
   touches `components/ExportDrawer.tsx`, `styles/drawer.css`, `app/useExport.ts`
   (if its data flow changes), `i18n/drawers.ts` (if its strings change), and
   `scripts/e2e/drawers.mjs` (if its assertions change). The shell is not part
   of that set.
6. **i18n is per surface.** Every user-visible string lives in the catalog
   partial of the surface that renders it (`web/src/i18n/<surface>.ts`), never
   in `i18n.ts` and never in a component. `i18n.ts` merges the partials and
   keeps the public `t`/`Translator`/`Locale` contract; the merge order has no
   behavioral meaning because a key must appear in exactly one partial.
   `scripts/web-i18n-check.mjs` fails on a duplicate key, on a non-string
   value, and — with `--baseline` — on any key lost or translation changed
   relative to a pre-split catalog. A key shared by several surfaces belongs to
   the surface that owns the action, or to `i18n/common.ts` when it is genuinely
   chrome (a generic Save/Cancel/Close, the topbar's own labels).
7. **E2E assertions are per surface.** `scripts/web-e2e.mjs` owns only the
   phase dispatch and the order of the phases; the Playwright plumbing lives in
   `scripts/e2e/harness.mjs` and the shared helpers in `scripts/e2e/support.mjs`.
   Each surface's assertions live in `scripts/e2e/<surface>.mjs`, are imported
   by `web-e2e.mjs`, and run in the same order as before the split. A surface
   agent edits its own module; adding an assertion never means editing another
   surface's module, and the entry point changes only when a new phase or a new
   surface module is introduced. Assertions are the executable contract: they
   may be extended and must never be weakened, and a surface that cannot be
   distinguished from a fabricated one must add the assertion that does.

### Cross-flow calls

A flow never reaches into another flow's state; it receives the collaborator it
needs as an argument, and the shell performs the wiring in one place:

- `useSearch` invalidates a frozen export through `exportFlow.invalidateForSearch()`
  (the export flow owns the drawer state; the search flow owns the query).
- `useSavedViews` owns saved-query reads, writes and paged recall through its
  narrow library/selection collaborators. It reports recall outcomes rather
  than setting export state. `useExport` coordinates drawer feedback and closes
  the drawer after a successful recall, including an explicit refresh.
- Ordinary search invalidates both recall provenance and a replaceable export
  projection; an unresolved export write stays pinned. Reset ordering remains
  explicit in the coordinator.
- `useSources`, `useRestore`, and `useExport` close the other drawers through a
  shell-provided `closeDrawers`/`closeOtherDrawers` callback, because "only one
  drawer is open" is a shell-level invariant.
- Resets are composed in the shell (`clearCatalogBackedState`,
  `clearRepositoryDependentState`), because a refresh must clear every catalog
  projection together.

## 3. How to add a new surface

1. Decide the surface's one job. If it cannot be described in one sentence, it
   is two surfaces.
2. Add `components/<Surface>.tsx` that renders the surface from props. It must
   not call `command()` directly unless it reads content bytes (the viewer is
   the only such surface today, and it calls `app/command.ts`).
3. If the surface needs state that no existing flow owns, add
   `app/use<Surface>.ts` with an exported `FooFlow` type, a single hook, and the
   operations it performs. It receives other flows and shell values as
   arguments; it never imports another hook.
4. Add the surface's rules to the CSS file that owns it. If it is a genuinely
   new surface with no existing owner, add `styles/<surface>.css` and append it
   to the `@import` list in `styles/index.css` **after** the files it must
   override. Never reorder the existing imports: that changes the cascade.
5. Wire the surface in `main.tsx`. Keep the wiring to: creating the flow, and
   passing values and callbacks. If the wiring needs a condition, the condition
   belongs in the flow or the surface, not in an inline expression.
6. Add every new user-visible string to the surface's catalog partial under
   `web/src/i18n/` (both locales). Adding a key to `i18n.ts` is not allowed.
7. If the surface changes a durable fact, that change is a command, not client
   state. Update `lib/operations.ts` and the surface's flow, and keep the
   daemon's answer authoritative: the UI shows what the daemon reports.
8. Add the surface's assertions to `scripts/e2e/<surface>.mjs` and import the
   module from `scripts/web-e2e.mjs` at the point in the phase where the
   surface's data exists. Do not add assertions to another surface's module.
9. Run `npm --prefix web run build`, `scripts/web-e2e.sh`, and
   `scripts/web-plan-e2e.mjs`. If the surface renders in a new state, add it to
   the capture list used for the computed-style comparison.

### The files a feature agent owns

A feature agent owns exactly the files of its surface. Nothing else may be
edited to land the surface, and a seam that needs a shell edit is created
before the surface work starts.

**Trusted status surface (Tier-1 §3).** Owned files:
`components/StatusPanel.tsx`, `styles/status.css`, `i18n/status.ts`,
`scripts/e2e/status.mjs`. The initial seam created the component, its CSS file
import, the shell wiring, and removed the readiness dots and the old
`system-rail` strip from `WorkspaceRail.tsx`/`TopBar.tsx`/`topbar.css`/
`library.css`; later changes to what the surface reports touch only the four
owned files.

**Verification report drawer (Tier-1 §1).** Owned files:
`components/VerificationDrawer.tsx`, `styles/verification.css`,
`i18n/verification.ts`, `scripts/e2e/verification.mjs`. The seam already
created the typed stub, the stylesheet import, the `snapshot.verify` and
`doctor.check` operation names in `lib/operations.ts`, the snapshot/verification
shapes in `lib/types.ts`, the trigger in `StatusPanel.tsx`, and the drawer mount
plus open state, Escape handling, and focus trap in the shell. The drawer body,
its strings, its styles, and its assertions are the agent's work.

**Activity surface (Tier-1 §2).** Owned files:
`components/ActivitySurface.tsx`, `styles/activity.css`, `i18n/activity.ts`,
`scripts/e2e/activity.mjs`, plus the surface's own view wiring
(`lib/types.ts` `ViewMode`, `lib/operations.ts` `job.*`, the rail entry in
`components/WorkspaceRail.tsx`, and the `main.tsx` branch that renders the view
instead of the library). The status panel already exposes an optional
`onOpenActivity` prop, so "Open activity" is wired by passing that callback.

## 4. What the client deliberately does not do

- It does not store a second copy of any durable record. Saved views, frozen
  manifests, notes, and tags are read back from the daemon on demand.
- It does not infer capability. `READY`/`NOT_BUILT`/`UNAVAILABLE` come from the
  daemon's own projections and are shown as reported.
- It does not treat a frozen manifest as re-materializable: a history manifest
  may be verified again, never written again.
- It does not create a surface per dialogs/strings change: `i18n.ts` remains the
  single translation entry point for every component, and the per-surface
  partials under `i18n/` are its storage, not a second surface.
- It does not render health as a dot, a check, or a colour. `StatusPanel` states
  every fact as one of `PROVEN · {value} · {as-of}`, `UNKNOWN — {reason}`,
  `DEGRADED — {reason}`, `FAILED — {reason}`; a fact with no source in this
  build reads UNKNOWN with the missing capability named, never a zero or a
  healthy default.
- It does not let a discovery fact or a scope statement headline the status
  surface. The summary names the weakest *protection and recovery* fact only
  (service, repository, writability, catalog, schema, verification, protection
  mix); the lexical/semantic index and doctor rows live in the `Discovery`
  group, and the facts whose only source is an operation this build does not
  have live in `Not sourced by this build`, whose collapsed line states their
  count under an UNKNOWN token. No fact is dropped by the grouping: every row
  still renders one of the four state strings when its group is expanded.
- It does not run an expensive daemon operation implicitly. `doctor.check`
  reads repository bytes and runs only on the operator's explicit request; the
  status panel reports its receipt (or that it has not run) either way.
