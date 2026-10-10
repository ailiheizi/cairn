from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("package-redistribution-evidence.py")
SPEC = importlib.util.spec_from_file_location("redistribution_evidence", SCRIPT)
assert SPEC and SPEC.loader
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


def write_archive(path: Path, platform: tuple[str, str] = ("linux", "arm64"), reverse_descriptor: bool = False, reverse_asset_fields: bool = False) -> None:
    assets: dict[str, bytes] = {}
    scalar_values: dict[str, object] = {
        "schema": "restoreweave.semantic-bundle.v1", "profile_id": "bge-small-zh-v1.5",
        "platform_os": platform[0], "platform_arch": platform[1],
        "onnx_runtime_version": "1.29.0", "onnx_runtime_build": "test",
        "onnx_runtime_c_api": 29, "onnx_go_binding_commit": "test",
        "onnx_go_binding_digest": "0" * 64, "onnx_go_binding_c_api": 29,
        "model_id": "BAAI/bge-small-zh-v1.5", "model_revision": "test", "model_export": "test",
        "onnx_opset": 11, "model_license_id": "UNKNOWN", "tokenizer_version": "test",
        "tokenizer_revision": "test", "zvec_version": "0.6.0", "zvec_build": "test",
        "zvec_go_version": "0.6.0", "zvec_go_commit": "test", "license_expression": "UNKNOWN",
        "preprocessing_digest": "sha256:" + "0" * 64, "query_prefix": "", "document_prefix": "",
        "max_tokens": 1, "pooling": "test", "normalization": "test", "element_type": "test",
        "dimension": 1, "vector_schema": "test", "semantic_space": "test", "distance": "test",
        "index_config": "test", "query_config": "test",
    }
    descriptor: dict[str, object] = {key: scalar_values[key] for key in evidence.DESCRIPTOR_KEYS[:35]}
    for name, field in evidence.ASSETS:
        payload = ("asset:" + name).encode()
        filename = field + ".bin"
        asset = {"path": filename, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)}
        descriptor[field] = dict(reversed(list(asset.items()))) if reverse_asset_fields else asset
        assets[filename] = payload
    with tarfile.open(path, "w:gz") as archive:
        serialized_descriptor = dict(reversed(list(descriptor.items()))) if reverse_descriptor else descriptor
        for filename, payload in [("semantic-bundle.json", json.dumps(serialized_descriptor, separators=(",", ":")).encode()), *assets.items()]:
            info = tarfile.TarInfo(filename)
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))


class RedistributionEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "semantic.tar.gz"
        write_archive(self.archive)
        self.cli = self.root / "rw"
        self.cli.write_bytes(b"cli bytes")
        self.daemon = self.root / "daemon"
        self.daemon.write_bytes(b"daemon bytes")
        self.lock = self.root / "package-lock.json"
        self.lock.write_text('{"lockfileVersion":3}\n', encoding="utf-8")
        self.web = self.root / "web"
        (self.web / "assets").mkdir(parents=True)
        (self.web / "index.html").write_text("<main>candidate</main>", encoding="utf-8")
        (self.web / "assets/app.js").write_text("export{}", encoding="utf-8")
        self.sidecar = self.root / "evidence"
        (self.sidecar / "files/licenses").mkdir(parents=True)
        license_path = self.sidecar / "files/licenses/ORT-LICENSE.txt"
        license_path.write_text("Full retained license text\n", encoding="utf-8")
        self.license_row = {
            "path": "files/licenses/ORT-LICENSE.txt",
            "size": license_path.stat().st_size,
            "sha256": evidence.sha256_file(license_path),
            "component": "test component",
            "source": {"origin": "https://example.invalid/upstream/LICENSE", "ref": "v1.0.0"},
        }
        self.manifest_path = self.sidecar / "manifest.json"
        self.write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def bindings(self) -> dict[str, object]:
        result = evidence.inspect_semantic_archive(self.archive)
        rows, digest = evidence.web_inventory(self.web)
        result.update({
            "cli_sha256": "sha256:" + evidence.sha256_file(self.cli),
            "daemon_sha256": "sha256:" + evidence.sha256_file(self.daemon),
            "web_inventory_sha256": "sha256:" + digest,
            "web_lockfile_sha256": "sha256:" + evidence.sha256_file(self.lock),
            "web_build_linkage": "NOT_ATTESTED",
        })
        self.web_rows = rows
        return result

    def write_manifest(self, **overrides: object) -> None:
        manifest: dict[str, object] = {
            "schema": evidence.SCHEMA,
            "status": "PARTIAL_CANDIDATE_EVIDENCE",
            "sbom_status": "INCOMPLETE_NOT_RELEASE_SBOM",
            "validation_scope": "CANDIDATE_EVIDENCE_HASH_BINDING_ONLY",
            "binding": self.bindings(),
            "web_inventory": self.web_rows,
            "licenses": [self.license_row],
            "unknown_components": [{"component": "native dependencies", "state": "UNKNOWN", "reason": "not reviewed"}],
        }
        manifest.update(overrides)
        self.manifest_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")

    def args(self, output: Path):
        from argparse import Namespace
        return Namespace(
            evidence_dir=str(self.sidecar), semantic_archive=str(self.archive), platform_os="linux", platform_arch="arm64",
            cli=str(self.cli), daemon=str(self.daemon), web_dist=str(self.web), web_lockfile=str(self.lock), output_dir=str(output),
        )

    def test_binds_real_inputs_and_copies_exact_files_repeatably(self) -> None:
        one, two = self.root / "out-one", self.root / "out-two"
        evidence.validate_and_copy(self.args(one))
        evidence.validate_and_copy(self.args(two))
        self.assertEqual((one / "files/licenses/ORT-LICENSE.txt").read_bytes(),
                         (self.sidecar / "files/licenses/ORT-LICENSE.txt").read_bytes())
        self.assertEqual((one / "manifest.json").read_bytes(), self.manifest_path.read_bytes())
        for relative in ("manifest.json", "files/licenses/ORT-LICENSE.txt"):
            self.assertEqual((one / relative).read_bytes(), (two / relative).read_bytes())
        self.assertEqual(evidence.inspect_semantic_archive(self.archive)["semantic_profile_digest"],
                         self.bindings()["semantic_profile_digest"])

    def test_rejects_noncanonical_descriptor_order(self) -> None:
        noncanonical = self.root / "noncanonical.tar.gz"
        write_archive(noncanonical, reverse_descriptor=True)
        with self.assertRaisesRegex(evidence.EvidenceError, "canonical frozen v1"):
            evidence.inspect_semantic_archive(noncanonical)
        noncanonical_asset = self.root / "noncanonical-asset.tar.gz"
        write_archive(noncanonical_asset, reverse_asset_fields=True)
        with self.assertRaisesRegex(evidence.EvidenceError, "lacks asset runtime"):
            evidence.inspect_semantic_archive(noncanonical_asset)

    def test_rejects_wrong_archive_or_candidate_binding(self) -> None:
        manifest = json.loads(self.manifest_path.read_text())
        manifest["binding"]["semantic_archive_sha256"] = "sha256:" + "0" * 64
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "actual package inputs"):
            evidence.validate_and_copy(self.args(self.root / "out"))

    def test_rejects_duplicate_license_records(self) -> None:
        manifest = json.loads(self.manifest_path.read_text())
        manifest["licenses"].append(dict(manifest["licenses"][0]))
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "duplicate/reserved evidence path"):
            evidence.validate_and_copy(self.args(self.root / "out-duplicate"))

    def test_rechecks_bytes_during_copy_and_rejects_empty_license_text(self) -> None:
        source = self.sidecar / "files/licenses/ORT-LICENSE.txt"
        original = source.read_bytes()
        original_open = Path.open
        source_reads = 0

        def mutate_before_copy(path, mode="r", *args, **kwargs):
            nonlocal source_reads
            if path == source and mode == "rb":
                source_reads += 1
                if source_reads == 3:
                    with original_open(source, "wb") as changed:
                        changed.write(b"changed after validation")
            return original_open(path, mode, *args, **kwargs)

        with mock.patch.object(Path, "open", new=mutate_before_copy):
            with self.assertRaisesRegex(evidence.EvidenceError, "size or digest mismatch|changed while copying"):
                evidence.validate_and_copy(self.args(self.root / "out-race"))
        source.write_bytes(original)
        source.write_bytes(b"")
        self.license_row["size"] = 0
        self.license_row["sha256"] = evidence.sha256_file(source)
        self.write_manifest()
        with self.assertRaisesRegex(evidence.EvidenceError, "positive size"):
            evidence.validate_and_copy(self.args(self.root / "out-empty"))

    def test_rejects_wrong_web_tree_and_platform(self) -> None:
        (self.web / "index.html").write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "binding does not match"):
            evidence.validate_and_copy(self.args(self.root / "out-web"))
        (self.web / "index.html").write_text("<main>candidate</main>", encoding="utf-8")
        wrong_platform = self.args(self.root / "out-platform")
        wrong_platform.platform_arch = "amd64"
        with self.assertRaisesRegex(evidence.EvidenceError, "platform does not match"):
            evidence.validate_and_copy(wrong_platform)

    def test_rejects_missing_tampered_and_unlisted_evidence(self) -> None:
        (self.sidecar / "files/licenses/ORT-LICENSE.txt").write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "size or digest mismatch"):
            evidence.validate_and_copy(self.args(self.root / "out-tampered"))
        (self.sidecar / "files/licenses/ORT-LICENSE.txt").write_text("Full retained license text\n", encoding="utf-8")
        (self.sidecar / "files/extra.txt").write_text("unlisted", encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "file set mismatch"):
            evidence.validate_and_copy(self.args(self.root / "out-extra"))
        (self.sidecar / "files/extra.txt").unlink()
        (self.sidecar / "files/licenses/ORT-LICENSE.txt").unlink()
        with self.assertRaisesRegex(evidence.EvidenceError, "file set mismatch"):
            evidence.validate_and_copy(self.args(self.root / "out-missing"))

    def test_rejects_unsafe_paths_symlinks_special_files_and_complete_claims(self) -> None:
        manifest = json.loads(self.manifest_path.read_text())
        manifest["licenses"][0]["path"] = "files/../outside"
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(evidence.EvidenceError, "unsafe relative path"):
            evidence.validate_and_copy(self.args(self.root / "out-traversal"))
        self.write_manifest()
        link = self.sidecar / "files/link"
        link.symlink_to("licenses/ORT-LICENSE.txt")
        with self.assertRaisesRegex(evidence.EvidenceError, "symlinks are not allowed"):
            evidence.validate_and_copy(self.args(self.root / "out-link"))
        link.unlink()
        fifo = self.sidecar / "files/fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(evidence.EvidenceError, "non-regular filesystem entry"):
            evidence.validate_and_copy(self.args(self.root / "out-fifo"))
        fifo.unlink()
        self.write_manifest(status="RELEASE_QUALIFIED", sbom_status="COMPLETE")
        with self.assertRaisesRegex(evidence.EvidenceError, "remain partial"):
            evidence.validate_and_copy(self.args(self.root / "out-status"))


if __name__ == "__main__":
    unittest.main()
