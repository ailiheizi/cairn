# F13 Ordinary List Consumer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. The owner requests Luna implementation, root decisions, whole-feature delivery before testing, and continued commit/push.

**Goal:** A small program can consume a saved list without AI, preserve its order, repeated occurrences and context, and identify which explicitly supplied originals match.

**Architecture:** Read the existing ordinary `cairn.material-list.v1` file with Python's standard library. Optional explicitly supplied local files are matched by complete SHA-256 and logical length. Output is a transient JSON report, not a new saved format, catalog or resolution authority.

**Tech Stack:** Python 3 standard library; existing exported list and original files.

**Spec:** [F13](2026-10-21-cairn-focused-delivery.md#f13) and [ML-1/ML-2 contract](../../technical/material-list-client-contract.md).

## Decision and admission

The owner requested continued delivery after F12. F13 already selects a format-documentation and standalone-example scope. A file-only example is sufficient; a host-connected SDK or new API adds authorization and lifecycle work with no demonstrated need. The example therefore reads only paths explicitly supplied by the caller, never a label, local hint or Skill instruction. This is a runnable documentation example, not new Cairn CLI/MCP integration.

**Phase / requirement / exit:** admitted RW-PERSONAL-UX-1 ML-1/ML-2 client track alongside Phase 4/5 / ordinary results remain usable by a non-AI program / read the previously saved F12 result and taken-out originals, then demonstrate repeated, absent and mismatched occurrences while preserving exact order/context/Skill and all input bytes. No model call, daemon mutation or core-phase completion.

## Global Constraints

- Read AGENTS.md before work; preserve unrelated changes. Cairn is a single-person content/Notes/discovery/export/recovery plane. Converge the admitted loop and first-party clients rather than add surfaces.
- Add no endpoint, core CLI command, provider, durable schema, processor, runtime loader, SDK, daemon client, network request or test framework.
- The format remains `cairn.material-list.v1`: 200 occurrences, 512 KiB UTF-8 JSON, 64 KiB guide, 160 title characters, 512 label characters, 32 context keys, 16 KiB UTF-8 per context value. Reuse exact digest/length and embedded-guide validation.
- `entry_id` and `subject_ref` are host-local hints; this offline example cannot resolve or authorize them. Matching supplied exported bytes does not recreate subject identity, server availability or a signed recovery proof.
- Preserve order, repetitions, refs, labels, context and exact guide. Unavailable occurrences remain visible. Refuse malformed or over-budget input; never truncate or execute content.
- One acceptance owner, one whole-feature journey after integration. No broad application builds/tests or additional model calls. Delegates report conflicts instead of broadening scope; do not commit or spawn helpers.

## Review focus

Repeated references must not collapse; same-name wrong bytes must not match; local hints must not trigger lookup; missing supplied files must not remove occurrences; invalid/over-budget lists or mismatched embedded guides must be refused. These are covered together in the selected offline consumer journey, using retained real exports plus clearly labelled local variants.

### Task 1: Deliver the standalone consumer and usage

**Files:** create `examples/material-list/read_list.py` and `examples/material-list/README.md`; update `docs/wiki/material-lists.md` program-reader section. Root owns plan, roadmap/feature status and Linear.

**Interface:** `python3 examples/material-list/read_list.py LIST [--original FILE ...]`. JSON stdout contains the unchanged parsed list as `document`, ordered `occurrences` with 1-based position, original item fields and `AVAILABLE`/`UNAVAILABLE`, and explicit local-read diagnostics if needed. Available rows identify the supplied matching path. Availability means only digest/length verified at read time among supplied files. Valid reports exit 0 even if some rows are unavailable; invalid list/usage exits 2 with stderr and no partial stdout. No implicit directory scan or outputs written by the script.

- [x] Implement a small dependency-free reader/validator and streamed hashing of explicitly supplied regular originals; output honest per-occurrence results.
- [x] Document ordinary exported-list and optional original-file use, example output, exit statuses, and the difference between offline bytes and host-local authorization. Link the runnable example from the Wiki.
- [x] Self-review against the existing parser/contract; root reads the diff and a separate Luna checks spec and quality.
- [x] Acceptance owner runs one combined offline journey on retained F12 saved list/original export bytes, controlled repeated/missing/wrong-byte variants, and malformed guide/over-budget refusal. Record input hashes before/after and observed output; fix only observed failures.
- [x] Root updates F13 delivery evidence and Linear, runs diff check, commits, integrates and pushes the accepted batch.

**Acceptance evidence (2026-10-23):** primary-checkout
`dist/material-list-consumer-20261023/journey-result.json` records the exact
consumer argv, outputs and unchanged before/after hashes. The 1,947-byte list
matches prior real saved-content readback. Whole-flow output preserved B → A,
context and exact Skill; local variants preserved B → A → B and visible missing
or mismatched originals. Reviewed parser corrections passed in the same run.
Script SHA-256: `056e3fe623919698d2cb033cfd382f45af1a3c1b2fb0d16881bad7833d4177dd`.
No model call, new capture/export or broad application tests were needed.

**Integration:** implementation commit `a560d1f` is merged and pushed to
`main`; AIL-35 is Done and the existing Chinese functional overview reflects
the delivered scope. Root independently checked retained consumer output
against saved-list content and original hashes. The completion record itself
is documentation-only and does not require another application journey.
