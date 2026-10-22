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

## Use saved lists (ML-2)

The Reader may offer explicit play, append, original ZIP takeout and reviewed
server-directory export by handing a validated document to host-owned actions.
Both the Reader and the host resolve it against the current loaded catalog.
Empty lists or any unresolved occurrence disable whole-list actions. Resolution
does not perform remote or catalog-wide lookup, and never changes saved bytes.

Audio uses existing supported-format and identity/length eligibility. The
supported occurrences retain list order and repetitions in the existing
transient queue; non-audio or unsupported occurrences are counted visibly before
the action. No playable occurrences or a queue-limit refusal leaves the queue
and playback unchanged. Existing 32 MiB per-original verification, native
decoder failure states, single player and 1,000-entry queue ceiling remain.

Takeout projects all resolved occurrences to unique existing file targets,
deduplicating repeated subject or entry handles only for this action. The UI
states how many unique files will be taken out and that repeated targets are
exported once. Different targets are not merged merely by equal byte digests.
The saved occurrence sequence is unchanged; ZIP/export does not promise its
order. Existing ZIP ceilings (32 files, 32 MiB each, 64 MiB total, one transfer)
and frozen-manifest verification remain authoritative. Over-budget ZIP has the
existing single-original or reviewed server-directory alternative. Server
export still requires explicit review and materialization through its existing
workflow; opening it does not write output.

**Exit:** reopen an ordinary saved mixed-content list with ordered repeated
audio, play and append through the actual host queue, observe advancing verified
audio and distinct occurrences, then take out unique originals and independently
compare their bytes. A list with an unresolved member must retain that row and
offer no whole-list mutation. These are client composition results, not a native
playlist, external application adapter, complete media server or phase gate.

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

## Explicit AI candidates (ML-3)

The owner approved the [F12 specification](../superpowers/specs/2026-10-22-material-ai-candidates.md)
on 2026-10-22. It governs one explicit model call over the current ordinary
list, rather than extending ML-1 copy/paste into arbitrary execution.

The client MUST serialize the current document and bind its SHA-256, workspace,
profile and matching grant to the visible disclosure confirmation. Only title,
occurrences/exact refs, labels, existing draft context and one exact Skill are
sent. Human-edited context is a snapshot, not a live-source provenance claim.
No automatic content/EXTRACT/media fetch or hidden query may enlarge it.

The daemon MUST validate every exact ref, including guide.source, and its
current protection policy before sending. Client-side result validation does
not replace that authorization. Use a separately admitted organizer profile,
ORGANIZE purpose and text.material_list class; existing DESCRIBE permissions
never imply authorization. Credentials stay in existing server-side references.
The audit retains bounded metadata/digests, not private prompt/candidate bodies.

An invocation admits at most 32 input and 32 candidate occurrences, 128 KiB
UTF-8 serialized input, 512 KiB final normalized candidate, existing per-field
and 64 KiB Skill bounds, one provider request and 90 seconds. Tighter declared
profile/grant limits win. Refuse rather than truncate; no automatic retry.

A candidate MUST contain only exactly supplied refs. If the model includes a
guide it must match the original; otherwise reattach the original, then check
the normalized size. An empty valid list may be proposed with omissions shown.
Show title/order/context and omission/repetition changes separately. Only
explicit Use candidate in editor replaces the draft, followed by existing
editing/review/capture. The operation MUST NOT write descriptions, source
annotations, lists or membership, apart from the existing egress audit.

The host permits one in-flight organizer call per instance. The client checks
workspace, original context, exact current draft bytes/digest and profile on
arrival and acceptance. Refusal, stale/unknown/cancelled outcome or malformed
candidate leaves the draft unchanged. Abort transport where available and
ignore late results; never promise recall of already sent bytes or zero charge.
No durable candidate, automatic refresh or current head is created. The ML-1
format remains unchanged and usable manually or with external copy/paste.

Exit is the spec's one real-provider journey: disclose → generate → review/edit
→ single confirmed capture → reopen/use exact originals without another model
call. Include applicable invalid/stale/cancel checks in that journey; focused
checks serve only changed trust invariants it cannot prove. No release credit.
