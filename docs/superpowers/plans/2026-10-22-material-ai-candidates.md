# Material AI Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Organize an explicitly reviewed ordinary material draft with one real model request, review the candidate, then save and use it through existing capture.

**Architecture:** One narrow typed host operation and immutable organizer profile reuse existing egress/protection/credential/audit mechanisms. The Web editor keeps a transient candidate separate until explicit use; stored results remain ordinary ML-1 content. Backend and client integrate against the contract below.

**Tech Stack:** Existing Go dispatcher/search/config; React/TypeScript; existing browser journey harness.

**Spec:** [Approved F12 specification](../specs/2026-10-22-material-ai-candidates.md).

## Global Constraints

- Active track: ML-3 / F12; no core phase or release completion.
- One owner, one repository/catalog; SHA-256 plus logical length identity unchanged.
- Exactly current draft/Skill/context; no hidden body reads or tools.
- 32 occurrences; 128 KiB UTF-8 input; 512 KiB final candidate; existing 64 KiB Skill; at most one request and 90 seconds. Stricter profile/grant bounds win.
- One in-flight organizer per instance; no automatic retry, refresh, tag mutation or save.
- `ORGANIZE` / `text.material_list` authorization cannot reuse DESCRIBE grants.
- Complete integrated feature first; one journey owned by Luna QA. No per-task suite or broad regression. Root owns integration build, review and commit/push.

## Review Focus

- Supplied guide source must pass protection alongside all item refs, before egress.
- Exact refs/local hints and Skill must survive candidate validation; valid empty lists show omissions.
- Workspace/draft/profile changes or cancellation must prevent late candidate use without mutating the editor.
- Missing configuration/credentials, revoked grants and unknown outcomes remain unavailable with the existing draft intact.
- Absent organizer configuration must preserve old configuration serialization/digests and exact-capture availability.

## Shared interfaces

`material.organize` request: `{workspace_id, document_json, base_digest, egress_confirmation:{profile_id,profile_digest,endpoint_host,model,purpose:"ORGANIZE",grant_id}}`.
Success data: `{candidate_json,base_digest,profile_id,profile_digest}`.
`base_digest` is `sha256:` plus lowercase SHA-256 of exact serializer UTF-8.

`semantic.provider.list({include_organize:true})` adds `organize:{state:"READY"|"UNAVAILABLE",reason?,active_profile_id?,profiles:[]}`. Safe rows use `profile_id`, `profile_digest`, `provider`, `endpoint_host`, `model_id`, `model_revision`, `disclosed_data_classes`, `allowed_subject_classes`, `expiry`, `max_output_bytes`, `timeout_ms` plus applicable existing budgets. Default projection stays unchanged. Existing egress grant list/create/revoke covers this separate purpose.

Operator configuration: optional `organizing.provider_profile`, installed immutable manifest under `<models>/online-organize/<profile_id>/profile.json`, schema `cairn.online-organize-profile.v1`. Omit an absent group from serialization so prior config identity is stable. Credential refs use the existing resolver.

### Task 1: Host candidate operation (Luna backend)

**Files:** `config/`; `client/command/operations.go`, `client/command/data.go`; `server/internal/search/` narrow organizer profile/provider/validator and existing egress gates; `server/controlplane/material_organize_ops.go`, dispatcher/provider-list/grant bindings; `server/cmd/cairnd/main.go` optional startup binding; existing SQLite grant validator plus one CHECK-only sequential migration preserving all prior records/objects. No frontend or docs edits.

**Interfaces:** Produces shared request/result/status contracts above. Narrow in-memory ordinary-list parsing mirrors ML-1 without creating durable schema. Existing Describe semantics/digests remain intact.

- [x] Implement optional config and immutable profile loading/readiness; absent/bad provider does not block exact saving.
- [x] Implement strict draft/digest/identity/protection checks, fixed bounded prompt, grant/confirmation/audit and one-request provider call.
- [x] Validate returned JSON/ref allowlist/unchanged guide, reattach original guide and recheck size; return transient candidate only.
- [x] Persist the approved ORGANIZE value with one existing-ledger CHECK-only migration, preserving prior grant records and schema objects.
- [x] Register operation and safe opt-in provider metadata/grant support; self-review changed config and trust boundaries. Do not run a separate suite or commit.

### Task 2: Explicit editor candidate review (Luna client)

**Files:** `web/src/app/command.ts`, new `web/src/app/useMaterialOrganizer.ts`; `web/src/lib/operations.ts`, material helpers/types as needed; `web/src/components/material/MaterialListComposer.tsx`, optional focused candidate component; `web/src/main.tsx`, existing material i18n/styles. No Go or docs edits.

**Interfaces:** Consumes shared contracts. Host hook owns profile/grant availability, refresh and `organize(documentJSON,baseDigest,grantID,signal)`; composer does not own provider authority. `command` accepts optional AbortSignal without changing existing call behavior.

- [x] Add host organizer hook and safe installed profile/live matching grant disclosure; unavailable state points to existing configuration paths.
- [x] Show exact draft/context/Skill disclosure and explicit one-request confirmation; limit and duplicate-call handling.
- [x] Keep normalized result in separate candidate preview, summarize title/context/order/omissions/repeats, support reject/use/edit.
- [x] Recheck workspace/context/exact draft/profile at receipt and use; cancel aborts and ignores late results. Existing review/save remains sole persistence path. Self-review; no independent test campaign or commit.

### Task 3: Integrate and demonstrate real use (root + Luna QA)

**Files:** Existing ignored `dist/material-ai-20261022/acceptance/` profile/driver/artifacts only for QA; root owns documentation and necessary integration corrections via original implementers.

- [x] Review backend/client diffs against the approved spec, resolve interface mismatches, and build affected daemon plus Web once.
- [x] Use isolated retained synthetic ML1 profile and authorized local Sub2API `deepseek-v4.1-flash` connection via credential reference. Never print or retain secrets.
- [x] One journey: inspect exact disclosure and grant → real candidate → review/use/edit → one confirmed ordinary capture → reopen → exact original takeout; prove no model call on reopen.
- [x] In the same journey exercise cancellation/stale/invalid foreign-ref handling where practical. Focused checks only for actual failure or specific uncovered changed invariant; state what each proves. Preserve successful mutation marker before reruns.
- [x] Record actual usable scope/remaining gap; `git diff --check`; root reads diff, commits and pushes previously authorized main integration. Update existing F12 ledger and Linear from executable evidence only.

## Decisions and evidence

Owner approved this exact F12 scope and selected Luna execution. Local provider discovery found the current DSH desktop route `sub2api` / `deepseek-v4.1-flash`; no request was made during discovery. Model credentials stay local. The plan adds implementation detail within the approved scope; no further routine approval round is needed.


## Local delivery evidence — 2026-10-22

Implementation and acceptance steps above have scoped implementation and executable evidence in the
[existing feature ledger](../../technical/product-experience-todo.md#f12-real-provider-delivery--2026-10-22).
The selected real Sub2API/Flash journey completed candidate → explicit use →
one ordinary capture → saved-byte readback → exact original ZIP. Cancellation,
stale results and foreign refs were checked locally without another provider
call or capture. One genuine-v27 grant migration invariant and the changed
closed-purpose vocabulary were checked separately after the whole journey.
Daemon and Web builds and `git diff --check` passed. Commit/push metadata is
recorded in the delivery ledger/Linear after integration, without rerunning the
model for documentation-only changes. This is local feature delivery only.

Feature commit `27e99d5` was fast-forwarded to main and pushed to origin; AIL-10 and the existing Chinese functional plan were updated to the verified local delivery scope.
