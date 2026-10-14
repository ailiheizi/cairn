# Full-page Photos and Music — local acceptance, 2026-10-12

The subsequent [immersive host-header refinement](immersive-host-header-acceptance-20261012.md)
supersedes this record's header placement, including the phone navigation
dialog. This document retains the earlier domain/control and original-download
evidence; consult the successor for the current header and candidate identity.

## Scope and outcome

**Implemented for the tested local client scope.** This advances the existing
RW-PERSONAL-UX-1 convergence track under
[UX-D1](../requirements/first-party-client-experiences.md#14-ux-d1-full-page-photos-and-music-composition)
and [ADR-034](build-stack-and-architecture-selection.md#adr-034-focused-full-page-domain-layouts-over-shared-host-state).
It adds no domain, backend operation, catalog schema, processor, durable
membership, runtime loader or recovery format, and grants no core-phase or
release qualification.

Photos, Music and the existing Photo Exhibition use registered focused
composition over the same host state. Their content occupies the page width.
Generic library tools are collapsed by default; desktop management and trusted
status share one disclosure, while phones retain the existing navigation
dialog. Active search/filter scope, incomplete loading and meaningful failures
stay outside closed library tools. The standard Library and management views
retain their existing composition. Brand/home navigation now uses the host
callback, so returning to the Library does not reload the document.

Photos uses shared foreground tokens in both appearances, retains density,
format filters, selection, favorites, Details and original access, and removes
repeated empty-tag labels. Music has compact domain navigation and search,
horizontal track rows, three ordinary Play/Add/Queue controls, and selected
actions only when relevant. Short labels preserve displayed-scope counts and
unsupported/hidden-selection notices. Queue, exact-read and image budgets are
unchanged. Native albums and persistent playlists remain **NOT IMPLEMENTED**.

## Delegation and candidate identity

Implementation used DeepSeek Harness headless through the explicitly selected
`sub2api / deepseek-v4.1-flash` route. The persisted assistant source records
confirmed that route for both bounded delegates:

- `session-e253ed96-b709-48d6-b6b4-db3a46deabb1`: host composition and integration.
- `session-1c3a9133-d7b4-4764-965d-e5cbfa300d4b`: domain markup, styles and labels.

The primary agent reviewed the diffs, rejected the first layout's remaining
stacked chrome, and requested bounded corrections. Browser measurement also
found a shared grid selector overriding Music's intended flex row; the final
CSS restores the scoped horizontal layout. No delegate committed or staged.
Unrelated concurrent offline-packaging work was preserved.

The retained evidence directory is
`dist/full-page-domains-20261012/validation/`. `artifact-identities.json`
records checkout/dirty state, daemon/config hashes and served-byte matches.
The final assets are `index-CovN62Nc.js` and `index-9qqop1fW.css`. The JavaScript
SHA-256 remains `02950d67af989385f9c57f8ba2c2c96c42ee36080d6a534d4ac960dbc6fd8693`:
the last correction changed only Music CSS, and the functional JavaScript is
byte-identical to the cohort used for the retained navigation/search/draft/
download journeys, despite Vite giving it a new asset filename.

## Real browser evidence

Verification used the in-app Chromium browser against an isolated Mac fixture
at `http://127.0.0.1:4648/`. It contains 16 protected files: the reproducible
eight-file fixture plus six byte-preserving copies of local Pinterest images
and two existing tagged MP3 samples. Copied images have QA display filenames;
their source files were read only. These are functional/visual samples, not a
representative NAS corpus or a production/default profile. The fixture has no
semantic bundle; its real search-degradation notice remained visible during
the query check, rather than being reported as full semantic capability.

| Journey | Result | Evidence |
| --- | --- | --- |
| Focused Photos/Music composition | PASS | Final DOM reports `data-composition=focused`, closed library tools and no inline management rail; Photos and Music retain their domain controls. |
| Shared player through Music → Photos → Music | PASS | `player-navigation.json`: one audio element, three-entry queue, the same MP3 Blob and paused position of 0.137841 seconds throughout. No autoplay on entry. |
| Selected append under local filtering | PASS | `selected-scope.json`: two selected tracks, one displayed, one explicitly excluded; only the displayed selected A is appended (queue 3 → 4), retaining the paused source/position. |
| Brand return to Library | PASS | `client-home.json`: all-content heading and normal composition return without reloading or losing the player. |
| Management, status and search | PASS | `host-reachability.json`: one sidebar and one StatusPanel inside the desktop menu; Sources is reachable and uses normal composition; Cmd+K focuses the one host search field. |
| Shared query scope and clear action | PASS | `search-scope.json`: `Tagged-test` remains visible in Music and Photos; Photos honestly reports no images among two audio results; clearing the query restores ten photos while staying in Photos. |
| Unsaved Notes guard | PASS | `draft-guard.json`: an actual `Page.javascriptDialogOpening` confirmation event was observed; rejecting it keeps the Photos route and unsaved text. The draft was then cleared without saving. Native dialog handling used the documented CDP interface because awaiting the click alone blocks while the confirmation is open. |
| Original download | PASS | `original-download.json`: a real browser download produces 75,670 bytes with SHA-256 `e87984f72220cae80c154c6fe56f1c72ecb31479fb4f98d7d4b8ea385a3639a4`, matching the copied source. `downloaded-photo.jpg` retains those bytes. |
| Exhibition composition | PASS | `exhibition-composition.json`: the existing gallery uses focused chrome and the same closed host tools. This does not re-accept its full interaction/read-budget matrix. |
| Responsive light/dark rendering | PASS for captured layouts | `photos-{light,dark}-{390,1280}` and `music-{light,dark}-{390,1280}` screenshots/DOM captures; document widths equal scroll widths (375 at the 390 override, 1265 at 1280). Photo names/titles follow readable shared tokens, Details targets are at least 32 px high, and final Music rows compute `display:flex`. |

The final clean dark desktop capture places the first photo at 271.23 px;
the final narrow Music capture places its first track at 403.77 px. These are
layout observations, not a new performance/release threshold. Browser-local
appearance was restored to its original system setting, and viewport overrides
were reset after verification.

## Checks and limits

- Production TypeScript/Vite build: PASS; the existing >500 kB chunk warning
  remains visible (941.28 kB JavaScript, 278.55 kB gzip). No bundle-size
  optimization or large-library performance acceptance is claimed here.
- Compiled page/route/slot conflict and compatibility check: PASS.
- i18n check: PASS, 26 partial catalogs, 1,882 keys, 81 client source files.
- `go test -tags purego ./...`: PASS once during integrated work. Subsequent
  owned corrections were client presentation/CSS only; Go was not repeated.
- Scoped whitespace and built-versus-served byte checks: PASS.

This does not complete photo albums, capture-date/EXIF extraction, retained
renditions, persistent playlists, full artist/album metadata coverage,
independent domain queries, full interface packages, release packaging or NAS
qualification. Real-device/assistive-technology coverage, all fault-injection
branches and the large-library virtualization/performance matrix were not
re-executed for this layout cohort. Existing pagination, verification, draft
guards and resource budgets were preserved, not expanded by this slice.
