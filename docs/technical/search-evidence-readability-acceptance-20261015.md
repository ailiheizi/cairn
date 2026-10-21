# Search evidence readability acceptance — 2026-10-15

PC-07e implements a bounded Phase 4 retrieval-comprehension refinement under
the existing first-party UX-C1 client contract. The normative requirement is
content-store §8: matched source text and provenance remain available without
rewriting durable facts. The exit test is one real search followed by readable
image evidence, keyboard access to its original matched text, and verified
original takeout while query, order and selection remain unchanged.

## Resulting behavior

The first displayed matched segment retains its place. When that segment is
an `ARTIFACT` / `EXTRACT` containing an object with the embedded schema
`cairn.domain.image.meta/v1`, the card shows available format, dimensions and
size instead of raw JSON. It does not promote a later image segment ahead of
a filename, Note or other match. Existing source labels remain visible.

The existing Details inspector has a collapsed **Matched information** section
for recognized image evidence. It retains every own property, recorded source,
producer, acceptance and language when present, and the complete original
matched JSON as plain React text. It adds no card popup or new screen.

Recognition has a 16,384 UTF-16-code-unit parsing limit; the original source is
never truncated by this limit. Foreign, malformed, oversized and plain-text
matches keep the existing display. Missing fields are not invented. This is
display classification, not validation of an authenticated artifact schema:
the existing search DTO does not carry that schema digest.

## Executable evidence

Source head is `d1750d916f198293bae84fb43ae9d6127e7ee86e` with unrelated dirty
changes preserved. A fresh, unseeded browser used the real API on port 4648,
waited for ordinary startup listing and submitted exactly one `png` query.

- The 20 returned hits retain daemon order. `Cairn-Frame-Overpixel.png` has
  recognized image metadata as its first displayed match.
- Keyboard selection and Enter open existing Details; the native disclosure
  exposes all five properties and the exact 97-code-unit original JSON.
  Query, heading, order and the one selected item remain stable.
- The matched raw text hashes to
  `c39a156e3056466e43424041c4276cd919e905ff0ad1ff949d59281a1731867f`.
- Original takeout is 3,117,146 bytes with SHA-256
  `0a5b27f33d818d70a0416decf62bbdc563df3f4dd00716823058a5cb5cd9671f`.
  The parent independently rehashed the downloaded bytes.

`node scripts/web-search-evidence-check.mjs`, the i18n check, Web build,
script syntax checks and `git diff --check` pass. The focused helper checks
cover source/kind gates, malformed/foreign/oversized fallbacks, absent fields,
extra properties, Unicode preview bounds and nonthrowing property formatting.
Its first-segment guard is a source assertion, not a separate rendered
mixed-source browser case. One shared broad `go test -tags purego ./...`
cohort passed for the PC-07e base; subsequent SDK candidate changes require
their own evidence. The existing Vite chunk-size warning remains.

The parent reviewed the scoped diff and 1280/390-pixel screenshots and compared
all seven scoped source hashes and served assets with the candidate receipt.
Final JS is `index-Wip_l-vl.js`, SHA-256
`473d39da64b1e16f87c5477969575baacb8ed75b09210386bb2d2bf4117edf09`;
CSS is `index-DRBQWM39.css`, SHA-256
`d847dd232d3cc9aa6689423e9b51bb19f044b23f819c14db5860f7954b1a1fe0`.

Ignored evidence lives in `dist/search-evidence-readability-20261015/`:
`checks.json`, `image-metadata-search.json`, `browser-qa.log`, the two final
`image-metadata-details-*.png` screenshots, downloaded original,
`root-final-review.json`, and the shared Go log/receipt. The earlier failure
screenshot is diagnostic history, not the accepted result.

## Limits

The retained corpus is fixture-derived and contains 20 files. These results
prove this client behavior and byte-preserving takeout, not representative
recall, comfortable query latency, complete media functionality or release
qualification. No content, config, model, daemon or recovery authority was
changed by this slice. PC-07 and Phase 4 remain open; the separately reviewed
search-latency candidate is not activated by this acceptance.
