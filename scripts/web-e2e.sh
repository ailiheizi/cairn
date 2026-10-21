#!/bin/sh
set -eu

# Opt-in browser harness. It owns only a temporary daemon process and a
# temporary config/data root; it never changes the repository or a user's
# persisted Cairn profile.
if [ "${CAIRN_WEB_E2E:-0}" != "1" ]; then
  echo "SKIP: set CAIRN_WEB_E2E=1 to run the browser harness"
  exit 0
fi

daemon_bin=${CAIRN_DAEMON_BIN:-cairnd}
cairn_bin=${CAIRN_BIN:-cairn}
api_listen=${CAIRN_WEB_E2E_API_LISTEN:-127.0.0.1:4536}

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "FAIL: required command '$1' is not available" >&2; exit 1; }
}

# Validate every cheap prerequisite before creating build directories or
# invoking Go/npm. An opted-in run must never turn missing coverage into a
# successful skip.
require_command curl
require_command node
require_command npm
require_command cmp
require_command awk
require_command env
require_command mktemp
require_command mkdir
require_command cp
require_command rm
require_command sleep
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "FAIL: required command 'sha256sum' or 'shasum' is not available" >&2
  exit 1
fi

playwright_module=${CAIRN_PLAYWRIGHT_MODULE:-}
# When Playwright is available but its managed browser cache is not, set
# CAIRN_PLAYWRIGHT_EXECUTABLE_PATH to an installed Chrome/Chromium.
# The variable is inherited by each phase invocation below.
if [ -z "$playwright_module" ] && [ -f "web/node_modules/playwright/index.mjs" ]; then
  playwright_module=$(pwd)/web/node_modules/playwright/index.mjs
fi
if [ -z "$playwright_module" ] || ! node --input-type=module -e 'import(process.argv[1]).catch(() => process.exit(77))' "$playwright_module" >/dev/null 2>&1; then
  echo "FAIL: required npm package playwright is not installed" >&2
  echo "      install playwright under web/node_modules or set CAIRN_PLAYWRIGHT_MODULE" >&2
  exit 1
fi

# A missing local installation must not turn the real browser run into a
# false skip. Build both binaries into an isolated temporary directory when
# the caller did not supply usable paths.
if ! command -v "$daemon_bin" >/dev/null 2>&1 || ! command -v "$cairn_bin" >/dev/null 2>&1; then
  require_command go
fi
build_root=$(mktemp -d "${TMPDIR:-/tmp}/cairn-web-e2e-build.XXXXXX")
cleanup_build() { rm -rf "$build_root"; }
trap cleanup_build EXIT INT TERM
if ! command -v "$daemon_bin" >/dev/null 2>&1; then
  command -v go >/dev/null 2>&1 || { echo "FAIL: cairnd is unavailable and go is not installed" >&2; exit 1; }
  go build -tags cairn_zvec_dynamic -o "$build_root/cairnd" ./server/cmd/cairnd || { echo "FAIL: could not build cairnd" >&2; exit 1; }
  daemon_bin=$build_root/cairnd
fi
if ! command -v "$cairn_bin" >/dev/null 2>&1; then
  command -v go >/dev/null 2>&1 || { echo "FAIL: cairn is unavailable and go is not installed" >&2; exit 1; }
  go build -tags cairn_zvec_dynamic -o "$build_root/cairn" ./client/cmd/cairn || { echo "FAIL: could not build cairn" >&2; exit 1; }
  cairn_bin=$build_root/cairn
fi

npm --prefix web run build >/dev/null || { echo "FAIL: WebUI production build failed" >&2; exit 1; }

tmp_root=$(mktemp -d "${TMPDIR:-/tmp}/cairn-web-e2e.XXXXXX")
daemon_pid=
cleanup() {
  if [ -n "$daemon_pid" ]; then kill "$daemon_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_root"
  rm -rf "$build_root"
}
trap cleanup EXIT INT TERM

config_path=$tmp_root/config.toml
source_path=$tmp_root/source
socket_path=$tmp_root/cairnd.sock
web_root=$(cd web/dist 2>/dev/null && pwd -P) || { echo "FAIL: web/dist is missing after the WebUI build" >&2; exit 1; }
[ -f "$web_root/index.html" ] || { echo "FAIL: web/dist/index.html is missing after the WebUI build" >&2; exit 1; }
mkdir -p "$source_path"
printf '%s\n' 'Cairn browser E2E durable duplicate content' > "$source_path/alpha.txt"
cp "$source_path/alpha.txt" "$source_path/beta.txt"
restore_destination=$tmp_root/restored
export_destination=$tmp_root/exported

