# Whole-Product Delivery Target

> Informative product delivery record, 2026-10-06. The operator requested
> continuation toward the entire product, with the primary agent deciding and
> Luna implementing. This record defines the outcome to keep in sight; it
> changes no normative requirement, admitted format, implementation order, or
> phase gate. The [Core MVP Execution Plan](core-mvp-execution-plan.md) remains
> the only implementation order. The canonical requirement matrix remains in
> [Content Store, Views, and Export Requirements](../requirements/content-store-views-and-exports.md).
>
> Immediate work follows the 2026-10-07 experience-first operator update in
> [Content-First Product Decision](content-first-product-decision.md#operator-priority-update-2026-10-07): use the local Mac/browser preview; Docker is the deployment direction, not current packaging work. Linux/container compatibility qualification is reserved for a concrete deployment issue or release requirement.

## Intended result

A useful personal content library for one self-hosted operator: put readable
files in, find them through familiar clues, use them through suitable views,
and take out the original bytes. The same content, tags, Notes, protection,
access, and recovery authority follows the operator through every view.

The first audience is NAS and home-storage enthusiasts. Cairn remains
the working name. Product appeal should be demonstrated by ordinary tasks and
recognizable content; demand, retention, and traffic still require actual user
feedback. Deduplication and compression support the product's economics while
the user-facing task stays intake, retrieval, use, and takeout.

## Delivery decisions

1. Ship useful first-party experiences over shared flows. Each vertical earns
   depth through the tasks it completes, rather than through a separate
   catalog or a page for every requirement.
2. Keep the deployment profile single-person. Multi-user tenancy, shared-user
   authorization, and a public third-party execution runtime remain separate
   future decisions. The bundled contribution boundaries in ADR-019 are the
   present extension direction.
3. Make theme selection change the whole interface composition, as ADR-021
   specifies: shell, navigation, presentation, and bounded action placement.
   Palettes are a secondary choice. Shared drafts, selected subjects, ongoing
   operations, readable errors, and safe fallback must survive switching.
4. Treat core qualification, browser task completion, and media format support
   as separate evidence dimensions. Record the exact supported scope for each
   result. Every selected capability must have an ordinary complete path.
5. Prioritize local Mac/browser experience work now. Docker is the selected
   deployment direction, but does not make Docker packaging the current task.
   Separate Linux/container compatibility checks belong to a concrete
   deployment issue or release requirement; this priority does not claim that
   containers remove runtime or architecture differences. Normative supported-
   host and other release gates remain unchanged.
6. Keep the whole-product objective active after a slice passes. A slice's
   passing test updates that row only. The full objective closes after every
   selected outcome and its applicable core gate has executable evidence.

## Whole-product outcome matrix

This table is an acceptance outline and gap map. It does not authorize the
future rows or change the current lock. `Partial` means an admitted path has
development evidence; `gated` means the listed entry review/gates are still
required. No row is release-qualified here.

| Outcome | Ordinary user acceptance | Current boundary | Entry / completion authority |
| --- | --- | --- | --- |
| First use and intake | From an empty library, choose computer upload or an explicit server folder, review protection, confirm, find the saved item, add a tag and Notes, and take out matching bytes without typing internal IDs | Bounded fresh-profile journey passes on the clean lock-exact Web build and v3 Darwin binaries, including source degradation and exact original download; the same six Web assets reproduce on repeat; current preview serves that tree; see the [dated acceptance](first-use-and-source-explanations-acceptance-20261006.md) | Existing bounded browser adapter; Phase 2/3 plan, exact protection and access contracts |
| Mixed-file library | Recognize content, filter by type/format and tags, inspect supported content, see unavailable reasons, retrieve one or several originals | Partial; current listing, bounded text/image inspection and original download/export work locally | Existing browser maintenance; complete facets/discovery at Phase 4, manifest ergonomics at Phase 6 |
| Complete retrieval | Names, metadata, exact identity, tags, Notes, descriptive text and extracted text find the same authorized subject; matched source is explainable; real local semantic search degrades honestly | Partial; bounded corpus checks cover 20/20 lexical fields and 14/14 queries, and the real multi-segment runner passes 44 assertions. The v3 Debian package also passes real fused retrieval, source provenance, reopen, provider-loss and exact-byte checks. Broader corpus and supported-host qualification remain open. | Phase 4; model packaging, provenance, generation and complete field requirements |
| Personal organization | A file may appear in several minimal link groups; missing links stay visible; saved views remain dynamic; frozen exports retain exact selected versions and safe relative paths | Gated; SavedView and legacy flat export have development evidence; minimal LinkGroup remains planned | Phase 6 only after Phase 4 and Phase 5 close; reviewed current-state and export successor contracts |
| Photos | Recognizable image browsing and comfortable supported-image inspection, then shared search/tags/Notes/group selection/original takeout; album-like navigation only through an admitted grouping model | Partial bounded Photos lens and image inspector; dedicated gallery/album behavior remains gated | Review the first-party gallery support/access contract after applicable core gates; existing inspector maintenance may continue |
| Audio | Browse supported audio with useful facts, select and listen through explicitly supported formats, keep playback state understandable, and retrieve the original from the same subject | Current Audio lens is file browsing; playback and music-library behavior remain gated | Reviewed audio access/lifecycle/format and resource contract after applicable gates; no acoustic index or separate collection authority |
| Video and documents | Select and use explicitly supported content, retain navigation/context, surface unsupported format/dependency states, and retrieve originals | Existing bounded file/text inspection; domain reader and playback behavior remain gated | Reviewed first-party format/access/lifecycle contracts after applicable gates |
| Whole-interface choice | At least the bundled workspace and showcase compositions complete the same ordinary tasks; switching and render-error fallback preserve shared operation meaning and state | Partial; two layouts have bounded local acceptance; accessibility, all drawers and broader platform coverage remain open | ADR-021 and API/WebUI interaction contract; no runtime theme loader |
| Reliable self-deployment | Clean install, doctor, offline model installation, restart, backup, upgrade/rollback and independent-anchor clean restore work on the declared supported tuple | Partial Darwin and Linux arm64 candidate evidence: the Darwin current-interface package passes real semantic/lexical queries and catalog-free independent-anchor restore; the first current-source Linux package was blocked by exact ONNX Runtime provenance member-path mismatch before guest/runtime testing. The current Darwin preview runs the 535-input source cohort; promotion retained config and read-only state, search generation, all six Web assets, and catalog-free full-byte verification of 3 files/4,179 bytes. The fresh Darwin native-notices package installed actual pinned BGE/zvec and passed semantic/lexical queries plus independent-anchor 89-byte restore. The live promotion retained the prior installed bundle and generation; it did not install the new native-notices bundle. The earlier 533-input Darwin online installer pass remains a separate historical cohort. Linux provider-loss degradation/recovery also passes. The v2 current-interface package carries 191 full-text records and its six Web asset hashes match the current live tree; Web build linkage remains NOT_ATTESTED, the SBOM is incomplete, and 26 component rows remain UNKNOWN. The Linux candidate consumed a corrected 835-member source archive matching all 535 current Go inputs; an earlier 534/535 source archive is preserved as historical. Its runtime was NOT RUN because two ONNX Runtime notice-source member paths incorrectly include `./`. Broader native/model applicability, redistribution, representative supported-host, backup and upgrade qualification remain open. | Phase 4/5 supported-host evidence; Phase 7 supported packaging/upgrade/backup qualification after Phases 0–6 |
| Recoverable storage | One selected engine verifies exact bytes, survives admitted crash/corruption/relocation/migration cases, and reports all measured overhead and net savings honestly | Raw and zstd development candidates have exact restore evidence; the v3 Linux zstd trial restores 3 files/138,214 bytes catalog-free and refuses a same-length corrupted private copy while preserving the original. The isolated Kopia candidate passes bounded signed API, streaming, unknown-outcome, injected filesystem-write fault, child-process crash, cooperating-process root-serialization, and credential-backed child-reader tests with cold reopen. The reader imported a signed artifact, listed, full-verified and restored 3 files/46 bytes in a fresh child with an external trust anchor. Its local `flock` fixture does not qualify remote/NAS semantics, production wiring, or behavior against non-cooperating writers. It is not production-registered; production credential lifecycle, standard reader/profile admission, broader signed/profile corruption and relocation, retention/migration, placement savings and engine qualification remain open; physical device/power faults are untested evidence scope, not a new gate. | Phase 5 common qualification record; no silent profile promotion |
| Attractive and usable | Content visible early, consistent density and hierarchy, keyboard/focus and narrow-screen access, clear empty/loading/error/offline states; representative users complete the core tasks | Partial responsive and fault tests on generated local content; real-user evidence open | Browser acceptance plus observed usability feedback; no advance traffic claim |

## Work currently admitted

The entries below retain their evidence and status as historical records; the
2026-10-07 experience-first update linked above controls immediate scheduling.
They do not make Linux qualification, package provenance/licensing audits, or
repository-candidate expansion prerequisites for the current local trial.

The current candidate cohort advances the following parts of that same matrix:

- Existing intake surfaces: a usable empty-library starting point and one real
  fresh-profile add/protect/find/tag/Notes/takeout browser journey against the
  reproducible Web candidate and v3 Darwin binaries.
- Phase 4: tokenizer-faithful lexical source and match-span projection with
  persisted-generation and real-daemon evidence.
- Phase 4: a frozen v3 source cohort, real Linux package/install/reopen and
  provider-loss checks, plus a Darwin v3 package smoke and bounded live preview
  promotion that preserves stored facts, generations, byte verification and
  served Web identities. The current preview serves the current lock-exact Web
  cohort; the v3 and earlier native-notices outer packages retain older Web
  assets, while the reviewed v2 current-interface package matches the live six-file set.
- Phase 4: the first current-source Linux arm64 package is BLOCKED before guest/runtime testing: its two ONNX Runtime `tar_member` provenance paths include `./` absent from the exact archive headers. The 535-input source cohort was correctly selected before build (835-member archive; earlier 534/535 archive retained as historical); package license/notice bytes match but source member paths do not. A provenance-path fix is pending.
- Phase 4: the prior 533-input Darwin cohort passed its separate ordinary online installer and smoke. The newer source snapshot contains 835 inputs (tree `55efbff10650c3c7a78ac5c582608885ffffcda849a9c85a4611e230c0d5aa72`); its 535 Go/module/license files exactly overlap the current-source broad-test inputs (tree `fd8657a9d4e11df8db9afb56e760ef8f19047303cf7dd4b005c3a9d8cdd0f3cd`). The serialized broad suite passed 28 test-bearing packages and 6 packages without tests in 281.978 seconds. The earlier native-notices archive `c3781ab6b51e16083d99c87eb98fb60cef98653757831a9e7e16d60c783be923` installed actual pinned BGE/zvec, passed semantic and lexical queries, and restored 89 bytes with an independent anchor and no catalog; its JavaScript and HTML differ from current live Web assets. The current-interface v2 archive `cc75e62c357182df74b8c3216cede4233239fef749ead39556d18ddbe07e9c89` uses those same current CLI/daemon and semantic artifacts plus all six current live Web assets, carries 191 full-text records (53 Go/native/toolchain/project and 138 Web), and passes the same offline install/restart, semantic/lexical query, and independent-anchor restore checks. All 26 linked Go tuples and all six Web asset hashes were cross-checked. Web linkage remains `NOT_ATTESTED`, its SBOM is incomplete, and 26 component rows remain `UNKNOWN`. Model-conversion applicability, native per-file/transitive/source and host-support closure, generated Web attribution, and normative redistribution review remain open. The prior five-URL transport helper was used only for its own native-notices candidate; ordinary online install was not run for the v2 cohort.
- Phase 4: the current Darwin preview promotion now runs PID 57237 from the 535-input cohort with CLI SHA `aa87a00c22dc9261e440b14f4399a2a295a04e0a5eb5c3d4ab2b5f638ac8ad77` and daemon SHA `52b87e4d1e7a885b59a13d6d49b22e1b2e0aaaa59e08f4fe8ea3b4e9d9f179e4`. Configuration, read-only facts, jobs, fused/pinned generation and six Web assets were preserved; catalog-free verification read 3 files/4,179 bytes. The live preview still uses its prior installed bundle and generation; the newer native-notices bundle was tested in a separate fresh package smoke, not installed live. Provider-loss smoke for the newer cohort was NOT RUN.
- Phase 5: a bounded Kopia copy-forward candidate passes focused, package and
  race runs. It verified three payload objects (39 logical bytes), one each of
  four signed recovery roles, independent source readers before and after copy,
  stage and final-target readers, and refusal of partial/canceled publication.
  This does not admit a profile/default or qualify migration policy, savings or
  the full engine.
- Phase 5: a catalog-free Linux zstd restore and payload-specific corruption
  refusal on a generated corpus, isolated Kopia repository probes whose
  retention check is read-only, and a standalone Kopia adapter prototype
  subset. Run 2 covers two safe root-level names sharing one object with
  independent cold readbacks. The adapter prototype covers the existing
  Driver/RecordDriver subset but is not production-registered. Typed optional
  whole-object measurement now has a separate development implementation and
  test result. A separate signed API interoperability probe now exercises
  `exact.Service` publication and catalog-free cold-reopen verification for a
  bounded three-file corpus; standard clean-reader/profile admission,
  recursive mapping, lifecycle/reconciliation and stock-maintenance
  conformance remain open. Separate candidate cohorts now test streaming,
  unknown outcomes, two real SIGKILL checkpoints and injected filesystem
  `PutBlob` faults at final Flush. They do not establish device/power-loss or
  crash-during-underlying-Flush safety. The concurrent-writer proof reproduced
  two successful generation-3 publications from generation 2 followed by a
  cold-reader fork rejection; this is a candidate defect, not a safety pass.
  A separate local cooperating-process candidate now serializes placement and
  empty-root initialization across a shared kernel lock, refreshes before root
  enumeration, and passes focused/race package tests. This is a test-only host
  fixture, not production wiring, remote/NAS semantics, or non-cooperating
  writer protection. A bounded credential-backed child reader now passes signed
  import/list/full-verify/restore, but does not establish production credential
  storage or standard profile admission. A separate cold-relocation/private-pack
  corruption candidate passes: 12 files / 33,578,521 bytes relocate and read
  back; a single-byte private-copy mutation is rejected before payload bytes
  are returned. This is not signed/profile corruption or relocation closure.
  Production credential lifecycle, migration, non-destructive
  retention ownership, package/corpus and savings qualification, reader/profile
  admission remain open. No production engine or key-handling default is
  selected.

The primary agent owns source freeze, integration, current-build acceptance,
ADRs, and status. Luna owns bounded implementation or qualification tasks with
explicit files and phase/requirement/exit-test triples. Each task preserves
unrelated changes and reports conflicts. Candidate inventories, harnesses,
builds, generated files, and skipped tests retain their actual evidence class.

## Phase 5 engine pin review (2026-10-07)

The isolated, unregistered Kopia probe pin is v0.23.1, tag commit
`72ec08fd8edb86c67ed27099bf1b955e1f308ffa`, module sum
`h1:0+V5Au8fD+190vQbklG0DaWD6I4clmbwlmJTqtI0y0Q=`. Its retained upstream
Apache-2.0 LICENSE hashes to
`cd83acc95b12c0ee2a9271950b7f23be45294483b9e12869ef0d31fc9e8248f8`. The
[release](https://github.com/kopia/kopia/releases/tag/v0.23.1) notes a data-loss
race fix; the reviewed [GHSA-2q4c-3mrw-63c3](https://github.com/kopia/kopia/security/advisories/GHSA-2q4c-3mrw-63c3)
and [GHSA-j5vm-7qcc-2wwg](https://github.com/kopia/kopia/security/advisories/GHSA-j5vm-7qcc-2wwg)
state ranges exclude this version. That is not an assurance of vulnerability
absence, and the root license does not establish transitive notice closure. No
engine/default is selected and no qualification is awarded.

## Following the product through the gates

Typed optional measurement is implemented and tested for the stated development
scope; it does not close Phase 5 or qualify a repository engine. The latest
Kopia candidate passes bounded storage-write and process-death tests at the
actual filesystem `PutBlob` boundary, plus a local cooperating-process host
serialization experiment. The new scoped process-death cases found the exact
target absent before retry in both the before-write and after-storage-success
checkpoints; an older crash after a successful whole Flush remains a separate
committed-object proof. A credential-backed signed-reader candidate now passes
child-process import, list, full-byte verification and restore for 3 files/46
bytes; production credential lifecycle and standard reader/profile admission
remain open. A separate bounded candidate passes cold relocation of 12 files
(33,578,521 bytes) and rejection of a private-copy one-byte pack mutation;
broader signed/profile corruption and relocation remain open. The local serialization fixture resolves the reproduced
generation-fork case only for cooperating processes sharing that local kernel
lock; it is not production adapter or remote-storage qualification. No result
simulates device/power loss. Next Phase 5 work is production credential lifecycle, broader signed/profile corruption and relocation proof, migration, non-destructive retention ownership, reader dependency/profile admission, and package/corpus/savings qualification. Standard
reader/profile admission follows the common gates, alongside Phase 4
redistribution and representative supported-host qualification. Host-key handling belongs to the reviewed engine
adapter. The experimental in-tree AES candidate is not the next implementation
path. Verify the engine pin, advisory status and current API, and review
portable recovery bindings before implementation or default selection. These
checks are decision preparation, not a new security contract or qualification
result. Close discovery and recoverable storage
with the required evidence, then implement the admitted minimal
grouping/export successor, then complete the release workflow. Review first-party gallery, audio and
video/document access contracts at their admitted stage before implementation.
A runtime extension framework is revisited only when independent
implementations prove a stable seam and its trust, compatibility and conflict
rules can be qualified.

The [product experience todo](product-experience-todo.md) tracks task-level
evidence. Dated acceptance records retain build identities and practical
limits. The [content-first decision](content-first-product-decision.md) carries
the daily product promise; this record keeps the complete target visible when
the next implementation slice is smaller than that target.
