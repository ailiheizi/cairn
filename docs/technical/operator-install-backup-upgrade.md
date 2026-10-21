# Operator Installation, Backup, Restore, and Upgrade

> **Status:** candidate operator procedure, executed 2026-10-12 on Darwin arm64.
> Every command in this document was run against a **candidate** offline package
> assembled by `scripts/package-offline.sh`; the full transcript is the
> acceptance log produced by `scripts/accept-offline-journey.sh`. This document
> is informative operator guidance. It does not qualify a release, does not
> select a production repository engine, and does not close any phase gate.
>
> **Current build-tag guidance:** the transcript below is historical evidence
> for the source and package that were run on 2026-10-12. Current source builds
> and `scripts/package-offline.sh` require exactly `-tags=cairn_zvec_dynamic`
> for the daemon so the custom zvec loader is selected without disabling Go's
> SHA assembly. Do not reinterpret or rewrite the historical command record as
> evidence that the current source was rebuilt.

## 1. What this procedure is, and what it is not

It answers the two questions an operator actually asks:

1. **Where is my data?** Section 3 lists every durable location and who owns it.
2. **Does it survive an upgrade?** Sections 6 and 7 are executed upgrade and
   restore paths with real exit codes.

What it is **not**:

- **Not a release-qualified distribution.** The package is
  `CANDIDATE_ONLY_NOT_SUPPORTED`; its top-level `SBOM.json` is
  `INCOMPLETE_NOT_RELEASE_SBOM`.
- **Not a production storage-engine decision.** This procedure runs the
  **development directory profile** `directory-cas-dev-v1` +
  `identity-v1`. The normative content-store contract calls that profile a
  development and test driver: it "does not qualify as the release default
  merely because exact restore tests pass". No production repository engine has
  been selected; Kopia v0.23.1 leads a still-pending qualification spike, and
  the dated release-engine decision is separate reviewed work. Do not read this
  document as a statement that the storage engine is production-qualified.
- **Not full release acceptance.** Performance bounds, broad platform
  qualification, and the complete `RW-MVP-1` corpus remain open.

## 2. Building the candidate package

The packaging path is the repository's own `scripts/package-offline.sh`. The
convenience wrapper builds the two Go binaries, stages the WebUI assets, and
calls that script:

```sh
cd <checkout>
npm --prefix web run build                     # if web/dist is stale
bash scripts/build-offline-package.sh \
  --version candidate-1 \
  --out /tmp/cairn-pkg \
  --semantic-bundle /path/to/an/already/admitted/pinned/bundle
```

The wrapper refuses to package without a retained semantic bundle. **Never
download a model to satisfy this step**; supply an already admitted bundle or a
pre-assembled archive with `--semantic-archive`.

The package is a gzipped tar whose top directory is
`cairn-<version>-<os>-<arch>`:

| Member | What it is |
| --- | --- |
| `bin/cairnd` | The daemon in the executed 2026-10-12 package. Current source packaging requires exactly `-tags=cairn_zvec_dynamic`; `package-offline.sh` verifies that tag and the pinned `zvec-go` digest from BuildInfo. |
| `bin/cairn` | The CLI. |
| `web/dist/**` | The pre-built WebUI. Pass it to the daemon with `--web-root`. |
| `semantic/semantic-bundle.tar.gz` | The offline embedding bundle. The daemon never downloads one. |
| `licenses/**`, `LICENSE`, `NOTICE` | License evidence, including the pinned third-party semantic bundle. |
| `manifest.json`, `SBOM.json`, `checksums.sha256` | Candidate manifest, deliberately incomplete SBOM, and per-file SHA-256. |

Verify the package before trusting it:

```sh
mkdir -p /tmp/cairn-run/pkg
python3 - <<'PY'
import tarfile, os
# a deterministic extractor that refuses absolute or escaping members
PY
( cd /tmp/cairn-run/pkg/cairn-candidate-1-<os>-<arch> && shasum -a 256 -c checksums.sha256 )
```

`scripts/accept-offline-journey.sh` performs exactly this check and prints every
file it extracted. In the executed run all members verified `OK`.

## 3. Where every durable thing lives

Create **one directory per instance** and point the seven explicit paths into
it. Nothing is inferred from the process working directory.

```sh
DATA=/srv/cairn                      # one instance's directory
export CAIRN_CONFIG=$DATA/config.toml
export CAIRN_CATALOG=$DATA/catalog.sqlite
export CAIRN_REPOSITORY=$DATA/repository
export CAIRN_VECTORS=$DATA/vectors
export CAIRN_MODELS=$DATA/models
export CAIRN_RECOVERY_RECORDS=$DATA/recovery
export CAIRN_SOCKET=$DATA/cairnd.sock
```

