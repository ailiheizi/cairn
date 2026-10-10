# Local Development Preview — 2026-10-06

This note describes two Darwin arm64 development workflows: a disposable smoke
of one retained candidate package, and a persistent preview built from the
current checkout. Neither workflow qualifies a release or establishes Linux or
NAS support.

## Disposable candidate smoke

The smoke starts from an existing outer package and binds it by SHA-256 before
extracting or executing either packaged binary. It checks that archive entries
are ordinary files/directories with safe paths, verifies every embedded package
checksum, and confirms the manifest and semantic archive digest. It then uses
fresh temporary config, XDG data, socket, repository, and recovery-reader state
to install the bundled semantic assets without a downloader, restart the
packaged daemon, run a real semantic and lexical query, and restore a generated
small file through the catalog-free reader with an independently exported trust
anchor. The saved evidence records the package hash, portable-reference hash,
trust-anchor hash, and restored SHA-256 and byte length. Generated content is
regression QA, not a representative corpus.

Prerequisites are Python 3.11 or newer, `jq`, `shasum`, and a Darwin arm64 Mac.
The smoke clears ambient Cairn path and bundle overrides for its child
processes and confirms all effective persisted locations resolve beneath its
own temporary root. It also clears ambient `ZVEC_LIBRARY_PATH`; after the
offline bundle is installed, the daemon's digest-admitted binding supplies the
native library path at readiness and generation operations.

The package recorded by [Core Preview Acceptance](core-preview-acceptance-20261005.md)
is historical evidence:

```text
dist/completion-20261005-dD98vk/cairn-20261005-candidate-darwin-arm64.tar.gz
SHA-256: 1b1c238835c43e08c6817a67cbef9819d474f7595261bafb434ec02b677cf111
```

The earlier local continuation candidate is historical evidence:

```text
dist/local-continuation-20261006-QsR18A/cairn-20261006-local-final-darwin-arm64.tar.gz
SHA-256: 953716d9c0273b0bb7ffa6865615fdbb615c75e7b53b945c8b681de929fe20d4
```

Run from the repository root with that exact package digest and a new, empty
evidence directory:

```sh
bash scripts/dev-preview-smoke.sh \
  --artifact "$PWD/dist/local-continuation-20261006-QsR18A/cairn-20261006-local-final-darwin-arm64.tar.gz" \
  --sha256 953716d9c0273b0bb7ffa6865615fdbb615c75e7b53b945c8b681de929fe20d4 \
  --artifacts "$PWD/dist/local-preview-smoke-$(date +%Y%m%d-%H%M%S)"
```

The script refuses an existing evidence directory, keeps command logs and
`result.json` there, and removes its own temporary package extraction, profile,
repository, sockets, and generated source/restore files on exit. An alternate
candidate can be supplied by absolute path with its independently recorded
64-character SHA-256 digest. Its embedded manifest must identify the artifact
as `CANDIDATE_ONLY_NOT_SUPPORTED` for Darwin arm64.

That earlier local run is retained at
`dist/local-continuation-20261006-QsR18A/package-smoke-clean-final/`. It passed
the packaged offline semantic install and restart, real semantic query with one
result, lexical query with one result, and catalog-free restore using the
independently exported trust anchor. The restored file was 89 bytes with
SHA-256
`5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`.
`result.json` records the outer package, recovery-reference, and trust-anchor
digests. The run injected ambient config/storage/model/vector and
`ZVEC_LIBRARY_PATH` overrides; it confirmed effective config paths stayed under
the temporary root and the sentinel override directory was never created. The
smoke leaves `ZVEC_LIBRARY_PATH` unset for both daemon starts; Cairn
loads the admitted library from the persisted bundle binding.

`bash -n` passed. Safety probes rejected a bad outer digest before extraction,
a hostile manifest layout before following its package paths, and a traversal
entry before it could write outside the extraction root. Early smoke attempts
exposed harness issues including incorrect semantic/lexical CLI dimension IDs,
editing one script while its shell was still running, an uncanonicalized macOS
temp path, and an overlong recovery-reader socket path. One earlier isolated
no-launcher-env attempt also returned a degraded fixture-provider query, but its
saved output did not include a native-loader cause. The same artifact passed a
fresh rerun with launcher binding disabled and the current smoke script passed
with ambient `ZVEC_LIBRARY_PATH` cleared. The earlier discrepancy remains
unresolved and is not evidence of a required launcher override or a confirmed
product defect.

