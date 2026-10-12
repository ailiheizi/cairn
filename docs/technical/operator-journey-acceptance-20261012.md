# Operator-Journey Acceptance Record — 2026-10-12

> Candidate execution evidence for the install, backup, restore, and in-place
> upgrade journey described in
> [operator-install-backup-upgrade.md](operator-install-backup-upgrade.md).
> It is not release qualification and does not select a production repository
> engine.

## What was run

- Host: Darwin arm64, `go1.26.5`.
- Package: built from this checkout by `scripts/build-offline-package.sh`
  (`--version journey-v1`), which builds both binaries with `-tags purego` and
  calls the existing `scripts/package-offline.sh`. The artifact is
  `cairn-journey-v1-darwin-arm64.tar.gz`, 102,083,062 bytes, declared
  `CANDIDATE_ONLY_NOT_SUPPORTED` / `INCOMPLETE_NOT_RELEASE_SBOM`.
- Semantic member: a retained, already admitted pinned `bge-small-zh-v1.5`
  bundle, re-packaged as a candidate archive; **no model or runtime was
  downloaded**.

```sh
bash scripts/accept-offline-journey.sh \
  --package /tmp/cairn-journey/pkgbuild/cairn-journey-v1-darwin-arm64.tar.gz \
  --work    /tmp/cairn-journey/EVIDENCE \
  --semantic /tmp/cairn-journey/build/semantic-bundle.tar.gz
```

Script revision under test:

| Script | SHA-256 |
| --- | --- |
| `scripts/accept-offline-journey.sh` | `a5afda609dd2cd09530543f98edb53a9afbd0559a760b878d6858e9f2df1e6ed` |
| `scripts/build-offline-package.sh` | `d0ea4bcb88d5f190b612c71ac04eb9296cb61653939e0d941d87f1cd82f62294` |
| `scripts/offline-upgrade-in-place.sh` | `2b7f84f837c4efd8f876662d8bbbe769c4bcd3d9d714b2161344777ee5ac3364` |

Result: `RESULT: PASS (no blockers)`, harness exit **0**, every command's real
exit code printed inline, `environment guard violations: 0`.

The same command without `--semantic` also exits **0**. It is the honest
degraded path: `Chinese search status=DEGRADED hits=1 exit=5` — the fused
broker reports the missing semantic lane as a degraded status while the lexical
lane still returns the subject — and every backup, restore, and upgrade step
still passes.

## Key observed results

Package extraction and checksums (step 3-4):

- all 20 members extracted and every line of `checksums.sha256` verified `OK`;
- `bin/cairnd`, `bin/cairn`, `web/dist/**`, `semantic/semantic-bundle.tar.gz`,
  `licenses/**`, `manifest.json`, `SBOM.json`.

Clean-host install (steps 6-9):

- fresh catalog: `publications=0`;
- resolved catalog inside the prefix: yes;
- repository profile `directory-cas-dev-v1`, compression `identity-v1`;
- declared profiles: `default_protection=STORE_EXACT`, `embedding_mode=local`,
  `local_profile=bge-small-zh-v1.5`, `vector_backend=zvec`,
  `publication_signing=local-ed25519-v1`;
- semantic provider before the bundle install:
  `UNAVAILABLE query.semantic.fixture.v1` (honest no-bundle state);
- packaged `semantic bundle install` reported
  `profile=bge-small-zh-v1.5 restart_required=true`.

First content and discovery (steps 10-16):

- `content list items: 4 (expected 4)`;
- lexical search surfaced the file, Chinese search exited 0;
- description revision created;
- `snapshot verify --mode full-bytes`: `ok=True files=4 bytes=234`;
- Chinese search in the full run: `status=SUCCEEDED hits=7 exit=0`;
- real semantic query: `query.semantic.onnx-bge-zvec.v1`, 7 hits, matching
  segments from the extracted artifact text and filename.

Backup and restore (steps 17-25):

- `journal_mode=wal`, `WAL bytes before quiesce: 1137152`;
- after a clean daemon stop: `publications after a clean daemon stop: 1`,
  `WAL bytes after a clean daemon stop: 0`;
- restored prefix: `restored catalog content items: 4`, `verify ok=True
  files=4`;
- `RESTORED-FROM-BACKUP bytes are byte-identical to the original source bytes`;
- catalog-free `--recovery-reader`: `recovery import
  catalog_created=False files=4 bytes=234`;
- `RECOVERY-AUTHORITY restore (no catalog, independent anchor) reproduced the
  exact source bytes`;
- negative controls: missing anchor **exit 1**, tampered anchor **exit 4**,
  anchor from a different Ed25519 identity **exit 4**, absent reference
  **exit 4**.

In-place upgrade (steps 26-28):

- `daemon version before: cairnd v0.1.0-prealpha.1.0.20261011162014-dc34fc394687+dc34fc394687.dirty`;
- `daemon version after: cairnd offline-upgrade-v2`; daemon SHA-256 changed from
  `91ea3854...e91c7bc` to `884c0d5c...7a12cf`;
- catalog reopened `schema_state=CURRENT schema_version=27
  binary_version=27` (nothing to migrate);
- `content items after upgrade: 4`, `post-upgrade verify ok=True files=4`;
- `post-upgrade recovery import files=4`;
- `exact bytes are still recoverable after the in-place upgrade`;
- the restored prefix reopened on the upgraded pair with `verify ok=True`.

Safety (steps 1, 29-30):

- `REAL-DATA-DIRS-ABSENT` at the start and at the end of the run;
- `no-cairnd-processes-remain` after cleanup.

## Explicitly not covered by this record

- a released artifact from an earlier build, so no version-to-version
  migration;
- a repository holding an ADR-033 part-bound record read by an older binary;
- a catalog rebuild from signed publications (no such command exists);
- production repository qualification, performance bounds, non-Darwin hosts;
- guaranteed DESCRIPTION-segment semantic hits (generation timing).

The raw log for this record is the acceptance log the harness writes to
`<work>/runlog/acceptance.log` (4,574 lines for this run). It lives outside the
repository so the tree stays clean; re-run the command above to reproduce it.
