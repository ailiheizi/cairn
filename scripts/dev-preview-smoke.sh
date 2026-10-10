#!/usr/bin/env bash
# Exercise a retained Darwin candidate artifact in fresh, disposable local state.
# This is development evidence, not an installer or release qualification.
set -euo pipefail
export LC_ALL=C
umask 077

usage() {
  echo "usage: $0 --artifact ABSOLUTE_FILE --sha256 HEX --artifacts ABSOLUTE_EMPTY_DIR" >&2
}

artifact=""; expected_sha=""; evidence=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) artifact="${2:-}"; shift 2 ;;
    --sha256) expected_sha="${2:-}"; shift 2 ;;
    --artifacts) evidence="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done
[[ -n "$artifact" && -n "$expected_sha" && -n "$evidence" ]] || { usage; exit 2; }
[[ "$artifact" = /* && "$evidence" = /* ]] || { echo "error: artifact and artifacts paths must be absolute" >&2; exit 2; }
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "error: --sha256 must be 64 lowercase hexadecimal characters" >&2; exit 2; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "error: this candidate smoke is scoped to Darwin arm64" >&2; exit 1; }
[[ -f "$artifact" && ! -L "$artifact" ]] || { echo "error: --artifact must be a regular non-symlink file" >&2; exit 2; }
for tool in python3 shasum jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: required tool is unavailable: $tool" >&2; exit 1; }
done

mkdir -p "$(dirname "$evidence")"
[[ ! -e "$evidence" && ! -L "$evidence" ]] || { echo "error: evidence directory already exists; refusing to overwrite it" >&2; exit 2; }
mkdir -m 700 "$evidence"
evidence="$(cd "$evidence" && pwd -P)"
work="$(mktemp -d "${TMPDIR:-/tmp}/cairn-preview.XXXXXX")"
work="$(cd "$work" && pwd -P)"
daemon_pid=""; recovery_pid=""
stop_pid() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
cleanup() {
  stop_pid "$recovery_pid"
  stop_pid "$daemon_pid"
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

# Bind the exact retained input before inspecting or extracting it.
actual_sha="$(shasum -a 256 "$artifact" | awk '{print $1}')"
[[ "$actual_sha" == "$expected_sha" ]] || { echo "error: outer artifact digest mismatch (expected $expected_sha, got $actual_sha)" >&2; exit 1; }

# Validate every member before writing any package file. Reject path tricks,
# duplicate members, links and special files; then verify all embedded hashes.
package_root="$(python3 - "$artifact" "$work/extracted" <<'PY'
import hashlib
import json
import os
import pathlib
import re
import sys
import tarfile

archive, destination = sys.argv[1:]
dest = pathlib.Path(destination)
dest.mkdir(mode=0o700, parents=True, exist_ok=False)
max_entries = 10000
max_total = 1024 * 1024 * 1024
seen = set()
entries = []
total = 0
try:
    with tarfile.open(archive, "r:gz") as tf:
        roots = set()
        for item in tf:
            if len(entries) >= max_entries:
                raise ValueError("archive entry count exceeds limit")
            name = item.name
            if (not name or name.startswith("/") or "\\" in name or
                    any(ord(ch) < 32 or ord(ch) == 127 for ch in name)):
                raise ValueError(f"unsafe archive path: {name!r}")
            raw_parts = name.split("/")
            if item.isdir() and raw_parts[-1] == "":
                raw_parts.pop()
            parts = tuple(raw_parts)
            if not parts or any(part in ("", ".", "..") for part in parts):
                raise ValueError(f"unsafe archive path: {name!r}")
            if len(parts[0]) > 200 or any(len(part) > 255 for part in parts):
                raise ValueError(f"archive path component exceeds limit: {name!r}")
            roots.add(parts[0])
            normalized = "/".join(parts)
            if normalized in seen:
                raise ValueError(f"duplicate archive path: {name!r}")
            seen.add(normalized)
            if not (item.isdir() or item.isfile()):
                raise ValueError(f"links and special archive entries are forbidden: {name!r}")
            if item.isfile():
                total += item.size
                if item.size < 0 or total > max_total:
                    raise ValueError("archive expanded size exceeds limit")
            entries.append((item, parts, normalized))
        if len(roots) != 1:
            raise ValueError("archive must contain exactly one top-level directory")
        root = next(iter(roots))
        if not root.startswith("cairn-"):
            raise ValueError("unexpected package root")
        for item, parts, normalized in entries:
            target = dest.joinpath(*parts)
            if item.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                os.chmod(target, 0o755)
                continue
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tf.extractfile(item) as source, open(target, "xb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            os.chmod(target, 0o755 if item.mode & 0o111 else 0o644)
    package = dest / root
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "cairn.candidate-offline-artifact.v1" or manifest.get("status") != "CANDIDATE_ONLY_NOT_SUPPORTED":
        raise ValueError("manifest is not an explicitly candidate-only offline artifact")
    if manifest.get("platform") != {"os": "darwin", "arch": "arm64"}:
        raise ValueError("candidate manifest is not Darwin arm64")
    expected_layout = {
        "daemon": "bin/cairnd",
        "cli": "bin/cairn",
        "web": "web/dist",
        "semantic": "semantic/semantic-bundle.tar.gz",
    }
    if manifest.get("layout") != expected_layout:
        raise ValueError("manifest layout does not match the fixed candidate package paths")
    if root != f"cairn-{manifest.get('version')}-darwin-arm64":
        raise ValueError("archive root does not match manifest version and platform")
    checks = (package / "checksums.sha256").read_text(encoding="utf-8").splitlines()
    listed = set()
    for line in checks:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._+/-]+)", line)
        if not match:
            raise ValueError("malformed embedded checksum line")
        digest, rel = match.groups()
        relparts = pathlib.PurePosixPath(rel).parts
        if rel.startswith("/") or any(part in ("", ".", "..") for part in relparts) or "\\" in rel:
            raise ValueError(f"unsafe checksummed path: {rel!r}")
        if rel in listed:
            raise ValueError(f"duplicate checksum path: {rel!r}")
        listed.add(rel)
        target = package.joinpath(*relparts)
        if target.is_symlink() or not target.is_file():
            raise ValueError(f"checksummed file is missing or unsafe: {rel!r}")
        h = hashlib.sha256()
        with target.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                h.update(chunk)
        if h.hexdigest() != digest:
            raise ValueError(f"embedded checksum mismatch: {rel!r}")
    expected = {p.relative_to(package).as_posix() for p in package.rglob("*") if p.is_file() and p.name != "checksums.sha256"}
    if listed != expected:
        raise ValueError("embedded checksum list does not exactly cover package files")
    bundle = package / manifest["layout"]["semantic"]
    bundle_hash = hashlib.sha256()
    with bundle.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            bundle_hash.update(chunk)
    bundle_digest = bundle_hash.hexdigest()
    if manifest.get("semantic_archive_sha256") != "sha256:" + bundle_digest:
        raise ValueError("semantic archive digest does not match manifest")
    print(package)
except Exception as exc:
    print(f"error: candidate archive validation failed: {exc}", file=sys.stderr)
    sys.exit(1)
PY
 )"
[[ -d "$package_root" ]] || { echo "error: validated package root could not be resolved" >&2; exit 1; }
rw="$package_root/bin/cairn"; daemon="$package_root/bin/cairnd"
socket="$work/m.sock"; config="$work/config/cairn/config.toml"
data_home="$work/data"; xdg_config="$work/config"; logs="$evidence/logs"
mkdir -m 700 "$logs" "$work/source" "$work/recovered"
export XDG_DATA_HOME="$data_home" XDG_CONFIG_HOME="$xdg_config"

clean_env_args=(env -u CAIRN_CONFIG -u CAIRN_CATALOG -u CAIRN_REPOSITORY
  -u CAIRN_VECTORS -u CAIRN_MODELS -u CAIRN_RECOVERY_RECORDS
  -u CAIRN_SEMANTIC_BUNDLE -u CAIRN_IMAGE_BUNDLE
  -u CAIRN_BGE_ONNX_RUNTIME -u CAIRN_BGE_ONNX_MODEL
  -u CAIRN_BGE_TOKENIZER -u CAIRN_ZVEC_LIBRARY
  -u CAIRN_SEMANTIC_BUNDLE_ROOT -u CAIRN_RUN_SUPERVISED_ONNX
  -u ZVEC_LIBRARY_PATH)
clean_env() {
  "${clean_env_args[@]}" "$@"
}
run_cli() { clean_env "$rw" --socket "$socket" "$@"; }
start_daemon() {
  "${clean_env_args[@]}" "$daemon" --config "$config" --socket "$socket" \
    >"$logs/daemon.log" 2>&1 &
  daemon_pid=$!
  for _ in $(seq 1 90); do
    if run_cli status >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$daemon_pid" 2>/dev/null; then
      echo "error: packaged daemon exited during startup" >&2
      return 1
    fi
    sleep 1
  done
  echo "error: packaged daemon did not become ready" >&2
  return 1
}
stop_daemon() { stop_pid "$daemon_pid"; daemon_pid=""; }
save_command() {
  local name="$1"; shift
  run_cli --json "$@" >"$logs/$name.json"
}

clean_env "$rw" config init --path "$config" >"$logs/config-init.txt"
clean_env "$rw" --json config show --path "$config" >"$logs/effective-config.json"
jq -e --arg root "$work/" \
  '[.paths.catalog,.paths.repository,.paths.vectors,.paths.models,.paths.recovery_records] | all(.[]; type == "string" and startswith($root))' \
  "$logs/effective-config.json" >/dev/null || {
    echo "error: one or more effective persisted paths escape the smoke temp root" >&2
    exit 1
  }
start_daemon
save_command initial-status status
# Bundle admission hashes and probes real runtime/model files. Keep this
# explicitly bounded operation separate from the ordinary CLI round-trip.
save_command install --timeout 2m semantic bundle install --archive "$package_root/semantic/semantic-bundle.tar.gz"
stop_daemon
bundle_root="$(jq -er '.data.destination | select(type == "string" and length > 0)' "$logs/install.json")"
zvec_relative="$(jq -er '.zvec.path | select(type == "string" and length > 0)' "$bundle_root/semantic-bundle.json")"
case "$zvec_relative" in
  /*|.|..|./*|../*|*/./*|*/../*|*/.|*/..|*//*|*\\*)
    echo "error: installed bundle has an unsafe zvec asset path" >&2
    exit 1
    ;;
esac
installed_zvec_library="$bundle_root/$zvec_relative"
[[ -f "$installed_zvec_library" && ! -L "$installed_zvec_library" ]] || {
  echo "error: installed bundle zvec library is unavailable" >&2
  exit 1
}
start_daemon
save_command ready-status status

payload_text='Cairn local preview exact-byte recovery marker 20261006: 洪水城市影像档案'
printf '%s\n' "$payload_text" >"$work/source/preview.txt"
expected_bytes="$(wc -c <"$work/source/preview.txt" | tr -d ' ')"
expected_payload_sha="$(shasum -a 256 "$work/source/preview.txt" | awk '{print $1}')"
save_command ingest ingest "$work/source"
plan_id="$(jq -er '.data.plan_id | select(type == "string" and length > 0)' "$logs/ingest.json")"
workspace_id="$(jq -er '.data.workspace_id | select(type == "string" and length > 0)' "$logs/ingest.json")"
plan_digest="$(jq -er '.data.plan_digest | select(type == "string" and length > 0)' "$logs/ingest.json")"
jq -e '.status == "SUCCEEDED" and .data.executable == true and .data.local_files == 1' "$logs/ingest.json" >/dev/null
save_command apply plan apply "$plan_id" --workspace "$workspace_id" --digest "$plan_digest"
snapshot_ref="$(jq -er '.data.snapshot_ref | select(type == "string" and length > 0)' "$logs/apply.json")"

save_command resolve namespace resolve preview.txt --workspace "$workspace_id" --snapshot "$snapshot_ref"
path_ref="$(jq -er '.data.path_ref | select(type == "string" and length > 0)' "$logs/resolve.json")"
save_command describe description create "$path_ref" --workspace "$workspace_id" --kind USER --language zh --title 'Local recovery note' --body '洪水城市影像档案 local preview semantic query marker'
save_command search-semantic search '洪水城市影像档案 local preview semantic query marker' --workspace "$workspace_id" --dimension semantic-embedding
jq -e '.status == "SUCCEEDED" and (.data.hits | length > 0) and .data.query_provider_ref == "query.semantic.onnx-bge-zvec.v1"' "$logs/search-semantic.json" >/dev/null
save_command search-lexical search 'preview exact-byte recovery marker' --workspace "$workspace_id" --dimension lexical-metadata-fts
jq -e '.status == "SUCCEEDED" and (.data.hits | length > 0)' "$logs/search-lexical.json" >/dev/null

mkdir -m 700 "$work/portable"
run_cli recovery export "$snapshot_ref" "$work/portable/recovery-reference.json" >"$logs/recovery-export.txt"
run_cli recovery anchor export "$work/portable/trust-anchor.json" >"$logs/anchor-export.txt"
repo_root="$(python3 - "$config" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as source:
    print(tomllib.load(source)["paths"]["repository"])
PY
)"
stop_daemon

# The second process uses the catalog-free reader mode and only the configured
# repository, separately exported reference, and independent trust anchor.
recovery_socket="$work/r.sock"
clean_env "$daemon" --recovery-reader --repository "$repo_root" \
  --recovery-reference "$work/portable/recovery-reference.json" \
  --trust-anchor "$work/portable/trust-anchor.json" --socket "$recovery_socket" \
  >"$logs/recovery-reader.log" 2>&1 &
recovery_pid=$!
recovery_rw() { clean_env "$rw" --socket "$recovery_socket" "$@"; }
for _ in $(seq 1 90); do
  if recovery_rw snapshot list >/dev/null 2>&1; then break; fi
  if ! kill -0 "$recovery_pid" 2>/dev/null; then echo "error: clean recovery reader exited during startup" >&2; exit 1; fi
  sleep 1
done
save_recovery_command() { local name="$1"; shift; recovery_rw --json "$@" >"$logs/$name.json"; }
save_recovery_command recovery-import recovery import "$work/portable/recovery-reference.json" "$work/portable/trust-anchor.json"
jq -e '.status == "SUCCEEDED" and .data.files == 1 and .data.bytes == '"$expected_bytes"' and .data.catalog_created == false' "$logs/recovery-import.json" >/dev/null
save_recovery_command restore-plan restore "$snapshot_ref" "$work/recovered"
restore_plan="$(jq -er '.data.plan_id | select(type == "string" and length > 0)' "$logs/restore-plan.json")"
recovery_workspace="$(jq -er '.data.workspace_id | select(type == "string" and length > 0)' "$logs/restore-plan.json")"
restore_digest="$(jq -er '.data.plan_digest | select(type == "string" and length > 0)' "$logs/restore-plan.json")"
jq -e '.status == "SUCCEEDED" and .data.executable == true and .data.wrote == false and .data.files == 1 and .data.bytes == '"$expected_bytes" "$logs/restore-plan.json" >/dev/null
save_recovery_command restore-apply plan apply "$restore_plan" --workspace "$recovery_workspace" --digest "$restore_digest"
jq -e '.status == "SUCCEEDED" and .data.files == 1 and .data.bytes == '"$expected_bytes" "$logs/restore-apply.json" >/dev/null
restored="$work/recovered/preview.txt"
[[ -f "$restored" && ! -L "$restored" ]] || { echo "error: recovered payload is missing or unsafe" >&2; exit 1; }
restored_bytes="$(wc -c <"$restored" | tr -d ' ')"
restored_sha="$(shasum -a 256 "$restored" | awk '{print $1}')"
[[ "$restored_bytes" == "$expected_bytes" && "$restored_sha" == "$expected_payload_sha" ]] || { echo "error: restored payload identity mismatch" >&2; exit 1; }
stop_pid "$recovery_pid"; recovery_pid=""

artifact_real="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$artifact")"
reference_sha="$(shasum -a 256 "$work/portable/recovery-reference.json" | awk '{print $1}')"
anchor_sha="$(shasum -a 256 "$work/portable/trust-anchor.json" | awk '{print $1}')"
jq -n --arg artifact "$artifact_real" --arg artifact_sha "$actual_sha" \
  --arg restored_sha "$restored_sha" --arg reference_sha "$reference_sha" --arg anchor_sha "$anchor_sha" \
  --argjson restored_bytes "$restored_bytes" \
  '{schema:"cairn.local-development-preview-smoke.v1",status:"PASS",scope:"Darwin arm64 local candidate trial; development evidence only",artifact:$artifact,artifact_sha256:$artifact_sha,semantic_query:"PASS",lexical_query:"PASS",independent_anchor_clean_reader_restore:"PASS",restored_bytes:$restored_bytes,restored_sha256:$restored_sha,recovery_reference_sha256:$reference_sha,trust_anchor_sha256:$anchor_sha}' \
  >"$evidence/result.json"
echo "PASS: local candidate smoke; evidence: $evidence/result.json"
