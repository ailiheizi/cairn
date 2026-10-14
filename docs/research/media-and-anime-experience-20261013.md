# Media and anime experience candidates — 2026-10-13

Status: informative product research and successor candidates. This document
does not admit a video player, provider, backend route, schema, processor or
runtime extension. Current implementation remains governed by the core plan
and the first-party client contract.

## Product interpretation

The operator wants one private space for many kinds of content, with each kind
comfortable to use: Photos should feel like a photo application, Music like a
music application, and a future video destination like a media library. An
anime experience is a specialization of that future video destination, with
series/episode navigation, optional Bangumi information and optional danmaku.
Alternative layouts can vary while sharing content identity, search, Notes,
tags, original takeout and recovery. An online source aggregator is a separate
job from using retained personal files.

The present UI review found cramped photo names and competing Music tool/action
rows. Closing those concrete gaps is the current implementation slice. Adding
empty destinations or integration buttons would not address the discomfort.

## Primary-source references

| Project | Observed capability | Pattern worth carrying forward |
| --- | --- | --- |
| [Animeko](https://github.com/open-ani/animeko/blob/main/README.md) | Bangumi information, watched-progress synchronization, multiple video sources and danmaku | Open directly into a meaningful watching journey; distinguish title/episode identity from the chosen video source. |
| [Kazumi](https://github.com/Predidit/Kazumi) | Rule-based online anime collection and playback, episode browsing and danmaku | Keep discovery, episode choice and player controls in one coherent destination. |
| [Jellyfin provider identifiers](https://jellyfin.org/docs/general/server/metadata/identifiers/) and [local NFO](https://jellyfin.org/docs/general/server/metadata/nfo/) | Explicit provider identifiers and portable local metadata | Correct mistaken matches explicitly; retain metadata beside usable originals. |
| [Jellyfin Danmu plugin](https://github.com/cxfksword/jellyfin-plugin-danmu) | XML/ASS output and episode-sensitive matching with manual correction | Danmaku belongs to a specific episode/version, and a wrong match needs a visible correction path. |
| [Bangumi API](https://github.com/bangumi/api) | Public API specification and developer documentation | Model enrichment and account writes as separate optional operations. |
| [AutoBangumi](https://github.com/EstrellaXD/Auto_Bangumi) | RSS-based automatic anime downloading and file organization for media-library naming; qBittorrent/aria2 support | A self-hosted vertical owns a recognizable end-to-end job, with dedicated subscription, series and task navigation. |

These are documented patterns, not evidence that their full functionality is
already available in Cairn or that their user demand is validated for Cairn.
No source code or third-party artwork was copied. Repository popularity alone
does not determine priority.

## Candidate sequence and completion meaning

| Candidate | Useful user outcome | Work needed before implementation | Proposed executable exit |
| --- | --- | --- | --- |
| Current Photos/Music polish | Find, inspect/listen, select and take originals without competing UI layers | Existing admitted client contract; no new durable state | Real current-build browse, viewer, explicit audio play, shared-player continuity, selection and narrow/light/dark layout. |
| Personal video library | Browse retained video files and enter a useful player | Reviewed video read/player/resource contract, real codec/fallback behavior; cover extraction and persistent progress need their own contracts | Play an admitted retained video, seek, choose available subtitle/audio tracks, resume only if progress is admitted, and retain original access after decode failure. |
| Anime specialization | One series page with correctly ordered, explicitly associated episodes | Reviewed durable title/episode association and metadata provenance; no filename guess becomes an unquestioned fact | Confirm/correct title and episode match, open the right retained episode, and keep unmatched files usable. |
| Bangumi enrichment | Optional title information and a visible external identity | Provider identity/provenance, explicit lookup/acceptance and retained-source contract | Preview and accept the right title; offline/provider failure preserves the local filename and original. |
| Local danmaku | Play an explicitly chosen bounded XML/ASS sidecar with local media | Parser/render bounds, exact episode/sidecar association and time-offset controls | Choose a sidecar, verify the episode, adjust offset/filter/display, disable it, and continue playback if parsing fails. |
| Account/progress sync | Optional continuity with the owner's Bangumi account | Credentials, write authorization, durable local progress and conflict/retry contract | Confirm the proposed remote change; retry an unknown result safely; disconnect without losing local content. |
| Online source aggregation | Discover/use external video sources | Separate network/source/authentication/product contract; not a hidden ingest dependency | A separately admitted source journey and honest unavailable state. |

The existing bounded audio profile downloads and verifies a complete original
up to 32 MiB before playback. It cannot be relabelled as a general video player.
Large-file video reads, seek/range behavior, codec availability, subtitles and
progress must be designed together before a native video capability is claimed.
Generic preservation/search/takeout of file bytes is not playback acceptance.

## Ownership and layout decisions

The content/recovery plane remains shared. A domain owns its browsing layout
and domain actions; host navigation/search/selection/original actions retain
one authority. Bangumi IDs and episode labels never establish exact byte
identity or authorize deletion. Metadata and danmaku are supplementary content,
not an exact-save prerequisite. Missing covers, facts and providers must leave
useful filename-based browsing and original access.

The current extension path is compiled, reviewed first-party composition;
presentation packages follow ADR-032. This proposal does not create a runtime
plugin loader or a store. First admit the smallest complete media journey,
then add optional enrichment and sidecars. Keep account synchronization and
online aggregation individually selectable instead of requiring them for
local media use.

## Operator-supplied AutoBangumi reference

The operator identified AutoBangumi on 2026-10-13 as the closer NAS/cloud
reference. Its [official overview](https://www.autobangumi.org/) describes RSS
parsing, downloader management, TMDB matching and filenames/directories suited
to Plex/Jellyfin/Infuse. Its [quick start](https://www.autobangumi.org/deploy/quick-start.html)
documents Docker deployment and a WebUI configuration flow. This reference
adds an acquisition/organization job to the earlier watching-app comparisons;
it is not evidence that Cairn already plays or automatically downloads video.

For Cairn, the proposed useful boundary is a complete media destination with
clear library/series/episode actions, optional external acquisition later,
and shared protection/search/original access. A future connection to an
existing acquisition tool should reuse its downloader ownership and expose
finished inputs for explicit inspection/protection; downloader completion alone
must not be represented as Cairn protection. Running RSS/download/rename jobs
inside Cairn remains outside the admitted slice. No external source, credential
or network dependency is added by this research.

The present navigation correction distinguishes global app destinations from
within-library type filters and within-Photos render styles. Dedicated pages
keep the same host header/return entry; ordinary filtering keeps the ordinary
Library composition. Existing query/tag scope remains visible and unchanged
when moving between destinations; a full-library reset remains explicit.

The root reviewer owns product decisions and integration. Local Luna handles
the current Photos/Music implementation and focused browser evidence. Candidate
media work remains visibly proposed rather than appearing as shipped buttons.
