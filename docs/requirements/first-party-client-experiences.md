# First-Party Personal Client Experiences

## 1. Profile and admission

`RW-PERSONAL-UX-1` is the single-operator local browser development profile,
admitted 2026-10-09 following the operator's acceptance of the complete
personal-platform direction and instruction to implement with multiple Luna
agents. It composes the existing typed content and discovery kernel. It is
separate from `RW-MVP-1` release qualification and does not change its exact,
storage, semantic, recovery, or LinkGroup gates.

The product target includes complete Photos and Music workflows. This first
admitted slice supplies dedicated presentation, bounded continuous photo
inspection, bounded explicit audio playback, and existing saved-query access.
It MUST NOT be reported as complete Photos, complete Music, a media server,
or a qualified distribution. Normative scope here takes precedence over older
informative browse-only/maintenance schedules for these specific client tasks.

MUST/MUST NOT/SHOULD/MAY express normative requirements.

## 2. Shared authority and migration analysis

All content, subject/file-version resolution, protection, facts, tags, Notes,
search, download, export and recovery remain host-owned. The browser uses the
existing `/api/v1` typed dispatcher and exact-original download route. It adds
no endpoint, provider, processor, durable catalog, schema, recovery format,
job/policy lifecycle, source rewrite, or second metadata store. Thus this
slice requires no durable migration or signed-record successor and MUST NOT
reinterpret existing facts or change profile/provider digests.

Playback and viewer controls are transient client presentation state, not
kernel commands or protection receipts. Every byte read remains subject to
existing adapter authorization, workspace/snapshot binding and bounded reads.
Failures MUST remain visible. Exact preservation MUST NOT depend on decoding.
Unknown formats remain available through authorized original takeout.

## 3. UX-P1: Dedicated Photos and continuous inspection

Photos MUST render a distinct image-focused wall over the loaded shared
subjects, with useful density adjustment and truthful format/count scope.
Filters MUST retain their original row/subject mapping for shared selection
and Details. No capture date, EXIF field, album, location or artwork may be
invented from a filename or absent fact.

Explicit image inspection MAY show a large focused viewer and next/previous
through its current result sequence. It MUST reuse the existing inspector
read/identity checks, retain the 8 MiB selected-image ceiling, and retain the
1 MiB automatic-thumbnail ceiling. Larger or unsupported content MUST have
an explicit unavailable preview and original/Details action. Automatic large
photo derivatives are not admitted by this slice.

Escape/close MUST restore usable focus and browse context. Arrow navigation
MUST be scoped to the viewer and not consume input-field interaction. Narrow
layouts MUST retain reachable actions without horizontal page overflow.

**Exit:** real retained images -> density/filter -> open -> next/previous ->
return to browse context, plus unsupported/oversized fallback and accessible
original/Details actions. Synthetic data may test behavior but cannot establish
real-photo thumbnail coverage or complete Photos usability.

## 4. UX-M1: Dedicated Music and bounded client playback

Music MUST present recognizable track rows over the same loaded subjects and
offer actual supported play actions. Use recorded filename, size, format and
tags until reliable music facts are returned. Do not fabricate album/artist,
cover, duration, listening counts or inactive navigation pages.

An explicit user play action MAY fetch one exact regular-file original through
`GET /api/v1/download` using its existing workspace/entry/filename parameters.
The client MUST require the existing canonical `sha256:<64 lowercase hex>`
loaded identity and known nonnegative
logical length of at most 32 MiB. One request and one active Blob are allowed;
the response body MUST be read with a hard byte ceiling, checked against the
expected full length and SHA-256 before creating a playable Blob URL. MIME
selection MUST be limited to declared audio formats and native decoder failure
reported honestly. This is a bounded downloaded-original playback profile,
not streaming/range playback, transcoding or universal format support.

The existing download route keeps its complete verification and scoped typed
reads; no caller-supplied handle/path/content-ID query or authentication bypass
is added. Authentication failure remains an error. Blob seeking is local after
complete bounded loading. Large/unknown-size/unsupported files retain original
takeout and MUST NOT start an unbounded fetch or a background decoder.

