# Skill-Driven Content Substrate: Product Shape and Q&A

Date: 2026-10-20

Status: **research and proposed direction; no implementation admission**

Evidence: current working-tree source inspection, official reference material,
and three completed DSH consultations through the configured
`openainext / claude-opus-5-5` route.

The next refinement is the [ordinary-list and guide draft](../technical/material-list-and-guidance-draft.md):
three body parts, two examples using the same shape, explicit association of
one optional instruction document, and a current-code reuse/gap assessment.
It remains a proposal, not a supported file format.

This document records a product rethink requested by the owner. It does not
change the normative contracts, the convergence lock, portable record formats,
or the [Core MVP Execution Plan](../technical/core-mvp-execution-plan.md).
It adds no implemented capability or release credit. No application tests,
private-library inference, data migration, or new integration were run for
this research. Earlier uncompleted client work stays uncompleted.

## 1. What the owner actually asked for

The dictated word **SQL was a transcription error: the owner meant Skill**.
This is not a proposal for a SQL editor, a new query language, or AI access to
the catalog database.

The owner's confirmed intentions are:

1. Intake should stay simple: original material and optional Notes.
2. Reusable Skills describe how AI investigates, interprets, and organizes
   material, instead of adding a separate product subsystem for every use case.
3. The existing Tag capability matters. Attribute dimensions and raising or
   lowering their influence deserve careful consideration.
4. Organized results should be usable by ordinary applications without paying
   for a fresh AI interpretation on every read.
5. Music, conversations, and project material are examples of composition, not
   authorization to build three new domain systems.
6. This round is for careful product and underlying-model reasoning.
7. In the follow-up, the owner selected **automation per organizing method:
   explicitly designated lists may update automatically; changes to human
   Tags still require confirmation**. This selects a future behavior, not a
   schema, API, or execution-engine implementation.
8. The owner subsequently clarified that original information must be retained,
   not only attributes; existing LLMs are sufficient. The “dedicated index”
   means an organized list for programs, regardless of whether people, AI,
   scripts or rules generate and update it.
9. The owner explicitly endorsed using the fewest concepts to accomplish the
   most. Prefer composition before inventing another core concept. The
   distinctions analyzed below are not a requirement to expose separate
   objects, managers or services.
10. The owner selected a list as **ordinary system-readable material with a
    different record type, reusing existing storage**. It is not a new
    independently stored list system.
11. Authorized automatic regeneration may replace manually edited list
    results. To correct AI understanding, the owner prefers discussion,
    including multiple turns when needed, followed by a retained document
    expressing the agreed correction. That document is input to later
    organization, rather than a permanent lock on each output entry.

The prior single-owner, self-hosted boundary remains. The owner has not asked
to discard existing data, replace every client, or reopen multi-tenancy.

## 2. Recommended product shape

**A personal content library that retains originals, lets people define how
their material is understood, and makes the resulting organization reusable
by both people and applications.**

The distinguishing goal is the complete handoff: describe a need, organize
once, correct it when necessary, and keep using the result. Exact recovery is
the foundation for trusting that process; it is not the entire user pitch.
“AI-era storage” is an ambition, not evidence of uniqueness or superiority.

| Candidate | Benefit | Cost or counterexample | Recommendation |
| --- | --- | --- | --- |
| Add AI actions to each existing vertical client | Familiar and direct | A new domain can require another parallel set of controls and state | Keep useful clients, but avoid making them separate organization authorities |
| Shared content and organized results, with reusable methods and consumer views | Reuses interpretation across clients; ordinary reads need no model call | Requires clear meaning, correction, and delivery contracts | Preferred direction to investigate |
| General personal database and agent operating system | Very broad expressiveness | Arbitrary schemas, workflows, execution state, and integrations can recreate the complexity the owner wants to remove | Do not make this the product target |

The preferred direction is neither an empty framework nor a command-line-only
backend. Ship useful default organizing methods and a small number of good
first-party consumers. Advanced users can customize methods; ordinary users
should not have to author Skills or learn the internal data model.

### Current simplification: material and lists

The third discussion narrows the recommended user vocabulary to two concepts:

| Concept | What the user keeps or uses |
| --- | --- |
| **Material** | Original files or recorded information, with Notes, retained source information, and any useful structured description |
| **List** | Ordered references to material, with the information needed for that list's purpose |

Notes belong with material. A Skill is an organizing method; its text can be
retained as ordinary material when useful, without making Skill execution a
third core storage system. Methods do not have to be imported into Cairn to
exist, although a retained method definition gives stronger provenance than
an external name alone.

