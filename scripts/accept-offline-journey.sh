#!/usr/bin/env bash
# Operator-journey acceptance: clean-host install, first content, backup,
# restore into a second fresh location, catalog-free recovery verification, and
# in-place upgrade — executed, not described.
#
# This follows docs/technical/operator-install-backup-upgrade.md and prints the
# exact command and exit code for every step. Its result is candidate evidence
# for a candidate package; it is not release qualification.
#
# ABSOLUTE SAFETY RULE: every daemon this script starts owns its storage
# through CAIRN_CONFIG, CAIRN_CATALOG, CAIRN_REPOSITORY, CAIRN_VECTORS,
# CAIRN_MODELS, CAIRN_RECOVERY_RECORDS and CAIRN_SOCKET pointing inside --work.
# It refuses to run if ~/.local/share/cairn or ~/.config/cairn exists, and it
# re-checks both when it finishes.
#
# usage:
#   accept-offline-journey.sh \
#     --package /abs/cairn-VERSION-OS-ARCH.tar.gz \
#     --work /abs/new-work-dir \
#     [--semantic /abs/semantic-bundle.tar.gz] [--repo /abs/checkout]
set -uo pipefail
export LC_ALL=C
export TZ=UTC
umask 077

usage() {
  echo "usage: $0 --package ABS.tar.gz --work ABS_DIR [--semantic ABS.tar.gz] [--repo ABS_CHECKOUT]" >&2
}

package=""; work=""; semantic=""; repo_root=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --package) package="${2:-}"; shift 2;;
    --work) work="${2:-}"; shift 2;;
    --semantic) semantic="${2:-}"; shift 2;;
    --repo) repo_root="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) usage; exit 2;;
  esac
