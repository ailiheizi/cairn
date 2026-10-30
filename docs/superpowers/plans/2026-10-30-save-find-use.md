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

- [ ] After F01, inspect one known retrieval/use failure and agree the minimal
  reuse seam from the current broker, result scope and matched-source output.
- [ ] Prefer directly usable results, on-demand source/context and honest
  model/coverage/empty/error states. Keep real semantic evidence requirements.
- [ ] Any cross-background-scope media handoff must be explicit and preserve
  return/query meaning; do not invent another query authority or replace scope
  while merely typing in the floating input.
- [ ] Deliver one complete find -> inspect needed context -> use/takeout journey,
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
