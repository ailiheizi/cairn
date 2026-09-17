# Changelog

## Unreleased

- Added a derived `media_class` search filter (image, video, audio, document,
  archive, other) to `search.query`, computed from the entry's recorded
  filename suffix by one server-side table. The browser's `type:image` and its
  siblings now reach the daemon as `filters.media_class` instead of being
  reported as inexpressible, an entry with no recorded suffix matches no media
  class including `other`, an unknown filter value fails closed as
  `invalid_input`, and a negated media class is still reported as inexpressible
  with no query sent. No durable column or table was added: the class is
  recomputed from the recorded suffix.
- Tag rename and merge are now one digest-bound daemon operation pair.
  `annotation.tag_plan` returns a read-only plan naming every affected subject,
  the ordered add-then-tombstone changes (including explicit no-op adds) and a
  canonical digest; `annotation.tag_apply` re-derives that plan, refuses a
  changed digest with a typed conflict before writing anything, and returns one
  outcome per subject — changed, unchanged, or left carrying both names with the
  daemon's own reason. Because the target is added before the source is
  tombstoned, an interruption leaves both names rather than neither; a partial
  apply returns DEGRADED and is never presented as a clean rename; the reverse
  change is the same planned, confirmed operation. The tags view now shows the
  daemon's plan before any write and the daemon's per-subject outcomes after.
- Added a bounded read-only MCP profile over the typed command ABI
  (`rw mcp serve --stdio --read-only`). Four tools — `search`, `get_subject`,
  `list_recent`, `read_text_extract` — can dispatch only an enumerated allowlist
  of read operations through one gateway, so no plan, apply, restore, verify,
  export, cancel, delete or configuration operation is reachable; a test
  enumerates the whole command ABI and fails when a new operation appears
  unclassified. The surface is stdio-only against the local socket, requires a
  read-only token that must differ from the write-capable API tokens and is
  never logged, echoed or sent to the daemon, and refuses every tool call when
  no token is configured. Results separate the daemon's own status, component
  states and reasons from what is unavailable or unknown, clamp the requested
  limit to a server maximum and report the clamp and any truncation, and never
  answer from a cache or generate text.
- The frozen export manifest's `sidecars` field now has one implemented
  materializer. `export.plan` accepts the empty default plus
  `handoff-v1:manifest-json`; anything else fails as `invalid_input` with the
  vocabulary in the reason, and a frozen output name that collides with a
  derived sidecar name fails the same way. Applying with that policy writes the
  frozen subject files exactly as before plus one derived
  `restoreweave-export.json` beside them that restates each item's output name,
  exact identity, logical size and exactness with the manifest id, digest and
  policy, and says in its own note that it is derived output rather than content
  identity. Its content is a function of the frozen manifest alone, so applying
  the same manifest to another empty destination reproduces byte-identical sidecar
  bytes. Verification recomputes it and compares byte-for-byte: a missing, a
  renamed or a byte-altered sidecar of the same length fails with the reason and
  is never a clean verify, while an export that requested none keeps today's
  layout. Apply and verify name the sidecar files they wrote or verified.
- The search field now accepts operators — `tag:`, `type:`, `size:`, `mtime:`,
  `dup:`, `path:`, `name:`, and `hash:`, with `-` negation and quoted values —
  mapped onto the existing `search.query` filters, lexical text, and construct
  axes, with no new wire field and no second query path. A predicate row under
  the field shows each parsed predicate as an editable, removable chip that
  names the daemon input it writes, autocomplete offers the operator names and
  the loaded tag vocabulary with per-tag counts, and an unparsable or
  inexpressible token is a visible error that runs no query. Predicates the
  daemon cannot express are labelled as evaluated over the loaded results, and
  the daemon's entry-type filter has no media class, so `type:image` and its
  siblings are reported as inexpressible instead of being sent as a value the
  daemon never records.
- Added a Duplicates workspace view for exact-identity review. It groups the
  loaded listing by the daemon's own identity (one SHA-256 content id plus one
  logical length, the same key the library's duplicate badge uses) and shows
  each group's members side by side with their name, provenance path, logical
  size, entry type, the protection outcome the daemon's protection axis claims,
  their representation and placement, and their durable tags. The scope is
  labelled over the loaded subjects, the daemon's duplicate-group filter
  confirms each group, and an empty state never claims there are no duplicates
  catalog-wide. Review is non-destructive by construction: a member opens its
  details, selected members can receive one user tag, one member can receive a
  note, and a path can be copied — the only write this surface can issue is an
  annotation upsert, with no delete, move, merge, or similarity grouping.
