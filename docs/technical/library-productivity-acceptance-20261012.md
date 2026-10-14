# Library productivity — local acceptance, 2026-10-12

## Outcome and boundary

The bounded client slice is implemented and locally tested; this is not whole-product or release qualification.
This is maintenance of the existing local browser client under
[API and WebUI §§5.3/6](../requirements/api-and-webui.md#53-search-and-catalog)
and [UX-C1/T1](../requirements/first-party-client-experiences.md).
[ADR-036](build-stack-and-architecture-selection.md#adr-036-everyday-library-actions-over-the-shared-returned-scope)
records the product decision. Core phase order and admission do not change.

Standard Library/Search/Tag compositions now use a daily toolbar and native
Filters/More tools disclosures. Active conditions, loaded/returned counts,
recalled-query meaning and unavailable states stay outside closed tools.
Selection offers one primary original ZIP action, with export, report,
image-search and tag entry reachable on demand. File rows retain existing
Details and virtual-window behavior while exposing semantic, larger selection
controls. Focused domain layout and the one shared player remain unchanged.

Seven client files change: `LibrarySurface.tsx`/`LibraryWorkflow.css`,
`SelectionBar.tsx/css`, `ResultList.tsx/css`, and three translations in
`i18n/library.ts`. The slice adds no endpoint, hook, provider, processor,
durable format, selection/query authority or recovery meaning. Original ZIP
budgets and complete length/SHA-256 validation remain in the existing host
flow. No unloaded entries are silently selected.

## Delegation and primary review

Three independent DeepSeek Harness sessions used the operator-selected
`sub2api / claude-haiku-5-5` route, verified from retained assistant records:

- `session-2c966685-8a96-4761-bb4d-2630af663f8f`: standard library controls.
- `session-02904f84-a0be-468f-b482-e791dde6642e`: batch action hierarchy.
- `session-0b0637c6-5324-4399-8d14-35f25fae36ec`: row-selection affordance.

The primary reviewer compared each diff against a saved dirty-tree baseline.
Review corrections kept closed phone disclosures inline, removed competing
primary batch actions, set explicit phone action order, made list-mode markers
relative to their buttons, and revealed mounted selection controls while a
batch is active. Luna found a redundant source-mode comparison that failed
TypeScript's narrowed union; Haiku removed that guard without casts or changing
types. The reviewer inspected each correction. No commit or staging was made.

Luna owns build/checks, real-browser screenshots and original-byte verification.
Evidence is retained in `dist/library-productivity-20261012/validation/`,
including implementation reports, route metadata and source hashes. Before the
successful rebuild, port 4648 still served the previous assets. Its capture is
explicitly named `intermediate-stale-4648-phone-batch-dark.png` and is not final
evidence. The screenshot/asset identity must match the accepted build.

## Evidence and limits

The isolated local development profile contains twenty owned fixture subjects,
including the QA Markdown/PNG/WAV/text files. Operator content is not used.
The profile has no real semantic bundle; lexical/structured behavior does not
qualify the default local semantic capability.

Luna's final integrated run passed `cd web && npm run build`; the page registry
check and `node scripts/web-i18n-check.mjs` also passed (26 catalogs, 1,910
merged keys). The Go suite had already passed for this client-only slice. The
reloaded `127.0.0.1:4648` index, JavaScript and CSS matched the fresh `web/dist`
assets byte-for-byte. Root independently ran `git diff --check` successfully.

The current browser check covered the 390×844 phone and 1280×800 desktop in
dark mode, plus light-mode screenshots at the browser's smaller exported sizes
(375×812 and 1265×791; exact light-mode dimensions remain unverified). It covered
active filter clearing, favorite filtering, Photos and Music selection
with their existing batch ZIP flows, Details→Return, search→result→select→ZIP,
and honest degraded-search messaging. The final batch screenshot shows the
selection count/clear control, primary ZIP action and secondary actions with no
horizontal overflow. The two-item ZIP was actually downloaded and extracted;
both file lengths and SHA-256 digests matched the originals (PNG: 18,517 bytes,
`d2d13cbc6bc4a71a85cae1c6a3f4d5da2decd40b341638134c913bebe401deb1`; Markdown:
119 bytes, `864aab4d7a15af6e769e3909701aa3410ac028f984e369eec56f3584511eeecd`).
Screenshots, asset captures and implementation reports are retained in
`dist/library-productivity-20261012/validation/`, including
`final-library-390-dark.png`, `final-library-390-light.png`,
`final-library-1280-dark.png`, `final-library-1280-light.png`, and
`final-phone-library-batch-dark.png`. The light captures document appearance
only at their actual exported dimensions.

The isolated local development profile contains twenty owned fixture subjects;
operator content is not used. It has no real semantic bundle, so this slice
does not qualify the default local semantic capability. Empty-result selection,
unavailable-original handling, real-device/screen-reader acceptance,
large-library performance, every unavailable/fault branch and release
qualification remain outside this bounded check. No albums/playlists, folder
mutation, sync/share, media service or runtime package is added.
