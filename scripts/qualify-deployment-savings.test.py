#!/usr/bin/env python3
"""Focused failure and accounting tests for qualify-deployment-savings.py."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import socket
import subprocess
import tarfile
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path

SCRIPT = Path(__file__).with_name("qualify-deployment-savings.py")
SPEC = importlib.util.spec_from_file_location("qualify_deployment_savings", SCRIPT)
assert SPEC and SPEC.loader
qualify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qualify)


def make_manifest(root: Path) -> dict:
    (root / "alpha.txt").write_bytes(b"same exact bytes")
    (root / "nested").mkdir()
    (root / "nested" / "beta.txt").write_bytes(b"another file")
    return qualify.canonical_corpus(root)


class DeploymentSavingsTests(unittest.TestCase):
    def test_manifest_matches_go_canonical_field_order_and_detects_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "corpus"
            root.mkdir()
            expected = make_manifest(root)
            payload = {"schema": expected["schema"], "entries": expected["entries"]}
            canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            self.assertEqual(expected["digest"], hashlib.sha256(canonical).hexdigest())
            manifest_file = Path(tmp) / "manifest.json"
            manifest_file.write_text(json.dumps(expected), encoding="utf-8")
            self.assertEqual(qualify.read_manifest(manifest_file, root), expected)
            (root / "alpha.txt").write_bytes(b"changed")
            with self.assertRaisesRegex(qualify.QualificationError, "drift"):
                qualify.verify_corpus(root, expected)

    def test_manifest_and_corpus_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "corpus"
            root.mkdir()
            (root / "payload").write_bytes(b"payload")
            outside = base / "outside"
            outside.write_bytes(b"outside")
            (root / "link").symlink_to(outside)
            with self.assertRaisesRegex(qualify.QualificationError, "symlink"):
                qualify.canonical_corpus(root)

    def test_configured_roots_reject_overlap_and_hardlinks_count_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            parent = base / "root"
            parent.mkdir()
            child = parent / "child"
            child.mkdir()
            with self.assertRaisesRegex(qualify.QualificationError, "overlap"):
                qualify.paths_overlap({"parent": parent, "child": child})

            first = base / "first"
            second = base / "second"
            first.mkdir()
            second.mkdir()
            file_one = first / "payload"
            file_one.write_bytes(b"hardlinked content")
            os.link(file_one, second / "payload")
            measured = qualify.measure_roots({"catalog": file_one, "repository": second, "vectors": base / "empty-vectors"})
            self.assertEqual(sum(measured.values()), file_one.stat().st_blocks * 512)

    def test_measurement_scope_and_savings_equations(self):
        baseline = {name: 10 for name in qualify.PATH_KEYS}
        baseline["models"] = 510  # semantic bundle is installed before ingest baseline
        settled = {name: 10 for name in qualify.PATH_KEYS}
        settled.update({"repository": 210, "catalog": 30, "vectors": 40, "models": 510, "recovery_records": 60})
        result = qualify.savings_accounting(1000, baseline, settled, 25, 75,
                                            {"cli": 100, "daemon": 200, "web": 300})
        self.assertEqual(result["incremental_ingest_net_savings_bytes"], 650)
        self.assertEqual(result["settled_growth_bytes"]["models"], 0)
        self.assertEqual(result["settled_temporary_growth_bytes"], 50)
        self.assertEqual(result["full_deployment_net_savings_bytes"], -525)
        no_web = qualify.savings_accounting(1000, baseline, settled, 25, 75,
                                            {"cli": 100, "daemon": 200, "web": None})
        self.assertIsNone(no_web["full_deployment_net_savings_bytes"])
        with self.assertRaisesRegex(qualify.QualificationError, "exactly the five"):
            qualify.allocated_scope_bytes({"baseline": {"catalog": 0}, "settled": {"catalog": 1}})

    def test_sampled_peak_includes_owned_temporary_root_and_is_not_absolute(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "tmp"
            root.mkdir()
            sampler = qualify.PeakSampler({"temporary": root}, 10)
            sampler.start()
            payload = root / "worker.tmp"
            payload.write_bytes(b"worker scratch" * 4096)
            time.sleep(0.05)
            evidence = sampler.stop()
            self.assertGreaterEqual(evidence["samples"], 1)
            self.assertGreater(evidence["per_root_peak_allocated_bytes"]["temporary"], 0)
            self.assertFalse(evidence["absolute_instantaneous"])
            self.assertEqual(evidence["kind"], "sampled_observed_peak")

    def test_sampler_counts_worker_tmp_unix_socket_and_persistent_runtime_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "owned-tmp"
            root.mkdir()
            retained_copy = root / "worker-runtime-copy"
            retained_copy.write_bytes(b"immutable worker copy" * 1024)
            endpoint = root / "control.sock"
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(str(endpoint))
            try:
                sampler = qualify.PeakSampler({"temporary": root}, 10)
                sampler.start()
                time.sleep(0.04)
                live = qualify.measure_roots({"temporary": root})
                evidence = sampler.stop()
                self.assertIsNotNone(live)
                self.assertGreater(live["temporary"], 0)
                self.assertGreaterEqual(evidence["unix_socket_peak_count"]["temporary"], 1)
                self.assertEqual(evidence["incomplete_samples_skipped"], 0)
                self.assertGreater(retained_copy.stat().st_blocks * 512, 0)
            finally:
                listener.close()

    def test_sampler_skips_incomplete_racy_scans_but_static_measurement_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "scratch"
            root.mkdir()
            (root / "transient").write_bytes(b"data")
            original_resolve = Path.resolve
            def raced_resolve(path, strict=False):
                if path.name == "transient" and strict:
                    raise FileNotFoundError("raced unlink")
                return original_resolve(path, strict=strict)
            with mock.patch.object(qualify.Path, "resolve", autospec=True, side_effect=raced_resolve):
                self.assertIsNone(qualify.measure_roots({"temporary": root}, allow_incomplete=True))
                with self.assertRaises(FileNotFoundError):
                    qualify.measure_roots({"temporary": root})
            original_measure = qualify.measure_roots
            calls = 0
            def one_race(roots, **kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return None
                return original_measure(roots, **kwargs)
            with mock.patch.object(qualify, "measure_roots", side_effect=one_race):
                sampler = qualify.PeakSampler({"temporary": root}, 10)
                sampler.start()
                time.sleep(0.04)
                evidence = sampler.stop()
            self.assertGreaterEqual(evidence["incomplete_samples_skipped"], 1)

    def test_readiness_failure_stops_owned_child_before_raising(self):
        original_popen = subprocess.Popen
        children = []
        def track(*args, **kwargs):
            child = original_popen(*args, **kwargs)
            children.append(child)
            return child
        with tempfile.TemporaryFile(mode="w+") as output:
            with mock.patch.object(qualify.subprocess, "Popen", side_effect=track):
                with self.assertRaisesRegex(qualify.QualificationError, "readiness timed out"):
                    qualify.start_owned_process([os.sys.executable, "-c", "import time; time.sleep(30)"],
                                                os.environ.copy(), output, lambda _proc: False,
                                                timeout=0.1, poll_interval=0.01)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())

    def test_runtime_root_returns_canonical_owned_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            created = Path(tmp) / "rwm-test"
            def make_root(*_args, **_kwargs):
                created.mkdir(mode=0o700)
                return str(created)
            with mock.patch.object(qualify.tempfile, "mkdtemp", side_effect=make_root):
                root = qualify.create_owned_runtime_root()
            self.assertEqual(root, created.resolve(strict=True))
            self.assertEqual(root.stat().st_uid, os.getuid())
            self.assertEqual(root.stat().st_gid, os.getgid())
            self.assertEqual(root.stat().st_mode & 0o777, 0o700)

    def test_typed_dispatcher_accepts_only_expected_operation_and_data(self):
        envelope = {"operation": "search.rebuild", "status": "SUCCEEDED", "data": {"semantic_state": "UNAVAILABLE"}}
        self.assertEqual(qualify.typed_data(envelope, "search.rebuild")["semantic_state"], "UNAVAILABLE")
        with self.assertRaisesRegex(qualify.QualificationError, "unexpected envelope"):
            qualify.validate_typed_envelope(envelope, "wrong")

    def test_candidate_archive_binds_supplied_binaries_and_extracts_web_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            rw, daemon = base / "rw", base / "restoreweaved"
            rw.write_bytes(b"cli candidate")
            daemon.write_bytes(b"daemon candidate")
            package = base / "candidate.tar.gz"
            with tarfile.open(package, "w:gz") as archive:
                for name, data in (("candidate/bin/rw", rw.read_bytes()),
                                   ("candidate/bin/restoreweaved", daemon.read_bytes()),
                                   ("candidate/web/dist/index.html", b"<html></html>")):
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    import io
                    archive.addfile(info, io.BytesIO(data))
            evidence = base / "evidence"
            evidence.mkdir()
            web, semantic = qualify.extract_web_and_semantic_inputs(package, evidence, None, rw, daemon)
            self.assertEqual((web / "index.html").read_bytes(), b"<html></html>")
            self.assertIsNone(semantic)
            (package).write_bytes(b"replaced package")
            with self.assertRaisesRegex(qualify.QualificationError, "cannot read|digest"):
                qualify.extract_web_and_semantic_inputs(package, base / "second", None, rw, daemon)

    def test_profile_patch_changes_only_the_generated_storage_tuple(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.toml"
            for quote in ("'", '"'):
                before = (f"[storage]\nrepository_profile = {quote}directory-cas-dev-v1{quote}\n"
                          f"default_protection = {quote}STORE_EXACT{quote}\n"
                          f"compression_profile = {quote}identity-v1{quote}\n"
                          f"neural_codec = {quote}disabled{quote}\n\n"
                          f"[semantic]\nlocal_profile = {quote}bge-small-zh-v1.5{quote}\n")
                config_path.write_text(before, encoding="utf-8")
                qualify.patch_storage_profile(config_path, "zstd")
                after = config_path.read_text(encoding="utf-8")
                expected = before.replace(f"directory-cas-dev-v1{quote}", f"local-zstd-v1{quote}")
                expected = expected.replace(f"identity-v1{quote}", f"zstd-v1{quote}")
                self.assertEqual(after, expected)
                with config_path.open("rb") as stream:
                    config = qualify.tomllib.load(stream)
                self.assertEqual((config["storage"]["repository_profile"], config["storage"]["compression_profile"]), qualify.PROFILES["zstd"])
                self.assertEqual(config["storage"]["default_protection"], "STORE_EXACT")
                self.assertEqual(config["storage"]["neural_codec"], "disabled")
                self.assertEqual(config["semantic"]["local_profile"], "bge-small-zh-v1.5")


if __name__ == "__main__":
    unittest.main(verbosity=2)
