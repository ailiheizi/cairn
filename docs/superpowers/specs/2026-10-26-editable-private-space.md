# Editable private space

The owner selected the private-space homepage concept and requested a working
frontend with homepage editing on 2026-10-26. This delivers one bounded
successor to UX-C2, on the existing first-party client track parallel to Phase
4/5. It does not close a core milestone.

## Product decision

The homepage answers: what would I like to return to now? Use a quiet greeting,
a large photo preview, a compact music area and a material preview. Keep search,
add and navigation in the host. Details, selection and management stay available
on demand instead of competing with the content. Use the selected private-space
concept as a visual reference, with actual loaded content and honest empty states.

The same three compiled blocks can be shown/hidden and reordered. Each block
can show 1, 3 or 6 items. The heading can be customized (80 characters maximum).
An explicit editor previews changes and provides Save, Cancel and Restore default
(the latter changes the draft until saved). Hiding everything leaves a useful
empty message and a persistent edit/Library entry. Keyboard-operable move buttons
are sufficient; drag-and-drop and arbitrary widgets are outside this delivery.

Preferences are local to this browser origin and workspace. Store only versioned
layout choices and heading text, never file rows, subjects, playback state or
query results. Ignore unknown/duplicate block IDs, bound lengths and row counts,
and fall back on malformed storage. A failed preference save keeps the current
session usable and states that reload persistence is unavailable.

The existing Overview route becomes the private space. A fresh unqualified
launch opens it when enabled. Explicit Library/domain/search links retain their
meaning; disabled home falls back to Library. Give Home and Library distinct
navigation entries. Homepage editing never resets the host query or selection,
and never changes catalog content. Existing first-party page preferences remain
respected.

## Data and actions

Reuse the host's one loaded/search/tag result scope, order, photo thumbnail
pipeline, recorded audio facts, verified player and Details. Preview counts
describe this scope, not a complete library or recency. At most six photo
thumbnails, six audio rows and six material rows are rendered. Hidden blocks
mount no content previews. Playing a block uses only displayed eligible tracks.
Keep identity, media-read budgets, missing facts and disabled-page exits intact.
Do not add household state, automatic reminders, persisted playlists, list heads,
new providers/processors/endpoints/schemas, runtime plugins or new query authority.

## Whole-feature acceptance

One named browser journey: private-space-home. Open the actual app, edit heading,
hide/reorder blocks and change a preview count, cancel once, save and reload;
confirm saved choices, reset, visit Photos/Music/Library and return, inspect a
real material, and verify an all-hidden and an empty scope remain usable. Check
desktop screenshots in the existing light/dark palettes and the bounded thumbnail
count. Use an isolated existing daemon when fixture data is necessary. No broad
backend test campaign; diagnose only actual failures or uncovered changed invariants.