## Earlier FD-fixed continuation candidate

This earlier candidate contains the bounded 8 MiB inspector, proportionate image
layout, FD ownership repairs, and unchanged Unicode data with its notice. The
older candidate and smoke above remain historical evidence.

```sh
bash scripts/dev-preview-smoke.sh \
  --artifact "$PWD/dist/all-completion-20261006/integration/cairn-20261006-local-fd-fixed-darwin-arm64.tar.gz" \
  --sha256 c277dc8184cff4e1e71bde84b9b6b3f95e4a38d99cd6394f8415d7e04427a41f \
  --artifacts "$PWD/dist/local-fd-fixed-smoke-$(date +%Y%m%d-%H%M%S)"
```

The exact candidate passed offline real semantic and lexical queries plus an
independent-anchor catalog-free restore of 89 bytes, digest
`5060f8d7a5987ed4452a9cc4f84eb41697d08bc307ec1140888f466e64137a4a`.
It carries `licenses/Unihan.LICENSE.txt` verbatim under its checksum manifest.
See `dist/all-completion-20261006/integration/package-fd-fixed-smoke/result.json`.
This is a local candidate trial, not supported packaging or release admission.

## Current retrieval and accounting candidate

The updated daemon repairs lexical source explanations while preserving the
existing client assets, recovery formats and index profile. The earlier
candidate remains historical evidence.

```sh
bash scripts/dev-preview-smoke.sh \
  --artifact "$PWD/dist/retrieval-accounting-20261006/cairn-20261006-retrieval-accounting-darwin-arm64.tar.gz" \
  --sha256 e150d7f8b391d23ccbe7bee1a8f469b7b27bbdd219a52fcf284f227ef1d4570c \
  --artifacts "$PWD/dist/local-retrieval-smoke-$(date +%Y%m%d-%H%M%S)"
```

The exact candidate passed offline real semantic/lexical queries and
independent-anchor catalog-free restore; see
`dist/retrieval-accounting-20261006/package-smoke/result.json` and
[retrieval and accounting acceptance](retrieval-and-accounting-acceptance-20261006.md).
It remains candidate-only and not release-qualified.

## Persistent local preview

For a preview that retains data between runs, use an explicit new absolute data
directory. The source-build workflow below builds the daemon, CLI, and browser
client from the current checkout. Use the supplied-package workflow below when
the trial must bind to a specific candidate artifact and hash.

```sh
mkdir -p "$HOME/Cairn-Preview/data"
env -u CAIRN_CONFIG -u CAIRN_CATALOG -u CAIRN_REPOSITORY \
  -u CAIRN_VECTORS -u CAIRN_MODELS -u CAIRN_RECOVERY_RECORDS \
  -u CAIRN_SEMANTIC_BUNDLE -u CAIRN_IMAGE_BUNDLE -u ZVEC_LIBRARY_PATH \
  sh scripts/run-local.sh \
  --data-dir "$HOME/Cairn-Preview/data" \
  --listen 127.0.0.1:4538
```

