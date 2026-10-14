# Private-drive interface reference review — 2026-10-12

The operator selected **a better self-hosted private drive** as the familiar
product category. This review translates mature product patterns into decisions
for Cairn's admitted client. It is design research, not validated market demand
or an admission of every feature in those products.

## References and decisions

| Primary reference | Documented pattern | Cairn decision |
| --- | --- | --- |
| [Google Drive upload](https://support.google.com/drive/answer/2424368?hl=en) | A direct file/folder picker and file drop enter the same familiar intake. | Lead Add with file choice/drop. Prepare the existing review automatically after a complete upload; keep one explicit exact-save confirmation. Browser folder upload is not currently implemented. |
| [Dropbox upload](https://help.dropbox.com/create-upload/add-files), [website layout](https://help.dropbox.com/installs/homepage) | Upload is a primary action; search and file navigation remain easy to find. | Prefer one stable daily entry and clear receiving/preparing/saved outcomes. Keep server-directory import secondary. Don't invent percentage progress without transfer measurements. |
| [Nextcloud Files](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webgui.html) | List/grid views, row actions, a details sidebar and selected-item batch actions keep the main browse surface readable. | Continue toward predictable browse/selection/Details/takeout over the existing shared library, with secondary diagnostics. Reuse admitted favorites, tags and batch originals. |
| [Immich search](https://docs.immich.app/features/searching/) | Metadata and contextual search are exposed through understandable filters such as filename, tags and media type. | Prefer human-readable facets and clear active scope. Use only facts/dimensions Cairn actually supplies; this reference does not admit image models, faces, OCR, capture-date extraction or CLIP. |
| [Navidrome](https://www.navidrome.org/) | A focused music Web UI and integrated player make stored audio useful. | Keep browsing and the shared verified player coordinated. Recorded artist/album facts and transient queues are present; persistent playlists and media processing need their own contracts. |

The patterns in the rightmost column are our design inferences, not claims
that Cairn already matches those products. Nextcloud's linked official
[file UI](https://docs.nextcloud.com/server/stable/user_manual/_images/users-files.png)
and [upload menu](https://docs.nextcloud.com/server/stable/user_manual/_images/files_page-1.png)
are visual references; no third-party assets, CSS or dependencies are imported.

## Current friction and the first change

The existing Add drawer starts with uploads but repeats source/type labels,
then requires a staging handoff into a server-path/storage-plan interface.
The common operation should stay file-oriented:

```text
Add → choose/drop files → receive and prepare → review names/count → confirm → use files
```

Use a focused modal sized to its contents, a large drop target, a filename list
and a stable footer action. Show receipt/preparation status honestly. Put
digests, temporary paths and detailed savings in a disclosure. Keep refusal,
renaming, blocked entries and unknown results visible; closing a panel cannot
make a late response start hidden work. Successful transfer is not saved
content until the existing confirmed apply reports success.

## Priority map

1. **P0: add and use.** Finish this familiar intake using existing upload,
   plan/review/apply and content-library callbacks. Verify actual originals,
   not just a successful multipart request.
2. **P1: shared library productivity.** Consolidate row/selection actions,
   filters, favorites and takeout around the existing ordinary user loop.
   Any recency view must use available time facts rather than fabricate history.
3. **P1: professional domain use.** Continue Photos viewer/selection and
   Music browse/queue/player polish; keep search scope and unavailable states
   honest. Flagship pages remain few and focused.
4. **Separate reviewed successors:** persistent albums/playlists, richer
   grouping, folder organization and additional preview/media functions.
   Minimal LinkGroup still follows the Phase 4/5 gates. Familiar drive
   positioning does not authorize a new namespace-mutation/sync/share service.

Apply one cohesive system of spacing, typography, action hierarchy, focus and
empty/error/success states. Borrow complete interaction paths, not isolated
decorative components. [ADR-035](../technical/build-stack-and-architecture-selection.md#adr-035-private-drive-positioning-and-file-oriented-intake)
records why this is the current priority; the core execution plan remains the
only implementation order.