| Path | Contents | Backup rule |
| --- | --- | --- |
| `CAIRN_CONFIG` (`config.toml`) | The operator's persisted profile: paths, repository tuple, protection default, embedding profile, recovery policy. | Back up. It is the map to everything else. |
| `CAIRN_REPOSITORY` | Exact payloads and the signed portable records: `prepared`/`commits` closures, `snapshots/`, blob CAS, `repository.identity`, `repository.profile`. | **Recovery-critical.** This plus the recovery reference and trust anchor is the recovery authority. |
| `CAIRN_RECOVERY_RECORDS` | `publication-signing-identity.json` (private Ed25519 key) and `publication-trust-anchor.json` (public key). | **Security-critical.** The private identity signs new publications; the public anchor verifies old ones. Keep the private key secret, and retain the public anchor **independently** of the repository. |
| `CAIRN_CATALOG` | SQLite operational catalog: subjects, namespace roots/entries, publications, plans, annotations, descriptions, and rebuildable search tables. | Back up **quiesced** (section 5). The target architecture treats it as rebuildable, but the current checkout has no catalog-rebuild command, so a lost catalog currently costs the ordinary `content list`/`restore` projections even though exact bytes stay recoverable through section 6. |
| `CAIRN_VECTORS` | zvec generations. | Disposable and rebuildable. Excluding them only costs a semantic index rebuild. |
| `CAIRN_MODELS` | The installed pinned semantic bundle. | Not durable user data; it is a redistributable component. Reinstall it instead of restoring it. |
| `CAIRN_SOCKET` | The Unix control socket. | Runtime only. |

**Consequence of forgetting the recovery records rather than the repository:**
the private signing identity is only needed to publish *new* content. The
**public trust anchor** is needed to *verify and restore existing* content. A
repository restored without the anchor is not trustable: in the executed run,
`cairn recovery import <reference> <absent-anchor-path>` against a live daemon
exited **1** without admitting the record, and a structurally valid anchor with
one flipped public-key bit exited **4**. Back up the anchor, and keep a copy off
the machine that holds the repository.

## 4. First start on a clean host

```sh
# 1. create the profile inside the instance directory (refuses to overwrite)
export CAIRN_CONFIG=$DATA/config.toml
cairn config init --path "$CAIRN_CONFIG"
cairn config validate
cairn config show --effective

# 2. start the daemon
cairnd \
  --config "$CAIRN_CONFIG" \
  --socket "$CAIRN_SOCKET" \
  --web-root /opt/cairn/web/dist &
```

`cairnd` requires a config that already exists: it will not invent one at a
platform default, precisely so a mistyped path cannot create a second
catalog/repository in an unexpected location. `cairnd --version` prints the
installed build identity without opening a catalog, repository, or config, and
is the command to use before and after an upgrade. `cairn --version` does the
same for the CLI.

Verify the instance is empty and healthy:

```sh
cairn --socket "$CAIRN_SOCKET" --json status          # publications=0, catalog.ok=true
cairn --socket "$CAIRN_SOCKET" --json snapshot list   # no snapshots
```

In the executed clean-host install the daemon answered `status.get` with
`publications=0` and the resolved catalog inside the instance directory.

### Installing the bundled semantic profile (optional member)

The default profile points at a local embedding bundle. Install it from the
package once, then restart:

```sh
cairn --socket "$CAIRN_SOCKET" --json semantic bundle install \
  --archive <package>/semantic/semantic-bundle.tar.gz
# restart cairnd; the bundle is unpacked under $CAIRN_MODELS/<profile>/<os>-<arch>
```

Exact lexical and structured search, exact protection, backup, restore, and
upgrade do **not** depend on this member. Without it, semantic queries report an
honest degraded state; they are never silently answered from fixtures.

## 5. Backing up

The repository is the recovery authority; the catalog is a projection. Back up
both, quiesced.

```sh
# 1. export the signed recovery reference and the public trust anchor
cairn --socket "$CAIRN_SOCKET" --json recovery export  <snapshot-ref> /backup/reference.json
cairn --socket "$CAIRN_SOCKET" --json recovery anchor export           /backup/trust-anchor.json

# 2. stop the writer. SQLite runs in WAL mode and the .sqlite file is NOT the
#    whole database while a writer is live.
cairnd_stop            # SIGINT/SIGTERM, wait for exit

# 3. copy the durable set
tar -C "$DATA" -czf /backup/cairn-durable.tar.gz \
  config.toml catalog.sqlite repository recovery vectors models

# 4. keep /backup/reference.json and /backup/trust-anchor.json OFF this host
```