“Original information” can include the user's own words, an external source
excerpt and its origin, and the actual generated summary. These are different
sources within the same experience, not three new libraries. Retain a whole
external document only when it is wanted and can be captured appropriately;
do not imply that every external citation has been fully archived. Distinguish
a retained excerpt from a URL-only reference.

Attributes help filtering and program use; they do not replace source context.
Conversely, a directly entered structured value can itself be original
information: do not require generating a prose paragraph merely to make that
value legitimate. The earlier carrier alternatives remain open.

The owner has now selected further storage unification: a list is one type of
ordinary material in the existing storage. “Material and lists” remains useful
user vocabulary, not two storage authorities. Its understood reference and
update semantics still need a concrete format contract before implementation.
No table layout or runtime integration is approved by that product decision.

In this document, **shared information means reuse inside the same personal
library**. A recording's duration or retained description can be reused by
several lists. It does not mean a public sharing link, other users, or a
multitenant permission model. List-specific selection reasons remain local
to that list.

```mermaid
flowchart LR
    A[Material: originals, Notes and sources]
    B[Lists: references and useful context]
    C[People and applications]
    A -->|Authorized people, AI, scripts or rules organize| B
    B -->|Read one consistent result| C
    A -->|Authorized original takeout| C
```

This is a logical responsibility diagram, not a service topology. It does not
propose a second metadata database, a mandatory cloud service, or an index per
application. The diagram grants no access to the entire library. Execution
placement for any future product integration remains a separate decision.

### Everyday experience

Use the existing Library and Notes as the starting point:

1. Save material and optionally say what matters about it.
2. Choose a built-in organizing method, edit one, or describe a desired method
   in ordinary language. A generated method should be inspectable before use.
3. Choose a visible scope. Disclose source reads, external lookups, remote-model
   disclosure, and the selected automation behavior.
4. Show useful results immediately, with reasons and conflicts available on
   demand. Correction happens beside the affected item.
5. Keep the result as a named list and choose how to use it: in a first-party
   experience or through a supported external delivery format.
6. Later reads use stored results. Refresh shows changes and any incomplete
   coverage without requiring the owner to manage an agent run dashboard.

“Keep a list and use it” is a proposed combined interaction, not a claim that
the complete flow exists today or that a new list is an existing SavedView.
Avoid another separate Description
screen: organized attributes can appear in the existing details/Notes context.
A few meaningful controls should replace many permanent panels.

## 3. What can actually be reused

This is a code-shape audit, not a fresh end-to-end acceptance of existing
features.

| Existing component | Observed in the current tree | Reuse and limit |
| --- | --- | --- |
| `Annotation.TAG` | Revisioned string body, subject, digest and tombstone; no per-assignment dimension, weight, evidence or confidence | Preserve familiar user labels and exact matching |
| `DescriptionDocument` | Distinct USER/IMPORTED/EXTRACTED/AI kinds; source/profile/config digests, confidence, coverage, acceptance, revisions and metadata | Strong starting point for attributed descriptions; not proof of independently editable structured attributes |
| `DESCRIBE_SUBJECT` | Explicit generated description for one subject through existing provider/authorization handling | Not a general Skill executor; the inspected generation input does not include user Notes |
| Notes presentation | Shared presentation of distinct underlying text sources | Reuse it; do not copy machine text into a second user note merely to display it |
| SavedView | Revisioned query and bounded legacy field semantics, including exact user-tag conjunction | Reuse named queries; arbitrary typed-attribute ranking is not implemented merely because the normative contract describes a query AST |
| ExportManifest | Frozen takeout selection and representation/output information | Reuse exact takeout; it is not a refreshable application feed or persistent playlist |
| LinkGroup | Normative plan for an explicitly maintained file-link/path mapping; implementation remains absent in the execution plan | Potential overlap with list membership must be reviewed before creating both; no general ordered list is supplied by the plan |
| Music queue | Editable ordered occurrences in transient browser state; refresh clears it | Useful interaction behavior, not a saved list available to other programs |
| Semantic search | Existing segment, lexical, BGE and other separately admitted discovery paths | Candidate discovery remains useful; embeddings are not the authoritative attribute record |

Primary code pointers:
[annotation and description types](../../server/internal/store/sqlite/types.go),
[description operations](../../server/controlplane/description_ops.go),
[tag operations](../../server/controlplane/catalog_ops.go),
[view/export storage](../../server/internal/store/sqlite/views_exports.go), and
[view/export operations](../../server/controlplane/view_export_ops.go).

Relevant contracts already distinguish durable descriptions from rebuildable
indexes and describe namespaced typed metadata:
[content, descriptions and views](../requirements/content-store-views-and-exports.md),
[AI authority](../requirements/ai-control-and-semantic-catalog.md), and
[external AI boundaries](../requirements/external-ai-and-semantic-extensions.md).
These intentions do not establish a shipped weighted-tag or Skill system.

