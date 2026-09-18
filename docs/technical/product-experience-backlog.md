# Product Experience Backlog

> Status: informative planning record (documentation authority rank 7). It
> records operator-requested product work with its constraint status; it adds
> no MVP scope, closes no phase gate, and cannot reorder the core plan. Each
> item names its current constraint under the existing locks
> (`docs/requirements/*` and `docs/technical/core-mvp-execution-plan.md`).

Created 2026-09-18 from the operator's product review. Items move out of this
document when they enter an implementation slice; entry requires the usual
phase/requirement/exit-test triple.

## In flight this cycle

| Item | Shape | Constraint status |
| --- | --- | --- |
| Similar candidates (not identity) | Optional bounded scan computes a 64-bit perceptual hash per image; candidate groups by Hamming distance; audio groups by declared artist/title + duration ≤ 2 s. Every payload restates: similarity never establishes identity and never authorizes deletion. | Phase 4; content-store duplicate contract. Daemon implemented and tested; browser surface this cycle. |
| Query by image (以图搜图) | `search.query` gains an image subject-ref query input; the stored multimodal generation is scored with a vision-tower query vector; filter-only and text-only behavior unchanged; input errors never revoke a generation. | Phase 4; no new dimension (the multimodal dimension already serves this space). |
| On-demand AI notes (`description.generate`) | OpenAI-compatible describe profile; runs only through the egress gate with a live grant and per-request confirmation; admits an immutable `AI_SUMMARY`/`AI_ANALYSIS` revision at `accepted=false`; honest `DESCRIPTION_PROVIDER_UNAVAILABLE`. | Phase 4; `content-store-views-and-exports.md` §DESCRIBE_SUBJECT; egress contract per `driver-and-processor-interfaces.md` §12. |

## Accepted, queued (operator-approved)

1. **Upload / add-file channel.** The current add-source flow scans a host
   directory; it has no good upload interface. Shape under consideration: a
   bounded upload endpoint on the loopback `/api/v1` adapter that lands files
   in a daemon-managed staging directory (size bounds, safe names, digest
   echo), after which the existing `plan.ingest` review flow takes over — the
   upload never bypasses plan review and adds no second state machine. Needs a
   reviewed slice spec (security gates: unauthenticated loopback only, size
   and count bounds, no path traversal, no silent ingest).
2. **Pinyin search.** Add pinyin (and initial) tokens to the lexical feed so
   `lvxing` finds `旅行`. Requires an embedded Hanzi→pinyin table (new static
   data dependency, generated from a public-domain source with recorded
   provenance and digest). Lexical-dimension work only; no new dimension.
3. **LinkGroup review.** The operator asked to "look at" link groups. The
   minimal LinkGroup is planned Phase 6 and stays blocked until the Phase 4
   and 5 gates close; the permitted work now is a design-review pass over
   `docs/requirements/content-store-views-and-exports.md` and the execution
   plan so the schema/operation/browser flow spec is ready — no schema or API
   implementation before the gates.

## Browser-side quick wins (no daemon change, use existing facts)

4. **Timeline browse**: month-bucketed capture/modified-time histogram over
   the loaded listing; clicking a bucket filters. Browser-side projection,
   labelled as such.
5. **Space report**: largest subjects / largest media classes over the loaded
   listing plus the daemon's read-only capacity report. Honest about the
   loaded-page scope.
6. **Deep links**: search terms, active facets, and selected view encoded in
   the URL so a refresh or a share keeps the context.
7. **Empty-state onboarding**: a three-step guide (add source → protect →
   search) when the library is empty.
8. **PWA manifest + icons**: installable on the phone; the 390 px layout
   already exists.

## Small daemon additions (projections of existing facts)

9. **Album / artist facets**: library facets derived from the durable
   `extract.audio.tags.v1` facts (facet, not a player surface).
10. **Verification freshness**: surface the age of the last full-bytes
    verification and a gentle re-verify reminder; `UNKNOWN` stays honest.
11. **Export presets**: remember the last destination directory and sidecar
    choice per workspace as a browser-local default.

## Decisions needed before scheduling

12. **Phone camera-roll ingest**: needs the upload channel (1) first, plus a
    decision about how a phone source is represented (one staging source per
    device? provenance labels?).
13. **Compression**: stays optional and off the critical path per operator
    decision; `local-zstd-v1` remains the opt-in candidate and the neural
    codec stays disabled.

## Explicitly out (unchanged locks)

Players, readers, transcoders, mount/network filesystem services, OpenList
forks, new index dimensions, richer Collections, automatic external
acquisition, destructive GC.
