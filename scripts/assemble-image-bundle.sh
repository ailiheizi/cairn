#!/bin/bash
# Assemble one admitted image (Chinese-CLIP) bundle from its pinned source, so
# the artifact can be rebuilt on another host instead of copied by hand.
#
#   scripts/assemble-image-bundle.sh --out DIR [--models-root DIR] [--proxy URL] [--source-base URL] [--archive PATH]
#
# The source export is a single combined ONNX graph, so this script splits it
# into the two towers the bundle admits and writes the descriptor, the notice,
# and an honest SBOM with every digest computed from the bytes it just produced.
# It never touches a running daemon or an installed model profile. Its build
# tools live only in a private virtual environment under the output directory.
# Install the resulting archive explicitly with
#   cairn image bundle install --archive <PATH>
#
# Requires: python3.12, tar, and (for --archive) a Go toolchain. The ONNX toolchain
# is pinned in a private virtual environment under the output directory.
set -eu

SOURCE_REPO="Xenova/chinese-clip-vit-base-patch16"
SOURCE_REVISION="f26904860903e70e050b8f48255e5f48401816e9"
MODEL_SOURCE_SHA256="a2c2849329eafb24100acec5a9421a39f8cb445296444c5c98855b69e5e7a751"
TOKENIZER_SOURCE_SHA256="7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839"
TOKENIZER_SOURCE_SIZE=439124
CONFIG_SOURCE_SHA256="19447ad8c20d274f0644a6663af56286be98bd2d0e5f9472fcb318e04fcd6961"
TOKENIZER_CONFIG_SOURCE_SHA256="38fbc894183595cc1168e36150251b2fb658197b3a49f6908cce88ae22acd52a"
BASE_CARD_SHA256="98b45ea81164d1e1a1dd82255207053b15cd6c69d922a1c5cf3387ce604d4b74"
APACHE_LICENSE_SHA256="cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
UPSTREAM_REPO="OFA-Sys/chinese-clip-vit-base-patch16"
# The conversion config identifies this base model. Its pinned Hugging Face
# model card declares Apache-2.0; the GitHub code repo's MIT license is not
# treated as evidence for model weights.
UPSTREAM_REVISION="386ceb94f3f773fe2e16bb5883d5d1702b647def"
PROFILE_ID="chinese-clip-vit-base-patch16"
MODEL_ID="$SOURCE_REPO"
MODEL_EXPORT="onnx-quantized-split-towers-v1"
MODEL_VERSION="chinese-clip-vit-base-patch16-quantized-split-512-xenova-f2690486"
MODEL_SOURCE_SIZE=190842404
TOKENIZER_VERSION="clip-roberta-wwm-wordpiece-v1+lowercase"
PREPROCESS_PROFILE="clip-224-rgb-bicubic-a075-scaled-center-crop-l2-v1"
RUNTIME_VERSION="1.29.0"
ONNX_OPSET="14"
DIMENSION="512"
IMAGE_SIZE="224"
MAX_TOKENS="52"

out=
proxy=
source_base="https://huggingface.co"
archive=
models_root=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --proxy) proxy=$2; shift 2 ;;
    --source-base) source_base=$2; shift 2 ;;
    --archive) archive=$2; shift 2 ;;
    --models-root) models_root=$2; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "error: --out is required" >&2; exit 2; }
