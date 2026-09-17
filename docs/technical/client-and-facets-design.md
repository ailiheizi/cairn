# Client and Facet Composition Design

> **Status:** Informative design record, 2026-09-18. It records four parallel
> research passes (all-in-one aggregator clients, facet composition and timed
> formats, a client architecture over this plane, and the handoff-strategy
> comparison) and proposes a staged path. It adds no MVP scope, authorizes no
> new surface, and awards no completion credit. The normative contracts and the
> [Core MVP Execution Plan](core-mvp-execution-plan.md) remain authoritative,
> and the external-tool boundary in
> [Remaining Work](remaining-work-and-closed-decisions.md) section 9 applies
> unchanged.

## 1. Why a client can be composed at all

The operator's hypothesis is correct and the research found the mechanism that
makes it true: **every aggregator that stayed stable has one owner of a stable
item identity, and every facet attaches to that identity.** Stremio uses ID
namespaces, Jellyfin uses one `BaseItemDto` that 15+ independent clients render,
Animeko borrows Bangumi's subject id.

The two loudest failures use the *source* as identity instead. Mihon and
Legado key an entry to `(source, url)`, so when a source dies the entry dies —
Mihon issue #1837 asks in the user's own words for what this plane already has
("linking them under one entry"), and Legado's ecosystem tells people to export
to TXT before sources die. Legado's public repository now contains only a legal
notice, and `iwxyi/MagicalDanmaku` is archived with a Bilibili IP notice.

**This plane owns exact byte identity (SHA-256 + logical length) and provenance
separately from the bytes.** That is precisely the stable anchor a facet-rich
client needs, and it is why the client can add and remove facets per content
type without re-deriving identity from paths, sources, or filenames.

## 2. The page model

One page skeleton — subject, exact-identity anchor, header, one primary
open/read action, an ordered facet list — plus a **closed facet registry**:

| Facet field | Meaning |
| --- | --- |
| `id` | closed set of facet names (video, audio, text, image, subtitles, timed-text, comments, progress, metadata, related) |
| `subject` | the stable subject the page is showing |
| `bindings` | the exact-identity anchor plus any part identifier (episode, track, chapter) |
| `state` | `SUPPORTED` / `UNAVAILABLE` with a reason / `NOT_APPLICABLE` / `EMPTY` with a reason |
| `source` | `DAEMON_OP` / `LOCAL_SIDECAR` / `USER_INPUT` / `DERIVED` |
| `paging` | none / offset / time-window / thread |
| `writes` | read-only / user-authored / imported-versioned |
| `format` | media type, format id, format digest |
| `capabilities` | what the facet needs from the renderer |

The same page then serves: an anime episode (video + subtitles + timed-text +
comments + progress), a film (video + subtitles + comments), a music track
(audio + timed lyrics + comments), a novel chapter (text + comments + progress),
a photo (image + comments + tags). Jellyfin's item page is already a literal
list of conditionally rendered sections; Stremio models the same thing in data.

## 3. What this plane can feed today

| Facet | Source today | State |
| --- | --- | --- |
| bytes (video, audio, image, text) | `content.read` ranges through the typed dispatcher (1 MiB per call, 15-minute handle TTL) | available; **not** reachable through the read-only MCP allowlist, which is a frozen nine-operation list |
| comments | `NOTE` annotations | available; flat — no threading, no timestamps |
| progress | `PROGRESS` annotations | stored and versioned, but **opaque and invisible**: one live record per subject, unvalidated body, deliberately excluded from search indexing, no CLI verb, no browser surface |
| subtitles | an exact file subject beside the video | available as file bytes; naming convention only |
| timed text / danmaku | an exact file subject (`.xml`/`.json`) beside the media | proposed minimum, see §4 |
| metadata | `audio.list` (real title/artist/album/duration); descriptions and extracts for text; EPUB yields OPF only; no EXIF processor; no lyric parser | partial, degrade honestly per type |
| collections | tags, saved views, export manifests | available |

## 4. The two decisions that matter most

