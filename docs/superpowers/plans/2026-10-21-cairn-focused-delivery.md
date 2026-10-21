# Cairn Focused Delivery Implementation Plan

> **For agentic workers:** Use Superpowers' subagent-driven-development or executing-plans workflow only after the applicable written design is reviewed and the scope is admitted. Steps use checkbox syntax. The owner's existing execution choice is preserved: root decides and reviews; Luna implements and owns one shared feature journey. The repository's feature-first Cairn testing instructions override generic test-first or per-slice full-suite steps.

**Goal:** Keep one visible path from ordinary material and Skill instructions
to a reusable list, then an explicitly invoked AI organizer, without drifting
into unrelated platform work.

**Architecture:** Reuse the existing content/Notes/discovery/exact-takeout
kernel and first-party client. Ordinary text and immutable list snapshots
remain the organizing substrate; this plan creates no new operational store.
AI execution is a later design gate, not an already admitted implementation.

**Tech Stack:** Existing React/TypeScript client, Go typed dispatcher and one
configured SQLite catalog/repository. No new framework or dependency selected.

**Spec:** [Single-guide design for review](../specs/2026-10-21-skill-reuse-design.md),
the admitted [ML-1/ML-2 client contract](../../technical/material-list-client-contract.md)
and [core execution order](../../technical/core-mvp-execution-plan.md).

## Global constraints

- This is a dated client delivery plan, not another core phase order. Normative
  contracts and AGENTS.md win; proposed work is not self-authorizing.
- Single owner, one repository and catalog. Exact identity remains the complete
  logical byte stream's SHA-256 plus logical length; default `STORE_EXACT`.
- One guide contains the agreed corrections. No second instruction model,
  implicit latest head, new Skill library, runtime plugin or automatic refresh.
- One complete feature in implementation at a time. Do not split buttons,
  handlers or files into separate acceptance campaigns.
- Implement/integrate first, then one named whole-feature journey. Only actual
  failures or uncovered changed invariants justify local diagnostics. No
  automatic full Go/E2E suite or Linux/NAS campaign for a client change.
- Documentation-only work: review facts/links and `git diff --check`; no build
  or application tests. Completed work needs review and commit/push.

## Current baseline and ordered work

