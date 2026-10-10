# First-Party Client Experience Contribution Guide

This guide describes the compiled page and shell seams currently used by the
local browser client. It is informative implementation guidance for the
admitted `RW-PERSONAL-UX-1` / UX-E2/M2 client track alongside Phases 4 and 5.
It does not add a backend endpoint, provider, processor, durable domain record,
public ABI, release gate, or phase credit.

The governing contract remains
[First-Party Personal Client Experiences](../requirements/first-party-client-experiences.md).
The contribution triple is: **phase:** UX-E2/M2; **requirement:** compiled
pages and whole-interface shells share host-owned authority; **exit:** a
registered page can switch from the photo wall and back while retaining the
same host selection, subject focus, Details/Notes draft, and active player,
with route/collision rejection and visible renderer fallback. A guide or build
does not establish that browser exit evidence.

## Keep shared authority in the App

`main.tsx` owns search, selection, the inspected subject, Details and Notes
drafts, typed operations, and audio playback. A page renders those existing
subjects and receives host callbacks. It may keep transient state for its own
controls, such as a focused gallery index or a filter input, but it must not
create another authority for search, selection, subject resolution, Details,
Notes, or the player. Keep the player visible and reachable across page and
shell changes; `AudioPlayer` is App-owned outside the interface boundary.

Keep the three subject concepts distinct:

- `selectedRef` identifies the subject whose Details are open.
- Batch selection is the host's `selectionRefs` and index-based
  `onToggleSelection` callback.
- `focusedSubjectRef` is browsing focus, owned by App and updated through
  `onFocusSubject`.

Do not use Details selection as a substitute for gallery focus or clear batch
selection when only changing a presentation. Same-context navigation is
preserved only when both registered pages have the same `context` and
`mediaClass`; a move from Music to Photos is an ordinary context change and
keeps the existing Notes-draft guard.

## Add a compiled library page

1. Add one namespaced record to `libraryPages` in
   [`libraryViews.ts`](../../web/src/lib/libraryViews.ts). Give it a stable ID,
   a namespaced `page:` mode, a short stable route, a unique namespaced slot, a
   user-facing label, and the existing content context it consumes. Use
   `mediaClass` only when the page is a projection over the existing image or
   audio suffix facet; use `all` when it consumes the whole loaded listing.
   `chrome` may be `immersive` when the page needs that shell composition.

The existing Exhibition record is a real example of the current shape:

   ```ts
   {
     id: "restoreweave:exhibition",
     mode: "page:restoreweave:exhibition",
     route: "exhibition",
     slot: "page.restoreweave.exhibition",
     label: "Exhibition",
     context: "loaded-library",
     chrome: "immersive",
     mediaClass: "image",
   }
   ```

2. Bind the ID to a renderer in the `rendererEntries` table in
   [`LibraryPageHost.tsx`](../../web/src/components/LibraryPageHost.tsx). The
   host checks that every page has exactly one compiled renderer and that no
   renderer is unregistered. Do not add a page-specific route branch to
   `main.tsx`; add behavior to the renderer and, only when needed, a reusable
   host capability. `LibraryPageHostProps` is the current seam: it carries the
   loaded `resultProps`, existing `onOpenHit`, host focus callbacks, page
   visibility, and optional music/player data. Keep new page callbacks narrow.

3. Use the loaded row mapping as the authority. Any rendered row index passed
   to `onToggleSelection` or `onRowClick` must still refer to the corresponding
   item in `resultProps.hits`. Open the shared inspector through `onOpenHit`;
   let Details provide Notes, tags, original takeout, and other host actions.
   Do not invent capture dates, albums, artwork, or other absent facts.

