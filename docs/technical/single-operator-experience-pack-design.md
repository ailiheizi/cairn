# Single-Operator Experience-Pack and Theme Design

> Status: informative architecture proposal, recorded 2026-10-06. This document
> is a design review for future single-operator NAS experiences and themes. It
> adds no schema, API, signed format, public ABI, runtime package manager, product
> surface, phase gate, or implementation credit.
>
> Active phase: Phase 3 browser-product planning. Normative authority remains
> with [AGENTS.md](../../AGENTS.md), the [MVP and Operator Contract](../requirements/mvp-and-operator-contract.md),
> [Product Requirements](../requirements/product-requirements.md),
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md),
> [Extension System Requirements](../requirements/plugin-system.md),
> [Ecosystem and Vertical Application Requirements](../requirements/ecosystem-and-vertical-apps.md),
> and the [Core MVP Execution Plan](core-mvp-execution-plan.md), in their
> documented authority order.

## Decision summary

Treat an interface experience as the replaceable presentation of the whole
client: shell layout, navigation composition, content rendering, and bounded
interaction presentation. A curated color palette is a secondary sublayer of
that experience, not the experience itself. Bundle first-party experiences in
the same trusted client and have them use the existing shared client flows and
typed operations. Do not begin with a dynamic third-party module runtime or
marketplace.

An experience may arrange physical navigation and action positions differently,
subject to host review and acceptance. Stable logical destinations, operation
semantics, policy, identity, Notes, and access decisions remain shared. The
default workspace experience remains the fallback when a stored choice is
unknown or fails to load. Browser-only selection follows the existing guarded,
origin-local presentation preference pattern; it does not create another
settings database.

These choices keep one local operator and one content authority simple. They
do not solve family accounts, remote access, teams, tenancy, or adversarial
module isolation. Those concerns require later, explicit profiles.

## First bounded client slice (2026-10-06)

The user authorized starting implementation after this design review. The
first slice maintains the existing client: three curated token palettes,
system/light/dark appearance, and visibility preferences for the existing
photo/audio library lenses. A small compiled registry validates unique IDs,
slots, modes, and reserved host destinations. It is not the full proposed
contribution standard, a runtime framework, a player, or a new album/playlist
model. It supplies palette and lens-visibility evidence only; it does not
establish a replaceable whole-interface experience. No provider, core command,
durable schema, or signed record changed.

Browser-only preferences reuse the existing layout/sort convention because
these choices affect one client and are safe to discard. A new daemon config
field would create server-side migration and restart coupling for a local
presentation choice. The settings page labels immediate browser behavior;
operator settings retain their existing save/digest/restart contract.

See [the bounded client acceptance record](client-appearance-and-views-acceptance-20261006.md)
for build, browser, fallback, exact-access, and evidence limits. This gives
implementation credit only to that local client slice and closes no core phase.

## Bounded interface-experience slice (2026-10-06)

The next client slice supplies two bundled interface compositions: `workspace`
(workbench) and `showcase` (content showcase). `InterfaceFrame` composes one
shared header/search/status node, navigation, content, and inspector; App
retains shared flow state and overlays. The showcase uses full-height side
navigation, an inset main header, a larger heading, and gallery cards with
stable tile scale. Switching does not clear the tested search, selection,
inspected subject, or Notes draft. The palette remains independently selectable.

