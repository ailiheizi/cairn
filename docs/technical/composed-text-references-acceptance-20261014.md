# Composed Text References and Intake Acceptance — 2026-10-14

Status: implemented and tested for the bounded local client slice below.
This closes a concrete reading-record friction, not the whole product,
PC-01 mixed-media journey, browser-session application, core phase or release.

## Goal, admission and scope

The operator selected composition of shared capabilities, adding only what is
needed. A research record already has exact preservation, text search,
preview and original takeout. Its URLs were inert text, requiring repeated
copy/paste to continue reading. This slice connects explicit URL activation
to the existing verified plain-text preview.

| Active phase | Normative requirement | Executable exit |
| --- | --- | --- |
| RW-PERSONAL-UX-1 existing local client maintenance | API/WebUI §§5.3/6/9, shared authority in UX-C1, existing exact takeout in UX-T1 and content-store §13 | UI search finds an exact text record; safe references activate explicitly; rendering preserves text and makes no network request; single-original and frozen two-record ZIP output match lengths and SHA-256. |

Luna audited and implemented the scoped preview; root reviewed the diff,
corrected parsing/appearance edges, and built the final client. A separate
Luna extended the existing browser harness and ran focused QA and one broad
Go regression. Existing documentation/worktree changes were preserved.

Changed client files are ContentPreview.tsx, ContentPreview.css and the
presentation-only textReferences.ts helper. No backend endpoint, schema,
processor, index dimension, profile, signed format, configuration path or
recovery authority changed. Exact-read verification and the 64 KiB text cap
remain unchanged. This is not a Markdown/HTML renderer or a new task page.

## Behavior

- Valid explicit HTTP(S) references in verified text are underlined links
  with keyboard focus styling and user-triggered new-tab navigation.
- Remaining characters, line order and punctuation stay visible unchanged.
  Common Chinese punctuation and balanced/unmatched terminal brackets are
  handled conservatively; URL recognition is a presentation convenience.
- Unsupported schemes, deceptive prefixes, malformed authority/escapes,
  credentials, controls and backslashes remain plain text. Links use
  target=_blank with noopener/noreferrer. Rendering fetches no URL target.
- Original download/export still uses the host's existing authorized subject,
  frozen manifest and byte-verification operations. No page body is captured.

## Reference-rendering cohort evidence

Base HEAD is d1750d916f198293bae84fb43ae9d6127e7ee86e, with the reviewed source
and earlier documentation changes uncommitted. At this earlier checkpoint,
built assets and the read-only preview at http://127.0.0.1:4648/ matched
byte-for-byte. The subsequent intake cohort below supersedes these Web assets:

| Asset | Bytes / SHA-256 |
| --- | --- |
| index.html | SHA-256 5f11599d924d36b39125a257436959af6333d7d8347a2319bdf0e0771c8197b1 |
| index-DSr8H387.js | 984337 bytes; 6e9894cccf3dae00c87d5f232f5d8ab874f6557a147d3819481780cfdf7473cc |
| index-v-222_FJ.css | 300703 bytes; 9bc28c4dcaa3310ae663b24afe0b7209f8b7ee1ccc45837a22636da49a50cd22 |

Commands with exit 0:

- npm --prefix web run build (TypeScript and Vite).
- node scripts/web-i18n-check.mjs (1979 merged keys, 82 client source files).
- node --check scripts/web-content-preview-e2e.mjs.
- go test -tags purego ./... (27 passing packages, 6 without test files).
- git diff --check.

The focused browser command used an isolated fixture on port 4651:

```sh
CAIRN_PREVIEW_E2E_URL=http://127.0.0.1:4651/ \
CAIRN_PREVIEW_E2E_SEED_TEXT_REFERENCES=1 \
CAIRN_PLAYWRIGHT_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
CAIRN_PREVIEW_E2E_EVIDENCE_DIR="$PWD/dist/composition-closure-20261014/qa-final" \
node scripts/web-content-preview-e2e.mjs
```

It passed UI name search, seven safe anchors, inert unsafe tokens, exact UTF-8
text/order, no target request before activation, and one controlled local
popup. The downloaded record is 628 bytes with SHA-256
2ef5f0835ca21cb81637defa40bfe8f85b3c461985ef39f91c8bccb8611f7a8b.
The two-member ZIP contains that record and Cairn-Notes.txt; independent
extraction checks names, logical lengths and hashes against exact originals.
Its frozen manifest digest is
sha256:b1dfec3f2ad4f8546cc0e86d8d501eb60ea5c1509cdafe57709bc3102cd0084d.

Evidence is retained locally under dist/composition-closure-20261014/qa-final/:
result.json, reference-browser.log, go-test.log, served-build-identity.json and
text-reference-preview-1280.png. Root reviewed the 1280 light screenshot.
The fixture daemon/profile was cleaned up; the user's port-4648 instance and
data/config were not modified. Its served assets were checked read-only.

## Limits and remaining goals

