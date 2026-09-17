# Quick start

The ordinary flow is deliberately small:

```text
configure
→ inspect a local or mounted server path
→ review the exact-storage plan
→ confirm and save
→ search, add Notes or tags
→ verify or restore when needed
```

The current browser flow accepts a path visible to the RestoreWeave host. A
future browser-upload flow may add a temporary upload stage, but it is not the
same thing as accepting a URL and it does not change the recovery model.

## Saving a file

1. Choose the configured storage scheme (the current profile is preselected).
2. Review the file count, logical bytes, exact duplicates, and any blocked
   entries.
3. Confirm the plan.
4. RestoreWeave stores or reuses the exact content and keeps the original path
   as provenance.

Optional analysis can run after the exact save. A model or index failure leaves
the saved bytes and keyword search usable.

## Finding a file

Search combines names, paths, metadata, Notes, tags, extracted text, and any
available semantic generation. A result always points back to the same stable
file subject; a similarity score never changes file identity or authorizes
deletion.

## Adding context

Use the single **Notes** surface for human notes and attributed imported,
extracted, or model-produced text. Add as many user tags as useful. System
facets such as file type are shown separately.

## Run locally

From the repository root, start the daemon and its built WebUI with one command:

```sh
./scripts/run-local.sh --data-dir /absolute/path/restoreweave-data
```

The launcher creates a persisted profile on first use, keeps its catalog,
repository, models, vectors, and recovery records below the data root, rebuilds
the pure-Go daemon and CLI plus the current WebUI, and serves the result at
`http://127.0.0.1:4538/`. Use `--listen 127.0.0.1:PORT` for another unused
loopback port. It refuses a relative data path, a non-loopback listener, or an
occupied port, and runs in the foreground so `Ctrl-C` stops only that daemon.
It requires Go, npm, and curl; when Web dependencies are absent, it runs the
repository-locked `npm ci` automatically before the first build.
