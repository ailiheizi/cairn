# Coherent Content Spaces Implementation Plan

> **For agentic workers:** Use subagent-driven development, preserve earlier dirty changes, and do not commit. The owner approved this direction; no further design approval is needed.

**Goal:** Enter Photos, Music or Library from Home without a visual break, while keeping each page's main task clear and secondary tools on demand.

**Architecture:** Existing React client, typed host actions and one verified player. Shared shell tokens/header/frame, specialized existing bodies; no backend change.

**Tech Stack:** Existing React/TypeScript and CSS; no new dependencies.

**Spec:** Owner-approved cross-page direction in `2026-10-27-private-space-focus.md`; normative UX-C1/C2/D1 in `docs/requirements/first-party-client-experiences.md`.

**Phase / requirement / exit:** Admitted RW-PERSONAL-UX-1 client work parallel to Phase 4/5 / coherent host shell and progressive disclosure / one `coherent-content-spaces` browser journey on the retained isolated port4663 fixture.

## Decisions and constraints

- One owner, one catalog/repository and shared content/discovery/export/recovery authority. Convergence only; no new schemas, endpoints, processors, models, loaders, dependencies or test frameworks.
- Home/Photos/Music/Library share the quiet brand/search/Add/navigation header, canvas, font scale, rounded controls and content gutters. Home alone keeps its large welcome and editable cards. Do not duplicate navigation rails.
- Existing host colors are bridged from the shared space palette so domain bodies and open inspectors/intake inherit a coherent treatment. Keep status, active scope and incomplete/unavailable information readable.
- Photos leads with the wall and compact local search; visual/name scope stays explicit. Detailed format/tag/timeline/density controls are a closed icon disclosure until requested. Active local filters stay visible and clearable.
- Music leads with Tracks/Artists/Albums and the track list; one compact local search and primary play action. Detailed filters, sorting and secondary batch/queue actions are disclosures. Any current-playing treatment uses the existing host tuple only.
- Library leads with search scope, results and preview/takeout. Secondary view/sort/filter utilities are closed by default. Selection actions appear when selection exists. Do not hide active filters or errors.
- Keep exact read/media budgets and all enabled-page guards. Preserve query, selection, playback and Home edits across navigation. No fake covers/facts/recency or new persistent playlists/albums.
- English repository docs. Each delegate reports conflicts instead of broadening scope; no commits, builds, independent suites or completion credit from delegates.

## Parallel implementation boundaries

- [x] **Shell — Luna:** `main.tsx`, `TopBar.tsx`, `PrivateSpaceShell.css`, `InterfaceFrame.tsx`, `styles/interface-frame.css`, `i18n/privateSpaceShell.ts`. Apply the shared shell to existing browse destinations, with a stable header and a single menu; preserve system-workspace frame ownership. Own shared palette bridge and outer frame. Do not edit domain bodies.
- [x] **Photos — Luna:** `PhotoLibraryExperience.tsx/.css`, `photo/PhotoCard.tsx/.css`, `photo/PhotoViewer.tsx/.css` only as needed, `i18n/photoExperience.ts`. Keep the existing state/actions and windowed wall. Compact the first view, move secondary tools into icon disclosures, make active filters removable. Consume the shell's existing `--sp-*`/standard token bridge, do not edit shell or host files.
- [x] **Music and Library — Luna:** `MusicLibraryExperience.tsx/.css`, `LibrarySurface.tsx`, `LibraryWorkflow.css`, `styles/library.css`, `i18n/musicExperience.ts`, `i18n/library.ts`. Simplify domain and host toolbar hierarchy without changing hooks or capture/export behavior. Preserve earlier save/find changes in these files. Do not edit shell/Photos files or central i18n registration.
- [x] **Integrate/review — root:** Read the complete changed diff and resolve shared seams; no new component props across ownership boundaries without coordinating first. Build after integration.
- [x] **One acceptance — Luna:** Home → Photos → open/close existing viewer → Music → verified play/pause → Library → search/select/Details/takeout entry → return Home. Confirm stable common header/frame, reachable on-demand tools and active-scope visibility. Check light/dark desktop and settled screenshots of the four destinations. Reuse prior Home editor/media evidence when unaffected; no broad backend or E2E suite.

## Review focus

Navigation must not show two rails, reset queries or stop the host player. Closed panels must not conceal active filters/errors. Light-theme precedence must not reintroduce glass/capsule shells. A clean first view must still expose the main task and an understandable way to reach secondary actions. A fixture validates layout/actions only and grants no release/core phase qualification.

## Observed integration corrections

The single journey and actual screenshot review exposed specific gaps, addressed
within the same feature: search help now overlays without moving click targets;
Home/Library/Photos/Music are directly reachable in the one menu; returning from
a media presentation in search/tag mode switches back to Library while keeping
the query; Recent searches Escape uses current state; decorative Library icons
cannot intercept the existing selection checkbox. The last correction extends
the allowed diagnostic edit scope to `web/src/components/ResultList.css` only.
Photo controls reveal outside layout flow above a fixed filename caption, so
hover neither hides the name nor changes the windowed row height.

## Delivery evidence

Implemented for this admitted client scope on 2026-10-27. Root reviewed the changed source and the four actual desktop surfaces; the scoped code review is in `.superpowers/sdd/2026-10-27-private-space-focus/coherent-review.md`. The one `coherent-content-spaces` journey and its corrective follow-up are recorded in the existing `acceptance-report.md` beside it. The final build serves `index-DU7MMq8F.js` and `index-Cn7hcpXP.css`. Compilation and `git diff --check` passed.

Observed outcomes: one common header/menu and palette; fixed header geometry during search focus; explicit on-demand Photos/Music/Library tools; working photo viewer; one verified player surviving navigation; query-preserving domain/Library navigation; real pointer selection and existing Details/original/ZIP takeout entries. A fixture validates UI behavior, not semantic profile or release qualification. No content capture/export mutation or broad backend suite was needed.
