# RAG Ingestion: What Broke on Five Real Papers

Week 5 testing record. Every number here came from running
`science/pdf.py` + `science/chunking.py` over five real arXiv astro-ph PDFs and
from one live end-to-end retrieval run. Design reasoning is in
[ADR-006](decisions/ADR-006-chunking-and-retrieval.md); this document is the
evidence behind it, including what still does not work.

## The corpus

Five papers, chosen to be genuinely orbital-mechanics/spacecraft work rather
than convenient, and deliberately spanning three different LaTeX templates.

| arXiv id | Pages | Template | Subject |
|---|---|---|---|
| 2609.23496v1 | 24 | Springer (Astrodynamics) | Non-planar Earth–Moon transfer design |
| 2609.24534v1 | 20 | A&A-style | FACSAT-2 premature re-entry, orbital decay |
| 2609.24851v1 | 12 | Nature-style (unnumbered sections) | Spacecraft mass vs. proton shielding |
| 2609.27569v1 | 27 | Copernicus | JUICE-SWI lunar–Earth gravity assist operations |
| 2609.36042v1 | 10 | AASTeX | Orbital Doppler shift of X-ray photons |

93 pages, 316 chunks, 97 detected sections.

## Results per paper

| Paper | Headings | Chunks | Sections | Chunk chars (median / max) | Warnings |
|---|---|---|---|---|---|
| 2609.23496v1 | 20 | 57 | 20 | 1084 / 1550 | none |
| 2609.24534v1 | 20 | 65 | 17 | 1090 / 1943 | none |
| 2609.24851v1 | 9 | 39 | 9 | 1186 / 1836 | none |
| 2609.27569v1 | 46 | 114 | 38 | 1157 / 1940 | none |
| 2609.36042v1 | 13 | 41 | 13 | 1065 / 1788 | none |

No paper failed to parse, no page was a scan, no chunk exceeded the 2000-char
cap, and no chunk had an inverted page range.

---

## 1. Parsing failures

**None fatal.** All five PDFs opened, had a text layer, and produced chunks.

**Inter-word spaces are lost in the span-level extractor** on 3 of 5 papers.
Joining `get_text("dict")` spans naively produces
`Prematurere-entryoftheFACSAT-2nanosatellite` and
`androtating arounditwithanangularvelocityω`. Plain `get_text()` is correct on
all five. *Fixed* by using plain text for content and the dict layer only to
identify which lines are headings (ADR-006 §1). Had this gone unnoticed, every
chunk from those papers would have been unsearchable by keyword and poor by
embedding.

**A paper that is actually a book.** An early candidate (2201.03593) turned out
to be an 816-page textbook whose PDF metadata title was
`plot_qbar_path.raw.tex`. Two consequences, both now handled: ingestion is
capped at 60 pages by default with a warning naming the real page count, and a
LaTeX-artefact metadata title is discarded in favour of the filename.

## 2. Tables and figures that fail extraction

**Figure and table *captions* survive; their *contents* do not.** 57 caption
lines were retained across the five papers. That is the right outcome for
retrieval — a caption is often the most information-dense sentence about a
result, e.g. from 2609.24851:

> "Fig. 1 | Solar modulation reverses a structural trade. Marginal high-mass
> response R24/16 = K24/K16 of the stopping-proton yield against solar
> modulation potential…"

But the figure itself is a vector drawing, and a question whose answer is only
*in the plot* cannot be answered. **Table bodies extract as sequences of
numbers with their column structure destroyed**, e.g. from 2609.24534:

> `n = 15.2292 rev/day, P = 94.55 min, e = 0.00146`

That line is retrievable and quotable, so a question about one of those values
can be answered with a correct page citation. A question requiring the *table's
structure* ("what was the value in the third row?") cannot. No table-to-markdown
reconstruction is attempted; it is on the Future Work list rather than pretended.

**16 of 316 chunks (5%) are low-prose** (<55% letters). Inspected, they are
ORCID/author blocks, software-citation lists (`FTools (Heasarc 2014), Xspec
(Arnaud 1996), DS9…`), and table remnants. They are retrievable but rarely
useful; they are not harmful because retrieval ranks them last for prose
questions.

