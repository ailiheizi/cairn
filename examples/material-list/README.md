# Read an ordinary material list

`read_list.py` is a small offline consumer for exported
`cairn.material-list.v1` JSON snapshots. It uses only Python 3's standard
library, validates the document and retained Skill snapshot, preserves item
order and repetitions, and writes a transient JSON report to stdout.

```sh
python3 examples/material-list/read_list.py reading-list.cairn-list.json
```

To check local originals, pass each file explicitly. The program streams each
regular file and matches its complete SHA-256 digest and byte length to each
list reference:

```sh
python3 examples/material-list/read_list.py reading-list.cairn-list.json \
  --original ./book.pdf --original ./notes.txt
```

The output keeps the unchanged parsed list in `document`. Each `occurrences`
row includes its 1-based position, original item fields and `AVAILABLE` or
`UNAVAILABLE` state. An available row also has the matching supplied `path`.
Repeated references produce separate rows. A supplied file that cannot be
read or is not regular appears in `local_read_diagnostics`; it does not hide
or remove any list occurrence.

Example excerpt:

```json
{
  "occurrences": [
    {
      "position": 1,
      "ref": {"content_id": "sha256:aaaa…", "logical_size": 42},
      "label": "Chapter notes",
      "context": {"reason": "Read next"},
      "state": "AVAILABLE",
      "path": "./notes.txt"
    },
    {
      "position": 2,
      "ref": {"content_id": "sha256:aaaa…", "logical_size": 42},
      "label": "Chapter notes again",
      "context": {"reason": "Repeat this occurrence"},
      "state": "AVAILABLE",
      "path": "./notes.txt"
    },
    {
      "position": 3,
      "ref": {"content_id": "sha256:bbbb…", "logical_size": 57},
      "label": "Another original not supplied",
      "state": "UNAVAILABLE"
    }
  ]
}
```

The abbreviated digest above is illustrative; actual list identities contain
all 64 lowercase hexadecimal digits. Availability means only that a supplied
file matched the reference at read time. It does not resolve a Cairn subject,
prove that a file is present in a host catalog, or authorize a server read or
verified download. Entry and subject references remain local hints. The
program never reads paths or instructions from list content, scans folders,
contacts a service, executes the guide, or writes report files.

Exit status is `0` for a valid report, including when some or all occurrences
are unavailable. Invalid or over-budget list input and command-line usage
errors exit `2`, write an explanation to stderr, and produce no partial JSON
report. Limits follow the client contract: 200 occurrences, 512 KiB of UTF-8
JSON, and 64 KiB of guide text.
