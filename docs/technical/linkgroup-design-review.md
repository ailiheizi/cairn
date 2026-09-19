# LinkGroup Design Review

> Status: informative planning record (documentation authority rank 7). This
> review adds no MVP scope, closes no gate, and cannot reorder the core plan.
> It exists so that when the Phase 4 and Phase 5 gates close, the Phase 6
> LinkGroup slice can be specified without re-research. It was produced by a
> read-only review of the frozen documents on 2026-09-19.

## 1. The frozen contract

Every fact below is already decided; implementation cannot reopen it.

| Fact | Frozen wording | Source |
| --- | --- | --- |
| Group subject + current map | "one stable group subject plus one current map from safe group-relative paths to stable file links" | AGENTS.md:75; content-store:120, 468-471 |
| No versions | "no group version number, revision object, predecessor/successor chain, member role, user ordering, or independent history" | content-store:474-476; AGENTS.md:77-78 |
| File members only | "The initial profile has file members only: no nested groups, roles, dependency graph, or automatic AI grouping." | AGENTS.md:81-82; content-store:516-517 |
| Membership is not ownership | "Membership is not ownership and never authorizes byte deletion." / "A group never owns a member or changes its protection state." | AGENTS.md:80; content-store:502-503 |
| Missing member visibility | "the link remains in the group with an explicit `MISSING`/`UNAVAILABLE` state; it MUST NOT silently disappear" | content-store:483-485 |
| Empty group persistence | "an empty group remains until explicitly deleted" | AGENTS.md:80-81; content-store:487-488 |
| Subject-mechanism reuse | "Group descriptions, tags, notes, search, and export reuse the existing subject mechanisms." | AGENTS.md:78-79; content-store:505-507 |
| ExportManifest freezes versions | "When a fixed point in time is needed, `ExportManifest` freezes the selected file versions separately." Freezing "MUST resolve every current file link and copy the resolved stable subject, exact file version, source snapshot, selected representation, and safe relative path" | AGENTS.md:78; content-store:530-532 |
| Path rules | paths "MUST be relative, traversal-safe, and unique under the group-path canonicalization profile"; and "are presentation and materialization inputs, not subject or byte identity" | content-store:494-497 |
| Link is a subject reference | "The link identifies the stable file subject; it does not pin a `FileVersionId`, `SnapshotId`, content digest, or representation." | content-store:480-482 |
| Phase 6 gating | "This documentation decision does not authorize LinkGroup schema or API implementation before the Phase 4 and Phase 5 gates close." | AGENTS.md:157-158; exec-plan:92 |

## 2. The named gaps (verbatim)

The docs name the missing artifacts in one sentence, twice:

- content-store:812 — "no catalog schema, public operation, subject-kind/search
  authorization, group-aware export successor, browser workflow, portable
  current-state record, or executable acceptance evidence exists yet".
- exec-plan:92 — "Minimal LinkGroup is documented but has no schema,
  operation, subject-kind/search authorization, group-aware export successor,
  browser flow, portable current-state record, or executable evidence".

Two further obligations are already stated:

- the export successor "MUST introduce and migrate to a versioned successor
  that binds those resolved values and a traversal-safe output path"
  (content-store:538-540);
- until the portable record, reader, migration, and round-trip evidence exist,
  "the capability status is `planned`, not implemented" (content-store:546-548).

## 3. Design questions, with the blocked options named

Each question gives two candidate answers. Where a candidate contradicts a
frozen fact it is marked **blocked** and the other is the working choice.

1. **How do group-relative paths stay safe and unique?**
   (a) Canonicalize on every add/rename under one group-path canonicalization
   profile. (b) Store as supplied and resolve collisions at materialization.
   Trade-off: (a) applies policy at write time and keeps the map unambiguous;
   (b) defers the decision but still owes the mandated target-specific
   collision recheck (content-store:497-499). Neither is blocked; uniqueness
   cannot be keyed to byte identity, because paths are "presentation and
   materialization inputs, not subject or byte identity" (content-store:494-495).

2. **How does the current map update with no version chain yet still survive
   snapshot semantics?**
   (a) Atomic whole-mapping replacement in the catalog with a
   catalog-internal concurrency marker. (b) Per-change durable generations.
   **(b) is blocked**: a change chain would be exactly the "independent
   history" the contract forbids (content-store:474-476). Snapshot semantics
   therefore come from freezing an ExportManifest, never from the group.

3. **How does an ExportManifest freeze members without making the group
   versioned?**
   (a) Resolve at freeze time into a versioned successor manifest that copies
   subject, file version, snapshot, representation, and safe relative path.
   (b) Pin a `FileVersionId` on the live link. **(b) is blocked**:
   content-store:480-482. Use (a).

4. **How does a missing member stay visible through export and restore?**
   (a) The manifest carries an explicit unavailable entry and refuses a
   complete claim for it. (b) Omit it with a warning. **(b) is blocked**: "it
   is never silently omitted" (content-store:532-533) and it "MUST NOT
   silently disappear" (content-store:484-485). The portable record must
   "resolve each member through its existing recovery references"
   (content-store:546-547).

5. **Which searches does a group subject join, and what authorizes that?**
   (a) Phase 6 extends "the host-owned subject registry, authorization, and
   replayable feed" so existing providers index group facts "without a new
   index dimension" (content-store:506-509). (b) A dedicated group index or
   semantic membership. **(b) is blocked** by the no-new-dimension lock
   (AGENTS.md:169-170) and by "Embeddings, model output, and similarity MUST
   NOT add or remove members" (content-store:509-510). Use (a); the
   subject-kind authorization it needs is itself one of the named gaps.

## 4. Proposed implementation order (a proposal; the Phase 6 slice specs must
re-confirm it after the gates close)

| # | Step | Exit test (from exec-plan:429-432, 456 unless noted) |
| --- | --- | --- |
| 1 | Catalog schema: group subject + keyed current mapping | "One explicit directory builds one current file-only LinkGroup mapping with complete accounting and preserved safe relative paths; a later rescan or edit atomically replaces that current mapping without creating group history." |
| 2 | Typed operations: create / add / remove / rename / delete | The same file in two groups leaves "exact placement and deduplication unchanged", and no protection or GC state changes. |
| 3 | Search authorization | The group is found by its description, tag, or note through the existing fused broker — no new dimension, no semantic membership. |
| 4 | Export successor | A versioned manifest binds the resolved values; "later file or group changes cannot change that manifest". |
| 5 | Browser workflow | The ordinary loop runs end to end: "LinkGroup or saved view -> frozen manifest -> materialize/verify -> clean restore". |
| 6 | Portable current-state record | A clean host rebuilds the group catalogue-free; "missing members remain visible as unavailable, an empty group remains until explicit deletion", and a round trip passes. |

## 5. Explicitly out (unchanged locks)

Nested groups, member roles, dependency graphs, user ordering, automatic or
AI grouping, ratings, richer Collections, and any group-owned protection or
deletion authority. A group is organization, never ownership.

## 6. Status

| Part | Status |
| --- | --- |
| Contract and boundaries | Frozen in the normative docs |
| Schema, operations, authorization, export successor, browser flow, portable record | **Not designed yet** (named as gaps, content-store:812) |
| Implementation | **Blocked** by the Phase 4 and Phase 5 gates (AGENTS.md:157-158) |
| This review | Design questions and a proposed order, ready for the Phase 6 slice specs |