**Mathematics is extracted as fragments, not equations.** Measured examples:
`dt2 = −2ω × dr`, `of v = c × ∆E`. Display equations lose their layout, so a
question like "what is equation 3?" will not be answered correctly. This is a
real limitation of text extraction without a math-aware parser, and the
honest consequence is that the system is good at the prose and numbers of a
paper and weak at its equations.

## 3. Bad section boundaries

**The AASTeX case nearly broke section attribution entirely.** In 2609.36042
section heads are set in CMR9 among CMR10 body text — *not bold, not larger*.
Requiring a typographic signal detected **1** heading in that paper (and it was
wrong: `Software:`). Adding a strictly-shaped textual path raised it to **13**
correct ones. Had this shipped undetected, every citation from AASTeX papers —
a large share of astronomy — would have said "Front matter".

**False positives found and fixed**, each from a specific paper:

| What was wrongly detected | Paper | Fix |
|---|---|---|
| `Figure 1. A not-to-scale schematic…`, `Table1.` | 2609.36042, 2609.24534 | caption-prefix exclusion |
| `D. Murtagh6, M. Olberg6, M. Rengel3, H. Sagawa7` | 2609.27569 | reject ≥2 commas |
| `calibration modes.` (bold run-in prose) | 2609.27569 | reject non-numbered lines ending in a full stop |
| `d2r` (bold equation fragment) | 2609.23496 | require ≥3 letters, ≥50% alphabetic |
| `2. Each job Ji comprises li operations for i = 1, …` | (regression corpus) | heading titles must be ≤60 chars, comma-free, mostly capitalised |
| rotated `arXiv:2609.24534v1 [astro-ph.IM] 21 Sep 2026` | all | stamp pattern |

**False positives still present:**

- **Multi-line paper titles become 2–3 separate "sections."** 2609.24534's title
  wraps across three lines and each is detected. Harmless in practice — they sit
  before the Abstract and hold title text — but the section list shown to the
  user starts with three fragments.
- **One author bio was detected as a heading** in 2609.23496:
  `L. B. T. Santos Leonardo Barbosa Torres dos Santos received his B.Sc. de…`.
  It is bold, under 90 characters, and (because it wraps) does not end in a full
  stop, so every current exclusion misses it. The cost is one spurious section at
  the very end of the document, after `References`.
- **One 3-character chunk** (`E.1`, an appendix sub-label in 2609.27569) survives
  because it is the entire content of its section and the stub-absorption rule
  deliberately refuses to merge across a section boundary.

**True negatives worth noting:** 2609.24851 (Nature style) has no numbered
sections at all — `Results`, `Discussion`, `Methods`, `Funding` — and all nine
were detected by name. 2609.27569 has a 3-level hierarchy (`2.3.1. Calibration
modes`) and all 46 headings resolved with correct parent paths.

## 4. Retrieval misses

One live end-to-end run, four questions, on 2609.24534 (65 chunks). Retrieval
placed the right section in the top-6 every time:

| Question | Top-6 pages retrieved | Where the answer actually is |
|---|---|---|
| NORAD ID and orbit? | 1, 1, 2, 2, 2, 3 | Abstract (p.1), §2 Data (p.2) ✓ |
| Which density model? | 4, 3, 4, 6, 3, 2 | §3.1 Atmospheric density (p.3) ✓ |
| Actual vs. design lifetime? | 9, 17, 9, 14, 13, 9 | §4.2 (p.9), §5 Discussion (p.14) ✓ |
| Launch cost in USD? | 1, 18, 14, 2, 2, 20 | nowhere — correctly refused ✓ |

**This is four questions, not a measurement.** A hit-rate figure requires the
gold-labelled set and the runner that are Week 6's job; nothing here should be
read as "retrieval works at X%". What it does establish is that the pipeline
retrieves plausibly and that the refusal path fires on a question the paper
does not address.

