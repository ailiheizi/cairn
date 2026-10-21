# Product-power proposal: find text inside images

**Status: Implemented and locally delivered on Darwin arm64, 2026-10-20.** The
owner-approved OCR-1/2/3 admission is implemented for the existing image OCR
profile. The real-model browser journey passed, and the local daemon reports
OCR `READY`. Phase 4 and release qualification remain open; this evidence does
not qualify another platform or claim complete lexical-field coverage.

## User outcome

An operator assembles and installs the pinned `rapidocr-ppocr-mobile-v1`
bundle for the current supported platform. A newly captured image is retained
as an exact original, then the existing `ocr.image.text.v1` extraction runs
against it. The owner can search for words that appear only in the image,
open the matching image, read the recognized excerpt and its OCR quality/source
information, and download the unchanged original.

The proof flow uses a neutral filename and a PNG containing Chinese text. It
must show (1) successful OCR extraction and existing EXTRACT indexing, (2) a
body-only lexical query for a word absent from the filename and other indexed
metadata, (3) one paraphrased query through the real local BGE profile, (4) a
readable OCR excerpt with its source and quality, and (5) an original download
whose SHA-256 and logical length equal the captured bytes. Semantic results
must be attributed to the verified local BGE generation; OCR itself does not
provide visual similarity.

## Existing implementation

- `OCRImageText` is an optional `ocr.image.text.v1` extraction capability with
  a digest-pinned PP-OCR detection/recognition bundle and profile ID
  `rapidocr-ppocr-mobile-v1` (`server/internal/processor/ocr_text.go`,
  `server/internal/processor/ocr_bundle.go`).
- The image processing route already schedules OCR when that capability is
  registered. OCR output is an existing EXTRACT artifact and feeds the
  existing extracted-text search path. OCR status is separate from whether a
  particular image has been recognized.
- The existing Details surface renders matched EXTRACT prose, and the normal
  original-download path remains authoritative for bytes. OCR failure or
  absence must not block exact preservation.
- The current per-image limits are 20,000 pixels per side, 40,000,000 decoded
  pixels, 2,048 regions, 256 KiB recognized text, and a 20-second OCR stage
  deadline. Bundle files are also bounded and digest-checked by the existing
  bundle admission code. This proposal changes none of these limits.

## Small delivery slices

1. **Pinned local asset assembly and activation.** Provide a reproducible,
   operator-run way to fetch fixed upstream assets or use supplied local
   assets, assemble the already declared bundle, verify each manifest
   digest/license/platform/runtime compatibility,
   and place the complete bundle under the configured models path. Do not add a
   public command or endpoint in this proposal. Report `NOT_BUILT`,
   `UNAVAILABLE`, and `READY` from the installed bundle facts; do not infer
   readiness from profile metadata alone. Downloads require the explicit
   preparation command; capture and first search never download models.
2. **New-capture extraction and search proof.** With a valid installed bundle,
   ingest a new image through the ordinary capture path. Confirm OCR output is
   indexed through the existing EXTRACT/lexical route and, where a verified
   BGE generation is available, tested through the existing semantic route.
   This is not historical backfill: older images remain unchanged unless the
   owner explicitly uses an already admitted recapture/retry operation.
3. **Readable result and exact takeout.** If the current Details excerpt does
   not expose OCR source/quality clearly, make the smallest presentation-only
   improvement on that existing surface. Keep low-confidence, partial, empty,
   failed, and unavailable states distinguishable. Verify the original using
   its exact digest and length; never export OCR text in place of the image.

### Current asset assembly

The stdlib-only `scripts/prepare-ocr-bundle.py` is the explicit operator
assembly step for the admitted profile. For example, after the existing BGE
bundle has been verified locally:

```sh
python3 scripts/prepare-ocr-bundle.py \
  --models-root /absolute/path/to/models \
  --runtime-bundle /absolute/path/to/bge-small-zh-v1.5/darwin-arm64
```

The script verifies the pinned PP-OCRv4 model files, upstream dictionary and
terminal-space class mapping, license evidence, and the reused ONNX Runtime
against the existing BGE bundle. It atomically creates
`<models-root>/rapidocr-ppocr-mobile-v1/<platform>` only if that destination
does not already exist. Its success alone means **assets assembled and hashes
verified**; it does not establish that recognition works or any image has been
indexed. The local Darwin arm64 postcheck later reported `READY` for profile
`sha256:d633666bc2f0f28a87b6123353cbf1dd31410593f33299d6edaca6cd102e9a0c`.

