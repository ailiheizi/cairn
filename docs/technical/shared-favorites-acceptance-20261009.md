# Shared Favorites — Local Acceptance (2026-10-09)

Status: **implemented for the stated UX-F1 development scope**. This completes
a shared tag shortcut, not curated albums, persistent ordered playlists,
runtime plugins, a core phase or release qualification.

## Slice and decision

- Active track: admitted first-party client UX-F1 over the existing development
  profile. Phase 4/5 and the Phase 6 LinkGroup prerequisites remain unchanged.
- Normative requirement: [First-Party Personal Client Experiences §12](../requirements/first-party-client-experiences.md#12-ux-f1-shared-favorites-through-existing-user-tags).
- Exit: star/unstar from Photos, its focused viewer, Music and Overview; revisit
  the shared filtered set after reload; retain query and presentation when the
  last favorite disappears; refuse editing against unread tag state.

The primary agent decided scope and integrated three GPT-6 Luna tasks.
[ADR-030](build-stack-and-architecture-selection.md#adr-030-shared-favorite-shortcuts-before-durable-media-membership)
records why this existing user-tag workflow precedes richer durable membership.
One host controller reads the current workspace TAG state and calls existing
revision-checked `annotation.upsert`/`annotation.delete`. Presentations receive
one callback and status. They add no independent catalog, reader, player,
membership state, endpoint, schema or signed format.

The exact visible stored value is `Favorite` in every language. Removing a
favorite removes only matching active TAG records for that stable subject.
Ordinary tag editing stays authoritative: renaming this tag changes whether
it matches the shortcut. Catalog durability uses the existing annotation
lifecycle; each click does **not** immediately publish a fresh authenticated
portable backup. Notes, other tags, original bytes and recovery records are
not rewritten by the shortcut.

## Artifact and environment

Checkout: `/Users/macos/Documents/other_project/restoreweave`, HEAD
`5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, with unrelated existing changes
preserved. No commit was made. The existing localhost preview on port 4648
continues to serve `dist/personal-experiences-20261009/web-dist`; only static
client files were updated. The daemon and persisted config were not rebuilt,
restarted or changed.

`dist/shared-favorites-20261009/artifact-identities.json` records checkout,
dirty state, unchanged daemon/config digests and byte-equality of built,
deployed and HTTP-served assets. Final JavaScript is `index-BKXfjhB5.js` and
CSS is `index-pa81qko9.css`. Final browser state records that JavaScript URL.

The QA library has 17 named files across six sources, including generated
JPEG/PNG/WAV and tagged MP3 samples. It is a local functional demonstration,
not representative-library or full NAS acceptance. The two final demo tags
are on `Large-landscape.jpg` and `Tagged-test-A.mp3`; `Photo.png` retains its
unrelated `qa-retained` tag. Test selections were cleared and playback stopped.

## Verification

| Check | Result and limit |
| --- | --- |
| TypeScript/Vite build | PASS; final build includes explicit tag reread labels, contextual failed-edit notices and the mixed Overview empty-state correction. Existing large-chunk advisory remains; performance is not qualified. |
| Favorite mutation planner | PASS: exact subject/body/kind/tombstone isolation, all matching duplicate TAG deletion plans, revision fencing and missing-subject rejection. This pure helper does not exercise hook scheduling or actual duplicate writes. |
| Translation catalog | PASS: 26 duplicate-free partials, 1,832 keys and literal coverage across 77 client files. |
| Broad Go checks | `go test -tags purego ./...` PASS once for this integrated source cohort, 27 tested packages. Later client-only label and empty-banner fixes did not justify repetition. Native/release qualification is not inferred. |
| Whitespace | `git diff --check` PASS; new slice files checked separately for trailing whitespace. |
| Served identity | PASS: final built, deployed and HTTP-served index/JS/CSS bytes match. |

## Actual browser journeys

| Journey | Result and limit |
| --- | --- |
| Photo viewer star | PASS: starring `Large-landscape.jpg` inside the focused viewer keeps that viewer, photo and position open. Wall/viewer show the changed mark without selecting the file. |
| Existing tag preservation | PASS: adding and removing `Favorite` from `Photo.png` retains `qa-retained`. No Notes were edited. |
| Shared photo filter | PASS: two marked photos become two scoped rows, then one when `Photo.png` is unstarred. The existing `Large` query and presentation stay in the hash. |
| Music star/filter | PASS: `Tagged-test-A.mp3` can be marked directly from its track row. Only favorites shows that one audio item, while the shared scope also retains the marked photo. Recorded title/artist/album remain unchanged. |
| Shared playback | PASS: playing and pausing the tagged MP3, then moving Music → Overview retains one audio element, the same Blob URL and paused position. It uses the existing original-audio player, not a new streaming or codec capability. |
| Reload | PASS: reloading the query + `Favorite` + Overview link restores the two marked subjects and the same scope. No browser-only membership store is used. |
| Last removal | PASS: removing both final marked subjects leaves zero results under the same `Large` + `Favorite` + Overview hash. It does not broaden to all content or add content automatically. Final client removes the incorrect audio-only banner from mixed Overview. |
| Failed write/read and recovery | PASS on final client: temporarily blocking this tab's command URL makes the attempted unstar fail and the tag reread unavailable. The scoped page shows an error, no editable stars and no false zero-favorites result. Unblocking and choosing **Reload tags and favorites** restores both original marks; it does not retry the failed deletion. The historical failed-edit notice stays explicitly labeled as that failure. The request block was removed in `finally`. |
| Narrow music controls | PASS on final client at 390×844: actual content/scroll widths are 375/375. The marked track's enabled 30 px star lies inside the row (x=245, right=275), alongside queue and play. One audio element remains. This does not prove every mobile/touch journey. |

Browser records and screenshots are under
`dist/shared-favorites-20261009/validation/`. `final-client-state.json`,
`final-client-ax.txt` and `final-mobile-music-state.json` are authoritative for
final star state. Earlier JSON captures used an incorrect CSS probe for star
arrays; those arrays are not star-count evidence. Their URL/body and audio
observations remain usable. Two short browser-locator waits timed out while
refresh/write completion was in progress; fresh UI inspection confirmed the
operation completed before subsequent actions. No timeout is counted as a pass.

## Remaining work

Workspace/generation supersession, actual duplicate-tag partial deletion,
revision conflict and an unknown-outcome write were source-reviewed but
**NOT RUN** as browser fault injections. The helper validates deletion plans;
it does not claim these runtime outcomes. Keyboard/touch, very large libraries
and full Photos/Music feature acceptance remain open.

Curated albums and persistent playlists remain **PROPOSED / NOT IMPLEMENTED**.
The [durable media implementability review](durable-media-organization-design.md#implementability-review--2026-10-09)
identifies workspace resolution, snapshot-local export handles, repeated
playlist occurrences and closed portable-record kinds. Review the actual
organization/export/recovery successors, separately admit their durable
contracts, then deliver save/reopen/use workflows. `Favorite` TAGs are not a
substitute for those relationships or for fresh portable recovery publication.