An App-owned player MUST visibly retain current identity, play/pause, seeking,
volume, stop and error/loading state while navigating content and switching
bundled interfaces. Entering a page MUST NOT start playback. The client MAY
maintain an explicit transient queue, but it MUST NOT persist playlists or
session state in another catalog or claim recovery/synchronization semantics.

Replacement, stop, unmount, workspace change or unrecoverable read/decode
failure MUST abort the pending request, stop obsolete media, revoke Blob URLs
and prevent stale callbacks from replacing the current track. Continuing
audio requires reachable visible controls. Browser playback success does not
change protection, verification or release status.

**Exit:** actual supported local audio -> explicit play/pause/seek/volume ->
client navigation with visible retained controls -> stop/replacement, including
identity mismatch, size ceiling, unsupported format, cancellation and stale
request behavior. The queue/album/playlist full baseline remains outstanding.

## 5. UX-R1: Daily saved retrieval

Users MUST be able to list and recall existing named SavedViews without file
selection or opening Export. Save/evaluate reuse current typed operations and
one host-owned durable record. Save MUST retain supported conditions/scope or
visibly refuse unsupported active conditions; it MUST NOT silently lose filters.
Dynamic lexical evaluation MUST NOT be described as frozen semantic membership.
Loading/error/empty outcomes remain visible; rename/delete are not invented.

**Exit:** save a supported named query -> leave/refresh -> open retrieval
directly -> recall its dynamic lexical query without internal IDs. New matching
content may change membership. Unsupported active conditions are refused.

## 6. Full-domain successors and explicit exclusions

Curated photo albums, ordered playlists, favorites, retained listening state,
new metadata/artwork/lyrics extraction and
retained ordinary-photo derivatives remain baseline product targets in
[the platform map](../research/personal-content-platform-20261009.md). They need
separate durable/processor contracts, recovery/migration treatment and admitted
exit tests before implementation. This slice does not grant their schemas or
collapse them into a generic Collection or minimal LinkGroup.
UX-M2 below separately admits browsing artist/album facts already returned by
the existing projection; it does not admit new extraction, complete metadata
coverage or durable album membership.
UX-P2 below separately admits bounded transient PNG/JPEG renditions without a
new processor or durable artifact. Its browser evidence does not satisfy a
retained-derivative or full photo-metadata contract.

Image/acoustic indexes, media range/transcode endpoints, mobile background
backup, remote exposure/authentication profiles, protocols/gateways, runtime
extensions, multi-user tenancy, source deletion and destructive collection
remain excluded. None becomes an exact-save dependency.

## 7. UX-E2/M2: Open-ended bundled pages and everyday listening

Admitted 2026-10-09 following the operator's instruction to continue useful
features and independently extensible, unusual interface presentations. This
is a client-only successor within this development profile; it changes no
durable schema, backend operation, provider, processor or signed record.

The client MAY register additional compiled, trusted first-party pages through
a namespaced page/presentation catalog. A page declares its stable ID, route,
navigation label, existing loaded-content context and renderer. Registration
MUST reject duplicate IDs/routes/slots and host-reserved collisions before
exposing contributions. Existing `photos`/`music` links remain compatible;
unknown or disabled page links fall back to the shared content library.
Adding a compiled page MUST NOT require another App state authority or a
page-specific branch in the host's routing/selection policy. Source registration
is not runtime package installation or a qualified public extension SDK.

The two admitted whole-interface layouts MAY be registered through a separate
compiled shell catalog, with stable IDs, renderer slots and browser-only
preferences. Unknown preferences normalize to the workspace fallback; duplicate
IDs/renderer slots or missing compiled renderers MUST be rejected. A page MAY
request immersive chrome, provided host search, navigation, selection, Details,
Notes, original actions and the shared player remain reachable. Immersive chrome
is host composition, not a page-owned policy or state authority. Additional
shells remain trusted source contributions under the same contracts, not
runtime packages or security-isolated plugins.

