# Single-Guide Reuse and Correction: Design for Review

Date: 2026-10-21. Status: proposed client refinement, for owner review.
Planning and the Linear board are requested; product implementation is not
started by this document. Existing ML-1/ML-2 meanings remain authoritative.

## Intent and baseline

The owner wants the smallest reusable concepts: retain original material and
Notes, organize it with ordinary Skill text, then let people and programs use
a saved list without another AI call. Corrections should accumulate in an
ordinary document, rather than new tag models, instruction types or services.

Current code already provides independent ordinary text saving through Notes
and reviewed intake (`openNotesTextFileComposer` in `web/src/main.tsx`), explicit
loaded `.txt/.md` selection in `MaterialListComposer`, identity-checked guide
reads in `materialListIO.ts`, and JSON/Skill-file capture. Those are existing
capabilities, not features to rebuild. ML-1/ML-2 have bounded local acceptance;
the complete product and release remain unfinished.

## Recommended decision

Keep one guide. The owner merges the useful conclusion of a correction into
that ordinary text and explicitly selects the intended saved file next time.
Editing a selected guide clears the obsolete source reference; the resulting
snapshot retains its complete new text and identity. An old list keeps the
exact guide it used. No implicit latest-file lookup or current head is added.

Three approaches were considered:

| Approach | Effect | Decision |
| --- | --- | --- |
| One ordinary guide containing the agreed corrections | Reuses current text saving, selection and frozen guide | Recommended |
| A second independently bound correction input | Changes the single-guide format and input/size semantics | Outside this refinement |
| A Skill registry, automatic document head or organizer service | Adds another concept and execution/state contract | Outside current scope |

## User flow and actual-gap rule

Save instructions A through Notes' existing text-file action and ordinary
review. Select A while organizing a list, then save list A. Merge the agreed
correction into text B and save it as a new ordinary file. Explicitly select B
for a new list. Reopening A still shows A; the new result shows B. Original
material and its live Notes/Tags are unchanged.

Before any product edit, identify a concrete obstacle in that existing flow:
the exact entry, draft handoff or selection state that prevents completion.
Specify the smallest changed interaction and affected files in WAO-7. If the
existing combination suffices, document it and reuse applicable evidence;
do not invent code, a new library or a new page to fill WAO-8.

Candidate ownership is limited to `NotesSurface.tsx`, `SourceDrawer.tsx`,
`components/material/MaterialListComposer.tsx`, `lib/materialListIO.ts`, and
their shell wiring, translations and guide. This is a maximum boundary, not
an instruction to edit every file. No backend, public command, provider,
schema, signed format or list convention change is proposed.

## Limits and exit

Retain the existing single-guide 64 KiB UTF-8 ceiling, exact SHA-256/length
checks, explicit ordinary capture review, current loaded-scope selection and
visible unavailable states. A failed read or abandoned save must not claim a
saved Skill or silently replace the selected instructions. No second Notes
concept, artificial description copy, AI call, tag mutation or automatic
refresh is introduced.

WAO-7 exits with the owner-reviewed choice and an actual-gap decision. WAO-8
then delivers only that admitted gap, or documents that the existing flow
already satisfies the result. If code changes, the single journey above must
prove frozen A/B text identities and unchanged originals after integration.
Local diagnostics are reserved for actual failures or uncovered trust
invariants; documentation-only delivery runs no application tests.

This design does not admit an AI executor. WAO-9 must separately resolve
authorized body reads, provider location and disclosure, budgets, exact input
bindings, stale/canceled work and candidate confirmation before WAO-10 starts.
