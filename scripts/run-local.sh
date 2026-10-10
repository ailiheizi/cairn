#!/bin/sh
set -eu

usage() {
  echo "usage: $0 --data-dir ABSOLUTE_DIR [--listen 127.0.0.1:4538]" >&2
  exit 2
}

data_dir=
listen=127.0.0.1:4538
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data-dir) [ "$#" -ge 2 ] || usage; data_dir=$2; shift 2 ;;
    --listen) [ "$#" -ge 2 ] || usage; listen=$2; shift 2 ;;
    -h|--help) usage ;;
    *) echo "error: unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$data_dir" ] || { echo "error: --data-dir is required" >&2; usage; }
case "$data_dir" in
  /*) ;;
  *) echo "error: --data-dir must be an absolute path" >&2; exit 2 ;;
esac
case "$listen" in
  127.0.0.1:*) port=${listen#127.0.0.1:} ;;
  *) echo "error: --listen must be a loopback 127.0.0.1:PORT address" >&2; exit 2 ;;
esac
case "$port" in
  ''|*[!0-9]*) echo "error: --listen has an invalid port: $port" >&2; exit 2 ;;
esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { echo "error: --listen port must be 1..65535" >&2; exit 2; }

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

# curl 7 is "failed to connect" (port free). HTTP success, empty reply,
# timeout, or any other handshake means the address is already in use.
listen_status=0
curl -sS --max-time 1 -o /dev/null "http://$listen/" >/dev/null 2>&1 || listen_status=$?
if [ "$listen_status" -ne 7 ]; then
  echo "error: listen address is occupied: $listen (no process was stopped)" >&2
  exit 1
fi

# Reject an occupied listener before checking build dependencies or creating
# data paths. This safety gate also works on a host that cannot build the UI.
command -v go >/dev/null 2>&1 || { echo "error: go is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm is required" >&2; exit 1; }

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd -P)
mkdir -p "$data_dir/bin"
config_path=$data_dir/config.toml
socket_path=$data_dir/restoreweaved.sock

echo "RestoreWeave: building daemon, CLI, and WebUI..."
( cd "$repo_root" && go build -tags purego -o "$data_dir/bin/restoreweaved" ./server/cmd/restoreweaved )
( cd "$repo_root" && go build -tags purego -o "$data_dir/bin/rw" ./client/cmd/rw )
[ -d "$repo_root/web/node_modules" ] || npm --prefix "$repo_root/web" ci >/dev/null
npm --prefix "$repo_root/web" run build >/dev/null

# Config init is the only writer of a new profile. XDG_DATA_HOME makes every
# generated default path deterministic below --data-dir; an existing profile
# is never rewritten and its persisted paths remain authoritative.
if [ ! -e "$config_path" ]; then
  ( cd "$repo_root" && XDG_DATA_HOME=$data_dir "$data_dir/bin/rw" config init --path "$config_path" )
fi

web_root=$repo_root/web/dist
[ -f "$web_root/index.html" ] || { echo "error: WebUI build did not produce $web_root/index.html" >&2; exit 1; }
echo "RestoreWeave: serving WebUI and API at http://$listen/"
echo "RestoreWeave: data root $data_dir"
echo "RestoreWeave: running in foreground; press Ctrl-C to stop"

# Do not let ambient one-shot path overrides silently redirect an existing
# persisted profile. API token and proxy variables remain inherited naturally.
exec env -u RESTOREWEAVE_CATALOG -u RESTOREWEAVE_REPOSITORY \
  -u RESTOREWEAVE_VECTORS -u RESTOREWEAVE_MODELS -u RESTOREWEAVE_RECOVERY_RECORDS \
  "$data_dir/bin/restoreweaved" --config "$config_path" --socket "$socket_path" \
  --api-listen "$listen" --web-root "$web_root"