**This is a real, measured hazard, not a theoretical one.** In the executed
run, before the stop the catalog's `catalog.sqlite-wal` sidecar held
**1,005,312 bytes** and a copy of only `catalog.sqlite` reported **0**
publications; after a clean daemon stop the WAL was checkpointed to **0 bytes**
and the same copy reported **1** publication. Copying a live `catalog.sqlite`
without its `-wal`/`-shm` sidecars silently loses committed catalog rows.

If you must back up a live instance, use SQLite's own consistent copy
(`sqlite3 "$CAIRN_CATALOG" ".backup /backup/catalog.sqlite"`) or a filesystem
snapshot, and copy the repository as well. Stopping the daemon is the simplest
correct procedure and is what this run executed.

`paths.recovery_records` is the destination for signed backup/export artifacts;
it is not a second live metadata database. Do not treat `vectors/` as recovery
authority.

## 6. Verifying a restore instead of trusting it

A backup that has not been restored elsewhere is not a backup. Restore into a
**second, empty** instance directory:

```sh
DATA2=/srv/cairn-restored
mkdir -p "$DATA2"
tar -C "$DATA2" -xzf /backup/cairn-durable.tar.gz

# rewrite the absolute paths your original config recorded
sed -i "s|$DATA|$DATA2|g" "$DATA2/config.toml"

export CAIRN_CONFIG=$DATA2/config.toml
export CAIRN_CATALOG=$DATA2/catalog.sqlite
export CAIRN_REPOSITORY=$DATA2/repository
export CAIRN_VECTORS=$DATA2/vectors
export CAIRN_MODELS=$DATA2/models
export CAIRN_RECOVERY_RECORDS=$DATA2/recovery
export CAIRN_SOCKET=$DATA2/cairnd.sock
cairnd --config "$CAIRN_CONFIG" --socket "$CAIRN_SOCKET" &
```

Then prove three separate things.

### 6.1 The catalog projection is intact

```sh
cairn --json content list --workspace <workspace-id>   # same entry count
cairn --json snapshot list                             # same snapshot ref
cairn --json snapshot verify <snapshot-ref> --mode full-bytes
```

Executed result: 4 of 4 entries, `ok=true files=4 bytes=234`.

### 6.2 The same exact bytes come back

```sh
cairn --json restore <snapshot-ref> /tmp/restored
cairn --json plan apply <plan-id> --workspace <workspace-id> --digest <plan-digest>
( cd /tmp/restored && shasum -a 256 $(find . -type f | sort) ) > restored.sha256
diff original.sha256 restored.sha256
```

Executed result: the restored-from-backup manifest was **byte-identical** to
the original source manifest; `diff` exited 0.

### 6.3 The recovery records verify without any catalog at all

This is the recovery-authority path: the repository plus the independently
retained trust anchor, **no SQLite, no signing key**. Start the catalog-free
reader:

```sh
cairnd --socket /tmp/recovery/cairnd.sock \
  --recovery-reader \
  --repository "$DATA2/repository" \
  --recovery-reference /backup/reference.json \
  --trust-anchor /backup/trust-anchor.json &

export CAIRN_SOCKET=/tmp/recovery/cairnd.sock
cairn --json recovery import /backup/reference.json /backup/trust-anchor.json
cairn --json snapshot verify <snapshot-ref> --mode clean-recovery
cairn --json restore <snapshot-ref> /tmp/restored-from-recovery
cairn --json plan apply <plan-id> --workspace <workspace-id> --digest <plan-digest>
```

The recovery reader answers `capability list`, `recovery import`,
`snapshot list/diff/verify`, `plan restore`, and `plan apply`; it deliberately
implements no `status.get` and never opens SQLite or signing material.

Executed result: `recovery import` reported
`catalog_created=false files=4 bytes=234`; the restored bytes from this path
were again byte-identical to the original. Four negative controls all failed
closed: an absent anchor exited **1**, a tampered anchor (one flipped
public-key bit) exited **4**, a *structurally valid anchor for a different
Ed25519 identity* exited **4** — which is the control that shows the retained
anchor is genuinely the trust root and not merely a file whose presence is
accepted — and an absent reference exited **4**.

