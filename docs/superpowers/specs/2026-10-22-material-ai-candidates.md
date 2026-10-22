# F12: Explicit AI candidates for ordinary material lists

**Status:** owner approved on 2026-10-22; implemented and locally validated
through the real-provider candidate → reviewed ordinary capture → reopen/exact
takeout journey on that date. This is not core-phase or release qualification.
**Phase:** admitted ML-3 / F12 first-party candidate delivery.
**North Star:** one owner's content, Notes, discovery, takeout and recovery
kernel; one repository and one catalog. Exact identity remains SHA-256 plus
logical length.
**Convergence:** polish the admitted ordinary material-list loop. This admission
does not admit a runtime plugin, AI agent, marketplace, or new kernel authority.

## Approved decision

Admit one explicit server-mediated operation that turns the current ordinary
material-list draft and its one exact embedded Skill into an untrusted,
transient candidate JSON result. A person reviews that result, chooses whether
to use it in the existing editor, then continues through the existing reviewed
ordinary capture flow. No call runs automatically and no model output is saved
without the person's existing explicit actions.

This is the owner-approved ML-3 successor to ML-1, which permits manual editing
and explicit copy/paste to an external AI only. The ML-1 format and its 200
occurrence / 512 KiB limits remain unchanged. A 32-item ceiling below is a
stricter operation bound for this operation, not a change to the format.

## User boundary and exact input

The operation accepts only the current existing list JSON draft: its title,
ordered item occurrences and exact refs (including existing local hints),
labels, context strings, and at most one complete exact embedded Skill. Context
may contain copied Notes/Tags or text manually edited into the draft. It is the
snapshot in that draft; it does not claim the source records stayed current
after capture.

Before sending, the client displays the exact fields to disclose, installed
profile identity, destination, model, and the live matching grant. One explicit
confirmation authorizes one request. No automatic EXTRACT, original-body,
image, or audio reads occur; there is no hidden catalog search or context
refresh. The host may resolve only submitted refs in the named workspace to
validate identity and per-ref protection policy. It reads no original bytes to
construct the prompt.

The logical task is `ORGANIZE_MATERIAL_LIST`; its closed egress purpose is
`ORGANIZE`, distinct from `DESCRIBE`, and its closed data class is
`text.material_list`. That class explicitly includes the
user-provided draft and embedded Skill, including copied private Notes. It must
not be mislabeled `text.subject_context` or authorized by an existing
`DESCRIBE` grant. Every submitted ref, including an embedded guide source ref, must independently
pass the existing protection policy; one refused ref refuses the whole request before sending.
Request-byte digests and lengths, profile, grant, recipient and outcome are
bound to the existing append-only egress audit machinery. Do not store full
Notes, Skill text, provider credentials or candidate bodies in that audit log.

## Typed command contract

Add one `material.organize` operation on the existing `/api/v1/command` typed
dispatcher. Do not add an HTTP route, job service, CLI/MCP command, or general
prompt proxy.

Request fields:

- `workspace_id`;
- `document_json`: the exact bytes of the current existing serializer output,
  represented as UTF-8 JSON text;
- `base_digest`: SHA-256 over those exact UTF-8 bytes;
- `egress_confirmation`: strict confirmation binding the installed profile
  digest, destination host, model, `ORGANIZE` purpose, and live
  grant ID.

The host rejects a digest mismatch, malformed or over-budget document, stale
workspace, unknown ref, failed ref identity/protection check, unavailable or
revoked profile/credential/grant, or invalid confirmation before egress.
Profile and grant ceilings intersect; neither can widen the other. The caller
cannot supply a system prompt, endpoint, credential, model override, tool,
response schema, or arbitrary extra context.

The success response carries only `candidate_json`, `base_digest`, and the
immutable organizer profile ID/digest. It writes no Description/NOTE/TAG,
material-list file, catalog membership, or list-head state. The only durable
effect of a sent or refused-after-grant attempt is the existing egress audit
receipt. Credential values never enter the request/response, logs or receipt.

## Organizer profile and provider

Use one operator-installed immutable online profile convention,
`cairn.online-organize-profile.v1`, with pinned OpenAI-compatible endpoint,
provider/model identity and revision, credential reference, fixed task
instruction, output schema, timeout and finite request/byte/output budgets.
The credential reference uses the existing `env://` or `keychain://` resolver;
no browser key, second secret store, or per-user provider account is added.
Existing config/capability/preferences surfaces report configured, ready, or
unavailable state without exposing secrets. Existing DESCRIBE profile manifests
and grants do not authorize this operation.

Add a narrow material-organizer provider contract rather than overloading
`DescribeProvider` or `description.generate`: those are subject-description
semantics and currently persist an unaccepted `DescriptionRevision`. Reuse
the existing credential resolver, strict endpoint validation, live egress
grant gate, subject-protection lookup, audit sink, bounded HTTP client and
typed refusal patterns. Extend the existing closed purpose/data-class
validation for this explicitly admitted use. No provider discovery framework,
service, scheduler, persistence, or arbitrary tool execution is introduced.

### Existing grant-ledger enum migration

The existing SQLite grant table has a closed SQL purpose CHECK. Implementing
the owner-approved `ORGANIZE` value therefore requires one mechanical migration
of that existing CHECK. It preserves all existing rows, columns, indexes,
triggers, foreign keys and old purpose semantics. This is the admitted grant
purpose becoming persistable, not a new durable entity, field, list schema,
store or recovery format. No other schema work is authorized.

## Fixed task and validation

