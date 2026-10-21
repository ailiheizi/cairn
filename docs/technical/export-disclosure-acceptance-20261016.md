# Export disclosure acceptance — 2026-10-16

Status: implemented and tested for a bounded development client refinement.
This closes PC-02b only. Full PC-02, core phases and release qualification
remain open.

## Problem and decision

The existing server-directory drawer expanded alternative query sources,
SavedViews, sidecar options and export history before the frozen-file review.
Those secondary controls competed with the ordinary selected-file task.

Following [ADR-039's disclosure principle](build-stack-and-architecture-selection.md#adr-039-library-layouts-and-on-demand-search-assistance),
keep the selected source, explicit server destination and Preview action in the
main flow. Put alternative sources, additional options and history in named
native disclosures with visible expansion arrows. Open alternative sources
initially when there is no selected source. Retain the active query name and
sidecar policy in the summaries when collapsed. History follows the current
frozen review and actions. Loading failures retain their list context outside
the disclosures.

The active track is RW-PERSONAL-UX-1 / UX-T1. The requirements advanced are
[API/WebUI §6](../requirements/api-and-webui.md#6-interaction-principles) and
[content-store §7.3](../requirements/content-store-views-and-exports.md#73-exportmanifest):
concise interaction around an explicit frozen review, apply and verification.
Existing callbacks, source-change invalidation and history's verification-only
behavior are unchanged. Root compared the frozen-file review, warnings and
apply/verify JSX against the retained baseline and found it identical.
No backend operation, schema, processor, signed format or recovery authority
changes. Server paths, flat output naming and empty-directory restrictions
remain explained before execution.

## Functional evidence

All raw evidence is under `dist/export-disclosure-20261016/`. The private
browser reuses the previously ingested three-file profile on port 4652;
there is no new ingest or owner-profile mutation. Headless Chrome at
1280×900 proves:

1. Two selected files, the server destination and Preview fit the initial
   viewport. All three disclosures start closed. Toggling them issues no
   command and preserves source, destination and sidecar intent.
2. An explicitly saved keyword query remains identifiable when collapsed.
   Closing the drawer returns focus to its trigger; reopening can select the
   stored view. Its preview uses the view reference. Returning to selection
   invalidates that frozen query manifest without applying it.
3. A new explicit selection freezes both intended identities. There is no
   apply before the user chooses Materialize and verify.
4. Exactly one real apply writes both originals. One deliberately simulated
   HTTP 503 on verification leaves the written-but-unverified warning and
   Retry verification accessible outside the disclosures. The subsequent real
   verification succeeds without another plan or apply.
5. Selecting the frozen history record offers verification only. Another real
   verification leaves both output files unchanged.

The passing functional receipt is
`browser/run-20261015182126980-95817/evidence.json`. Root independently
checked all 23 raw command request/response bodies and hashes, the manifest
membership, output files and source bytes. Manifest
`exm_d9c5405f11b135801d6cdbe9882b04c7` has digest
`sha256:b5ff4f2e2677be8737eedfc0a8cc991be92c802b624366082566d67aa4345540`.
Both outputs have 17 bytes: small-a SHA-256
`f9409b680499c2ea5b2b48004644f81d3d78de12fa91ea003446f5fd92364679`,
small-b `4bbd8e85c23af198627cb643956b54e2803bce3e4958343de187cfb2c3f451f8`.
The private daemon exits cleanly; no listener or socket remains.

Two earlier failed harness receipts are preserved. The first omitted opening
the existing More actions disclosure; the second looked up an intentionally
collapsed child through the visible accessibility tree. Both stopped before
any export plan/apply and cleaned up. Corrected normal UI selectors did not
change product behavior or use forced clicks.

## Final build and visual review

Root screenshot review exposed low-contrast light-mode labels and an
unfocused destination field using a hardcoded dark background. Export-scoped
theme colors correct those states. Only CSS changed after the functional run;
the JavaScript content digest remains
`8810900bec1ad22e2cd863737c4a54bf23d1ec2d6ff01a0b2a4dfec7e1faee85`.

A separate read-only final-layout run,
`browser/run-20261015182601891-96578/layout-evidence.json`, matches the final
CSS digest `9c98fe536f88ee1104158502792e5adaaf26de603070ab324f5a1fe566fe13a2`.
It proves the initial viewport/disclosures and computed theme colors for the
heading, destination label and unfocused input. It issues no export plan,
apply or view save. Root inspected its screenshot and verified the served
assets at the owner preview match disk; see `root-final-preview-assets.json`.

TypeScript/Vite build, i18n catalog check, existing E2E script syntax and
`git diff --check` pass. One shared offline
`GOPROXY=off go test -tags=cairn_zvec_dynamic ./...` exits zero. Raw logs,
exit receipts and source/build baselines are retained in `implementation/`
and `baseline/`. The build retains the existing large-chunk advisory.

The full browser E2E suite, workspace switching, mobile/dark layout matrix,
large selections, real semantic search and release qualification were not
run by this slice. The private keyword search honestly reports semantic
unavailability and lexical fallback. No fixture, simulated outage or client
result closes a core phase or establishes representative search quality.