## Admission boundary

This is image OCR only. It does not include scanned-PDF OCR, PDF/DOCX reader
work, Chinese-CLIP or visual similarity, a new search dimension, or a new
processor. It adds no schema, endpoint, runtime loader, service, or automatic
reprocessing. Bundle assembly and installation remain separate from image
recognition, search-index readiness, and exact-original availability.

The core execution plan's §12 exclusion of packs beyond the qualified baseline
has the narrow, owner-approved OCR-1/2/3 exception recorded in AGENTS and the
normative extraction requirement. This admission covers only the existing
`ocr.image.text.v1` capability and profile; it does not admit other deferred
packs or alter phase gates.

## Local delivery evidence and remaining limits

The local Darwin arm64 postcheck `dist/product-image-text-20261019/promotion/postcheck.json` records native daemon SHA-256 `ac9649eaab54808a97ea2eb522b14e9d523cea25ec1eee7ed457f1217f252a35`, served Web index SHA-256 `c1a68a94b312635fcf4b11fbaa7fb4b24e9b5db5ef2c11101f930331a1fd8842`, OCR `READY`, and profile digest `sha256:d633666bc2f0f28a87b6123353cbf1dd31410593f33299d6edaca6cd102e9a0c`. Existing config, CLI, 20 listed identities and both search generations were preserved; installation did not recapture or rebuild the owner library.

The single ordinary browser journey is `dist/product-image-text-20261019/client/attempt-02/result.json`. It used the neutral `image-b.png` capture and verified all four expected Chinese lines, OCR state `TEXT`, and quality over four regions: mean confidence `0.998004` (Details displayed `99.8%`), zero low-confidence regions, and no text truncation. The OCR artifact was indexed and found by lexical FTS; the paraphrase query succeeded through `query.semantic.onnx-bge-zvec.v1`, with `semantic-embedding` on the target hit and the same OCR artifact source. Details rendered the full lexical OCR text and the readable semantic text fragment with quality explicitly unknown because that returned segment was partial. The downloaded original was exactly 74,634 bytes with SHA-256 `8a2fd4cc149d98b6cca5c6b2a6f2092ac664e57f58935a4849ce4b4b2d06bcfa`.

The search preparation command returned `DEGRADED` with visible feedback because overall lexical field coverage lacks `locators`, `tags`, `notes`, `descriptions`, and `language`. The selected-text source report nevertheless indexed all 21 expected sources, with zero missing or unavailable sources; lexical and BGE queries both succeeded. This field-coverage gap remains visible and is not hidden by the passed retrieval journey.

The decoder fix avoids applying softmax a second time to PP-OCR outputs that already contain probabilities. The delivered profile and recognition output carry distinct bound digests, including profile `sha256:d633666bc2f0f28a87b6123353cbf1dd31410593f33299d6edaca6cd102e9a0c` and recognition `sha256:904d8d2269e688fe457dde129e0415156d548a44765ebb53470e1661f3a7a185`. Older records and generations are not silently reinterpreted or backfilled; use new captures or the ordinary explicit recapture workflow.

This is local Darwin arm64 delivery only. Scanned-PDF OCR, Chinese-CLIP delivery, arbitrary historical backfill and model downloads during capture/search remain outside the admission. No Phase 4 or release gate closes from this evidence.

## Source references

The official [RapidAI model snapshot](https://huggingface.co/spaces/RapidAI/RapidOCR/tree/3702ce8b03d6f64083c275cda2b0ce9440e68fd3/models)
contains PP-OCRv4 detection and recognition exports (about 15.6 MB combined).
The [upstream decoder](https://github.com/RapidAI/RapidOCR/blob/main/python/rapidocr/ch_ppocr_rec/utils.py)
defines the dictionary/space/CTC conventions that an assembled dictionary must
match. The assembler pins the selected upstream revision and asset hashes;
the local delivery above verifies their dictionary mapping and runtime use.
These source references alone do not qualify another bundle or platform.
