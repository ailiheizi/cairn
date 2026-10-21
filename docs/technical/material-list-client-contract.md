# Ordinary Material Lists: First Client Delivery

Date: 2026-10-21. Status: owner-authorized implementation contract for ML-1.
The owner explicitly requested this delivery after the material/list discussion.
This narrows the earlier design draft; it does not implement its entire future
refresh model or change the core phase gates.

## One user journey

Select saved files, copy their live user-authored NOTE annotations and TAGs as
context, supply or read one
ordinary Skill text, arrange a result manually or copy it to an external AI and
import the returned result, review and save through ordinary intake, reopen the
saved result, and retrieve its exact originals without another AI call.

This is a first-party client interpretation of ordinary files. There is no list
table, new subject kind, mutable list head, background organizer, plugin runtime,
provider or endpoint. List results are explicit immutable snapshots; editing
creates another ordinary file capture and preserves the earlier result. The
client must not advertise that as updating one persistent current-list head.
Existing Notes, SavedView, LinkGroup and ExportManifest meanings are unchanged.

## Small content format

`cairn.material-list.v1` is a JSON content convention, not a signed recovery
record or a new kernel membership authority. The browser writes filenames ending
in `.cairn-list.json`. Recognition still requires validating the actual body.

The body contains `format`, `title`, optional `guide`, and ordered `items`.
Each item contains `ref`, a display `label`, and optional `context`: a flat map
of strings such as `notes`, `tags` and `reason`. Array position distinguishes
repeated occurrences. An intentionally empty result is valid.

A `ref` contains a complete SHA-256 `content_id` and nonnegative safe-integer
`logical_size`. Optional `entry_id` and `subject_ref` are local lookup hints;
they never override digest and length. Labels and source names are display
information. No URL, filesystem path or executable expression is followed.

The guide contains `name`, the complete UTF-8 `body`, its `content_id` and
`logical_size`, and an optional exact `source` ref when read from a saved file.
Its embedded text freezes the instructions actually copied for organization.
Its digest/length must match that text, and any source must match the same
identity. Saving also retains that text as an ordinary `.skill.txt` file; exact
deduplication is unchanged. Editing instructions clears an obsolete source ref.
This is a snapshot of instructions, not a claim to follow their future head.

Limits: 200 item occurrences, 512 KiB UTF-8 JSON, 64 KiB guide text, 160 title
characters, 512 label characters, and at most 32 context keys with at most
16 KiB of UTF-8 text per value. Refuse over-budget or invalid data explicitly;
do not silently truncate source Notes, instructions or results. Abort stale
reads on subject/workspace change (discard stale command responses when the
existing transport cannot cancel them). File and guide reads are explicit, bounded,
and verify the complete digest and length using existing original reads.

## Trust and updates

The list editor may arrange, repeat or remove occurrences and edit context.
Tags mentioned in a list remain context, not changes to human Tags. Original
files and their Notes are unchanged.

The external-AI handoff is explicit copy and paste. The prompt separates the
chosen instructions from source evidence. Imported results are data: validate
them before replacing the draft, retain the chosen guide, and admit only exact
refs already in the draft. A failed import leaves the previous draft intact.
There is no implicit model call, credential lookup, disclosure, file fetch or
execution. Manual and externally organized results use the same format.

The reader resolves against the host's loaded content listing by exact digest
and length, preferring a matching local hint. Unresolved rows stay visible and
say they are unavailable in the loaded scope; this is not a catalog-wide
missing-content claim. Only resolved originals have takeout actions. Existing
original-download verification remains authoritative. The reader never rewrites
membership when a member cannot be resolved. The whole JSON result remains
usable by an ordinary program without AI.

Saving hands generated files to the existing upload, plan review and explicit
digest-bound apply workflow. Preparing a file or uploading it is not saving.
Unknown or failed outcomes remain owned by that existing intake flow. No new
writer, recovery format, publication mechanism or data store is introduced.

## Acceptance and remaining scope

One current-build journey must save source files and a Note, create and arrange
a list with instructions, reject an invalid imported result without changing
the draft, save it through reviewed intake, reload, reopen the list, verify its
guide and order/context, and compare taken-out originals with independent source
bytes. It must also keep an unresolved member visible and refuse malformed or
oversized bodies. The external-AI handoff can be checked with a caller-supplied
candidate; that is not evidence of model quality or an integrated LLM provider.

Automatic refresh, persistent current-list heads, conversation execution,
guided `description.generate`, remote-AI configuration, application adapters,
and catalog-free semantic resolution remain separately reviewed work. This
delivery does not close Phase 4, 5, 6, recovery or release qualification.
