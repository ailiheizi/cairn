# Lexical Source Coverage Acceptance — 2026-10-15

Status: implemented and tested for the bounded development profile below.
This closes PC-07f only. PC-07, semantic source/revision coverage, Phase 4,
Phase 5 and release qualification remain open.

The later [semantic source-lineage acceptance](semantic-source-lineage-acceptance-20261015.md)
records the separately reviewed v2 successor. Statements below about unchanged
semantic receipt v1 describe this earlier lexical slice, not the later work.

## Requirement and scope

- Active phase: Phase 4, complete discovery.
- Normative requirement: Content Store §§8–9 selected-source coverage and
  [Driver and Processor Interfaces §10](../requirements/driver-and-processor-interfaces.md#generation-local-lexical-source-coverage).
- Executable exit: inspect an immutable lexical generation against its selected
  source inventory; verify actual field bytes and source spans; preserve the
  denominator when a built document is removed; report missing or unavailable
  evidence without disabling ordinary lexical search or exact preservation.

The `LEXICAL_SELECTED_TEXT_V1` inventory includes display filenames, current
non-tombstoned TAG/NOTE revisions, in-scope description revisions, and
root-eligible policy-admitted EXTRACT artifacts. A description's rejection
does not remove its lexical history; semantic eligibility is unchanged.
Empty and whitespace-only extracts retain explicit field evidence without
claiming they produce a keyword hit. This profile has no selected-source
exclusions.

## Implementation reviewed

One deterministic document carries the complete inventory anchor; remaining
documents carry generation/workspace/inventory-digest markers. Both use an
optional versioned extension of the existing UNINDEXED segment JSON, with no
catalog migration, new database, endpoint, processor or recovery record.
Filename evidence binds the exact document reference; shared subject fields
retain their common source identities. The report validates generation,
workspace, snapshot, namespace root, config and provider profile, then checks
source digests, field digests and UTF-8 byte spans against the built fields.
Document and field-digest lookups avoid repeated full-document scans and
repeated full-field hashing for each source.

Missing rows remain in the anchor's expected set. A missing anchor, conflicting
markers or invalid inventory reports unavailable evidence. A durable source
digest mismatch remains UNAVAILABLE when the indexed bytes otherwise match.
Revision strings must be canonical positive decimals. Legacy array and v1
segment readers remain usable; missing inventory is explicitly unavailable,
never empty-complete. Self-digests prove projection consistency only, not
source authenticity or exact recovery.

The existing `search.rebuild` response optionally includes
`lexical_coverage.source_coverage`, with full counts and at most 256
deterministic bad-outcome-first details. Existing aggregate field presence
retains its separate meaning. The Settings message distinguishes selected
text-source gaps, field gaps and semantic failure. Older responses without
the new property remain supported. No source-coverage scan was added to each
ordinary search request.

## Executable evidence

The focused tests cover selected source kinds, accepted/rejected descriptions,
empty and whitespace-only extracts, later catalog revision stability,
generation-binding swaps, changed indexed fields, deleted documents/anchors,
legacy readers, unavailable durable source digests, canonical revision
validation and a 300-row report with full counts and 256 bounded details.
The broad test command passed from the repository root:

```sh
GOPROXY=off go test -tags=cairn_zvec_dynamic ./...
```

The final exit-0 log and invocation receipt are retained under
`dist/lexical-source-coverage-20261015/go/`. An interrupted initial run and a
completed run with only an evidence-directory package setup failure remain
retained. The latter accidentally collected copied baseline `.go` snapshots;
renaming those owned snapshots to `.go.txt` preserved their hashes and removed
that unintended package. The final broad rerun passed. No application fix or
test exclusion was used for that collection failure.

An isolated daemon built with `cairn_zvec_dynamic` used the existing eight-file
local acceptance profile on port 4651. Its candidate SHA-256 was
`01e9be4692fb3193de4f258bd1343c9aab78609248ce295b38d2fd2e6f3eb557`.
One actual `search.rebuild` returned:

| Selected source | Indexed / expected |
| --- | --- |
| FILENAME | 8 / 8 |
| EXTRACT | 8 / 8 |
| TAG | 5 / 5 |
| NOTE | 1 / 1 |
| Total | 22 / 22 |

The measured lexical generation was
`idx_9b1ec5783da64e2bb3d7809f98eaa880`. Parent review independently recomputed
the inventory digest, every field digest and source-span digest, and compared
the public rows/counts to that inventory. An actual Note-only lexical query
returned the intended canonical subject. Lexical and existing real semantic
capabilities remained AVAILABLE. The operation still returned DEGRADED for
separate optional corpus fields with no values; that does not contradict
complete coverage of the selected text sources.

Raw successful command requests/responses, build/source identity,
`root-acceptance-check.py`, `root-acceptance-review.json` and cleanup evidence
are retained under `dist/lexical-source-coverage-20261015/`. The first API
runner reached the successful rebuild but then supplied an invalid shorthand
dimension in its query. That failed attempt remains recorded; the correction
used `lexical-metadata-fts`, rechecked the same retained generation and made
no second rebuild. Config, schema 27, publication count, source files and
repository object/record bytes remained unchanged. The candidate shut down
gracefully, its worker/socket/temp directory were removed, and port 4651 was
released. Owner daemon/worker PIDs 66042/67405 and port 4648 remained running.

## Client feedback evidence and deployment boundary

`npm run build` passed. The served JS was `/assets/index-BAKmdO4i.js`, SHA-256
`827cefea35684a42d5c9ed06b0cd7a894b3ef441e882d771bd0b77bdbeb88552`;
the CSS was `/assets/index-DRBQWM39.css`, SHA-256
`d847dd232d3cc9aa6689423e9b51bb19f044b23f819c14db5860f7954b1a1fe0`.
Built and HTTP-served asset hashes matched.

One corrected headless Chrome run captured four controlled Settings outcomes:
complete, selected source incomplete with complete aggregate fields,
source detail unavailable, and an older payload with semantic failure and no
source property. All four rebuild requests were intercepted; none mutated the
owner profile. The run retained per-case visible messages, DOM and PNGs,
request/response envelopes, exact invocation and zero page errors in
`ui/attempt-02/run.json`. Parent review read the diff/receipts and inspected
the source-incomplete screenshot. Attempt 01's early MutationObserver
instrumentation failure remains retained; an awaited per-case capture hook
replaced it. This controlled feedback check is not backend capability proof.

The owner preview's Web assets changed, but its daemon was not replaced. New
backend source reporting was proven only in the isolated candidate. This is
not a release, installation or general model-distribution claim.

## Remaining boundaries

- Semantic receipt v1, semantic spaces, model profiles and recovery formats
  are unchanged. Complete semantic source/revision selection evidence still
  needs its separately reviewed successor.
- The eight-file corpus is a fixture-derived development sample, not evidence
  of representative recall, large-library performance or supported-host
  qualification. Descriptions were exercised in Go tests, not that private
  eight-file corpus.
- No source-history completeness, new image/music dimension, AI integration,
  model installation, durable playlist/album, LinkGroup or plugin loader was
  added. AI capture/retrieval remains the future direction in ADR-044.
- Full baseline discovery, packaging/license review, storage qualification and
  the remaining execution-plan exits retain their existing open gates.