A photo exhibition MAY present the loaded image context using a focused
spatial or corridor arrangement, with at most 48 bounded automatic thumbnails
mounted in a moving window and explicit existing inspector reads. The window
MUST NOT prevent navigation through the complete loaded image context. It MUST
expose truthful limited-window
scope, keyboard and reduced-motion use, a normal-wall fallback, and reachable
Details/selection/Notes/tags/original actions through host entry points. Dates,
albums and artwork MUST NOT be inferred or invented. Same-context presentation
switches MUST retain host selection, subject focus, Details/Notes drafts and
active player. Error boundaries supply presentation recovery, not confinement
of malicious JavaScript. Third-party runtime loading is not admitted.

Music MAY present artist/album/track navigation from the existing `audio.list`
projection only. Facts MUST be matched to current authorized loaded subjects;
absent/failed facts retain filename rows and visible unknown/unavailable state.
No album membership, artwork, metadata authority or persistent playlist is
created by grouping recorded facts. Metadata loading MUST NOT gate playback
of otherwise supported known originals.

The transient queue MAY support reordering, explicitly shuffling upcoming
items, repeat off/all/one, and playing the currently displayed supported set.
Reordering/shuffling MUST retain the playing file identity and audio position.
Repeat-one applies to automatic completion; manual Next still advances.
Unsupported, oversized or unknown-length entries are accounted for honestly;
playing a loaded set MUST NOT claim complete server-library membership.
Refresh/workspace change still clears listening state. All original playback
identity, byte ceilings, cancellation and visible decoder-failure rules remain.

**Exit:** photo wall -> exhibition -> select/focus -> shared Details -> return
with held work; compatible deep link, registration conflict and renderer-failure
fallback; current music set -> queue reorder/shuffle/repeat -> navigation and
stop without identity/position loss; actual returned audio tags -> artist/album
filter -> supported playback, plus absent-fact filename fallback.

## 8. UX-T1: Bounded original ZIP takeout

Admitted 2026-10-09 following the operator's instruction to implement the next
useful personal-client features with Luna. This client successor reuses the
existing `export.plan` and exact-original download contracts. It MUST NOT add
a manifest schema, endpoint, durable job, receipt authority or recovery record.

An explicit download action MAY freeze the current selection through
`export.plan`, then package its exact originals into one uncompressed ZIP.
The existing summary's JSON-encoded items provide frozen output names,
content IDs, lengths and legacy snapshot-local entry references. The browser
MUST validate every item and match it to the captured authorized selection;
it MUST reject silently omitted, changed, non-exact or unresolved members.
It MUST use frozen names, reject unsafe/archive traversal names and collisions,
and verify each complete response against the frozen length and SHA-256.
It MUST NOT re-evaluate membership or substitute a new entry after a failure.

The initial development budget is one workspace, at most 32 files, at most
32 MiB per file and 64 MiB of original bytes in total, with one transfer at a
time. Unknown length/identity and over-budget selections MUST be refused before
reading bytes. ZIP construction is transient browser state; the budgets are
enforced ceilings, not measured performance guarantees. Large files retain
the existing single-original download and server-directory export actions.
Zero-length files MUST retain their valid exact identity.

Progress and cancellation MUST remain reachable during client navigation.
Cancellation, workspace change and member/validation failure MUST prevent an
archive download; there is no partial-success archive. The client MAY state
that the verified ZIP is prepared and its browser download requested. It MUST
NOT claim a successful disk save from an anchor click, nor issue an
`export.apply`/`export.verify` receipt for this client action. Existing durable
manifest/history semantics remain unchanged; a manifest summary is not an
authenticated portable recovery record. No new sidecar is invented.

**Exit:** real selected files -> existing frozen manifest -> one observable
ZIP download -> independently extract and compare every length/SHA-256 to
the selected originals, including duplicate names, plus stale identity,
unsafe name, cap, member failure and cancellation without a success result.

## 9. UX-P2: Useful ordinary-photo thumbnails

Admitted with UX-T1. Photos and Exhibition MAY automatically render PNG/JPEG
originals above the unchanged 1 MiB thumbnail budget using a separate transient
browser rendition path, only while their cards are visible. The original input
ceiling remains 8 MiB. Existing typed content sessions, complete length/hash
verification and authorization MUST be reused before any decoding.

