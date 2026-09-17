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

```
web/src/
  main.tsx                     the application shell (root wiring only)
  identity.ts                  SHA-256 identity rendering helpers (unchanged)
  i18n.ts                      merges the per-surface catalogs; keeps t()/Locale/Translator
  i18n/                        one catalog partial per surface, owned by that surface
    common.ts                  shared chrome vocabulary
    status.ts                  the trusted status surface
    library.ts                 library, result list, inspector, selection
    sources.ts                 sources surface and the add/recheck source drawer
    drawers.ts                 drawer shell, plan cards, restore and export drawers
    settings.ts                settings dialog
    viewer.ts                  content viewer
    activity.ts                activity surface (empty until that surface lands)
    verification.ts            verification report drawer (empty until it lands)
  app/                         hooks, one concern per file
    command.ts                 the command envelope + its Result type
    useSearch.ts               the one query surface (field, recents, submit)
    useLibrary.ts              the content-library projection and its filters
    useDetails.ts              the inspected subject's reads and note/tag writes
    useSelection.ts            the batch selection over the rendered listing
    useSources.ts              configured sources + the reviewable ingest plan
    useLibraryDrafts.ts        unsaved note/tag drafts and their guard
    useExport.ts               ExportManifest freezing, materializing, verifying
    useRestore.ts              restore planning, applying, and its review card
    useSettings.ts             the persisted configuration dialog
    useRecents.ts              browser-local recent searches/destinations
    useViewMode.ts             view mode, layout, and sort preferences
    useCompactLayout.ts        the one `max-width: 640px` boundary the shell and CSS share
  components/                  one surface per file
    TopBar.tsx                 header, search field, actions
    StatusPanel.tsx            the trusted status surface (rail disclosure + fact rows)
    WorkspaceRail.tsx          the workspace navigation rail and its phone panel host
    LibrarySurface.tsx         library column: heading, controls, notices, views
    ResultList.tsx             the tile grid / dense list and its rows
    SourcesSurface.tsx         the configured-sources view and its cards
    DetailsPanel.tsx           the inspector column (one subject)
    SelectionBar.tsx           the one batch surface
    DrawerActionBar.tsx        the drawer's sticky single next step
    PlanCard.tsx               the ingest plan's review evidence
    SourceDrawer.tsx           the add/recheck source drawer
    RestoreDrawer.tsx          the restore drawer and its review card
    ExportDrawer.tsx           the export drawer
    VerificationDrawer.tsx     the verification report drawer (body owned by that surface)
    SettingsDialog.tsx         the settings dialog and config controls
    ContentPreview.tsx         the one content viewer (keeps its own CSS)
  lib/                         pure helpers, no React, no daemon call
    types.ts                   browser-side domain shapes
    operations.ts              typed daemon operation names + endpoints
    format.ts                  formatting, listing, and label helpers
  styles/
    index.css                  aggregates the files below (the only CSS import)
    tokens.css                 palettes: dark, maintenance neutral, light theme
    base.css                   element defaults, keyframes, shared utilities
    topbar.css                 top bar
    library.css                rail, library column, tiles, inspector, sources
    drawer.css                 drawer shell, action bar, plan cards, drawers
    settings.css               settings dialog and configuration controls
    viewer.css                 viewer/thumbnail integration rules
    status.css                 the trusted status surface
    verification.css           verification report drawer (empty until it lands)
    activity.css               activity surface (empty until it lands)

scripts/
  web-e2e.mjs                  phase dispatch + the order of the assertion phases
  web-e2e.sh                   the harness that owns the temporary daemon/config
  web-plan-e2e.mjs             plan review/apply unknown-response reconciliation
  web-i18n-check.mjs           proves the catalog split lost and duplicated nothing
  e2e/
    harness.mjs                Playwright plumbing + captured daemon traffic
    support.mjs                shared assertion helpers (sticky bar, overflow, focus)
    session.mjs                the offline and recovered phase checkpoints
    status.mjs                 the trusted status surface
    library.mjs                library, inspector, viewer, sort/selection
    sources.mjs                sources surface and the add/recheck drawer
    drawers.mjs                restore and export drawers
    search.mjs                 the one search surface and its local recents
    settings.mjs               settings dialog and responsive boundaries
    activity.mjs               activity surface (empty until that surface lands)
    verification.mjs           verification report drawer (empty until it lands)
```

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

Markup was moved verbatim. The shell's original JSX was written with one dense
line per surface element, and that formatting was preserved so the split is
provably text-identical rather than a rewritten rendering path.

## 2. Ownership rules

1. **One surface per component file.** A surface owns its markup, its local
   state (or the flow that holds it), and the CSS file that styles it. Surfaces
   are `TopBar`, `StatusPanel`, `WorkspaceRail`, `LibrarySurface`, `ResultList`,
   `SourcesSurface`, `DetailsPanel`, `SelectionBar`, `DrawerActionBar`,
   `PlanCard`, `SourceDrawer`, `RestoreDrawer`, `ExportDrawer`,
   `VerificationDrawer`, and `SettingsDialog`. `StatusPanel` is the one surface
   besides the viewer that dispatches its own read-only operations
   (`snapshot.list`, `export.list`, `doctor.check`): its facts are its own job,
   it writes nothing, and it never reads another surface's state.
2. **Cross-surface state lives in an `app/` flow with a typed interface.**
   Components never reach into another component's state. When two surfaces
   share a fact (the selected subject, the current hits, the export selection),
   the shell passes the owning flow down as a prop.
3. **Every daemon call goes through `app/command.ts`.** Operation names come
   from `lib/operations.ts`; a surface never builds an operation string inline.
4. **One CSS file per surface area, plus `tokens`/`base`.** Rule order and
   cascade are preserved by `styles/index.css`, which imports the files in a
   fixed order: `tokens -> base -> topbar -> library -> drawer -> settings ->
   viewer -> status -> verification -> activity`. The owner of each file is:
   - `topbar.css` -> `TopBar`;
   - `library.css` -> `WorkspaceRail`, `LibrarySurface`, `ResultList`,
     `SourcesSurface`, `SelectionBar`, `DetailsPanel`;
   - `drawer.css` -> `DrawerActionBar`, `PlanCard`, `SourceDrawer`,
     `RestoreDrawer`, `ExportDrawer`;
   - `settings.css` -> `SettingsDialog`;
   - `viewer.css` -> the viewer/thumbnail integration for `ContentPreview`,
     which keeps its own component stylesheet;
   - `status.css` -> `StatusPanel`;
   - `verification.css` -> `VerificationDrawer`;
   - `activity.css` -> the activity surface.
   The library column and the inspector share one file because the original
   stylesheet interleaves their rules inside the same light-theme and
   responsive override blocks; extracting them would have reordered the
   cascade. The export drawer, like every other drawer, is entirely in
   `drawer.css`. A new surface's stylesheet is appended to the `@import` list
   (and its file created, with a header comment, by the seam that adds the
   surface), so the surface never edits `index.css`.
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
- `useExport` applies a recalled saved view through the library, selection, and
  view-mode flows it is given.
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
