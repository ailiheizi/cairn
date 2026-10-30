# Save, Find and Use Convergence Plan

> **For agentic workers:** Use bounded Luna implementation, root decisions and
> review, and one root-owned acceptance journey per complete feature. The
> owner's whole-feature-first rule overrides routine per-edit TDD/suites.

**Goal:** Complete the admitted everyday save-to-use and retrieval handoffs in
existing F01 then F03, without starting future domain or AI infrastructure.

**Architecture:** Existing SourceDrawer and useSources own the upload/review/
explicit-apply flow. Keep one transient browser upload draft/receipt on the
existing sources hook so ordinary files, like pasted text, can resume after a
panel closes. Keep verified saved-file resolution and takeout in the host.
Search continues using the existing broker and scope; F03 starts only after
F01 delivery and a concrete gap review.

**Stack:** Existing React/TypeScript, current typed commands and i18n.
**Spec:** API/WebUI section 2.2; first-party-client-experiences; existing F01
and F03 in the 28-card function plan; owner requested continued delivery.

## Constraints

- Admitted client maintenance alongside Phase 4/5, not core/release completion.
- No schema, endpoint, processor, provider, runtime loader, service or framework.
- Upload/staging is not saving. Only existing digest-bound confirmation applies.
  Unknown apply retains status-check and never offers another apply blindly.
- A late hidden upload result may retain its receipt but never auto-prepare/save.
- Preserve request-scoped accepted subsets, safe relative paths, exact uploaded
  identity, file limits, existing text budget and explicit partial review.
- Pending browser files/receipts are transient, cleared on workspace reset or
  explicit completion/new-batch continuation; they are not recovery authority.

## F01 — resume intake and use confirmed material

**Card:** AIL-38. **Requirement:** API/WebUI 2.2 and existing F01.
**Exit journey:** Folder plus text/material -> upload -> close/reopen review
without another upload -> confirm -> view exact saved batch -> open and take
out matching original; retain cancellation/unconfirmed states in that journey.

**Decision:** Preserve the ordinary upload receipt and retry material in
useSources, rather than add a staging service or persist a new queue. Reuse
existing receipt rows and plan/source binding. An in-flight transfer cannot be
silently dismissed; offer the existing Stop action, then retain its unresolved
outcome and explicit retry. Closing a ready review preserves it. New explicit
server-source work can use its normal plan; reopening Add can still review a
retained receipt explicitly. Saved completion consumes the browser draft only
once its confirmed result is handed off, never merely on close or staging.

- [x] Lift the ordinary upload draft/receipt into existing transient sources
  state, retaining rows, staging directory, error/partial state, selected browser
  files and relative-path mode. Preserve the text-specific draft semantics.
- [x] Resume a matching prepared plan/unknown check on ordinary reopen; otherwise
  show retained accepted rows and an explicit review. Keep transfer Stop and
  an explicit retry of retained files; disclose unknown old receipts honestly.
- [x] Complete confirmed save -> exact batch resolution -> open/use/takeout,
  using existing useLibrary resolver and host actions. Make failures retryable
  without silently replaying upload or plan.apply.
- [x] Integrate, build once needed, run the named whole F01 journey; diagnose
  actual failures only, review, record outcome, commit/push and update AIL-38.

**Implementation boundary:** SourceDrawer.tsx/CSS, useSources.ts, existing
intake i18n modules, and only necessary main.tsx/useLibrary.ts handoff seams.
Preserve other worktree changes. Delegates report conflicts instead of expanding
scope, do not commit and do not run independent test campaigns.

## F03 — actual retrieval and result-use gaps (next, not simultaneous)

- [x] After F01, inspect one known retrieval/use failure and agree the minimal
  reuse seam from the current broker, result scope and matched-source output.
- [x] Prefer directly usable results, on-demand source/context and honest
  model/coverage/empty/error states. Keep real semantic evidence requirements.
- [x] Any cross-background-scope media handoff must be explicit and preserve
  return/query meaning; do not invent another query authority or replace scope
  while merely typing in the floating input.
- [x] Deliver one complete find -> inspect needed context -> use/takeout journey,
  then record only its actual scope and remaining core coverage.


## F01 bounded local delivery — 2026-10-31

Implemented in the existing four client files: ordinary upload rows, staging,
error/partial status, browser File references and relative-path mode now live in
one transient sources draft. Closing/reopening a ready review retains the same
plan; an in-flight transfer must be stopped or reach a receipt before dismissal.
Stopped/unconfirmed transfers retain an explicit retry and file-name disclosure,
without preparing or applying a hidden operation. Confirmed saved-batch handoff
and explicit Continue adding consume the draft; catalog/repository reset
invalidates old receipt callbacks. Existing pasted-text locking remains intact.

The selected F01 journey used a real two-file folder (159 bytes): one intercepted
request was stopped before delivery, browser files survived close/reopen, and an
explicit second request uploaded the folder with safe relative paths. A ready
review reopened with no upload or plan.ingest replay. Exactly one explicit apply
opened the exact two-member just-saved batch. Both receipt identities match the
independent inputs; the 76-byte notes original downloaded through Details matched
its independent SHA-256/length. The driver had an unnecessary hash-route assertion
and an incorrect localized download selector; only read-only download continued,
without repeating the already successful upload/apply.

