# Product Experience Research

> **Status:** Informative comparison, 2026-09-17. This document records external
> product research and a candidate backlog. It adds no MVP scope, reorders no
> phase, authorizes no new surface, and awards no completion credit. Normative
> requirements and the [Core MVP Execution Plan](core-mvp-execution-plan.md)
> remain authoritative; the external-tool boundary recorded in
> [Remaining Work](remaining-work-and-closed-decisions.md) section 9 applies
> unchanged.

**Method.** Fourteen parallel research agents studied one product or product
family each, using official documentation, source, issue trackers, and — where
a public demo existed — a driven browser session with captured screenshots. The
RestoreWeave side was inventoried by deploying the current build and walking all
fourteen surfaces. Evidence strengths differ per product and are recorded with
each finding; anything unverified is marked as such in the per-product notes.

**Why this matters.** The ordinary user loop is configure -> inspect and protect
exact bytes -> retain names, facts, notes -> search -> select a view or group ->
freeze an export manifest -> materialize and verify -> restore exact bytes. The
research asks one question per product: which parts of that loop do users
already expect, and which do we leave worse than the tools they are used to?

## 1. Products studied

| Product | Standout lesson for us | Evidence |
| --- | --- | --- |
| Immich | Maintenance -> **Integrity Report** (untracked / missing / checksum mismatch, each with Check-Refresh-View, stored-vs-actual digest comparison) is the single best pattern found. It has **no saved searches** and no frozen manifest. | Live demo driven, 21 screenshots |
| PhotoPrism | Originals-as-provenance with sidecars in a separate store so originals mount read-only, plus an **enumerated list of every operation that writes to originals**. Operator search grammar (~60 filters incl. `hash:`), but **no saved searches** and **no duplicate resolution UI** (132 reactions of demand). | Live demo driven, 13 screenshots |
| Paperless-ngx | **No review gate and failed consumption deletes the file** ("a DMS must not throw away anything that was uploaded"). SavedViews are permissioned objects holding structured `filter_rules[]`. Scheduled **sanity checker** with named defect classes. | Docs + source + Discussions (demo Cloudflare-blocked) |
| Jellyfin | Library = "virtual collection of media… from several different locations", bound to a content type; naming and permissions must be right first. `.disc` placeholders keep a missing item visible and described. Scheduled maintenance **removes items while storage is unavailable**, and startup playlist cleanup deletes playlist entries when files are missing. Backups cover database/metadata/subtitles/trickplay — **never the media bytes**. Watched state is lost when a file is replaced or renamed. | Live demo driven; video played; admin screens not reachable (non-admin demo user) |
| OpenList / AList | One-screen storage add with immediate effect, but **validation is weak** (duplicate path = SQL constraint error; failed init leaves a working-looking row) and nothing confirms the bytes stay readable. Task states (Pending/Running/Failed/Waiting for Retry) are worth copying. Password gating is bypassable per surface. | Live demo driven, 8 screenshots |
| Animeko | **Not a library reader** — it owns its own cache; the only deterministic handoff is Jellyfin/Emby with `ProviderIds.Bangumi`. Unmatched files fail silently. | Docs + source + issues |
| Kazumi | Also **cannot read an existing library**; writes its own fixed download layout. Treats `noResult` and `searchFailed` as distinct states; a remote metadata provider as hard identity caused a total outage. | Docs + source + issues |
| Salt Player | Album identity is `ALBUM` + `ALBUMARTIST` tags only — folders do not create albums, and 孙/孫 splits one album. **No m3u/m3u8/pls support**; UTF-8 `.lrc` sidecars and embedded cover art are what matter. DSD and CUE single-file albums are unsupported. | Official pages, store listing, standards doc |
| restic / Borg / Kopia (+ Backrest, Vorta, KopiaUI) | Verification cost and coverage are the recurring pain: Kopia's default verify does not read data, restic's `check` is structural unless asked, Vorta reports only "Check completed." Two-step destructive operations with dry-run previews; restore defaults with an explicit overwrite warning. | Official docs, screenshots, issues |
| Synology DSM / TrueNAS SCALE / Unraid | **Never a bare green check.** A trusted status surface names repository writability, versions, counters, last verified coverage with digests, failing gates with reasons. Persistent status bar + severity-tiered notifications beat dashboards. Never write state into the system volume. | Official help pages, screenshots |
| Sticker / meme ecosystem | A pack handoff has a concrete shape: one directory, order-preserving ordinal filenames, extension by class, plus `pack.json`. Platform limits (512 px, 3 s, 64 KB / 256 KB) are **export constraints, not storage rules**, and belong in a conformance report. | Official format specs, tools, CN sources |
| Hydrus Network | The **duplicate review flow** (one pair, locked zoom, scored comparison statements, false-positive as a first-class outcome, merge previewed before any destructive act) and the **predicate model** (readable predicate list, nestable OR, in-place editing, starred searches, autocomplete with counts). Its recovery story (CLI clone/recover, 15-75% row loss) is the anti-pattern. | Docs + tracker + HN |
| Novel / comic readers (KOReader, Calibre-Web, Kavita, Komga, Legado, Readium-class) | Readers point at **exported copies only** — Komga renames, hardlinks and converts; Calibre-Web-Automated deletes the source. `ComicInfo.xml` lives *inside* the archive, so a generated copy must be a derived export artifact with its own digest. Minimal OPDS 1.2 requirements are documented if a read-only feed is ever revisited. | Official docs + wikis |
| Writing / knowledge tools (Obsidian, Logseq, Joplin, Zotero, SiYuan, Scrivener, assistants) | Four integration shapes ranked by least new surface: materialized research folder, Markdown report with notes, citation sidecar (BibTeX/CSL-JSON), and a **read-only MCP server** over existing search/read. Zotero bridging is sustained, unmet demand. | Official docs + repos + issues |

