# ADR-006: Chunking & Retrieval Strategy

**Status:** Accepted · **Date:** 2026-09-30

## Context

Week 5 turns the paste-a-snippet paper tab into real retrieval: a PDF becomes
cleaned text, becomes chunks, becomes vectors in pgvector, becomes an answer
with page citations — or an explicit refusal.

The constraint that shapes everything is the **citation**. A chunk is not just a
retrieval unit; it is the thing a page number points at. If a chunk spans two
sections, the citation is ambiguous. If it spans a page break and only one page
is recorded, the citation can be *wrong*. The project's rule that citations must
be real (project principle 7) therefore reaches all the way back into chunking.

Corpus shape: student-uploaded astro/space-physics papers — arXiv and NASA
PDFs, typically 10–30 pages, 0.5–3 MB, two-column, LaTeX-set, full of
identifiers that carry no semantics (`NORAD ID 56205`, `NRLMSISE-00`,
`G0.11-0.11`). Dozens of papers per user, not millions (ADR-002).

Everything below was measured on the same five arXiv astro-ph papers
(2609.23496, 2609.24534, 2609.24851, 2609.27569, 2609.36042 — 93 pages total).

## Decision

### 1. Extraction: two passes, because neither is sufficient alone

`science/pdf.py` reads each page twice:

| Pass | Gives | Why the other one cannot |
|---|---|---|
| `page.get_text()` (plain) | correctly spaced text | the dict pass loses inter-word spaces in several of these PDFs — naively joining spans yields `Prematurere-entryoftheFACSAT-2nanosatellite` |
| `page.get_text("dict")` | font size and weight per span | plain text has no typography, and typography is the strongest heading signal there is |

So **typography decides which lines are headings; plain text supplies what they
say**, matched on a whitespace-stripped key.

**Heading detection needs two paths, not one.** This is the finding that cost the
most time and is the most transferable:

- Most templates set section heads larger and/or bold. Caught by the
  typographic path (confirmed by a textual cue, or standing alone on a large
  size jump).
- **AASTeX sets section heads at body size, not bold.** In arXiv 2609.36042,
  `2. DATA PIPELINE AND ANALYSIS` is CMR9 among CMR10 body text — *no* size or
  weight signal exists. Requiring typography found **1** (wrong) heading in that
  paper. A second, strictly-shaped textual path — a numbered or roman-numbered
  line whose title is ≤60 chars, comma-free, unpunctuated and predominantly
  capitalised — found **13** correct ones.

The narrowness of that shape is the whole trick. A naive `^\d+\.\s` regex
happily matches numbered *list items*, which is exactly what it did on the first
attempt: `2. Each job Ji comprises li operations for i = 1, ..., n, the jth
operation ...`. Requiring short, comma-free and mostly-capitalised separates
headings from list items without any font information.

Measured false positives found and fixed: bold figure/table captions, bold
author lists (`D. Murtagh6, M. Olberg6, M. Rengel3, …` — ≥2 commas), bold
run-in prose ending in a full stop (`calibration modes.`), equation fragments
(`d2r` — fewer than 3 letters), and the rotated `arXiv:…` stamp.

Heading counts per paper after both paths: 20, 20, 9, 46, 13. Before the textual
path: 8, 20, 9, 23, 1.

**Cleaning** removes what every academic PDF adds and no reader wants inside a
chunk: lines repeated near the page edges on ≥50% of pages (running
headers/footers — real example: `Vargas Domínguez et al.: Premature re-entry of
FACSAT-2` on all 20 pages), bare page numbers, the arXiv stamp, end-of-line
hyphenation (`wavefunc-` + `tions` → `wavefunctions`), and ligature code points
via NFKC (`ﬁ` → `fi`).

### 2. Paragraphs: layout, not blank lines

PDFs almost never emit a blank line between paragraphs. The usable signal is a
line that **ends a sentence and is noticeably shorter than the column width** —
the last line of a paragraph.

