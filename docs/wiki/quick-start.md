# Quick start

The ordinary flow is deliberately small:

```text
configure
→ add files, a folder, text or a server path
→ review the exact-storage plan
→ confirm and save
→ search, add Notes or tags
→ verify or restore when needed
```

The browser accepts file selection, drag-and-drop, folder selection and plain
text. Advanced intake accepts a path visible to the Cairn host. Uploads are
temporary until you review and confirm the save; staging is not protection.

## Saving a file

1. Open **Add**, choose files/a folder or write text. The configured storage
   scheme is preselected.
2. Review the file count, logical bytes, exact duplicates, and any blocked
   entries.
3. Confirm the plan.
4. Cairn stores or reuses the exact content and keeps the original path as
   provenance. Choose **View saved files** to see and select the confirmed
   upload batch, ready for existing Notes, tags and takeout actions.

A ready upload review can be closed and reopened in the same browser session
without another upload or plan. During transfer, use **Stop upload** or wait for
the receipt before closing. A stopped transfer retains the selected browser files
for an explicit retry; it is not a confirmed save. Retry may leave an earlier
unconfirmed temporary upload on the host. Refreshing the browser does not retain
these transient File objects or replace server-side recovery records.

The saved batch is temporary, not a new collection. If Cairn cannot match every
accepted upload to its saved path, digest and length, it opens the source with
a notice instead of selecting a partial or uncertain batch. Server-path intake
continues to open the saved source.

Optional analysis can run after the exact save. A model or index failure leaves
the saved bytes and keyword search usable.

## Finding a file

Search combines names, paths, metadata, Notes, tags, extracted text, and any
available semantic generation. A result always points back to the same stable
file subject; a similarity score never changes file identity or authorizes
deletion.

From Home, use the floating input without replacing the background query. Its
**Why this matched** disclosure shows returned evidence without reading another
original. A media result outside the background scope indicates that activation
opens this search in its dedicated page; only the click performs that fresh
search/scope handoff. A changed result is refused before replacing the scope.

Choose **Continue in Library** to open the submitted floating query in the full
Library. Then **Browse matching results** and **Load more matching results**
continue its keyword/filter matches; **Return to ranked results** restores the
earlier relevance results. The unsent floating draft remains available. Opening
Details and returning preserves the shared wall's browse anchor and selection.

Choose **Save this search** below a floating result to review and name its
submitted keyword/structured conditions. Unsent text and background filters are
not silently included. Reopen it through **+ → Saved searches**, then explicitly
choose **Open in library**. The same panel offers edit/copy and reviewed same-name
updates. A saved search evaluates current matching content; it does not freeze
semantic suggestions. Use an ordinary list or frozen export to retain a fixed
result instead.

Open **View matches** beside a result to inspect its returned evidence in
Details. You can browse keyword-only matches and then return to the original
ranked results without running the meaning search again. Keyword pages do not
include semantic-only suggestions. A new search, refreshed catalog or changed
workspace invalidates the old return snapshot.

Inside a floating result's **Why this matched**, choose **View match details**
to inspect that returned evidence directly. This keeps media title clicks free
to open Photos/Music/Videos. For PDF/DOCX hits, **Matched document text** shows
one returned passage at a time. Use **Read returned passage** to expand beyond
the short excerpt and **Copy passage** to copy its exact returned text. Browse
other passages with the existing previous/next controls; **Source details**
reveals provenance on demand. These are search-returned passages, not a complete
document viewer. The original document remains available through Download.

For screenshots, search for printed words or a paraphrase with the available
local text index. Floating evidence shows recognized text rather than OCR JSON.
Choose **View match details → Recognized image text → Copy recognized text**
to reuse the exact returned text. **Recognition quality** is on demand; partial
text and returned fragments remain labeled, and absent quality is unknown.
Download still takes out the original image. Recognition uses the installed OCR
bundle on new captures or ordinary explicit recaptures; missing OCR does not
prevent exact saving.

In **Photos → Scene**, describe what a saved photo shows, then choose **Find**.
This uses the installed local Chinese-CLIP image generation, independently of
filenames, OCR and the text embedding space. The compact result strip shows the
submitted scene or reference photo; editing the input does not relabel those
results. The scene draft survives switching pages in the same workspace/session.
Open a saved PNG/JPEG in the viewer and choose **Find similar photos** to use it
as a reference. A failed query keeps the current photo and results available.
**Names and tags** filters the current photo matches; **All photos** exits the
visual result scope and restores the loaded library. A new accepted visual query
resets local filters and sorting so previous choices cannot hide its matches.
Download still returns the unchanged original. Model installation and image-index
building are explicit operator actions; queries do not download models or send
images to remote inference.

## Adding context

Use the single **Notes** surface for human notes and attributed imported,
extracted, or model-produced text. Add as many user tags as useful. System
facets such as file type are shown separately.

In Music, open a track's **⋯ → Notes and tags** to add context without playing
it. Photos/Videos use their explicit **Details** action. These all open the
same inspector. For several items, select them and expand **Selection actions
→ Organize tags**; batch changes retain other tags and Notes. Favorite is the
ordinary visible `Favorite` tag, shared across these pages.

## Run locally

From the repository root, start the daemon and its built WebUI with one command:

```sh
./scripts/run-local.sh --data-dir /absolute/path/cairn-data
```

The launcher creates a persisted profile on first use, keeps its catalog,
repository, models, vectors, and recovery records below the data root, rebuilds
the daemon and CLI with the `cairn_zvec_dynamic` build tag plus the current
WebUI in a private build directory below the data root, and serves the result at
`http://127.0.0.1:4538/`. Use `--listen 127.0.0.1:PORT` for another unused
loopback port. It refuses a relative data path, a non-loopback listener, or an
occupied port, and runs in the foreground so `Ctrl-C` stops only that daemon.
It requires Go, npm, and curl; when Web dependencies are absent, it runs the
repository-locked `npm ci` automatically before the first build.
On first use it creates the configuration; for an existing profile, its saved
configuration and paths remain authoritative. Choose an absolute data directory
for one instance. The helper builds and starts Cairn but does not download or
install the semantic model bundle; semantic search availability depends on the
existing configuration and supplied bundle. The API remains loopback-only.