Open [http://127.0.0.1:4538/](http://127.0.0.1:4538/). The script creates
`config.toml` under the selected data directory on first run; configured
catalog, repository, semantic bundle, vector, and recovery locations remain
persistent there according to that profile. Stop the foreground process with
Ctrl-C and rerun the same command to reopen that preview. The server refuses an
occupied loopback address and does not stop the process using it.

For an unpacked candidate package, set `PACKAGE` to its extracted package root
and `DATA` to a new persistent absolute directory, then launch its supplied
binaries and WebUI:

```sh
PACKAGE="$PWD/dist/extracted/cairn-candidate-darwin-arm64"
DATA="$HOME/Cairn-Candidate/data"
mkdir -p "$DATA"
XDG_DATA_HOME="$DATA" "$PACKAGE/bin/cairn" config init --path "$DATA/config.toml"
env -u CAIRN_CONFIG -u CAIRN_CATALOG -u CAIRN_REPOSITORY \
  -u CAIRN_VECTORS -u CAIRN_MODELS -u CAIRN_RECOVERY_RECORDS \
  -u CAIRN_SEMANTIC_BUNDLE -u CAIRN_IMAGE_BUNDLE -u ZVEC_LIBRARY_PATH \
  "$PACKAGE/bin/cairnd" --config "$DATA/config.toml" \
  --socket "$DATA/cairnd.sock" --api-listen 127.0.0.1:4538 \
  --web-root "$PACKAGE/web/dist"
```

In another terminal, install the retained bundle through the packaged CLI, then
stop and restart the foreground daemon before searching semantically:

```sh
"$PACKAGE/bin/cairn" --socket "$DATA/cairnd.sock" semantic bundle install \
  --archive "$PACKAGE/semantic/semantic-bundle.tar.gz"
```

This route uses the supplied offline bundle and performs no model or runtime
download. It keeps the candidate daemon, CLI, browser assets, and semantic
archive bound to the package hash chosen for the trial.

Restart the daemon with the same command and config shown above. The host
resolves the zvec library from the admitted installed bundle; no
`ZVEC_LIBRARY_PATH` override is needed.

In Settings > Appearance, select Workspace or Content showcase to change the
whole interface composition; palette and light/dark choices are separate. For
content, choose one local file, review its exact identity and `STORE_EXACT`
plan, explicitly save it, search for it, and download the retained original.
The clean-reader smoke separately verifies restoration into an empty directory.
These are useful local workflows; their presence does
not prove representative collection recall, production storage savings, or a
release-supported install path. For the source-build workflow, the development
semantic installer uses pinned assets but may need network access to fetch
them. Stop and restart the daemon after installation before checking provider
status and rebuilding or querying the semantic index.

## Current running QA preview

The existing local QA profile is running at
[http://127.0.0.1:4648/](http://127.0.0.1:4648/). It uses the current retained
retrieval-fixed daemon binary and the built `index-Cz9x7w2c.js` / `index-Bd8xrHY8.css` assets,
while preserving its original persisted catalog, repository, and annotations.
The retained offline semantic archive was installed into that profile's models
path. Startup with ambient path/bundle and generic zvec overrides removed,
browser-triggered search rebuild, and a real semantic query passed. Settings
shows the provider installed/running and semantic search ready. Incomplete
lexical field coverage and historical exhausted processor attempts remain
visible; this does not rewrite terminal attempts or claim complete discovery.

Full-byte snapshot verification passed for all three QA files (4,179 bytes)
without the catalog. Snapshot/content identity and durable annotations were
checked unchanged before recording that new verification receipt. The three
tiny PNG/Markdown/WAV subjects remain generated QA content, not a representative
library. Current runtime identity, served asset hashes, query and verification
results, and actual in-app-browser screenshots are retained in
`dist/local-continuation-20261006-QsR18A/live-preview/` for the initial run.
The previous runtime and browser screenshot are in
`dist/all-completion-20261006/integration/`. Current runtime identity, equal
annotation/description data, served asset hashes, real default-broker query,
and full-byte verification are in `dist/retrieval-accounting-20261006/live/`.
The current daemon SHA-256 is
`4196d63d2230b8151fc307fd9847f024de54dbf6148cae39a4d2e60200cedf46`.
Its query-source fixes and exact candidate smoke are recorded in
[retrieval and accounting acceptance](retrieval-and-accounting-acceptance-20261006.md).
The earlier listener failure and its ownership fixes are
recorded in [local continuation acceptance](local-completion-acceptance-20261006.md).

If this preview stops, run `sh dist/client-appearance-20261006/start-preview.sh`
from the repository root. The launcher keeps this profile, runs in the foreground,
and refuses an occupied address without stopping another process. Its
`dist/client-appearance-20261006/README.md` describes the exact retained paths.
Use the persistent workflow above for a separate library rather than deleting
or resetting this profile.

## Evidence boundary

The outer archive is a candidate assembled from supplied binaries and a
retained semantic bundle. Its manifest remains `CANDIDATE_ONLY_NOT_SUPPORTED`
and its SBOM remains `INCOMPLETE_NOT_RELEASE_SBOM`. Third-party redistribution
review and supported-host qualification remain open. The current configured
repository profile is `directory-cas-dev-v1`; passing the local exact recovery
smoke does not select a release repository or qualify Linux/NAS behavior.

This local trial advances development packaging evidence only. The independent
trust-anchor reader and exact-byte restore exercise a concrete recovery path on
this Mac. Linux/NAS host compatibility, failure-domain, scale, concurrency,
resource, and release gates require their own evidence under the normative
qualification contracts.
