#!/bin/bash
# Assemble one admitted image (Chinese-CLIP) bundle from its pinned source, so
# the artifact can be rebuilt on another host instead of copied by hand.
#
#   scripts/assemble-image-bundle.sh --out DIR [--models-root DIR] [--proxy URL] [--archive PATH]
#
# The source export is a single combined ONNX graph, so this script splits it
# into the two towers the bundle admits and writes the descriptor, the notice,
# and an honest SBOM with every digest computed from the bytes it just produced.
# It never touches a running daemon and never installs anything: install with
#   cairn image bundle install --archive <PATH>
#
# Requires: python3, tar, and (for --archive) a Go toolchain. The ONNX toolchain
# is installed into a private virtual environment under the output directory.
set -eu

SOURCE_REPO="Xenova/chinese-clip-vit-base-patch16"
SOURCE_REVISION="f26904860903"
UPSTREAM_REPO="OFA-Sys/chinese-clip-vit-base-patch16"
# The licence lives in the upstream GitHub project, whose name differs from the
# Hugging Face model id that carries the weights.
UPSTREAM_GITHUB_REPO="OFA-Sys/Chinese-CLIP"
PROFILE_ID="chinese-clip-vit-base-patch16"
MODEL_ID="$SOURCE_REPO"
MODEL_EXPORT="onnx-quantized-split-towers-v1"
MODEL_VERSION="chinese-clip-vit-base-patch16-quantized-split-512"
TOKENIZER_VERSION="clip-roberta-wwm-wordpiece-v1+lowercase"
PREPROCESS_PROFILE="clip-224-rgb-bicubic-a075-scaled-center-crop-l2-v1"
RUNTIME_VERSION="1.29.0"
ONNX_OPSET="14"
DIMENSION="512"
IMAGE_SIZE="224"
MAX_TOKENS="52"

out=
proxy=
archive=
models_root=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --proxy) proxy=$2; shift 2 ;;
    --archive) archive=$2; shift 2 ;;
    --models-root) models_root=$2; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "error: --out is required" >&2; exit 2; }
