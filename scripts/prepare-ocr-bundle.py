#!/usr/bin/env python3
"""Assemble the admitted PP-OCRv4 bundle from digest-pinned local/upstream assets.

This explicit operator tool does not run OCR, install a service, change config,
or download anything during capture/query. It publishes only below --models-root.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


OCR_PROFILE = "rapidocr-ppocr-mobile-v1"
MODEL_REVISION = "3702ce8b03d6f64083c275cda2b0ce9440e68fd3"
MODEL_SOURCE_ROOT = f"https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/{MODEL_REVISION}"
MODEL_LICENSE_README_SHA256 = "58dfd78e08f7cb014834a6746be6f99b6a5dad4055c04272fb84648432610393"
MODEL_LICENSE_README_BYTES = 248

DETECTION = {
    "url": f"{MODEL_SOURCE_ROOT}/models/text_det/ch_PP-OCRv4_det_infer.onnx",
    "sha256": "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    "bytes": 4_745_517,
    "name": "det.onnx",
}
RECOGNITION = {
    "url": f"{MODEL_SOURCE_ROOT}/models/text_rec/ch_PP-OCRv4_rec_infer.onnx",
    "sha256": "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    "bytes": 10_857_958,
    "name": "rec.onnx",
}
DICTIONARY_URL = (
    "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v2.0.7/"
    "paddle/PP-OCRv4/rec/ch_PP-OCRv4_rec_infer/ppocr_keys_v1.txt"
)
DICTIONARY_BASE_REVISION = "v2.0.7"
DICTIONARY_BASE_SHA256 = "28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7"
DICTIONARY_BASE_BYTES = 26_249
DICTIONARY_DERIVED_SHA256 = "c084fa990ecf0ce7fcb6bd5a3b689382645ec454e6f6af712b3d6be0addfdaf5"
DICTIONARY_DERIVED_BYTES = 26_252
DICTIONARY_BASE_CHARS = 6_623

APACHE_LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0.txt"
APACHE_LICENSE_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
APACHE_LICENSE_BYTES = 11_358

EXPECTED_RUNTIME_VERSION = "1.29.0"
EXPECTED_RUNTIME_CAPI = 29
MAX_RUNTIME_BYTES = 256 << 20
MAX_MODEL_BYTES = 256 << 20
MAX_DICTIONARY_BYTES = 16 << 20
MAX_LICENSE_BYTES = 16 << 20
DOWNLOAD_TIMEOUT_SECONDS = 45
DOWNLOAD_ATTEMPTS = 3
CHUNK_BYTES = 1024 * 1024


class PreparationError(Exception):
    pass


class HTTPSOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self) -> None:
        super().__init__()
        self._redirect_count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self._redirect_count += 1
        if self._redirect_count > 10:
            raise PreparationError("refusing more than 10 asset redirects")
        old_scheme = req.full_url.split(":", 1)[0].lower()
        new_scheme = newurl.split(":", 1)[0].lower()
        if old_scheme != "https" or new_scheme != "https":
            raise PreparationError("asset sources and redirects must remain HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_json(path: Path) -> dict:
    def reject_duplicate_keys(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise PreparationError(f"duplicate JSON key {key!r} in {path}")
            out[key] = value
        return out

    try:
        value = json.loads(path.read_text("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PreparationError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PreparationError(f"{path} must contain a JSON object")
    return value


def go_platform() -> tuple[str, str]:
    os_name = platform.system().lower()
    machine = platform.machine().lower()
    arch_map = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}
    arch = arch_map.get(machine)
    if os_name not in ("darwin", "linux") or arch is None:
        raise PreparationError(f"OCR's supported ONNX build is unavailable for {os_name}/{machine}")
    return os_name, arch


def safe_bundle_file(root: Path, rel: object, label: str) -> Path:
    if not isinstance(rel, str) or not rel or Path(rel).is_absolute():
        raise PreparationError(f"runtime bundle {label} path is not a clean relative path")
    candidate = root / rel
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
        info = candidate.lstat()
    except (OSError, ValueError) as exc:
        raise PreparationError(f"runtime bundle {label} path is unavailable or escapes its root: {exc}") from exc
    if candidate.is_symlink() or not resolved.is_file() or not stat.S_ISREG(info.st_mode):
        raise PreparationError(f"runtime bundle {label} must be a regular non-symlink file")
    return candidate


def verify_local_asset(root: Path, spec: object, label: str, max_bytes: int) -> tuple[Path, bytes, str]:
    if not isinstance(spec, dict):
        raise PreparationError(f"semantic-bundle.json has no valid {label} pin")
    path = safe_bundle_file(root, spec.get("path"), label)
    expected_bytes = spec.get("size")
    expected_sha = spec.get("sha256")
    if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes <= 0 or expected_bytes > max_bytes:
        raise PreparationError(f"runtime bundle {label} size pin is outside 1..{max_bytes}")
    if not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise PreparationError(f"runtime bundle {label} SHA-256 pin is malformed")
    try:
        actual_bytes = path.stat().st_size
        if actual_bytes != expected_bytes:
            raise PreparationError(f"runtime bundle {label} is {actual_bytes} bytes, pin says {expected_bytes}")
        digest = hashlib.sha256()
        chunks = []
        with path.open("rb") as src:
            while True:
                chunk = src.read(CHUNK_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
                chunks.append(chunk)
        body = b"".join(chunks)
    except OSError as exc:
        raise PreparationError(f"cannot verify runtime bundle {label}: {exc}") from exc
    actual_sha = digest.hexdigest()
    if actual_sha != expected_sha.lower():
        raise PreparationError(f"runtime bundle {label} digest {actual_sha} does not match its manifest")
    return path, body, actual_sha


def download_pinned(url: str, expected_sha: str, expected_bytes: int, max_bytes: int, output: Path, label: str) -> dict:
    if not url.startswith("https://"):
        raise PreparationError(f"{label} source must use HTTPS")
    if expected_bytes <= 0 or expected_bytes > max_bytes:
        raise PreparationError(f"{label} expected size is outside 1..{max_bytes}")
    last_error = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            handler = HTTPSOnlyRedirectHandler()
            opener = urllib.request.build_opener(handler)
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "Cairn OCR bundle preparation/1", "Accept-Encoding": "identity"},
            )
            digest = hashlib.sha256()
            written = 0
            with opener.open(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", 200)
                if status != 200:
                    raise PreparationError(f"{label} returned HTTP {status}")
                content_length = response.headers.get("Content-Length")
                if content_length is not None and content_length.isdigit() and int(content_length) != expected_bytes:
                    raise PreparationError(f"{label} Content-Length {content_length} differs from the pinned {expected_bytes}")
                with output.open("xb") as dst:
                    while True:
                        chunk = response.read(min(CHUNK_BYTES, expected_bytes - written + 1))
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > expected_bytes or written > max_bytes:
                            raise PreparationError(f"{label} exceeded its pinned byte count")
                        digest.update(chunk)
                        dst.write(chunk)
                    dst.flush()
                    os.fsync(dst.fileno())
            actual_sha = digest.hexdigest()
            if written != expected_bytes:
                raise PreparationError(f"{label} downloaded {written} bytes, expected {expected_bytes}")
            if actual_sha != expected_sha:
                raise PreparationError(f"{label} SHA-256 {actual_sha} does not match pinned {expected_sha}")
            return {"source": url, "bytes": written, "sha256": actual_sha}
        except (OSError, urllib.error.URLError, TimeoutError, PreparationError) as exc:
            last_error = exc
            try:
                output.unlink(missing_ok=True)
            except OSError:
                pass
            if attempt < DOWNLOAD_ATTEMPTS:
                time.sleep(0.5 * attempt)
    raise PreparationError(f"could not fetch pinned {label} after {DOWNLOAD_ATTEMPTS} attempts: {last_error}")


def copy_verified(source: Path, dest: Path, expected_sha: str, expected_bytes: int, max_bytes: int, label: str) -> dict:
    if expected_bytes <= 0 or expected_bytes > max_bytes:
        raise PreparationError(f"{label} size is outside 1..{max_bytes}")
    digest = hashlib.sha256()
    written = 0
    try:
        with source.open("rb") as src, dest.open("xb") as out:
            while True:
                chunk = src.read(CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > expected_bytes or written > max_bytes:
                    raise PreparationError(f"{label} grew beyond its verified pin while copying")
                digest.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
    except OSError as exc:
        dest.unlink(missing_ok=True)
        raise PreparationError(f"cannot copy {label}: {exc}") from exc
    actual_sha = digest.hexdigest()
    if written != expected_bytes or actual_sha != expected_sha:
        dest.unlink(missing_ok=True)
        raise PreparationError(f"copied {label} failed its size or SHA-256 check")
    os.chmod(dest, 0o600)
    return {"source": str(source), "bytes": written, "sha256": actual_sha}


def asset_pin(path: str, data: bytes) -> dict:
    return {"path": path, "sha256": "sha256:" + sha256(data), "bytes": len(data)}


def write_bytes(path: Path, data: bytes) -> None:
    with path.open("xb") as dst:
        dst.write(data)
        dst.flush()
        os.fsync(dst.fileno())
    os.chmod(path, 0o600)


def processor_source_facts(repo_root: Path) -> tuple[dict[str, str], str]:
    names = (
        "server/internal/processor/ocr_pipeline.go",
        "server/internal/processor/ocr_onnx_engine.go",
        "server/internal/processor/ocr_engine.go",
        "server/internal/processor/ocr_text.go",
    )
    hashes = {}
    for name in names:
        path = repo_root / name
        if not path.is_file():
            raise PreparationError(f"expected Cairn OCR source is missing: {path}")
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    source_digest = sha256(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return hashes, source_digest


def make_dictionary(base: bytes) -> bytes:
    try:
        text = base.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise PreparationError(f"pinned PP-OCRv4 dictionary is not UTF-8: {exc}") from exc
    lines = text.splitlines()
    if len(base) != DICTIONARY_BASE_BYTES or len(lines) != DICTIONARY_BASE_CHARS:
        raise PreparationError(f"dictionary shape changed: expected {DICTIONARY_BASE_CHARS} codepoint lines")
    if any(len(line) != 1 or line == " " for line in lines):
        raise PreparationError("dictionary must contain exactly one non-space Unicode codepoint per source line")
    derived = base + (b"" if base.endswith(b"\n") else b"\n") + b" \n"
    if len(derived) != DICTIONARY_DERIVED_BYTES or sha256(derived) != DICTIONARY_DERIVED_SHA256:
        raise PreparationError("derived PP-OCRv4 dictionary does not match the pinned terminal-space profile")
    return derived


def make_license_asset(readme: bytes, apache: bytes, runtime_license: bytes, runtime_notice: bytes) -> bytes:
    text = (
        "Cairn OCR bundle third-party license and provenance record\n"
        "=======================================================\n\n"
        "OCR model: PP-OCRv4 DET/REC converted ONNX artifacts from the pinned "
        f"RapidAI/RapidOCR Space revision {MODEL_REVISION}.\n"
        "The pinned upstream Space README metadata is included below; it declares "
        "license: apache-2.0. RapidOCR's model attribution notice identifies "
        "PaddleOCR/Baidu as the upstream model rights holders.\n"
        f"Model files: {DETECTION['url']} and {RECOGNITION['url']}\n"
        f"Dictionary: {DICTIONARY_URL} (revision {DICTIONARY_BASE_REVISION}); "
        "the assembled dictionary adds one terminal U+0020 space line.\n"
        "The complete Apache-2.0 license text follows.\n\n"
        "----- BEGIN PINNED UPSTREAM SPACE README -----\n"
    ).encode("utf-8") + readme + (
        b"\n----- END PINNED UPSTREAM SPACE README -----\n"
        b"----- BEGIN APACHE LICENSE 2.0 -----\n"
    ) + apache + (
        b"\n----- END APACHE LICENSE 2.0 -----\n"
        b"----- BEGIN VERIFIED ONNX RUNTIME BUNDLE LICENSE EVIDENCE -----\n"
        b"The following LICENSE and NOTICE are copied byte-for-byte from the "
        b"verified --runtime-bundle and accompany its copied runtime.bin. They "
        b"may include notices for additional assets in that source bundle.\n\n"
        b"----- BEGIN SOURCE BUNDLE LICENSE -----\n"
    ) + runtime_license + (
        b"\n----- END SOURCE BUNDLE LICENSE -----\n"
        b"----- BEGIN SOURCE BUNDLE NOTICE -----\n"
    ) + runtime_notice + (
        b"\n----- END SOURCE BUNDLE NOTICE -----\n"
        b"----- END VERIFIED ONNX RUNTIME BUNDLE LICENSE EVIDENCE -----\n"
    )
    return text


def build_manifest(repo_root: Path, os_name: str, arch: str, runtime_manifest: dict, assets: dict[str, bytes], base_dictionary_sha: str, source_hashes: dict[str, str], source_set_sha: str) -> dict:
    dictionary_format = (
        "ppocr_keys_v1; UTF-8 one-Unicode-codepoint-per-line; "
        f"base=ModelScope:RapidAI/RapidOCR@{DICTIONARY_BASE_REVISION}:sha256:{base_dictionary_sha}; "
        "derived=append-terminal-U+0020-line; Cairn-ocrDictionary-prepends-CTC-blank-at-index-0; "
        f"derived_sha256:{sha256(assets['dictionary'])}"
    )
    preprocessing = {
        "profile": OCR_PROFILE,
        "processor_source_files": source_hashes,
        "parameters": {
            "det_limit_side": 960,
            "det_threshold": 0.3,
            "det_box_threshold": 0.6,
            "det_unclip_ratio": 1.5,
            "det_min_box_size": 3,
            "rec_image_height": 48,
            "rec_image_width": 320,
            "rec_min_confidence": 0.6,
        },
        "dictionary_format": dictionary_format,
    }
    preprocess_digest = "sha256:" + sha256(json.dumps(preprocessing, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    return {
        "schema": "cairn.ocr-bundle.v1",
        "profile_id": OCR_PROFILE,
        "platform_os": os_name,
        "platform_arch": arch,
        "engine_id": "cairn-in-process-onnx-ocr",
        "engine_version": "ocr.image.text.v1",
        "engine_build": "sha256:" + source_set_sha,
        "engine_source": f"Cairn in-process ONNX OCR; RapidAI/RapidOCR@{MODEL_REVISION}",
        "engine_license": "MIT",
        "model_id": "PP-OCRv4 Chinese mobile detector and recognizer",
        "model_revision": MODEL_REVISION,
        "model_license_id": f"RapidAI/RapidOCR@{MODEL_REVISION}:apache-2.0",
        "stages": ["DET", "REC"],
        "languages": ["zh", "en"],
        "language_notes": "PP-OCRv4 Chinese mobile detection/recognition with the pinned ppocr_keys_v1 character inventory; declared languages are coverage metadata, not an accuracy guarantee.",
        "dictionary_format": dictionary_format,
        "onnx_runtime_version": runtime_manifest["onnx_runtime_version"],
        "onnx_runtime_build": runtime_manifest["onnx_runtime_build"],
        "onnx_runtime_c_api": runtime_manifest["onnx_runtime_c_api"],
        "preprocessing_digest": preprocess_digest,
        "det_limit_side": 960,
        "det_threshold": 0.3,
        "det_box_threshold": 0.6,
        "det_unclip_ratio": 1.5,
        "det_min_box_size": 3,
        "rec_image_height": 48,
        "rec_image_width": 320,
        "rec_min_confidence": 0.6,
        "runtime": asset_pin("runtime.bin", assets["runtime"]),
        "det": asset_pin("det.onnx", assets["det"]),
        "rec": asset_pin("rec.onnx", assets["rec"]),
        "dictionary": asset_pin("dict.txt", assets["dictionary"]),
        "license": asset_pin("LICENSES.txt", assets["license"]),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models-root", required=True, help="absolute configured models root to receive the OCR profile")
    parser.add_argument("--runtime-bundle", required=True, help="absolute verified BGE semantic bundle directory; its pinned runtime is reused")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    models_root = Path(args.models_root).expanduser()
    runtime_root = Path(args.runtime_bundle).expanduser()
    if not models_root.is_absolute() or not runtime_root.is_absolute():
        raise PreparationError("--models-root and --runtime-bundle must both be absolute paths")
    models_root = models_root.resolve(strict=False)
    runtime_root = runtime_root.resolve(strict=True)
    if not runtime_root.is_dir():
        raise PreparationError("--runtime-bundle must name a directory")

    os_name, arch = go_platform()
    semantic_manifest_path = safe_bundle_file(runtime_root, "semantic-bundle.json", "semantic-bundle.json")
    semantic = decode_json(semantic_manifest_path)
    if semantic.get("schema") != "cairn.semantic-bundle.v1" or semantic.get("profile_id") != "bge-small-zh-v1.5":
        raise PreparationError("--runtime-bundle is not the existing BGE small zh semantic bundle")
    if semantic.get("platform_os") != os_name or semantic.get("platform_arch") != arch:
        raise PreparationError("BGE runtime bundle platform does not match this host")
    if semantic.get("onnx_runtime_version") != EXPECTED_RUNTIME_VERSION or semantic.get("onnx_runtime_c_api") != EXPECTED_RUNTIME_CAPI:
        raise PreparationError("BGE runtime must be ONNX Runtime 1.29.0 C API 29")
    if semantic.get("onnx_go_binding_c_api") != EXPECTED_RUNTIME_CAPI:
        raise PreparationError("BGE runtime bundle Go binding C API does not match ONNX Runtime C API 29")
    runtime_spec = semantic.get("runtime")
    runtime_path, runtime_bytes, runtime_sha = verify_local_asset(runtime_root, runtime_spec, "runtime", MAX_RUNTIME_BYTES)
    runtime_license_path, runtime_license, runtime_license_sha = verify_local_asset(runtime_root, semantic.get("license"), "license", MAX_LICENSE_BYTES)
    runtime_notice_path, runtime_notice, runtime_notice_sha = verify_local_asset(runtime_root, semantic.get("notice"), "notice", MAX_LICENSE_BYTES)

    repo_root = Path(__file__).resolve().parents[1]
    source_hashes, source_set_sha = processor_source_facts(repo_root)
    profile_parent = models_root / OCR_PROFILE
    target = profile_parent / f"{os_name}-{arch}"
    if target.exists() or target.is_symlink():
        raise PreparationError(f"refusing to overwrite existing OCR profile at {target}")
    profile_parent.mkdir(parents=True, exist_ok=True)
    lock = profile_parent / f".{os_name}-{arch}.prepare.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise PreparationError(f"another preparation may be active or a stale lock exists: {lock}") from exc
    os.close(fd)
    stage = Path(tempfile.mkdtemp(prefix=f".{os_name}-{arch}.stage-", dir=profile_parent))
    os.chmod(stage, 0o700)
    try:
        assets: dict[str, bytes] = {"runtime": runtime_bytes}
        records = {}
        records["runtime"] = copy_verified(runtime_path, stage / "runtime.bin", runtime_sha, len(runtime_bytes), MAX_RUNTIME_BYTES, "ONNX Runtime")

        for label, spec in (("det", DETECTION), ("rec", RECOGNITION)):
            output = stage / spec["name"]
            records[label] = download_pinned(spec["url"], spec["sha256"], spec["bytes"], MAX_MODEL_BYTES, output, label)
            assets[label] = output.read_bytes()

        dictionary_stage = stage / "dict-base.txt"
        records["dictionary_base"] = download_pinned(
            DICTIONARY_URL, DICTIONARY_BASE_SHA256, DICTIONARY_BASE_BYTES,
            MAX_DICTIONARY_BYTES, dictionary_stage, "PP-OCRv4 dictionary base",
        )
        base_dictionary = dictionary_stage.read_bytes()
        assets["dictionary"] = make_dictionary(base_dictionary)
        dictionary_out = stage / "dict.txt"
        write_bytes(dictionary_out, assets["dictionary"])
        dictionary_stage.unlink()
        records["dictionary"] = {
            "source": DICTIONARY_URL,
            "source_revision": DICTIONARY_BASE_REVISION,
            "base_bytes": len(base_dictionary),
            "base_sha256": sha256(base_dictionary),
            "derived_bytes": len(assets["dictionary"]),
            "derived_sha256": sha256(assets["dictionary"]),
            "source_codepoints": DICTIONARY_BASE_CHARS,
            "ctc_class_count_after_cairn_blank": DICTIONARY_BASE_CHARS + 2,
            "rule": "append terminal U+0020 line; existing Cairn loader prepends CTC blank at class index 0",
        }

        readme_path = f"README.md"
        readme_url = f"{MODEL_SOURCE_ROOT}/{readme_path}"
        readme_temp = stage / ".pinned-readme.md"
        records["upstream_license_metadata"] = download_pinned(
            readme_url, MODEL_LICENSE_README_SHA256, MODEL_LICENSE_README_BYTES,
            1 << 20, readme_temp, "pinned upstream license metadata",
        )
        readme = readme_temp.read_bytes()
        if b"license: apache-2.0" not in readme:
            raise PreparationError("pinned upstream README no longer declares Apache-2.0")
        readme_temp.unlink()

        apache_temp = stage / ".apache-license.txt"
        records["apache_license"] = download_pinned(
            APACHE_LICENSE_URL, APACHE_LICENSE_SHA256, APACHE_LICENSE_BYTES,
            1 << 20, apache_temp, "Apache-2.0 license text",
        )
        apache = apache_temp.read_bytes()
        apache_temp.unlink()

        assets["license"] = make_license_asset(readme, apache, runtime_license, runtime_notice)
        if len(assets["license"]) <= 0 or len(assets["license"]) > MAX_LICENSE_BYTES:
            raise PreparationError(f"combined license evidence exceeds {MAX_LICENSE_BYTES} bytes")
        write_bytes(stage / "LICENSES.txt", assets["license"])
        records["runtime_license"] = {"source": str(runtime_license_path), "bytes": len(runtime_license), "sha256": runtime_license_sha}
        records["runtime_notice"] = {"source": str(runtime_notice_path), "bytes": len(runtime_notice), "sha256": runtime_notice_sha}

        manifest = build_manifest(repo_root, os_name, arch, semantic, assets, records["dictionary_base"]["sha256"], source_hashes, source_set_sha)
        payload = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        write_bytes(stage / "manifest.json", payload)

        # Re-read every published asset and manifest pin before atomic exposure.
        final_checks = {}
        path_for_asset = {
            "runtime": "runtime.bin", "det": "det.onnx", "rec": "rec.onnx",
            "dictionary": "dict.txt", "license": "LICENSES.txt",
        }
        for key, rel in path_for_asset.items():
            data = (stage / rel).read_bytes()
            spec = manifest[key]
            if len(data) != spec["bytes"] or sha256(data) != spec["sha256"].removeprefix("sha256:"):
                raise PreparationError(f"staged asset {rel} failed manifest recheck")
            final_checks[rel] = {"bytes": len(data), "sha256": sha256(data)}
        manifest_reloaded = decode_json(stage / "manifest.json")
        if manifest_reloaded != manifest:
            raise PreparationError("staged manifest failed JSON round-trip check")

        if target.exists() or target.is_symlink():
            raise PreparationError(f"refusing to replace profile created during preparation: {target}")
        os.rename(stage, target)
        stage = None
        summary = {
            "status": "ASSEMBLED_AND_HASH_VERIFIED_NOT_RECOGNITION_TESTED",
            "models_root": str(models_root),
            "bundle_path": str(target),
            "profile_id": OCR_PROFILE,
            "platform": f"{os_name}-{arch}",
            "onnx_runtime": {
                "version": semantic["onnx_runtime_version"],
                "build": semantic["onnx_runtime_build"],
                "c_api": semantic["onnx_runtime_c_api"],
                "sha256": runtime_sha,
                "bytes": len(runtime_bytes),
                "reused_from": str(runtime_path),
            },
            "dictionary": records["dictionary"],
            "source_assets": records,
            "processor_source_hashes": source_hashes,
            "processor_source_set_sha256": source_set_sha,
            "manifest_sha256": sha256(payload),
            "assets": final_checks,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)
        try:
            lock.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PreparationError as exc:
        print(f"prepare-ocr-bundle: {exc}", file=sys.stderr)
        raise SystemExit(2)