## 2. What we already do better (keep, and do not trade away)

- **SavedView and ExportManifest.** Two independent photo/document products have
  no saved searches; three have no frozen, verifiable export unit. Our manifest
  is the unit of plan, review, apply, retry, verify and reproduction.
- **Preview-and-confirm everywhere.** The products that skip it are the ones
  whose users report lost files (Paperless consumption, OpenList init failures).
- **Exact identity as the only dedup authority.** Hydrus, PhotoPrism, Immich and
  dupeGuru all mix similarity into deletion decisions and all have complaint
  trails about destroying distinct files.
- **Honest unavailability.** `LINK_ONLY_UNPROTECTED`, `UNKNOWN` with a reason,
  degraded search reasons, and the tiny-image badge are all cases where the
  alternative (silent success) is the documented failure mode elsewhere.

## 3. Candidate backlog

Tier 1 items reuse existing daemon operations and need no new surface.

### Tier 1 — client-side, evidence-backed, admissible now

| # | Item | Loop step | Evidence | Reuses |
| --- | --- | --- | --- | --- |
| 1 | **Search operators + predicate building.** `tag:`, `type:`, `size:>`, `mtime:<`, `dup:`, `path:`, `name:`, `hash:` mapped onto existing filters, with visible predicates, in-place editing, and tag autocomplete with result counts. | search | PhotoPrism (~60 filters), Paperless (Tantivy grammar), Hydrus (predicate model) | `search.query` filters, tag vocabulary |
| 2 | **Integrity / verification report.** Last verification time, coverage (structural / sampled / full), and counts for untracked, missing and digest-mismatched artifacts, with a run-now action, per-scope progress, triggers, last-ran duration and retained logs. | verify, restore | Immich Integrity Report, Paperless sanity checker, TrueNAS ZFS Health, Jellyfin scheduled-task UX (which lost its scan progress, #7944 — do not repeat) | `snapshot.verify`, receipts, closure records |
| 3 | **Activity / job surface.** Running and finished ingest, materialize, verify and restore runs with states (including `UNKNOWN`/reconciliation), cancel, retained logs, **resumable continuation of an interrupted run** (the "continue watching" pattern applied to export/verify), plus a persistent status strip that answers reachability, last save, last verify and running job. | configure, materialize, verify | OpenList tasks, Immich queues, Paperless tasks, TrueNAS Jobs, Unraid status bar, Jellyfin Continue Watching | `job.events`, `job.cancel`, plan/job records |
| 4 | **Duplicate-group review.** Exact-identity groups side by side with path, size, protection state and mtime; decisions are non-destructive (mark canonical/related, tag, note) and never delete bytes. | protect | Hydrus duplicate filter, Immich per-group keep/trash, PhotoPrism's missing UI, dupeGuru hazard | exact identity, `duplicate_group` filter, annotations |
| 5 | **Restore points and restore history.** List restore points with time, item count, size and last verification, show what a restore would produce, and keep a record of past restores with their verification outcome. | restore | Backup tools' snapshot browsing, Immich restore points | `snapshot.list`, `snapshot.diff`, `plan.restore` |
| 6 | **Trusted status surface.** Replace the three status dots with the named facts: repository path and writability, catalog/schema version, subject/file/exact-byte counters, last freeze/materialize/verify with digests, failing gates with reasons, portable-record export state, semantic index `READY`/`NOT_BUILT`/`UNAVAILABLE`. | configure, verify | NAS research's explicit list | `status.get`, `doctor.check`, `capability.list` |
| 7 | **Selection report as Markdown.** Export the current selection as one document: per-item digest, provenance path, tags and notes with source labels, explicit `UNAVAILABLE`/`UNKNOWN` outcomes. | describe, export | Writing-tools research shape 2 | search results, annotations, descriptions |
| 8 | **Tags surface.** Tag list with counts and per-tag subject lists; rename and merge as previewed, reversible operations with honest partial-failure reporting. | organize, search | Hydrus manage tags, Paperless Attributes | annotations (may need a reviewed bulk op, see Tier 2) |

### Tier 2 — needs one reviewed decision each

| Item | Decision needed | Why it is not Tier 1 |
| --- | --- | --- |
| Read-only MCP server over `search` / `content.read` | A read-only token for the loopback adapter, loopback-only binding, and an explicit no-write guarantee | Adds a public surface for external programs |
| Export handoff profiles (anime NFO + Bangumi provider IDs, music tags/`.lrc`, sticker `pack.json`, research folder) | What a profile is, which naming and sidecar policies it fixes, and how it is recorded in the manifest | Requires the sidecar **materializer**, not just the policy field |
| Citation sidecar (BibTeX / CSL-JSON) | Minimum bibliographic field mapping and a deterministic citation-key policy | Depends on the sidecar materializer |
| Bulk tag rename/merge as a first-class operation | Whether it becomes a daemon operation instead of N sequential calls | Sequential calls cannot be atomic or honestly reconciled |
| Per-artifact verification coverage persistence | Where the last-verified coverage is stored and how it binds to a manifest | Touches durable recovery evidence |
| Per-file playability / hand-off hints | Which media facts are extracted and stored as described facts (container, codec, subtitle format, external tracks) and how they are reported per hand-off profile | Needs the processor/extract path, not just a read surface |

### Tier 3 — blocked or out of scope

- **LinkGroup** remains blocked behind the Phase 4 and Phase 5 gates.
- **Semantic search availability** depends on exercising the candidate ONNX/BGE
  bundle; the browser half is ready and reports `UNAVAILABLE` honestly today.
- **Readers, players, feeds, gateways, scrapers, torrents, danmaku, editors,
  sync services**: rejected by the guardrails and again by this research — those
  clients cannot even read a local library in several cases, and the ones that
  can (Komga, Calibre) rename, hardlink or delete while importing, which is
  exactly why they must only ever see an exported copy.

## 4. Patterns deliberately rejected

- Similarity-authorised deletion (Hydrus auto-resolution, PhotoPrism `--delete`,
  Immich CLIP duplicate groups, dupeGuru) — similarity may rank, never decide.
- Copy-on-import libraries that leave the source behind (Hydrus, Eagle) or that
  delete it (Paperless consumption, Calibre-Web-Automated) — our sources stay
  put and remain the provenance.
- Path-rewriting storage templates (Immich) — our paths are projections, not
  organization.
- Gate behaviour that varies per surface (OpenList's WebDAV password bypass,
  hidden files that stay searchable) — a gate that does not hold everywhere is
  not a gate.
- Verification that reports only "completed" (Vorta) or that does not read data
  by default (Kopia, restic) presented as if it did.
- Recovery through external command-line surgery (Hydrus `.clone`/`.recover`).
- Scheduled maintenance that deletes records when storage is unavailable, and
  startup cleanups that drop playlist or collection membership (Jellyfin) —
  outage must produce a visible `UNKNOWN` state, never a silent deletion.
- Dialogs that conflate "remove from this collection" with "delete the bytes"
  (Jellyfin #5040).