**Honest gap.** The reader verifies and restores, but it does not repopulate the
operational catalog. After a repository-only restore, ordinary `content list`
and catalog-backed `restore` remain empty until the catalog is restored from a
backup or the operator uses the recovery-reader path. A signed "rebuild the
catalog projections from committed publications" command does **not** exist in
this checkout. Because of that, treat the catalog as **not yet disposable** and
back it up (section 5).

## 7. Upgrading in place

```sh
# 1. keep the installed pair and stop the daemon
cp -a /opt/cairn/bin /opt/cairn/bin.previous
cairnd_stop

# 2. build and swap the replacement pair from the checkout
bash scripts/offline-upgrade-in-place.sh <checkout> /opt/cairn <new-version>
#    staged build -> verify the replacement reports <new-version> -> move the
#    old pair to bin/previous -> rename the new pair into bin/

# 3. restart against the SAME data directories
cairnd --config "$CAIRN_CONFIG" --socket "$CAIRN_SOCKET" &
```

The upgrade helper never touches data directories, keeps the replaced pair at
`bin/previous/` for rollback, and refuses to install a binary that does not
report the requested version.

Re-verify after the upgrade, on the existing data:

```sh
cairnd --version                                        # new build identity
cairn --json status                                     # catalog schema_state=CURRENT
cairn --json content list --workspace <workspace-id>    # same entry count
cairn --json search <known-token> --workspace <workspace-id>
cairn --json snapshot verify <snapshot-ref> --mode full-bytes
cairn --json recovery import /backup/reference.json /backup/trust-anchor.json
cairn --json restore <snapshot-ref> /tmp/after-upgrade  # + plan apply
```

Executed result: daemon identity changed
`cairnd v0.1.0-prealpha...dc34fc39` → `cairnd offline-upgrade-v2`
(the binary SHA-256 changed as well); the catalog reopened
`schema_state=CURRENT schema_version=27`; the entry count stayed 4; full-byte
verification passed; `recovery import` still authenticated 4 files; and the
restored bytes were still byte-identical to the original. Nothing had to
migrate.

### What an operator upgrading from an earlier build must know

- **No catalog migration was required.** The upgraded daemon opened the
  existing catalog as `CURRENT` with the same schema version and binary
  version. That is evidence for this upgrade pair; it is not a general promise.
  A future binary that raises the schema version must be qualified against this
  same restart-and-reverify sequence, and the process must be stopped before the
  swap so no in-flight write straddles it.
- **Back up before upgrading.** The helper keeps the previous binaries for
  rollback of the *software*, but no in-place data rollback exists.
- **A very large publication needs a new binary.** An older binary (before the
  part-bound publication change) refuses a record split into parts rather than
  misreading it. If your repository holds such a publication, the older binary
  cannot read it; upgrade the reader, not the data. This run's small corpus did
  **not** exercise that path (it never exceeded the 16 MiB logical-record
  bound), so it is reported as a known hazard, not as executed evidence.
- **The trust anchor is version-independent.** It keeps verifying old
  publications after the swap; do not regenerate it during an upgrade.

## 8. What was executed, and what was not

Executed 2026-10-12 on Darwin arm64 by `scripts/accept-offline-journey.sh`
against a candidate package:

- clean-host install into a never-used prefix, empty catalog, healthy daemon;
- optional packaged semantic bundle install plus restart, with a real semantic
  query (`query_provider_ref=query.semantic.onnx-bge-zvec.v1`, 7 hits, matched
  segment from the described content);
- ingest, publish, count, lexical and Chinese search, full-byte verification;
- the same journey without the semantic bundle exits 0 on the honest degraded
  path (`Chinese search status=DEGRADED hits=1 exit=5`) with every backup,
  restore, and upgrade step still passing;
- quiesced backup, restore into a second fresh prefix with byte-identical
  output, and a catalog-free recovery-authority restore;
- negative controls: absent anchor (exit 1), tampered anchor (exit 4),
  anchor from a different signing identity (exit 4), absent reference (exit 4);
- in-place upgrade on the existing data with all post-checks passing;
- the operator's real `~/.local/share/cairn` and `~/.config/cairn` confirmed
  absent before and after.

Not executed or not covered:

- a released artifact from an earlier build (the upgrade baseline is a
  same-source rebuild with an injected version);
- the part-bound-record compatibility hazard above;
- a catalog rebuild from signed publications (no such command exists);
- production repository qualification, performance bounds, and non-Darwin
  hosts.