Before decoding, the client MUST parse PNG/JPEG dimensions and reject unknown,
invalid or over-budget headers: at most 12 million pixels and 8192 pixels on
either dimension. It MUST bound transmission to two tasks and decoding to one
task, downsample to at most a 1024-pixel edge, and retain only a rendition of
at most 512 KiB in a separate 48-item (at most 24 MiB) session cache. Original
large-image Blobs MUST NOT enter the existing thumbnail cache. These resource
ceilings constrain accepted inputs/cache; they do not guarantee browser RSS.

Unmount, cancellation and workspace/context replacement MUST prevent stale
rendering and release obsolete handles/URLs. Unsupported, oversized, corrupt
and unreadable images keep visible fallbacks and reachable Details/original
actions. Explicit inspector reads retain their 8 MiB ceiling. Native image
orientation may be used for presentation but MUST NOT be described as a new
recorded EXIF fact. No processor, retained derivative, metadata field or
signed-record successor is added. Selection/subject focus remain host-owned.

**Exit:** retained PNG/JPEG inputs above 1 MiB -> actual wall and exhibition
renditions -> shared explicit inspector, with unchanged original identities;
dimension/byte boundary, malformed-header, cancellation and decode-failure
checks. Sample evidence establishes only the tested formats and cases.

## 10. UX-C1: Domain presentations over a shared result scope

Admitted 2026-10-09 following the operator's instruction to continue the
experience and discuss domain-specific, independent and aggregate pages with
Opus 5.5. This is a client-only refinement of UX-E2/M2. It adds no durable
format, endpoint, provider, processor or recovery meaning.

A compiled contribution MAY be an independent page or an alternative
presentation of an existing domain page. A presentation MUST declare a
registered root page with the same loaded context and media class. Missing
parents, parent chains/cycles and incompatible contexts MUST be rejected.
Domain navigation MUST group its presentations instead of creating another
top-level destination for each renderer. Photos groups Photo wall and
Exhibition; reviewed independent and aggregate pages remain possible. Existing
page IDs, routes and browser-local disabled IDs retain their meaning. A disabled
wall MUST NOT silently disable or re-enable an independently enabled Exhibition;
the Photos entry resolves an enabled presentation, and settings expose those
choices separately. If no presentation is enabled, the domain entry is hidden.

The host MUST distinguish result scope from presentation. Existing keyword
search and tag/facet results MAY use the currently selected Photos or Music
presentation. Switching presentation over one result scope MUST NOT rerun the
query, silently clear its conditions or create another query/selection authority.
The initial search admission is explicitly a media projection over the returned
results, preserving their relevance order, not an exhaustive server-side domain
query. The client MUST disclose returned-result scope and offer all-types access.
Clearing a condition and leaving the domain are separate user actions. Existing
draft guards, authorized subject mappings and resource ceilings remain in force.
Same-domain presentation switches retain held focus, selection, Details/Notes
drafts and the global player. Context replacement retains the existing draft
guard and cancellation rules; it MUST NOT preserve obsolete byte-read authority.

Missing search-result logical lengths MAY be supplied only from the current
authorized loaded workspace using an identical subject, entry and canonical
content identity. Conflicting, ambiguous, mismatched or unresolved tuples remain
unknown. This is a transient display/action projection, never a durable fact or
permission to substitute current bytes for a different search hit. SavedView
creation MUST explicitly refuse any active presentation-domain restriction that
its existing saved query cannot express; it MUST NOT silently save a broader set.

Search/tag deep-link convenience MAY include a registered presentation route;
it MUST retain the original query/tag semantics and contain no internal subject
IDs. Unknown or disabled presentations fall back to all types in the same scope,
never silently discard the query. Old `#v=exhibition` links remain compatible.

Aggregate compositions are a planned subsequent client slice: fixed templates
may consume host-provided scope selectors, shared actions and global resource
budgets. This admission does not implement a block SDK, layout editor, runtime
installer or third-party isolation. Reusable blocks and whole-interface shells
remain distinct contribution roles; none may replace the host's data authority.

