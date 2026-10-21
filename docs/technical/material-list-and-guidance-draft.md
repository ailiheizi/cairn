# Ordinary Lists and Organizing Instructions

Date: 2026-10-20

Status: **concrete design draft; not an implemented format or implementation admission**

**2026-10-21 follow-up:** The owner has authorized the narrower
[ML-1 ordinary-file client](material-list-client-contract.md), with normative
admission in [First-Party Client Experiences](../requirements/first-party-client-experiences.md#ml-1-ordinary-material-list-snapshots).
It uses explicit result snapshots and frozen Skill text. The current-guide
head, whole-document replacement transaction and automatic refresh discussed
below remain proposals; the first delivery does not claim them.

This refines the owner's selected direction in the
[product-shape discussion](../research/skill-driven-content-substrate-and-qa-20261020.md):
lists are system-readable ordinary material in the existing storage;
people, AI and scripts can update the same list; conversational corrections
end in an ordinary document used by later organization. It does not change
the normative contracts or the [execution plan](core-mvp-execution-plan.md).

## 1. The small contract

Propose three parts in a list's body:

| Part | Meaning |
| --- | --- |
| Format marker | Identifies the understood list format and its version |
| Optional guide reference | The ordinary document selected as this list's organizing instructions |
| Ordered items | References to material, each optionally accompanied by context for this particular list |

An item needs only a material reference and optional context. Its position is
its order; no separate ranking field, membership role or new Tag is required.
Context may contain simple named values such as a display label, a reason or
an excerpt. It is information, not executable instructions.

The list's name, its own identity, source and revision belong to the ordinary
material mechanisms rather than duplicate fields in this body. The exact
integration with those mechanisms is a remaining implementation contract,
not a claim that a mutable structured-document API already exists.

For the first design, one guide is enough. It can contain the agreed purpose,
preferences and important corrections together. Manual lists can omit it.
There is no global instruction hierarchy or separate guide-management system.
Several lists may explicitly refer to the same guide when that is intended.

### Reference meaning

Distinguish the material being referred to from the version actually read:

- The guide reference follows the selected document's current admitted
  revision when a new organization starts.
- The resulting item references resolve to the specific retained versions
  used in that result. Context must not silently move to newly changed bytes.
- The result's ordinary provenance records which guide revision informed it.
  Resolving the guide again later cannot rewrite that historical claim.

Names and source paths are display information, not reference identity.
The concrete wire mapping to existing subject, content and description
identifiers is deliberately not frozen here. A new universal-ID registry is
not proposed. Every format mapping must work after recovery and relocation.

This proposes a fixed result between updates. A later refresh can select newer
material versions. It differs from the planned LinkGroup's live file links;
do not silently reinterpret one as the other.

Repeated references may occur in the ordered items, for example a music
sequence that uses the same recording twice. Position within one list revision
distinguishes those occurrences. Permanent entry identities are unnecessary
for a first whole-document authoring flow.

## 2. Two readable examples using the same shape

The following JSON is **illustrative draft notation**. The `ref:*` values are
paper-example aliases, not real Cairn identifiers. `cairn.list.draft-1` is not
a supported import format, endpoint contract or reserved production ABI.

A music list:

```json
{
  "format": "cairn.list.draft-1",
  "guide": "ref:night-music-instructions",
  "items": [
    {
      "ref": "ref:recording-a-at-selected-version",
      "context": {
        "label": "Recording A",
        "reason": "A gentle opening with piano and soft strings"
      }
    },
    {
      "ref": "ref:recording-b-at-selected-version",
      "context": {
        "label": "Recording B",
        "reason": "A quieter continuation"
      }
    }
  ]
}
```

The associated guide could say: “Make a quiet evening sequence. Soft strings
are welcome; avoid prominent percussion. Do not equate instrumental music
with piano-only music. Keep uncertain recording matches visible.”

A project reading list:

```json
{
  "format": "cairn.list.draft-1",
  "guide": "ref:project-reading-instructions",
  "items": [
    {
      "ref": "ref:conversation-at-selected-version",
      "context": {
        "label": "Scope discussion",
        "reason": "Read the agreed scope before the design proposal",
        "excerpt": "Keep the first delivery focused on finding original material.",
        "location": "The section titled Agreed scope"
      }
    },
    {
      "ref": "ref:design-document-at-selected-version",
      "context": {
        "label": "Design proposal",
        "reason": "Explains how the agreed scope could be implemented"
      }
    }
  ]
}
```

These are invented examples, not claims about actual recordings or project
decisions. A consumer can display the order and provided fields, then resolve
the referenced material. The example `location` is display text, not a claim
of a supported message-addressing or deep-link protocol.

Context is initially a small flat map of simple values, without scripts,
embedded queries or nested object graphs. A consumer uses the fields it
understands. Unknown fields do not grant behavior. No universal application
can infer arbitrary field semantics merely because the data is JSON.

A music adapter still has to supply a supported playlist format and playable
files. A project reader can show excerpts and open the retained source.
Neither needs to invoke AI to rediscover why the list was assembled.

## 3. How the appropriate guide is found

Use explicit association first, with one ordinary entry point:

1. While organizing a list, choose an existing document or save the agreed
   conversational conclusion as a document and associate it with the list.
2. The list shows a compact “Organizing instructions” reference. Opening it
   uses the ordinary document experience.
3. Before refreshing, the organizer resolves that reference's current admitted
   revision, reads its content and retains the revision actually used.
4. Subsequent correction updates the associated document. The next refresh
   reads the revised document and can replace the old list result.

In the proposed interaction, “Save as organizing instructions” during the
list's conversation both saves the document and associates it. Choosing an
existing guide uses ordinary names/previews. The owner does not enter an
internal identifier or complete a second setup wizard. These are proposed
interactions, not current Notes features.

Search may help the owner find a guide. A matching tag, filename, directory
or semantic-search hit does not automatically authorize that document as an
instruction. Ordinary source material remains source material even when it
contains imperative language.

The guide can mention specific items and list-level preferences in normal
language. This does not require a new applicability registry. References used
for reproducible source selection still need the ordinary identity mapping;
a filename mentioned in prose must not silently resolve to the wrong item.

If an associated guide is missing, unreadable or too large for the selected
organizer to consume as required, keep the existing list and explain why the
refresh could not follow its instructions. The owner can reconnect the guide
or explicitly continue under a changed instruction choice. Do not silently
truncate it or substitute a similarly named search result.

If a guide changes while the result is being prepared, report that the result
used an older revision. An automatic update advertised as following current
instructions should not become current without reconciling that change.
An explicitly accepted result based on older instructions must retain that
provenance.

The conversation stays with the chosen AI client. Only the agreed document
needs to enter Cairn; saving the conversation as ordinary content is optional.
Saving a guide does not train the LLM or guarantee that it follows the guide.

## 4. Updating the result

People, scripts, saved-query evaluations and AI clients use the same update
meaning. The first candidate can replace a complete list document; later
editing conveniences need not introduce new list types.

- Resolve the current target list and the applicable guide before preparing
  a replacement.
- Keep the selected guide association unless the owner explicitly changes it;
  a routine refresh should not silently detach its own instructions.
- Validate the candidate's format and reference meanings.
- Commit a complete new current result, or retain the previous result.
  Detect a changed target rather than letting a stale writer overwrite it.
- A fresh authorized regeneration may replace manual item edits. Persistent
  pins, exclusions and per-entry locks are not required.

This preserves inputs, not every output choice. The original material and
the correction document are not erased by replacing the list.

Known missing members remain visible with an unavailable state. Malformed
references cannot become successful lookups. A playback adapter may skip an
unavailable member only while reporting the omission; it must not silently
rewrite list membership. An intentionally empty list is valid, while a failed
refresh must not be represented as a successful empty result.

No scheduler, retry service, AgentRun record or new live metadata database is
needed merely to define these semantics.

## 5. Reuse and gaps that must remain visible

| Existing foundation | Reuse | Still missing for this draft |
| --- | --- | --- |
| Exact content repository | Retain list and guide bytes as ordinary material | Recognition and validation of this format; list-specific reference resolution |
| Subject and content identity | Avoid path-based identity and reuse exact originals | A reviewed mapping for exact item revisions and current guide-document references |
| Description/Notes revisions | Retain source text and corrections; reuse the Notes experience | Ordinary standalone guide/list authoring and association must be reconciled with the actual API |
| SavedView | One possible way to select material for a list | It stores a query, not this program-facing result document |
| ExportManifest | Freeze and verify an actual takeout operation | Existing flat output and snapshot-local handles are not silently upgraded by the draft |
| Planned LinkGroup | Reconsider overlapping organization work before implementing both | Its unordered live path mapping explicitly excludes authoritative group files and has different version semantics |

Code inspection shows `description.create` resolves an existing subject before
creating a description. `description.generate` currently accepts a subject
and generation options, not an associated guide input. Existing provenance
fields likewise do not by themselves establish the input-binding and
current-document-resolution behavior proposed here. See
[description operations](../../server/controlplane/description_ops.go).

The current [content contract](../requirements/content-store-views-and-exports.md)
and [Phase 6 plan](core-mvp-execution-plan.md#10-phase-6-link-groups-export-and-operator-ergonomics)
do not admit this list as an alternative hidden inside LinkGroup. The owner
selected storage reuse, not an unreviewed reinterpretation of existing
recovery records. A later normative change must reconcile these meanings and
any migration before implementation.

## 6. Smallest future user journey

One coherent candidate milestone, subject to that later contract decision:

**Save material and instructions → create a list → consume it without AI →
discuss a correction → save the revised instructions → refresh the same list
→ consume the changed result and take out the intended originals.**

The music and project examples should use the same host format and reference
handling. Different display fields do not justify different storage systems.
The journey must establish that the revised guide was actually read; a changed
list alone is insufficient evidence. A stale update or unavailable guide
should leave the previous result usable.

This is an acceptance outline for future implementation, not a test campaign
performed now. Only document consistency and links were checked for this draft.
The open decisions are the concrete reference encoding, current-document
authoring/resolution, bounded format/read limits and consumer mapping.
They are now narrow contract questions rather than a request for another
general-purpose platform.
