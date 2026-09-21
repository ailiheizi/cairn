# F3 Paper Review

> Status: informative research record (documentation authority rank 7). It
> adds no scope, closes no gate, and authorizes no implementation. Written
> 2026-09-19 from a full read of the paper by a research pass; the comparison
> quotes the frozen decisions but does not change them.

## The paper

Zhang, Meng, Prammer, McKinney, Patel, Pavlo, Zhang, **"F3: The Open-Source
Data File Format for the Future"**, *Proc. ACM Manag. Data* 3(4), SIGMOD
Article 245, September 2025, DOI `10.1145/3749163` —
https://db.cs.cmu.edu/papers/2025/zeng-sigmod2025.pdf

Maturity: **research prototype**. The repository
(https://github.com/future-file-format/F3, Rust, MIT) states "This project is
a research prototype verifying the ideas in the paper. You should not use it
in production." There is no specification document; normative detail lives in
the paper and the code. No adoption evidence was found.

What it is: a **columnar analytics** format (a Parquet/ORC successor), not a
preservation or recovery format. Its design centers on centralized
FlatBuffers metadata (no per-unit headers), an I/O unit decoupled from the
logical row group, dictionary scope decoupled from the row group, a
three-call Arrow decoding API, and — the part that matters for this review —
**decoder binaries embedded in the file itself** (WebAssembly, used when the
reader's native implementation is incompatible or the encoding ID is
unknown). Integrity is an optional per-I/O-unit checksum plus a Postscript
checksum over preceding bytes.

Scope limits, stated plainly: it claims that *future readers can decode*, not
that bytes are preserved. The paper discusses **no** deduplication, no content
addressing, no provenance, no signing, no encryption, no replication or
repair, no retention model, and no update or delete protocol.

## Where F3 independently validates decisions RestoreWeave already froze

1. **Self-describing artifacts with a pinned decoder closure.** F3's central
   claim — the artifact carries what is needed to interpret it — is already
   frozen here: an `EXACT_REVERSIBLE` representation carries "a pinned decoder
   closure that reproduces `ContentID`"
   (`docs/requirements/content-store-views-and-exports.md:169`), and required
   decoders are "retained, reproducibly rebuildable from a complete retained
   closure, or both" (`docs/requirements/restore-manifest.md:1520`). Nothing
   to add; the convergence is evidence the decision was right.
2. **Integrity verifiable without reading the whole artifact.** RestoreWeave
   already goes further than F3 here: content-addressed signed attachments
   with independently hashed readback
   (`docs/requirements/content-store-views-and-exports.md:805,819`).
3. **Format evolution must never reinterpret old data.** This is exactly the
   provider-replaceability rule ("Their profile and version digests must be
   recorded; replacement cannot reinterpret old facts", AGENTS.md) that the
   lexical profile V1→V2→V3→V4 chain and the fail-closed generation binding
   already implement.

## What the embedded decoder is actually for (and what it is not)

A clarification worth recording, because the mechanism is easy to over-read.

F3 is a **columnar data format**. Its files encode each column with one of
several encoding schemes (dictionary, bit-packing, run-length, and so on).
The embedded WebAssembly module exists for **encoding evolution**, not for
compression ratio and not for reading arbitrary files: when a reader meets an
encoding ID it does not implement, or a native implementation that is no
longer version-compatible, it runs the file's own fallback decoder in a
sandbox. The effect is that an old reader can still open a file that uses a
newer encoding, and a new reader can still open a file written with an older
one.

It is therefore **not** a universal decoder interface that makes any file
interpretable, and it is **not** a byte-exact reproduction mechanism: the
paper claims that future readers can *decode the data*, not that the original
bytes are reproduced. That is the opposite of what RestoreWeave's
`EXACT_REVERSIBLE` demands, where a pinned decoder closure must reproduce the
original `ContentID` — SHA-256 over the complete logical byte stream plus its
length.

The resemblance to a neural-codec shape (a decoder that must travel with the
data because the encoding may outlive its implementation) is real, but the
two serve different goals: F3 uses it for format longevity, RestoreWeave uses
a decoder closure for physical savings with byte-exact recovery. The
placement difference follows from that: F3 ships executable code *inside* the
payload, which the security contract forbids here, while RestoreWeave keeps
decoders as admitted, digest-recorded capabilities outside the content.

## Where the two designs genuinely diverge

- **Unit of authority.** F3: one file = data + metadata + code. RestoreWeave:
  "Repository objects plus authenticated portable recovery records are the
  recovery authority" (AGENTS.md). F3 has no signing and no trust-anchor
  model, so a single self-contained file would be a *weaker* recovery
  authority here, not a simpler one.
- **Identity.** F3's unit is a table/projection with no whole-content identity
  and no deduplication. RestoreWeave's identity is
  `ContentIdentity = (sha256:<lowercase-hex-digest>, byte_length)` over the
  complete logical stream. A columnar container must never be treated as an
  identity provider in this product.
- **Executing code from data.** F3 makes data files deliver decoder code.
  RestoreWeave's security contract treats all content as untrusted and
  requires that restored content never executes automatically. F3's own
  proposal of a central verified-module registry is evidence *for*
  RestoreWeave's capability-admission model, not against it.

## What is worth taking from F3

| Idea | Verdict |
| --- | --- |
| Freeze canonical byte/digest conformance vectors per signed record family (accept **and** reject cases) so "any independent reader" is executable rather than aspirational | **Adopt** — cheap, in-lock, strengthens the Phase 3 corruption/relocation/reader-dependency proof; note that the existing "conformance vectors" requirement sits in a section marked superseded for `RW-MVP-1`, so this needs its own home |
| An explicit decoder-fallback order modeled on F3 §6.4 (known ID + compatible implementation digest → native; incompatible → retained pinned decoder; unknown → refuse and fall through to the next recovery reference) | **Design note** — the obligations exist but their order is implicit today |
| A digest-keyed, explicitly disposable decode cache keyed by *implementation* digest | **Design note** — only worth it if decoding becomes a hot path |
| Executable decoders embedded inside payload objects | **Do not adopt** — conflicts with the frozen recovery trust story and capability admission |

## Bottom line

The resemblance the operator noticed is real but philosophical: both designs
insist that a durable artifact must describe and interpret itself, and that
format evolution must never silently change the meaning of what is already
stored. RestoreWeave reaches the same conclusion through a different
structure — a catalog plus a content repository plus signed portable records
— which keeps the recovery authority outside the payload and lets decoders be
admitted rather than shipped inside content.

F3 is therefore **not an integration target**: it is an analytics format,
RestoreWeave is a preservation and recovery plane, and adopting its container
would trade a signed, independently verifiable recovery authority for a
single self-describing file with no trust anchor. The two concrete takeaways
are the conformance-vector set and the decoder-fallback order.