**Exit:** Photos wall -> Exhibition -> keyword search -> same photo
presentation over returned results -> all-types/Music switch without query
loss or rerun -> tag/facet filter with retained presentation; compatible reload
and disabled/unknown presentation fallback; safe tuple joins leave mismatches
unknown; held same-domain work and player remain usable. Record which routes
actually pass browser acceptance; helper tests alone are not experience proof.

## 11. UX-C2: Fixed mixed-content overview

Admitted 2026-10-09 following the operator's instruction to continue the
personal product. This is the fixed-template successor anticipated by UX-C1,
not a durable-domain or runtime-plugin admission. It changes no endpoint,
schema, processor, signed record or recovery meaning.

The client MAY register one trusted compiled Overview page over the same
loaded/search/tag scope with `mediaClass: all`. It is an aggregate browse
layout, not an extra media type. Navigation MUST distinguish that layout
from Photos/Music domain destinations. Existing All types remains available.
The initial template has fixed photo, audio and other-content sections, using
the host's existing media classifier, returned order and authorized rows.
Counts MUST describe the current scope; no completeness, recency or captured
fact may be inferred from sample order or file names. Empty blocks and disabled
domain presentations MUST remain understandable. A Photos block is available
while any compatible Photos presentation is enabled; domain actions MUST
resolve an enabled registered presentation and MUST NOT enable hidden ones.

Every section receives one host scope and typed host actions. It MUST NOT run
its own search, maintain another membership/selection authority, reload music
facts, mount an audio player or implement its own byte-read/cache route. At
most six photo thumbnails may be mounted by the initial template. They reuse
the existing verified PhotoThumbnail pipeline, global concurrency/cache and
UX-P2 limits. Audio rows consume existing recorded facts with filename/unknown
fallbacks, and playback/queue actions use existing eligibility and the one
global verified-original player. The audio preview list is bounded to six
rows; play-this-section includes only those displayed eligible tracks, never
a silently different hidden set. Other previews are bounded to six rows.

Selection and Details/Notes actions resolve the original index/subject in the
host-rendered scope, not a subsection-relative index. Existing guards apply
when leaving a domain, replacing scope or opening another subject with an
unsaved draft. Changing the aggregate layout alone MUST NOT write content or
discard the current query. Fallback presentation notices MUST clear when a
valid user-chosen destination succeeds, without dismissing unrelated errors.
Initial hash restoration MUST retain the incoming composed link through the
asynchronous query; it must not serialize a transient broader listing as the
restored search or erase the incoming conditions on failure.

**Exit:** Overview of a current mixed search/tag scope -> select/open a photo
through shared Details -> verified audio playback -> browse a domain and return
with the query intact and no second query -> preference-aware blocks/routes
and honest empty state. Observe at most six photo thumbnails and one player,
scope-relative selection correctness, loading-link retention and narrow-screen
controls. This establishes one fixed compiled template only, not a general
block SDK, layout editor, public ABI, plugin installer or isolation.

## 12. UX-F1: Shared favorites through existing user tags

Admitted 2026-10-09 as a shortcut over existing explicit user TAG operations,
not a new organization model. The client MAY offer favorite/unfavorite actions
in Photos, its focused viewer, Music and the fixed Overview, and one shared
Only favorites filter. The stored value is the ordinary visible `Favorite`
TAG, invariant across interface languages. It is not a reserved annotation
kind, hidden membership store, album, playlist, ordering or protection policy.
Existing user-authored matching tags are shown normally; changing/removing
that tag through ordinary tag management changes the shortcut's projection.

Actions MUST resolve a currently authorized workspace subject and use existing
`annotation.upsert`/`annotation.delete` commands. Removal tombstones only that
subject's active exact matching TAG records using their expected revisions,
including duplicate matching records, without altering unrelated tags or Notes.
Unknown/stale/loading reads and unavailable annotation storage MUST disable
writes. A failed complete tag read is unavailable, not an empty success or
proof of no favorites. Same-workspace last-known facts may remain visible as
pending while rereading; a tagged scope with no complete snapshot or a failed
read must not claim a zero-result collection. Successful writes are reread
before updating coverage or claiming the refreshed favorite state. Partial,
degraded, conflicted and unknown outcomes remain visible and reconciled.

