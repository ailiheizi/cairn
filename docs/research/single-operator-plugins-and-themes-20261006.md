# Single-Operator Plugins and Themes: Research and Decisions

> Recorded 2026-10-06. Informative research, not a normative extension ABI,
> framework selection, implemented runtime, or phase-qualification record.
> The operator explicitly selected personal, single-person self-hosting and
> requested documentation before implementation.

## 1. Conclusion

Use a small host-owned content platform with curated vertical experiences and
declarative themes. Start with official modules, keep their contribution points
explicit, and extract an extension interface from concrete gallery and audio
workflows when implementation is admitted. Treat a public third-party runtime
as a later product requiring its own compatibility and security qualification.

DSH/Cordis is a useful architecture reference, particularly for dependency
lifetimes and visual ownership. It is not selected as a RestoreWeave dependency.
Ordinary feature modules remain a valid alternative if a runtime loader adds
more work than it removes. The sources below document mechanisms; they do not
prove that adopting those mechanisms makes RestoreWeave successful or secure.

The detailed proposal is [Single-Operator Experience-Pack Design](../technical/single-operator-experience-pack-design.md).
[ADR-019](../technical/build-stack-and-architecture-selection.md#adr-019-bundled-vertical-client-modules-before-a-runtime-extension-framework)
and [ADR-020](../technical/build-stack-and-architecture-selection.md#adr-020-declarative-themes-over-shared-semantic-tokens)
record the decisions and alternatives.

## 2. Questions and acquisition boundary

The seed is the same-content-library experience: store heterogeneous content,
find it through shared search/tags/Notes, use an appropriate vertical view, and
retrieve original bytes. The extension proposal should improve this loop
without transferring identity, authorization, publication, or recovery to UI
modules. The current audience is a single local operator; remote exposure,
family accounts, and tenant management are outside this initial direction.

| Evidence question | Channel and transport | Vocabulary / primary targets | Fallback and limit |
| --- | --- | --- | --- |
| How does DSH compose capabilities and clean up dependency lifetimes? | Official repository documentation; web search/open | DSH, Cordis, services, dependencies, profiles, bundles, styling ownership | Official linked Cordis repository; no unverified community package treated as an official API |
| How do other hosts restrict extension points and resolve conflicting contributions? | Official developer documentation; web search/open | VS Code contribution points and workspace trust; Backstage typed extension inputs; Grafana frontend sandbox | Original source documentation; no popularity or deployment inference |
| How do themes coexist with functional extensions, and where do conflicts arise? | Official JupyterLab/Obsidian docs and original GitHub issue; web search/open | theme CSS variables, load/unload, compatibility, global stylesheet collisions | Mark an inaccessible original as unverified instead of citing a search snippet |

Research used those channels successfully. The final retained set contains
official documentation/repositories and an original community issue. No channel
failure required a fallback. Private communities, user interviews, plugin
installation, benchmarks, and independent security testing were not performed.
Source documentation is evidence about the documented mechanism, not runtime
acceptance. The issue is an individual historical concern, not a prevalence
measurement or proof of a current platform-wide defect.

## 3. Retained-source and entailment ledger

Every entry separates a documented observation from the proposed RestoreWeave
choice. The relation is direct for the external document's stated mechanism,
and analogy-only for its suitability here. No ecosystem adoption or causal
success claim is retained.

| ID / source URL and section | Exact observed content, paraphrased | Proposed claim / primary relation | Entailment and maximum allowed wording | Does not support |
| --- | --- | --- | --- | --- |
| R1 — [DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md), Cordis; Profiles and bundles | Services, typed events, and reversible effects are contributed through context; ordered layers compose plugin profiles. | Consider host-managed composition; architecture analogy. | Direct documented design; analogue-only fit. | Stable public access to every internal capability; qualified RestoreWeave runtime. |
| R2 — [DSH services](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md), dependency behavior; service isolation | Required services delay activation; dependents dispose/reload with provider availability; groups can see separate service instances. | Track dependencies and lifetimes; boundary counterexample. | Direct documented semantics; analogue-only borrowing. | Service-instance scoping as untrusted-code confinement, authorization, or tenant isolation. |
| R3 — [DSH web styling](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md), Ownership; Component rules | Shared tokens and appearance belong to `ui-theme`; layout applies the resolved theme; feature styles consume aliases. | Central visual ownership; theme analogy. | Direct documented ownership; analogue-only application. | Arbitrary global CSS as a supported public theme ABI. |
| R4 — [Cordis repository](https://github.com/cordiverse/cordis), README | Upstream declares active development and an unstable API. | Defer dependency adoption until a bounded comparison; compatibility caution. | Direct upstream statement at retrieval. | Upstream main matching DSH's pinned/vendored version or all future releases. |
| R5 — [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points), introduction; configuration; colors | Contributions are declared in the manifest; settings have unique IDs; colors declare appearance-specific defaults. | Named contributions and token defaults; contract analogy. | Direct documented surface; analogue-only suitability. | That declarations enforce runtime security or that RestoreWeave needs the full API. |
| R6 — [VS Code workspace trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust), Restricted Mode caution | Workspace Trust cannot prevent a malicious extension from ignoring Restricted Mode. | Separate user consent from code confinement; explicit counterevidence. | Direct documented limitation. | A trust prompt or declared permission alone making executable plugins safe. |
| R7 — [Backstage extensions](https://backstage.io/docs/frontend-system/architecture/extensions/), ID; Inputs; Attachment point; Extension Inputs | Typed attachments, unique IDs, singleton inputs, and internal-only inputs restrict composition. Duplicate IDs may error or override. | Typed slots and declared cardinality; composition analogy. | Direct documented mechanisms; analogue-only policy. | Our stricter conflict rejection being Backstage's universal default or a sandbox. |
| R8 — [Grafana frontend sandbox](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/), overview; compatibility | A separate JavaScript context protects designated UI boundaries; the feature is described as public preview. | Evaluate confinement separately from a registry; security-boundary analogy. | Direct documented feature/status at retrieval. | A sandbox already existing here, production qualification, or copying Grafana's mechanism. |
| R9 — [JupyterLab extension development](https://jupyterlab.readthedocs.io/en/stable/extension/extension_dev.html?highlight=override), theme plugins; compatibility | Theme assets can load/unload separately and supply CSS variables; extensions have version compatibility concerns. | Separate visual assets from functional lifetimes; theme analogy. | Direct documented behavior; analogue-only application. | CSS isolation or persistent user-data preservation on uninstall. |
| R10 — [Obsidian build a theme](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Themes/App%20themes/Build%20a%20theme.md), light/dark CSS variables | Theme appearance can override variables under `.theme-light` and `.theme-dark`. | Reuse app-defined visual values; theme analogy. | Direct documented recipe; analogue-only restricted-token design. | That Obsidian forbids all arbitrary CSS or provides our proposed token validator. |
| R11 — [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies), theme and plugin policies | Directory policies constrain matters such as obfuscation, telemetry, updates, and theme network resources. | Disclose publisher/egress rules; governance analogy. | Direct directory policy at retrieval. | Directory review being a sandbox or proof about extensions outside that directory. |
| R12 — [Obsidian sample-plugin issue 112](https://github.com/obsidianmd/obsidian-sample-plugin/issues/112), CSS name conflict handling | An author raises potential class-name conflicts from global styles and describes plugin-prefixed CSS Modules in their own work. | Avoid unrestricted global styles; concrete community concern. | Direct historical discussion; analogue-only design implication. | An actual reproduced collision, qualified fix, current platform-wide breakage, or frequency. |

These sources were inspected as documentation and discussion. Third-party
summaries and unrelated results were excluded. No external implementation was
installed, audited, or copied; dependency adoption would require a separate
version, license, packaging, and qualification review.

## 4. Decisions the comparison changes

### Contribution points instead of arbitrary mutation

A pack proposes a route, content view, preview renderer, action, or settings
section at a host-defined position. It does not own the entire browser shell.
Contribution IDs and configuration are namespaced, and each slot declares
whether it accepts a selected provider or multiple ordered contributions.
Internal-only slots remain unavailable to other packs. Type/compatibility
checks precede activation; conflicting claims do not silently win by load order.

This is a proposed policy, stricter than the possible override behavior in R7.
An explicit owner-selected replacement is possible only at a replaceable slot;
it never replaces content identity, query authorization, or recovery semantics.

### Lifetimes and compatibility before hot swapping

Activation should register managed resources, then commit the usable
contribution set. Failure rolls back registrations. Disable should stop new
work, revoke further access, cancel or drain supported work, and dispose
listeners, timers, views, and handles. Running signed core work retains its
original profile and cannot be silently rerouted.

Runtime resource cleanup and durable data retention are different contracts.
Owner Notes, tags, and future admitted domain user state remain host-owned;
disabling a view does not erase them. Required historical decoders remain
subject to the existing recovery-dependency removal gate. The external theme
and lifecycle sources do not establish this data-retention promise for us.

### Themes are a separate contribution class

Use declarative appearance values interpreted by the application, including
palette and bounded typography, density, and motion choices. The shell owns
the effective theme; functional views consume it. Themes do not register
commands, scripts, providers, arbitrary DOM access, or hidden network loads.
Scoped CSS helps prevent accidental collisions but is not a security sandbox.

The proposed restricted token format deliberately offers less freedom than
general CSS themes. Layout differences remain explicit view settings rather
than an accidental stylesheet effect. Focus, error/protection meaning,
readability, and reduced-motion behavior must survive every admitted theme.

### Official modules before a public runtime

The first useful product should arrive with coherent defaults. Gallery and
audio workflows can reveal the useful shared seam before it becomes a public
compatibility promise. Video and document workflows should reuse that seam,
not each create another catalog or access service. Users should not have to
assemble dependencies to perform the ordinary personal-library loop.

The alternative of ordinary compiled feature modules is retained. If those
modules provide sufficient enable/disable, lazy loading, and clean lifecycle
behavior, a general runtime framework may not be justified. This is the
strongest countercase to adopting Cordis immediately. Adoption should change
only when representative workflows demonstrate recurring lifecycle or
dependency problems and a bounded comparison shows that a framework resolves
them without unacceptable compatibility, startup, packaging, or trust cost.

## 5. Current repository facts and authority

The current stylesheet defines shared CSS variables and a
`prefers-color-scheme: light` override ([tokens.css](../../web/src/styles/tokens.css)).
That is source-read evidence of a reusable style mechanism, not evidence of a
theme picker, third-party theme installation, or accessibility qualification.
No product runtime or player acceptance test was run for this documentation
slice; the standalone prototype's [browser review](../prototypes/nas-content-hub/QA.md)
remains a separate authored-data record.

The governing [extension boundary](../requirements/plugin-system.md#2-extension-boundary)
keeps identity, policy, publication, exact access, and authorization core-owned.
[Isolation and authority](../requirements/plugin-system.md#9-isolation-and-authority)
governs executable third-party work; [versioning](../requirements/plugin-system.md#7-versioning-replacement-and-upgrade)
preserves producer identities and historical reader dependencies.
The later [experience-pack contract](../requirements/ecosystem-and-vertical-apps.md#42-experience-pack-contract)
and [app grants](../technical/ecosystem-app-interface.md#8-capability-grants-and-authorization)
describe future profiles, not active media APIs.

This work is Phase 3 informative planning. It neither reorders the
[core execution plan](../technical/core-mvp-execution-plan.md#immediate-work-lock)
nor adds a public API, durable schema, catalog, job state machine, or signed
format. Player/content-access contracts and applicable gates remain required;
the Phase 4/5 prerequisites for Phase 6 are unchanged.

## 6. Research accounting and remaining checks

Manual reconciliation: root acquisition used 3 web-tool invocations, the
DSH/Cordis branch 3, and the themes/community branch 3, each with no failed
invocation reported. Acquisition stopped at 9, the reserved synthesis boundary.
Root then used one reserved verification call to inspect the original R12
issue body and narrow the claim to potential conflicts. Total external
invocations were 10 under the shared 12-invocation budget. Each invocation may
batch searches/opens, so this is not a claim of 10 individual URLs or provider
requests. No Siftline CLI was invoked; its machine ledger and
provider-call metrics do not apply. The retained ledger above contains 12
decision-changing URLs. There were no declared unavailable channels or
degraded transport fallbacks.

The sources were retrieved from moving documentation/main branches on the
recorded date. They establish no frozen upstream revision or tested
cross-framework compatibility tuple. The proposed RestoreWeave standard must
be versioned through its own reviewed contract before implementation.

The next useful checks, after implementation is admitted, are a real same-library
gallery/audio loop, adversarial conflict/lifecycle cases, and visual checks of
the same content under admitted themes. They should decide whether to retain
simple official modules, adopt a framework, or expand the contribution surface.
No market-size, ecosystem-completeness, or runtime-security conclusion is drawn
from this scan.