The threshold is the **75th percentile** of line lengths on the page, not the
median. Measured reason: paragraph-final lines are short *by definition*, so
they drag a median below the real column width, and the heuristic then fails to
recognise the very lines it exists to find. With the median, a 49-character
final line in a 62-character column was missed.

Before layout-aware detection (blank lines only): 93 "paragraphs" across five
papers, median **3167** characters — essentially one blob per page. After: 461
paragraphs, median **509**.

Known limitation, documented rather than papered over: a paragraph whose last
line happens to fill the column is indistinguishable from one that wraps, so it
merges with the next paragraph. The consequence is bounded — the chunker then
splits it on size anyway, so the page and section of a citation stay correct and
only the paragraph boundary is lost. There is a test asserting this behaviour so
it cannot silently change.

### 3. Chunk size: 1400 characters, 200 overlap

Measured paragraph distribution (461 paragraphs): median **509**, p75 **941**,
p90 **1565**, p95 **2136**, max **4420** characters.

| Setting | Value | Why |
|---|---|---|
| `TARGET_CHARS` | 1400 (~350 tokens) | Holds the median paragraph with surrounding context, or one p75 paragraph whole. ~78% of paragraphs are never split. |
| `MAX_CHARS` | 2000 | Hard cap. Covers p95 without letting a pathological paragraph through. |
| `OVERLAP_CHARS` | 200 (~14%) | About one sentence: enough that a claim straddling a boundary is retrievable from either side, small enough not to inflate the index by much. |
| `MIN_CHARS` | 120 | Below this a chunk is a stub (`Fig 2`) that retrieves nothing and dilutes the index. |

Resulting chunks across the five papers: **316**, median **1110** characters,
max 1943, none over the cap.

**Characters, not tokens.** Chunking must not depend on a tokenizer belonging to
whichever embedding model is current; ~4 chars/token is the working conversion
and a size change does not require re-deriving the configuration.

Every size is a parameter on `chunk_document` and is plumbed through the upload
API, because Week 6's experiment varies one of them and a hard-coded constant
cannot be experimented on.

### 4. Invariants that protect citations

1. **A chunk never spans two sections.** Sections are built from heading
   positions; packing restarts at every heading.
2. **Overlap never crosses a section boundary.** Carrying the tail of
   "3. Methodology" into the first chunk of "4. Results" would attribute one
   section's text to the other's citation.
3. **A chunk records `page` *and* `page_end`.** A chunk may cross a page break,
   and a citation saying "p. 7" when the sentence is on page 8 is simply wrong.
   The answerer accepts a cited page anywhere in that range and rejects anything
   outside it.
4. **No chunk exceeds `MAX_CHARS`.** The overlap counts against the cap — found
   by a failing assertion when a 1897-character paragraph plus a 200-character
   carry produced a 2097-character chunk.
5. **A stub is folded into a neighbour in the same section, never across one.**
   `Keywords`, `Funding` and `Competing interests` genuinely are 40–100
   character sections in real papers; merging them into the previous section
   would make their citation point somewhere else.

### 5. Embeddings: `gemini-embedding-001` at 768 dimensions

The model's native output is 3072 dimensions. We use **768**, truncated and
re-normalised. The reason is measured, not stylistic:

```
dims=768  hnsw: OK          dims=2000 hnsw: OK
dims=1536 hnsw: OK          dims=2001 hnsw: column cannot have more than 2000 dimensions
dims=3072 hnsw: column cannot have more than 2000 dimensions for hnsw index
dims=3072 ivfflat: column cannot have more than 2000 dimensions for ivfflat index
```

pgvector 0.8.0 **cannot build either ANN index above 2000 dimensions**. A
3072-dimension column could only ever be sequentially scanned, which forfeits
the entire reason ADR-002 chose pgvector over a dedicated vector database.
768 additionally cuts row width and distance cost fourfold, and the model is
trained (Matryoshka) for truncation.

