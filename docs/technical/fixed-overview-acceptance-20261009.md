# Fixed Content Overview — Local Acceptance (2026-10-09)

Status: **implemented for the stated UX-C2 development scope**. This is one
bounded client layout, not completion of Photos/Music, durable organization,
runtime plugins, a core phase or release qualification.

## Slice and decision

- Active track: admitted first-party client UX-C2 over the existing development
  profile; the Phase 4/5 queue and Phase 6 LinkGroup prerequisites remain unchanged.
- Normative requirement: [First-Party Personal Client Experiences §11](../requirements/first-party-client-experiences.md#11-ux-c2-fixed-mixed-content-overview).
- Exit: browse mixed photos/audio/other content in one current result scope,
  select the correct host rows, open Details, use the existing player, and move
  to enabled domain presentations without losing conditions or rerunning search.

The primary agent decided the scope and integrated three GPT-6 Luna tasks.
[ADR-029](build-stack-and-architecture-selection.md#adr-029-one-fixed-overview-before-a-general-composition-framework)
explains why one usable fixed layout precedes a general composition framework.
Overview is a separately registered browse layout. Its sections share the
host classifier, returned order, selection, Details, thumbnails and player.
Each previews at most six rows and reports displayed versus scope counts.
No section owns a search, byte-read/cache path, player or durable membership.

The [album/playlist design](durable-media-organization-design.md) is a separate
**PROPOSED / NOT IMPLEMENTED** deliverable. It specifies candidate album sets,
ordered repeatable playlist occurrences, missing members, atomic conflicts,
signed publication/import and frozen export boundaries. The current portable
record kinds and legacy export handles do not implement those semantics.
Membership writes require a reviewed normative successor before implementation;
tags, Notes and browser local storage are not substitutes.

## Artifact and environment

Checkout: `/Users/macos/Documents/other_project/restoreweave`, HEAD
`5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, with existing unrelated worktree
changes preserved. No commit, backend endpoint, schema, signed format, provider
or deployment change was made by this slice.

`dist/fixed-overview-20261009/artifact-identities.json` records final build,
served-byte digests, unchanged daemon/config identity and dirty-state evidence.
The existing preview serves `dist/personal-experiences-20261009/web-dist` at
`http://127.0.0.1:4648/`; only client static files were updated. The daemon was
neither rebuilt nor restarted.

The unchanged QA library has 17 named files across six sources, including
generated PNG/JPEG, WAV and tagged MP3 samples, a one-pixel image and unavailable
preview cases. Actual browser interaction with these files proves the stated
local routes, not a representative real-world NAS media library.

## Verification

| Check | Result and limit |
| --- | --- |
| TypeScript/Vite production build | PASS; final client includes restoration gating and container-width layout. The existing large-chunk warning remains; this is not performance qualification. |
| Overview projection | PASS: original indices/identity, returned order, full-scope counts, six-row limits, directory classification, empty scope and nonmutation. |
| Page registry/result scope | PASS: layout/domain validation, collision rejection, legacy routes and search/tag/presentation helpers. |
| Translation catalog | PASS: 25 duplicate-free partials, 1,818 keys and literal coverage across 74 client files. |
| `go test -tags purego ./...` | PASS once for the integrated cohort, 27 tested packages. Later client-only fixes did not justify rerunning it. Native semantics and release qualification are not inferred. |
| `git diff --check` | PASS. |

## Actual browser journeys

| Journey | Result and limit |
| --- | --- |
| Mixed overview | PASS: current fused `Large` response has seven photos, six audio and four other rows. Overview shows six/six/four with honest scope totals; these are returned results, not an exhaustive count or filename-only matching claim. |
| Selection and Details | PASS: selecting Large-landscape.png and Tagged-test-B.mp3 selects those exact host rows; opening Tagged-test-B Details shows that file and recorded audio facts. Temporary selections were cleared; no Notes were saved. |
| Shared playback | PASS: Tagged MP3 playback and the six displayed supported tracks use the existing verified-original player. Overview → Photos → Overview → Music → Overview preserves the paused Blob and position (0.048547 s). No new streaming or universal codec claim. |
| Navigation query count | PASS: the switch interval recorded zero `search.query` operations with neither truncation nor remaining events. The separate initial capture was truncated and is not initial-query-count proof. |
| Independent preferences | PASS: disabling wall alone routes Browse photos to Exhibition; disabling both Photos presentations and Music suppresses their preview/play actions, while All types and four other rows remain available. Disabling the current Overview visibly falls back within the same search scope; a valid Photos destination clears its warning. Preferences were restored. |
| Composed refresh | PASS on final client: incoming query/tag/Overview link stays unchanged during restoration, with zero mounted overview/photo cards. Completion shows only the one tagged photo and honest empty audio/other sections; one main landmark remains. |
| Invalid query recovery | PASS: a search link with no query retains its original hash, shows a failure and All types escape, and mounts no thumbnails. Explicit successful `Large` search restores usable Overview and updates the hash. |
| Narrow/default content width | PASS: 390×844 viewport produces client/scroll widths 375/375, six photo cards and one global audio element. The final container-width correction also keeps default-sidebar photo actions readable. This is browsing acceptance, not the full mobile upload/touch journey. |

Browser screenshots and state/operation records are retained under
`dist/fixed-overview-20261009/validation/`. The final screenshot uses generated
QA artwork and recorded test audio metadata.

Offline retry, request failure and workspace/generation supersession are
source-reviewed but **NOT RUN** as browser fault injections. Initial restore
callbacks and the pre-bootstrap restore effect respect successful user
navigation; a changed query value alone does not unlock failed restoration.
Only the matching presentation-warning object is cleared, leaving unrelated
notices intact; the unrelated-error preservation branch was not fault-injected.
Existing cross-domain unsaved-Notes cancellation remains unaccepted as noted in
[UX-C1 acceptance](domain-presentation-acceptance-20261009.md).

Runtime loading/isolation, user-authored layouts, reusable block SDK, durable
albums/playlists, new media extraction, complete mobile journeys and whole
product/release qualification remain unfinished.