- Added a Tags workspace view over the durable tag facts. It lists every live
  tag with its subject count, filters by substring without rewriting a name,
  and shows one tag's subjects with the daemon's own name, provenance path,
  protection outcome, and record revision. Adding or removing a tag uses the
  admitted annotation operations with the record's own revision. Rename and
  merge are one previewed operation: the preview lists every affected subject
  and record before any write, the apply runs per subject (add the new name,
  then tombstone the old record) and keeps a visible record of each subject's
  outcome with the daemon's reason for any failure, so a partial apply reads as
  partial — never as a clean rename — and nothing is rewritten in place.
- Added the selection report: the batch selection bar downloads one Markdown
  document built in the browser from what the daemon already answered. Each
  subject carries its provenance path, entry type, logical size, exact SHA-256
  identity and logical length, the protection outcome the daemon claims, its
  user tags, and every note with its source label. A fact the daemon did not
  report is written `UNKNOWN` with its reason — an unreadable representation, a
  degraded read, a link-only member, a note body that could not be read, or a
  subject whose reads failed all stay visible instead of being dropped. Reads
  are bounded and the document reports how many subjects were read and whether
  any read was skipped; nothing is uploaded and no service state changes.
- Added an Activity workspace view beside Library and Sources. It lists the
  durable job rows read back from the daemon, renders every recorded state in
  words (queued, running with an elapsed clock, waiting for approval, completed,
  failed with its error code, cancelled with the daemon's own note that
  published snapshots were not rolled back, and unknown outcome needing
  reconciliation), expands a row into the retained run log, and stops polling
  once the daemon reports the job terminal. Cancel asks the daemon and nothing
  more: a queued job becomes cancelled while a running job keeps its running
  state with "cancellation asked", and a terminal row offers no action. An
  unresolved job continues through reconciliation rather than a rerun.
- Added the integrity and verification report. Each restore point shows its
  frozen counts, the protected and unprotected mix, and the newest verification
  receipt the daemon actually recorded; a restore point without a receipt reads
  `Last verification: UNKNOWN` with the daemon's reason and never a time. The
  operator can run authenticated-metadata, sampled-content, full-bytes (whose
  cost is confirmed before any request is sent) or restore-drill verification; a
  result is reported as this-browser-session evidence and cross-checked against
  the receipt that appeared, so a cancelled or blocked run reads outcome UNKNOWN
  and leaves no success claim. The catalog-wide placement row reads UNKNOWN with
  the missing capability named, and the only client-side count is labelled as
  covering the loaded subjects.
- Replaced the three readiness dots and the system-rail health strip with one
  trusted status disclosure. Every fact it reports is either
  `PROVEN · {value} · {as-of}` or `UNKNOWN`/`DEGRADED`/`FAILED — {reason}`, the
  summary names the weakest attributable fact, and a fact this build cannot
  source (the catalog-wide subject count, the portable-record export list, an
  unrun byte-reading doctor check) reads UNKNOWN with the missing capability
  named instead of a zero or a healthy default. The disclosure is a native
  `details/summary`; the verification-report trigger it owns is wired to a
  typed drawer stub for the verification surface.
- Made parallel surface ownership real: the translation catalog is now one
  file per surface under `web/src/i18n/` merged by `i18n.ts` (public API
  unchanged, `scripts/web-i18n-check.mjs` proves no key was lost, retranslated,
  or duplicated), and the browser E2E assertions are now one module per surface
  under `scripts/e2e/` imported by `scripts/web-e2e.mjs` in the same order it
  ran them before.
- Split the browser client into one file per surface. The application shell now
  keeps only root state wiring, each surface lives in `web/src/components/`, its
  data flow in `web/src/app/`, and its rules in `web/src/styles/` (aggregated in
  a fixed order by `styles/index.css`). Structure only: the markup, strings,
  shortcuts, focus behavior, ARIA attributes, and daemon calls are unchanged,
  and a surface change no longer needs an edit in the shell or in another
  surface's file.
- Licensed the RestoreWeave project source under the MIT License.
- Added detailed Chinese and English public README guides.
- Reconciled public capability and roadmap wording with the tested core preview.
- Marked the removed Inbox, OpenSubsonic, and OPDS adapters as historical.
- Added read-only repository capacity reporting and honest per-item tag, lexical,
  and semantic index-status projections.
