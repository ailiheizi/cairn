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
   directory; it has no good upload interface. Slice spec (proposed, awaiting
   operator confirmation):

   - **Endpoint.** One bounded `POST /api/v1/upload` on the existing loopback
     adapter, same token as every other call. It is file reception only: it
     adds no policy, job, catalog, or recovery state machine.
   - **Landing.** Files land in a daemon-managed staging directory under the
     data root (`<data>/inbox/<date>-<random>/<safe-name>`), never inside a
     configured source tree and never directly into the repository.
   - **Bounds.** Per-file size cap (default 1 GiB, response states the cap),
     per-request file count cap (e.g. 200), total in-flight cap; exceeded
     bounds are typed refusals (`UPLOAD_TOO_LARGE`, `UPLOAD_TOO_MANY`,
     `UPLOAD_QUOTA_EXCEEDED`), never silent truncation.
   - **Safety.** Names are sanitized to a safe display name (path traversal,
     control characters, and reserved names rejected or rewritten and echoed
     back); the response carries the computed SHA-256 + length so the browser
     can show the identity before anything is ingested; nothing is parsed or
     processed at upload time.
   - **Review.** The staged directory is offered back as a `plan.ingest`
     source root; the ordinary review → digest-bound apply flow takes over.
     The upload never bypasses plan review, and an un-ingested staging
     directory is visible (and cleanable) in the sources surface.
   - **Browser.** The add-source dialog gains an "upload files" mode using a
     real file picker / drag-drop; it shows per-file identity and then offers
     the protect plan for the staged batch.
   - **Honesty.** The staged area is a plain host directory the daemon owns;
     until a plan protects it, the bytes have no protection record, and the
     UI says so in the same wording the link-only flow uses.

   Decision needed from the operator: per-file size cap value and whether
   uploads should be allowed without a token when the API runs tokenless on
   loopback (proposed: allowed, since loopback-only is already the trust
   boundary, but staged bytes stay unprotected-visible until reviewed).
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

## Chinese mid-run matching — implemented (lexical profile V4, commit follows this note)

**CJK mid-run matching.** The lexical feed's FTS5 tokenizer (`unicode61`)
treats a contiguous CJK run as one token and queries match by prefix, so a
query for a word in the middle or at the end of a run does not match. This is
a pre-existing property of the raw feed — verified on the live daemon: a note
containing 杭州西湖的备份方案备忘 answers `杭州` (prefix) but not `西湖` or
`备注` — and the pinyin enrichment (V3) inherits it: `xihu` fails for the same
reason `西湖` does, while `lvxing`/`lx` succeed because those queries are
prefixes of the run's joined/syllable forms.

Candidate fix (not scheduled; needs the operator's call because it changes
the feed shape again): index CJK **bigrams** — emit every adjacent character
pair of each CJK run as an additional token — which makes any two-character
query match anywhere inside a run, for both raw characters and pinyin forms.
Costs: a new lexical profile version (V4), a larger FTS generation, and a
rebuild; the coverage vocabulary stays unchanged because this is token
enrichment, not a new field. A smaller alternative is to emit only the first
N bigrams per run, which bounds growth but makes matching position-dependent
and is therefore harder to describe honestly.

**Empirically verified token shapes** (probes run directly against the
production tokenizer, `unicode61`, on 2026-09-19):

| Feed shape | Queries that matched |
| --- | --- |
| raw run only | none of 杭州 / 西湖 / 备注 |
| bigrams only (`杭州 州西 西湖 …`) | 杭州, 西湖, 备份, 州西 — but not the two-character pair formed by adjacent bigram boundaries in a query, and not a query the tokenizer merges differently |
| **bigrams + per-character tokens** (`杭州 州西 … 杭 州 西 湖 …`) | 杭州, 西湖, 备份, 州西, and the space-separated pair 西 湖 |

Conclusion: the working encoding is **bigrams plus per-character tokens**,
space-separated, both derived from the same CJK run. That is the shape the
implementation slice must emit; a bigram-only feed is insufficient.

## Reader closure: keeping an old encoding readable years later

The operator asked whether RestoreWeave can follow F3's encoder/decoder idea so
that an encoding retired years from now can still be read. The answer is that
the shape is **already frozen** and the remaining work is narrower than it
sounds:

- An `EXACT_REVERSIBLE` representation already must carry a portable
  `RecoveryRecipe` naming the codec/profile ID, implementation digest,
  model/tokenizer/dictionary digests, coder profile, framing digest, encoded
  payload placement, decoded length, and validator profile, with the proof
  `encoded placement -> pinned decoder -> complete byte stream -> SHA-256 +
  length == source ContentIdentity`
  (`docs/requirements/content-store-views-and-exports.md:232-236`). That is the
  encoder/decoder pair, with a byte-exactness requirement F3 does not make.
- The signed portable fact closure and the recovery reference already carry
  `RequiredReaderDependencies` (`server/internal/exact/recovery_closure.go:226`,
  `recovery_reference.go:71`; populated from the repository capability profile,
  e.g. `restoreweave.repository.local-zstd-v1` plus
  `klauspost/compress/zstd@v1.18.7`), so a reader can state what it needs.
- The retirement rule is frozen: "A repository driver, decoder, model,
  tokenizer, or dictionary cannot be removed while any retained representation
  or recovery recipe depends on it"
  (`docs/requirements/driver-and-processor-interfaces.md:479`).

**Status: the three missing pieces are implemented and tested** (see the
commit that carries this note). `reader.closure` declarations now ride the
existing read-only `capability.list` as a `reader-closure` row kind — one row
per admitted dependency stating its role, retention class, ordered decoder
artifacts with digests, rebuild and verify procedure, and decoder support
window, or a typed refusal with the caller action. A frozen decoder fallback
resolver implements the order below and refuses with typed reasons that
direct the caller to the next `RecoveryReference` rather than a weaker
fidelity class. Conformance vectors are committed as golden files: 17 signed
record vectors (accept plus reject per family, including a validly signed
closure naming an unadmitted dependency) and golden payload bytes for the
identity and zstd codecs, all regenerable byte-for-byte from the production
signers.

What was missing before those landed was:

1. **Retention or reproduciblity, proven per dependency.** The requirement is
   "retained, reproducibly rebuildable from a complete retained closure, or
   both" (`docs/requirements/restore-manifest.md:1520`). Today each dependency
   is a name plus a version string; nothing records where the decoder bits
   live, how to rebuild them, or how to verify a rebuild.
2. **An explicit decoder fallback order** — native implementation with a
   matching digest, then the retained pinned decoder, then refuse and fall
   through to the next recovery reference — instead of leaving the order
   implicit.
3. **Conformance vectors** (accept and reject cases) per signed record family,
   so "any independent reader" is an executable claim rather than an
   aspiration. Both this and item 2 are already listed above as F3 takeaways.

Constraint carried forward: restorable content never executes. Whatever is
retained is an admitted, digest-recorded capability kept *outside* the payload;
F3's embedded decoder — executable code inside the data file — stays rejected.

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