The corpus is synthetic isolated QA data, not customer adoption or model
quality evidence. This run provides no real semantic/CLIP/OCR qualification,
new storage/recovery qualification or release credit. The legacy preview and
device/viewport matrices were not rerun. A separate preflight favorites
harness timed out on a visibility/instability step; this was not established
as a product defect or reported as passing, and no favorite code changed.

This first slice closes clickable use of existing text records and their tested
takeout. It did not add text creation/editing, selected-tab capture, group
reopening, webpage snapshots or native task state. Those user outcomes stay in the
composition map; future work addresses only necessary admitted gaps. Shared
tags, SavedView, Photos/Music and the full mixed-content journey retain their
existing dated evidence and open scope rather than being requalified here.

## Subsequent bounded intake and saved-retrieval cohort

The next observed friction was having to leave Cairn to make a TXT file before
saving copied research text and references. The existing Add surface now has
an optional text-file disclosure. It creates one ordinary UTF-8 `.txt` File
and reuses upload, plan review and explicit digest-bound confirmation. It adds
no standalone Notes record, editor lifecycle, capture service or durable format.

| Active phase | Normative requirement | Executable exit |
| --- | --- | --- |
| Existing browser intake maintenance parallel to Phase 4/5 | API/WebUI §2.2, including its explicitly reviewed 64 KiB literal-text composition allowance | Paste text -> staging -> explicit review/confirmation -> filename search -> verified references -> exact original and frozen ZIP takeout. |
| Existing daily SavedView client maintenance parallel to Phase 4/5 | First-party UX-R1 and the host-owned loaded result scope | UI save/list/get/reload/evaluate remains usable; at the existing 200-result ceiling, disclose loaded matches and possible additional membership; selection/export names only the chosen displayed row. |

The text form shows its output name and actual UTF-8 byte count. Invalid names
and oversized text are refused before upload; oversized ASCII paste is retained
in full rather than silently truncated. Drafts are transient for the mounted
client session. Closing/reopening retains text and a matching staging/plan
reference. Attempt tokens fence late upload receipts. A receipt arriving after
the original drawer closes never starts an invisible review; the reopened
drawer offers explicit review of those staged bytes. An unknown apply result
retains status checking and blocks another save. Only confirmed success clears
the matching draft. Explicit draft clearing never deletes staged server bytes.

The opt-in `CAIRN_PREVIEW_E2E_PASTE_TEXT_REFERENCES=1` mode in the existing
preview harness passed on a self-owned port-4651 fixture. It exercised the
actual Add controls, multibyte/ASCII byte-limit refusal, draft reopen, a held
real upload response, explicit review, READY reopen and one real apply whose
response was deliberately hidden. Reopening AWAITING and checking status
issued one `plan.get`, resolved the successful save, and did not repeat apply.
The existing text/reference and independent ZIP checks then passed. The original
record is 660 bytes, SHA-256
b80203ae0c48cf91cf8d3686926ec199d9071f0e06c006cab4b92960f314520b.
The two-member frozen ZIP digest is
sha256:9c27d2f5a905bf214e179848d39488f021534261c77f198a3c96ba981f3b5dad.

The focused SavedView runner passed a real UI keyword-view save, reload,
list/get and backend evaluation returning one actual match. A separate mocked 200-hit evaluation tested
the ceiling disclosure and selected-row export affordance. The shared result
wall is virtualized: `data-listing-count=200` describes the loaded sequence,
not 200 simultaneously mounted rows. This is presentation evidence, not a
200-item real-corpus, backend pagination or full-membership export claim.

Latest served Web assets match disk byte-for-byte: index-CPQwJ_PE.js
(992255 bytes, SHA-256
208aed7819195f90c80c0b148b2e6c0ac518c2c8548d140aacde6168a78bb960)
and index-DmxeW6U-.css (303064 bytes, SHA-256
408af5363bcf46346afac5e50b4754305477030bc97de00e6b05a2c0e036729a).
Artifacts and 1280/390 screenshots are under
dist/composed-intake-20261014/qa-final/. Root reviewed both preview and expanded
composer widths plus the bounded SavedView screenshot. Web build, the i18n
check (1996 keys across 82 files), both tracked harness syntax checks,
`go test -tags purego ./...` and `git diff --check` passed. These checks use the
current dirty source cohort; optional real-provider tests are not implied.
The port-4648 service was inspected read-only; its config/content were not
changed by these fixture runs.

The live readiness audit in
dist/core-goal-audit-20261014/runtime-readiness.json reports lexical READY but
real semantic UNAVAILABLE, no installed runtime provider, and persisted/running
config digests requiring reconciliation. The configured Cairn bundle path is
missing; the retained legacy bundle has an incompatible schema discriminator.
Thus matching Web assets do not establish current daemon or semantic readiness.
PC-07 remains open. The dated tar-member packaging failure is not a current
source defect: focused installer tests now pass exact raw-header provenance
for prefixed/unprefixed names; the historical package was not requalified.

This cohort closes bounded text-file creation and truthful SavedView loaded
scope only. Editing an existing record, tab capture, grouped reopening,
canonical tag/axis query persistence, full mixed-media usability, LinkGroup,
Phase 4/5 qualification and release remain open. Fixture success earns none of
those completion claims.
