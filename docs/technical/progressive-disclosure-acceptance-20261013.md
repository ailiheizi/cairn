# Library layouts and progressive disclosure — 2026-10-13

## Outcome and boundary

Implemented and locally tested for the admitted client presentation slice.
The active track is RW-PERSONAL-UX-1 UX-C1/C2/D1 and API/WebUI sections
5.3/6. [ADR-039](build-stack-and-architecture-selection.md#adr-039-library-layouts-and-on-demand-search-assistance)
records the relationship and disclosure decisions. No endpoint, schema,
processor, index, durable domain record, runtime extension or core phase
credit is added.

Library is the shared collection. Overview is its aggregate layout, not a
second collection or media domain. Global navigation now contains Library,
Photos and Music. Library's View options contains File view and the enabled
compiled Overview, labelled "分类总览" in Chinese. Library remains active in
either layout. Sorting and applicable grid/list controls live in View options;
Favorite lives in Filters and visible-scope bulk selection in More tools.
Counts, active restrictions, incomplete scope and failures remain outside
those disclosures. The standard count uses plain text; phone controls share
one row beneath it.

The opened search exposes the existing field and submit action, with explicit
Recent searches and Search help controls. Blank/plain prefixes no longer dump
operator choices or local history. Exact operator names and known tag or
protection values retain bounded completion. Technical predicate mappings
move into Help; actual conditions, limitations and errors remain visible.
The parser, request envelope, history persistence and host navigation/actions
are reused.

Two local Luna agents implemented disjoint scopes. The primary reviewer read
their deltas against saved dirty-tree baselines and reviewed final images.
A final scoped CSS adjustment removes the count chip and keeps the three
phone tools together. Unrelated worktree changes were preserved; no commit or
staging was performed.

## Executable evidence

Current-build evidence is in
`dist/progressive-disclosure-20261013/visual-review/final-report.md`, with
the scripts, build log, served-asset comparison, screenshots and detailed
`final-acceptance.json`. Earlier executed checks and their retention limits
are recorded in `validation/checks-already-run.md` under the same cohort.

- PASS: final Web build. Served JS `index-hdWzN-8E.js`
  (`aec20eea977eaaa2d25ad5dd869c9c8192d3ab9859e81607c0a05fa008e77b1f`)
  and CSS `index-v_R4nbEa.css`
  (`4fadee3ee894dd41d1f738af986b26e86ae9d6cdc1a55942b4079aead55bf6b2`)
  match `web/dist` byte-for-byte.
- PASS: exactly three global entries; Overview is reached through View
  options, keeps Library active and has no ineffective grid/list switch.
- PASS: submitting `Cairn` sends exactly one `search.query` POST. Closing
  search and switching Overview → File view sends no further search and
  retains the field text.
- PASS: blank and `ta` show no automatic suggestion/history panel. `tag`
  shows one related completion. `unknown:value` has a visible search error
  outside Help and Enter sends no request. Help opens and closes.
- PASS: eight final screenshots cover default Library and blank search at
  390×844 / 1280×800, light/dark. Document widths match viewport widths;
  primary image review confirms the phone count and three-tool hierarchy.
- PASS: i18n literal coverage, compiled registry checks and `go test ./...`
  ran before the final CSS-only correction; Go results were cached. Their
  actual tool results are summarized in the handoff record, not represented
  as retained raw stdout. No unrelated suite was rerun for that CSS change.

## Limits

This uses isolated headless Chromium and the retained twenty-item local
development fixture, not native CUA, large-library, semantic-default or
release qualification. Recent-history pick/remove/clear, the complete
keyboard matrix, tag mutation, original takeout and playback were not rerun
in this cohort; prior acceptance remains separately dated. The floating
search panel intentionally overlays content until dismissed. Complete
Photos/Music workflows and the core/recovery gates remain open.
