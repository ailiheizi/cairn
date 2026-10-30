# Private space with a floating assistant: frontend and product priority

**Date:** 2026-10-30.
**Status:** owner-confirmed priorities, with a proposed frontend design below.
Documentation and illustrative concepts only; no application implementation
or new capability is claimed by this record.

**Subsequent implementation approval:** The owner approved the result-to-use
prototype and requested implementation. The bounded host-search/ordinary-list
layer is covered by the [floating-results plan](../plans/2026-10-30-floating-results.md)
and the first-party client contract's 2026-10-30 refinement. That layer does not
turn the broader conversation or calendar examples into delivered capabilities.

## Owner decisions

- Keep Home's existing private-space content presentation. The owner's latest
  correction supersedes the earlier input-first/workbench Home interpretation:
  put a unified AI input in a bottom-centered floating layer, without reflowing
  the content. A dedicated conversation surface opens for focused use.
- Improve the single-machine, single-owner experience first. The desktop Web
  client remains the current delivery surface.
- Concentrate current work on frontend, UX and product flows. DeepSeek Harness
  code adoption, broader executable plugins and commercialization are future
  ideas, not active implementation tasks.
- The owner's latest clarification prioritizes a useful, enjoyable open-source
  project that people want to keep using. Commercialization is an optional future
  idea, not the assumed final destination. The earlier signup-and-use multi-user
  website preference remains only a possible future direction; account, hosting,
  tenancy and billing design are not part of the current work.
- Preserve simplicity and reveal controls when needed. Existing specialist
  surfaces should remain comfortable to enter and return from.
- The owner initially preferred the third metallic concept, **Expanded Workbench**,
  but rejected the subsequent interaction mock because the whole product felt too
  much like a generic chat application. Its use as the Home baseline is withdrawn.
  Keep material + text input, contextual retrieval and continuity inside the
  assistant. Future voice should consider tap-to-toggle and press-and-hold;
  real speech implementation is not requested.

## Confirmed product purpose and scope

The owner endorsed the framing **AI personal-content space**: help people find
and use what they have saved, reuse their existing material and context, and
deliver something directly usable that can also be saved for continued use.
The current goal is a good open-source product with room to grow. Feature count,
commercial packaging and a promise to replace every personal application are
not the measures of success.

Here, **understanding** means enabling AI to use the material's content,
references and the owner's explanations or corrections to perform the requested
task. Users should not need a new taxonomy to supply that context. Inferences
remain distinguishable from source facts and personal preferences; this objective
does not claim perfect understanding or a general AI runtime already delivered.

Reuse the existing forms: originals and ordinary documents; Notes/tags and linked
context; Skill text for reusable organization guidance; ordinary lists for
organized results and program consumption. Context and results remain ordinary
material, not new memory, knowledge or result stores. A result may be useful
immediately through an existing view or action and then retained through the
existing reviewed save flow. Continued use of a saved result does not by itself
require automatic refresh or another model call.

For product decisions, prefer a feature when it improves finding or using saved
content, composes these existing forms, and delivers a usable outcome that can be
retained when useful. These are reuse and value criteria, not authorization for
new endpoints, stores, integrations or execution capabilities. The existing
normative requirements and implementation order still govern delivery.

The resulting product loop is: **save material → use its context → find or
organize → use the result → save and reuse when useful**. Everyday browsing,
playback and takeout remain directly operable without entering a conversation.
The floating assistant supports that loop without replacing the private space.

## Recommended form and alternatives

Home stays a recognizable place to browse Photos, Music and files. The floating
assistant is available above that page, with an independent layout layer. The
current recommendation has three sizes of one interaction, not separate chats:

1. A quiet bottom-centered input strip remains available while browsing.
2. An upward-opening overlay supports a short request, clarification and compact
   actionable results. It may cover part of the page but must not resize its grid.
3. Explicit expansion opens a dedicated conversation surface for multi-turn work.
   Return restores the previous content view, selected material and draft.

The owner requested the floating entry and professional conversation. The precise
choice to support short exchanges in the overlay before explicit expansion is the
assistant's proposal, demonstrated for review. Do not automatically switch to a
full-page chat just because the user focuses the input or submits a simple query.

