# Floating retrieval and usable results implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the shared batch. The owner's whole-feature-first testing order overrides per-edit test cycles.

**Goal:** Find saved material without replacing Home, expand a usable ordinary list, adjust/play/take out, review its save and reopen it from Library.

**Architecture:** One host-owned search implementation supplies both normal Library search and a result-only floating projection. Existing ordinary-list I/O, validated playback/takeout, ML-3 organizer and reviewed intake remain authoritative. The assistant keeps transient UI state only; no general conversation runner or automatic refresh is introduced.

**Tech stack:** Existing React/TypeScript, Lucide, CSS tokens, typed command host.

**Spec:** ../specs/2026-10-30-input-first-private-space.md; owner approved the result-to-use prototype on 2026-10-30.

## Constraints and review focus

- Admitted first-party UX alongside Phase 4/5; ML-1/2/3 and coherent-content-space requirements apply. No phase/release credit.
- No endpoint, provider, schema, runtime plugin or calendar integration. Search is real search; model organization remains explicit via the existing Skill/candidate flow.
- Retain Home layout, browse scope, drafts and independent playback across floating/expanded states. Workspace changes invalidate temporary references.
- Stale/missing list members disable whole-list actions; exact identity and all existing media budgets remain enforced by the host.
- Saving opens existing reviewed capture. Retained results are ordinary list files; revisions are new captures.

## Shared delivery tasks

- [x] Add a result-only callback to existing search, preserving normal search behavior and degradation reporting.
- [x] Implement a floating input/results surface and expanded work surface, explicit text/file save handoff and transient draft continuity.
- [x] Implement a reusable spacious material result, with bounded existing actions and on-demand editing/context. Link editor preview and Library reopening.
- [x] Build, then run one whole-feature journey: real retrieval -> ordinary list -> reorder/remove -> verified playback or ZIP takeout -> reviewed save -> reopen list -> use again. Include empty/error and draft continuity. Run local diagnosis only if the journey finds a failure.

No app tests are triggered by the documentation changes alone. Root owns integration, review and the one journey.

## Local delivery evidence — 2026-10-30

The integrated client was built with `npm run build --prefix web` and served by
its existing isolated curated-media daemon at `http://127.0.0.1:4670/`.
The named `floating-results` journey retrieved actual catalog material, selected
three audio files, reordered and removed one, and handed the two-item result to
the existing verified player (decoded duration visible). The same result went
through ordinary upload/plan review and confirmed capture, then was found and
reopened with its exact title, order and members intact. ZIP takeout contained
both expected originals; independent SHA-256 and length comparison against the
saved references passed. Empty retrieval, transient draft expansion/return,
blank-title editing and modal focus were checked in this same batch. The
interrupted save driver was resumed from its already uploaded staging directory;
no second upload or blind replay of a successful capture was used.

The existing host profile reports partial search coverage; the floating client
keeps that status visible without moving Home. This is not evidence of a fully
qualified semantic default or general AI chat. ML-3 model execution is reused
unchanged; this batch does not claim a new provider or model capability.

Owner visual follow-up: match the accepted neutral/violet-metal demo in both
appearances. Shared content tokens, full-image Home photo, quiet music card,
metal controls and spacious list result were refined. Header links replace the
duplicate input-looking trigger; advanced Library search remains in its menu.
Home -> Library -> Home and saved-list opening passed in dark and light modes,
with no browser exceptions. The final screenshots are local developer artifacts
`dist/floating-final-home-{dark,light}.png` and
`dist/floating-final-result-{dark,light}.png`.

`git diff --check` passed. The global translation checker stops on a pre-existing
`Shuffle selected ({{count}})` duplicate in `musicDaily.ts` and
`musicExperience.ts`, verified in HEAD. This batch's new keys are unique. No
unrelated backend or broad regression suite was run; no release gate is closed.
