# Task Context and Short-Lived Information Design

> **Status:** informative capability recipe, corrected 2026-10-14. The operator
> chose existing-operation reuse instead of an app for each scenario. This
> supersedes the earlier task-record/client/capture pipeline. No feature,
> schema, endpoint, processor, browser integration or completion is admitted.
> See the [closure plan](personal-information-product-closure-plan.md) and
> [single task ledger](product-experience-todo.md#product-closure-work-breakdown--2026-10-14).

## User job and minimal recipe

An owner has several pages/files for a reading or research task, wants to stop
now and continue later. First use an ordinary owner-written/exported TXT or
Markdown record with a useful filename, URL/title list, human order and short
explanation. JSON may be preserved too; this implies neither parsing nor preview.

Existing exact file saving, shared user tags, one Notes surface, supported
search/SavedView, selection and original takeout provide the common loop.
A tag associates the record and files; it does not create a task entity, group
Note or ordered membership. Routine use need not expose internal IDs.

The retained goal is comfortable return to the chosen material. This recipe
is a baseline for composing that experience, not a declaration that copying
URLs manually always satisfies it. If the agreed result needs a small shared
reference/return interaction, review and add that gap; a whole task or browser
management application is not selected by this need.

## Ordinary closed loop

1. Write/export a chosen URL/title list outside Cairn; review included data.
2. Upload it and related files through existing review and explicit saving.
3. Apply a shared tag. Notes may say “read through item 3.”
4. Confirm saving before manually closing source tabs.
5. Later find the record by name, tag, Notes or indexed text.
6. Inspect only where supported; otherwise download original records/files.
7. Manually copy/open chosen URLs in the browser to resume.
8. Select originals, freeze export and verify SHA-256 and logical length.
9. When needed, recover record bytes through the authenticated reader.

These are prospective acceptance steps, not new tab-app evidence. Record manual
operations, lookup effort, departures from Cairn and actual mistakes. Capture/
close/reopen automation, clickable text previews and an internal editor are
not claimed. Only a demonstrated common friction can justify a small admitted
repair; no entry point is preselected.

## Meaning and retention

| Information | What this recipe preserves |
| --- | --- |
| Record and related originals | Exact readable bytes under current protection/recovery contracts. |
| URL/title/order text | What was written/exported, not webpage history or browser state. |
| Notes and tags | Existing durable clues and owner-selected organization, not a task engine. |
| Dates/location/progress in content | Ordinary statements searchable as text where indexed, not native sorting, calculation or notification. |
| Indexes/caches | Rebuildable projections, not record or recovery authority. |

Short-term means expected use, not automatic expiry. Change a tag or write a
Note to express intent; keep order inside content. No TTL, scheduler, task
lifecycle or GC authority is created. Daily manual food-list use remains a
valid recipe; inventory calculations/reminders are a different capability.

Changed bytes have a new exact identity. Do not assume reupload overwrites or
updates a stable subject. Use a new explicit record or verified revision path
and observe prior records/annotations. No editor, update convention or
universal-record format follows from this recipe.

## Existing boundaries

LinkGroup is a planned safe-relative-path map to stable file links, gated on
core Phase 4/5; it is not an implemented ordered URL group. SavedView dynamically
reevaluates supported conditions, not the chosen reading order. ExportManifest
freezes authorized originals/output policy, not the remote web. One catalog
and repository remain; no task database follows.

Protecting the record does not prove destinations remain available or unchanged.
Manual navigation follows browser authentication/network behavior; the recipe
captures no history, cookies or login session. User-supplied archived HTML/PDF/
screenshots may be ordinary originals; automatic page capture is not implied.
LINK_ONLY has a specific protection contract and is not a label for URL text.

## Remaining goal and necessary gaps

Compare the composed workflow with the agreed resumption result. Keep that
goal open where manual work is unacceptable, then select the smallest common
interaction or capability needed. Capture, native task fields, snapshots and
expiry are separate possibilities, not a default suite. New semantics or
integration requires scope review; it is not automatically excluded. Implement
only admitted gaps and test the goal's actual experience, not just record bytes.

## Reference patterns and limits

Official sources illustrate a need, not a feature checklist:

- [Tablerone saving](https://tabler.one/help-and-support/multiple-ways-to-save-tabs/amp/)
  and [session guide](https://tabler.one/help-and-support/tag/getting-started/)
  document saving and later returning to selected tab sessions.
- [OneTab](https://www.one-tab.com/) documents link lists and restore/export.
- [Tab Stash](https://josh-berry.github.io/tab-stash/) documents bookmark-backed groups.

Sources were read on 2026-10-14; no product trial is claimed. The exact “Later
On” reference remains unidentified. Consultation/repository review supports
a product decision, not independent implementation acceptance.