The host builds one bounded request from the supplied JSON plus embedded Skill.
The Skill and context are untrusted data/instructions for this one task, never
code: do not execute tools, follow URLs or paths, fetch content, or obey any
instruction to disclose additional material. No retries or second model call
are automatic.

Operation ceilings:

| Input/output | Operation bound |
| --- | ---: |
| Input occurrences | 32 |
| Exact serialized input JSON | 128 KiB UTF-8 |
| Embedded Skill | existing 64 KiB |
| Complete candidate JSON | 512 KiB UTF-8 |
| Candidate occurrences | 32 |
| Request deadline | 90 seconds |
| Provider requests | 1 |

Existing per-field ML-1 limits still apply; the tighter profile/grant limits
win. Refuse over-limit input or output without truncation. Return an actionable
limit error so the person can reduce the selected material or context. Do not
alter ML-1's 200-occurrence format allowance.

The host strictly parses the returned full `cairn.material-list.v1` document
and validates the existing field and size rules. Every candidate item ref
must exactly match a ref supplied in the input; no new identity or local hint
may be introduced or altered. The provider may omit `guide`, as the existing prompt requests; if it returns
a guide, that guide must exactly match the input. Host and client always retain
the original chosen guide when admitting a candidate, and recheck the final
normalized size. The model never supplies the retained guide authority. Reordering, relabeling, title/context
edits, repeated submitted refs, and omitting submitted occurrences may be
proposed, but must be shown for review. Invalid JSON, foreign refs, changed
Skill, invalid fields, or an empty/over-budget response returns no candidate.
A valid empty list is different from an empty response: it may be proposed,
with all omissions visible before the person accepts it.

## Client review, freshness and cancellation

Reuse `materialListPrompt` and `applyMaterialListResult` as the client-side
format/result-validation seam; do not invent another list format. Show the
candidate separately from the live draft, including changed title/order/context
and a clear occurrence summary for omissions and repetitions. **Use candidate
in editor** is a separate explicit action; it replaces the current editor draft
only after rechecking base digest, workspace, exact serialized draft, and
profile identity. Existing editing, review, upload, plan and confirmed capture
remain the only save path.

The host permits at most one in-flight organizer call per instance, and the
client disables duplicate generation actions. Bind the in-flight request to workspace, exact
serialized draft/base digest, and profile. Reject late results or acceptance
after any of those changes. Cancel aborts the transport when supported and
always ignores a late response. Cancellation cannot recall bytes already sent
or promise zero provider charge. Refusal, malformed candidate, cancellation,
stale response, or unknown outcome leaves the editor draft unchanged. No
candidate history, persistent queue, list head, automatic refresh, or automatic
tag mutation is created.

## One acceptance journey

After integration, run one real-provider journey with retained
synthetic files, copied Notes and one ordinary Skill. Show the exact disclosure
and grant; send once; receive a meaningful candidate containing only allowed
refs; review its occurrence changes and Skill preservation; edit/use it in the
existing editor; save once through ordinary confirmed capture; reopen it and
retrieve an original whose bytes match the independent source. Confirm there
was no second model call on reopen. In the same journey, exercise cancellation,
stale-draft rejection and a foreign-ref candidate where practical. Add a
focused local check only for a concrete changed trust invariant the journey
cannot establish; do not run a broad suite or fault campaign for this slice.
Real-provider acceptance uses the owner-authorized local Deepseek Harness
Sub2API connection and `deepseek-v4.1-flash`, with credentials resolved by local
reference only. No secret values belong in source, reports or logs.

## Alternatives and scope

- **Keep explicit clipboard handoff only:** remains usable under ML-1 and needs
  no F12 implementation, but does not provide in-product candidate review.
- **Call the provider directly from the browser:** rejected because it exposes
  credentials and bypasses host-owned protection, grant, and audit decisions.
- **Chosen narrow typed host operation:** enables one explicit reviewed
  candidate while retaining host authority and existing capture semantics.

The owner approved the typed operation, organizer profile convention, distinct
egress purpose/data class, input authorization and transient candidate flow on
2026-10-22. It adds no operational durable schema or list membership authority,
additional HTTP route, processor, description record, runtime loader,
marketplace, general AI/agent platform, CLI/MCP expansion, native client
framework, or release/phase completion claim.

## Bounded authority update

ML-3 records this exact exception in `AGENTS.md`, the first-party client and
material-list contracts, typed-operation/provider contracts and AI-control
catalog. The core plan receives a client-track note only. No core dependency,
recovery meaning, existing DESCRIBE authorization or wider AI execution changes.

The saved result remains ordinary content under ML-1; producer/request details
are attributable through the existing local audit. There is no new portable AI
provenance record or reproducible-inference claim. No model-generated text is
silently promoted into source Notes or human TAG facts.

## Implementation seam

Keep any implementation within the current first-party material-list client
and typed host:

- client: `web/src/components/material/MaterialListComposer.tsx`,
  `web/src/lib/materialList.ts`, `web/src/lib/materialListIO.ts`,
  `web/src/app/command.ts`, and the existing material-list i18n;
- host: operation registration/validation in `server/controlplane/dispatcher.go`
  and a narrowly scoped `server/controlplane/material_organize_ops.go`;
- provider: a narrow organizer contract and online implementation/profile in
  `server/internal/search/`, reusing the existing online credential, egress,
  grant and receipt components;
- operator binding/status: `server/cmd/cairnd/main.go` and the existing config,
  capability and Settings surfaces, only to the extent required to install,
  select and disclose the immutable profile.

The companion implementation plan executes this approved scope. The one
journey above owns the feature batch and its validation.
