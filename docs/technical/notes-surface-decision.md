# Notes Surface Decision Brief

**Authority rank 7 (informative).** A decision brief for the operator: it adds no
scope, reorders no phase, weakens no normative contract, decides nothing by
itself. Operative requirements stay in the ranked documents cited below.

Question: should Cairn be a notes app; if so, how far — a read-only
cross-subject view, or note-taking machinery (standalone notes, notebooks,
backlinks)?

## 1. What already exists

| Capability | Where it lives | Anchor |
| --- | --- | --- |
| User notes: durable, revisioned, tombstoned | `annotations`, kind `NOTE` | `sqlite/migrations.go:601,1424`; `sqlite/annotations.go:19,217` |
| Imported/extracted/model descriptions | `description_documents`, `semantic_segments` | `sqlite/migrations.go:933,965` |
| The one `Notes` surface (subject-scoped) | merged list, source labels | `web/src/components/DetailsPanel.tsx:180-210,246,268-287` |
| Note write path | `annotation.upsert` / `annotation.delete` | `controlplane/catalog_ops.go:160`; `web/src/app/useDetails.ts:200-216` |
| Description write path | `description.create` | `controlplane/description_ops.go:120` |
| AI note path | `description.generate` via the egress gate | `controlplane/description_ops.go:480`; commit `f9a093e` |
| Cross-subject reads already exist | both list workspace-wide when `subject_ref` is empty | `catalog_ops.go:132-157`; `description_ops.go:55-93` |
| Search participation | notes/descriptions axes, pinyin, semantic | `search/dimensions.go:74-75`; `search/indexer.go:507,684-706,1504` |
| Cross-subject browser precedent | `TagsSurface` reads `annotation.list` workspace-wide | `web/src/components/TagsSurface.tsx:18-49` |

No global notes list exists today, and every annotation write resolves its
subject through `resolveSubject` (`server/controlplane/dispatcher.go:1379`): a
note cannot exist without a resolvable file or directory subject.

## 2. Gap list

| Convention | Verdict and frozen line |
| --- | --- |
| Global notes list across subjects | **Fits** as a read projection; the reads exist and `TagsSurface` already uses them cross-subject. **Needs a decision** because it adds a rail entry. `AGENTS.md:25-27` "Organization belongs to stable subjects, tags, descriptions, minimal link groups, relations, and saved views." |
| Notes attached to no file | **Does not fit.** Needs a non-entry subject kind, hence a new durable subject. `docs/requirements/core-kernel-and-interface.md:513` "Whole-subject user tags and plain-text notes are required durable semantic data in `RW-MVP-1`. They bind stable subjects…" |
| Notebooks / folders / hierarchy | **Does not fit.** A second organization tree beside tags and views. `AGENTS.md:70-71` "Daily organization is content-first and multi-tag-first." |
| Backlinks between notes | **Does not fit as proposed.** Edge kinds over note records would be a new durable relation family. `AGENTS.md:171-172` "richer Collections, nested groups, dependency graphs, roles, ratings, or automatic grouping beyond the minimal planned LinkGroup" (outside the core queue) |
| Per-note rich text | **Does not fit.** Plain text with a `sha256` body digest; no markup contract. `core-kernel-and-interface.md:513` "plain-text notes" |
| Templates | **Needs a decision**, cheapest honest answer no: client-side, no durable record, but it serves prose authoring, not the loop. `AGENTS.md:30-31` "If a proposed change neither improves this loop nor closes one of its recovery or safety gates, keep it outside the core queue." |
| Daily notes | **Does not fit.** A date-addressed non-file subject: same objection as row 2. `core-kernel-and-interface.md:513` "They bind stable subjects…" |
| General editor / writing tool | **Does not fit.** Text outside subject attachment is a second free-form text concept. `docs/requirements/api-and-webui.md:178-186` "There MUST NOT be a separate Description page, setting, search mode, or duplicate copy of the same text solely for presentation." |

## 3. Options

**A. Notes stay as they are.** Cost: zero. Notes remain reachable by search (the
`notes` axis is indexed, pinyin-enriched, and semantically embedded) and through
the file they annotate; a user who remembers a note but not its file has no
browsing path. Within every frozen line.