done
[[ -n "$package" && -n "$work" ]] || { usage; exit 2; }
[[ "$package" = /* && "$work" = /* ]] || { echo "error: --package and --work must be absolute" >&2; exit 2; }
[[ -f "$package" ]] || { echo "error: package not found: $package" >&2; exit 2; }
[[ -z "$semantic" || ( "$semantic" = /* && -f "$semantic" ) ]] || { echo "error: --semantic must be an absolute existing archive" >&2; exit 2; }
if [[ -z "$repo_root" ]]; then
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fi
[[ -f "$repo_root/go.mod" ]] || { echo "error: --repo does not look like the Cairn checkout: $repo_root" >&2; exit 2; }

real_data="$HOME/.local/share/cairn"
real_config="$HOME/.config/cairn"
if [[ -e "$real_data" || -e "$real_config" ]]; then
  echo "REFUSING TO RUN: the operator's real Cairn directories exist:" >&2
  [[ -e "$real_data" ]] && echo "  $real_data" >&2
  [[ -e "$real_config" ]] && echo "  $real_config" >&2
  echo "This harness must never be pointed at, or run beside, the operator's real data." >&2
  exit 2
fi

[[ -d "$work" ]] || mkdir -p "$work"
work="$(cd "$work" && pwd -P)"
runlog="$work/runlog"
mkdir -p "$runlog"
log="$runlog/acceptance.log"
: >"$log"

pid_file="$work/daemons.pid"
: >"$pid_file"
start_daemon_pid=""

step_no=0
step() {
  step_no=$((step_no + 1))
  printf '\n=== STEP %d: %s ===\n' "$step_no" "$1" | tee -a "$log"
}
note() { printf -- '-- %s\n' "$1" | tee -a "$log"; }

BLOCKERS=()
fail() {
  printf '\nFAIL: %s\n' "$1" | tee -a "$log"
  BLOCKERS+=("$1")
}

# prefix_env <prefix-root>: the seven explicit paths naming one operator prefix.
prefix_env() {
  local root="$1"
  cat <<ENV
CAIRN_CONFIG=$root/config.toml
CAIRN_CATALOG=$root/catalog.sqlite
CAIRN_REPOSITORY=$root/repository
CAIRN_VECTORS=$root/vectors
CAIRN_MODELS=$root/models
CAIRN_RECOVERY_RECORDS=$root/recovery
CAIRN_SOCKET=$root/cairnd.sock
ENV
}

work_guard_failures=0

# Commands that carry no Cairn path of their own. They may run while the
# exported CAIRN_* environment names a different prefix, because they neither
# read nor write Cairn storage.
guard_path_agnostic_command() {
  case "$1" in
    bash|sh|python3|tar|gzip|shasum|sha256sum|ls|find|grep|cat|head|tail|wc|sed|awk|cp|mv|rm|mkdir|diff|test|ps|seq|tr|printf|sort|tee|env) return 0;;
    *) return 1;;
  esac
}

# guard_work_env [argv...]: every Cairn path that could take effect must be an
# absolute location inside --work. It inspects the exported environment and any
# explicit CAIRN_* assignment in the command, so neither a forgotten prefix nor
# an `env CAIRN_CATALOG=...` override can slip through.
guard_work_env() {
  local name value arg explicit=0 path_agnostic=0
  if [[ "$#" -gt 0 ]]; then
    guard_path_agnostic_command "$1" && path_agnostic=1
    for arg in "$@"; do
      case "$arg" in CAIRN_*=*) explicit=1;; esac
    done
  fi
  for arg in "$@"; do
    case "$arg" in
      CAIRN_*=*)
        value="${arg#*=}"
        if [[ "$value" != "$work"/* ]]; then
          printf 'GUARD: %s is outside --work\n' "$arg" | tee -a "$log"
          work_guard_failures=$((work_guard_failures + 1))
        fi
        ;;
    esac
  done
  [[ "$explicit" -eq 1 || "$path_agnostic" -eq 1 ]] && return 0
  # A wholly unconfigured environment is the state before the operator sets
  # anything up; it is not a misconfiguration. Only a partially set one is.
  local any_set=0
  for name in CAIRN_CONFIG CAIRN_CATALOG CAIRN_REPOSITORY CAIRN_VECTORS CAIRN_MODELS CAIRN_RECOVERY_RECORDS CAIRN_SOCKET; do
    [[ -n "${!name:-}" ]] && any_set=1
  done
  [[ "$any_set" -eq 0 ]] && return 0
  for name in CAIRN_CONFIG CAIRN_CATALOG CAIRN_REPOSITORY CAIRN_VECTORS CAIRN_MODELS CAIRN_RECOVERY_RECORDS CAIRN_SOCKET; do
    value="${!name:-}"
    if [[ -z "$value" ]]; then
      printf 'GUARD: %s is unset while other Cairn paths are set (it would resolve to a platform default outside --work)\n' "$name" | tee -a "$log"
      work_guard_failures=$((work_guard_failures + 1))
    elif [[ "$value" != "$work"/* ]]; then
      printf 'GUARD: %s=%s is outside --work\n' "$name" "$value" | tee -a "$log"
      work_guard_failures=$((work_guard_failures + 1))
    fi
  done
}

# run "<description>" cmd args... — prints the real command, output, exit code.
LAST_EXIT=0
run() {
  guard_work_env "$@"
  local printable
  printable="$(printf '%q ' "$@")"
  printf '\n$ %s\n' "$printable" | tee -a "$log"
  "$@" 2>&1 | tee -a "$log"
  LAST_EXIT="${PIPESTATUS[0]}"
  printf '[exit %d] %s\n' "$LAST_EXIT" "$printable" | tee -a "$log"
  return 0
}

# cairn_cli <prefix-root> [--json] args... — one CLI call with this prefix's
# explicit paths exported. Prints the command and exit code; the stdout JSON is
# captured in CLI_JSON.
CLI_JSON=""; CLI_EXIT=0
cairn_cli() {
  local root="$1"; shift
  guard_work_env "$@"
  local out_file
  out_file="$(mktemp "$runlog/cli.XXXXXX")"
  printf '\n$ %s %s\n' "$(prefix_env "$root" | tr '\n' ' ')" "$(printf '%q ' "$CAIRN_BIN" "$@")" | tee -a "$log"
  ( export $(prefix_env "$root"); "$CAIRN_BIN" "$@" ) >"$out_file" 2>>"$log"
  CLI_EXIT=$?
  cat "$out_file" | tee -a "$log"
  CLI_JSON="$(cat "$out_file")"
  printf '[exit %d] %s\n' "$CLI_EXIT" "$(printf '%s ' "$@")" | tee -a "$log"
  rm -f "$out_file"
  return 0
}

# start_daemon <description> <prefix-root> [extra daemon args...]
start_daemon() {
  local description="$1" root="$2"; shift 2
  local socket="$root/cairnd.sock"
  rm -f "$socket" "$socket.log"
  local -a argv=("$CAIRND_BIN" --socket "$socket" "$@")
  printf '\n$ %s %s &\n' "$(prefix_env "$root" | tr '\n' ' ')" "$(printf '%q ' "${argv[@]}")" | tee -a "$log"
  ( export $(prefix_env "$root"); exec "${argv[@]}" ) >"$socket.log" 2>&1 &
  start_daemon_pid=$!
  echo "$start_daemon_pid" >>"$pid_file"
  sleep 0.5
  if ! kill -0 "$start_daemon_pid" 2>/dev/null; then
    printf 'daemon exited immediately (%s); first lines of %s:\n' "$description" "$socket.log" | tee -a "$log"
    sed -n '1,40p' "$socket.log" | tee -a "$log"
    start_daemon_pid=""
    return 1
  fi
  return 0
}

stop_daemon() {
  local pid="$1" i
  [[ -n "$pid" ]] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -INT "$pid" 2>/dev/null || true
    for i in $(seq 1 60); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      printf 'warning: daemon %s did not stop on SIGINT; sending SIGTERM\n' "$pid" | tee -a "$log"
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  local pid
  [[ -f "$pid_file" ]] || return 0
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 0.5
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done <"$pid_file"
}
trap cleanup EXIT

# wait_ready <socket> <cli> [probe args...]: the catalog-free recovery reader
# deliberately implements no status.get, so callers name the probe they can
# actually make.
wait_ready() {
  local sock="$1" cli="$2"; shift 2
  local -a probe=("$@")
  [[ "${#probe[@]}" -gt 0 ]] || probe=(status)
  local i
  for i in $(seq 1 120); do
    if "$cli" --socket "$sock" "${probe[@]}" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

jget() {
  python3 -c 'import json,sys
try:
    d=json.loads(sys.argv[1])
except Exception:
    print(""); raise SystemExit(0)
try:
    print(eval(sys.argv[2]))
except Exception:
    print("")' "$1" "$2" 2>/dev/null
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

expand_archive() {
  # Deterministic extraction that refuses absolute, escaping, or non-regular
  # members (tar's own safety plus an explicit check).
  local archive="$1" destination="$2"
  python3 - "$archive" "$destination" "$log" <<'PY'
import sys, tarfile, os
archive, destination, logpath = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(destination, exist_ok=True)
root = os.path.realpath(destination)
with tarfile.open(archive, "r:gz") as handle, open(logpath, "a") as log:
    for member in handle.getmembers():
        name = member.name
        if os.path.isabs(name):
            raise SystemExit(f"refusing absolute archive member: {name}")
        resolved = os.path.realpath(os.path.join(root, name))
        if resolved != root and not resolved.startswith(root + os.sep):
            raise SystemExit(f"refusing archive member escaping the prefix: {name}")
        if member.isdir():
            os.makedirs(resolved, exist_ok=True)
            continue
        if not member.isfile():
            raise SystemExit(f"refusing non-regular archive member: {name}")
        parent = os.path.dirname(resolved)
        if parent:
            os.makedirs(parent, exist_ok=True)
        source = handle.extractfile(member)
        with open(resolved, "wb") as target:
            while True:
                chunk = source.read(1 << 20)
                if not chunk:
                    break
                target.write(chunk)
        os.chmod(resolved, member.mode & 0o777 or 0o600)
        log.write(f"extracted {name} ({member.size} bytes)\n")
PY
}

# digest_tree <root>: sorted "<sha256>  <relative path>" manifest of a tree.
digest_tree() {
  local root="$1"
  ( cd "$root" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s  %s\n' "$(sha256_of "$f")" "$f"
    done )
}

# ===========================================================================
step "record the starting conditions that must not change"
note "operator real data dir:   $real_data"
note "operator real config dir: $real_config"
note "package: $(basename "$package")"
run bash -c "shasum -a 256 '$package' 2>/dev/null || sha256sum '$package'"
run bash -c 'ls -ld "$HOME/.local/share/cairn" "$HOME/.config/cairn" 2>&1; test ! -e "$HOME/.local/share/cairn" && test ! -e "$HOME/.config/cairn" && echo REAL-DATA-DIRS-ABSENT'

step "lay out prefixes; every durable location lives inside --work"
BUILD="$work/build"
PKG="$work/pkg"
P1="$work/primary"
P2="$work/restore"
P3="$work/upgrade"
RESTORED="$work/restored"
RECOVERY="$work/recovery"
SOURCE="$work/source"
mkdir -p "$BUILD" "$PKG" "$P1" "$P2" "$P3" "$RESTORED" "$RECOVERY" "$SOURCE"
note "primary prefix:         $P1"
note "restore prefix:         $P2"
note "upgrade scratch prefix: $P3"
note "independent retention:  $RECOVERY (outside every data prefix on purpose)"
note "restore destinations:   $RESTORED"
run bash -c "find '$P1' '$P2' '$P3' '$RECOVERY' '$RESTORED' -mindepth 1 2>/dev/null | LC_ALL=C sort; echo 'prefix contents above (all empty before install)'"

step "extract the candidate package into a prefix that has never held Cairn"
run bash -c "ls -la '$package'"
expand_exit=0
expand_archive "$package" "$PKG" || expand_exit=$?
printf '[exit %d] expand candidate package (absolute and escaping members refused)\n' "$expand_exit" | tee -a "$log"
[[ "$expand_exit" -eq 0 ]] || fail "package extraction failed"

PACKAGE_ROOT="$(find "$PKG" -maxdepth 2 -name manifest.json -print -quit 2>/dev/null | xargs -I{} dirname {} 2>/dev/null || true)"
if [[ -z "$PACKAGE_ROOT" ]]; then
  fail "candidate manifest.json not found under $PKG"
  printf 'BLOCKED: cannot continue without an extracted package root\n' | tee -a "$log"
  exit 1
fi
note "package root: $PACKAGE_ROOT"
CAIRN_BIN="$PACKAGE_ROOT/bin/cairn"
CAIRND_BIN="$PACKAGE_ROOT/bin/cairnd"
run bash -c "find '$PACKAGE_ROOT' -type f | LC_ALL=C sort | sed 's|$PACKAGE_ROOT/||'"

step "verify the package against the checksums it shipped with"
( cd "$PACKAGE_ROOT" && while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    expected="${line%%  *}"; rel="${line##*  }"
    actual="$(sha256_of "$rel" 2>/dev/null || echo MISSING)"
    if [[ "$expected" == "$actual" ]]; then printf 'OK   %s\n' "$rel"
    else printf 'FAIL %s expected=%s actual=%s\n' "$rel" "$expected" "$actual"; fi
  done < checksums.sha256 ) 2>&1 | tee -a "$log"
run bash -c "cat '$PACKAGE_ROOT/manifest.json'"
run bash -c "cat '$PACKAGE_ROOT/SBOM.json'"

step "record the installed build identity (the before side of the upgrade)"
run "$CAIRND_BIN" --version
run "$CAIRN_BIN" --version
OLD_DAEMON_VERSION="$("$CAIRND_BIN" --version 2>/dev/null | head -1)"
OLD_DAEMON_SHA="$(sha256_of "$CAIRND_BIN")"
note "installed daemon sha256: $OLD_DAEMON_SHA"
run bash -c "cp -f '$CAIRND_BIN' '$BUILD/cairnd-v1' && cp -f '$CAIRN_BIN' '$BUILD/cairn-v1' && echo kept-the-installed-pair-as-the-upgrade-baseline"
if [[ -n "$semantic" ]]; then
  run bash -c "ls -la '$semantic' && (shasum -a 256 '$semantic' || sha256sum '$semantic')"
  run bash -c "cp -f '$semantic' '$BUILD/semantic-bundle.tar.gz' && echo staged-a-fresh-copy-of-the-semantic-archive"
fi

# ===========================================================================
step "CLEAN-HOST INSTALL: create the operator config inside the primary prefix"
guard_work_env CAIRN_CONFIG="$P1/config.toml"
run "$CAIRN_BIN" config init --path "$P1/config.toml"
run env CAIRN_CONFIG="$P1/config.toml" "$CAIRN_BIN" config validate
run env CAIRN_CONFIG="$P1/config.toml" "$CAIRN_BIN" config show --effective
run bash -c "cat '$P1/config.toml'"

step "show that the prefix holds only the config before the daemon starts"
run bash -c "find '$P1' -mindepth 1 -maxdepth 1 | LC_ALL=C sort"

step "start the installed daemon on the empty catalog and reach a healthy status"
started=0
start_daemon "primary daemon on the clean prefix" "$P1" --config "$P1/config.toml" && started=1
if [[ "$started" -eq 1 ]]; then
  ready_status=0; wait_ready "$P1/cairnd.sock" "$CAIRN_BIN" && ready_status=1
  ready="$ready_status"
  printf '[exit %d] daemon answered status.get\n' "$ready" | tee -a "$log"
  [[ "$ready" -eq 1 ]] || fail "daemon never became ready on the empty catalog"
  cairn_cli "$P1" --json status
  STATUS_JSON="$CLI_JSON"
  note "resolved catalog:    $(jget "$STATUS_JSON" 'd.get("data",{}).get("catalog",{}).get("path","")')"
  note "resolved repository: $(jget "$STATUS_JSON" 'd.get("data",{}).get("repository",{}).get("path","")')"
  cairn_cli "$P1" --json snapshot list
  note "fresh catalog snapshot list: $(printf '%s' "$CLI_JSON" | tr -d '\n' | head -c 160)"
  publications="$(jget "$STATUS_JSON" 'd.get("data",{}).get("publications",0)')"
  note "fresh catalog publications=$publications"
  [[ "${publications:-x}" == "0" ]] || fail "a clean install did not report zero publications (publications=$publications)"
  case "$(jget "$STATUS_JSON" 'd.get("data",{}).get("catalog",{}).get("path","")')" in
    "$P1"/*) note "resolved catalog lives inside the primary prefix: yes";;
    *) fail "the daemon resolved a catalog outside its prefix";;
  esac
  # The package gate wants the profiles named from the running instance, not
  # inferred from a file. Compare what the daemon resolved with what the
  # persisted config records, and print the resolved profile tuple.
  run env CAIRN_CONFIG="$P1/config.toml" "$CAIRN_BIN" config show --effective
  note "repository profile:  $(jget "$STATUS_JSON" 'd.get("data",{}).get("repository",{}).get("repository_profile","")')"
  note "compression profile: $(jget "$STATUS_JSON" 'd.get("data",{}).get("repository",{}).get("compression_profile","")')"
  note "config digest (daemon): $(jget "$STATUS_JSON" 'd.get("data",{}).get("config_digest","")')"
  cairn_cli "$P1" --json capability list
  note "semantic provider state before the bundle install: $(printf '%s' "$CLI_JSON" | python3 -c 'import json,sys
d=json.load(sys.stdin)
for c in d.get("data",{}).get("capabilities",[]):
    if c.get("kind")=="index-dimension" and c.get("id")=="semantic-embedding":
        print(c.get("state"), c.get("source"))') (UNAVAILABLE is the honest no-bundle state; the packaged bundle is installed in the next step)"
  note "declared profiles: $(grep -E "^(embedding_mode|local_profile|vector_backend|repository_profile|compression_profile|default_protection|publication_signing)" "$P1/config.toml" | tr '\n' ' ')"
else
  fail "installed daemon failed to start"
fi

step "install the packaged offline semantic bundle and restart (skipped without one)"
if [[ -n "$semantic" ]]; then
  cairn_cli "$P1" --json semantic bundle install --archive "$BUILD/semantic-bundle.tar.gz"
  note "semantic bundle profile=$(jget "$CLI_JSON" 'd.get("data",{}).get("profile_id","")') restart_required=$(jget "$CLI_JSON" 'd.get("data",{}).get("restart_required")')"
  run bash -c "rm -f '$BUILD/semantic-bundle.tar.gz' && echo removed-the-installed-archive-from-its-staging-path"
  stop_daemon "$start_daemon_pid"
  start_daemon "primary daemon after the semantic install" "$P1" --config "$P1/config.toml"
  ready_status=0; wait_ready "$P1/cairnd.sock" "$CAIRN_BIN" && ready_status=1
  ready="$ready_status"
  printf '[exit %d] daemon answered after the bundle-install restart\n' "$ready" | tee -a "$log"
  [[ "$ready" -eq 1 ]] || fail "daemon did not come back after the semantic bundle install"
  cairn_cli "$P1" --json capability list
else
  note "no --semantic archive supplied: the semantic member is NOT exercised in this run"
  note "the CLI, daemon, catalog, repository, backup, restore, and upgrade steps are unaffected"
fi

# ===========================================================================
step "FIRST CONTENT: write a deterministic corpus"
python3 - "$SOURCE" <<'PY'
import os, sys
root = sys.argv[1]
os.makedirs(os.path.join(root, "notes"), exist_ok=True)
os.makedirs(os.path.join(root, "archive", "deep"), exist_ok=True)
files = {
    "notes/flood-notes.txt": "cairn-flood-notes-v1 洪水城市档案恢复说明 exact bytes\n",
    "notes/duplicate-a.txt": "cairn-duplicate-payload-v1 identical logical bytes\n",
    "archive/deep/duplicate-b.txt": "cairn-duplicate-payload-v1 identical logical bytes\n",
    "archive/deep/report 2026.txt": "cairn-report-2026 quarterly recovery report with spaces in the name\n",
}
for rel, text in files.items():
    with open(os.path.join(root, rel), "wb") as handle:
        handle.write(text.encode("utf-8"))
print("corpus files written:", len(files))
PY
digest_tree "$SOURCE" >"$work/source.sha256"
run bash -c "cat '$work/source.sha256'"

step "plan and apply the ingest of the corpus"
cairn_cli "$P1" --json ingest "$SOURCE"
INGEST_JSON="$CLI_JSON"
PLAN_ID="$(jget "$INGEST_JSON" 'd.get("data",{}).get("plan_id","")')"
WS_ID="$(jget "$INGEST_JSON" 'd.get("data",{}).get("workspace_id","")')"
PLAN_DIGEST="$(jget "$INGEST_JSON" 'd.get("data",{}).get("plan_digest","")')"
note "plan_id=$PLAN_ID workspace=$WS_ID plan_digest=$PLAN_DIGEST"
[[ -n "$PLAN_ID" && -n "$WS_ID" && -n "$PLAN_DIGEST" ]] || fail "ingest plan did not return a digest-bound plan"
cairn_cli "$P1" --json plan apply "$PLAN_ID" --workspace "$WS_ID" --digest "$PLAN_DIGEST"
APPLY_JSON="$CLI_JSON"
SNAPSHOT_REF="$(jget "$APPLY_JSON" 'd.get("data",{}).get("snapshot_ref","")')"
note "snapshot_ref=$SNAPSHOT_REF"
[[ -n "$SNAPSHOT_REF" ]] || fail "plan apply did not publish a snapshot"

step "confirm the first content is published, counted and searchable"
cairn_cli "$P1" --json content list --workspace "$WS_ID"
count="$(jget "$CLI_JSON" 'len(d.get("data",{}).get("items",[]))')"
note "content list items: $count (expected 4)"
[[ "${count:-x}" == "4" ]] || fail "content list reported $count items, expected 4"
cairn_cli "$P1" --json search "cairn-flood-notes" --workspace "$WS_ID"
lexical_hits="$(printf '%s' "$CLI_JSON" | grep -c 'cairn-flood-notes' || true)"
note "lexical search lines naming the file: $lexical_hits"
[[ "${lexical_hits:-0}" -ge 1 ]] || fail "lexical search did not surface the ingested file"
cairn_cli "$P1" --json search "洪水城市" --workspace "$WS_ID"
zh_hits="$(jget "$CLI_JSON" 'len(d.get("data",{}).get("hits",[]))')"
zh_status="$(jget "$CLI_JSON" 'd.get("status","")')"
note "Chinese search status=$zh_status hits=$zh_hits exit=$CLI_EXIT"
# Without an installed semantic bundle the fused broker honestly reports a
# degraded status; the lexical lane must still return the subject.
[[ "${zh_hits:-0}" -ge 1 ]] || fail "Chinese lexical search returned no hits (status=$zh_status exit=$CLI_EXIT)"

step "one operator-visible description, so the semantic dimension has real content"
cairn_cli "$P1" --json namespace resolve "notes/flood-notes.txt" --workspace "$WS_ID" --snapshot "$SNAPSHOT_REF"
PATH_REF="$(jget "$CLI_JSON" 'd.get("data",{}).get("path_ref","")')"
[[ -n "$PATH_REF" ]] || fail "namespace resolve did not return a path reference for the described file"
note "path_ref=$PATH_REF"
if [[ -n "$PATH_REF" ]]; then
  cairn_cli "$P1" --json description create "$PATH_REF" --workspace "$WS_ID" --kind USER --language zh --title "恢复说明" --body "洪水城市档案恢复说明"
  note "description revision created for $PATH_REF"
fi

step "canonical full-byte verification of the published snapshot"
cairn_cli "$P1" --json snapshot verify "$SNAPSHOT_REF" --mode full-bytes
note "verify ok=$(jget "$CLI_JSON" 'd.get("data",{}).get("ok")') files=$(jget "$CLI_JSON" 'd.get("data",{}).get("files")') bytes=$(jget "$CLI_JSON" 'd.get("data",{}).get("bytes")')"
[[ "$(jget "$CLI_JSON" 'd.get("data",{}).get("ok")')" == "True" && "$(jget "$CLI_JSON" 'd.get("data",{}).get("files")')" == "4" ]] || fail "full-byte snapshot verification did not pass for all 4 files"

step "semantic query when a real provider is installed (honest skip otherwise)"
if [[ -n "$semantic" ]]; then
  cairn_cli "$P1" --json search "洪水城市" --workspace "$WS_ID" --dimension semantic-embedding
  note "semantic provider=$(jget "$CLI_JSON" 'd.get("data",{}).get("query_provider_ref","")') hits=$(jget "$CLI_JSON" 'len(d.get("data",{}).get("hits",[]))')"
  [[ "$(jget "$CLI_JSON" 'len(d.get("data",{}).get("hits",[]))')" -ge 1 ]] || fail "the installed semantic provider returned no hits for the ingested content"
  note "whether a DESCRIPTION segment appears depends on the semantic generation having been built after the description revision; this run does not assert it"
else
  note "skipped: this run was given no real semantic bundle"
fi

step "restore-plan drill through the catalog projection"
cairn_cli "$P1" --json restore "$SNAPSHOT_REF" "$RESTORED/catalog-restore"
RESTORE_PLAN="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_id","")')"
RESTORE_WS="$(jget "$CLI_JSON" 'd.get("data",{}).get("workspace_id","")')"
RESTORE_DIGEST="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_digest","")')"
cairn_cli "$P1" --json plan apply "$RESTORE_PLAN" --workspace "$RESTORE_WS" --digest "$RESTORE_DIGEST"
digest_tree "$RESTORED/catalog-restore" >"$work/catalog-restore.sha256"
run bash -c "cat '$work/catalog-restore.sha256'"
if diff -q "$work/source.sha256" "$work/catalog-restore.sha256" >/dev/null 2>&1; then
  note "catalog-projection restore reproduced the exact source bytes"
else
  diff "$work/source.sha256" "$work/catalog-restore.sha256" | tee -a "$log" || true
  fail "catalog-projection restore did not reproduce the exact source bytes"
fi

# ===========================================================================
step "BACKUP: the recovery reference, the independent trust anchor, and the durable set"
cairn_cli "$P1" --json recovery export "$SNAPSHOT_REF" "$RECOVERY/reference.json"
cairn_cli "$P1" --json recovery anchor export "$RECOVERY/trust-anchor.json"
run bash -c "ls -la '$RECOVERY' && echo '--- local recovery records (private signing identity included) ---' && find '$P1/recovery' -mindepth 1 -maxdepth 1 | LC_ALL=C sort"

step "quiesce the writer before copying the catalog (SQLite WAL is not in the .sqlite file)"
note "catalog journal_mode: $(sqlite3 "$P1/catalog.sqlite" 'pragma journal_mode;' 2>/dev/null)"
note "publications before quiesce: $(sqlite3 "$P1/catalog.sqlite" 'select count(*) from publications;' 2>/dev/null)"
note "WAL bytes before quiesce: $(stat -f%z "$P1/catalog.sqlite-wal" 2>/dev/null || echo 0)"
stop_daemon "$start_daemon_pid"
run bash -c "test ! -e '$P1/cairnd.sock' && echo daemon-stopped-socket-removed"
note "publications after a clean daemon stop: $(sqlite3 "$P1/catalog.sqlite" 'select count(*) from publications;' 2>/dev/null)"
note "WAL bytes after a clean daemon stop: $(stat -f%z "$P1/catalog.sqlite-wal" 2>/dev/null || echo 0)"
run bash -c "tar -C '$P1' -czf '$work/backup-durable.tar.gz' config.toml catalog.sqlite repository recovery vectors models && ls -la '$work/backup-durable.tar.gz' && (shasum -a 256 '$work/backup-durable.tar.gz' || sha256sum '$work/backup-durable.tar.gz')"
note "backed up from $P1: config.toml catalog.sqlite repository recovery vectors models (daemon stopped)"
run bash -c "rm -rf '$BUILD/backup-verify' && mkdir -p '$BUILD/backup-verify' && tar -C '$BUILD/backup-verify' -xzf '$work/backup-durable.tar.gz' && echo publications-inside-the-backup: \$(sqlite3 '$BUILD/backup-verify/catalog.sqlite' 'select count(*) from publications;')"
note "retained independently of every prefix: $RECOVERY/reference.json and $RECOVERY/trust-anchor.json"

step "show the online-copy hazard: a live catalog copy can lose the WAL sidecar"
run bash -c "cp -f '$P1/catalog.sqlite' '$BUILD/online-copy.sqlite' && printf 'publications in an online copy of just the .sqlite file: %s\n' \"\$(sqlite3 '$BUILD/online-copy.sqlite' 'select count(*) from publications;')\""

step "prove the independent anchor is NOT inside the repository"
run bash -c "if grep -rqs 'publication-trust-anchor' '$P1/repository'; then echo 'UNEXPECTED: anchor name appears inside the repository'; else echo 'no anchor name anywhere inside the repository'; fi"
run bash -c "head -c 700 '$RECOVERY/reference.json'; echo; echo '--- reference above; it names no filesystem anchor path ---'"

step "what a repository-only backup gets you, and what it costs"
run bash -c "test -f '$P1/recovery/publication-signing-identity.json' && echo 'local signing identity present (private; needed to publish more, not to read old records)' || echo 'no local signing identity'"
run bash -c "test -f '$P1/recovery/publication-trust-anchor.json' && echo 'local public anchor copy present' || echo 'no local anchor copy'"
cairn_cli "$P1" --json recovery import "$RECOVERY/reference.json" "$BUILD/absent-anchor.json"
note "missing-anchor import exit=$CLI_EXIT against a live daemon (non-zero is the required fail-closed result)"
[[ "$CLI_EXIT" -ne 0 ]] || fail "an absent trust anchor was accepted"

# ===========================================================================
step "RESTORE: lay the backup into a second prefix that has never held Cairn"
run bash -c "find '$P2' -mindepth 1 | LC_ALL=C sort; echo 'restore prefix contents above (empty expected)'"
run bash -c "tar -C '$P2' -xzf '$work/backup-durable.tar.gz' && echo restored-the-durable-set"
run bash -c "python3 - <<'PY'
import pathlib
old, new = '$P1', '$P2'
path = pathlib.Path(new) / 'config.toml'
text = path.read_text()
path.write_text(text.replace(old, new))
print('rewrote', path, 'with', text.count(old), 'absolute-path replacements')
PY"
run bash -c "grep -nE 'catalog|repository|vectors|models|recovery_records' '$P2/config.toml' | head -12"

step "start the restored daemon against the restored durable set"
started2=0
start_daemon "restored daemon" "$P2" --config "$P2/config.toml" && started2=1
if [[ "$started2" -eq 1 ]]; then
  ready2_status=0; wait_ready "$P2/cairnd.sock" "$CAIRN_BIN" && ready2_status=1
  ready2="$ready2_status"
  printf '[exit %d] restored daemon answered status.get\n' "$ready2" | tee -a "$log"
  [[ "$ready2" -eq 1 ]] || fail "restored daemon never became ready"
  cairn_cli "$P2" --json content list --workspace "$WS_ID"
  restored_count="$(jget "$CLI_JSON" 'len(d.get("data",{}).get("items",[]))')"
  note "restored catalog content items: $restored_count (expected 4)"
  [[ "${restored_count:-x}" == "4" ]] || fail "restored catalog reported $restored_count items, expected 4"
  cairn_cli "$P2" --json snapshot list
  cairn_cli "$P2" --json search "cairn-flood-notes" --workspace "$WS_ID"
  cairn_cli "$P2" --json snapshot verify "$SNAPSHOT_REF" --mode full-bytes
  note "restored-prefix verify ok=$(jget "$CLI_JSON" 'd.get("data",{}).get("ok")') files=$(jget "$CLI_JSON" 'd.get("data",{}).get("files")')"
else
  fail "restored daemon failed to start"
fi

step "restore the exact bytes OUT OF THE RESTORED PREFIX and compare"
run bash -c "mkdir -p '$RESTORED/from-restored'"
cairn_cli "$P2" --json restore "$SNAPSHOT_REF" "$RESTORED/from-restored"
R2_PLAN="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_id","")')"
R2_WS="$(jget "$CLI_JSON" 'd.get("data",{}).get("workspace_id","")')"
R2_DIGEST="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_digest","")')"
cairn_cli "$P2" --json plan apply "$R2_PLAN" --workspace "$R2_WS" --digest "$R2_DIGEST"
digest_tree "$RESTORED/from-restored" >"$work/restored.sha256"
run bash -c "cat '$work/restored.sha256'"
if diff -q "$work/source.sha256" "$work/restored.sha256" >/dev/null 2>&1; then
  note "RESTORED-FROM-BACKUP bytes are byte-identical to the original source bytes"
else
  diff "$work/source.sha256" "$work/restored.sha256" | tee -a "$log" || true
  fail "bytes restored from the backup are not identical to the original"
fi
stop_daemon "$start_daemon_pid"

step "RECOVERY AUTHORITY: verify and restore with no catalog at all"
started3=0
start_daemon "catalog-free recovery reader" "$RECOVERY" \
  --recovery-reader \
  --repository "$P2/repository" \
  --recovery-reference "$RECOVERY/reference.json" \
  --trust-anchor "$RECOVERY/trust-anchor.json" && started3=1
if [[ "$started3" -eq 1 ]]; then
  ready3_status=0; wait_ready "$RECOVERY/cairnd.sock" "$CAIRN_BIN" --json capability list && ready3_status=1
  ready3="$ready3_status"
  printf '[exit %d] catalog-free recovery reader answered\n' "$ready3" | tee -a "$log"
  [[ "$ready3" -eq 1 ]] || fail "catalog-free recovery reader never answered"
  run bash -c "test ! -e '$RECOVERY/catalog.sqlite' && echo 'reader prefix holds no catalog: this path never opened SQLite'"
  cairn_cli "$RECOVERY" --json recovery import "$RECOVERY/reference.json" "$RECOVERY/trust-anchor.json"
  note "recovery import catalog_created=$(jget "$CLI_JSON" 'd.get("data",{}).get("catalog_created")') files=$(jget "$CLI_JSON" 'd.get("data",{}).get("files")') bytes=$(jget "$CLI_JSON" 'd.get("data",{}).get("bytes")')"
  [[ "$(jget "$CLI_JSON" 'd.get("data",{}).get("files")')" == "4" ]] || fail "catalog-free recovery import did not account for 4 files"
  cairn_cli "$RECOVERY" --json snapshot verify "$SNAPSHOT_REF" --mode clean-recovery
  cairn_cli "$RECOVERY" --json snapshot list
  run bash -c "mkdir -p '$RESTORED/from-recovery'"
  cairn_cli "$RECOVERY" --json restore "$SNAPSHOT_REF" "$RESTORED/from-recovery"
  REC_PLAN="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_id","")')"
  REC_WS="$(jget "$CLI_JSON" 'd.get("data",{}).get("workspace_id","")')"
  REC_DIGEST="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_digest","")')"
  cairn_cli "$RECOVERY" --json plan apply "$REC_PLAN" --workspace "$REC_WS" --digest "$REC_DIGEST"
  digest_tree "$RESTORED/from-recovery" >"$work/recovery.sha256"
  run bash -c "cat '$work/recovery.sha256'"
  if diff -q "$work/source.sha256" "$work/recovery.sha256" >/dev/null 2>&1; then
    note "RECOVERY-AUTHORITY restore (no catalog, independent anchor) reproduced the exact source bytes"
  else
    fail "catalog-free recovery restore did not reproduce the exact source bytes"
  fi
  wrong_anchor="$BUILD/tampered-anchor.json"
  python3 - "$RECOVERY/trust-anchor.json" "$wrong_anchor" <<'PY'
import base64, json, sys
anchor = json.load(open(sys.argv[1]))
raw = bytearray(base64.b64decode(anchor["public_key"]))
raw[0] ^= 0x01
anchor["public_key"] = base64.b64encode(bytes(raw)).decode("ascii")
json.dump(anchor, open(sys.argv[2], "w"))
print("wrote a structurally valid anchor with one flipped public-key bit")
PY
  cairn_cli "$RECOVERY" --json recovery import "$RECOVERY/reference.json" "$wrong_anchor"
  note "tampered-anchor import exit=$CLI_EXIT (non-zero is the required fail-closed result)"
  [[ "$CLI_EXIT" -ne 0 ]] || fail "a tampered trust anchor was accepted"
  # A different, structurally valid anchor from another signing identity must
  # also be refused: this proves the retained anchor is the trust root rather
  # than a file whose mere presence is accepted.
  other_anchor="$BUILD/other-identity-anchor.json"
  python3 - "$RECOVERY/trust-anchor.json" "$other_anchor" <<'ANCHORPY'
import base64, hashlib, json, os, sys
anchor = json.load(open(sys.argv[1]))
public = os.urandom(32)
digest = "sha256:" + hashlib.sha256(public).hexdigest()
anchor["public_key"] = base64.b64encode(public).decode("ascii")
anchor["public_key_digest"] = digest
anchor["key_id"] = "ed25519:" + digest
anchor["writer_identity"] = "writer:ed25519:" + digest
json.dump(anchor, open(sys.argv[2], "w"))
print("wrote a structurally valid anchor for a different Ed25519 identity")
ANCHORPY
  cairn_cli "$RECOVERY" --json recovery import "$RECOVERY/reference.json" "$other_anchor"
  note "other-identity-anchor import exit=$CLI_EXIT (non-zero required: the anchor is the trust root)"
  [[ "$CLI_EXIT" -ne 0 ]] || fail "an anchor from a different signing identity was accepted"
  cairn_cli "$RECOVERY" --json recovery import "$BUILD/absent-reference.json" "$RECOVERY/trust-anchor.json"
  note "absent-reference import exit=$CLI_EXIT (non-zero required)"
  stop_daemon "$start_daemon_pid"
else
  fail "catalog-free recovery reader failed to start"
fi

# ===========================================================================
step "UPGRADE IN PLACE: replace the installed pair and restart on the SAME data"
run "$repo_root/scripts/offline-upgrade-in-place.sh" "$repo_root" "$PACKAGE_ROOT" "offline-upgrade-v2"
run "$CAIRND_BIN" --version
NEW_DAEMON_VERSION="$("$CAIRND_BIN" --version 2>/dev/null | head -1)"
NEW_DAEMON_SHA="$(sha256_of "$CAIRND_BIN")"
note "daemon version before: $OLD_DAEMON_VERSION"
note "daemon version after:  $NEW_DAEMON_VERSION"
note "daemon sha256 before:  $OLD_DAEMON_SHA"
note "daemon sha256 after:   $NEW_DAEMON_SHA"
if [[ "$NEW_DAEMON_VERSION" == "$OLD_DAEMON_VERSION" ]]; then
  fail "the replaced daemon still reports the pre-upgrade version"
fi
run bash -c "ls -la '$PACKAGE_ROOT/bin' '$PACKAGE_ROOT/bin/previous'"

step "restart the upgraded daemon against the EXISTING primary data and re-verify"
started4=0
start_daemon "upgraded daemon on existing data" "$P1" --config "$P1/config.toml" && started4=1
if [[ "$started4" -eq 1 ]]; then
  ready4_status=0; wait_ready "$P1/cairnd.sock" "$CAIRN_BIN" && ready4_status=1
  ready4="$ready4_status"
  printf '[exit %d] upgraded daemon answered status.get on existing data\n' "$ready4" | tee -a "$log"
  [[ "$ready4" -eq 1 ]] || fail "upgraded daemon never became ready on existing data"
  cairn_cli "$P1" --json status
  note "catalog schema_state=$(jget "$CLI_JSON" 'd.get("data",{}).get("catalog",{}).get("schema_state","")') schema_version=$(jget "$CLI_JSON" 'd.get("data",{}).get("catalog",{}).get("schema_version","")') binary_version=$(jget "$CLI_JSON" 'd.get("data",{}).get("catalog",{}).get("schema_binary_version","")')"
  note "catalog schema_reason=$(jget "$CLI_JSON" 'd.get("data",{}).get("catalog",{}).get("schema_reason","")')"
  cairn_cli "$P1" --json content list --workspace "$WS_ID"
  upgraded_count="$(jget "$CLI_JSON" 'len(d.get("data",{}).get("items",[]))')"
  note "content items after upgrade: $upgraded_count (expected 4)"
  [[ "${upgraded_count:-x}" == "4" ]] || fail "content count changed across the upgrade"
  cairn_cli "$P1" --json search "cairn-flood-notes" --workspace "$WS_ID"
  cairn_cli "$P1" --json snapshot verify "$SNAPSHOT_REF" --mode full-bytes
  note "post-upgrade verify ok=$(jget "$CLI_JSON" 'd.get("data",{}).get("ok")') files=$(jget "$CLI_JSON" 'd.get("data",{}).get("files")')"
  cairn_cli "$P1" --json recovery import "$RECOVERY/reference.json" "$RECOVERY/trust-anchor.json"
  note "post-upgrade recovery import files=$(jget "$CLI_JSON" 'd.get("data",{}).get("files")') commit=$(jget "$CLI_JSON" 'd.get("data",{}).get("commit_digest","")')"
  run bash -c "mkdir -p '$RESTORED/after-upgrade'"
  cairn_cli "$P1" --json restore "$SNAPSHOT_REF" "$RESTORED/after-upgrade"
  POST_PLAN="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_id","")')"
  POST_WS="$(jget "$CLI_JSON" 'd.get("data",{}).get("workspace_id","")')"
  POST_DIGEST="$(jget "$CLI_JSON" 'd.get("data",{}).get("plan_digest","")')"
  cairn_cli "$P1" --json plan apply "$POST_PLAN" --workspace "$POST_WS" --digest "$POST_DIGEST"
  digest_tree "$RESTORED/after-upgrade" >"$work/after-upgrade.sha256"
  run bash -c "cat '$work/after-upgrade.sha256'"
  if diff -q "$work/source.sha256" "$work/after-upgrade.sha256" >/dev/null 2>&1; then
    note "exact bytes are still recoverable after the in-place upgrade"
  else
    fail "exact bytes were not recoverable after the in-place upgrade"
  fi
  stop_daemon "$start_daemon_pid"
else
  fail "upgraded daemon failed to start on existing data"
fi

step "upgrade the restored prefix too, then reopen it on the upgraded pair"
run "$repo_root/scripts/offline-upgrade-in-place.sh" "$repo_root" "$PACKAGE_ROOT" "offline-upgrade-v3"
started5=0
start_daemon "restored prefix on upgraded binaries" "$P2" --config "$P2/config.toml" && started5=1
if [[ "$started5" -eq 1 ]]; then
  ready5_status=0; wait_ready "$P2/cairnd.sock" "$CAIRN_BIN" && ready5_status=1
  ready5="$ready5_status"
  printf '[exit %d] restored prefix answered on upgraded binaries\n' "$ready5" | tee -a "$log"
  [[ "$ready5" -eq 1 ]] || fail "the upgraded daemon failed to reopen the restored prefix"
  cairn_cli "$P2" --json snapshot verify "$SNAPSHOT_REF" --mode full-bytes
  note "restored-prefix post-upgrade verify ok=$(jget "$CLI_JSON" 'd.get("data",{}).get("ok")')"
  stop_daemon "$start_daemon_pid"
else
  fail "the upgraded daemon failed to reopen the restored prefix"
fi

# ===========================================================================
step "FINAL SAFETY CHECK: the operator's real data directories are still absent"
run bash -c 'ls -ld "$HOME/.local/share/cairn" "$HOME/.config/cairn" 2>&1; test ! -e "$HOME/.local/share/cairn" && test ! -e "$HOME/.config/cairn" && echo REAL-DATA-DIRS-ABSENT'
if [[ -e "$real_data" || -e "$real_config" ]]; then
  fail "the operator's real Cairn directories appeared during the run"
fi

step "stop every daemon this run started"
cleanup
run bash -c 'ps -axo pid,command | grep -E "[c]airnd" || echo no-cairnd-processes-remain'
run bash -c "ls -la '$runlog'"

printf '\n=== SUMMARY ===\n' | tee -a "$log"
note "environment guard violations: $work_guard_failures"
if [[ "$work_guard_failures" -ne 0 ]]; then
  fail "$work_guard_failures command(s) ran with a Cairn path outside --work"
fi
if [[ "${#BLOCKERS[@]}" -eq 0 ]]; then
  printf 'RESULT: PASS (no blockers)\n' | tee -a "$log"
else
  printf 'RESULT: BLOCKED (%d)\n' "${#BLOCKERS[@]}" | tee -a "$log"
  for item in "${BLOCKERS[@]}"; do printf '  - %s\n' "$item" | tee -a "$log"; done
fi
printf 'runlog: %s\n' "$log"
printf 'work:   %s (kept for inspection; remove with: rm -rf %s)\n' "$work" "$work"
[[ "${#BLOCKERS[@]}" -eq 0 ]]