The Linear board is [Cairn](https://linear.app/ailiheizi/project/cairn-15f834de8536).
The [Chinese planning overview](https://linear.app/ailiheizi/document/cairn当前主线下一步与防漂移-todo2026-10-21-1fa39dca65df)
is attached to that project for the owner to read alongside its tasks.
Product progress enters through [Product Experience Todo](../../technical/product-experience-todo.md).
This plan expands those tasks; it is not a parallel queue to choose from.

| Order | Task | State at planning | Usable outcome / exit |
| --- | --- | --- | --- |
| Baseline | [AIL-5](https://linear.app/ailiheizi/issue/AIL-5) ML-1 | Locally delivered | Notes/Skill/context → reviewed ordinary list snapshot → reopen/exact takeout |
| Baseline | [AIL-6](https://linear.app/ailiheizi/issue/AIL-6) ML-2 | Locally delivered | Ordered repeated audio queue and unique-file ZIP/server export handoff |
| **Now** | [AIL-7](https://linear.app/ailiheizi/issue/AIL-7) Skill reuse design | **Todo; only next task** | Owner-reviewed single-guide design and concrete actual-gap decision |
| Next | [AIL-8](https://linear.app/ailiheizi/issue/AIL-8) Reuse refinement | Backlog; blocked by AIL-7 | Corrected ordinary guide explicitly reused; old list remains unchanged |
| Then | [AIL-9](https://linear.app/ailiheizi/issue/AIL-9) AI organizer contract | Backlog; blocked by AIL-8 | Written spec/ADR, necessary admission and bounded implementation plan reviewed |
| After that | [AIL-10](https://linear.app/ailiheizi/issue/AIL-10) AI organizer delivery | Backlog; blocked by AIL-9 | Explicit AI candidate → confirm → ordinary saved list → use without AI |

The two baseline rows are not phase/release completion. Their existing local
reports are recorded in the current ledger; do not rerun them just to plan.
No invented delivery dates are attached to unresolved design gates.

## Review focus

1. Existing text-file saving/guide selection must not be sold or rebuilt as a
   missing feature; AIL-7 separates navigation friction from absent capability.
2. Corrections must actually enter the chosen complete guide text. Merely
   saving a separate document does not make it an organizing input.
3. Reusing B must not rewrite the frozen A instructions or original Notes/Tags;
   AIL-8's journey compares those identities after reopening.
4. Stale workspace/selection, unreadable/oversized input and abandoned review
   must preserve prior usable material. Inspect these paths in the owning
   feature; add local checks only if its whole journey leaves a concrete gap.
5. Current copy/paste includes references, labels and context, not arbitrary
   original bodies. AIL-9 must specify actual authorized inputs and a real
   provider journey, rather than claiming an AI organizer from existing UI.

## Task 1: Finish the reuse decision (AIL-7)

**Files:** Read the spec above; inspect `web/src/main.tsx`,
`components/NotesSurface.tsx`, `components/SourceDrawer.tsx`,
`components/material/MaterialListComposer.tsx` and `lib/materialListIO.ts`.
Write only the spec/this plan/current ledger until scope is reviewed.

- [x] Establish current source baseline `95b5362` and reuse ML-1/ML-2 evidence.
- [x] Record existing standalone text saving and exact guide selection; select
  one ordinary guide with corrections merged into it as the proposed design.
- [ ] Identify the exact remaining entry/draft/selection obstacle, if any;
  explain the minimal change and whether a narrow normative successor is needed.
- [ ] Obtain owner review of the written design before starting AIL-8. A
  planning document or Linear Todo does not itself authorize product scope.

## Task 2: Close only the admitted reuse gap (AIL-8)

**Ownership:** Existing text-file intake and material-list client; no backend
or durable format change. Consume the exact flow/file decision from AIL-7.
Produce ordinary text files and `cairn.material-list.v1`, not new domain types.

- [ ] If the existing combination suffices, improve the usage explanation and
  reference applicable evidence; do not generate speculative product edits.
- [ ] Otherwise implement and integrate the complete minimal interaction
  within the reviewed file boundary, preserving source/draft guards.
- [ ] For the code-change branch, run one journey: save/select A → list A → corrections merged into B →
  reviewed ordinary B capture → new list uses B → reopen A/B and compare exact
  retained guide text → take out unchanged originals. Reuse successful mutations.
- [ ] Root reviews the diff and evidence; update AIL-8/ledger, commit and push.

## Task 3: Specify explicit AI organization (AIL-9)

**Files to inspect:** `server/controlplane/description_ops.go`
(`handleDescriptionGenerate`), `server/controlplane/online_provider_ops.go`,
`server/internal/search/describe_provider_registry.go`,
`web/src/lib/materialList.ts`, and
`docs/requirements/driver-and-processor-interfaces.md` for provider/egress rules.
This is a design task: no endpoint or AI runner edits.

- [ ] State exactly what material bodies/Notes and guide are read, why they
  are authorized, and which complete versions bind the candidate.
- [ ] Decide invocation location/provider reuse and explicit disclosure,
  credentials, byte/time/cost ceilings, cancellation and stale-input handling.
- [ ] Define candidate-only output, supplied-reference validation and manual
  confirmation through existing capture; retain the prior list on failure.
- [ ] Write/review the spec, ADR, necessary admission and concrete file/API
  implementation plan. Do not reinterpret `description.generate` as a generic
  list organizer just because a model profile exists.

## Task 4: Deliver the approved AI loop (AIL-10)

This task remains blocked until Task 3 supplies its actual contracts and file
boundaries. No speculative function signatures, schema or provider is selected
in this roadmap, and it is not an executable AI implementation plan.

- [ ] Implement the approved complete client/server loop using the selected
  existing capabilities; report any contract conflict before expanding scope.
- [ ] One real-provider journey: select authorized material/guide → explicit
  invocation → review/adjust valid candidate → confirm/save → reopen without AI
  → consume/take out exact originals. Include refusal/cancel/stale behavior in
  that journey where practical; fixtures cannot prove model delivery.
- [ ] Root reviews; record limitations and evidence, commit/push, then Done.

## Drift prevention and later work

Before any resumed execution, open the current Linear task and read its
matching contract. State the task ID, one user result, allowed files and the
single exit journey. If a proposed action does not serve that result or an
actual failed trust boundary, leave it out. Do not start another task merely
because the current one is hard or waiting for design review.

Keep core Phase 4/5/6/7 qualification obligations visible in their existing
execution plan. Do not turn this roadmap into a Linux test project, release
claim, LinkGroup admission, media gateway, home/IoT application, plugin store,
multi-tenant product or an automatic AI scheduler. Existing Photos/Music
polish stays recorded as paused; it is not silently completed or restarted.

After the current full feature is accepted, root updates the same ledger and
Linear task together, reports the usable outcome and names the next task.
Do not create another competing plan on each continuation. Material changes
to the selected direction must be explained in these existing records first.
