# Domain Presentations — Local Client Acceptance (2026-10-09)

Status: **implemented for the stated UX-C1 development scope**, with the
unverified negative branch below. This closes no core phase or release gate.
Photos and Music remain partial domains; this UX-C1 cohort did not implement
aggregate templates or runtime plugins. The subsequent bounded Overview has
its own [UX-C2 acceptance](fixed-overview-acceptance-20261009.md); runtime
loading remains unimplemented.

## Slice and decision

- Active track: admitted first-party client UX-C1, parallel to the Phase 4/5
  queue over the frozen Phase 3 development profile.
- Normative requirement: [First-Party Personal Client Experiences §10](../requirements/first-party-client-experiences.md#10-ux-c1-domain-presentations-over-a-shared-result-scope).
- Exit: grouped Photos presentations preserve current keyword/tag results,
  relevance, same-domain held work and all-types access; preference and route
  fallback remains visible, and supplementary lengths use exact current tuples.

The primary agent decided scope and integrated three GPT-6 Luna contributions.
[ADR-028](build-stack-and-architecture-selection.md#adr-028-domain-presentations-and-fixed-template-composition)
distinguishes domain presentations, independent task pages, future fixed-template
aggregate blocks and whole-interface shells. Photos contains Photo wall and
Exhibition. Music is another projection of the same host result scope. Queries,
selection, Details/Notes, exact reads and the player remain host-owned.

Two actual DSH headless CLI turns completed through
`openainext / claude-opus-5-5`, session
`session-363890e3-14fd-4cd9-8aeb-83f7bd2428e0`, exit 0 with final responses and
zero tool events. Prompts, responses, result/event records and the consultation
summary are retained in `dist/page-presentation-composition-20261009/`.
The private temporary overlay disabled tools and left the global profile
unchanged. Consultation is advisory. No claim of viewing or copying the exact
Bilibili reference is made.

## Artifact and environment

`dist/page-presentation-composition-20261009/artifact-identities.json` records
checkout `/Users/macos/Documents/other_project/restoreweave`, HEAD
`5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, the dirty state, unchanged daemon,
config digest and final client digests. Unrelated worktree changes were preserved;
no commit, release, backend endpoint or durable format was added.

The existing preview serves `dist/personal-experiences-20261009/web-dist` at
`http://127.0.0.1:4648/`. Final assets are `index-yMVTzuMf.js` and
`index-C3l7ogf7.css`; HTTP bytes matched their local counterparts. Final HTML
SHA-256 is `e16a9ca25e8d1d8b6ef920d9bfc5eb8709f63ebebc8fdcab4f1ec271e369c6e2`.
The daemon was neither rebuilt nor restarted by this slice.

The existing local QA library has 17 named file rows across six sources,
including generated PNG/JPEG, WAV and tagged MP3 samples, a one-pixel tagged
PNG and an intentionally unsupported over-pixel-limit image. It is synthetic
development evidence, not a retained personal library or NAS acceptance.
This cohort added no media or persistent Notes/SavedViews; its temporary
unsaved Notes draft was discarded and audio stopped. Temporary viewport
overrides were reset and all presentation preferences restored.

## Executable checks

| Check | Result and practical limit |
| --- | --- |
| TypeScript and Vite production build | PASS, including the final disabled-wall return-action correction. The existing large-chunk advisory remains; JS is about 877 kB before gzip, not a performance qualification. |
| Page registry | PASS, root/child compatibility, absent roots, chains/cycles and registration collisions reject; enabled-child-only groups and all-disabled groups behave deterministically. |
| Result-scope and hash helpers | PASS, source/projection order and row identity, legacy aliases, search/tag/month round trips and invalid presentation handling. The round-trip check caught duplicate serialized tag parameters during integration; corrected. |
| Supplementary lengths | PASS in the exact-archive join helper: current exact tuple, stale/mismatched and ambiguous rows, empty/size boundaries. Known search-row sizes were also exercised in browser image/audio reads. |
| Browser preferences | PASS in the existing focused preference helper, including invalid/denied storage. The existing enabled page-ID representation is unchanged; unregistered preference-ID retention is not newly implemented. |
| Translation catalog | PASS, 24 duplicate-free partials, 1,794 keys and literal coverage across 72 client files. |
| `go test -tags purego ./...` | PASS once for the integrated cohort, 27 tested packages. Later client-only return-label corrections did not justify repeating it. This is not native semantic or release qualification. |
| `git diff --check` | PASS. |

Final focused check outputs and served-byte identities are retained under
`dist/page-presentation-composition-20261009/validation/`.

## Actual browser journeys

| Journey | Result and limit |
| --- | --- |
| Legacy Exhibition route | PASS, `#v=exhibition` normalizes to content + Exhibition under the Photos destination. Stable IDs/routes remain compatible. Hashes are read on initial load; changing only a hash in an already mounted tab is not a client navigation API. |
| Exhibition -> keyword search | PASS, submitted `Large` stays in Exhibition. The current fused response contains seven photos, six audio and four other rows; these are returned-result counts, not an exhaustive match count. |
| Photo wall -> Music -> all types | PASS without query loss or rerun. CDP operation-name observation recorded exactly one initial `search.query` and zero during presentation switches. Relevance ordering remains server-returned. The final return-label-only correction does not change this logic. |
| Search + tag -> Music empty -> all types | PASS, `qa-retained` narrows the current response to one photo; Music reports no audio in that one-result scope and offers all-types access. |
| Clear search / clear filters | PASS, clearing search retains tag and presentation; clearing tags retains the submitted query. Changing display is a separate action. |
| Refresh composed link | PASS after the asynchronous query completes: keyword, tag and Exhibition restore together. The retained screenshot is the completed state, not the intermediate loading listing. |
| Same-domain held work | PASS in the integrated cohort: Photo wall <-> Exhibition retains one selection, inspected subject and unsaved Notes draft. A paused WAV keeps the same Blob URL and 9.389917 s position. `held-state.json` records this; no durable Note was saved. |
| Cross-domain Notes cancellation | NOT RUN to a deterministic negative-branch result. The existing `window.confirm` guard is still invoked, but the CUA attempt timed out and no live dialog could subsequently be observed. Do not treat that attempt as proof of cancellation. |
| SavedView domain restriction | PASS, Music with a submitted query disables Save and explains switching to All types; no silently broader SavedView is written. |
| Independent presentation preferences | PASS, disabling wall alone keeps Photos available through Exhibition. Disabling both removes Photos and visibly falls back to All types while retaining query/tag. Preferences were restored. |
| Disabled/unknown direct links | PASS after actual reload and query completion, both fall back visibly to All types with `Large` and `qa-retained` intact. Helper checks separately cover parsing. |
| Disabled wall return action | PASS on the final served build, Exhibition offers All types when wall is disabled. Header and empty/error return labels share the same host target; empty/error branches were source/build checked, not separately fault-injected here. |
| 390 x 844 layout | PASS for the checked scope navigation and wall/exhibition switch; document client/scroll width is 375/375, and both selector groups remain available. This is not full mobile Music acceptance. |

Screenshots include `restored-search-tag.png`, `music-scoped-empty.png`,
`disabled-domain-fallback.png`, `disabled-route-fallback.png`,
`exhibition-only-preference.png`, `narrow-photo-wall.png`, and
`final-domain-presentations.png`. The final screenshot shows generated QA
artwork in the actual product, not a concept mockup.

## Remaining product work

- Curated photo albums and durable ordered playlists remain the main media
  organization gaps, behind their separately reviewed recovery/migration
  successor. Existing recorded album facts are not editable playlist membership.
- Fixed-template aggregation is the next composition seam to admit and
  implement after this shared-scope baseline; no aggregate page is delivered.
- Contributions are trusted compiled source registrations. There is no runtime
  loader, installer, stable public ABI or third-party security isolation.
- Complete format coverage, larger libraries, real retained media and the full
  mobile listening journey remain unverified. No Linux/deployment investigation
  was added to this client cohort.