XDG_DATA_HOME="$tmp_root/xdg-data" XDG_CONFIG_HOME="$tmp_root/xdg-config" \
"$cairn_bin" config init --path "$config_path" >/dev/null
env -u CAIRN_API_TOKEN \
-u CAIRN_SEMANTIC_BUNDLE -u CAIRN_IMAGE_BUNDLE \
-u CAIRN_BGE_ONNX_RUNTIME -u CAIRN_BGE_ONNX_MODEL \
-u CAIRN_BGE_TOKENIZER -u CAIRN_ZVEC_LIBRARY \
-u CAIRN_SEMANTIC_BUNDLE_ROOT -u CAIRN_RUN_SUPERVISED_ONNX \
-u ZVEC_LIBRARY_PATH \
CAIRN_CATALOG="$tmp_root/catalog.sqlite" \
CAIRN_REPOSITORY="$tmp_root/repository" \
CAIRN_VECTORS="$tmp_root/vectors" \
CAIRN_MODELS="$tmp_root/models" \
CAIRN_RECOVERY_RECORDS="$tmp_root/recovery" \
"$daemon_bin" --config "$config_path" --socket "$socket_path" --api-listen "$api_listen" --web-root "$web_root" >"$tmp_root/daemon.log" 2>&1 &
daemon_pid=$!

api_base=http://$api_listen
i=0
while ! curl -fsS "$api_base/api/v1/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 80 ] || { echo "daemon did not become ready" >&2; cat "$tmp_root/daemon.log" >&2; exit 1; }
  sleep 0.1
done

web_url=$api_base/
i=0
while ! curl -fsS "$web_url" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 80 ] || { echo "daemon WebUI did not become ready" >&2; cat "$tmp_root/daemon.log" >&2; exit 1; }
  sleep 0.1
done

CAIRN_WEB_E2E_URL="$web_url" \
CAIRN_WEB_E2E_SOURCE="$source_path" \
CAIRN_WEB_E2E_RESTORE_DEST="$restore_destination" \
CAIRN_WEB_E2E_EXPORT_DEST="$export_destination" \
CAIRN_PLAYWRIGHT_MODULE="$playwright_module" \
node scripts/web-e2e.mjs online

cmp -s "$source_path/alpha.txt" "$restore_destination/alpha.txt" || { echo "restored alpha bytes differ" >&2; exit 1; }
cmp -s "$source_path/beta.txt" "$restore_destination/beta.txt" || { echo "restored beta bytes differ" >&2; exit 1; }
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
[ "$(sha256_file "$source_path/alpha.txt")" = "$(sha256_file "$restore_destination/alpha.txt")" ] || { echo "alpha SHA-256 differs" >&2; exit 1; }
[ "$(sha256_file "$source_path/beta.txt")" = "$(sha256_file "$restore_destination/beta.txt")" ] || { echo "beta SHA-256 differs" >&2; exit 1; }
[ -f "$export_destination/alpha.txt" ] || { echo "exported alpha is missing" >&2; exit 1; }
cmp -s "$source_path/alpha.txt" "$export_destination/alpha.txt" || { echo "exported alpha bytes differ" >&2; exit 1; }
[ -f "$export_destination-selected/alpha.txt" ] || { echo "selected export alpha is missing" >&2; exit 1; }
cmp -s "$source_path/alpha.txt" "$export_destination-selected/alpha.txt" || { echo "selected export alpha bytes differ" >&2; exit 1; }

CAIRN_WEB_E2E_URL="$web_url" CAIRN_PLAYWRIGHT_MODULE="$playwright_module" node scripts/web-e2e.mjs offline

kill "$daemon_pid"
wait "$daemon_pid" 2>/dev/null || true
daemon_pid=

env -u CAIRN_API_TOKEN \
-u CAIRN_SEMANTIC_BUNDLE -u CAIRN_IMAGE_BUNDLE \
-u CAIRN_BGE_ONNX_RUNTIME -u CAIRN_BGE_ONNX_MODEL \
-u CAIRN_BGE_TOKENIZER -u CAIRN_ZVEC_LIBRARY \
-u CAIRN_SEMANTIC_BUNDLE_ROOT -u CAIRN_RUN_SUPERVISED_ONNX \
-u ZVEC_LIBRARY_PATH \
CAIRN_CATALOG="$tmp_root/catalog.sqlite" \
CAIRN_REPOSITORY="$tmp_root/repository" \
CAIRN_VECTORS="$tmp_root/vectors" \
CAIRN_MODELS="$tmp_root/models" \
CAIRN_RECOVERY_RECORDS="$tmp_root/recovery" \
"$daemon_bin" --config "$config_path" --socket "$socket_path" --api-listen "$api_listen" --web-root "$web_root" >"$tmp_root/daemon-restarted.log" 2>&1 &
daemon_pid=$!
i=0
while ! curl -fsS "$api_base/api/v1/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 80 ] || { echo "daemon did not recover" >&2; cat "$tmp_root/daemon-restarted.log" >&2; exit 1; }
  sleep 0.1
done
CAIRN_WEB_E2E_URL="$web_url" CAIRN_PLAYWRIGHT_MODULE="$playwright_module" node scripts/web-e2e.mjs recovered

echo "PASS: Cairn daemon/WebUI browser E2E"
