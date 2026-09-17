# Phase 5 operator corpus manifest

The savings qualification spike accepts an operator-supplied JSON corpus
manifest with schema `restoreweave.corpus-manifest.v1`:

```json
{
  "schema": "restoreweave.corpus-manifest.v1",
  "entries": [{"path": "relative/name", "bytes": 12, "sha256": "..."}],
  "digest": "..."
}
```

`digest` is the SHA-256 of canonical JSON containing only `schema` and the
sorted `entries` (the digest field is omitted). Paths use one canonical,
slash-separated relative spelling (no `.`/`..`, empty components, or
backslashes), and SHA-256 values are lowercase hexadecimal. The runner reads
the manifest, rejects unknown fields, malformed entries, duplicate or unsafe
paths, and digest mismatches, then rescans the supplied corpus. Every path,
logical byte length, and SHA-256 must match exactly. Missing or extra files,
symlinks, special files, and changed bytes fail closed before any repository
operation.

Create the first manifest without opening a repository, then review and retain
it before running a comparison:

```sh
go run -tags=savingsreport ./server/internal/repository/savingsreport \
  -manifest-only -corpus /absolute/path/to/corpus \
  -manifest-out /absolute/path/to/corpus.manifest.json
```

Use `--corpus-manifest FILE` with `scripts/qualification-spike.sh` together
with `--existing-corpus DIR`. The resulting report remains candidate evidence;
an operator manifest does not make a repository profile representative or
release-qualified.

The same reviewed manifest can bind the two in-tree profiles to identical
input bytes:

```sh
scripts/savings-report.sh \
  --corpus-dir /absolute/path/to/reviewed-corpus \
  --corpus-manifest /absolute/path/to/corpus.manifest.json \
  --profile both --work-dir /absolute/path/to/new-or-empty-work --keep
```

The runner verifies the manifest before opening either repository and writes
the same corpus digest into the raw and zstd candidate evidence. A missing,
extra, changed, symlinked, or special corpus member fails before placement.

Generated small and heterogeneous corpora used by `scripts/savings-report.sh`
are not operator-reviewed inputs by themselves. After the generated tree
exists, the script writes `restoreweave.corpus-manifest.v1` with
`-manifest-only` and passes that file as `-manifest-in` for every profile.
The copy retained in the work directory is
`generated-corpus.operator.manifest.json`. The heterogeneous
`restoreweave.qualification-corpus.v1` sidecar remains seed, license, and
category evidence and is not a corpus-manifest. Changing a generated file
after that operator manifest is written fails closed before a repository is
opened. This binding does not make the generated tree representative or
select an engine.
