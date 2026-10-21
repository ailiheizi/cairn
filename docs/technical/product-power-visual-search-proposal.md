# Product-power proposal: find photos by their visual content

**Status: ACCEPTED by the owner, 2026-10-20.** The owner explicitly approved
this bounded CLIP delivery, including operator-requested indexing of saved
originals. AGENTS and the normative discovery admission record this successor
to the earlier OCR-only boundary. The bounded implementation has passed real-model browser acceptance and is
locally delivered on the existing Darwin arm64 instance; no core gate changes. The concurrent photo slideshow and
immersive music controls stay within the existing client track.

## User outcome

Search for a Chinese description such as “a sunset by the sea” and find a
photo without relying on its filename or OCR text. From a saved photo, use
the existing image-query action to find visually related photos. Open the
result and take out its unchanged original.

## Bounded implementation to admit

- Deliver the existing optional `chinese-clip-vit-base-patch16` profile and
  `multimodal-clip` dimension on the current Darwin arm64 host first. The
  image/text towers, bundle admission, local archive installer, image-index
  generation, broker and Photos query action already exist. This is delivery
  of that implementation, not a new model interface, endpoint or index type.
- Review the current candidate assembler's model provenance, full upstream
  revision, asset digests, export tools, licenses and incomplete SBOM before
  preparing an activatable bundle. Pin the actual selected inputs; a repository
  name or an inferred license is not sufficient installation evidence.
- Use an explicit operator preparation/install step and the already supported
  ONNX Runtime 1.29 profile. No capture-time or first-query model download,
  remote inference, separate vector service or uploaded image data.
- Build a separate, fingerprint-bound image-index generation only on explicit
  request. Read authorized saved originals through the existing image provider
  and its bounds: PNG/JPEG, 64 MiB per image, 64 inputs and 256 MiB per provider
  batch. Do not enlarge the client preview or audio budgets.
- An explicit index build may derive vectors from existing protected originals;
  it does not rerun file processors, modify original bytes or reinterpret old
  facts/generations. Arbitrary historical processor reprocessing stays excluded.
- Retain BGE's separate text space and existing host-owned fusion. A missing,
  incompatible or failed image provider is visibly unavailable; lexical search,
  exact saving and original takeout continue to work.

## One whole-feature exit

Use independently retained, neutral-named real photos with visually distinct
subjects. Install the verified bundle, restart the private local instance,
explicitly build its image index, then use the ordinary browser to:

1. Find the intended no-text photo using a Chinese scene description, with
   actual image-space provider/generation evidence and distractors present.
2. Start an image query from a saved related photo and open the expected visual
   match. Similarity must never establish exact identity or authorize deletion.
3. Download the selected original and verify its complete SHA-256 and length
   against the independently retained input.

Record actual readiness and unavailable outcomes in the same journey. A model
manifest, fixture vector, new button or screenshot alone does not pass it.
Other platforms and general recall/release qualification remain unproven.

## Local delivery evidence (2026-10-20)

The pinned Chinese-CLIP bundle is installed and activated on the current
Darwin arm64 preview. The ordinary browser at the isolated test instance
returned the independently expected first photo for both Chinese queries:
“客厅里白色沙发和木质茶几” -> `a.jpg`, and
“一个佩戴银色耳环的人的耳朵特写” -> `c.jpg`. Image-query source `b.jpg`
returned `b.jpg`, then the related interior photo `a.jpg`, ahead of unrelated
`c.jpg`. Responses identify the actual `multimodal-clip` generation and
`query.multimodal.onnx-clip-zvec.v1`; filenames and OCR were not the oracle.
The expected matched photo opened in the photo viewer and existing Details.
Both downloaded originals matched their independent SHA-256 and byte lengths.

The integrated browser result is retained at
`dist/product-showcase-20261020/client/acceptance-result.json`; it accumulates
resumed steps after narrow driver-selector/scope corrections. Earlier failures
are retained and are not product failures. Music continuity and controls also
passed. Photo slideshow timing/loop/pause/Escape/focus assertions passed in
the earlier run, but only their PASS state was retained, not detailed metrics.

The current owner instance at `http://127.0.0.1:4648` has 11 images in READY
CLIP generation `idx_129b2b8a3e58891f6efd00502853bd1f`. Local delivery readback
is in `dist/product-showcase-20261020/promotion/postcheck.json`. Its native
binary, CLI, configuration, OCR manifest and the 20 listed content identities
are unchanged; prior lexical/BGE generations remain retained. Explicit rebuild
returned DEGRADED because six lexical metadata fields lack coverage; this is
not complete default discovery or Phase 4 qualification. The final Web differs
from the functional acceptance candidate only in corrected Chinese result
wording and two scoped Music CSS refinements, recorded in `web-delivery.json`.
The conversion-license uncertainty and redistribution review remain open.

## Local preparation and use

The initial assembler supports Darwin arm64 and requires Python 3.12 plus a Go
build toolchain. It reuses the verified ONNX Runtime from an already prepared
BGE bundle in the explicitly supplied models root. Its private ONNX build
environment stays under the output directory.

```sh
scripts/assemble-image-bundle.sh \
  --out /absolute/clip-build \
  --models-root /absolute/configured-models \
  --archive /absolute/clip-build/chinese-clip-darwin-arm64.tar
cairn image bundle install --archive /absolute/clip-build/chinese-clip-darwin-arm64.tar
```

The primary pinned source is Hugging Face. `--source-base https://hf-mirror.com`
changes only the transport: exact revisions, expected source hashes and length
checks remain the same. Interrupted or mismatched assets cannot become an
activatable bundle. The conversion's license declaration is unresolved; the
bundle records `LicenseRef-Xenova-Conversion-Unspecified` and the pinned
base-model provenance. It is a local development artifact, not an approved
redistribution package.

Restart the configured daemon after installation, then explicitly prepare the
existing search indexes. In Photos, enter a scene description in **Find photos
by visual content**, or open a photo's **More actions** and choose **Search by
this image**. Neither query installs assets or runs historical processors.
Original takeout uses the same existing download action.

## Exclusions and existing seams

No face recognition, scanned-PDF OCR, video indexing, new processor, public
command, endpoint, durable schema, recovery format, runtime loader, source
deletion, automatic historical backfill or plugin marketplace.

Existing seams: `scripts/assemble-image-bundle.sh`,
`server/internal/search/image_bundle.go`, `image_provider.go`, `image_index.go`,
`server/internal/processor/image_tower.go`, and the current Photos image-query
action. Scope authority remains AGENTS, the normative discovery/client
contracts and the Core MVP Execution Plan.
