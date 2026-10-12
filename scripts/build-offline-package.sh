#!/usr/bin/env bash
# Build one candidate offline package from this checkout by using the same
# operator packaging path that scripts/package-offline.sh defines.
#
# Candidate only. A package assembled here is not a supported or
# release-qualified distribution; see docs/technical/operator-install-backup-upgrade.md.
#
# usage: build-offline-package.sh --version VERSION [--out DIR] [--semantic-bundle DIR]
#
# Required for a complete, installable package:
#   A retained, already admitted pinned semantic bundle directory, or a
#   pre-assembled archive. Without it this script still builds the CLI and
#   daemon but refuses to package, because scripts/package-offline.sh requires
#   the semantic member. Never download a model to satisfy this step.
set -euo pipefail
export LC_ALL=C
export TZ=UTC
umask 077

usage() {
  echo "usage: $0 --version VERSION [--out DIR] [--semantic-bundle DIR] [--semantic-archive FILE] [--web-dist DIR]" >&2
}

version=""; out_dir=""; semantic_bundle=""; semantic_archive=""; web_dist=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) version="${2:-}"; shift 2;;
    --out) out_dir="${2:-}"; shift 2;;
    --semantic-bundle) semantic_bundle="${2:-}"; shift 2;;
    --semantic-archive) semantic_archive="${2:-}"; shift 2;;
    --web-dist) web_dist="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) usage; exit 2;;
  esac
done
[[ -n "$version" ]] || { usage; exit 2; }
[[ "$version" =~ ^[A-Za-z0-9._+-]+$ ]] || { echo "error: unsafe version token: $version" >&2; exit 2; }
[[ -n "$out_dir" ]] || out_dir="$(mktemp -d "${TMPDIR:-/tmp}/cairn-offline-build.XXXXXX")"
[[ "$out_dir" = /* ]] || { echo "error: --out must be absolute" >&2; exit 2; }
mkdir -p "$out_dir/bin"
out_dir="$(cd "$out_dir" && pwd -P)"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v go >/dev/null 2>&1 || { echo "error: go is required" >&2; exit 1; }

# The daemon must carry the in-process zvec backend; scripts/package-offline.sh
# independently re-checks -tags=purego and the pinned zvec-go digest.
echo "building daemon and CLI with -tags purego"
( cd "$repo_root" && go build -tags purego -o "$out_dir/bin/cairnd" ./server/cmd/cairnd )
( cd "$repo_root" && go build -tags purego -o "$out_dir/bin/cairn" ./client/cmd/cairn )

if [[ -z "$web_dist" ]]; then
  web_dist="$repo_root/web/dist"
fi
[[ -f "$web_dist/index.html" ]] || {
  echo "error: WebUI assets are unavailable at $web_dist" >&2
  echo "hint: run 'npm --prefix web run build' in the checkout first" >&2
  exit 2
}

if [[ -z "$semantic_archive" ]]; then
  [[ -n "$semantic_bundle" ]] || {
    echo "error: a retained admitted semantic bundle is required to package" >&2
    echo "hint: pass --semantic-bundle DIR (an already admitted pinned bundle) or --semantic-archive FILE" >&2
    exit 2
  }
  [[ -d "$semantic_bundle" ]] || { echo "error: semantic bundle directory is unavailable: $semantic_bundle" >&2; exit 2; }
  semantic_archive="$out_dir/semantic-bundle.tar.gz"
  echo "assembling candidate semantic archive from $semantic_bundle"
  ( cd "$repo_root" && go run ./server/internal/releasequal/cmd/semantic-bundle-archive \
      --source "$semantic_bundle" --output "$semantic_archive" )
fi
[[ -f "$semantic_archive" ]] || { echo "error: semantic archive is unavailable: $semantic_archive" >&2; exit 2; }

package="$out_dir/cairn-$version-$(go env GOOS)-$(go env GOARCH).tar.gz"
# The assembler refuses to overwrite, so remove only our own previous output.
rm -f "$package"
bash "$repo_root/scripts/package-offline.sh" \
  --version "$version" \
  --os "$(go env GOOS)" \
  --arch "$(go env GOARCH)" \
  --cairn "$out_dir/bin/cairn" \
  --daemon "$out_dir/bin/cairnd" \
  --web-dist "$web_dist" \
  --semantic-archive "$semantic_archive" \
  --output "$package"
echo "package: $package"