**B. Read-oriented global Notes view** — one bounded browser surface listing
notes and descriptions across the workspace with source labels, tag filters,
search reuse, and "open the file" navigation. It needs exactly four existing
reads, all present: `annotation.list` with an empty `subject_ref` (full bodies
for `NOTE` rows, unbounded), `description.list` with `limit`/`truncated`
(summaries carry no `body`, so a row expands through `description.get`),
`search.query` with `construct_axes` `notes`/`descriptions` for the text filter,
and the existing selection flow for navigation. Tag filtering is a client-side
intersection over the same rows, exactly as `TagsSurface` already treats its
substring filter as a view over the list. It must **not** add a durable record
type, a second search mode, a second copy of any text, a `Description` screen,
or an editor that writes text not attached to a subject. Two honesty
constraints: `description.list` orders by `subject_ref, revision`, not recency
(`descriptions.go:396`), so "recent notes" is not expressible without a daemon
read change; and the surface must say it shows what the daemon returned, never
"all notes". Cost: one surface plus its seam; no daemon, schema, or state-machine
change.

**C. Full note-taking** — standalone notes, notebooks, backlinks, templates,
daily notes. It violates the single-`Notes`-surface rule (a second free-form
text concept), subject binding (`core-kernel-and-interface.md:513`), and "Do not
add a second live metadata or recovery database merely to mirror the logical
layers" (`AGENTS.md:90-95`); it lands in the list of things that "remain outside
the core queue" (`AGENTS.md:166-172`). The cost is a new durable subject kind,
schema and migrations, portable-closure and signing work, backup/restore
evidence, and a product surface the frozen loop does not name — out of the core
queue unless the operator changes scope.

## 4. Recommendation

Choose **B, and only B** — a read-mostly cross-subject Notes view built entirely
from `annotation.list`, `description.list`, `description.get`, and the existing
`search.query`, with no new durable record and no daemon edit — because it
answers "can notes live inside Cairn?" at the cost of one browser
surface, while A leaves notes unfindable except by search and C breaks frozen
decisions. The strongest counter-argument, to weigh first: the frozen loop
already sanctions "search lexical + structured + semantic information" as
discovery, `Notes` already participates in that search, and a browse list is
therefore a convenience for a workflow the loop does not require
— so the disciplined answer is A until the operator personally misses the list.
If what the operator wants is to write prose inside Cairn rather than
find notes attached to content, B will not satisfy it, and the honest answer
becomes C with an explicit scope change rather than a slice.

## 5. Proposed first slice (Option B)

- **Active phase:** none of the numbered lock phases. This is the bounded
  browser client permitted by `AGENTS.md:167-169`, landed as a convenience view
  like `TagsSurface`; not Phase 6 qualification and not a new product surface.
- **Normative requirement:** `docs/requirements/api-and-webui.md:178-186` (one
  `Notes` surface; no separate Description page, setting, search mode, or copied
  text) with `docs/requirements/content-store-views-and-exports.md:608-610`.
- **Exit test:** a new `scripts/e2e/notes.mjs`, imported by
  `scripts/web-e2e.mjs` and run opt-in via `scripts/web-e2e.sh`, asserting:
  every row is a live daemon record with its source label; the surface issues
  only `annotation.list`, `description.list`, `description.get`, and
  `search.query`; a note seeded through `annotation.upsert` appears with its
  subject's name; a tag filter shows exactly the subjects carrying that tag; a
  row click opens that subject's details; and no control that creates a durable
  record exists.
- **Files:** `web/src/components/NotesSurface.tsx`, `web/src/styles/notes.css`,
  `web/src/i18n/notes.ts`, `scripts/e2e/notes.mjs`, plus the seam edits
  (`web/src/lib/types.ts` `ViewMode`, `web/src/components/WorkspaceRail.tsx`,
  `web/src/main.tsx`).
- **Size:** one surface and its seam, smaller than `TagsSurface` (no plan/apply
  pair) — roughly 400-500 lines of UI plus the e2e module. Recency ordering or
  description bodies in the list would be a daemon read-contract change,
  reviewed separately before the slice.
