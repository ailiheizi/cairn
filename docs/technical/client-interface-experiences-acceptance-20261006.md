# Bundled Client Interface Experiences Acceptance

Date: 2026-10-06 (Asia/Shanghai). Status: implemented and locally tested browser
maintenance. This record covers two bundled interface layouts, not a public UI
ABI, runtime theme loader, media application, or core phase closure.

## Scope and checkpoint

- Active phase: Phase 3, bounded existing-browser maintenance.
- Normative requirement: [REST/WebUI adapter requirements §§2 and 6](../requirements/api-and-webui.md#2-adapter-architecture): one typed core authority, shared client flows, recognizable actions, and visible status/failures.
- Executable exit: production web build, preference compatibility/fallback and
  i18n checks, broad practical Go tests, actual-browser comparison of two
  layouts under the same palette, shared search/selection/Notes draft retention,
  browser-local persistence, responsive checks, and an actual-browser held-read
  continuation plus disposable render-fault and held-write checks.
- Checkout: `main`, HEAD `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`,
  with pre-existing uncommitted work. Results apply to the changed tree, not a
  clean HEAD or a release package. Unrelated changes were preserved.

Root selected the scope, integrated the frame, and verified the running client.
Luna implemented the frame, selector/preferences, styles, and ADR/design
correction, with separate file ownership and read-only integration review.

## Implemented behavior

Settings > Appearance leads with two structural interface choices. Workspace
retains the existing workbench: full-width shared header/status and a navigation,
content, and optional inspector grid. Content showcase uses full-height left
navigation beside an inset header and main stage, a larger content heading,
and gallery cards that retain their scale even with few results. These are
different React shell compositions and presentation rules under the same
palette; changing colors is a separate, collapsed option.

`InterfaceFrame` receives the existing header, navigation, content, and details
nodes. App owns the existing flows, query, results, selection, Notes drafts,
and overlay state. Settings/source/export/restore/navigation dialogs remain
stable siblings outside the replaceable frame. There is one header/search and
one status disclosure; compact mode retains the existing navigation dialog and
its status panel. No new domain operation, catalog, service, durable schema,
provider, or signed record was added.

`interfaceId` uses the existing guarded origin-local
`cairn.appearance` preference. Old palette-only preferences select
workspace while retaining valid palette/mode fields. Unknown or malformed IDs
resolve to workspace. Changes apply immediately and persist across reloads.
This setting is disposable browser state, not a server preference or backup
record. Both layouts use the same current content, search, Notes, and access
operations.

The inspector follows document flow in showcase. A fixed sticky offset was
removed after review found that shared search predicates can increase header
height. Long headings and actions wrap onto separate rows when the inspector
shares the desktop stage, and its sections retain the shared DOM order. Narrow
screens substitute the inspector for the content region while
keeping the back action and header reachable.

## Executed evidence

| Check | Result | Scope / evidence |
| --- | --- | --- |
| `npm --prefix web run build` | PASS | TypeScript and production Vite build; existing >500 KB JS chunk warning remains. |
| `node scripts/web-client-preferences-check.mjs` | PASS | Legacy compatibility, invalid/denied preference fallback, valid interface persistence and root attribute application; reserved generic modes and compiled slot conflicts still checked. |
| `node scripts/web-i18n-check.mjs` | PASS | Complete, duplicate-free English/Chinese catalogs and literal coverage. |
| `go test -tags purego ./...` | PASS | Broad current-tree Go set, largely cached; no Go/core changes in this slice. |
| `git diff --check` / installed PostCSS parsing | PASS | Whitespace and stylesheet syntax checks. |
| Same-palette desktop layout comparison | PASS | Actual 1280 × 900 client; both Slate/light and the same three QA subjects. Header/navigation DOM composition, title scale, and card presentation differ. |
| Search and state retention, both directions | PASS | Submitted `Photo` query, one result, selected Photo, inspected Photo, saved Note/tag, and unsaved `QA interface draft: keep across both layouts.` remain after switching. This checks shared flow state, not every child DOM state. |
| Settings continuity and keyboard | PASS | Appearance stays open on switching; native interface radio ArrowRight selects the other layout. Closing returns focus to the current settings trigger. |
| Reload persistence | PASS | Showcase remains selected after loading the new built assets. Unsaved Notes persistence across reload was not claimed; the QA draft was intentionally cleared before reload. |
| Responsive layouts | PASS for bounded checks | Both library layouts and interface selector checked at 390 × 844; showcase inspector checked at 800 × 900 and 390 × 844. No horizontal document overflow. Compact navigation exposes the shared status disclosure. Overrides reset afterward. |
| Search predicates and inspector | PASS for bounded checks | Real structured/free-text query renders a growing predicate header, wrapped heading/actions, and inspector in DOM order. Its position is static rather than a fixed sticky offset. |
| Gallery with one / three results | PASS | Auto-fill keeps a single result at a browsing tile scale rather than expanding it across the whole stage; three real results remain available. |
| Content / annotations | PASS | Three subject/entry/content/length tuples and durable Note/tag records unchanged. Original downloads independently match stored SHA-256 and logical length. |

The actual loopback daemon at `http://127.0.0.1:4648/` serves `web/dist`, using
the existing isolated `dist/client-appearance-20261006/` QA deployment. The three
small PNG/Markdown/WAV files are real typed-ingest test content, not a user
library or a media-playback fixture. Missing model bundles and unknown health
proof remain visible; no fixture provider was promoted.

Current local evidence is in `dist/interface-experiences-20261006/`:
`browser-checks.json`, `qa-invariants.json`, and `screenshots/` (workspace and
showcase desktop, showcase mobile, and interface selector desktop/mobile).
The initial acceptance build emits `index-B4JT0grO.js` and `index-DjWch0_l.css`.
These are retained development outputs, not supported release packages.

### 2026-10-06 continuation: in-flight operations and render failures

The executable continuation is `node scripts/web-interface-experiences-e2e.mjs`.
Its retained evidence is in
[`dist/local-continuation-20261006-QsR18A/interface-e2e/`](../../dist/local-continuation-20261006-QsR18A/interface-e2e):
`live-browser-evidence.json`, `render-fault-evidence.json`,
`held-write-evidence.json`, and the accompanying screenshots. It records the
checkout HEAD and dirty-path count, the QA deployment/workspace identity, and
SHA-256 digests for the assets actually served and the disposable test bundle.
The live pass used the isolated `dist/client-appearance-20261006/` deployment
at `http://127.0.0.1:4648/`; its operations were read-only.
The continuation's production assets are `index-DlsENkIM.js` and
`index-B7zddTFy.css`; their hashes are recorded in `live-browser-evidence.json`.

The browser held one App-owned `status.get` refresh while switching workspace
to showcase and back. The submitted `Photo` query, selected `Photo.png`, and an
unsaved Notes draft remained visible through both switches. The held request
then continued to the real daemon and returned `SUCCEEDED`, with zero mutation
dispatches. The refresh is designed to reload library projections when it
completes, so retention is asserted while the request is held, not after that
completion. This checks the shared App flow; it does not claim that local
`StatusPanel` doctor receipts or every presentation child's DOM state survives.

Render-fault checks used a separate disposable Vite production bundle with a
test-only transform at `InterfaceFrame`; the production source has no injected
hook or global. A one-time showcase failure reached the boundary and recovered
to workspace, after which explicit reselection succeeded with the shared query
and Notes draft intact. A persistent frame failure produced the visible
recovery panel, stopped automatic retries, allowed one bounded explicit retry,
and returned focus to the panel's Settings action after closing Settings. Once
the test fault was cleared, explicit selection recovered the showcase while a
shared status request remained held. Core request counts stayed stable and no
mutation was dispatched in these fault scenarios.

A separate disposable daemon/catalog/repository check held one real
`annotation.upsert` across a layout switch. The browser dispatched it once;
after release the daemon returned success and the isolated catalog contained
exactly one matching Note at revision 1. The temporary store was removed after
the check. This write evidence is separate from the read-only live QA run.

## Evidence limits and remaining design

- These are first-party bundled layouts. Arbitrary frontend packages, CSS
  imports, runtime installation, compatibility negotiation, or third-party
  isolation are not implemented.
- Unknown preference fallback and injected render-exception recovery are tested
  in the stated local browser scope. The deterministic fault bundle is test-only
  evidence, not release qualification.
- The shared query, selection, and Notes draft were checked while an App-owned
  status request was held, and one isolated Note mutation was checked through
  commit. Presentation children may remount: preview-specific DOM state, scroll
  continuity, every active drawer, and local `doctor.check` receipt retention
  remain unqualified. Content preview reads and cleanup may legitimately recur
  after a layout remount; request-count assertions cover shared search/status
  flows and mutation dispatches only.
- This is not a full accessibility, offline, browser compatibility, or performance
  qualification. It adds no albums, playlists, music/video player, new media
  index, multi-user account, tenant model, or authentication profile.
- The original Bilibili reference returned HTTP 412 during this review. These
  layouts do not claim an exact reproduction of that video's design.

The earlier [palette/lens acceptance](client-appearance-and-views-acceptance-20261006.md)
remains valid for its stated narrower slice. See
[the experience design](single-operator-experience-pack-design.md) and
[ADR-021](build-stack-and-architecture-selection.md#adr-021-replaceable-bundled-interface-experiences-over-shared-client-flows)
for the whole-interface boundary and rationale. No normative phase/status
matrix was advanced by this client work.

## 2026-10-06 final continuation after reader-lifetime repairs

The final-assets rerun passes live shared query/selection/Notes retention during
one held status read, showcase-only rendering failure recovery, persistent
workspace failure handling, and an isolated held Notes save with one durable
revision. The disposable write uses the fixed daemon and records its selected
binary path and digest; live 4648 passes remain read-only. Retained receipts:
`dist/all-completion-20261006/integration/interface-settled-final/`.

The initial continuation lost its HTTP listener due to descriptor ownership
bugs; a later run exposed an invalid harness precondition. Both Photo-search
setup paths now wait for the submitted real search response and loading
completion before selecting a result and composing a draft. No retention or
request-count assertion was removed. Search completion's ordinary detail reset
is tested separately from presentation fallback. The failures remain historical
evidence rather than being relabeled as successful runs.

Final JS/CSS digests, fixed binary, larger image inspection, whole browser,
real-provider, and package/restore receipts are recorded in
[local continuation acceptance](local-completion-acceptance-20261006.md).
Child DOM/scroll state, every drawer, accessibility, other browsers/platforms,
performance and release qualification retain their original limits.
