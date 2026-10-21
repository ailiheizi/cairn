# Product Power: Content Search

Status: IMPLEMENTED and locally delivered, 2026-10-19, under the owner's
narrow CS-1/2/3 admission. The bounded document-search journey is verified;
full-product and release qualification remain outstanding. The corresponding
agent/extraction scopes, core phase order and other exclusions remain intact.

## Product decision

Make **finding a file from what it says** the next substantial product outcome.
Example: the owner remembers a document discussing a refund deadline, but has
forgotten its filename and folder. Cairn finds the PDF or Word document from
its body, shows the matched extracted paragraph, and lets the owner take out
the exact original. This directly supports finding and taking out personal
content, alongside the existing Photos and Music experiences.

The first milestone is text-bearing PDF and DOCX content search. Scanned PDFs,
image OCR, visual retrieval, and persistent organization remain separate later
milestones. Do not present a chat box, a configuration card, or a filename-only
result as delivery of this outcome.

## Gap at admission

At admission, the detector recognized PDF and DOCX, but the default processing
pack extracted UTF-8 plain text and selected media/book metadata without
PDF/DOCX body text. The implementation adds that missing content feed and
reuses lexical/BGE indexing, source-aligned spans, matched-source display,
SavedView queries and original/export takeout.

The optional CLIP path already has install, activation, index and query code;
it still requires a prepared operator archive and verified real-model delivery.
Adding another image-search button would not close that deployment gap.

## Admitted milestone: document body search

1. **Extract useful text.** Add compiled first-party PDF and DOCX extraction
   through the existing host-controlled processing route. Preserve paragraphs
   and meaningful table text where supported. Use only granted source bytes;
   never execute macros, resolve document links, fetch fonts or open arbitrary
   host paths. Pin parser dependencies, producer/profile digests and extraction
   rules. Freeze input/output, expansion, page/entry, time and concurrency limits
   before implementation; do not inherit an unbounded parser default.
2. **Find by body or meaning.** Feed admitted extracted UTF-8 into the existing
   lexical and BGE generations, with body digest, artifact identity and source
   spans. No second catalog, index dimension or external search service.
3. **Recognize the right result.** Show the matched paragraph and extraction
   status through existing results/Details/Notes affordances, alongside the
   filename. The first milestone does not include a new PDF/Word reader or
   promise page-coordinate highlighting; spans refer to extracted text.
4. **Use the result.** Reuse existing original download, saved retrieval,
   selection and frozen export. Verify exported original length and SHA-256;
   extracted prose never substitutes for exact bytes.

Initial processing applies to new captures and ordinary explicitly recaptured
sources under a newly reviewed route/profile. An index rebuild alone must not
claim to extract old documents. Existing captures need their own reviewed
backfill/successor contract before arbitrary rerouted processing can run.

Empty/scanned, encrypted, malformed, unsupported or over-budget documents keep
their exact saved originals and explicit extraction outcomes. Partial text is
labelled partial, not complete. Do not silently upload document contents to a
remote model or make an LLM/API key necessary for body search.

## Delivery order and exits

- **CS-1: extraction and retained evidence.** New PDF/DOCX captures retain
  distinct body evidence with pinned producer inputs. Unsupported/over-budget
  samples still save and restore exactly. Review route, classification,
  artifact-admission and authenticated-closure compatibility before source work.
- **CS-2: actual retrieval.** A document whose relevant phrase appears only in
  its body is found lexically; a representative Chinese paraphrase is found by
  real local BGE with its matched artifact/span, alongside distractor files.
  Fixture vectors and filename matches do not pass this exit.
- **CS-3: ordinary browser use and takeout.** Upload/capture, confirm save,
  prepare the current index, search, inspect the matching paragraph and take
  out the original. Downloaded bytes match the captured identity. Preserve a
  saved retrieval and repeat it after restart. Validate this complete journey
  once after the feature cohort is implemented.

CS-1 through CS-3 comprise one product milestone. A parser unit test or a
search-entry screenshot alone cannot mark it delivered. Focused resource and
format failures remain necessary; a broad repeated platform matrix is not the
implementation priority.

## Current use and evidence

Add a text-bearing PDF or DOCX, review and confirm saving, then prepare the
current search index through **Settings -> Search** when needed. Search a
remembered phrase or use a Chinese paraphrase with the installed local BGE
profile; open the result to read **Matched document text**, then download the
original. The text excerpt is not a reconstructed document page.

The [task ledger](product-experience-todo.md#product-power-milestone-proposal--2026-10-19)
links the retained API and browser evidence: PDF/DOCX body-only retrieval,
real BGE paraphrases, matched paragraphs, ordinary browser capture and exact
downloads, saved retrieval after restart, and frozen export verification.
The shared post-save action now waits for the finishing refresh; matched text
and long provenance identifiers wrap within the Details pane. Index preparation
honestly reports absent lexical fields as DEGRADED even when the selected text
sources are fully indexed; the demonstrated body query succeeded in both lanes.

The local preview serves this implementation. Scans/OCR, arbitrary old-capture
backfill, document readers and general recall/release qualification are not
included. New captures and explicit recaptures retain the limits above.

## Following product outcomes

| Priority | Outcome | Concrete user value | Boundary |
| --- | --- | --- | --- |
| 1 | Document body search | Find an unfamiliar PDF/Word file from remembered content | Implemented in the bounded development profile |
| 2 | Visual discovery that actually runs | Find a screenshot from its text, or a photo from a description/image | Existing optional OCR/CLIP paths need separate real installation/activation admission and evidence |
| 3 | Coherent reusable sets | Keep project files together and take out one usable package | Minimal LinkGroup remains behind Phase 4/5 gates; album/ordered-playlist persistence needs its own contract |

Persistent albums, playlists, video libraries and home-management applications
remain recorded product goals. They are not removed, relabelled as delivered,
or implemented through hidden localStorage/tag conventions by this decision.

## Approved narrow scope

`AGENTS.md` currently requires convergence within admitted scopes and says
delegates "must not introduce a new durable schema, endpoint, processor,
runtime loader, or test framework." PDF/DOCX body extraction requires new
processor capability admission. The owner explicitly approved that exception
after reviewing this outcome; the generic product-power request alone was not
used to rewrite the rule.

Approved exception: admit only the compiled first-party PDF/DOCX extraction
capabilities and necessary route/profile/validation changes for this milestone,
with unchanged exact identity and recovery authority. The normative extraction
requirements and narrow agent scope now bind 16 MiB source/1 MiB complete text,
10-second extraction and format-specific limits. No new reader, public endpoint,
durable schema, index dimension, runtime plugin loader, background service or
arbitrary old-capture reprocessing is authorized by that exception.

## Reference pattern

Nextcloud's [full-text search framework](https://github.com/nextcloud/fulltextsearch)
separates content providers from search indexing. Its
[content-index API](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/OCS/ocs-fulltextsearch-collections-api.html)
likewise treats file content as input to indexing. The useful pattern here is
an explicit extraction-to-search feed. Cairn should retain its existing local
SQLite/BGE/zvec authority and exact-original takeout rather than introduce a
second search service solely to copy that implementation.