case "$source_base" in https://huggingface.co|https://hf-mirror.com) ;; *) echo "error: --source-base must be the primary Hub or hf-mirror.com" >&2; exit 2 ;; esac
case "$out" in /*) ;; *) echo "error: --out must be an absolute path" >&2; exit 2 ;; esac
case "$archive" in ""|/*) ;; *) echo "error: --archive must be an absolute path" >&2; exit 2 ;; esac
case "$models_root" in ""|/*) ;; *) echo "error: --models-root must be an absolute path" >&2; exit 2 ;; esac
[ -n "$models_root" ] || models_root=$out

case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "error: unsupported OS" >&2; exit 2 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) echo "error: unsupported architecture" >&2; exit 2 ;; esac
[ "$os/$arch" = "darwin/arm64" ] || { echo "error: this admitted image bundle is prepared only for darwin/arm64" >&2; exit 2; }

curl_proxy=()
[ -n "$proxy" ] && curl_proxy=(--proxy "$proxy")

bundle="$out/$PROFILE_ID/$os-$arch"
work="$out/.work"
venv="$out/.onnx-venv"
evidence="$out/evidence/source"
mkdir -p "$bundle" "$work" "$evidence"

echo "1/6  ONNX toolchain"
[ -x "$venv/bin/python" ] || python3.12 -m venv "$venv"
# Only ONNX graph tooling is needed here. Runtime 1.29.0 is copied from the
# already admitted BGE bundle below; do not install an unrelated Python runtime.
"$venv/bin/python" -m pip install -q --disable-pip-version-check \
  'pip==24.3.1' 'onnx==1.17.0' 'numpy==2.1.3' 'protobuf==5.28.3' 'typing_extensions==4.12.2'

echo "2/6  pinned source export"
base="$source_base/$SOURCE_REPO/resolve/$SOURCE_REVISION"
sha256_file() { "$venv/bin/python" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
check_sha256() {
  actual=$(sha256_file "$1")
  [ "$actual" = "$2" ] || { echo "error: pinned SHA-256 mismatch for $3: $actual" >&2; exit 1; }
}
fetch_pinned() {
  target=$1 expected=$2 url=$3 label=$4 cached=${5:-}
  if [ -f "$target" ] && [ "$(sha256_file "$target")" = "$expected" ]; then
    return
  fi
  if [ -n "$cached" ] && [ -f "$cached" ] && [ "$(sha256_file "$cached")" = "$expected" ]; then
    cp "$cached" "$target"
    return
  fi
  curl --connect-timeout 8 --max-time 45 -fsSL ${curl_proxy[@]+"${curl_proxy[@]}"} -o "$target" "$url"
  check_sha256 "$target" "$expected" "$label"
}
fetch_pinned "$work/model.onnx" "$MODEL_SOURCE_SHA256" "$base/onnx/model_quantized.onnx" "model_quantized.onnx"
fetch_pinned "$bundle/tokenizer.json" "$TOKENIZER_SOURCE_SHA256" "$base/tokenizer.json" "tokenizer.json" "$evidence/xenova-tokenizer.json"
fetch_pinned "$evidence/xenova-config.json" "$CONFIG_SOURCE_SHA256" "$base/config.json" "config.json"
fetch_pinned "$evidence/xenova-tokenizer-config.json" "$TOKENIZER_CONFIG_SOURCE_SHA256" "$base/tokenizer_config.json" "tokenizer_config.json"
upstream_base="https://huggingface.co/$UPSTREAM_REPO/resolve/$UPSTREAM_REVISION"
fetch_pinned "$evidence/upstream-model-card-license-metadata.txt" "$BASE_CARD_SHA256" "$upstream_base/README.md" "upstream model card"
fetch_pinned "$bundle/LICENSE" "$APACHE_LICENSE_SHA256" "https://www.apache.org/licenses/LICENSE-2.0.txt" "Apache-2.0 license text" "$evidence/apache-license-2.0.txt"
check_sha256 "$bundle/tokenizer.json" "$TOKENIZER_SOURCE_SHA256" "tokenizer.json"
check_sha256 "$evidence/xenova-config.json" "$CONFIG_SOURCE_SHA256" "config.json"
check_sha256 "$evidence/xenova-tokenizer-config.json" "$TOKENIZER_CONFIG_SOURCE_SHA256" "tokenizer_config.json"
check_sha256 "$evidence/upstream-model-card-license-metadata.txt" "$BASE_CARD_SHA256" "upstream model card"
check_sha256 "$bundle/LICENSE" "$APACHE_LICENSE_SHA256" "Apache-2.0 license text"
tokenizer_size=$($venv/bin/python -c 'import os,sys;print(os.path.getsize(sys.argv[1]))' "$bundle/tokenizer.json")
[ "$tokenizer_size" = "$TOKENIZER_SOURCE_SIZE" ] || { echo "error: pinned tokenizer size mismatch: $tokenizer_size" >&2; exit 1; }
if ! grep -qiE 'license:[[:space:]]*apache-2\.0' "$evidence/upstream-model-card-license-metadata.txt"; then
  echo "error: pinned base model card does not declare Apache-2.0" >&2
  exit 1
fi
if ! grep -qi 'Apache License' "$bundle/LICENSE" || ! grep -qi 'Version 2.0' "$bundle/LICENSE"; then
  echo "error: Apache-2.0 license text did not validate" >&2
  exit 1
fi
cp "$work/model.onnx" "$evidence/xenova-model_quantized.onnx"
cp "$bundle/tokenizer.json" "$evidence/xenova-tokenizer.json"
if [ ! -s "$work/model.onnx" ] || [ ! -s "$bundle/tokenizer.json" ]; then
  echo "error: pinned model export or tokenizer is empty" >&2
  exit 1
fi
actual_model_sha256=$(sha256_file "$work/model.onnx")
if [ "$actual_model_sha256" != "$MODEL_SOURCE_SHA256" ]; then
  echo "error: pinned source model SHA-256 mismatch: $actual_model_sha256" >&2
  exit 1
fi
actual_model_size=$($venv/bin/python -c 'import os,sys;print(os.path.getsize(sys.argv[1]))' "$work/model.onnx")
if [ "$actual_model_size" != "$MODEL_SOURCE_SIZE" ]; then
  echo "error: pinned source model size mismatch: $actual_model_size" >&2
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
  reused_bge="$out/reused/bge-small-zh-v1.5/$os-$arch"
  mkdir -p "$(dirname "$reused_bge")"
  if [ ! -d "$reused_bge" ]; then
    cp -R "$models_root/bge-small-zh-v1.5/$os-$arch" "$reused_bge"
  fi
  "$venv/bin/python" - "$reused_bge" <<'PY'
import hashlib,json,os,sys
root=sys.argv[1]
manifest=json.load(open(os.path.join(root,"semantic-bundle.json"),encoding="utf-8"))
runtime=manifest.get("runtime",{})
path=runtime.get("path","")
if (manifest.get("schema")!="cairn.semantic-bundle.v1" or manifest.get("profile_id")!="bge-small-zh-v1.5"
    or manifest.get("platform_os")!="darwin" or manifest.get("platform_arch")!="arm64"
    or manifest.get("onnx_runtime_version")!="1.29.0" or manifest.get("onnx_runtime_c_api")!=29
    or path!="runtime.bin"):
    raise SystemExit("error: copied BGE bundle manifest does not match the admitted Darwin arm64 runtime profile")
digest=hashlib.sha256(open(os.path.join(root,path),"rb").read()).hexdigest()
size=os.path.getsize(os.path.join(root,path))
if digest!=runtime.get("sha256") or size!=runtime.get("size"):
    raise SystemExit("error: copied BGE runtime bytes do not match semantic-bundle.json")
sbom=json.load(open(os.path.join(root,"sbom.json"),encoding="utf-8"))
for asset_name in ("license","notice"):
    fact=sbom.get("assets",{}).get(asset_name,{})
    asset_path=os.path.join(root,fact.get("path",""))
    if not fact or not os.path.isfile(asset_path): raise SystemExit(f"error: reused BGE {asset_name} provenance is incomplete")
    if hashlib.sha256(open(asset_path,"rb").read()).hexdigest()!=fact.get("sha256"):
        raise SystemExit(f"error: reused BGE {asset_name} bytes do not match its SBOM")
native=sbom.get("native_text_sources",{})
for key,filename,embedded,expected_size in (
    ("onnxruntime_license_text","onnxruntime-license.txt","LICENSE",1073),
    ("onnxruntime_third_party_notices_text","onnxruntime-third-party-notices.txt","NOTICE",336906),
):
    fact=native.get(key,{})
    if fact.get("embedded_in_asset")!=embedded or fact.get("text_size")!=expected_size:
        raise SystemExit(f"error: reused BGE {key} metadata is not the expected ORT 1.29.0 source")
    source=open(os.path.join(root,sbom["assets"][embedded.lower()]["path"]),"rb").read()
    if embedded=="LICENSE":
        start=source.index(b"ONNX Runtime 1.29.0 license text ")
        start=source.index(b"\n\n",start)+2
        end=source.index(b"\n\nonnxruntime_go:",start)
        text=source[start:end].strip()
    else:
        start=source.index(b"\n\nTHIRD PARTY SOFTWARE NOTICES AND INFORMATION")+2
        end=source.index(b"\nzvec native v0.6.0 NOTICE",start)
        text=source[start:end].strip()
    text=text+(b"\n" if embedded=="LICENSE" else b"")
    if len(text)!=fact["text_size"] or hashlib.sha256(text).hexdigest()!=fact["text_sha256"]:
        raise SystemExit(f"error: extracted reused BGE {key} does not match its source hash")
    open(os.path.join(os.path.dirname(root),"..","..","evidence","source",filename),"wb").write(text)
PY
  cp "$reused_bge/runtime.bin" "$bundle/runtime.bin"
else
  echo "error: no admitted runtime at $runtime_source; install the semantic bundle first" >&2
  exit 1
fi

echo "5/6  descriptor, notice, sbom"
"$venv/bin/python" -m pip freeze > "$out/evidence/build-python-packages.txt"
"$venv/bin/python" - "$bundle" "$PROFILE_ID" "$MODEL_ID" "$MODEL_EXPORT" "$MODEL_VERSION" \
  "$TOKENIZER_VERSION" "$PREPROCESS_PROFILE" "$RUNTIME_VERSION" "$ONNX_OPSET" "$DIMENSION" "$IMAGE_SIZE" \
  "$MAX_TOKENS" "$os" "$arch" "$SOURCE_REVISION" "$UPSTREAM_REPO" "$UPSTREAM_REVISION" "$evidence" <<'PY'
import hashlib, importlib.metadata, json, os, sys
(bundle, profile, model_id, model_export, model_version, tokenizer_version, preprocess,
 runtime, opset, dimension, image_size, max_tokens, os_name, arch, revision,
 upstream_repo, upstream_revision, evidence) = sys.argv[1:19]
def asset(name, path):
    data = open(os.path.join(bundle, path), "rb").read()
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
def file_fact(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)
    return {"sha256":h.hexdigest(),"size":os.path.getsize(path)}
notice = f"""NOTICE

Assembled by scripts/assemble-image-bundle.sh on the host that ran it, from the
community ONNX conversion of Chinese-CLIP ViT-B/16:

  source model : {model_id} @ {revision}
  upstream     : {upstream_repo} @ {upstream_revision} (pinned model card declares Apache-2.0)
  derivation   : the published export is one combined graph; vision.onnx keeps
                 pixel_values -> image_embeds and text.onnx keeps
                 input_ids + attention_mask -> text_embeds.

Honest gaps: the conversion repository's pinned model card does not separately
declare a license. Its pinned config identifies the above base model, whose
pinned model card declares Apache-2.0. This is provenance evidence, not a legal
opinion about every conversion artifact. Redistribution review remains open.
The descriptor records the conversion as LicenseRef-Xenova-Conversion-Unspecified
and the base model as Apache-2.0; do not infer redistribution qualification.
The text tower declares no token type ids; tokenizer config declares
do_lower_case=true.
"""
ort_license = open(os.path.join(evidence,"onnxruntime-license.txt"),"rb").read()
ort_notices = open(os.path.join(evidence,"onnxruntime-third-party-notices.txt"),"rb").read()
with open(os.path.join(bundle,"LICENSE"),"ab") as f:
    f.write(b"\n\nONNX Runtime 1.29.0 license (reused from the verified BGE runtime bundle):\n\n")
    f.write(ort_license)
with open(os.path.join(bundle,"NOTICE"),"wb") as f:
    f.write(notice.encode("utf-8"))
    f.write(b"\n\nONNX Runtime 1.29.0 ThirdPartyNotices (reused from the verified BGE runtime bundle):\n\n")
    f.write(ort_notices)
source_files = {name:file_fact(os.path.join(evidence,name)) for name in sorted(os.listdir(evidence)) if os.path.isfile(os.path.join(evidence,name))}
evidence_root = os.path.dirname(evidence)
package_inventory_path = os.path.join(evidence_root,"build-python-packages.txt")
package_inventory = open(package_inventory_path,encoding="utf-8").read().splitlines()
package_inventory_fact = file_fact(package_inventory_path)
build_tool_components=[]
for dist in sorted(importlib.metadata.distributions(),key=lambda item:(item.metadata.get("Name") or "").lower()):
    meta=dist.metadata
    licenses=meta.get_all("License") or []
    licenses += [value.split("::",1)[-1].strip() for value in (meta.get_all("Classifier") or []) if value.startswith("License ::")]
    build_tool_components.append({"name":meta.get("Name") or "unknown","version":dist.version,"license_metadata":sorted(set(licenses))})
bundle_assets = {name:file_fact(os.path.join(bundle,name)) for name in ("LICENSE","NOTICE","runtime.bin","vision.onnx","text.onnx","tokenizer.json")}
sbom = {
  "schema": "cairn.image-bundle.sbom.v1", "incomplete": False,
  "inventory_scope":"all model source inputs, delivered model/runtime/license/notice/tokenizer assets, pinned Python build packages and their installed metadata",
  "redistribution_review_status":"PENDING: conversion repository does not separately declare a license; provenance maps it to the pinned Apache-2.0 base model card",
  "components": [
    {"name":model_id,"revision":revision,"asset":"source/xenova-model_quantized.onnx","sha256":source_files["xenova-model_quantized.onnx"]["sha256"],"license":"not separately declared in conversion model card"},
    {"name":upstream_repo,"revision":upstream_revision,"asset":"source/upstream-model-card-license-metadata.txt","sha256":source_files["upstream-model-card-license-metadata.txt"]["sha256"],"license":"Apache-2.0"},
    {"name":"onnx","version":"1.17.0","purpose":"graph splitting","license":"Apache-2.0"},
    {"name":"numpy","version":"2.1.3","purpose":"onnx dependency","license":"BSD-3-Clause"},
    {"name":"protobuf","version":"5.28.3","purpose":"onnx dependency","license":"BSD-3-Clause"},
    {"name":"typing_extensions","version":"4.12.2","purpose":"onnx dependency","license":"PSF-2.0"},
    {"name":"ONNX Runtime","version":runtime,"source":"existing admitted BGE Darwin arm64 runtime.bin","sha256":file_fact(os.path.join(bundle,"runtime.bin"))["sha256"],"license":"MIT","license_asset":"LICENSE","license_text_sha256":source_files["onnxruntime-license.txt"]["sha256"],"third_party_notice_asset":"NOTICE","third_party_notice_sha256":source_files["onnxruntime-third-party-notices.txt"]["sha256"]}
  ],
  "source_assets":source_files,
  "runtime_license_provenance":{"bundle":"bge-small-zh-v1.5/darwin-arm64","semantic_bundle_sha256":json.load(open(os.path.join(evidence_root,"reused-bge-assets.json"),encoding="utf-8"))["files"]["semantic-bundle.json"]["sha256"],"license_source":"source/onnxruntime-license.txt","notice_source":"source/onnxruntime-third-party-notices.txt"},
  "build_python":"3.12",
  "build_packages":["pip==24.3.1","onnx==1.17.0","numpy==2.1.3","protobuf==5.28.3","typing_extensions==4.12.2"],
  "build_tool_components":build_tool_components,
  "resolved_build_environment":{"pip_freeze":package_inventory,"asset_sha256":package_inventory_fact["sha256"],"asset_size":package_inventory_fact["size"]},
  "bundle_assets":bundle_assets
}
open(os.path.join(bundle, "sbom.json"), "w").write(json.dumps(sbom, indent=2) + "\n")
descriptor = {
  "schema": "cairn.image-bundle.v1", "profile_id": profile,
  "platform_os": os_name, "platform_arch": arch,
  "runtime_version": runtime,
  "runtime_build": f"onnxruntime-cpu-{os_name}-{arch}-{runtime}",
  "onnx_runtime_c_api": 29, "onnx_opset": int(opset),
  "model_id": model_id, "model_revision": revision, "model_export": model_export,
  "model_license_id": "LicenseRef-Xenova-Conversion-Unspecified", "license_expression": "Apache-2.0 AND LicenseRef-Xenova-Conversion-Unspecified",
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
open(os.path.join(os.path.dirname(evidence), "source-evidence.json"), "w").write(json.dumps({
  "conversion_repo":model_id,"conversion_revision":revision,
  "base_model_repo":upstream_repo,"base_model_revision":upstream_revision,
  "base_model_license":"Apache-2.0","conversion_model_card_license":"not declared",
  "source_assets":source_files,"build_packages":sbom["build_packages"]
},indent=2)+"\n")
PY

echo "6/6  verify and package"
if [ -n "$archive" ]; then
  go run ./server/internal/releasequal/cmd/image-bundle-archive --source "$bundle" --output "$archive"
fi
echo "bundle:  $bundle"
echo "install: cairn image bundle install --archive <PATH>"
