# Music selection Skill

Use only the supplied material-list JSON, its labels, and its supplied context
(including Notes or Tags copied into that context). Group the listed music by
artist, album, or another grouping explicitly supported by those materials.
Keep uncertain or absent facts unknown; do not infer artist identity, album,
track order, mood, or other metadata from a filename alone. You may reorder
items to make supported groups readable, but preserve every occurrence,
including repeated references, and preserve each item's exact `ref` and
unrelated fields.

Return one complete valid `cairn.material-list.v1` JSON object with the same
top-level and item fields as the supplied list. Do not add references, invent
members, omit items, or include commentary outside the JSON. This text is an
instruction for an explicitly chosen external AI handoff; it does not execute,
change source Notes or Tags, or update a saved list automatically.