- Added the explicit fixed BGE bundle installer, deterministic candidate-only
  offline artifact assembly, and real semantic qualification evidence.
- Strengthened bounded processor retry, process-crash takeover, repository
  migration, encryption-boundary, and representative-corpus test evidence.
- Bound raw and zstd candidate measurements to the same reviewed operator
  corpus manifest, rejecting changed input before either repository opens.
- Generated savings-report corpora now write and verify an operator
  corpus-manifest.v1 before opening either in-tree repository.
- Candidate offline packages now record CLI BuildInfo beside the daemon and
  reject a CLI whose platform does not match the daemon.
- Persisted config and the daemon name-reject experimental
  `local-zstd-encrypted-v1` without admitting encryption or a secret provider.
- The local launcher now refuses any occupied loopback TCP port, not only an
  HTTP health endpoint, and keeps the occupant running.
- Selecting a file now shows its text or image preview immediately, and image
  rows can display a thumbnail without a second Preview click.
- The desktop library keeps a fluid left navigation rail (176px to 208px) even
  when no file is selected, instead of stretching the sidebar into a full-width
  card.
- The library scan surface is a thumbnail grid of picture and name. Paths, tags,
  type labels, and index status stay in the inspector.
- The top bar fills its own width: the search field takes the remaining space
  instead of stopping at a fixed maximum, so the status and action buttons sit
  against the card's right edge.
- The desktop layout fills the whole window on every desktop width instead of a
  capped column, and the library gained a grid/list switch. Grid mode spreads
  square tiles across the full row from the left rail to the right gutter, with
  the tile size and the file glyph following the window width; list mode shows
  one dense row per file with its size and type.
- Desktop scaling now uses two width boundaries (640px and 1080px) plus fluid
  rail and tile sizes instead of a per-breakpoint ladder: the navigation rail
  stays on every non-phone width, and below 1080px the inspector replaces the
  list so browser or display zoom above 100% never squeezes both into
  unreadable columns.
- Removed duplicated navigation and settings noise: the left rail keeps only
  Library and Sources (the topbar already owns search, restore, and settings),
  the single-source path chooser is hidden, and Settings opens as a centered
  desktop dialog over the library with every section on one page.
- A process kill during exact placement no longer strands the repository
  fail-closed: an explicit host-owned sweep removes only aged regular files
  under `tmp/`, and a real process-crash test proves the orphan state, the
  fail-closed measurement, and the recovery.
- Refined the responsive WebUI and added sanitized Chinese and English product
  screenshots for the current unreleased preview.
- Reworked the bilingual README into a compact product landing page and moved
  detailed capability, storage, search, and recovery explanations into the
  Wiki.
- The export drawer now reads saved views and frozen manifests back from the
  daemon: a saved view can be recalled into the library as a live, explicitly
  dynamic evaluation, and a past export can be re-verified against its
  destination without materializing it again.
- Configured sources are one workspace view instead of two: the rail's Sources
  item switches the content column to a Sources page that reuses the existing
  source cards, their recheck and view actions, and the existing add-source
  action, and the duplicate disclosure bar above the library results is gone.
  Phones, where the rail is hidden, keep the same view reachable through a
  compact Sources entry above the library heading.
- The top bar and search field use a message-composer treatment instead of
  transparent glass: a rounded, almost opaque card with a hairline border and
  no blur, a rounded-rectangle search field with a softened accent focus ring,
  and hairline top-bar action buttons with unchanged hit targets, in both the
  dark and light themes.
- Library tiles are a picture and a name again: the leading-line text preview in
  a tile is removed, and a non-image tile no longer reads content at all. Image
  thumbnails, the natural-size badge for tiny images, and the short visible
  reason on an image tile whose bytes cannot be read are unchanged.
- The inspector preview now opens a real image viewer: clicking the picture or
  the labelled `View full size` control opens a modal dialog with the file name
  and the natural pixel size, bounded 10%-800% zoom (buttons, mouse wheel,
  fit-to-window, and 1:1), and drag-to-pan. Focus moves into the dialog, stays
  trapped there, and returns to the opening control; Escape closes it. When the
  exact bytes are unavailable the viewer states the reason and renders no image
  stage instead of a blank or fabricated picture.
