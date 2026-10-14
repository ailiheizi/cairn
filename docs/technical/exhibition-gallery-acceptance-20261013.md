# Exhibition gallery refinement — 2026-10-13

## Outcome and boundary

Implemented and locally tested within RW-PERSONAL-UX-1 UX-E2/D1.
[ADR-040](build-stack-and-architecture-selection.md#adr-040-exhibition-as-a-focused-gallery-over-the-existing-photos-scope)
records the decision. The existing Exhibition presentation uses the same
loaded Photos context, host focus, selection, Details and bounded inspector.
This adds no page, endpoint, schema, processor, index, durable media record,
runtime loader or core-phase completion.

The gallery now gives the current photograph visual priority: a compact
heading and loaded position, a stable centered image, quiet neighboring
previews on desktop, and a single image on phones. Restrained shadows follow
the actual image rather than a large permanent card. One filename and one
inspection/Details/selection row replace repeated actions under every preview.
Browsing help is disclosed on demand and uses ordinary product language.
Both light and dark appearances are supported.

Neighbors change focus; the current image opens the existing inspector.
Details retains the host entry for Notes, tags and original downloads.
First/last positions remain centered with honest navigation endpoints. The
existing radius-two window still mounts at most five thumbnail components;
only the current image and immediate neighbors are visible on desktop.
Hidden offsets include the extra positive offsets at the start of the window.
No preview is duplicated for a second filmstrip.

Two local Luna agents implemented separate structure/i18n and CSS scopes.
The primary reviewer inspected saved dirty-tree baselines, the deltas and
real screenshots, then accepted the corrected framing, window visibility and
product copy. Unrelated changes were preserved and no commit was made.

## Executable evidence

The retained report, scripts, raw logs, screenshots and JSON observations are
in `dist/exhibition-gallery-20261013/validation/`. `report.md` distinguishes
the final copy build from earlier browser evidence.

- PASS: final Web build and i18n coverage. Registry checks and `go test ./...`
  passed earlier in this slice; Go ran once. The copy-only final correction
  did not rerun those unchanged checks or the completed behavior suite.
- PASS: final served HTML/assets match `web/dist`; JS `index-CCqfyPYS.js`
  has SHA-256 `254c6885fe173a29b4de4b3a12ecf33b104ad8de68044ffb224329caa2fe367f`;
  CSS `index-BQ3CAt6S.css` has SHA-256
  `626833360fda104f9d399bdbf4f146f8bdb79bb00e81a4a50bf8385e37699dca`.
- PASS: first/middle/last navigation, arrow keys, stable center, disabled
  endpoints, hidden non-neighbor offsets and at most five mounted previews.
  A real unobscured pointer click on a neighbor changes focus without a modal.
- PASS: both the current image and inspection action open the existing
  inspector; closing retains the photograph. Details reaches the host panel,
  Help opens, selection survives return to the photo wall, and reduced-motion
  transition duration is effectively zero under the host's global policy.
- PASS: the unchanged `Cairn-Frame-Overpixel.png` fixture reaches the real
  unavailable preview outcome at 8/11. The reason, visible fallback and enabled
  host Details remain accessible; no failure response was fabricated.
- PASS: four refreshed final screenshots cover 390×844 and 1280×800,
  light/dark, with the existing `01-暖光客厅.jpg` at 2/11. No horizontal
  overflow; image and primary actions are visible. The retained fixture has
  twenty Library items and eleven loaded photos.
- PASS: tracked and new-document whitespace checks.

The stopped local preview was restored using the retained pinned binary and
its original six absolute fixture path overrides. No reseeding, catalog
migration or owner-store access was used. The preview remains on port 4648.

## Limits

Evidence is isolated headless Chromium, not native CUA or real-device
qualification. The fixture has no real semantic default or image index;
photo rendering uses the existing authorized original pipeline. Full player,
Notes-draft, tag/search continuity and original-export matrices were not
rerun in this cohort and retain their separately dated evidence. Large-library,
complete Photos organization and core/release qualification remain open.
