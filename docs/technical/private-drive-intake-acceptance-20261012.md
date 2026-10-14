# Private-drive intake — local acceptance, 2026-10-12

## Outcome and boundary

**Implemented for the tested local client scope.** Cairn now leads ordinary
Add with file choice/drop. A completely reported upload automatically prepares
the existing plan in the same modal; the owner still explicitly confirms saving
originals. Names, count and the next action lead. Temporary paths, identities
and storage accounting are available in disclosures. Successful saving offers
one direct return to the unified library.

The product category is **a better self-hosted private drive** for one owner.
[ADR-035](build-stack-and-architecture-selection.md#adr-035-private-drive-positioning-and-file-oriented-intake)
and the [primary-source interface review](../research/private-drive-interface-reference-20261012.md)
record the rationale. The normative boundary is
[API and WebUI §2.2](../requirements/api-and-webui.md#22-familiar-browser-intake-refinement).
The active slice maintains the existing bounded local client adapter; core
phase order and Phase 4/5 grouping gates do not change.

The implementation changes five client files: `SourceDrawer.tsx/css`,
`PlanCard.tsx/css`, and `i18n/drawers.ts`. It does not change transport, source
hooks, backend endpoints, durable schema, processors, signed formats, exact
identity or recovery authority. The explicit server-directory/recheck flow
keeps its existing plan and apply contract.

## Implementation and review

DeepSeek Harness used `sub2api / deepseek-v4.1-flash` in two disjoint scopes:

- `session-c9fd8b09-fa94-4c21-b307-6e4c79891b3d`: ordinary intake modal and
  automatic preparation; a follow-up checked incomplete response handling.
- `session-5c92843f-6477-4175-b3e2-5f9fb9d73c43`: compact file-oriented plan
  presentation and scoped styles.

The primary reviewer read the diffs and completed translations, strict batch
count/identity checks, warning/unknown wording, filename de-duplication in the
review, and final footer states/sizing. A separate read-only review found no
blocking correctness issue. The operator subsequently delegated remaining
browser checks and screenshots to Luna. Luna found that the server-directory
return-to-upload button missed its scoped style and rendered only 24.4 px high.
The primary reviewer admitted the narrow CSS correction; Luna fixed and
re-tested it at 44 px, and the reviewer read the diff and resulting screenshots.
Reports and route evidence are retained
under `dist/private-drive-intake-20261012/validation/`; no commit or staging was
performed. The temporary credential-bearing Harness overlay was removed.

Preparation is not exact saving: it records existing source/plan metadata and
leaves staged bytes temporary. Only explicit existing digest-bound apply may
protect them. The complete-response gate checks count, accepted rows, SHA-256,
length and request-scoped directory before automatic preparation. Partial or
unresolved responses keep the answer visible; accepted-subset review is an
explicit action. Late upload responses after panel closure may refresh staging
visibility but cannot initiate a hidden review. Unknown apply results retain
the existing status-check path and do not offer another save.

## Executable evidence

The existing isolated development profile on `127.0.0.1:4648` was used. Inputs
were four owned QA files under `dist/private-drive-intake-20261012/qa-files/`,
not operator content. Its initial sixteen library entries were preserved.

| Check | Result | Evidence |
| --- | --- | --- |
| Client build | PASS | `build.log` and final `luna-css-build.log`: `npm run build`, TypeScript/Vite exit 0; bundle-size warning remains. |
| Existing translations and registry checks | PASS | `web-i18n-check.mjs`: 26 catalogs, 1,907 keys, 81 sources; compiled registry conflicts/aliases/fallbacks pass. |
| Broad practical Go check | PASS | `go-test.log`: `go test -tags purego ./...`, exit 0, cached; this slice changes no Go files. |
| Three-file ordinary intake | PASS | `automatic-review.json`, `confirmed-save.json`, `library-after-save.json`: Markdown, PNG and WAV stay in the same review modal; explicit confirmation saves them, and library count changes 16 → 19. |
| Actual original bytes | PASS | `original-download-checks.json`: all three browser downloads match source lengths and complete SHA-256 digests. Copies are retained in the evidence directory. |
| Current intake round trip | PASS | `saved-final-light.json`, `final-original-download-check.json`: a fourth 61-byte text file is prepared/saved; library displays twenty items, preview reads the text, and browser download matches all bytes. The later correction is CSS-only and final JavaScript bytes are identical. |
| Light phone review | PASS | `ready-light-390.json` and `add-ready-light-390.png`: viewport/scroll width 390, dialog within bounds, primary action 44 px high. Light empty/ready/saved desktop and phone captures precede only the secondary path-button CSS correction. |
| Final dark phone/desktop review | PASS | `luna-browser-observations.json`, `luna-final-{empty,ready}-dark-{390,1280}.png`: three names, 49.5 KB, one 44 px confirmation and no horizontal overflow. |
| Secondary server-directory round trip | PASS, UI smoke only | `luna-final-server-directory-dark-390[-scrolled].png`: corrected return control measures 341 × 44 px, is visible after scrolling and returns to upload; no source apply was run. |
| Escape/reopen without saving | PASS | Luna's report: unsaved review closes, Add reopens in clean selection mode, library remains twenty items and temporary sessions are retained. |
| Served asset identity | PASS | `served-asset-check.json`: index, JavaScript and CSS return HTTP 200 and match `web/dist` bytes/digests. |
| Whitespace | PASS | Luna's `git diff --check`, exit 0. |
| Unknown apply and malformed/partial response injection | NOT RUN | Optional fault injection was not performed; visible-state code review is not live outcome-lineage evidence. |

The three-file functional exercise preceded the final footer wording/sizing
refinement. Its older dark screenshots are intermediate evidence, not proof of
the final 44 px action. The fourth-file light round trip and Luna's final-build
captures bind the presentation separately. During Luna's reload the client
briefly reported service unavailability/zero loaded items; the existing visible
Refresh service status action restored connection and the same twenty entries.
This transient first-load result is recorded, not reclassified as an always
successful startup or a performance qualification.

## Candidate and limits

HEAD is `3a46229c835cb52b8bc5442361a5caf1db120b42`, with prior dirty work
preserved. `source-identities.json` records the five intake source hashes and
checkout state. Final JavaScript is `index-ogYbd-w6.js` (954,203 bytes; SHA-256
`e7371c1a0a2446598a409de0e5ceb8821ec559ba5be76a193a022515581feb31`)
and CSS is `index-D9LiLn6_.css` (281,162 bytes; SHA-256
`46872fcbfb12e1d25e63db5be6e2db9255874701ac69fb2e18829167325f843b`).
Luna's served-byte check records their identities. The final JavaScript digest
matches the four-file round-trip candidate even though the build filename
changed after the CSS correction.

This is local client acceptance, not whole-product completion, release
qualification, real-device/screen-reader acceptance, or a large-corpus
performance measurement. The isolated profile has no real semantic bundle;
this exercise does not qualify the default semantic capability. Persistent
albums/playlists, folder upload/mutation, sharing/sync, streaming/transcoding
and runtime third-party code were neither added nor claimed. Server-directory
import/recheck was preserved and smoke-checked, not comprehensively re-tested.
All malformed/partial upload answers and every unknown-outcome lineage have not
been exercised in a real browser; code review is distinct from live evidence.