## 4. Tags need meaning before they need a weight

A label belongs to a file through an **assignment**. A numeric value on the
global label “piano” cannot express how strongly piano appears in two different
recordings, nor how much two different lists should favor it.

| Question | Example | Where it belongs conceptually |
| --- | --- | --- |
| What property is asserted? | Instrument includes piano | Typed attribute assignment to a subject or explicitly anchored source span |
| How much is it present? | Piano is the dominant instrument | Assignment value or declared strength scale |
| Why believe the assertion? | Recorded credits; direct inspection; an uncertain inference | Evidence and epistemic status |
| Is this source trusted for this purpose? | A playlist title is weak evidence of instrumentation | Source assessment and resolution policy |
| What does the owner want here? | Prefer dreamlike piano in this listening list | View preference or ranking policy |
| Who decides what this personal view uses? | The owner corrected an AI suggestion | Explicit user decision, distinct from objective truth |

These distinctions are questions for a few representative cases, not a
mandatory first-release field list or six separate settings. Start by proving
that one or two meaningful strength/correction cases actually need them.

This calls first for a **data model**, not a newly trained tagging neural
network. Existing models can propose values. Training a dedicated model would
need evidence that reusable methods, source data, and corrections are
insufficient, plus a dataset and a measurable outcome.

Avoid five generic sliders. Use contextual actions:

- On the item: “Incorrect” or “Change value.”
- For an attribute with a meaningful scale: “Dominant / supporting / absent,”
  or a properly defined measurement.
- On an evidence item: “Do not use this source for this judgment.” Any
  library-wide effect should be a separate, visible choice.
- On a result view: “Prefer more of this,” with the affected view identified.

Do not introduce durable pin/exclude membership through a casual UI label:
per-view manual membership would be another persistence decision. Attribute
correction and query preferences are sufficient for the initial discussion.

### Minimum semantic distinctions

- **Unexamined**, **examined but unknown**, and **explicitly negative** are
  different. Missing data is not zero, false, or proof of absence.
- Subjective “dreamlike” describes an interpretation under a method or person's
  scale. It is not an objective property merely because it has a number.
- A model's self-reported `0.9` is not a calibrated 90% probability.
- “Instrumentalness” needs a definition. The proportion of time with no
  detected vocals differs from artistic genre, loudness share, and confidence
  in the judgment. External playlist context cannot measure these.
- Conflicting sources remain distinguishable. User priority in a personal view
  does not turn an unsupported claim into verified truth.
- Skill versions, value scales, and aliases must not silently reinterpret
  previously retained assignments.

## 5. Optional rich-attribute models, not a prerequisite for correction

Earlier discussion considered an attributed assertion: “for this material,
under this dimension and definition, this value is proposed or accepted, for
these reasons.” Independently correcting such assertions would need explicit
identity. The owner's subsequent document-based correction loop does not
require introducing that lifecycle first.

That is not yet a decision to add a `Claim` table, a graph database, or a
universal schema builder.

| Option | Good at | Fails or becomes awkward when |
| --- | --- | --- |
| A. Existing string Tags and free-form Notes only | Manual labels, explanation, familiar filtering | Programs need typed ranges, conflicting sources, per-attribute correction, or reliable distinctions between missing and negative |
| B. Constrained structured content within existing description/metadata mechanisms, with rebuildable query projections | Reusing source, revision and recovery concepts | Per-property edits, independent acceptance, or conflicting sources have no explicit identity and are patched into a blob informally |
| C. Explicit independently addressable attribute assignments | Individual correction, provenance and efficient structured retrieval | The design expands into arbitrary records, joins and business workflows unrelated to content |

These are alternatives if richer reusable attributes prove necessary, not
three new systems or the selected representation of lists. For the current
direction, start with retained information, correction documents and structured
list results. Investigate B before C only when a concrete use needs separately
queryable attributes. Do not equate “one JSON field” with simplicity or
“another table” with complexity.

Search scale alone can justify a rebuildable index over B; it does not prove
that a new authoritative store is necessary. Cross-source conflicts likewise
require explicit identity and resolution, not necessarily one physical layout.
The choice needs a recovery/compatibility comparison, not intuition.

Existing description metadata is not an automatically authorized escape hatch.
New durable meaning, its validation, query behavior and authenticated recovery
binding need review even when no database migration is required. Recovery of
arbitrary new metadata semantics was not established by this audit.

Preserve old Tags exactly, including strings such as `genre:jazz`. Do not
reinterpret punctuation as a newly invented namespace. An explicit mapping
may connect an old label to a dimension while leaving the original unchanged.

### Dimensions across methods