The shortcut shares current query/tag scope and existing deep-link semantics.
Click/keyboard events must not accidentally select or navigate the parent row.
Same-scope tag refresh MUST NOT reset the focused viewer or player. Removing
the last currently filtered favorite leaves the explicit filter and empty
scope visible; it must not silently broaden to the whole library.

Durability is the existing catalog annotation contract and portable publication
lifecycle. Daily annotation writes do not by themselves prove a refreshed
signed portable backup; this shortcut adds no immediate portable publication,
schema, record kind, endpoint or release evidence.

**Exit:** favorite a real retained photo and audio track -> filter within each
domain and the shared scope -> refresh/reopen with marks/filter retained ->
remove one while preserving unrelated tags -> retain explicit empty scope.
Show unknown-read behavior honestly, preserve ordinary selection/viewer/player,
and verify usable narrow-screen controls. This does not deliver curated albums
or reusable ordered playlists.

## 13. UX-Q1: Occurrence-aware listening and batch queue actions

Admitted 2026-10-09 as an extension of the existing transient Music queue,
following continued operator instructions to complete everyday music use.
This is a client-only listening slice. It does not admit native playlist
membership, a document-based current-head protocol, a new catalog schema,
signed format, processor, endpoint or persistent listening session.

Each insertion MUST create a distinct transient occurrence ID. Repeated files
remain separate ordered entries. File identity and occurrence identity MUST
remain distinct: advancing, reordering, removing and identifying the active
entry use the occurrence plus its original file identity, never the first
matching filename or content digest. Removing one repetition leaves others
untouched. Reordering and shuffling retain the current occurrence, Blob and
playback position. An individual Remove action for the active occurrence still
requires Stop. The existing explicit Clear queue action empties the sequence
without stopping the current original; that playback becomes unqueued and
retains its visible controls. It does not remove or modify the original file.

Music MAY append its current displayed supported tracks or the supported
selection within those displayed tracks without replacing playback or queue
order. Explicit Play selected replaces the queue and begins only the displayed
supported selection. Selection outside the displayed subset is not silently
included. Unsupported/unavailable omissions remain counted; repeated files
are not omissions. Opening or editing the queue does not start playback.

The transient queue is capped at 1,000 entries. An operation exceeding this
limit MUST be refused visibly without truncating, replacing or stopping the
existing queue or playback. Workspace change and browser page reload clear this transient
state. No button may describe it as a saved or recoverable playlist.

The global player provides one controlled queue editor, reachable directly
from Music and other client presentations. Entries show order, unique accessible
action names and current-occurrence state. Queue-only state has a reachable
explicit start action. Repeat-one applies to natural completion; manual Next
advances to the next occurrence, including a repetition of the same file.
The existing verification, cancellation, one-player and audio byte ceilings
remain unchanged. Narrow layouts retain usable controls without page overflow.

**Exit:** append A/B/A without autoplay -> open queue -> play first A -> manual
Next reaches B then the distinct second A -> reorder while preserving paused
identity/position -> remove one repetition -> batch append selected/displayed
tracks with truthful scope -> navigation retains queue -> Stop/refresh clears
playback under the existing lifecycle. Service-status and tag rereads retain
the same-workspace queue and player. Verify queue limit and unsupported
omissions without mutation. This advances listening, not durable playlist
save/reopen/edit or full Music acceptance.

## 14. Implementation order and evidence

This bounded client track MAY run in parallel with existing Phase 4/5 work
after the admitted Phase 3 portable shapes are frozen. It grants no phase
completion and does not move LinkGroup implementation ahead of its gates.
Disjoint client files may be implemented in parallel; integration is owned by
one primary agent with one shared App state and typed-operation path.

Run focused client/build/lifecycle and local browser checks, a practical broad
Go regression once for the integrated cohort, and `git diff --check`. Repeat
checks only for relevant changes/failures. Local Mac/browser experience evidence
does not require a Linux qualification detour and does not qualify another
host, deployment or release. Record implemented, partial and missing scope
honestly; mock tests alone do not prove decoding, listening or photo usability.