- The settings modal is now a two-pane workspace: a vertical category list with
  icons, a visibly active entry, and an unsaved-changes indicator for every
  dirty category controls one independently scrollable section at a time, and
  the existing "Unsaved changes by category" summary switches to the category it
  names. Below 640px the list becomes a horizontal keyboard-scrollable strip
  above the content. Draft state, save, reload, close, locale, and the
  draft-guard prompts are unchanged.
- The browser E2E asserts the real settings layout element as two panes above the
  mobile boundary and one column at 640px, walks all five categories at both
  widths, and checks text-tile fetch counts and the image viewer, replacing an
  assertion that queried a removed class and therefore passed vacuously.
- A source image whose natural size is under 32px is labelled with that size
  (for example `1x1`) on its thumbnail, so a solid-colour square reads as an
  accurate rendering of a tiny image rather than a broken asset; its existing
  pixel-art scaling is unchanged.
- The inspector preview is a labelled `Preview` section on the same card
  surface as its neighbouring sections, so the file's first lines read as a
  deliberate part of the details panel instead of an unlabelled box at the top.
- Extended the message-composer treatment beyond the top bar: details and
  inspector cards, library tiles, source cards, empty states, the add-source and
  export drawers, and the settings modal now share large radii (16-20px),
  near-opaque fills, hairline borders, and soft shadows instead of glows, with
  a real backdrop blur reserved for the drawer and modal layers. Dead legacy
  selectors that no longer rendered were deleted instead of restyled, and every
  hit target the change touches stays at least 32px in both themes.
- The library gained a sort control beside the layout switch: a field choice
  (name, size, type, path) and an ascending/descending toggle. It orders the
  items already loaded in the browser, which is the complete publication set
  that `content.list` returns, and says so in its accessible description; name,
  type, and path compare locale-aware, size places entries without a logical
  size last in both directions and shows that size (or its absence) on the
  tile while it is the sort key, and the choice persists across navigation.
  Search results keep the relevance order the daemon returned: the control is
  disabled there with that reason rather than silently reordering the hits.
- The library now supports explicit multi-selection on top of the single
  details subject: Cmd/Ctrl+click toggles a row, Shift+click extends the range
  from the last anchor in the rendered order, and each tile carries a selection
  affordance that appears on hover and keyboard focus and never opens details.
  A selection bar above the list reports the count and offers select-all,
  export-selected, add-tag, and clear. Export selected freezes every chosen
  subject into one explicit `ExportManifest` (the daemon's own collision and
  invalid-member messages are surfaced unchanged), and add-tag applies one tag
  body with sequential `annotation.upsert` calls and reports exactly how many
  succeeded and which failures happened with their reasons. Selected subjects
  survive reordering and are dropped when they leave the listing, and neither
  opening nor changing the selection touches unsaved note or tag drafts.
- The library is keyboard navigable with a roving tabindex: the list owns one
  tab stop, Left/Right move by one item, Up/Down move by one rendered row using
  the measured column count of the fluid grid (one item per step in list mode),
  Home/End jump to the ends, Space toggles the focused tile, Enter opens its
  details, Cmd/Ctrl+A selects every visible item, and Escape clears the
  selection only when no drawer, viewer, or settings surface owns that key.
  The focused tile stays visibly ringed and scrolls into view, and the existing
  row-open button keeps working for pointer and screen-reader users.
- A frozen export manifest planned with a sidecar policy now stores that policy
  in the catalog projection instead of dropping it, so `export.apply` and
  `export.verify` rebuild the identical manifest digest after the manifest is
  read back, including after a store reopen. A tampered stored policy now fails
  closed as a digest conflict, and a catalog created before this migration
  upgrades with the empty policy its manifests were planned with.
- `export.plan` now honors a caller-supplied `output_name` instead of silently
  ignoring it: the name is used when exactly one regular file is frozen, and a
  single name for a multi-file selection, a blank name, or a name that is not a
  safe single destination-relative component fails as `invalid_input` with the
  reason. Two subjects whose display names share a base name no longer fail
  closed either: repeated output names are disambiguated deterministically as
  `clip.mkv`, `clip (2).mkv`, `clip (3).mkv` (or `notes`, `notes (2)`) in
  ascending subject-reference order and grouped case-insensitively, because
  macOS, Windows, and most NAS SMB destinations may not hold `Clip.mkv` and
  `clip.mkv` at once, so planning the same set always freezes the same names.
  Unicode NFC/NFD normalization remains out of scope and is a recorded
  limitation.
