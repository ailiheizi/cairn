# Cairn Documentation

This page is the current reading map. Normative requirements define product and safety contracts; the Core MVP Execution Plan is the only implementation order. Research, acceptance reports, and ledgers provide context or evidence, but do not change those contracts or independently authorize scope.

Project documentation is written in English.

## Current direction

Cairn is a single-person self-hosted personal-content platform: one operator, one configured repository, and one SQLite catalog. Its trusted kernel protects exact bytes and supports descriptions, discovery, export, verification, and recovery. Organization and first-party Photos, Music, and Overview experiences share that authority. See [Content-First Product Decision](technical/content-first-product-decision.md) for the current user-facing framing.

The latest product direction is to reuse ordinary stored material—including originals, descriptions, Skills, and lists. Lists should be readable by programs; repeated corrections should accumulate in an ordinary document for later organization. The owner has admitted the bounded [ML-1 ordinary-list client](requirements/first-party-client-experiences.md#ml-1-ordinary-material-list-snapshots): explicit result snapshots, retained Skill text, manual or external-AI copy/paste organization, and existing reviewed capture/takeout. The [ML-2 successor](requirements/first-party-client-experiences.md#ml-2-use-saved-lists-through-existing-host-actions) connects saved lists to existing playback and unique-file takeout. Their [client contract](technical/material-list-client-contract.md) defines the bounded workflow. Persistent current-list heads, automatic organization and an integrated AI executor remain outside it. The [2026-10-20 research record](research/skill-driven-content-substrate-and-qa-20261020.md) and [broader material/list draft](technical/material-list-and-guidance-draft.md) retain those further goals and gaps.

## Capability and status

Development evidence, local delivery, and release qualification are separate claims. An acceptance report proves only its named workflow and build. It does not close a phase or qualify a release unless the corresponding normative gate says so. Check the canonical status in [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md), the [Core MVP Execution Plan](technical/core-mvp-execution-plan.md), and the relevant acceptance report before describing a capability as complete.

Current convergence work is limited to the admitted core and first-party client tracks. Exact-byte identity and recovery remain independent of AI-derived facts. The admitted PDF/DOCX, OCR, and Darwin arm64 visual-search work has narrow boundaries in [File Identification and Extraction](requirements/file-identification-and-extraction.md) and the [image-text](technical/product-power-image-text-proposal.md) and [visual-search](technical/product-power-visual-search-proposal.md) records. Local delivery does not imply default-profile or release qualification. Runtime third-party code in the kernel, a plugin marketplace, and new AI formats or executors are outside this work.

## Normative authority

Resolve conflicts in this order, as defined by the repository's [agent guardrails](../AGENTS.md):

1. [MVP and Operator Contract](requirements/mvp-and-operator-contract.md)
2. [Product Requirements](requirements/product-requirements.md)
3. [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md)
4. [Core Kernel and Interface Requirements](requirements/core-kernel-and-interface.md)
5. Topic-specific normative requirements, including recovery, security, CLI, and release qualification
6. [Core MVP Execution Plan](technical/core-mvp-execution-plan.md), the only implementation order
7. Other technical plans, acceptance records, and research

Recovery evidence is specified by [Restore Manifest](requirements/restore-manifest.md) and [Recovery Fidelity](requirements/recovery-fidelity.md). Core content, deduplication, discovery, view/export, and garbage-collection semantics belong to the content-store contract.

## Execution and progress records

- [Core MVP Execution Plan](technical/core-mvp-execution-plan.md) is the sole dependency-ordered implementation plan.
- [Product Experience Todo](technical/product-experience-todo.md) is an informative client progress ledger; it cannot reorder phases or redefine requirements.
- [Function Delivery Plan](superpowers/plans/2026-10-21-cairn-focused-delivery.md) is the current 28-card functional index with 127 subfeature states, implementation approach and usable delivery outcomes, mirrored on the Cairn Linear board. The selected 2026-10-22 Music F15, Photos F14 and complete-interface F16 client batch has bounded local delivery evidence; design and necessary validation stay inside those features. Skill reuse F11 and conditional integrated AI F12 remain planned.
- [Server, Client and Application Product Form](superpowers/specs/2026-10-22-server-client-product-form.md) records the owner's clarified shape: one shared service and one Web implementation, computer layout first, later reused in a desktop wrapper. It defines four standard workflows, shared settings semantics, capability-based enhancement and functional delivery depth; it grants no runtime-plugin, remote-access or streaming admission.
- [Detailed Client Delivery Todo](superpowers/plans/2026-10-22-desktop-web-delivery.md) gives ordered S1 Music, S2 Photos and S3 interface steps with exact reuse boundaries and usable outcomes. Future desktop packaging, AI and larger-media work remain conditional and reuse existing cards.
- [Functional Capability Comparison](references/functional-capability-comparison-20261021.md) compares relevant mature-product functions and explicitly distinguishes current Cairn coverage, real gaps and unselected breadth.
- [Superseded 67-row Planning Draft](history/whole-product-planning-draft-20261021.md) preserves earlier ideas and their disposition; it is not an active queue.
- [Repository Structure Review — 2026-10-21](technical/repository-structure-review-20261021.md) records whole-repository coverage, shared-code ownership and deliberately retained differences. It grants no product phase or release credit.
- [Remaining Work and Closed Decisions](technical/remaining-work-and-closed-decisions.md) is a dated 2026-09-17 checkpoint, retained for context. Its capability and frontier summaries are not current status.
- Dated acceptance files record bounded evidence. Read the matching contract and report together; do not treat the report as a new requirement.

## Code and user entry points

- User guide: [Cairn Wiki](wiki/README.md); start with [Quick Start](wiki/quick-start.md).
- CLI and operation contract: [CLI and MCP Contract](requirements/cli-and-mcp-contract.md). MCP integration is deferred during convergence absent a direct request.
- Daemon entry: `server/cmd/cairnd`; typed operations and policy: `server/controlplane`.
- Exact storage and recovery: `server/internal/exact`; processors: `server/internal/processor`; lexical and semantic discovery: `server/internal/search`.
- Browser client: `web/src`; its ownership and surface map is [WebUI Architecture](technical/webui-architecture.md).

## Topic navigation

- [Core requirements](#mvp-defining-requirements) — stable navigation target for older references.
- [Cross-phase interfaces](#normative-cross-phase-interfaces) — processor, recovery, namespace, and lifecycle contracts.
- [Extended profiles](#extended-profiles) — future or separately qualified work; not current core authorization.
- [Supporting designs](#supporting-designs) — informative system proposals.
- [Research and references](#research-and-references) — exploratory material, not normative scope.
- [Benchmark and qualification runs](#benchmark-and-qualification-runs) — evidence records, each limited to its stated build and journey.
- [Documentation authority](#documentation-authority) — retained anchor for historical links.

## MVP-defining requirements

- [Product Requirements](requirements/product-requirements.md)
- [Content Store, Views, and Export Requirements](requirements/content-store-views-and-exports.md)
- [MVP and Operator Contract](requirements/mvp-and-operator-contract.md)
- [Core Kernel and Interface Requirements](requirements/core-kernel-and-interface.md)
- [Security and Threat Model](requirements/security-and-threat-model.md)
- [Release Qualification and Traceability](requirements/release-qualification-and-traceability.md)

## Normative cross-phase interfaces

- [Driver and Processor Interfaces](requirements/driver-and-processor-interfaces.md)
- [File Identification and Extraction](requirements/file-identification-and-extraction.md)
- [Restore Manifest](requirements/restore-manifest.md)
- [Recovery Fidelity](requirements/recovery-fidelity.md)
- [Namespace and Content Access](technical/namespace-and-content-access.md)
- [Operations and Lifecycle](requirements/operations-and-lifecycle.md)
- [First-Party Client Experiences](requirements/first-party-client-experiences.md)

## Extended profiles

See [Ecosystem and Vertical Applications](requirements/ecosystem-and-vertical-apps.md), [Optional REST and WebUI Adapters](requirements/api-and-webui.md), and the other separately scoped requirements in `docs/requirements/`. They apply only where an authoritative contract explicitly admits them.

## Supporting designs

See [Build Stack and Architecture Selection](technical/build-stack-and-architecture-selection.md) for ADRs and [Product Experience Backlog](technical/product-experience-backlog.md) for recorded requests. These documents explain decisions; they do not supersede normative requirements or the core execution plan.

## Research and references

See `docs/research/` and `docs/references/` for dated research. The [Skill-driven content substrate and Q&A](research/skill-driven-content-substrate-and-qa-20261020.md) is the current research record for ordinary material, lists, Skills, and correction notes. Research does not itself implement or admit the proposal.

## Benchmark and qualification runs

See `docs/technical/*acceptance*.md` and qualification records for bounded evidence. Verify identity, environment, and stated limits before relying on a result; a local pass is not release qualification.

## Documentation authority

This anchor is retained for links from older records. The current authority order is in [Normative authority](#normative-authority); historical reading maps are preserved in [Documentation Log Through 2026-10-20](history/documentation-log-through-20261020.md).

## Current status at a glance

This heading preserves the former status anchor. For present status, use the canonical contract and implementation-plan sources linked above, then consult dated acceptance evidence for the specific workflow. A broad summary in a dated report can be stale and does not override those sources.

## Recommended reading order

This heading preserves the former reading-order anchor. Begin with the normative authority list, then read the single execution plan, the relevant topic contract, and only then informative designs or acceptance evidence.
