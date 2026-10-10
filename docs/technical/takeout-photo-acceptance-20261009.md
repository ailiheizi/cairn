# UX-T1/P2 Local Takeout and Photo Acceptance — 2026-10-09

This is local development evidence for the separately admitted
[personal client contract](../requirements/first-party-client-experiences.md#8-ux-t1-bounded-original-zip-takeout).
It grants no core phase or release credit. Root selected/reviewed the scope;
three Luna agents implemented archive, photo rendition and host integration.

## Build and scope identity

- Checkout: `/Users/macos/Documents/other_project/cairn`, HEAD
  `5fae20ae1e00c11d774c1b5ffa6b5928abcbc47a`, 212 dirty/untracked paths at final
  check. The tree contained substantial prior work; unrelated edits were kept.
- URL: `http://127.0.0.1:4648/`; final DOM references
  `/assets/index-BW65asvJ.js`. Served files:
  `dist/personal-experiences-20261009/web-dist`.
- Final SHA-256: HTML
  `74c1883a19dd1f248ae3a22df4af4a0695a2424f656ab45ce37cdeb23b1b4b1b`;
  JS `3b39748aa61f70c766f2dc5de86268f1a53a0c117bb93b23101c76763ad3dca2`;
  CSS `518abd820e7d71b453feab3fc6ccb181eebd0b1857a626c316c321eaf04ba961`.
- Existing daemon PID 33013 and config/catalog/repository were reused. Binary
  digest: `52b87e4d1e7a885b59a13d6d49b22e1b2e0aaaa59e08f4fe8ea3b4e9d9f179e4`.
  No backend, schema, provider, processor or signed record changed in this cohort.
- Earlier mixed ZIP, cancellation and viewer checks preceded the final
  identity-size join. The final build separately passed the actual search ZIP
  journey and rendered the same retained large-photo gallery. The join changes
  only the preflight size lookup; it does not change archive bytes or decoding.

## Actual browser evidence

| Journey | Result and practical boundary |
| --- | --- |
| Import and protect samples | PASS: actual upload/review/confirm of generated PNG/JPEG, empty and text inputs, plus a separate same-name text source. A deliberately malformed over-pixel PNG produced visible derived-processing degradation while exact saving succeeded. Final library contained 17 files from six sources. These are retained test samples, not a real NAS photo collection. |
| Mixed selected originals → ZIP | PASS: an actual browser download contains six originals: empty TXT, PNG, JPEG, tagged MP3 and two distinct same-name TXT files. Independent Python ZIP extraction compares every length/SHA-256 to the original inputs and the persisted frozen manifest. Names include `Shared.txt` and `Shared (2).txt`, exactly as frozen by the daemon. |
| Frozen manifest binding | PASS: six-file ZIP matches `exm_3732a201298c0db7fdaaeba96d4c33d9`, digest `sha256:83c0e849d222970d41f059472833fa6a4c4c1f9a941ae4e784fc5a7898c4ee57`. This is a manifest summary comparison, not a server ZIP verification or portable recovery receipt. |
| Navigation during takeout | PASS: navigation to Music while the mixed batch was reading retained the host progress/cancel surface and completed the same download. Selection/UI navigation does not re-evaluate the captured manifest. |
| Cancellation | PASS: actual cancellation during item 5 of a 17-file batch showed cancelled/no archive prepared, with no download event during the 3.5-second monitored interval. A first attempt completed before the next tool call; it is not counted as cancellation evidence. Helpers additionally reject obsolete callbacks and member failure. |
| Single original | PASS: the existing native download action now has no `_blank` target; the browser received `Large-landscape.jpg`, independently identical to the 1,184,475-byte input and SHA-256 `40b80495e4672fe3fa2bef40e6219952ecbe197b04b77f1a39ac4ce546461d04`. This closes the earlier unobserved single-download check for this tested file only. |
| Search → selected original ZIP | PASS on the final build: search `Large`, select its JPEG result, freeze and download a one-file ZIP, then independently compare extracted bytes to the original JPEG. Search results omit size; the host fills it only from a loaded namespace row with identical subject/entry/content identity. Manifest digest: `sha256:1f08244ee5d9ca1fafbbf1178b164543620c74548d4c1b2b3079ba108583a1aa`. The search's fused result set was broader than strict lexical matches; this does not assert a three-result lexical-only search. |
| Ordinary-photo wall/exhibition | PASS: 1,184,475-byte JPEG and 4,002,855-byte PNG render actual transient thumbnails in both pages. Observed output sizes: JPEG 1024×683, PNG 512×341. The final build's gallery also shows the oriented JPEG at 683×1024. The input dimensions are 1800×1200; output size adapts to the 512 KiB ceiling. |
| Orientation and pixel refusal | PASS: generated JPEG with EXIF orientation 6 renders as a portrait thumbnail; native inspector reports 1200×1800. A 5000×3000 PNG header with valid IHDR CRC is visibly refused before decoding for exceeding 12 million pixels. Native presentation does not record an EXIF fact. |
| Exhibition large inspection | PASS: the initial below-fold inline panel was replaced with the existing viewer-style portal. A real 1800×1200 PNG decodes in the desktop dialog. Shift+Tab stays inside; Escape closes and restores focus to Inspect. At 390×844, document client/scroll widths are 375/375 and the dialog occupies 375×844. Final-build open/close also cancels an in-flight inspector read without leaving a dialog. |
| Existing player retention | PASS: a tagged MP3 plays, pauses, then remains at 10.55288 seconds with the identical Blob URL when navigating to Exhibition. Playback was stopped before the final handoff. |

## Executable checks

| Check | Result |
| --- | --- |
| `npm --prefix web run build` | PASS. Final JS is about 867 kB; the existing large-chunk warning remains. |
| `node scripts/web-original-archive-check.mjs` | PASS: actual ZIP extraction, empty identity, manifest/selection binding, safe/collision names, caps, byte/hash failure, cancellation, response-reader and URL cleanup; matching size join rejects changed/missing/ambiguous rows. |
| `node scripts/web-photo-rendition-check.mjs` | PASS: PNG IHDR CRC/JPEG dimensions and limits, exact chunk offsets/length/eof/hash, session close, two full-original pipelines/one decoder under backpressure, queued cancellation and rendition-only bounded LRU. Browser RSS is not measured by this script. |
| `node scripts/web-page-registry-check.mjs` | PASS: compiled registration conflicts, compatibility aliases and disabled/unknown route fallback. |
| `node scripts/web-i18n-check.mjs` | PASS: 23 partials, 1777 unique catalog keys and all literal client translations. |
| `go test -tags purego ./...` from repository root | PASS practical broad core regression, cached; no native provider or release qualification claim. Not repeated for later client-only copy/size-join changes. |
| `git diff --check` | PASS. |

## Evidence location and remaining product work

Local artifacts are under `dist/takeout-photo-20261009/`: generated fixtures and
`sample-identities.json`, actual `validation/browser-originals.zip` and
`search-original.zip`, extracted identity lists, the persisted frozen manifest
summary, served build hashes and browser screenshots. These ignored local
artifacts are evidence, not distribution assets or authenticated recovery data.

Implemented: bounded original ZIP takeout, matching search-size preflight,
large transient PNG/JPEG thumbnails and direct exhibition inspection. The
client also fixes selection-resolution counting and identity-based exhibition
focus. The complete disappearance/selection matrix is not browser-qualified;
the attempted tag-filter journey enters a separate tag route without the
domain-page switcher, so it did not exercise disappearance inside Exhibition.

Still open: larger/other-format and retained derivatives, capture-date/EXIF
extraction, curated albums, cover extraction, persistent playlists, domain
filter/search composition, streaming archives, runtime extension installation,
full mobile journeys, real-library performance and core/release qualification.
No Linux deployment work was added to this experience cohort.
