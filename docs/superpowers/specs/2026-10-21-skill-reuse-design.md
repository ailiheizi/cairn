# Single-Guide Reuse and Correction

Date: 2026-10-21; bounded execution decision updated 2026-10-22 after the
owner requested the next delivery. The existing ML-1 client is the admitted
boundary; this document alone adds no scope. Acceptance is recorded in F11
and the product experience ledger. Existing ML-1/ML-2 meanings remain authoritative.

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
review, or reuse an already saved ordinary guide. Select A while organizing a
list, then save list A. For the next material set, choose A and merge the
agreed correction into the current Skill fields. Existing reviewed capture
saves both list B and an ordinary Skill B; a separate preparatory B-save step
is unnecessary. Later explicitly select saved B for another list. Reopening
list A still shows A; list B shows B. Original material and live Notes/Tags
remain unchanged. Standalone text saving remains an available alternative.

The 2026-10-22 source audit found one bounded handoff defect: the file selector
used an uncontrolled `defaultValue`. Editing cleared `guideSource` but left A
visibly selected, preventing another explicit choice of the same A from firing
`change`. The refinement derives the selected option from the successfully
verified source's current candidate identity. Editing clears that option;
selecting A again reads it normally. A failed read retains the earlier valid
draft and its verified source, while Retry still targets the failed attempt.
The selector is presentation state, not another source authority. The feature
also supplies two plain-text examples through the existing user guide.

Before any product edit, identify a concrete obstacle in that existing flow:
the exact entry, draft handoff or selection state that prevents completion.
Specify the smallest changed interaction and affected files in the design
checklist of F11/AIL-8 (the former AIL-7 record is merged there). If the
existing combination suffices, document it and reuse applicable evidence;
do not invent code, a new library or a new page to fill AIL-8.

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

F11/AIL-8 first records the reviewed choice and an actual-gap decision inside
the same feature card, then delivers only that admitted gap or documents that
the existing flow
already satisfies the result. If code changes, the single journey above must
prove frozen A/B text identities and unchanged originals after integration.
Local diagnostics are reserved for actual failures or uncovered trust
invariants; documentation-only delivery runs no application tests.

This design does not admit an AI executor. F12/AIL-10 must first resolve
authorized body reads, provider location and disclosure, budgets, exact input
bindings, stale/canceled work and candidate confirmation in its own design
checklist. The former AIL-9 record is merged into that function; necessary
review/admission remains required before executor implementation.

## Local delivery — 2026-10-22

The bounded F11 refinement passed its whole-feature journey: one reviewed
list/Skill B capture, exact old/new guide identities on reopening, explicit B
selection in a later unsaved draft, and unchanged originals/Notes/Tags. The
selector correction and ordinary examples were reviewed. See the
[delivery ledger](../../technical/product-experience-todo.md#f11-skill-correction-and-reuse-2026-10-22)
for current build/evidence and retained limits. This result admits no AI runner
or automatic refresh and grants no core phase or release credit.