`interfaceId` is a guarded field in the existing `cairn.appearance`
browser preference. Legacy preferences keep their palette/mode and select the
workspace interface; unknown values fall back to workspace. This is a compiled
first-party seam, not a public theme format or runtime plugin loader. Child
presentation DOM may remount; local scroll and preview state are not guaranteed
to survive. The initial slice left rendering-exception fallback and shared
in-flight switching untested. The [acceptance continuation](client-interface-experiences-acceptance-20261006.md#2026-10-06-continuation-in-flight-operations-and-render-failures)
now records the implemented error boundary, disposable render-fault tests,
shared App state during a held status read, and an isolated held Notes save
that commits once. This local evidence leaves preview DOM/scroll, local doctor
receipts, broader accessibility, and release qualification open.

See the [interface-experience acceptance](client-interface-experiences-acceptance-20261006.md)
for executed tests, screenshots, and limits. The earlier palette acceptance
remains a separate record of that narrower slice.

## Current profile and product boundary

The current reference profile is a single local operator, one workspace, one
configured content repository, and one SQLite catalog. It has no family
accounts, remote-user identity, cross-workspace operation, hosted tenancy, or
public extension marketplace. Keep the current source of truth for identity,
exact bytes, authorization, search filtering, annotations, publication, and
recovery in the host/core.

The browser remains a bounded client adapter. The [WebUI architecture](webui-architecture.md)
assigns client code to shell, surface, flow, and style modules. This proposal
organizes future presentation code inside that client; it does not turn those
modules into executable plugins. The [NAS content-hub direction](nas-content-hub-product-direction.md)
sets the audience and future gallery/player direction, while the current
preview still lacks production media playback and real albums/playlists.

The extension requirements already permit bundled implementations and define
processor, index, and repository seams. The ecosystem requirements describe
later domain packs and focused clients. The proposed “experience module” is a
client-side presentation contribution, not a new processor family, repository
role, authorization authority, or durable data layer.

## Module boundaries

### Shared client authority and flows

The client retains one library and shared operation flows for navigation
destinations, search and filters, Notes/details, selection, status, and calls
to the typed adapter. A whole bundled experience may compose their physical
presentation differently; a domain module inside an experience may arrange
and render a domain view. Both resolve items to existing host-owned
subject/content references and call existing bounded operations through the
host. Neither may maintain duplicate catalog membership or a private byte
cache as authoritative state.

Modules must preserve a useful generic item and fallback path. If a module is
missing, disabled, incompatible, or fails, the user can still search, inspect,
read/export where supported, verify, and restore exact content through generic
surfaces. Module failure never changes byte identity, protection, recovery, or
host authorization.

### Bundled module contribution standard (design draft)

This checklist is for future first-party contributions and review. It does not
name an operation, file format, loader, or ABI. Existing browser components and
Core Command operations remain the implementation sources until a separately
reviewed design establishes otherwise.

Each contribution should declare, in static build metadata or another later
reviewed form:

- Stable namespaced module identity, version, compatible client/core range, and
  first-party ownership.
- Required host capabilities and optional capabilities, with graceful generic
  fallback for each optional dependency.
- The one user task and surfaces it contributes; shared components it consumes;
  and the typed subject, segment, annotation, or stream concepts it understands.
- Module-owned schemas/fields using namespaced IDs only where an existing
  approved domain schema is available. Do not create new durable schemas,
  collection semantics, or authorization rules by UI convention.
- Static dependencies and compatible versions. No ambient file, network,
  secret, database, repository, or shell access is implied by a dependency.
- Read-only, proposal-producing, or mutation-capable actions and the existing
  host operation that authorizes each action.
- Lifecycle cleanup behavior for view changes, disablement, errors, and host
  shutdown: cancel outstanding reads, close handles, remove listeners, and
  dispose transient state.
- User-visible unavailable, stale, unsupported, or failed states and the
  generic fallback path.

The following are proposed contribution slots for discussion, not public API
names, manifest fields, or a loader contract. Host review must settle each
slot's cardinality and chooser before implementation:

| Illustrative slot | Cardinality / selection | Boundary |
| --- | --- | --- |
| Interface experience | One active host-selected bundled experience. | May replace shell composition and physical navigation/content/action presentation; shared logical destinations, flows, policy, and identity remain host-owned. This is not a public runtime slot. |
| Navigation items | Multiple; stable namespaced identifiers. | Modules may contribute links within host-owned navigation structure; none may replace the root shell or reserved core navigation. |
| Domain view | Host selects a compatible view for the current context and declared supported formats. | A view is presentation over shared subjects; unsupported items use the generic view. Provider format overlap does not imply an arbitrary winner or load-order priority. |
| Bounded preview renderer | Host explicitly selects among compatible candidates. | Renderer receives a scoped bounded read; absent, ambiguous, or failed candidates fall back to generic preview/download behavior where supported. |
| Subject actions | Multiple; each action binds to an existing typed host operation. | The host reauthorizes subject and operation when invoked; a visible button or cached selection is not authority. |
| Optional metadata sections | Multiple; show accepted, attributed facts only. | Cannot add a parallel free-form Notes screen or accept a processor suggestion as a user fact. |
| Module settings | Multiple namespaced declarations under the existing settings authority. | A module cannot duplicate or replace core setting ownership, policy, or authority through a namespaced option. |
| Color palette | One effective color-token set within the selected interface experience. | A view/module consumes the selected semantic tokens; it cannot silently select a competing global palette. |
| Keyboard shortcuts | Multiple namespaced proposals with explicit conflict review. | On overlap, warn and let the operator choose among eligible proposals; reserved core shortcuts cannot be overridden. |
| Processor / index / query profiles | Existing separately reviewed backend contracts only. | A UI module cannot register, replace, or activate a provider merely by being enabled in the interface. |

Locked extension areas include ingest scope and policy; exact identity and
protection/fallback decisions; publication, verification, recovery, retention,
and garbage-collection authority; shared authorization and query-result
filtering; and the logical destinations and semantics for navigation, common
search/Notes, and error/status reporting. A bundled experience may arrange
their physical presentation differently under host review. A contribution
cannot access an arbitrary database, host/source
path, secret, unrestricted network, shell, or imported executable code. These
locks preserve the content authority even when several views represent it.

Where two providers advertise an overlapping format, the host must use its
existing reviewed capability and processing policy, with an explicit selection
if the contract requires one. Module registration or package order cannot
silently choose a processor, index generation, query provider, or preview
renderer.

Contribution compatibility is determined before activation, not by module
load order:

1. Reject duplicate stable IDs, incompatible versions, missing required
   capabilities, dependency cycles, and unknown critical declarations before
   making a contribution visible.
2. Where a slot allows one provider, require one explicit compatible owner
   selection. Where multiple contributors are allowed, use declared
   independent slots and deterministic host composition. Never let “last loaded
   wins” select behavior.
3. Replacement is explicit and reviewable. The host validates compatibility
   and required fallback before activating a replacement; activation failure
   leaves the prior valid selection available. Registration and event effects
   are reversible: a partial failure removes every contribution already
   attached by that activation attempt.
4. Removal or disablement is not deletion of host-owned user data. Preserve
   annotations and content; report domain-only data that has no active renderer.
5. Removing a provider invalidates or reloads dependent contributions in
   reverse dependency order; never leave a dependent in a half-active state.
6. Drain or cancel outstanding work before disposal. A failure remains visible
   and does not suppress the generic item or exact-read path.

### Official modules and third-party runtime

**First stage:** compile official modules with the application and publish them
as one reviewed client build. This uses the existing browser stack and source
boundaries, avoids a separate trust store and loader, and permits cohesive
release testing. A user can select an available view; selection does not
install code or grant new access.

**Later option:** consider signed, independently versioned runtime packages
only after more than one independent implementation proves that the seam is
stable and secure, as required by the extension/ecosystem contracts. Such a
package would need publisher trust, content-addressed identity, compatibility
checks, signature/revocation, dependency and license review, least-privilege
sandboxing, explicit network/secret/process grants, resource ceilings,
upgrade/rollback, and clean removal evidence. A first-party theme or module
must not be treated as proof that hostile third-party code is safely isolated.

A same-process official UI module is trusted application code, not a sandbox.
Code splitting or component boundaries improve maintainability; they do not
restrict filesystem, DOM, browser storage, or network authority. If genuine
isolation becomes necessary, move execution behind a qualified boundary rather
than claiming React component boundaries provide security.

### Architecture analogies reviewed

These examples inform design vocabulary only. They are not code, framework,
ABI, security proof, or dependency decisions:

| Reference | Useful analogy | Limit for Cairn |
| --- | --- | --- |
| [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) and [service guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md) | Layered profiles, injected services, reversible effects, and dependent cleanup on provider removal. | Separate service instances are lifecycle boundaries, not a sandbox, authorization model, or tenant boundary; internal APIs may not be public or stable. |
| [Cordis](https://github.com/cordiverse/cordis) | Service injection and lifecycle mechanisms are possible implementation patterns. | Its API is explicitly unstable; DeepSeek's vendored pinned version is not evidence that upstream main is identical or a safe dependency choice. |
| [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points) and [Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust) | Declarative contributions and unique setting/color IDs help control collisions; trust warnings clarify limits. | Workspace Trust does not prevent a malicious extension from ignoring restrictions; declarations are not sandbox enforcement. |
| [Backstage frontend extensions](https://backstage.io/docs/frontend-system/architecture/extensions) | Typed inputs, outputs, attachments, and explicit singleton versus multiple slots clarify composition. | Backstage permits override or error behavior; Cairn should reject duplicates by default and require explicit reviewed replacement. |
| [Grafana frontend sandbox](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/) | A separate JS context is an explicit isolation feature with its own tradeoffs. | It is documented as public preview; do not copy its mechanism or claim equivalent isolation here. |
| [DeepSeek Harness styling](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md) | A token owner, semantic aliases, and feature-level token consumption support coherent themes. | Adopt the separation principle only; keep Cairn's current token/style system and do not mandate a rewrite. |
| [JupyterLab extension development](https://jupyterlab.readthedocs.io/en/stable/extension/extension_dev.html?highlight=override) | Theme CSS variables, fonts/graphics, separate theme stylesheets, and load/unload lifecycle are documented. | Separate stylesheets do not prove CSS isolation; extension API/version compatibility still matters. Unload behavior does not prove durable-data preservation. |
| [Obsidian theme guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Themes/App%20themes/Build%20a%20theme.md) and [developer policies](https://docs.obsidian.md/community-directory/developer-policies) | Light/dark CSS variable selectors and community restrictions on obfuscation, telemetry, self-update, and theme network resources are documented. | Policies are not a sandbox or proof of host-enforced network isolation. |
| [Obsidian sample-plugin CSS-collision report](https://github.com/obsidianmd/obsidian-sample-plugin/issues/112) | A historical community concern raised the potential for global CSS class conflicts and discussed prefixing CSS classes. | The issue does not show a reproduced collision or a fix qualification; it is not a platform-wide finding. |

The [single-operator plugin and theme research report](../research/single-operator-plugins-and-themes-20261006.md)
retains the source evidence and scan limits. Host-owned annotations and content
surviving module removal follow Cairn's existing authority/recovery
contracts; none of the external unload examples proves that guarantee.

## Authorization and single-operator scope

For the present local profile, the authenticated local OS operator is the
principal. The host remains authoritative for permission to search and access
content. A client module can request only the host operation and subject the
operator selected; it cannot widen scope, open arbitrary paths, inspect SQLite
or repository storage, or mint authorization from its own UI state.

The later app-access contract describes short-lived, audience-bound grants and
handles bound to principal, workspace, subject or segment, representation,
range, expiry, and resource budget ([Ecosystem App Interface §8](ecosystem-app-interface.md#8-capability-grants-and-authorization)).
Those are later-profile design contracts, not claims that remote multi-user
authentication exists in the current preview.

Adding multiple themes or bundled modules does not reduce auth complexity: it
adds more client code that must consistently use host-mediated search and
access. This single-operator design makes no multi-user, family-account, remote
identity, or tenant-isolation plan. Multiple module IDs and UI hiding do not
provide those properties; any future scope requires a separate requirements
and threat review ([Security and Threat Model §14](../requirements/security-and-threat-model.md#14-multitenancy-and-deduplication)).

## Interface experience and palette boundary

An interface experience is a whole bundled shell and content-presentation
composition. It may choose layout, navigation arrangement, content rendering,
and where bounded interactions appear. The host owns the underlying logical
navigation destinations and operation meanings, shared search and Notes data,
identity, policy, authorization, and scoped access. A different physical menu
or action position does not create a new operation or authority.

First-party experiences are trusted bundled React layouts over the same client
flows and host operations. Switching experiences must not remount the client
state owner or reset active data, selection, or in-flight shared flow state.
The workspace experience is the deterministic fallback for an unknown saved
choice or a rendering exception. Experience choices use the existing
browser-only, origin-local preference convention and defaults; they are
disposable and require no durable database. This is a planning constraint, not
a public UI ABI or a framework commitment.

The bounded local browser continuation records ordinary switching and unknown
preference fallback, injected render-failure recovery, and shared App state
while a `status.get` refresh is held across layout changes. It also records one
`annotation.upsert` held across a switch and committed once in a disposable
daemon fixture. The test-only render fault is injected into a separate Vite
build; it adds no production hook. See the
[interface-experience acceptance record](client-interface-experiences-acceptance-20261006.md#2026-10-06-continuation-in-flight-operations-and-render-failures).
The evidence covers the shared query, selected subject, unsaved Notes draft,
and held request path; it does not establish retention of local doctor receipts,
preview DOM state, preview scroll, or every child surface after remount. Broader
accessibility, browser, and release qualification remain separate.

Third-party frontend themes or experiences require a separate loader, trust,
stable typed host-contract, compatibility, and security review. Nothing here
authorizes runtime installation, downloadable code, or that future loader.

### Color palettes

Color palettes are a secondary presentation sublayer. They are data, not
executable modules. A selected experience may offer curated palettes through
the existing design-token approach; palettes do not define shell structure,
navigation composition, content rendering, or interaction placement.

The current [token stylesheet](../../web/src/styles/tokens.css) already has
CSS-variable palettes and a system light-preference override. That code-read
supports reuse of the current token system; it does not establish a theme
picker, module ABI, or accessibility qualification.

A future palette specification should define:

- A stable palette ID and version, semantic color tokens, and supported modes.
- The supported appearance modes: at minimum light and dark; high-contrast
  treatment and system preference should be assessed against accessible use.
- One effective palette within the selected experience. Module-scoped CSS
  prevents accidental style collisions but is not a sandbox.
- Contrast, keyboard focus, readable status/error states, reduced-motion
  behavior, and responsive checks for every shipped theme.
- Deterministic fallback to a built-in default when a palette is unknown or
  incompatible, and a reset path when user choices no longer validate.

Do not permit executable JavaScript palettes, DOM mutation, remote assets, global
CSS, font downloads, or hidden network access as palette behavior. Static CSS is
not JavaScript execution, but unrestricted styles can alter unrelated
presentation, hide or overlap controls, and load remote resources. Scoped CSS
can reduce accidental class collisions; it never guarantees isolation. Keep
palette definitions limited to validated color-token data and bundled assets.
The reviewed first browser slice follows the existing grid/sort preference
pattern: validated appearance and visibility choices use guarded, origin-local
browser storage. These disposable preferences are not operator configuration,
content authority, synchronized settings, or recovery records. Clearing them
returns to built-in defaults. Shared or device-independent choices must use
the existing persisted configuration authority after separate review; do not
add a second settings or theme database.
Keep content, module availability, and authorization semantics independent of
theme selection.

## Staged implementation choice

| Stage | Recommendation | Gate |
| --- | --- | --- |
| Current | Continue one shared client with modular surfaces and styles. Plan module slots and common token use without implementing players or a runtime loader. | Phase 3 maintenance; no new product surface. |
| First verticals | Bundle official photo and audio views in the existing client; validate shared host access and generic fallback. Video and richer document reading follow only after their format and stream contracts are reviewed. | Appropriate discovery/access contracts and existing phase/release gates. |
| Bundled interface experiences | Maintain the implemented workspace/showcase compositions over shared client flows; continue the unqualified preview-state, accessibility, and broader browser checks before claiming wider support. | Existing browser maintenance and scoped client acceptance; held shared-flow and bounded render-failure cases are locally tested, with no runtime or phase credit. |
| Color palettes | Offer curated semantic token sets as a sublayer of an interface experience. Do not require a wholesale design-system rewrite. | Client-only review and palette accessibility acceptance. |
| Third-party packs | Revisit only with two independent implementations, a stable seam, and a qualified signed/sandboxed package lifecycle. | Separate plugin-profile decision and security qualification. |
| Family / multiple principals | Outside the single-operator roadmap. Any separately requested profile would need explicit principal, ACL, revocation, query-filtering, concurrency, and recovery rules before enabling shared accounts. | Separate requirements and threat review; this does not require or imply tenant storage/index partitioning. |

### Framework selection questions for a future spike

Do not install or standardize a framework merely because it supports plugin
composition. If implementation later demonstrates that the current React host
cannot meet a measured contribution need, compare candidates against the same
workload: static first-party bundling, typed host capabilities, one-provider
and multi-provider slots, dependency/duplicate/cycle rejection, deterministic
fallback, i18n, accessible themes, build size, HMR/development ergonomics,
server-free operation, and upgrade rollback. Record whether each framework
requires dynamic code execution, a runtime registry, global CSS, or a second
settings authority. Adopt only if a small representative module improves a
measured outcome without expanding the authority boundary.

## Acceptance criteria for any later implementation

These are review criteria, not tests claimed to have run:

1. With all domain modules disabled, mixed readable content remains visible in
a generic library and exact access, export, verification, and restore retain
the same host authority.
2. A module cannot read a repository locator, ambient source path, database,
credential, or another subject outside host authorization.
3. A denied, expired, revoked, or stale selection fails visibly; no cache,
search result, preview, or stream leaks content across principals/workspaces.
4. Duplicate IDs, incompatible versions, missing required capabilities,
dependency cycles, and unknown critical declarations fail before activation.
5. Explicit replacement either activates the fully compatible module or leaves
the previous valid module and generic view available; load order never decides.
6. Disable, replacement, navigation, and shutdown cancel reads and release
handles/listeners. A renderer failure leaves generic item actions available.
7. Experience selection changes layout and presentation only; shared flows,
logical destinations, operations, authorization, and data authority stay the
same. Each bundled experience passes keyboard, responsive, and failure-state
review.
8. An unknown or failed experience returns to the workspace experience without
modifying content, annotations, or active shared data state.
9. Palette selection remains a secondary color treatment; every bundled
palette passes contrast, keyboard focus, reduced-motion, responsive, and
failure-state review, with an accessible built-in fallback.
10. Host-owned tags and Notes remain intact after a module is disabled and
   re-enabled; a module cannot turn its settings or UI state into their source
   of truth.
11. Removing a decoder that is still required to read an admitted
    recoverable representation is blocked until dependent data is migrated to
    a qualified readable closure.
12. Replacing or disabling a provider cannot swap or reroute an active signed
    core plan; its bound provider/profile remains fixed and failures follow the
    existing reconciliation and fallback contract.

## Deferred decisions

This proposal does not decide a public plugin ABI, extension marketplace,
third-party executable browser modules, runtime installation, module download
or update commands, domain schema or collection format, arbitrary user CSS,
remote identity provider, family/team sharing, multi-tenant storage, cross-tenant
deduplication, player API, or any phase gate. The existing normative extension
and future app-access requirements remain the place to review those contracts.