case "$out" in /*) ;; *) echo "error: --out must be an absolute path" >&2; exit 2 ;; esac
case "$archive" in ""|/*) ;; *) echo "error: --archive must be an absolute path" >&2; exit 2 ;; esac
case "$models_root" in ""|/*) ;; *) echo "error: --models-root must be an absolute path" >&2; exit 2 ;; esac
[ -n "$models_root" ] || models_root=$out

case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "error: unsupported OS" >&2; exit 2 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) echo "error: unsupported architecture" >&2; exit 2 ;; esac

curl_proxy=()
[ -n "$proxy" ] && curl_proxy=(--proxy "$proxy")

bundle="$out/$PROFILE_ID/$os-$arch"
work="$out/.work"
venv="$out/.onnx-venv"
mkdir -p "$bundle" "$work"

echo "1/6  ONNX toolchain"
[ -x "$venv/bin/python" ] || python3 -m venv "$venv"
"$venv/bin/pip" install -q --disable-pip-version-check onnx onnxruntime >/dev/null

echo "2/6  pinned source export"
base="https://huggingface.co/$SOURCE_REPO/resolve/$SOURCE_REVISION"
curl -sSL "${curl_proxy[@]}" -o "$work/model.onnx" "$base/onnx/model_quantized.onnx"
curl -sSL "${curl_proxy[@]}" -o "$bundle/tokenizer.json" "$base/tokenizer.json"
# The license must be the upstream licence text. A missing or unrelated file is
# a hard failure rather than a silent fallback, because a bundle whose licence
# asset is not a licence is worse than no bundle at all.
license_fetched=false
if command -v gh >/dev/null 2>&1; then
  if gh api "repos/$UPSTREAM_GITHUB_REPO/license" --jq '.content' 2>/dev/null | base64 -d > "$bundle/LICENSE" 2>/dev/null; then
    license_fetched=true
  fi
fi
if [ "$license_fetched" != true ]; then
  for branch in main master; do
    if curl -sSL "${curl_proxy[@]}" -o "$bundle/LICENSE" "https://raw.githubusercontent.com/$UPSTREAM_GITHUB_REPO/$branch/LICENSE"; then
      if ! head -c 40 "$bundle/LICENSE" | grep -q "404"; then
        license_fetched=true
        break
      fi
    fi
  done
fi
if [ "$license_fetched" != true ] || ! grep -qiE "permission is hereby granted|mit license" "$bundle/LICENSE"; then
  echo "error: could not fetch the upstream MIT licence text from $UPSTREAM_GITHUB_REPO" >&2
  echo "hint:  set --proxy, or place the licence text at $bundle/LICENSE manually" >&2
  exit 1
fi

echo "3/6  split the two towers"
"$venv/bin/python" - "$work/model.onnx" "$bundle" <<'PY'
import sys, onnx
source, bundle = sys.argv[1], sys.argv[2]
onnx.utils.extract_model(source, bundle + "/vision.onnx", ["pixel_values"], ["image_embeds"])
onnx.utils.extract_model(source, bundle + "/text.onnx", ["input_ids", "attention_mask"], ["text_embeds"])
PY

echo "4/6  pinned ONNX Runtime"
# The runtime must be the installed pinned build rather than a second download,
# so the image towers share the exact runtime the text bundle already admitted.
runtime_source="$models_root/bge-small-zh-v1.5/$os-$arch/runtime.bin"
if [ -f "$runtime_source" ]; then
  cp "$runtime_source" "$bundle/runtime.bin"
else
  echo "error: no admitted runtime at $runtime_source; install the semantic bundle first" >&2
  exit 1
fi

echo "5/6  descriptor, notice, sbom"
"$venv/bin/python" - "$bundle" "$PROFILE_ID" "$MODEL_ID" "$MODEL_EXPORT" "$MODEL_VERSION" \
  "$TOKENIZER_VERSION" "$PREPROCESS_PROFILE" "$RUNTIME_VERSION" "$ONNX_OPSET" "$DIMENSION" "$IMAGE_SIZE" \
  "$MAX_TOKENS" "$os" "$arch" "$SOURCE_REVISION" <<'PY'
import hashlib, json, os, sys
(bundle, profile, model_id, model_export, model_version, tokenizer_version, preprocess,
 runtime, opset, dimension, image_size, max_tokens, os_name, arch, revision) = sys.argv[1:16]
def asset(name, path):
    data = open(os.path.join(bundle, path), "rb").read()
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
notice = f"""NOTICE

Assembled by scripts/assemble-image-bundle.sh on the host that ran it, from the
community ONNX conversion of Chinese-CLIP ViT-B/16:

  source model : {model_id} @ {revision}
  upstream     : OFA-Sys/chinese-clip-vit-base-patch16 (MIT)
  derivation   : the published export is one combined graph; vision.onnx keeps
                 pixel_values -> image_embeds and text.onnx keeps
                 input_ids + attention_mask -> text_embeds.

Honest gaps: the conversion repository publishes no LICENSE file, so the weights
are redistributed under the upstream MIT license; this is a development install
and not a completed redistribution review. The text tower declares no token type
ids, and the admitted tokenizer declares do_lower_case=true.
"""
sbom = {"schema": "cairn.image-bundle.sbom.v1", "incomplete": True,
        "incomplete_reason": "redistribution review and clean-host exercise remain open",
        "components": [{"name": model_id, "revision": revision,
                        "license": "MIT (asserted from the upstream project)"}]}
open(os.path.join(bundle, "NOTICE"), "w").write(notice)
open(os.path.join(bundle, "sbom.json"), "w").write(json.dumps(sbom, indent=2) + "\n")
descriptor = {
  "schema": "cairn.image-bundle.v1", "profile_id": profile,
  "platform_os": os_name, "platform_arch": arch,
  "runtime_version": runtime,
  "runtime_build": f"onnxruntime-cpu-{os_name}-{arch}-{runtime}",
  "onnx_runtime_c_api": 29, "onnx_opset": int(opset),
  "model_id": model_id, "model_revision": revision, "model_export": model_export,
  "model_license_id": "MIT", "license_expression": "MIT",
  "tokenizer_version": tokenizer_version, "model_version": model_version,
  "image_input": "pixel_values", "text_input": "input_ids+attention_mask",
  "query_instruction": "", "pooling": "graph-projected-embedding", "normalization": "l2",
  "preprocessing_digest": "sha256:" + hashlib.sha256(("cairn.image-preprocess.v1\n" + preprocess).encode()).hexdigest(),
  "element_type": "float32", "dimension": int(dimension), "vector_schema": "float32:" + dimension,
  "distance": "cosine", "index_config": "hnsw:m=16", "query_config": "ef=64",
  "image_size": int(image_size), "max_tokens": int(max_tokens),
  "runtime": asset("runtime", "runtime.bin"), "vision": asset("vision", "vision.onnx"),
  "text": asset("text", "text.onnx"), "tokenizer": asset("tokenizer", "tokenizer.json"),
  "license": asset("license", "LICENSE"), "notice": asset("notice", "NOTICE"),
  "sbom": asset("sbom", "sbom.json"),
}
open(os.path.join(bundle, "image-bundle.json"), "w").write(json.dumps(descriptor, indent=2) + "\n")
PY

echo "6/6  verify and package"
if [ -n "$archive" ]; then
  go run ./server/internal/releasequal/cmd/image-bundle-archive --source "$bundle" --output "$archive"
fi
echo "bundle:  $bundle"
echo "install: cairn image bundle install --archive <PATH>"