Truncated vectors come back **un-normalised** — measured L2 norm 0.594 at 768
versus 1.000 at 3072 — so they are re-normalised client side. Cosine distance
would cope either way; normalising keeps cosine and inner product
interchangeable and removes a trap from any later index change.

Document and query embeddings use different task types
(`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`): the asymmetry is what the model was
trained for.

### 6. Retrieval: vector + keyword, fused by rank

Each query runs two retrievers over the chunks of **one** paper (scoping is a
`WHERE paper_id = $1`, the concrete payoff ADR-002 predicted), takes 20
candidates from each, and fuses them with **Reciprocal Rank Fusion**
(`score += 1/(60 + rank)`), returning the top 6.

**Why keyword matching at all**, when embeddings are supposed to handle meaning:
academic papers are full of strings that carry no semantics. `NRLMSISE-00`,
`NORAD ID 56205`, `FACSAT-2`, `G0.11-0.11` — a reader asking about one of those
wants that exact string, and a dense vector is the wrong instrument. There is a
test for exactly this: a query embedding pointed deliberately away from the
NRLMSISE chunk, which keyword matching still surfaces first.

**Why RRF rather than a weighted score blend.** Cosine similarity and `ts_rank`
are not on comparable scales, so a weighted sum needs calibration constants that
have to be re-tuned whenever either side changes. RRF only uses *rank*, so there
is nothing to calibrate — and with one corpus and no labelled training data,
"nothing to calibrate" is worth more than a theoretically better blend.

`websearch_to_tsquery`, not `plainto_tsquery` or `to_tsquery`: real questions
contain punctuation (`What is the NRLMSISE-00 model?`) that the other two reject
or mis-parse.

A stored generated `tsvector` column with a GIN index, not a query-time
`to_tsvector`: the latter cannot use an index and would scan every chunk on
every question.

**HNSW over IVFFlat.** IVFFlat needs a representative sample to build its lists
and degrades as the corpus outgrows that sample; HNSW builds incrementally,
which suits a corpus that grows one uploaded paper at a time.

`hybrid` and `top_k` are request parameters, so Week 6 can measure
vector-only against hybrid without a deploy.

### 7. Answering: citations verified in code

The model returns `{supported, answer, citations[], missing}` under a
`responseSchema`. Then **the code checks every citation** against the chunks
actually retrieved in that request:

- the cited `chunk_index` must be one that was offered, and
- the cited `page` must fall inside that chunk's real `page`…`page_end` range.

Invalid citations are dropped and recorded in `rejected_citations`. **An answer
whose citations all fail verification is downgraded to a refusal.** This is what
makes "citations are real" a property of the system rather than a hope about the
prompt: the model cannot emit a page number that was not already true of a
retrieved chunk, however confidently it tries.

Refusal is a first-class outcome (`refused_unsupported`), stored on the message
row, with the product's wording: *"This paper does not provide enough
information to answer that."* Week 6 measures how often it fires.

### 8. Storage: best-effort, and the pipeline does not depend on it

The plan's flow is PDF → Supabase Storage → extraction. In practice extraction
reads the **uploaded bytes directly**, and the Storage upload is a separate,
optional step (enabled by `SUPABASE_SERVICE_ROLE_KEY` +
`SUPABASE_STORAGE_BUCKET`). A failed upload costs the ability to re-download the
original PDF later; it does not cost the ability to answer questions about it,
and it does not fail the request. Ordering the pipeline the other way would make
an object-store outage an ingestion outage for no benefit.

The PDF crosses the api→science boundary **base64-encoded inside JSON**. That
costs 33% transfer overhead and is accepted to avoid introducing a second
transport (multipart) and a second client for one route; the existing JSON
client already carries the timeout and error semantics. Papers are 0.5–3 MB, and
both services cap the upload at 15 MB.

Re-uploading identical bytes returns the existing paper rather than a duplicate:
the SHA-256 of the file is the natural idempotency key for an upload, and
Week 7's explicit idempotency keys build on it.