The hybrid retriever's value is demonstrated separately in a unit test rather
than inferred: with the query embedding pointed deliberately away from the
target chunk, `NRLMSISE-00` is still retrieved first by full-text search. Dense
vectors do not represent identifiers like `NORAD ID 56205` or `G0.11-0.11`, and
those are exactly what students ask about.

## 5. Citation errors

**Zero invalid citations in the live run** — `rejected_citations` was empty for
all four questions, and every cited page fell inside the cited chunk's real
page range. Spot-checked against the PDF text:

| Cited | Quote returned | Correct? |
|---|---|---|
| p.3, §3.1 Atmospheric density | "The thermospheric density was computed with NRLMSISE-00 (Picone et al., 2002)…" | ✓ verbatim, right page |
| p.9, §4.2 Counterfactuals | "Measured indices 2023–2025 2.53 re-entry observed on 27 Oct 2025" | ✓ verbatim (a table remnant, but real) |
| p.14, §5 Discussion | "FACSAT1 lasted 4.51 years and FACSAT-2, larger and technologically superior, 2.54" | ✓ verbatim, right page |

The protection is structural rather than fortunate: the answerer's citations are
checked in code against the chunks retrieved for that request, invalid ones are
dropped, and an answer left with no valid citation is **downgraded to a
refusal**. A test asserts the specific failure — a model citing page 12 for a
chunk that spans only page 3 is rejected, not displayed.

One answer is worth quoting because it shows the grounding working *against* the
paper's own inconsistency:

> "FACSAT-2 lasted 2.53 years (or 2.54 years, as cited in different sections of
> the paper), whereas the mission had declared a requirement of at least five
> years."

Both figures really are in the paper, on pages 9 and 14, and both were cited.

## 6. Other notable failure modes

**Running headers would have polluted every chunk.** `Vargas Domínguez et al.:
Premature re-entry of FACSAT-2` appears on all 20 pages of 2609.24534, and
`Astrodynamics` + a submission URL on all 24 of 2609.23496. Without
repeated-line removal, roughly 5% of every chunk would have been boilerplate,
and keyword search would have matched the header text on every query.

**Paragraph detection was initially useless.** Splitting on blank lines gave 93
"paragraphs" with a median of **3167** characters — one blob per page, because
PDFs do not emit blank lines between paragraphs. Layout-aware detection (a
sentence-final line shorter than the column) gives 461 paragraphs, median
**509**. The first threshold attempt used the *median* line width and missed
paragraph-final lines, because those lines are short by definition and drag the
median down; the 75th percentile fixed it.

**Hyphenation and ligatures.** `wavefunc-` + `tions` and the `ﬁ`/`ﬂ`/`ﬀ` code
points both appear in this corpus and both corrupt keyword search silently.
De-hyphenation and NFKC normalisation are applied; there are tests for both.

**A known, bounded paragraph false-negative.** A paragraph whose last line
happens to fill the column cannot be distinguished from one that wraps, so it
merges with the next paragraph. The chunker then splits the result on size, so
the page and section of a citation stay correct — only the paragraph boundary is
lost. There is a test asserting this so it cannot change silently.

## What this means for the product

Honest statement of capability, from the evidence above:

- **Good at**: prose claims, named methods and models, numbers that appear in
  sentences, section-scoped questions, and refusing what the paper does not say.
- **Weak at**: equations (extracted as fragments), table structure (values
  survive, layout does not), and anything whose only source is a figure.
- **Will not handle**: scanned PDFs — rejected outright with "the PDF is
  probably a scan. OCR is not supported", rather than silently answering from
  nothing.

## Reproducing this

```bash
cd science && python3 -m pytest -q              # 203 tests, all offline
cd api && npx vitest run src/rag/               # 45 tests against real pgvector
cd api && npx tsx scripts/rag-e2e.ts <paper.pdf> "question" ["question" ...]
```

`rag-e2e.ts` runs the real pipeline — science service, real embeddings, real
model — against an in-process Postgres, and prints the chunks retrieved, the
citations returned and any that failed verification.