The workbench-as-Home approach is rejected. A permanent side chat was considered
by the assistant but would continuously compress specialist content. A floating
overlay preserves the existing content composition; its cost is temporary occlusion,
so it needs a compact collapsed state and obvious close/return controls.

All concepts contain illustrative local samples. They are not a running AI/search/
save integration or evidence of application delivery. The latest prototype is a
single continuous floating-to-expanded interaction, with simulated replies and
page-memory state. It does not replace the running application.

## Screen states and progressive disclosure

| User moment | Primary visible content | Content revealed on demand |
| --- | --- | --- |
| Arrive | Existing content-led private space, with a narrow bottom-centered floating input | Assistant, ordinary content destinations and management |
| Type or attach | An overlay opens upward; one draft with removable references; surrounding grid stays in place | Relevant material actions and context details |
| Resolve intention | A clear request leads to its result or save preview; an ambiguous attachment gets one compact contextual choice | Find, find similar, save or use with existing material when relevant; no permanent mode taxonomy |
| Find | A concise response and compact real-result cards inside the overlay | Sources, full results and an explicit expanded-conversation action |
| Prepare a save | Actual pending text/files and one clear confirmation; unsaved status until the host confirms | Filename, Notes and existing applicable save options |
| Continue in depth | Same conversation, draft and material in a dedicated page | Earlier conversation, material inspection and applicable organization guidance |
| Open a result | Existing specialist surface from the overlay; optional adjacent original preview during full conversation | Secondary item actions, matched source and exact takeout |
| Return | Original content page and browse position, with assistant collapsed or floating; independent playback continues | Reopen the same conversation without losing the draft |

The idle Home should not become a conversation canvas or acquire a permanent chat
history sidebar. The floating input and its response share a visual axis; only the
assistant changes size. Do not dim or disable the entire page for an ordinary short
request. Opening the assistant is optional for browsing or playing content. Long
answers belong in the expanded surface; original previews should not stack several
drawers over one another. The full conversation's return control must be visible.

## Dedicated conversation: proposed feature boundary

- **Continuous conversation:** follow up, correct an earlier request, stop the
  current request and return later. Draft/context survive expansion and collapse.
  A history entry is access to conversations, not a second content library.
- **Material-aware input:** attachments, selected saved objects, references to
  current results and optional existing Skill text. Show what this request uses;
  do not silently attach every file on the background page.
- **Inspectable answers:** concise explanation with linked source material and
  operable photo/file/list results. Open the original beside a long conversation
  only when requested. A model's explanation is not its hidden chain of thought.
- **Useful completion:** open/play/take out through current host actions, or
  present a candidate and explicit save preview. Distinguish a suggestion, a
  pending action, a confirmed result and a failure. Do not claim a general undo
  or arbitrary file editing capability that the host does not supply.

History, model connection settings and reusable organization guidance are on-demand
secondary controls; no toolbar of every AI option. Existing ML-3 Skill/candidate
capabilities remain bounded by their own approved contract. General conversation,
durable chat history and free-form tool execution are design topics here, not new
backend admissions. The prototype's previous-conversation return is page memory only.

The permanent Find/Save switch in the earlier proposal is superseded by this
interaction exploration. One input can serve several purposes; the operation
being proposed still needs to be legible before a write. Clear retrieval should
not require an extra intent confirmation. An ambiguous request should get one
contextual clarification instead of a settings panel. Saving must show the actual
pending content and retain the existing confirmation flow. A typed sentence
mentioning tomorrow is ordinary text, not a scheduled reminder. Searching cannot
silently save its input. Enter/Shift+Enter and IME composition remain predictable.

This proposed behavior does not admit general natural-language tool execution.
The prototype uses a small explicit sample vocabulary, not AI inference. A later
frontend implementation must reuse existing explicit actions or separately resolve
any missing interpretation capability; it cannot claim an AI service from this demo.

## Context and voice interaction proposal

Keep persistent personal material, the current search target, and material supplied
to a request distinct internally. Do not ask users to create three containers:

