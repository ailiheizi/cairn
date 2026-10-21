# Reusable Material Lists

A list keeps an ordered result over saved originals, together with the context
needed to use it. It is an ordinary JSON file in Cairn. Reading the saved result
does not invoke AI or change the originals, their Notes or their Tags.

## Create and save

1. Select saved files in the content library or a search result. Open the
   selection's **More actions**, then **Organize as list**.
2. Give the list a name. Move, repeat or remove occurrences and optionally edit
   a reason. **Notes and list context** shows copied user-authored Notes and
   Tags. These are copies inside this result, not edits to the source records.
3. Under **Organizing Skill (optional)**, enter instructions or explicitly read
   a saved `.txt` or `.md` file. Its complete text and exact identity are frozen
   with this result.
4. Arrange the list manually, or use **Copy prompt for chosen AI** and paste it
   into your preferred AI client. Import its complete JSON response through
   **Import an organized JSON result**. Cairn validates supplied references and
   retains the chosen instructions. A rejected response leaves the draft intact.
5. Choose **Review and save files**. The existing Add flow uploads the JSON and,
   when supplied, ordinary Skill text, then prepares a plan. Review and explicitly
   confirm that plan. The files are saved only when capture succeeds.

Copying a prompt is an explicit disclosure to the destination you choose.
Cairn does not contact a model, configure credentials or run the Skill itself
in this first delivery. **Download JSON** can also hand the prepared result to
another program without saving it in Cairn.

## Reopen and use

Find the saved `.cairn-list.json` file, open Details and choose **Open saved
list**. The reader checks the original file's SHA-256 and length, validates the
body, and checks the retained Skill text. It displays every occurrence in order.
Resolved members offer the ordinary verified original download.
The list appears before **Original JSON**, whose raw preview stays closed until
you explicitly open it.

### Use the list directly

The list offers **Play audio in list order** and **Take out unique originals**
above its members. Playback retains supported audio repetitions and order; the
display states how many non-audio or unsupported occurrences it will skip.
**More list actions** contains **Append audio to queue** and **Review
server-directory export**. The queue is the ordinary transient player queue.

Takeout includes each unique file target once, even when the list repeats it;
the screen states the repeated-target count. It does not promise ZIP/export
output order. Browser ZIP retains its 32-file, 32 MiB-per-file and 64 MiB-total
limits. For larger sets use the existing reviewed server-directory export or
individual original downloads. Opening server export does not write files.

Whole-list actions require every occurrence to resolve in the loaded library.
An unresolved row stays visible and blocks those actions rather than silently
removing a member. Loading the needed library scope can make the actions ready.

A member unresolved in the loaded library stays visible. This is not proof
that it is missing from the complete catalog. Load the relevant library scope
and try again; the reader does not substitute different bytes or delete a row.

**Create revised snapshot** starts a new draft. Saving it creates another
ordinary capture; the earlier result is preserved. Automatic refresh and a
single mutable current-list head are not part of this delivery.

## Read from a program

The JSON uses `format: "cairn.material-list.v1"`, a `title`, optional `guide`,
and ordered `items`. Each item has a display `label`, an exact `ref`, and
optional string-valued `context`. Repeated references remain repeated items.

For example, a program can read an exported result using Python's standard
library, without AI:

```python
import json

with open("reading-list.cairn-list.json", encoding="utf-8-sig") as source:
    result = json.load(source)
if result.get("format") != "cairn.material-list.v1":
    raise ValueError("Unsupported material-list format")
for position, item in enumerate(result["items"], 1):
    print(position, item["label"], item.get("context", {}).get("reason", ""))
```

To resolve originals, compare both `content_id` and `logical_size` with Cairn's
content listing and use the existing verified original-download operation.
Optional entry/subject IDs are local hints, not portable identity or authority
to read a path. A missing match is an explicit unavailable outcome.

Limits are 200 occurrences, 512 KiB of UTF-8 JSON and 64 KiB of Skill text.
Over-budget input is refused rather than silently shortened. Full format and
trust rules are in the [ML-1 client contract](../technical/material-list-client-contract.md).
