#!/usr/bin/env bash
# Replace the installed cairn/cairnd binaries with a freshly built pair from
# this checkout, the way an operator replaces a package in place: the new
# executables are staged beside the installed ones and renamed over them, so a
# failure before the rename leaves the running installation untouched and no
# moment exists where the path holds a partial binary.
#
# Data directories are never touched. The caller is responsible for the
# CAIRN_* paths and for restarting the service afterwards.
#
# Candidate only. This is the upgrade half of a packaging journey, not a
# release qualification.
#
# usage: offline-upgrade-in-place.sh REPO_ROOT INSTALL_ROOT NEW_VERSION
set -euo pipefail
export LC_ALL=C
umask 077

[[ $# -eq 3 ]] || { echo "usage: $0 REPO_ROOT INSTALL_ROOT NEW_VERSION" >&2; exit 2; }
repo_root="$1"; install_root="$2"; new_version="$3"
[[ "$repo_root" = /* && "$install_root" = /* ]] || { echo "error: REPO_ROOT and INSTALL_ROOT must be absolute" >&2; exit 2; }
[[ -d "$repo_root" && -d "$install_root/bin" ]] || { echo "error: repository or installed bin directory is unavailable" >&2; exit 2; }
[[ "$new_version" =~ ^[A-Za-z0-9._+-]+$ ]] || { echo "error: unsafe version token: $new_version" >&2; exit 2; }
case "$new_version" in *..*) echo "error: unsafe version token: $new_version" >&2; exit 2;; esac

command -v go >/dev/null 2>&1 || { echo "error: go is required" >&2; exit 1; }

build_dir="$(mktemp -d "$install_root/.upgrade.XXXXXX")"
new_bin="$build_dir/cairnd"
new_cli="$build_dir/cairn"
go_version="$(go env GOVERSION)"

# The operator-visible version marker comes from the daemon's own main package
# so the replaced binary can be told apart from the one it replaced without
# trusting a filename.
echo "building replacement binaries from $repo_root"
( cd "$repo_root" && go build -tags purego -ldflags "-X main.buildVersion=$new_version" -o "$new_bin" ./server/cmd/cairnd )
( cd "$repo_root" && go build -tags purego -ldflags "-X main.buildVersion=$new_version" -o "$new_cli" ./client/cmd/cairn )

built_version="$("$new_bin" --version 2>/dev/null | head -1 || true)"
[[ "$built_version" == *"$new_version"* ]] || {
  echo "error: replacement daemon did not report the requested version $new_version (got: ${built_version:-none})" >&2
  rm -rf "$build_dir"
  exit 1
}
"$new_cli" version >/dev/null 2>&1 || "$new_cli" --version >/dev/null 2>&1 || true

chmod 755 "$new_bin" "$new_cli"
# Keep the previous binaries so an operator can roll back a rejected build
# without restoring a backup.
rm -rf "$install_root/bin/previous"
mkdir -p "$install_root/bin/previous"
mv "$install_root/bin/cairnd" "$install_root/bin/previous/cairnd"
mv "$install_root/bin/cairn" "$install_root/bin/previous/cairn"
mv "$new_bin" "$install_root/bin/cairnd"
mv "$new_cli" "$install_root/bin/cairn"
rm -rf "$build_dir"
sync

echo "upgraded: $install_root/bin"
echo "previous: $install_root/bin/previous"
echo "version:  $new_version"
echo "go:       $go_version"
echo "next:     restart cairnd against the existing data directories and re-verify before removing bin/previous"