**Danmaku lives as an ordinary exact-file subject**, not as a derived
representation and not as client-local cache. Reasons: client-local cache
repeats the surrogate failure above; a derived representation would need a
processor capability, digest route, attempt record, and fencing for data this
plane did not produce; and the published Bilibili protobuf schemas disagree on
field numbers, which is a format-digest hazard. Storing the track as bytes —
never protobuf, never fetched or served by the plane — keeps the plane out of
the IP exposure that shut down the two projects named in §1. One reviewed
decision remains: recording that a track *is* the sidecar of one exact media
identity (a durable relation), so it desyncs visibly instead of silently when
the media bytes change.

**Progress is valid only for the identity it was recorded against.** Every
mature client keys resume state to a surrogate (file path in Kodi, item row in
Jellyfin, chapter row in Mihon, URL in NewPipe) and breaks when the file is
replaced. The client should write a self-describing envelope
(anchor content id, part, unit, position, total, finished rule) through the
existing annotation operation; on open, an anchor mismatch reads
`UNAVAILABLE(reason)` and never a guessed offset. A copy at a new path keeps
its own record but shares the anchor, so "continue from the other copy" is a
lookup, not a migration. Validating that envelope is the second reviewed
decision.

## 5. Handoff strategy

Recommended: **materialized export plus a handoff descriptor is the primary
investment, and a LAN mount carries that export — never the repository.**

- The repository stores `blobs/sha256/<prefix>/<hex>`; a mount of it is a hex
  directory, not a library. Only a frozen manifest materialization produces
  real, verified names (records already implemented and tested).
- Client state keyed to paths strands on rename (Kodi bookmarks, Jellyfin
  watched state, KOReader sidecars), so the descriptor and the manifest stay the
  durable layer while the folder is disposable.
- Contributing PRs is refused as a strategy: Animeko 47 open PRs (oldest
  2024-12), Kazumi 28, KOReader 75 (oldest 2022), Jellyfin 273 (oldest 2022) —
  and Animeko and Kazumi cannot read a local library at all, so the
  deterministic path for them runs through Jellyfin/Emby with provider ids.
- Building a full player client now is deferred: it needs range streaming, the
  facet projections, playability facts, and digest-keyed timed text — a player,
  a reader, and a music app the operator would maintain forever.

## 6. Staged path

| Stage | Content | Exit test |
| --- | --- | --- |
| 0 | The page skeleton and facet registry, with facets fed only by records that already exist: bytes, subtitles (file subject), comments (`NOTE`), progress (client-written `PROGRESS` envelope), metadata. No new durable state. | A real episode with an external subtitle, a danmaku file subject, two comments, and a resume position renders every facet with its honest state, and a byte-identical copy at another path reuses the progress record through its anchor. |
| 1 | Two reviewed decisions: the sidecar-of-media relation for timed text, and the validated progress envelope. Then handoff profiles beyond `handoff-v1:manifest-json` (music lyrics/playlist, anime NFO with provider ids, sticker pack manifest, citation files) on the materializer that already exists. | Each profile materializes, verifies byte-for-byte, and fails closed on tamper; the progress envelope rejects a malformed or mismatched anchor. |
| 2 | Grouping-dependent experiences (series/album/season as a maintained object). | Blocked: the minimal LinkGroup is still gated behind the Phase 4 and Phase 5 closures. |

## 7. Boundaries the client must never cross

No second catalog, policy, job, or recovery state machine; no scraping,
resolving, or serving of third-party sources; no account or profile system; no
transcoding farm; no add-on registry that can install arbitrary code (Kodi
issue #17677 is the supply-chain cautionary tale: a third-party repository
shipped an add-on that mined coins); no facet that invents a fact the daemon
does not report.

## 8. Open question for the operator

The "software that stuffed a lot of needs into one app" seen in the Chinese
video is most likely **BoxPlayer** (cloud drives + media library + downloader +
player + danmaku search + subtitles + music + EPUB/PDF reader + photos in one
console). uTools-class toolboxes are the other candidate. What would confirm it:
whether the video showed a **file browser** at the centre (BoxPlayer), a
**command box** (uTools), or a **poster grid** (an anime client).