The same feature's pasted-text continuation saved a literal 67-byte UTF-8 note:
its prepared review closed/reopened after one upload, preserved the literal text,
then one explicit apply opened its saved file and the actual original download
matched the independent text bytes. Evidence: `dist/f01-20261031/` journey,
receipts, plans, downloaded originals and screenshots. Web build and diff check
passed; no backend/model/broad suite ran.

Root reviewed source and outcomes; Luna found no confirmed spec/code blocker.
The epoch concern was adjudicated as intentional old-callback invalidation:
clear/reset schedules a fresh draft render before any next upload, while late
old callbacks are rejected. No new durable semantics or phase/release credit.


## F03 selected implementation — 2026-10-31

**Concrete gap:** a floating query preserves the background scope, so a matching
photo outside that scope currently opens Details instead of its specialist page.
The selected result also offers only one unlabelled snippet.

**Decision:** keep input/query projection side-effect free. A result outside the
background scope visibly says it opens this search's results. On that explicit
activation, run the same query through the existing normal search path, validate
that the exact selected subject/content is still returned before committing its
result scope, and then locate that fresh hit in the existing enabled specialist
page. This is one host-owned scope transition, not another query authority. A
failed/stale response retains the former scope and visible error; merely typing
or seeing results never changes the background. The active query is shown by
ordinary Library/Photos/Music/Videos search context and can be cleared through
its existing control. Saved-list entries have no implied search query.

Reuse existing source-label formatting in a small compiled result-list component:
necessary snippet/type and destination cue first, bounded matched-source details
on demand. No original/body read or model invocation follows from expansion.

**Files:** useSearch.ts (optional pre-commit response acceptance gate), main.tsx
(existing normal-search -> navigation handoff), SpaceAssistant.tsx/CSS and its
compiled result-list helper/i18n. Existing namespaces, annotations and media
budgets stay unchanged. Inspect the already installed local BGE bundle and
existing model readiness/rebuild path; repair only the selected local profile
configuration when needed, not provider internals or unrelated corpus recall.

**Exit:** normal host query with a limited scope -> independent floating query
and its match context -> explicit cross-scope photo/music entry -> current query
label + exact located subject -> existing original takeout. Include stale result
refusal and honest semantic coverage within this same flow; if a real BGE path
is exercised, use the already pinned local bundle and explicit existing rebuild.
No general chat, external AI, new fields or index dimensions are admitted.


## F03 selected local delivery — 2026-10-31

Implemented explicit fresh-query handoff to the existing enabled media page,
subject + content-ID + length acceptance before background mutation, and
workspace/navigation supersession. Returned match context reuses existing source
labels and bounded snippets in a compiled helper with no original reads. The
floating default shows three previews; expansion retains all returned results
and the unselected-list action names the exact regular-file count.

The selected browser journey started with a document-only `suffix:md` host scope,
then found Joel in the independent floating query. It exposed the scope hint and
source evidence without changing the background. A changed second response was
injected only for the refusal case: the former scope remained unchanged. A real
fresh response then entered Photos and focused the exact subject. Its original
JPEG download matched the independent retained 478,185-byte source (SHA-256
`140ec258d58f6742b98bbff457b8b89101c56970b5c11485401ff131698d594d`).
The Music continuation entered and focused lixound from another document-only
scope without autoplay. A disclosure-toggle driver correction resumed only that
read-only tail. No saved content or provider egress was mutated by this journey.

The isolated curated demo had overridden its model path to an empty directory.
Its launch/config now explicitly reuse the already installed pinned local model
root, `/Users/macos/.local/share/cairn/models-zvec-dynamic-candidate-20261015`;
old local configuration was retained under the ignored evidence directory. The
owned demo daemon was restarted at the same port, and one explicit existing
`search.rebuild` produced BGE generation
`idx_55283414096145bb76ee2b7927bc2eb5` (AVAILABLE) and existing CLIP generation
`idx_ae651bcdac61ee30ebb73017f7c5a66a` (READY). No model was downloaded,
new dimension added or historical processor rerun. The real paraphrase
“有湖水和高山的风景” returned SUCCEEDED: lexical 0, BGE 16, CLIP 3; the two
lake landscapes ranked first. This is small-profile development evidence, not
all-corpus recall/field completeness or a default release qualification.

Evidence: `dist/f03-20261031/` actual query/rebuild responses, journey/read-only
continuation, JPEG and screenshots. A driver initially used an unsupported
operator; the UI refused it without executing a query. The supported suffix
operator was then used. Web build and diff check passed. Root and independent
Luna review found no blocking issue; no broader suites were run.

F28 accompanies this feature: bilingual README and English quick-start/list
instructions now describe the actual save -> find -> use -> keep loop. Six
current-build JPEG screenshots were captured through actual UI navigation,
including explicit verified audio/video playback and an unsaved list-title edit;
no second capture or model request was made for that result draft. Root inspected
the Home, search and result images. Existing media credits and model/playback
limits remain. This documentation update grants no additional capability.

The original Linear project and its 28-card document now reflect these outcomes:
F01 Done for browser intake/use, F03 In Progress with this selected handoff
delivered and broader field/recall gaps retained, and F28 Done for the current
documentation version. M2/M3/M10 retain their IDs and explicit remaining limits.
