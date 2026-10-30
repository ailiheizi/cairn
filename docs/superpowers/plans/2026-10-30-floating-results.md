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


## Owner follow-up: quiet input and direct media entry

This same admitted client batch now refines the host-owned focus/navigation flow:
keep only maximize on the floating header, collapse on outside pointer action
while retaining draft/results, and move the textarea focus indicator to the
rounded assistant edge. Home media and ordinary Library/assistant media entry
open their existing enabled destination with the exact loaded subject as a
transient focus hint. The target is revealed despite stale local page filters;
explicit Details and playback actions keep their existing meanings. A search
result outside the host scope keeps the existing Details fallback rather than
opening a page that cannot locate it or changing the host query. No new read,
endpoint, durable state or playback-on-entry is admitted.

Acceptance is one `home-media-entry` journey: focus/type/collapse/reopen/expand the
same draft, then enter the displayed photo, music and video destinations and
observe the clicked subject in view without a Details modal or autoplay. Existing
whole-feature save/takeout evidence above remains applicable.


**Implemented evidence (2026-10-30):** `npm run build --prefix web` and the
selected `home-media-entry` browser journey passed on the existing isolated
curated-media instance at port 4670. The draft survives outside dismissal and
maximize/return; the textarea has no inner focus rectangle. Home Photos, Music
and Videos reveal and focus the exact loaded item without a Details modal or
autoplay. Selecting a search result while already in Photos/Music also locates
it, including repeated selection of the same photo; stale Music-local filters
are reset, and an explicitly focused photo Favorite
control retains focus. The transition preserves the destination's item focus.
The browser reported no page exceptions. This refinement writes no catalog or
media state; earlier list-save and exact-original ZIP evidence is reused.

The out-of-host-scope fallback was also exercised: keep a `credits` Library
search active, find `Joel` in the floating layer, open its existing Details,
and retain the `credits` host query. An incorrect driver wait for Library rows
inside a filtered Videos presentation was removed; only this fallback segment
was resumed. The preceding Home/media steps had already passed unchanged.
A read-only Luna diff review found no blocking issue; the coordinator additionally
bounded media navigation to host-scope members to avoid an absent locate target.


## Product convergence follow-up — 2026-10-30

The owner requested continued product polish and synchronization of the existing
Linear project/milestones with the confirmed AI personal-content-space direction.
Keep all 28 functional card identities. Current frontend delivery remains F02:
Home content stays in place, floating retrieval is secondary, useful results use
ordinary lists, and specialist content opens in its existing destination.

- [x] Polish the existing assistant's complete return/open flow: Escape dismisses
  a local menu first, then a floating panel, while retaining draft/material;
  explicit full-workspace return resumes the composer. Opening material from an
  expanded result must not restore focus over the destination's located item.
  Hide the full-header result action when no reusable result exists.
- [x] Integrate and run one existing-environment browser journey: Home -> draft
  -> floating/expanded retrieval -> specialist media entry -> return -> Escape
  and reopen; retain draft and search, observe destination focus, no new reads
  or automatic playback from navigation. Root owns acceptance and review.
- [x] Synchronize project definition, existing M1–M10 milestone descriptions,
  the existing functional document and affected F cards. Keep remaining work
  explicit, only one feature in implementation, and future ideas out of active
  scope. Review documentation and read back changed Linear records; no app
  test is justified by the planning edits themselves.

**Allowed implementation:** `web/src/components/SpaceAssistant.tsx` and its CSS
only, reusing existing host actions and strings. No new endpoint, schema, model
runner, provider, processor, runtime loader or package. The client refinement
runs alongside Phase 4/5, grants no core/release completion and preserves the
existing first-party client/ML contracts and media budgets.


**Bounded follow-up delivered locally:** the affected Web build and selected
`product-convergence` browser journey passed on the existing port-4670 profile.
An in-memory attachment and draft survive menu-first Escape, floating collapse,
full return and reopening. Explicit Return restores composer focus, while opening
Joel from expanded retrieval keeps Photos' located-card focus. Opening a member
of the existing saved result keeps the exact Music-row focus without autoplay;
closing that result resumes the composer. No browser exception occurred. No
capture, export or provider request was replayed; the old original-byte evidence
remains applicable. A stale translated test selector was corrected, and an actual
FileList lifetime defect was repaired by copying files before resetting the input
or deferring the React update. Dropped files use the same synchronous snapshot.

Root reviewed the diff and screenshots; independent Luna review found no blocking
spec or quality issue. `git diff --check` passed. No backend, model or broad
regression campaign was run. This remains a client development delivery, not a
core-phase or release qualification.

The same ailiheizi Linear project was synchronized in place: project definition,
all ten existing milestone descriptions, the complete 28-card document and 16
affected issue descriptions/states. No new issue or milestone was created. F02's
bounded baseline is Done; F01 then F03 are ordered Todo, and F28 retains its
remaining current README/Wiki/walkthrough work. Existing theme percentages do not
mean every future capability has shipped. The service's optional shared-context
helper was unavailable, so verified repository sources and existing project/cards
were used instead. Readback confirmed the correct organization, new direction,
28 F headings, and removal of the old unimplemented-video claim.