## Alternatives Considered

**Fixed-size chunks with no structure awareness** (the usual 500-token window).
Trivial to implement and the default in every tutorial. Rejected on the citation
requirement: a window that straddles "3. Methodology" and "4. Results" cannot be
cited to either, and the page it reports is whichever page it happened to start
on. This is the alternative the project plan explicitly warned against, and the
measurements above are what replaced it.

**One chunk per section.** Perfect citations, no boundary problem at all.
Rejected on retrieval quality: these papers have sections of 5000+ characters,
so a section-sized chunk embeds a dozen unrelated claims into one vector and
retrieval becomes "which section is vaguely about this", which is too coarse to
ground a specific number.

**Semantic chunking** (embed sentences, cut where adjacent similarity drops).
Attractive and genuinely better at finding topical boundaries. Rejected for now
on cost and determinism: it needs an embedding call per sentence at ingestion —
hundreds per paper against a quota already measured as the binding constraint —
and makes chunk boundaries depend on a model, so an eval run is no longer
reproducible. Revisit if retrieval hit-rate disappoints.

**Vector-only retrieval.** One retriever, less code, and the default most RAG
systems ship. Kept available behind `hybrid: false` precisely so Week 6 can
measure it rather than argue about it. Rejected as the default because of the
identifier problem in §6.

**BM25-weighted hybrid** (α·cosine + (1−α)·bm25). Better ceiling than RRF with
a well-tuned α. Rejected because tuning α needs labelled relevance data this
project does not have, and an untuned α is worse than no α.

**Pinecone / a dedicated vector store.** Re-litigated and re-rejected: ADR-002's
reasoning is unchanged, and §6's per-paper scoping as a SQL `WHERE` clause is
the benefit arriving as predicted.

**OCR for scanned PDFs.** Rejected for v1: it adds Tesseract to the image, a
large latency tail, and its output quality would undermine citations. Extraction
instead **fails loudly** with "No extractable text found — the PDF is probably a
scan. OCR is not supported", which is a better experience than silently
answering from nothing.

## Consequences

Ingestion of a 20-page, 597 KB paper takes **0.38 s** through the science
service and produces **65** chunks across **17** sections with correct page
attribution. Retrieval is two indexed queries against one paper. Citations
cannot name a page the retrieved chunk does not cover.

**Costs accepted:**

- **Heading detection is heuristic and will meet a template that defeats it.**
  Both paths are tuned on five papers; a thesis-style or non-English layout may
  produce one giant section. The failure is visible rather than silent — the
  extraction warns "No section headings were detected", the warning is stored on
  the paper row and shown to the user — and chunking still works, losing section
  attribution but not page attribution.
- **No OCR**, so scanned PDFs are rejected outright.
- **768 dimensions instead of 3072** trades some embedding fidelity for the
  ability to have an index at all. If retrieval hit-rate disappoints, the
  alternative is a dedicated vector store (ADR-002's revisit trigger), not more
  dimensions in pgvector.
- **Paragraph detection has a known false-negative** (§2), bounded to a lost
  paragraph boundary.
- **One extra network hop per ingestion** (api → science), consistent with
  ADR-001's accepted cost.

**Revisit trigger:** if Week 6's retrieval hit-rate falls below ~80% on the gold
set, the first change to try is semantic chunking (measured against this
baseline, one variable at a time), then a larger `top_k`, then a dedicated
vector store. If the limiting factor turns out to be *faithfulness* rather than
retrieval, the change belongs in the answering prompt, not here.

## References

- ADR-002 (pgvector over Pinecone), ADR-003 (deterministic engine), ADR-005 (agent guardrails, injection posture reused here)
- `science/{pdf,chunking}.py`, `api/src/rag/{store,answer,pipeline}.ts`, `api/src/lib/embeddings.ts`
- `db/migrations/003_rag_embeddings.sql`
- Cormack, Clarke & Büttcher, *Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods* (2009)