- A compact **This time uses** disclosure shows effective temporary references,
  any explicitly carried object/result and removable items. Removing a reference
  does not delete its saved original. Dropping an external file does not save it.
- **Search in** is a separate scope choice, initially personal material. Permission
  to search the catalog is not permission to send its contents to a model. Any
  actual model handoff keeps its existing explicit disclosure and bounds.
- A refinement such as "only photos" stays with the visibly current result.
  Referring to an open object is shown beside the composer; a vague reference is
  clarified when more than one target is plausible. Inspecting a file does not
  silently enroll every surrounding file into the next model request.
- Start a new task explicitly when the goal changes. Clear temporary references
  and prior result focus, while keeping saved material and independent playback.
  Preserve an unfinished draft for return rather than losing it. The prototype
  retains one previous draft in page memory; it is not persistent task history.

These distinctions exist to prevent mistaken saves and surprising context carryover,
not to create task management, folders, a second conversation database or a new
membership model. An earlier result may be inspected again without being automatically
included in the current operation.

Voice is another way to produce the same input draft. Tap starts recording and a
second tap stops; holding starts after a threshold and releasing produces a draft,
with an accessible cancel action and an optional move-out cancellation gesture.
Keyboard users retain a toggle action. Transcription remains editable and may be
combined with attachments. Stopping recording does not execute a write. Capture,
transcription, review and execution need distinct visible states; cancellation or
failure preserves the preceding draft. The current concept simulates a fixed phrase
and never requests microphone access. Mobile layout and real speech-provider choice
remain future work.

Show real empty, no-match, working, failed and saved states where relevant.
A failed save preserves the draft. A no-match result offers refinement or
ordinary Library browsing. Do not imply that local filtering searched the whole
catalog. Keep actionable errors visible when secondary controls are closed.

## Reuse and functional delivery sequence

1. **Preserve Home and add the presentation layer.** Keep content dimensions and
   ordinary navigation stable while the assistant opens, expands and returns.
   Reuse current material context; do not manufacture personal history to fill it.
2. **Connect the admitted finding and saving actions.** Reuse `useSearch`, the current SourceDrawer
   text/file intake, reviewed confirmation and existing result actions. Surface
   a coherent composer and response area instead of duplicating their state
   machines. Keep query and capture drafts distinct internally.
3. **Polish expanded conversation and the result-to-use transition.** Reuse Details, Notes, verified
   playback, Photos/Music/Videos and original takeout. Preserve current source,
   draft and selection semantics through expansion and return. Improve each
   destination only where the same user journey exposes a rough edge.

This is the proposed frontend sequence, not a second core execution plan. Before
implementation, reconcile any changed shared-input/presentation detail with the
[first-party client contract](../../requirements/first-party-client-experiences.md).
No endpoint, provider, durable schema, new content authority or general agent
loop is part of these frontend steps. Existing AI list candidates retain their
current explicit operation and disclosure; they are not a general chat service.

One planned acceptance journey after integration: save a short text/file through
the input entry, find it, inspect the actual result, take out the original, enter
an existing media surface and return with context intact. Check an unsaved-draft
and a real empty/error state in that journey. Documentation work runs no app
tests; later local checks follow observed failures or concrete uncovered changes,
not a new broad test campaign.

## Future ideas only

Harness-powered conversation/tool execution, broader plugin composition,
natural-language file editing, hosted signup and commercialization remain
recorded aspirations. Their architecture, implementation, deployment and
business model should not consume the current frontend batch. The earlier
hosted preference is retained as one optional future idea. Open-source product
quality is the current goal; no commercial destination or tenancy topology is
selected by this record.


## Owner visual follow-up after integration

The owner requested closer visual fidelity to the approved result-to-use demo.
The local implementation uses a shared neutral canvas and restrained violet
metal accents in light/dark, an image-first photo feature, a quiet vinyl music
feature, one bottom floating composer, and a spacious usable-list result. Header
navigation stays concise; ordinary advanced search is disclosed through its
existing menu. These presentation refinements change no content or AI authority.
The implementation plan records the bounded local journey and visual checks.
