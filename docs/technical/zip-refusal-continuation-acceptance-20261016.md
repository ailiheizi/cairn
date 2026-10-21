# ZIP refusal continuation acceptance — 2026-10-16

Status: implemented and tested for bounded PC-02a under RW-PERSONAL-UX-1
UX-T1. This client refinement grants no core-phase or release qualification.

## Problem and decision

The old client refuses an oversized or unknown-size ZIP before planning or
reading bytes, but retains only an error message and Dismiss. Its existing
single-original and server-directory capabilities are not reachable from that
failure. This interrupts the user's takeout task.

The [UX-T1 contract](../requirements/first-party-client-experiences.md#8-ux-t1-bounded-original-zip-takeout)
now explicitly describes continuation through those existing actions.
[ADR-048](build-stack-and-architecture-selection.md#adr-048-continue-budget-refused-takeout-with-the-attempted-selection)
records why the attempted selection must be retained independently of the
currently visible selection.

The client validates every attempted regular-file identity and rejects
duplicate subjects/entries before classifying a budget refusal. Count,
per-file/total size and unknown-size refusals retain a minimal immutable
workspace-bound selection. Invalid identities and failures after planning,
member reads or verification expose no bypass. No giant match/Note bodies are
copied into this transient projection. Over-count selections are not truncated.

One valid file can use the existing browser-owned original-download route;
the full retained set can open the existing server export drawer. The latter
still requires ordinary explicit plan, review, apply and verification. It does
not treat this retained selection as a manifest or reuse a failed frozen unit.
Workspace/readiness guards, new-attempt/reset/cancel clearing and ordinary
focus handling remain in force. The failed-budget status stays mounted but
hidden while the export drawer is open, preserving its focus-return target.
Active download/cancellation controls are not hidden by this refinement.

## Current-build evidence

Luna implemented the seven scoped Web/helper files and ran:

- `node scripts/web-original-archive-check.mjs`
- `npm --prefix web run build`, including `tsc -b`
- `git diff --check`

The focused checks cover unknown-size continuation, malformed/duplicate
identity refusal, complete over-count retention and the existing frozen-item,
ZIP byte-integrity and cancellation checks. Root reviewed the diff against
retained pre-slice `.txt` baselines. One shared offline
`GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` passed with production Go
sources unchanged. Its raw-log SHA-256 is
`f8d99a9533e5fa7f96027f15f4036ff48fffb23a972cbec971c220d855138fdf`.

All evidence is under `dist/takeout-gap-20261016/`: implementation command
receipts, the shared `go/receipt.txt`, root source review and combined
`root-final-acceptance.json`.

## Real private browser takeout

A fresh persisted private profile on port 4652 uses the already reviewed
daemon `78bd36350827ada28f93f703130773c1443e8e10005ee12b2629100d5c0ce721`
and ordinary CLI plan/apply to retain three actual files. No semantic assets
are installed and the owner profile is not used for mutations.

The oversized binary has 33,554,433 bytes and SHA-256
`01c01ed635702d5224b5a53fd97f6f2e1ffeade5e310c07ff741974fccf22f1c`.
Two distinct small files have 17 bytes each. The old served build demonstrates
the refusal with zero `export.plan` calls, zero original-byte fetches and only
Dismiss. The first harness attempt skipped the existing row-hover interaction
and could not click the hidden selection control; its failure receipt is
preserved. A separately authorized ordinary hover/click follow-up reused the
same ingested profile and reproduced the actual old-client gap. No selection
code or forced click was introduced to pass that test.

One green run against the reviewed build proves:

1. The over-budget ZIP is refused without a plan or original-byte fetch.
2. The explicit single-original browser download returns all 33,554,433 bytes
   with the expected SHA-256.
3. A second ZIP attempt captures the oversized file plus small-b. The visible
   selection is then changed to small-a alone. Continuing server export still
   freezes the original pair, excluding small-a.
4. Existing `export.plan`, `export.apply` and `export.verify` succeed. The
   33,554,450 output bytes independently match both original identities.
5. The failure status cannot cover the export dialog, closing the dialog
   returns focus to its opening control, and Dismiss clears the continuation.

Manifest `exm_11bf861e7febc134a49c6f760643cba5` has digest
`sha256:29859493c857a7d0a35968403e9c26f369144137d2389df982b8035f8bd046c0`.
Root independently verified all eight old-client and fourteen green raw
command responses, request bytes, exact outputs and served assets, and
inspected screenshots. Page, console and request errors are zero. Both owned
daemons stop with exit zero; no private listener or socket remains.

Receipts and screenshots are in `browser/attempt-01/`, including the preserved
`red-evidence.json`, corrected `red-hover-evidence.json` and
`green-evidence.json`. The current owner preview serves the same reviewed
assets, verified byte-for-byte by `root-preview-assets.json`:

| Asset | SHA-256 |
| --- | --- |
| `index-CQd8JLaf.js` | `3c0d4c8656e30519fa857ab6f825d2e77f9b455fb38949ff61de6c1a54bfe880` |
| `index-Duhk_Q2b.css` | `9f05b9a7a68179dfed70ce8ff2968a6d85a57658429efb13d252163e34ffb7ef` |

## Limits

The real browser journey covers the oversized-file and changed-selection
continuations. Unknown-size and count/total limits have focused helper
evidence; workspace mismatch/reset guards were source-reviewed, not exercised
as a runtime workspace switch. This is a three-file development fixture, not
representative recall/performance or release evidence. Existing 32-file,
32 MiB-per-file and 64 MiB-total ZIP ceilings remain unchanged. No backend,
schema, provider, recovery record, durable state or owner restart was added.
