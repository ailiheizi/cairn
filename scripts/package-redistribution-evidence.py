#!/usr/bin/env python3
"""Validate and copy partial, artifact-bound redistribution evidence.

This is a build-time candidate packaging helper. Its output never qualifies a
package or makes a legal determination.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
from typing import Any


SCHEMA = "restoreweave.redistribution-evidence.v1"
DESCRIPTOR_KEYS = (
    "schema", "profile_id", "platform_os", "platform_arch", "onnx_runtime_version",
    "onnx_runtime_build", "onnx_runtime_c_api", "onnx_go_binding_commit",
    "onnx_go_binding_digest", "onnx_go_binding_c_api", "model_id", "model_revision",
    "model_export", "onnx_opset", "model_license_id", "tokenizer_version",
    "tokenizer_revision", "zvec_version", "zvec_build", "zvec_go_version",
    "zvec_go_commit", "license_expression", "preprocessing_digest", "query_prefix",
    "document_prefix", "max_tokens", "pooling", "normalization", "element_type",
    "dimension", "vector_schema", "semantic_space", "distance", "index_config",
    "query_config", "runtime", "onnx_binding", "onnx_c_api", "model", "tokenizer",
    "profile", "zvec", "zvec_go", "license", "notice", "sbom",
)
STRING_DESCRIPTOR_KEYS = set(DESCRIPTOR_KEYS) - {
    "onnx_runtime_c_api", "onnx_go_binding_c_api", "onnx_opset", "max_tokens", "dimension",
    "runtime", "onnx_binding", "onnx_c_api", "model", "tokenizer", "profile", "zvec",
    "zvec_go", "license", "notice", "sbom",
}
INTEGER_DESCRIPTOR_KEYS = {
    "onnx_runtime_c_api", "onnx_go_binding_c_api", "onnx_opset", "max_tokens", "dimension",
}
ASSETS = (
    ("runtime", "runtime"),
    ("onnx_binding", "onnx_binding"),
    ("onnx_c_api", "onnx_c_api"),
    ("model", "model"),
    ("tokenizer", "tokenizer"),
    ("profile", "profile"),
    ("zvec", "zvec"),
    ("zvec_go", "zvec_go"),
    ("license", "license"),
    ("notice", "notice"),
    ("sbom", "sbom"),
)


class EvidenceError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    # Go's encoding/json sorts map keys, preserves struct field order, emits
    # UTF-8, and escapes HTML-sensitive characters plus U+2028/U+2029.
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    encoded = (encoded.replace("<", "\\u003c").replace(">", "\\u003e")
               .replace("&", "\\u0026").replace("\u2028", "\\u2028")
               .replace("\u2029", "\\u2029"))
    return encoded.encode("utf-8")


def safe_relative(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\n" in value or "\r" in value:
        raise EvidenceError(f"unsafe relative path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or path.as_posix() != value:
        raise EvidenceError(f"unsafe relative path: {value!r}")
    return path


def inspect_semantic_archive(path: Path) -> dict[str, Any]:
    # This recomputes the frozen v1 digest only to bind candidate sidecars to
    # these archive bytes. It does not perform SemanticBundleAdmission; the
    # existing semantic installer remains the admission authority.
    if path.is_symlink() or not path.is_file():
        raise EvidenceError("semantic archive must be a regular non-symlink file")
    archive_digest = sha256_file(path)
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = archive.getmembers()
            by_name: dict[str, tarfile.TarInfo] = {}
            for member in members:
                relative = safe_relative(member.name)
                if not member.isfile() or member.issym() or member.islnk() or member.isdev():
                    raise EvidenceError(f"semantic archive contains a non-regular member: {member.name}")
                if relative.as_posix() in by_name:
                    raise EvidenceError(f"semantic archive has duplicate member: {member.name}")
                by_name[relative.as_posix()] = member
            descriptor_member = by_name.get("semantic-bundle.json")
            if descriptor_member is None or descriptor_member.size > 1024 * 1024:
                raise EvidenceError("semantic archive lacks a bounded semantic-bundle.json")
            raw = archive.extractfile(descriptor_member)
            if raw is None:
                raise EvidenceError("cannot read semantic descriptor")
            descriptor_bytes = raw.read(1024 * 1024 + 1)
            descriptor = json.loads(descriptor_bytes)
            if not isinstance(descriptor, dict):
                raise EvidenceError("semantic descriptor must be an object")
            if tuple(descriptor) != DESCRIPTOR_KEYS or canonical_json(descriptor) != descriptor_bytes:
                raise EvidenceError("semantic descriptor is not canonical frozen v1 serialization")
            if any(not isinstance(descriptor.get(key), str) for key in STRING_DESCRIPTOR_KEYS):
                raise EvidenceError("semantic descriptor string field has a non-string value")
            if any(type(descriptor.get(key)) is not int for key in INTEGER_DESCRIPTOR_KEYS):
                raise EvidenceError("semantic descriptor integer field has a non-integer value")

            asset_digests: dict[str, str] = {}
            expected_members = {"semantic-bundle.json"}
            for name, field in ASSETS:
                asset = descriptor.get(field)
                if not isinstance(asset, dict) or tuple(asset) != ("path", "sha256", "size"):
                    raise EvidenceError(f"semantic descriptor lacks asset {field}")
                if (not isinstance(asset.get("path"), str) or not isinstance(asset.get("sha256"), str)
                        or type(asset.get("size")) is not int):
                    raise EvidenceError(f"semantic descriptor asset has invalid v1 fields: {field}")
                relative = safe_relative(asset.get("path"))
                member_name = relative.as_posix()
                if member_name == "semantic-bundle.json" or member_name in expected_members:
                    raise EvidenceError(f"semantic asset path collision: {member_name}")
                expected_members.add(member_name)
                member = by_name.get(member_name)
                if member is None or member.size != asset.get("size"):
                    raise EvidenceError(f"semantic archive asset is missing or has wrong size: {member_name}")
                source = archive.extractfile(member)
                if source is None:
                    raise EvidenceError(f"cannot read semantic asset: {member_name}")
                digest = hashlib.sha256()
                length = 0
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    length += len(block)
                    digest.update(block)
                got = digest.hexdigest()
                if length != asset["size"] or got != asset.get("sha256"):
                    raise EvidenceError(f"semantic asset digest mismatch: {member_name}")
                asset_digests[name] = got
            if set(by_name) != expected_members:
                extras = sorted(set(by_name) - expected_members)
                raise EvidenceError(f"semantic archive has unlisted members: {extras}")
            profile_payload = canonical_json({"descriptor": descriptor, "assets": dict(sorted(asset_digests.items()))})
            profile_digest = "sha256:" + hashlib.sha256(b"restoreweave.semantic-bundle.v1\n" + profile_payload).hexdigest()
            platform_os = descriptor.get("platform_os")
            platform_arch = descriptor.get("platform_arch")
            if not isinstance(platform_os, str) or not isinstance(platform_arch, str):
                raise EvidenceError("semantic descriptor platform is missing")
            return {
                "semantic_archive_sha256": "sha256:" + archive_digest,
                "semantic_profile_digest": profile_digest,
                "platform": {"os": platform_os, "arch": platform_arch},
            }
    except (tarfile.TarError, OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        if isinstance(exc, EvidenceError):
            raise
        raise EvidenceError(f"cannot inspect semantic archive: {exc}") from exc


def walk_regular_tree(root: Path) -> tuple[list[dict[str, Any]], list[Path]]:
    if root.is_symlink() or not root.is_dir():
        raise EvidenceError(f"expected regular directory: {root}")
    entries: list[dict[str, Any]] = []
    paths: list[Path] = []

    def visit(directory: Path) -> None:
        try:
            children = sorted(os.scandir(directory), key=lambda item: item.name)
        except OSError as exc:
            raise EvidenceError(f"cannot scan {directory}: {exc}") from exc
        for child in children:
            path = Path(child.path)
            mode = child.stat(follow_symlinks=False).st_mode
            if stat.S_ISLNK(mode):
                raise EvidenceError(f"symlinks are not allowed: {path}")
            if stat.S_ISDIR(mode):
                visit(path)
            elif stat.S_ISREG(mode):
                relative = path.relative_to(root).as_posix()
                safe_relative(relative)
                entries.append({"path": relative, "size": child.stat(follow_symlinks=False).st_size,
                                "sha256": sha256_file(path)})
                paths.append(path)
            else:
                raise EvidenceError(f"non-regular filesystem entry: {path}")

    visit(root)
    return entries, paths


def web_inventory(root: Path) -> tuple[list[dict[str, Any]], str]:
    rows, _ = walk_regular_tree(root)
    payload = canonical_json(rows)
    return rows, hashlib.sha256(payload).hexdigest()


def validate_evidence_directory(root: Path, manifest: dict[str, Any]) -> list[tuple[PurePosixPath, Path, dict[str, Any]]]:
    if root.is_symlink() or not root.is_dir():
        raise EvidenceError("evidence directory must be a real directory")
    records = manifest.get("licenses")
    if not isinstance(records, list) or not records:
        raise EvidenceError("at least one retained full-text license record is required")
    declared: dict[str, tuple[PurePosixPath, dict[str, Any]]] = {}
    for record in records:
        if not isinstance(record, dict):
            raise EvidenceError("license records must be objects")
        relative = safe_relative(record.get("path"))
        key = relative.as_posix()
        if key in declared or key == "manifest.json":
            raise EvidenceError(f"duplicate/reserved evidence path: {key}")
        if not isinstance(record.get("component"), str) or not record["component"].strip():
            raise EvidenceError(f"license record lacks component: {key}")
        source = record.get("source")
        if not isinstance(source, dict) or not all(isinstance(source.get(k), str) and source[k].strip()
                                                   for k in ("origin", "ref")):
            raise EvidenceError(f"license record lacks retained source origin/ref: {key}")
        expected = record.get("sha256")
        size = record.get("size")
        if not isinstance(expected, str) or len(expected) != 64 or any(ch not in "0123456789abcdef" for ch in expected):
            raise EvidenceError(f"invalid license file SHA-256: {key}")
        if not isinstance(size, int) or size <= 0:
            raise EvidenceError(f"license evidence must have a positive size: {key}")
        declared[key] = (relative, record)

    _, actual_files = walk_regular_tree(root)
    actual: dict[str, Path] = {}
    for path in actual_files:
        key = path.relative_to(root).as_posix()
        if key == "manifest.json":
            continue
        actual[key] = path
    if set(actual) != set(declared):
        missing = sorted(set(declared) - set(actual))
        extra = sorted(set(actual) - set(declared))
        raise EvidenceError(f"evidence file set mismatch; missing={missing}, unlisted={extra}")
    verified: list[tuple[PurePosixPath, Path, dict[str, Any]]] = []
    for key in sorted(declared):
        relative, record = declared[key]
        path = actual[key]
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != record["size"] or sha256_file(path) != record["sha256"]:
            raise EvidenceError(f"license evidence size or digest mismatch: {key}")
        verified.append((relative, path, record))
    unknowns = manifest.get("unknown_components")
    if not isinstance(unknowns, list) or not unknowns:
        raise EvidenceError("partial evidence must list unresolved components")
    for item in unknowns:
        if (not isinstance(item, dict) or item.get("state") != "UNKNOWN"
                or not isinstance(item.get("component"), str) or not item["component"].strip()
                or not isinstance(item.get("reason"), str) or not item["reason"].strip()):
            raise EvidenceError("unresolved component rows must be explicit UNKNOWN records")
    return verified


def validate_and_copy(args: argparse.Namespace) -> None:
    archive = Path(args.semantic_archive)
    binding = inspect_semantic_archive(archive)
    if binding["platform"] != {"os": args.platform_os, "arch": args.platform_arch}:
        raise EvidenceError("semantic archive platform does not match package target")
    for name, path in (("cli", Path(args.cli)), ("daemon", Path(args.daemon)), ("web_lockfile", Path(args.web_lockfile))):
        if path.is_symlink() or not path.is_file():
            raise EvidenceError(f"{name} input must be a regular non-symlink file")
    web_rows, web_digest = web_inventory(Path(args.web_dist))
    binding.update({
        "cli_sha256": "sha256:" + sha256_file(Path(args.cli)),
        "daemon_sha256": "sha256:" + sha256_file(Path(args.daemon)),
        "web_inventory_sha256": "sha256:" + web_digest,
        "web_lockfile_sha256": "sha256:" + sha256_file(Path(args.web_lockfile)),
        "web_build_linkage": "NOT_ATTESTED",
    })
    evidence_root = Path(args.evidence_dir)
    if evidence_root.is_symlink() or not evidence_root.is_dir():
        raise EvidenceError("evidence directory must be a real directory")
    manifest_path = evidence_root / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise EvidenceError("evidence manifest must be a regular non-symlink file")
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"cannot read evidence manifest: {exc}") from exc
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise EvidenceError("unsupported redistribution evidence schema")
    if (manifest.get("status") != "PARTIAL_CANDIDATE_EVIDENCE"
            or manifest.get("sbom_status") != "INCOMPLETE_NOT_RELEASE_SBOM"
            or manifest.get("validation_scope") != "CANDIDATE_EVIDENCE_HASH_BINDING_ONLY"):
        raise EvidenceError("sidecar must remain partial candidate hash-binding evidence with an incomplete SBOM")
    if manifest.get("binding") != binding:
        raise EvidenceError("sidecar binding does not match the actual package inputs")
    if manifest.get("web_inventory") != web_rows:
        raise EvidenceError("sidecar Web inventory does not match the supplied Web build tree")
    verified = validate_evidence_directory(evidence_root, manifest)
    destination = Path(args.output_dir)
    if destination.exists() or destination.is_symlink():
        raise EvidenceError("evidence output directory already exists")
    destination.mkdir(parents=True, mode=0o700)
    try:
        (destination / "files").mkdir(mode=0o700)
        for relative, source, record in verified:
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            length = 0
            with source.open("rb") as src, target.open("xb") as dst:
                for block in iter(lambda: src.read(1024 * 1024), b""):
                    length += len(block)
                    digest.update(block)
                    dst.write(block)
            if length != record["size"] or digest.hexdigest() != record["sha256"]:
                raise EvidenceError(f"license evidence changed while copying: {relative.as_posix()}")
        (destination / "manifest.json").write_bytes(manifest_bytes)
        if (destination / "manifest.json").read_bytes() != manifest_bytes:
            raise EvidenceError("evidence manifest changed while copying")
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    print("partial redistribution evidence verified and copied")
    print(f"semantic_profile_digest: {binding['semantic_profile_digest']}")
    print(f"web_inventory_files: {len(web_rows)}")
    print(f"retained_license_texts: {len(verified)}")
    print(f"unknown_components: {len(manifest['unknown_components'])}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", required=True)
    parser.add_argument("--semantic-archive", required=True)
    parser.add_argument("--platform-os", required=True)
    parser.add_argument("--platform-arch", required=True)
    parser.add_argument("--cli", required=True)
    parser.add_argument("--daemon", required=True)
    parser.add_argument("--web-dist", required=True)
    parser.add_argument("--web-lockfile", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        validate_and_copy(args)
    except (EvidenceError, OSError, tarfile.TarError, UnicodeError) as exc:
        print(f"redistribution evidence rejected: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
