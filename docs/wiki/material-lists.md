# Reusable Material Lists

A list keeps an ordered result over saved originals, together with the context
needed to use it. It is an ordinary JSON file in Cairn. Reading the saved result
does not invoke AI or change the originals, their Notes or their Tags.

## Quick path from the floating input

Find saved material in the bottom input. Select returned files, then choose
**Organize selected**; the unselected action explicitly names the count of all
returned regular files. The spacious result can be adjusted, played or taken
out through existing host actions. **Keep in Library** opens the ordinary save
review; only confirmation retains it. Reopen the saved `.cairn-list.json` from
Library to use the same result again. The guide/editor paths below remain
available through **Organize with a Skill** and explicit item Details.

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
The clipboard path does not contact a model. An explicitly configured in-product
organizer is a separate choice below. **Download JSON** can also hand the
prepared result to another program without saving it in Cairn.

### Organize inside Cairn with a configured model

Open **Organize with AI** in the list editor. The server must have an installed
`cairn.online-organize-profile.v1` manifest under
`<paths.models>/online-organize/<profile_id>/profile.json`. Select that profile
through the existing Settings or `organizing.provider_profile`, save and restart
the daemon. Endpoint/model/revision, credential reference, egress declarations
and finite budgets belong to that immutable manifest. Credentials resolve from
the server's `env://` or `keychain://` reference; do not paste a key into a list,
Skill, browser or repository. Changing manifest facts changes its digest and
requires a corresponding authorization.

1. If necessary, explicitly authorize this organizer. The grant is limited by
   the installed profile, expires within 24 hours, and permits one request per
   generation. It remains reusable until expiry or revocation; it does not
   automatically send anything.
2. Choose **Review exact disclosure**. Inspect the current title, labels,
   exact refs, copied/edited Notes/Tags context and complete embedded Skill.
   Inspect the destination, model/revision, profile digest and matching grant.
   No original body, EXTRACT text, picture or audio is read for this request.
3. Confirm **Send one request**. A result appears as a separate candidate;
   the editor remains unchanged. Review title/order/context and omitted or
   repeated occurrences. The selected Skill remains unchanged.
4. Reject the candidate or choose **Use candidate in editor**. Edit further if
   needed, then use the existing **Review and save files** flow. A candidate is
   not a saved list; ordinary confirmed capture is still required.

Each generation accepts at most 32 occurrences and 128 KiB of serialized UTF-8
input, returns at most 32 occurrences and 512 KiB including retained Skill,
and makes at most one request within 90 seconds. Lower profile/grant bounds
win. These operation bounds do not change the 200-occurrence ordinary format.

Changing the draft, workspace or active profile invalidates a pending result.
Cancel stops waiting and ignores late results; data already sent cannot be
recalled and a provider charge may still occur. Unavailable authorization,
invalid output or foreign refs leave the draft intact. Reopening a saved list
never calls the organizer or refreshes its contents automatically.

### Correct and reuse a saved Skill

A saved list and its Skill are snapshots. To correct instructions for new
material, start a new list from the newly selected files, then choose the saved
Skill text you want to revise. Edit its name or instructions in the current
fields; editing clears the selected file identity, so the corrected text is a
new Skill snapshot. Review the complete list and instructions, then save through
the ordinary Add review and capture flow. The result is a new list (B) and,
when instructions are present, a new ordinary `.skill.txt` capture (Skill B).
The original list (A) and its embedded Skill remain unchanged.

For a later list, refresh/load the catalog if needed and explicitly choose the
saved Skill B. Cairn does not select a same-named file as “latest,” refresh a
saved list's instructions, or replace an older snapshot automatically. Choose
the exact saved text you intend to use.

These plain-text examples can be copied into **Skill instructions** or saved
through ordinary text intake, then selected from the loaded catalog:

- [Music selection Skill](examples/music-selection-skill.md)
- [Research reading Skill](examples/research-reading-skill.md)

They are instructions for the explicitly chosen organizer or external AI
handoff, not executable Skills or automatic tag/list updates.

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

The standalone [Python reader example](../../examples/material-list/README.md)
validates an exported snapshot, preserves every ordered occurrence, and can
check explicitly supplied local originals against complete SHA-256 digests and
logical lengths. It runs offline with Python's standard library and never
scans directories or follows paths from list content. Its local byte match is
not a Cairn catalog resolution or authorization to read or download a server
original; use the host's existing verified original-download operation for
that.

Limits are 200 occurrences, 512 KiB of UTF-8 JSON and 64 KiB of Skill text.
Over-budget input is refused rather than silently shortened. Full format and
trust rules are in the [ML-1 client contract](../technical/material-list-client-contract.md).
