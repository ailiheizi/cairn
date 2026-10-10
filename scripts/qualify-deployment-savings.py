#!/usr/bin/env python3
"""Measure one configured Cairn ingest per raw/zstd candidate.

This is a disposable qualification harness, not a product command or phase
qualification. It preserves every directory it creates and never modifies the
corpus or candidate binaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import tarfile
import urllib.request
import threading
import time
import tomllib
import uuid
from pathlib import Path
from typing import Any

MANIFEST_SCHEMA = "cairn.corpus-manifest.v1"
PROFILES = {
    "raw": ("directory-cas-dev-v1", "identity-v1"),
    "zstd": ("local-zstd-v1", "zstd-v1"),
}
PATH_KEYS = ("catalog", "repository", "vectors", "models", "recovery_records")


class QualificationError(RuntimeError):
    pass


def _fail(message: str) -> None:
    raise QualificationError(message)


def _safe_absolute(path: Path, label: str) -> Path:
    if path.is_symlink():
        _fail(f"{label} must not be a symlink: {path}")
    return path.resolve(strict=False)


def paths_overlap(paths: dict[str, Path]) -> None:
    resolved = [(name, _safe_absolute(path, name)) for name, path in paths.items()]
    for i, (left_name, left) in enumerate(resolved):
        for right_name, right in resolved[i + 1 :]:
            if left == right or left in right.parents or right in left.parents:
                _fail(f"configured paths overlap: {left_name} and {right_name}")


def canonical_corpus(root: Path) -> dict[str, Any]:
    root = _safe_absolute(root, "corpus")
    if not root.is_dir():
        _fail(f"corpus must be an existing directory: {root}")
    entries: list[dict[str, Any]] = []
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        dirs.sort()
        files.sort()
        for name in list(dirs):
            item = current_path / name
            if item.is_symlink():
                _fail(f"corpus contains symlink: {item}")
            if not item.is_dir():
                _fail(f"corpus contains non-directory: {item}")
        for name in files:
            item = current_path / name
            if item.is_symlink() or not item.is_file():
                _fail(f"corpus contains symlink or non-regular file: {item}")
            relative = item.relative_to(root).as_posix()
            if not relative or "\\" in relative or any(part in ("", ".", "..") for part in relative.split("/")):
                _fail(f"corpus has unsafe relative path: {relative!r}")
            digest = hashlib.sha256()
            size = 0
            with item.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
                    size += len(block)
            entries.append({"path": relative, "bytes": size, "sha256": digest.hexdigest()})
    entries.sort(key=lambda entry: entry["path"])
    if not entries:
        _fail("corpus must contain at least one regular file")
    payload = {"schema": MANIFEST_SCHEMA, "entries": entries}
    digest = hashlib.sha256(_canonical_json(payload)).hexdigest()
    return {**payload, "digest": digest}


def _canonical_json(value: Any) -> bytes:
    # Match encoding/json's compact field-order-preserving representation for
    # the corpus schema, including its HTML and U+2028/U+2029 escaping.
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    raw = raw.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    raw = raw.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return raw.encode("utf-8")


def verify_corpus(root: Path, expected: dict[str, Any]) -> dict[str, Any]:
    observed = canonical_corpus(root)
    if observed != expected:
        _fail(f"corpus drift from manifest {expected.get('digest', '<missing>')}")
    return observed


def read_manifest(path: Path, corpus: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        _fail(f"cannot read corpus manifest: {exc}")
    if not isinstance(document, dict) or set(document) != {"schema", "entries", "digest"}:
        _fail("corpus manifest has unknown or missing fields")
    if document.get("schema") != MANIFEST_SCHEMA or not isinstance(document.get("entries"), list):
        _fail("unsupported corpus manifest shape")
    if not document["entries"]:
        _fail("corpus manifest contains no entries")
    previous = ""
    for entry in document["entries"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "bytes", "sha256"}:
            _fail("corpus manifest entry has unknown or missing fields")
        name = entry["path"]
        if not isinstance(name, str) or not name or "\\" in name or Path(name).is_absolute() or any(p in ("", ".", "..") for p in name.split("/")):
            _fail(f"corpus manifest has unsafe path: {name!r}")
        if name <= previous:
            _fail("corpus manifest entries are duplicated or not canonically sorted")
        previous = name
        if not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 0:
            _fail(f"invalid logical length for {name}")
        if not isinstance(entry["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
            _fail(f"invalid SHA-256 for {name}")
    payload = {"schema": document["schema"], "entries": document["entries"]}
    expected_digest = hashlib.sha256(_canonical_json(payload)).hexdigest()
    if document["digest"] != expected_digest:
        _fail("corpus manifest canonical digest mismatch")
    verify_corpus(corpus, document)
    return document


def measure_allocated(path: Path, *, include_sqlite_sidecars: bool = False,
                      seen_objects: set[tuple[int, int]] | None = None,
                      socket_stats: dict[str, int] | None = None,
                      allow_incomplete: bool = False) -> int | None:
    """Count allocated blocks; socket inode blocks count, socket contents do not."""
    candidates = [path]
    if include_sqlite_sidecars:
        candidates.extend((Path(str(path) + "-wal"), Path(str(path) + "-shm")))
    total = 0
    seen: set[Path] = set()
    seen_objects = seen_objects if seen_objects is not None else set()
    for candidate in candidates:
        if candidate.is_symlink():
            _fail(f"measured path contains symlink: {candidate}")
        try:
            candidate.lstat()
        except FileNotFoundError:
            continue
        stack = [candidate]
        while stack:
            item = stack.pop()
            try:
                info = item.lstat()
            except FileNotFoundError:
                if allow_incomplete:
                    return None
                raise
            if stat.S_ISLNK(info.st_mode):
                _fail(f"measured path contains symlink: {item}")
            try:
                resolved = item.resolve(strict=True)
            except FileNotFoundError:
                if allow_incomplete:
                    return None
                raise
            if resolved in seen:
                continue
            seen.add(resolved)
            if stat.S_ISDIR(info.st_mode):
                try:
                    with os.scandir(item) as children:
                        stack.extend(Path(child.path) for child in children)
                except FileNotFoundError:
                    if allow_incomplete:
                        return None
                    raise
            elif stat.S_ISREG(info.st_mode):
                blocks = getattr(info, "st_blocks", None)
                if blocks is None:
                    _fail("filesystem does not expose allocated file blocks (st_blocks)")
                identity = (int(info.st_dev), int(info.st_ino))
                if identity not in seen_objects:
                    seen_objects.add(identity)
                    total += int(blocks) * 512
            elif stat.S_ISSOCK(info.st_mode):
                if socket_stats is not None:
                    socket_stats["count"] = socket_stats.get("count", 0) + 1
                blocks = getattr(info, "st_blocks", None)
                if blocks is None:
                    _fail("filesystem does not expose allocated socket inode blocks (st_blocks)")
                identity = (int(info.st_dev), int(info.st_ino))
                if identity not in seen_objects:
                    seen_objects.add(identity)
                    allocated = int(blocks) * 512
                    total += allocated
                    if socket_stats is not None:
                        socket_stats["allocated_bytes"] = socket_stats.get("allocated_bytes", 0) + allocated
            else:
                _fail(f"measured path contains non-regular entry: {item}")
    return total


def measure_roots(roots: dict[str, Path], *, allow_incomplete: bool = False,
                  socket_stats: dict[str, dict[str, int]] | None = None) -> dict[str, int] | None:
    paths_overlap(roots)
    seen_objects: set[tuple[int, int]] = set()
    measured: dict[str, int] = {}
    for name, path in roots.items():
        detail = {"count": 0, "allocated_bytes": 0}
        value = measure_allocated(path, include_sqlite_sidecars=(name == "catalog"), seen_objects=seen_objects,
                                  socket_stats=detail, allow_incomplete=allow_incomplete)
        if value is None:
            return None
        measured[name] = value
        if socket_stats is not None:
            socket_stats[name] = detail
    return measured


def patch_storage_profile(config_path: Path, profile: str) -> None:
    try:
        config_text = config_path.read_text(encoding="utf-8")
    except OSError as exc:
        _fail(f"read generated config: {exc}")
    repository_profile, compression_profile = PROFILES[profile]
    section_pattern = re.compile(r"(?ms)^\[storage\]\n(?P<body>.*?)(?=^\[|\Z)")
    match = section_pattern.search(config_text)
    if not match:
        _fail("generated config has no storage section")
    body = match.group("body")
    assignment = r"(?m)^(?P<key>{key})[ \t]*=[ \t]*(?P<quote>['\"])(?P<value>[^'\"\r\n]*)\2[ \t]*$"
    def replace_value(text: str, key: str, value: str) -> tuple[str, int]:
        pattern = re.compile(assignment.format(key=re.escape(key)))
        return pattern.subn(lambda found: f"{key} = {found.group('quote')}{value}{found.group('quote')}", text)
    body, repo_count = replace_value(body, "repository_profile", repository_profile)
    body, compression_count = replace_value(body, "compression_profile", compression_profile)
    if repo_count != 1 or compression_count != 1:
        _fail("generated storage tuple is incomplete or ambiguous")
    updated = config_text[: match.start("body")] + body + config_text[match.end("body") :]
    config_path.write_text(updated, encoding="utf-8")
    with config_path.open("rb") as stream:
        data = tomllib.load(stream)
    storage = data.get("storage", {})
    if (storage.get("repository_profile"), storage.get("compression_profile")) != PROFILES[profile]:
        _fail("persisted storage tuple does not match requested profile")


def decode_cli_json(result: subprocess.CompletedProcess[str], operation: str, allow_degraded: bool = False) -> dict[str, Any]:
    if result.returncode != 0 and not allow_degraded:
        _fail(f"{operation} exited {result.returncode}: {result.stderr.strip() or result.stdout.strip()}")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        _fail(f"{operation} returned invalid JSON: {exc}")
    if not isinstance(value, dict):
        _fail(f"{operation} returned a non-object JSON value")
    if result.returncode != 0 and value.get("status") != "DEGRADED":
        _fail(f"{operation} exited {result.returncode} with status {value.get('status')!r}")
    return value


def result_data(result: dict[str, Any], operation: str) -> dict[str, Any]:
    if result.get("status") != "SUCCEEDED":
        _fail(f"{operation} status is {result.get('status')!r}, expected SUCCEEDED")
    data = result.get("data")
    if not isinstance(data, dict):
        _fail(f"{operation} has no object data")
    return data


def allocated_scope_bytes(measurements: dict[str, dict[str, int]], required_names: tuple[str, ...] = PATH_KEYS) -> dict[str, int]:
    required = set(required_names)
    if set(measurements) != {"baseline", "settled"} or any(set(measurements[phase]) != required for phase in measurements):
        _fail("measurement scope does not contain exactly the five configured paths")
    return {name: measurements["settled"][name] - measurements["baseline"][name] for name in required_names}


def savings_accounting(logical_bytes: int, pre_ingest: dict[str, int], settled: dict[str, int],
                       pre_ingest_temporary: int, settled_temporary: int,
                       fixed_runtime: dict[str, int | None]) -> dict[str, Any]:
    if set(pre_ingest) != set(PATH_KEYS) or set(settled) != set(PATH_KEYS):
        _fail("savings accounting requires exactly the five configured paths")
    growth = {name: settled[name] - pre_ingest[name] for name in PATH_KEYS}
    if any(value < 0 for value in growth.values()):
        _fail("settled allocated bytes decreased below pre-ingest baseline")
    temporary_growth = settled_temporary - pre_ingest_temporary
    if temporary_growth < 0:
        _fail("settled TMPDIR allocated bytes decreased below pre-ingest baseline")
    if any(fixed_runtime.get(name) is None for name in ("cli", "daemon", "web")):
        full = None
    else:
        full = logical_bytes - sum(settled.values()) - settled_temporary - sum(int(fixed_runtime[name]) for name in ("cli", "daemon", "web"))
    return {"settled_growth_bytes": growth, "settled_temporary_growth_bytes": temporary_growth,
            "incremental_ingest_net_savings_bytes": logical_bytes - sum(growth.values()) - temporary_growth,
            "full_deployment_net_savings_bytes": full}


class PeakSampler:
    def __init__(self, roots: dict[str, Path], interval_ms: int):
        if interval_ms < 10 or interval_ms > 1000:
            _fail("sample interval must be between 10 and 1000 ms")
        self.roots = roots
        self.interval = interval_ms / 1000
        self.stop_event = threading.Event()
        self.error: BaseException | None = None
        self.samples = 0
        self.incomplete_samples = 0
        self.peak_total = 0
        self.peak_at = ""
        self.per_root_peak = {name: 0 for name in roots}
        self.unix_socket_peak_count = {name: 0 for name in roots}
        self.unix_socket_peak_allocated_bytes = {name: 0 for name in roots}
        self._thread = threading.Thread(target=self._run, name="deployment-peak-sampler", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> dict[str, Any]:
        self.stop_event.set()
        self._thread.join()
        if self.error:
            raise QualificationError(f"allocated-byte sampler failed: {self.error}") from self.error
        if self.samples == 0:
            _fail("allocated-byte sampler captured no observations")
        return {"kind": "sampled_observed_peak", "absolute_instantaneous": False,
                "samples": self.samples, "incomplete_samples_skipped": self.incomplete_samples,
                "peak_allocated_bytes": self.peak_total,
                "peak_observed_at_utc": self.peak_at,
                "per_root_peak_allocated_bytes": self.per_root_peak,
                "unix_socket_peak_count": self.unix_socket_peak_count,
                "unix_socket_peak_allocated_bytes": self.unix_socket_peak_allocated_bytes,
                "allocation_caveats": "non-atomic filesystem traversal; directory and volume metadata excluded; Unix socket inode st_blocks counted, socket payload excluded",
                "sampling_interval_ms": round(self.interval * 1000)}

    def _run(self) -> None:
        try:
            while not self.stop_event.is_set():
                sockets: dict[str, dict[str, int]] = {}
                sample = measure_roots(self.roots, allow_incomplete=True, socket_stats=sockets)
                if sample is None:
                    self.incomplete_samples += 1
                    self.stop_event.wait(self.interval)
                    continue
                total = sum(sample.values())
                self.samples += 1
                if total > self.peak_total or self.samples == 1:
                    self.peak_total = total
                    self.peak_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                for name, value in sample.items():
                    self.per_root_peak[name] = max(self.per_root_peak[name], value)
                    self.unix_socket_peak_count[name] = max(self.unix_socket_peak_count[name], sockets[name]["count"])
                    self.unix_socket_peak_allocated_bytes[name] = max(self.unix_socket_peak_allocated_bytes[name], sockets[name]["allocated_bytes"])
                self.stop_event.wait(self.interval)
        except BaseException as exc:  # deliver measurement errors to the owner
            self.error = exc
            self.stop_event.set()


def run_command(argv: list[str], env: dict[str, str], label: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(argv, env=env, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        _fail(f"{label} could not complete: {exc}")


def free_loopback_address() -> tuple[str, int]:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return "127.0.0.1", int(listener.getsockname()[1])


def post_typed_command(address: str, token: str, operation: str, workspace: str, timeout: int = 300,
                       record: Any = None) -> dict[str, Any]:
    envelope = {"schema": "org.cairn.command.v1", "request_id": uuid.uuid4().hex,
                "operation": operation, "workspace_ref": workspace, "idempotency_key": None,
                "input": {"workspace_id": workspace}}
    request = urllib.request.Request(f"http://{address}/api/v1/command", data=json.dumps(envelope).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST")
    http_status: int | None = None
    raw_body = ""
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            http_status = response.status
            raw_body = response.read().decode("utf-8")
            result = json.loads(raw_body)
    except (OSError, TimeoutError, json.JSONDecodeError) as exc:
        _fail(f"typed {operation} request failed: {exc}")
    if record is not None:
        record({"kind": "typed_api", "request": envelope, "http_status": http_status,
                "raw_response_body": raw_body, "response": result,
                "status": result.get("status") if isinstance(result, dict) else None,
                "reason": result.get("reason", result.get("reasons")) if isinstance(result, dict) else None})
    return validate_typed_envelope(result, operation)


def validate_typed_envelope(result: Any, operation: str) -> dict[str, Any]:
    if not isinstance(result, dict) or result.get("operation") != operation or result.get("status") not in ("SUCCEEDED", "DEGRADED"):
        _fail(f"typed {operation} returned an unexpected envelope")
    return result


def typed_data(envelope: dict[str, Any], operation: str) -> dict[str, Any]:
    data = envelope.get("data")
    if not isinstance(data, dict):
        _fail(f"typed {operation} omitted object data")
    return data


def extract_web_and_semantic_inputs(package_archive: Path, evidence_root: Path, semantic_archive: Path | None,
                                   cairn: Path, daemon: Path, use_packaged_semantic: bool = False) -> tuple[Path, Path | None]:
    """Read a candidate tarball and retain its Web tree under new evidence."""
    if package_archive.is_symlink() or not package_archive.is_file():
        _fail("candidate package archive must be a regular non-symlink file")
    runtime_root = evidence_root / "fixed-runtime"
    web_root = runtime_root / "web"
    web_root.mkdir(parents=True, mode=0o700)
    found: dict[str, str] = {}
    extracted_semantic: Path | None = None
    expected_cairn, expected_daemon = sha256_file(cairn), sha256_file(daemon)
    try:
        with tarfile.open(package_archive, "r:gz") as archive:
            for member in archive:
                clean = Path(member.name)
                if clean.is_absolute() or ".." in clean.parts:
                    _fail(f"candidate package has unsafe member path: {member.name}")
                if member.issym() or member.islnk() or (not member.isdir() and not member.isfile()):
                    _fail(f"candidate package contains unsupported member type: {member.name}")
                normalized = clean.as_posix().rstrip("/")
                if normalized.endswith("/bin/cairn") or normalized == "bin/cairn":
                    stream = archive.extractfile(member)
                    if stream is None:
                        _fail("candidate package cairn member is unreadable")
                    digest = hashlib.sha256(stream.read()).hexdigest()
                    found["cairn"] = digest
                elif normalized.endswith("/bin/cairnd") or normalized == "bin/cairnd":
                    stream = archive.extractfile(member)
                    if stream is None:
                        _fail("candidate package daemon member is unreadable")
                    found["daemon"] = hashlib.sha256(stream.read()).hexdigest()
                elif "/web/dist/" in normalized or normalized.endswith("/web/dist"):
                    marker = "/web/dist"
                    relative = normalized.split(marker, 1)[1].lstrip("/")
                    target = web_root / relative if relative else web_root
                    if relative and (Path(relative).is_absolute() or ".." in Path(relative).parts):
                        _fail(f"candidate Web member escapes destination: {member.name}")
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True, mode=0o700)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        stream = archive.extractfile(member)
                        if stream is None:
                            _fail(f"candidate Web member is unreadable: {member.name}")
                        with target.open("xb") as output:
                            while True:
                                block = stream.read(1024 * 1024)
                                if not block:
                                    break
                                output.write(block)
                elif normalized.endswith("/semantic/semantic-bundle.tar.gz") or normalized == "semantic/semantic-bundle.tar.gz":
                    if semantic_archive is None and use_packaged_semantic:
                        semantic_target = runtime_root / "semantic-bundle.tar.gz"
                        stream = archive.extractfile(member)
                        if stream is None:
                            _fail("candidate package semantic archive is unreadable")
                        with semantic_target.open("xb") as output:
                            while True:
                                block = stream.read(1024 * 1024)
                                if not block:
                                    break
                                output.write(block)
                        extracted_semantic = semantic_target
    except (OSError, tarfile.TarError) as exc:
        _fail(f"cannot read candidate package archive: {exc}")
    if found.get("cairn") != expected_cairn or found.get("daemon") != expected_daemon:
        _fail("candidate package CLI/daemon digests do not match supplied binaries")
    if not any(web_root.iterdir()):
        _fail("candidate package archive contains no Web distribution")
    selected_semantic = semantic_archive
    if selected_semantic is not None and (selected_semantic.is_symlink() or not selected_semantic.is_file()):
        _fail("semantic archive must be a regular non-symlink file")
    return web_root, selected_semantic or extracted_semantic


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _extract_status(output: str) -> Any:
    try:
        return json.loads(output).get("status")
    except (json.JSONDecodeError, AttributeError):
        return None


def _extract_reason(output: str) -> Any:
    try:
        value = json.loads(output)
        return value.get("reason") or value.get("reasons")
    except (json.JSONDecodeError, AttributeError):
        return None


def create_owned_runtime_root() -> Path:
    """Create a short, private /tmp root and preserve it for audit/recovery."""
    created = Path(tempfile.mkdtemp(prefix="cairn-", dir="/tmp"))
    os.chmod(created, 0o700)
    os.chown(created, os.getuid(), os.getgid())
    # macOS exposes /tmp as a symlink to /private/tmp. Persist only the
    # canonical spelling so paths emitted by `cairn config validate` compare
    # directly with all harness-created expected paths.
    root = created.resolve(strict=True)
    info = root.stat()
    if info.st_uid != os.getuid() or info.st_gid != os.getgid() or stat.S_IMODE(info.st_mode) != 0o700:
        _fail("owned runtime root ownership or mode verification failed")
    return root


def stop_owned_process(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def start_owned_process(command: list[str], env: dict[str, str], output: Any,
                        wait_ready: Any, timeout: float = 30.0,
                        poll_interval: float = 0.05) -> subprocess.Popen[str]:
    """Always reap an owned child if readiness fails before returning it."""
    proc = subprocess.Popen(command, env=env, stdout=output, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                _fail(f"owned process exited before readiness with {proc.returncode}")
            if wait_ready(proc):
                return proc
            time.sleep(poll_interval)
        _fail("owned process readiness timed out")
    except BaseException:
        stop_owned_process(proc)
        raise


def run_profile(profile: str, cairn: Path, daemon: Path, corpus: Path, manifest: dict[str, Any], evidence_root: Path,
                sample_ms: int, web_root: Path, semantic_archive: Path | None) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    evidence_profile = evidence_root / "runs" / profile
    evidence_profile.mkdir(parents=True, mode=0o700)
    root = create_owned_runtime_root()
    config_path = root / "c" / "config.toml"
    config_path.parent.mkdir(mode=0o700)
    data_home = root / "d"
    temporary_root = root / "t"
    xdg_config = root / "x"
    data_home.mkdir(mode=0o700)
    temporary_root.mkdir(mode=0o700)
    xdg_config.mkdir(mode=0o700)
    socket_path = root / "s.sock"
    if len(os.fsencode(socket_path)) >= 100:
        _fail("temporary Unix socket path is too long; choose a shorter evidence parent")
    env = os.environ.copy()
    for key in ("CAIRN_CONFIG", "CAIRN_CATALOG", "CAIRN_REPOSITORY", "CAIRN_VECTORS", "CAIRN_MODELS", "CAIRN_RECOVERY_RECORDS", "CAIRN_SOCKET", "CAIRN_SEMANTIC_BUNDLE", "CAIRN_IMAGE_BUNDLE", "CAIRN_BGE_ONNX_RUNTIME", "CAIRN_BGE_ONNX_MODEL", "CAIRN_BGE_TOKENIZER", "CAIRN_ZVEC_LIBRARY", "CAIRN_SEMANTIC_BUNDLE_ROOT", "CAIRN_RUN_SUPERVISED_ONNX", "ZVEC_LIBRARY_PATH"):
        env.pop(key, None)
    env["XDG_DATA_HOME"] = str(data_home)
    env["XDG_CONFIG_HOME"] = str(xdg_config)
    env["CAIRN_SOCKET"] = str(socket_path)
    env["TMPDIR"] = str(temporary_root)
    env["TMP"] = str(temporary_root)
    env["TEMP"] = str(temporary_root)
    log_path = evidence_profile / "daemon.log"
    log_file = log_path.open("x", encoding="utf-8")
    records_path = evidence_profile / "command-records.json"
    command_records: list[dict[str, Any]] = []
    def invoke(argv: list[str], label: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
        result = run_command(argv, env, label, timeout=timeout)
        command_records.append({"kind": "cli", "argv": argv, "exit_code": result.returncode,
                                "stdout": result.stdout, "stderr": result.stderr,
                                "status": _extract_status(result.stdout), "reason": _extract_reason(result.stdout)})
        _write_json(records_path, command_records)
        return result
    def record_typed(item: dict[str, Any]) -> None:
        command_records.append(item)
        _write_json(records_path, command_records)
    init = invoke([str(cairn), "config", "init", "--path", str(config_path)], "cairn config init")
    if init.returncode != 0:
        _fail(f"cairn config init failed: {init.stderr.strip() or init.stdout.strip()}")
    patch_storage_profile(config_path, profile)
    config_result = invoke([str(cairn), "--json", "config", "validate", "--path", str(config_path)], "cairn config validate")
    effective = decode_cli_json(config_result, "cairn config validate")
    config_digest = effective.get("config_digest")
    paths = effective.get("paths")
    storage = effective.get("storage")
    if not isinstance(config_digest, str) or not config_digest or not isinstance(paths, dict) or not isinstance(storage, dict):
        _fail("effective config omitted digest, paths, or storage tuple")
    if (storage.get("repository_profile"), storage.get("compression_profile")) != PROFILES[profile]:
        _fail("effective config storage tuple differs from the requested profile")
    roots: dict[str, Path] = {}
    for name in PATH_KEYS:
        value = paths.get(name)
        if not isinstance(value, str) or not value:
            _fail(f"effective config omitted paths.{name}")
        roots[name] = Path(value)
    paths_overlap(roots)
    expected_roots = {
        "catalog": data_home / "cairn" / "catalog.sqlite",
        "repository": data_home / "cairn" / "repository",
        "vectors": data_home / "cairn" / "vectors",
        "models": data_home / "cairn" / "models",
        "recovery_records": data_home / "cairn" / "recovery",
    }
    for name, expected in expected_roots.items():
        if roots[name] != expected.resolve(strict=False):
            _fail(f"effective paths.{name} escaped the tool-created run root")

    sampled_roots = dict(roots)
    sampled_roots["temporary"] = temporary_root
    paths_overlap(sampled_roots)
    baseline_all = measure_roots(sampled_roots)
    assert baseline_all is not None
    baseline = {name: baseline_all[name] for name in PATH_KEYS}
    sampler = PeakSampler(sampled_roots, sample_ms)
    daemon_process: subprocess.Popen[str] | None = None
    sampler.start()
    api_host, api_port = free_loopback_address()
    api_address = f"{api_host}:{api_port}"
    api_token = uuid.uuid4().hex
    api_args = ["--api-listen", api_address, "--api-token", api_token]

    def start_daemon() -> subprocess.Popen[str]:
        command = [str(daemon), "--config", str(config_path), "--socket", str(socket_path), *api_args]
        def ready(_proc: subprocess.Popen[str]) -> bool:
            status = invoke([str(cairn), "--socket", str(socket_path), "--json", "status"], "cairn status", timeout=3)
            return status.returncode == 0
        try:
            return start_owned_process(command, env, log_file, ready)
        except QualificationError as exc:
            _fail(f"{exc}; see {log_path}")

    peak: dict[str, Any] | None = None
    settled_all: dict[str, int] | None = None
    shutdown_all: dict[str, int] | None = None
    semantic_install: dict[str, Any] | None = None
    semantic_rebuild: dict[str, Any] | None = None
    semantic_query: dict[str, Any] | None = None
    successful_readback = False
    pre_ingest_all: dict[str, int] | None = None
    rebuild_data: dict[str, Any] = {}
    daemon_process = None
    try:
        daemon_process = start_daemon()
        if semantic_archive is not None:
            install_result = invoke([str(cairn), "--socket", str(socket_path), "--json", "--timeout", "10m",
                                     "semantic", "bundle", "install", "--archive", str(semantic_archive)],
                                    "cairn semantic bundle install", timeout=600)
            semantic_install = result_data(decode_cli_json(install_result, "cairn semantic bundle install"), "cairn semantic bundle install")
            if not semantic_install.get("destination") or not semantic_install.get("profile_digest"):
                _fail("offline semantic install omitted destination or profile digest")
            stop_owned_process(daemon_process)
            daemon_process = start_daemon()

        pre_ingest_all = measure_roots(sampled_roots)
        assert pre_ingest_all is not None
        verify_corpus(corpus, manifest)
        planned_result = invoke([str(cairn), "--socket", str(socket_path), "--json", "--timeout", "10m", "ingest", str(corpus), "--protection", "STORE_EXACT"], "cairn ingest plan", timeout=600)
        planned = result_data(decode_cli_json(planned_result, "cairn ingest plan"), "cairn ingest plan")
        if planned.get("state") != "READY" or planned.get("executable") is not True or planned.get("protection_mode") != "STORE_EXACT":
            _fail("ingest inspection did not produce an executable STORE_EXACT plan")
        if not planned.get("plan_id") or not planned.get("plan_digest") or not planned.get("workspace_id") or not planned.get("config_digest"):
            _fail("ingest plan omitted run-binding identity")
        if planned["config_digest"] != config_digest:
            _fail("ingest plan config digest differs from the validated effective config")
        logical_bytes = sum(entry["bytes"] for entry in manifest["entries"])
        if planned.get("files") != len(manifest["entries"]) or planned.get("bytes") != logical_bytes:
            _fail("ingest plan file/byte totals differ from the reviewed corpus manifest")
        decisions = planned.get("protection_decisions", [])
        if not isinstance(decisions, list) or len(decisions) != len(manifest["entries"]):
            _fail("ingest plan omitted per-file STORE_EXACT decisions")
        expected_entries = {item["path"]: item for item in manifest["entries"]}
        for item in decisions:
            expected = expected_entries.get(item.get("relative_path")) if isinstance(item, dict) else None
            if expected is None or item.get("expected_content_id") != f"sha256:{expected['sha256']}" or item.get("expected_logical_bytes") != expected["bytes"]:
                _fail("ingest plan per-file path, exact content ID, or logical length differs from reviewed corpus manifest")
        if {item["relative_path"] for item in decisions} != set(expected_entries):
            _fail("ingest plan does not contain each reviewed corpus path exactly once")
        if any(item.get("mode") != "STORE_EXACT" or item.get("planned_outcome") not in ("EXACT_PROTECTED", "EXACT_FALLBACK") for item in decisions):
            _fail("ingest plan contains a non-exact or unresolved per-file protection outcome")

        applied_result = invoke([str(cairn), "--socket", str(socket_path), "--json", "--timeout", "10m", "plan", "apply", planned["plan_id"],
                                 "--workspace", planned["workspace_id"], "--digest", planned["plan_digest"]], "cairn plan apply", timeout=600)
        applied = result_data(decode_cli_json(applied_result, "cairn plan apply"), "cairn plan apply")
        snapshot_ref = applied.get("snapshot_ref")
        if not snapshot_ref or applied.get("workspace_id") != planned.get("workspace_id"):
            _fail("publication reference is absent or belongs to a different workspace")
        verify_corpus(corpus, manifest)
        verified_result = invoke([str(cairn), "--socket", str(socket_path), "--json", "--timeout", "10m", "snapshot", "verify", snapshot_ref, "--mode", "full-bytes"], "cairn snapshot verify", timeout=600)
        verified = result_data(decode_cli_json(verified_result, "cairn snapshot verify"), "cairn snapshot verify")
        if verified.get("ok") is not True or verified.get("bytes") != logical_bytes or verified.get("files") != len(manifest["entries"]):
            _fail("full-byte verification did not match corpus file/byte totals")

        semantic_rebuild = post_typed_command(api_address, api_token, "search.rebuild", planned["workspace_id"], record=record_typed)
        rebuild_data = typed_data(semantic_rebuild, "search.rebuild")
        if rebuild_data.get("snapshot_ref") != snapshot_ref:
            _fail("search rebuild is not bound to the just-published snapshot")
        if semantic_archive is not None and rebuild_data.get("semantic_state") not in ("AVAILABLE", "READY"):
            _fail("installed semantic bundle did not produce an available generation")
        if semantic_archive is None and rebuild_data.get("semantic_state") not in ("UNAVAILABLE", "NOT_BUILT"):
            _fail("semantic provider state is unexpected without an installed bundle")
        query_text = Path(manifest["entries"][0]["path"]).stem or Path(manifest["entries"][0]["path"]).name
        query_result = invoke([str(cairn), "--socket", str(socket_path), "--json", "--timeout", "10m", "search", query_text,
                               "--workspace", planned["workspace_id"]], "cairn search", timeout=600)
        semantic_query = decode_cli_json(query_result, "cairn search", allow_degraded=semantic_archive is None)
        if semantic_archive is not None:
            query_data = result_data(semantic_query, "cairn search")
            components = query_data.get("components", [])
            semantic_component = next((item for item in components if item.get("dimension") == "semantic-embedding"), None)
            if semantic_component is None or semantic_component.get("status") != "SUCCEEDED":
                _fail("post-rebuild fused query omitted a successful semantic component")
        elif measure_allocated(roots["models"]) != 0:
            _fail("semantic provider is unavailable but the isolated models root is not empty")
        verify_corpus(corpus, manifest)
        successful_readback = True
        settled_all = measure_roots(sampled_roots)
        assert settled_all is not None
    finally:
        if daemon_process is not None:
            stop_owned_process(daemon_process)
        if successful_readback:
            shutdown_all = measure_roots(sampled_roots)
            assert shutdown_all is not None
        log_file.close()
        peak = sampler.stop()
    if settled_all is None or shutdown_all is None or peak is None:
        _fail("run ended without settled allocation or sampled peak evidence")
    settled = {name: settled_all[name] for name in PATH_KEYS}
    pre_ingest = {name: pre_ingest_all[name] for name in PATH_KEYS} if pre_ingest_all else {}
    if set(pre_ingest) != set(PATH_KEYS):
        _fail("run ended without a static pre-ingest measurement")
    growth = {name: settled[name] - pre_ingest[name] for name in PATH_KEYS}
    if any(value < 0 for value in growth.values()):
        _fail("settled allocated bytes decreased below the pre-ingest baseline")
    steady_growth = sum(growth.values())
    observed_temporary_peak = max(0, peak["per_root_peak_allocated_bytes"]["temporary"] - settled_all["temporary"])
    sampled_peak_over_settled = max(0, peak["peak_allocated_bytes"] - sum(settled_all.values()))
    repository_growth = growth["repository"]
    external_growth = steady_growth - repository_growth
    fixed_seen: set[tuple[int, int]] = set()
    fixed_runtime = {"cli": measure_allocated(cairn, seen_objects=fixed_seen),
                     "daemon": measure_allocated(daemon, seen_objects=fixed_seen),
                     "web": measure_allocated(web_root, seen_objects=fixed_seen)}
    accounting = savings_accounting(logical_bytes, pre_ingest, settled, pre_ingest_all["temporary"], settled_all["temporary"], fixed_runtime)
    return {
        "schema": "cairn.deployment-savings-measurement.v1",
        "status": "candidate_measurement",
        "correlation": "BOUND_TO_ONE_CONFIGURED_INGEST_RUN",
        "run_id": run_id,
        "profile": {"repository_profile": storage["repository_profile"], "compression_profile": storage["compression_profile"], "config_digest": config_digest},
        "corpus": {"schema": manifest["schema"], "digest": manifest["digest"], "files": len(manifest["entries"]), "logical_bytes": logical_bytes},
        "run_binding": {"plan_id": planned["plan_id"], "plan_digest": planned["plan_digest"], "workspace_id": planned["workspace_id"],
                        "snapshot_ref": snapshot_ref, "manifest_digest": applied.get("manifest_digest", ""), "full_byte_verify": verified},
        "measurement": {"filesystem_allocated_bytes_method": "st_blocks * 512; includes regular files, Unix socket inode allocation and SQLite -wal/-shm sidecars; hard links deduplicated by device/inode; socket contents, directory metadata, volume metadata and unconfigured paths excluded; filesystem traversal is non-atomic",
                        "baseline_scope": "before daemon startup", "pre_ingest_scope": "after optional semantic install and daemon restart, before ingest planning",
                        "settled_scope": "after plan/apply, full-byte verify, rebuild and query while daemon is alive",
                        "path_bytes": {name: {"configured_path": str(roots[name]), "baseline_allocated_bytes": baseline[name],
                                              "pre_ingest_allocated_bytes": pre_ingest[name],
                                              "settled_allocated_bytes": settled[name], "settled_growth_bytes": growth[name]} for name in PATH_KEYS},
                        "temporary_root": {"configured_environment": ["TMPDIR", "TMP", "TEMP"], "path": str(temporary_root),
                                           "baseline_allocated_bytes": baseline_all["temporary"],
                                           "pre_ingest_allocated_bytes": pre_ingest_all["temporary"],
                                           "settled_allocated_bytes": settled_all["temporary"],
                                           "settled_growth_bytes": settled_all["temporary"] - pre_ingest_all["temporary"]},
                        "owned_runtime_root": str(root),
                        "fixed_model_allocated_bytes_baseline": baseline["models"], "fixed_model_allocated_bytes_settled": settled["models"],
                        "fixed_model_allocated_bytes_pre_ingest": pre_ingest["models"],
                        "semantic_provider_state": rebuild_data.get("semantic_state"), "steady_deployment_growth_bytes": steady_growth,
                        "shutdown_snapshot_allocated_bytes": shutdown_all,
                        "sampled_observed_peak": peak, "sampled_temporary_peak_over_online_settled_bytes": observed_temporary_peak,
                        "sampled_total_peak_over_online_settled_bytes": sampled_peak_over_settled,
                        "sampled_temporary_peak_status": "OBSERVED_SAMPLED_NOT_ABSOLUTE_INSTANTANEOUS",
                        "allocation_scope": "configured roots plus explicit TMPDIR; not total physical volume use"},
        "semantic_bundle": {"status": "INSTALLED_AND_QUERIED" if semantic_archive is not None else "UNAVAILABLE_NOT_INSTALLED",
                            "is_qualified_default_cost": False,
                            "models_payload_allocated_bytes": measure_allocated(roots["models"]),
                            "install": semantic_install, "rebuild": semantic_rebuild, "query": semantic_query},
        "fixed_runtime_bytes": {"cli_allocated_bytes": fixed_runtime["cli"], "daemon_allocated_bytes": fixed_runtime["daemon"],
                                "web_allocated_bytes": fixed_runtime["web"]},
        "accounting": {"repository_growth_bytes": repository_growth, "deployment_external_growth_bytes": external_growth,
                       "incremental_ingest_net_savings_bytes": accounting["incremental_ingest_net_savings_bytes"],
                       "full_deployment_net_savings_bytes": accounting["full_deployment_net_savings_bytes"],
                       "incremental_temporary_growth_bytes": accounting["settled_temporary_growth_bytes"],
                       "equations": {"incremental": "logical source bytes - (settled five configured roots + settled TMPDIR - pre-ingest five configured roots - pre-ingest TMPDIR)",
                                     "full": "logical source bytes - final catalog/repository/vectors/models/recovery bytes - final TMPDIR bytes - fixed CLI/daemon/Web bytes"}},
        "candidate_binaries": {"cairn_sha256": sha256_file(cairn), "cairnd_sha256": sha256_file(daemon)},
        "evidence": {"daemon_log": str(log_path), "command_records": str(records_path),
                     "config_path": str(config_path), "config_sha256": sha256_file(config_path),
                     "runtime_root_preserved": str(root), "plan_show": "CLI has no plan show subcommand; immutable ingest plan and profile/config binding are retained in CLI output records",
                     "evidence_scope": "tool-created disposable profile; no phase or release qualification"},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cairn", required=True, type=Path, help="candidate cairn CLI binary")
    parser.add_argument("--daemon", required=True, type=Path, help="matching cairnd binary")
    parser.add_argument("--corpus", required=True, type=Path, help="read-only operator-reviewed corpus")
    parser.add_argument("--corpus-manifest", required=True, type=Path, help="cairn.corpus-manifest.v1 JSON")
    parser.add_argument("--package-archive", required=True, type=Path, help="candidate package archive containing matching binaries and WebUI")
    parser.add_argument("--semantic-archive", type=Path, help="optional retained offline semantic bundle; installed through normal CLI workflow")
    parser.add_argument("--semantic-from-package", action="store_true", help="install the semantic bundle nested in --package-archive")
    parser.add_argument("--evidence-dir", required=True, type=Path, help="new evidence directory; must not already exist")
    parser.add_argument("--sample-ms", type=int, default=50, help="allocated-byte sampling interval (10..1000 ms)")
    args = parser.parse_args(argv)
    try:
        cairn = _safe_absolute(args.cairn, "cairn binary")
        daemon = _safe_absolute(args.daemon, "daemon binary")
        corpus = _safe_absolute(args.corpus, "corpus")
        manifest_path = _safe_absolute(args.corpus_manifest, "corpus manifest")
        package_archive = _safe_absolute(args.package_archive, "package archive")
        semantic_archive = _safe_absolute(args.semantic_archive, "semantic archive") if args.semantic_archive is not None else None
        if not cairn.is_file() or cairn.is_symlink() or not os.access(cairn, os.X_OK):
            _fail("cairn must be an executable regular file")
        if not daemon.is_file() or daemon.is_symlink() or not os.access(daemon, os.X_OK):
            _fail("daemon must be an executable regular file")
        if not manifest_path.is_file():
            _fail("corpus manifest must be an existing regular file")
        if args.semantic_from_package and semantic_archive is not None:
            _fail("choose --semantic-archive or --semantic-from-package, not both")
        if args.evidence_dir.exists() or args.evidence_dir.is_symlink():
            _fail("evidence directory must be new; existing evidence is never overwritten")
        evidence_dir = args.evidence_dir.absolute()
        if not evidence_dir.parent.is_dir() or evidence_dir.parent.is_symlink():
            _fail("evidence directory parent must be an existing real directory")
        if evidence_dir == corpus or evidence_dir in corpus.parents or corpus in evidence_dir.parents:
            _fail("evidence directory and corpus must not overlap")
        manifest = read_manifest(manifest_path, corpus)
        if args.sample_ms < 10 or args.sample_ms > 1000:
            _fail("sample interval must be between 10 and 1000 ms")
        evidence_dir.mkdir(mode=0o700)
        _write_json(evidence_dir / "corpus.manifest.json", manifest)
        web_root, packaged_semantic = extract_web_and_semantic_inputs(package_archive, evidence_dir, semantic_archive,
                                                                      cairn, daemon, args.semantic_from_package)
        semantic_archive = semantic_archive or packaged_semantic
        results = {}
        for profile in ("raw", "zstd"):
            verify_corpus(corpus, manifest)
            result = run_profile(profile, cairn, daemon, corpus, manifest, evidence_dir, args.sample_ms, web_root, semantic_archive)
            results[profile] = result
            _write_json(evidence_dir / f"{profile}.candidate-measurement.json", result)
        if results["raw"]["corpus"] != results["zstd"]["corpus"]:
            _fail("raw/zstd results are not bound to the same corpus manifest")
        report = {"schema": "cairn.same-profile-deployment-savings.v1", "status": "candidate_measurement",
                  "corpus_manifest_digest": manifest["digest"], "profiles": results,
                  "qualification_note": "Candidate measurement only; generated QA inputs are not representative and this report does not qualify or select a repository."}
        _write_json(evidence_dir / "report.json", report)
        print(f"status=candidate_measurement\ncorpus_manifest_digest={manifest['digest']}\nevidence_dir={evidence_dir}")
        return 0
    except (QualificationError, OSError, ValueError, KeyError) as exc:
        print(f"qualify-deployment-savings: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