- The add-source drawer's next action is one sticky bar pinned to the drawer's
  bottom edge instead of a button that scrolls away below the plan card: with no
  plan it offers the preview action (disabled until a path exists), a ready plan
  turns the same control into the single confirm-save action that names the file
  count, a blocked plan shows its reason with the action disabled, an apply
  whose outcome is unknown offers no second save, and a source whose content is
  already stored says plainly that nothing new will be added and offers the
  saved content instead. Pressing Enter in the path field previews the plan, the
  field keeps focus on open, and the drawer offers one-tap path suggestions
  built only from the configured source locators and the last path planned in
  this browser, where choosing a configured source reads as a recheck of that
  source rather than a fresh add. The review card is unchanged: files, logical
  content, unique bytes to add, duplicate bytes expected to reuse, warnings,
  protection decisions, and the per-file list still appear before the
  preview-then-confirm gate, which this change does not relax.
- The save action now reads plainly as `Confirm save` / `确认保存` with the file
  count (for example `确认保存 · 2 个文件`) instead of "Save exact copy", and the
  restore drawer got the same sticky-bar treatment as the add-source drawer: the
  drawer's only next step is pinned to its bottom edge, starting as the preview
  action that stays disabled until a destination exists and turning into the
  single `Confirm restore` action that names the file count once a plan is
  ready. A blocked plan shows its own reason and no runnable confirm, a
  finished restore reports the verified result in place with a clear close
  action instead of a second apply, an unknown or unverified outcome says so
  plainly and never offers another apply, and a failed planning request states
  its reason in the bar rather than behind the drawer. The drawer remembers the
  last few destinations planned in this browser as one-tap chips that fill the
  field and preview that destination; there is no host-filesystem browser and
  no new daemon operation. The restore plan card keeps its review evidence
  (item and byte counts, exact-byte outcome), the destination must still be an
  empty directory that is not the repository, the plan is still recorded before
  any bytes are written, and both preview-then-confirm gates are unchanged.
- The one search field became keyboard-first without a new surface: Cmd/Ctrl+K
  focuses it from anywhere, `/` focuses it outside an input, textarea, select,
  or contenteditable element, and both shortcuts stay out of the way while a
  drawer, the image viewer, or the settings dialog owns focus. A clear control
  empties the field without running a search or changing the current results,
  and the existing `All content` heading control stays the way back to the full
  library. A labelled local recents panel (at most eight entries, most recent
  first, de-duplicated case-insensitively, persisted under
  `restoreweave.recent_searches`) appears while the field is focused and empty,
  re-runs a submitted query, drops one entry, or clears the list; Escape closes
  the list first and empties the field only on the next press. The panel states
  that it is browser-only history rather than a saved view: `view.save` remains
  the durable form of a query, and the browser E2E proves the local list creates
  no daemon view.

## v0.1.0-prealpha.1 - 2026-08-25

First core-preview checkpoint. This is a source build for development and
evaluation, not a production-qualified release.

### Core workflow

- Added configured directory inspection, reviewed protection plans, exact
  whole-file SHA-256 identity, duplicate accounting, verification, and restore.
- Added durable versioned Notes, lexical/structured search, saved views, and
  frozen export manifests for the admitted local scope.
- Added real local `BAAI/bge-small-zh-v1.5` ONNX inference and in-process zvec
  generations, including startup probing, restart reopening, leases, and honest
  unavailable behavior.
- Added the optional loopback `/api/v1` adapter and React browser client over
  the existing typed command dispatcher.

### Recovery and safety

- Added authenticated portable facts and subject mappings, independent trust
  anchors, clean-install reading, corruption rejection, relocation evidence,
  cross-process publication fencing, and unknown-outcome reconciliation.
- Added bounded processor retry of the same signed plan and copy-forward
  repository migration evidence.
- Kept garbage collection non-destructive; source deletion and automatic
  external reacquisition remain disabled.

### Scope cleanup

- Removed the experimental Inbox, OpenSubsonic, OPDS, and gateway implementation.
- Kept CLI as an initialization, diagnostics, scripting, and emergency-recovery
  surface; the browser client remains a thin adapter over the same core.

### Known limitations

- No supported installer, container image, or bundled model download.
- Repository profiles and release migration are not production-qualified.
- No destructive GC, writable filesystem gateway, or automatic source cleanup.