Use a small shared vocabulary where meaning actually matches, namespaced
extensions elsewhere, and explicit mappings between compatible definitions.
A custom music key or project key is data, not a reason to add a new host
subsystem. A definition may need type, cardinality, unit/scale, allowed values,
and version. Defer automatic ontologies and automatic synonym merging.

Two “mood” dimensions with different scales are not interchangeable. Two sites
copying the same list are not two independent confirmations. Record known
attribution chains and uncertainty; do not promise perfect detection of copied
or AI-generated sources.

## 6. Skill responsibilities and execution

The [Agent Skills format](https://agentskills.io/specification) provides a
portable directory with instructions, metadata and optional supporting files.
It does not itself define Cairn's durable output semantics, enforce read
permissions, or supply transactions and recovery.

Proposed division:

| Skill or AI client | Cairn |
| --- | --- |
| Investigation method, examples, source selection, inference heuristics | Authorized subject scope and bounded data access |
| Proposed dimension definitions and outputs | Validation against understood definitions and current revisions |
| Evidence and limitations of the result | Retained provenance, user decisions and conflict handling |
| Suggestions for useful views | Query/publication meaning and exact original takeout |

Avoid a second Skill language. Reuse ordinary Skill instructions; define only
the narrow, versioned result declaration needed for compatible submissions.
Those declarations grant no permissions.

The existing
[external AI contract](../requirements/external-ai-and-semantic-extensions.md#12-external-ai-harness-boundary)
places prompt/planner execution outside the content authority and prohibits
persisting AgentRun or agent-memory resources. Follow it. Retain only the
derivation information needed to understand a saved result: method digest,
referenced input revisions, evidence, declared producer/configuration,
output identity and time. A correlation identifier need not become a run
resource, scheduler, conversation store, or agent dashboard.

An ordinary imported chat transcript remains content. That differs from
making Cairn retain its own agent's working conversation as execution state.

A local AI client may use a remote model. Separately consider original-byte
access, remote inference disclosure, and external lookup disclosure. A query
containing private project names can disclose information even when no file
is uploaded. Local execution and external execution are placement choices,
not permission categories.

A bounded first-party executor need not imply an agent operating system, but
it is not admitted here. Keep result interoperability independent of a
particular executor. This research adds no runtime plugin loader.

## 7. Automation, corrections and retained understanding

The owner selected per-method automation. A method may suggest destinations;
only a method-and-view combination explicitly enabled by the owner can use
its machine results automatically. The host enforces that choice. Downloading
a Skill or changing its configuration never grants that permission.

Recommended future behavior:

- Candidate machine results remain attributable and distinguishable from user
  labels, including when an approved view policy consumes them automatically.
- Writing human Tags still follows confirmation. Automation of a derived view
  is not permission to rewrite the owner's labels.
- Retain the agreed human correction as an ordinary document, independently
  of replaceable generated list results.
- Refresh examines changed inputs and changed method versions when requested
  or allowed. It need not repeat inference for unchanged information.
- If relevant evidence is withdrawn or conflicts change, show the resulting
  uncertainty; do not silently invent a replacement value.

### Selected correction loop

1. Discuss the unsatisfactory interpretation with an AI client, for as many
   turns as useful.
2. Retain the agreed explanation or organizing instructions as an ordinary
   document. It can concern one item, one list, or a reusable method; state its
   intended applicability in the document or its ordinary associations.
3. Later organization reads the relevant current document together with
   authorized source material. A saved document that is never supplied to the
   organizer cannot affect its output.
4. Generate and commit an updated list. The owner permits replacement of the
   previous generated or manually edited list result.

For example, the owner explains that the “dreamlike piano” list may include
soft strings but should exclude prominent percussion. Retain that instruction,
then use it to regenerate the list. There is no need to remember every manual
removal as an independent permanent exclusion.

This is contextual guidance for an existing LLM, not training or a promise
that its internal understanding will change permanently. The organizing
client handles the conversation; Cairn retains the resulting document.
Retaining a transcript separately as ordinary content remains optional.
No AgentRun, conversational-memory service or special correction entity is
needed for this product direction.

List replacement does not authorize replacing the source originals, erasing
the correction document, or rewriting unrelated user Tags. The earlier
per-assignment supersession and method-exclusion ideas remain optional
alternatives, not requirements for the selected loop. No persistent
pin/exclude/lock system is selected.

**Restore retained results; do not promise to reproduce inference.** The same
model name and prompt may produce different outputs later. Retain accepted
results, human corrections, relevant definitions and evidence, and the
machine results used by a retained publication. Unreviewed unused candidates
need an explicit retention choice; they are not guaranteed regenerable.

An index can be rebuilt from retained semantic data. A transient published
cache can be rebuilt from an identifiable view and input state. A publication
advertised as historically reproducible must retain its selected membership,
order and required input versions or equivalent frozen representation.
Keeping unlimited historical publications is not required.

## 8. One program-facing list, independent of its producer

Use **list** for the owner's “dedicated index.” People, LLMs, scripts and
saved-query evaluations can all produce the same kind of result. Applications
should not need separate readers for an “AI list,” a “manual list” and a
“rule list.” Preserve source information without turning origin into a type.

The list does not have to contain instructions for generating itself. A query,
Skill, script or manual action can stay outside it. “Generated by” is
provenance, not a requirement that the list carry a scheduler or agent.

The minimum result concept is a stable name/identity, ordered material
references, and useful per-entry context. A compatible program should know
what each field means, which material revision an excerpt describes, and what
to do when a reference is unavailable. Display names and filesystem paths
alone are insufficient stable references.

Context belongs at the narrowest useful scope. A recording's observed duration
or a correction to its instrumentation belongs with the material. “A good
opening track for this evening” and its place in this list belong to the list
entry. The same music can have different selection reasons and ranking
influence in another list without changing its global Tags.

A reusable list still needs consistent updates. Whatever produces it uses
the same authorized submission semantics, checks the state it intends to
replace, and either commits a complete valid result or leaves the old result.
This does not prescribe whole-list replacement as the only update API:
full replacement and edits can eventually share the same commit boundary.
Version and format identifiers can remain implementation details; no visible
history manager is required.

For example, a background organizer reads revision 3, then the owner changes
the list to revision 4. Submission based on revision 3 should conflict,
retaining revision 4. A fresh authorized regeneration can read the current
state and applicable correction document, then replace the list. The owner
does not require that every manual entry edit survive that regeneration.
Consistency checks prevent stale writes; the correction document carries
the reusable intent.

### Reuse before adding another organization system

SavedView saves how to select; a list retains a particular organized result.
A saved query can be one list producer. ExportManifest freezes an actual
takeout plan from selected material; it retains that responsibility.
The unimplemented LinkGroup plan overlaps explicit membership and output
paths. Compare replacing or evolving that plan before implementing a second
parallel list system; current contracts do not authorize such a merge.
The transient music queue can remain playback state over a list.

The owner selected standard system-readable content using existing storage.
The concrete encoding and any catalog/search projection remain design work,
not permission for a separate list storage authority. Calling a JSON file a
list does not automatically supply understood references, edit conflicts or
recoverability. Do not hide an unsupported list type in Description metadata
or an ExportManifest merely to avoid discussing a real contract change.

The earlier view, publication, search-index and adapter distinctions are
implementation responsibilities, not four product entities. Reuse them only
where their actual semantics fit. Add a search index only when a consumer
needs query acceleration; a different list does not require another database.

A refresh should build the replacement before making it current. A failure
leaves the last successful generation usable and visibly stale, rather than
publishing an empty successful list. Stable pagination must stay within a
generation; ordering needs an explicit tie-breaker. Coverage should identify
which material was examined and which was excluded, unknown or unavailable.

Publication does not grant original-byte access. A consumer resolving a file
still needs the ordinary authorization and exact-content path. Previously
exported local copies cannot be remotely revoked by changing a view.

| Consumer | Plausible first delivery | Limits |
| --- | --- | --- |
| Local music player | M3U or another supported playlist format over materialized original files | The player must support the actual audio formats; a JSON list is insufficient |
| Chat or project reader | Markdown index with links to exported transcripts and retained source anchors, or a first-party reader of the result contract | There is no universal chat-viewer interchange format established here |
| Remote or large-library client | Bounded, version-aware, authorized result reads, potentially through the existing adapter architecture | A future read contract is needed; this is not implemented streaming, transcoding, or a media-server gateway |

Missing members stay visible in Cairn's logical result with a reason. A playback
adapter may omit an unplayable entry only with a visible skipped-items report;
it must not silently redefine the authoritative membership. Refresh and file
movement need a deliberate export policy, not source deletion or an implicit
filesystem synchronization service.

Reading stored fields and evaluating their deterministic rules requires no AI.
A new request needing information never retained may still require enrichment,
semantic candidate search or human input. “No AI on reads” cannot mean that all
future questions have already been answered.

## 9. Two paper walkthroughs

These are illustrative reasoning cases, not observed user data or shipped
features. No detector output or confidence score below is a measured result.

### Dreamlike piano listening

- Inputs: two audio files, Notes, and authorized metadata.
- Method: investigate recording identity and external curation context; only
  inspect audio if an available capability and authorization support it.
- File A appears in two websites' copies of one “dreamlike piano” compilation.
  Retain this as one known curation lineage, not two independent proofs.
- The title matches, but the recording identity is uncertain. Preserve the
  match uncertainty instead of attaching recording-specific facts as certain.
- A proposed mood interpretation can enter a designated exploratory view under
  its policy. A strict “verified instrumental” view excludes unknown vocal
  status and explains the exclusion.
- The owner says File B has strong strings and should not count as piano-led.
  That correction changes the resolved attribute. It does not mean the owner
  dislikes strings in every other view.
- A consumer list can be regenerated without AI from accepted information and
  selected machine interpretations. An export adapter supplies playable paths.

The program receives the ordered music references and optional display
information/reasons. It follows those references and presents or plays them
through a supported delivery path. It does not need to rerun the method that
decided the order.

### Project decisions from conversations

- Input: an exported conversation file containing several projects.
- Method: identify project references and candidate decisions, quoting source
  spans and distinguishing proposals from accepted choices.
- “We could use option A” is a proposal, not a final decision. A later message
  saying “choose B” can support a superseding interpretation.
- Assignments may reference different spans in the same retained file.
  Existing semantic segments provide a starting point for anchoring, not a
  claim of a complete stable conversation-message model.
- A project view publishes selected excerpts linked to the exact transcript.
  It must not label a decision “current” when the input lacks enough temporal
  context.
- Updating the transcript changes the input revision. Old offsets cannot be
  silently reused for new bytes.

The program receives transcript references plus selected excerpts, source
locations and short context. Those fields are already organized for display;
it need not ask an LLM which passage was selected. A new question requiring
different interpretation remains a new organizing operation.

Both cases use original material, method, attributed interpretation, resolution,
view and delivery. Domain-specific dimensions are allowed as data. If a use
case needs a task scheduler, live home-device control, a new business workflow,
or an independent work/recording catalog, that need deserves a separate scope
decision rather than hiding it inside a tag.

## 10. Q&A

| Question | Working answer and counterexample |
| --- | --- |
| 1. Is Skill a replacement for storage or search? | No. It describes how to produce useful understanding. Originals, retained descriptions, search and takeout remain useful when the model is offline. |
| 2. Must users write Skills? | No. Useful defaults and editable natural-language methods are the normal path. A platform valuable only after writing a custom method is a weak everyday product. |
| 3. Can originals and Notes alone be the entire database? | They can be the simple intake experience. Machine-consumable organization still needs explicit values and provenance; parsing free text again on every read defeats the goal. |
| 4. Does this require a new tagging AI model? | Not initially. Define assignment meaning and correction first. A custom learned model needs a demonstrated quality gap, not just the word “weight.” |
| 5. Does lowering a tag mean the AI was wrong? | Sometimes. It may instead mean less attribute strength, distrust of one source, or less preference in one view. A generic downvote cannot reliably express all four. |
| 6. Is a human correction objectively true? | Not necessarily. It has authority in the owner's organization. Keep subjective preference and evidence strength distinguishable. |
| 7. Can a Skill automatically update a list? | The owner selected per-method opt-in behavior for designated lists. That does not authorize changing human Tags or all lists. |
| 8. Does accepted mean certain? | No. The owner may accept a useful interpretation despite uncertainty. Record acceptance separately from evidence quality. |
| 9. Does no “vocals” tag mean instrumental? | No. Unexamined, unknown and explicitly absent differ. A playlist title cannot establish acoustic absence. |
| 10. Do three agreeing pages prove a result? | Not if they copy one source or refer to a different recording. Evidence count alone is not independent corroboration. |
| 11. What happens to conflicting Skills? | Preserve attribution and apply a visible resolution policy. Matching label text is insufficient when scales or subject granularity differ. |
| 12. Will a rerun undo a correction? | Keep the agreed correction document and supply its relevant current content to the organizer. The resulting list may be replaced, including prior manual entry edits. Supplying instructions improves context; it does not guarantee an LLM follows them perfectly. |
| 13. Does disabling a Skill erase its results? | No. Stop future use as configured; separately decide whether a view should exclude its prior results. Human amendments stay. |
| 14. Can the original model reconstruct everything after a loss? | No. Retain valuable results and their definitions. Restoring data and rerunning inference are different operations. |
| 15. Is description metadata enough? | Possibly as a carrier, after explicit contracts. An arbitrary JSON blob is not a specification, index, or recovery proof. |
| 16. Will old Tags change meaning? | No automatic parsing or migration. Explicit mappings can relate old labels to new dimensions without changing their stored strings. |
| 17. Do ordinary applications need to understand Skills? | No. They need a supported result/delivery contract. The method executes upstream. |
| 18. Can every music player read the result? | Only through a format and file-access method it supports. A list does not supply codecs, streaming or authentication support. |
| 19. Is a new index needed for each app? | Usually not for lists. Reuse retained data and shared query capability; specialize acceleration only for an observed workload. |
| 20. Is a file always the right subject granularity? | Not for every assertion. Source spans may suffice for excerpts; independently managed clips, works or messages need a separate identity decision. |
| 21. Can the same method handle a new content type without host code? | Often for interpretation using existing inputs. A new binary decoder or unsupported modality is a genuine capability gap; a Skill cannot make it exist. |
| 22. Can “everything in the home” use this approach? | Retained observations and documents may compose naturally. Control loops, live telemetry and household automation are separate systems, not automatic consequences of storing descriptions. |
| 23. Is the library becoming an agent runtime? | The recommendation keeps execution separate from retained content and results. No AgentRun state or runtime plugin system is proposed. |
| 24. Can every list be fully automatic and stable? | Not at once under changing uncertain inputs. Choose freshness/acceptance policy and publish explicit generations; show stale or incomplete results honestly. |
| 25. Are AI-generated and human-created lists different types? | No. They share result and update semantics. Origin is provenance; it does not force a separate storage or application integration. |
| 26. Does every list need a Skill or refresh rule? | No. A person can keep a list manually. The method that last updated it is not part of its identity. |
| 27. Does every useful judgment become a global Tag? | No. A list-specific reason or preference stays with its entry. Reusable information about the material can remain in its Notes or structured description. |
| 28. Can a list simply be ordinary structured content? | This is now the owner's selected direction: a system-understood record type using existing storage. The format and reference/update contract still need definition. |
| 29. Can source information be reduced to attributes? | No. Preserve valuable original wording, source context and generated outputs. Direct structured input is also valid original information and need not be rewritten into prose. |
| 30. Does an expected-version check preserve all human intent? | No. It prevents stale overwrites. The owner permits later authorized replacement and uses a retained correction document to express intent for subsequent organization. |
| 31. Does shared information mean public file sharing? | No. It means reusing the same material's information across the owner's lists. Public links and multi-user sharing are outside this discussion. |
| 32. Does saving the final correction document make the LLM learn it forever? | No. Relevant future organization must actually receive that document. The conversation can stay in the AI client; the resulting instructions are ordinary retained material. |

## 11. Reference patterns and differentiation

Official sources were read on 2026-10-20. Borrow their useful ideas without
claiming that any individual mechanism is new:

| Reference | Relevant observation | What to borrow; what it does not prove |
| --- | --- | --- |
| [Agent Skills specification](https://agentskills.io/specification) | Reusable instruction packages can include supporting material and load progressively | Reuse the method format; host authorization and durable result semantics still need their own contracts |
| [Hydrus tagging FAQ](https://hydrusnetwork.github.io/hydrus/faq.html) | Namespaced tags support finding media; exhaustive description can become a distraction | Preserve practical search-oriented labels; hashes plus tags are not a unique Cairn invention |
| [MusicBrainz folksonomy tagging](https://musicbrainz.org/doc/Folksonomy_Tagging) | Users can vote on tag associations | Association votes have a defined social meaning; they are not automatically calibrated confidence or acoustic strength. The page itself carries an unreviewed notice |
| [Apple Music Smart Playlists](https://support.apple.com/guide/music/create-edit-and-delete-smart-playlists-mus1712973f4/mac) | Criteria and live updating produce useful lists without repeated AI reasoning | Deterministic views are an established pattern. The open Cairn question is how reusable methods produce correctable inputs to those views |
| [Anytype Queries](https://doc.anytype.io/anytype/organize/queries.md) | Queries present matching objects through their properties | Views need not own or duplicate their members; a general personal database is already an established category |
| [W3C PROV overview](https://www.w3.org/TR/prov-overview/) | Provenance distinguishes entities, activities, agents and derivation | Borrow attribution and derivation concepts, not an RDF database or full provenance framework by default |

The opportunity is the combination: user-defined organizing methods over
retained originals, correctable attributed understanding, and reusable results
that ordinary consumers can read. Its usefulness, quality and effort savings
are hypotheses. This research does not establish superiority over specialist
music software, tag managers, note systems, or personal databases.

## 12. Consultation record and remaining disagreements

Three actual headless DSH exchanges completed using the configured
`claude-opus-5-5` route in session
`session-fbc79c9c-2702-49bd-bdd8-7d710d26ff84`.
This identifies the requested/configured route, not independent verification
of an upstream provider's model implementation.

Round one compared product forms, proposed a claim/dimension/run/publication
model, and challenged weak evidence and application interoperability.
Round two challenged that recommendation against the existing code and the
owner's request for simplicity.
Round three addressed the owner's producer-neutral list clarification and
compared “material / descriptions / lists” with “material / lists.” It
recommended the latter, with organizing methods outside the core user
vocabulary and list-specific context kept separate from reusable description.

The second round explicitly corrected several first-round overstatements:

- Tags can express preference, not just objective facts.
- Raising or lowering influence is not always view ranking.
- Retained AI results cannot be assumed reproducible by rerunning a model.
- A separate persisted Run resource is unnecessary.
- Users need not write Skills or routinely inspect evidence for the system to
  benefit from reusable methods and provenance.
- Exact recovery is a foundation, not the only possible product advantage.

The primary review also rejects several remaining shortcuts:

- Structured metadata versus separate assignments is not settled by table
  count. Independent semantics matter before physical layout.
- Shared-result infrastructure and a useful first-party client are not an
  either/or choice.
- A conversation span is not automatically a new domain subsystem; evaluate
  reuse of existing source anchors before inventing message entities.
- Missing media should not silently disappear from the logical result merely
  because a player cannot express its missing state.
- A limited source count or an externally reported model version does not
  establish truth, source independence, or deterministic reproducibility.
- Two user concepts are a useful working simplification, not a proof that
  further physical unification is impossible.
- A dimension needs understood meaning, not merely a key name; this does not
  require a dimension-management product.
- Retained attributes can be direct user input or valuable structured output,
  not only indexes regenerated from prose.
- Round three's proposed permanent pins and exclusions add persistence
  semantics beyond the owner's confirmed Tag protection. The owner subsequently
  chose replaceable list results plus a retained correction document instead.
  Version checks alone do not preserve intent.
- Existing files may be imported chat transcripts. Avoiding agent execution
  state does not ban retaining those originals as ordinary material.

Local working evidence is retained under
`dist/skill-native-rethink-20261020/`: all three prompts, JSONL replies, extracted
answers and completion metadata. It is not a required published-document
dependency and contains no intended product implementation.

## 13. Decisions and next reasoning steps

| Item | State |
| --- | --- |
| Skill, not SQL | Owner confirmed |
| Careful underlying design before implementation | Owner confirmed |
| Retain original information and reuse existing LLMs | Owner confirmed; no dedicated-model training proposed |
| Producer-neutral lists for program use | Owner confirmed; AI/manual/rule generation does not create different list types |
| Fewest concepts, composition before expansion | Owner confirmed design principle |
| Material plus lists as the user vocabulary | Lists are a system-understood type of ordinary material; no separate storage authority |
| Per-method automatic participation in designated lists; human Tags require confirmation | Owner confirmed as future behavior |
| Shared reusable organization with useful first-party consumers | Recommended, not a replacement normative North Star yet |
| Existing Tags retained; richer assignments distinguish values, evidence and preference | Recommended logical direction |
| Constrained description metadata versus independent physical assignment storage | Open |
| Standard structured content using existing storage | Owner selected; three-part body and example notation are proposed in the linked draft, not implemented |
| Replacement of manually edited list results | Owner permits authorized regeneration; persistent entry locks/exclusions are not required |
| Correct AI understanding through discussion and a retained document | Owner selected; future organization must read the applicable current document |
| Consumer publication contract and any new typed API | Open; not implemented or admitted |
| Retained inference provenance, not AgentRun execution state | Consistent with the existing authority boundary |
| Automatic retirement of unused candidates and retention of publication history | Open; no silent deletion policy selected |

The [next design draft](../technical/material-list-and-guidance-draft.md)
now develops the following three questions using the paper cases above rather
than expanding the core vocabulary. Reference encoding, authoring/current
resolution and implementation admission remain open:

1. **One small content format:** work out the minimum list reference, entry
   context and update semantics inside the existing storage. Reconcile
   SavedView, ExportManifest and the unimplemented LinkGroup plan rather than
   adding a parallel organization system.
2. **Correction inputs:** show how an organizer obtains the relevant current
   instruction document and retains which source revisions informed its
   output. Keep this an ordinary content-use flow, not an agent-memory system.
3. **Use and compatibility:** follow one list into a first-party consumer and
   one real external format, then assess recovery and compatibility. Only
   after that should normative changes, an ADR and one bounded implementation
   milestone be proposed.

This is a reasoning sequence, not a new competing implementation queue.
Do not launch another broad test campaign or rewrite the storage kernel to
make the proposal appear concrete.

Evidence that would change this recommendation includes: existing Tags and
Notes solve the representative needs with comparable effort; every new
interpretation requires custom host code rather than declarative fields;
corrections and uncertainty make the everyday workflow substantially harder;
or consumer delivery costs outweigh reuse. Unsupported binary decoding is a
separate capability limit, not evidence that every method needs a new host.
Infrequent evidence inspection and choosing built-in methods are not failures.