4. Keep byte reads behind a host-provided renderer or operation. The existing
   Exhibition receives `renderThumbnail(hit)`, which is implemented by the
   host and does not receive a new read authority. The legacy thumbnail path
   remains bounded to 1 MiB. The separately admitted UX-P2 path may render
   visible PNG/JPEG originals above that threshold, up to 8 MiB, after exact
   verification and bounded dimension/decode checks; see the normative
   [client contract](../requirements/first-party-client-experiences.md#9-ux-p2-useful-ordinary-photo-thumbnails).
   The Exhibition may navigate the full loaded image list but mounts only its
   nearby preview window. Unsupported or oversized items remain identifiable
   and retain the shared Details/original path. Cancellation releases handles
   and stale callbacks must not render.

5. Put transient focus in App when it must survive a renderer switch. Page-local
   hover, scroll, and animation state may reset. Do not put subject references
   or internal IDs into URL hashes. `hashView.ts` maps the existing `photos`
   and `music` routes and registered short page routes to page modes; an
   unknown route resolves to the default content view. A disabled or
   unavailable registered page uses the host's `onFallback` callback to return
   to the shared library; renderer failures show a generic-results recovery
   message.

Page IDs, routes, slots, modes, and renderer bindings are validated before the
client exposes them. Host-reserved destinations and slots are rejected, as
are duplicate contributions; never resolve conflicts by declaration order.
Page visibility is a browser-local preference derived from the catalog.
Disabling a page only hides that presentation: it does not delete content,
tags, Notes, or any other retained facts.

Namespace page styles under a page root such as `.photo-exhibition__*`. Keep
visual transforms on the artwork plane only; do not transform a wrapper that
also contains Details, selection, or navigation controls, because its visual
position can diverge from its pointer hit area. Verify pointer activation as
well as keyboard focus, narrow layouts around 400 px, reduced-motion behavior,
and useful fallbacks for empty, unavailable, and failed previews. For example,
the Exhibition moves focus with arrow keys, limits mounted preview work, and
returns to the ordinary Photos wall when enabled, or to All types when that
presentation is disabled. Return actions must honor the same preferences as
the domain navigation.

Translations belong to a surface partial under `web/src/i18n/`, imported by
`web/src/i18n.ts`. Keep labels and unavailable states in that catalog rather
than introducing a page-specific translator.

## Add a whole-interface shell

Pages select content; shells arrange the whole client. A new shell belongs in
[`interfaceCatalog.ts`](../../web/src/lib/interfaceCatalog.ts) as an
`InterfaceDefinition` with a stable ID, unique `renderSlot`, label,
description, and preview kind. Implement that slot in the `shellRenderers` map
inside [`InterfaceFrame.tsx`](../../web/src/components/InterfaceFrame.tsx).
The map and catalog are checked against each other at startup, and
`validateInterfaces` rejects duplicate IDs or renderer slots and requires the
`workspace` fallback.

The frame receives the host's existing `header`, `navigation`, `content`, and
`details` nodes plus layout state. Compose those nodes; do not recreate their
operations or own parallel route/selection state. An immersive page can request
`chrome: "immersive"`; the host `InterfaceFrame` selects the immersive
composition while retaining shared search, navigation, inspector, Notes,
original actions, and player access.

`AppearancePreferences` reads `interfaceCatalog` automatically, so a new
entry appears in the browser-local interface chooser. Its current `preview`
type and card markup cover the Workspace and Showcase examples. A distinct
shell preview needs an explicit preview kind and presentation there; do not
mislabel it as an existing preview to get a chooser entry. Unknown stored IDs
normalize to Workspace in `appearance.ts`. If a selected non-Workspace shell
throws, `InterfaceRenderBoundary` switches to Workspace and reports the
fallback. That boundary is presentation recovery, not JavaScript confinement.

Keep color palettes as the secondary appearance layer. A shell can make a
substantially different composition through layout, typography, density,
spacing, and imagery while consuming shared semantic color tokens; a palette
change alone is not a new whole-interface experience.

## Group domain presentations and compose shared scopes

The admitted UX-C2 Overview is the first fixed compiled layout. Its registry
record declares `navigationKind: "layout"` and `mediaClass: "all"`, so navigation
does not list it as a media type. Such a layout is a root; domain presentations
cannot reference it. Existing entries omit `navigationKind` and retain their
domain meaning. `OverviewExperience` receives original scoped rows, indices,
enabled-domain destinations and narrow host callbacks. It does not load facts,
run queries or own a player. Future blocks must prove the same boundary before
expanding this one-template implementation into a reusable SDK.

Follow the admitted UX-C1 contract and the informative
[domain-presentation composition proposal](domain-presentations-and-composition-20261009.md).
Keep each domain as one grouped navigation destination: its wall and
Exhibition are alternative presentations of Photos, while Music retains its
own track/fact presentation. A presentation record names a root page and must
have the same loaded context and media class. Reject missing roots, chains,
cycles and incompatible context before exposing registrations. Keep existing
IDs, routes and browser-local disabled-page IDs meaningful; a page renderer is
not itself another domain authority.

Search, tags/facets and the returned hit list form one host-owned result scope.
Switching a presentation over that scope changes rendering only: do not issue
another query or discard active conditions. Preserve returned relevance order,
label domain counts as returned-result projections, and keep a clear
all-types route and honest no-media-in-results message. Join any supplementary
loaded-row size only by the exact current workspace/namespace, subject, entry
and canonical content identity tuple; ambiguity or mismatch stays unknown.
Retain query/tag hash semantics on existing deep links while adding a
registered presentation route where supported. Do not put subject IDs into
URLs.

The next aggregation seam is a set of fixed host templates whose reusable
blocks receive read-only selectors for an existing scope slice, narrow host
actions and the host's single shared resource budgets. A template does not
create its own query, selection, player, byte-read authority or independent
budget. Keep these blocks distinct from independent task pages and from a
whole-interface shell. This is not a canvas, public SDK, runtime installer or
security boundary. See [ADR-028](build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition).

Before or during a catalog migration, preserve stable page IDs and old route
aliases; migrate only the preference representation whose meaning is
explicitly reviewed. Do not silently enable a disabled presentation, drop an
unknown stored value, or strip existing query/tag hashes. Show a visible
fallback when a route points to a disabled presentation, and keep the same
result scope and conditions. The feature remains partial until the declared
browser routes, migration, stale/mismatched tuple, scope retention and recovery
checks pass against the integrated client.

## Trust boundary and contributor checks

Page and shell implementations are compiled first-party application code in
the same browser process. Static registration, React boundaries, CSS
namespacing, and code splitting do not sandbox that code. There is no runtime
package installer, public extension SDK, or security-isolated third-party
loader. Do not grant a page file, database, secret, network, shell, or direct
repository authority. A future package lifecycle, capabilities model, trust
store, compatibility policy, or isolation mechanism would need a separate
review and admission; this guide makes no promise that such a runtime exists.

For a page or shell contribution, run the relevant existing checks from the
repository root and the web build:

```sh
node scripts/web-page-registry-check.mjs
node scripts/web-client-preferences-check.mjs
node scripts/web-music-metadata-check.mjs       # when changing music facts
node scripts/web-playback-queue-check.mjs       # when changing the player queue
node scripts/web-interface-experiences-e2e.mjs  # shell and shared-state browser coverage
```

Then run `npm run build` from `web/`. The interface E2E script uses the local
QA fixture and Chrome and covers its existing shell-switching and shared-state
scenarios; it is not proof of a new page's image rendering or pointer hit
targets. Add or perform an appropriate local browser pass with retained images
for those claims. Synthetic registry checks and this document do not establish
a browser `PASS`, complete Photos or Music usability, a closed core phase, or
release qualification.
