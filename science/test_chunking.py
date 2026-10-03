"""Chunking tests.

The invariants that matter for citations: a chunk belongs to exactly one
section, never exceeds the hard cap, and reports a page range a reader can turn
to. Documents are built directly as `pdf.Document` objects so each test states
its own structure without going through a PDF.
"""
import pytest

import chunking
from chunking import MAX_CHARS, MIN_CHARS, TARGET_CHARS, chunk_document, chunk_stats, split_paragraphs
from pdf import Document, Page


def sentences(n: int, word: str = "orbit") -> str:
    """n sentences of ~60 characters each, so sizes are predictable."""
    return " ".join(f"The {word} parameter number {i} was measured carefully." for i in range(n))


def doc(pages: list[Page], title: str = "T") -> Document:
    return Document(pages=pages, page_count=len(pages), title=title)


def page(number: int, lines: list[str], headings: list[int]) -> Page:
    """`headings` are indices into `lines`."""
    return Page(
        number=number,
        text="\n".join(lines),
        headings=[(i, lines[i]) for i in headings],
    )


# ---------- paragraph detection ----------

def test_splits_paragraphs_on_short_sentence_final_lines():
    """PDFs rarely emit blank lines; a short line ending a sentence is the signal."""
    text = "\n".join([
        "This is a full justified line of roughly sixty characters here",
        "and it continues across the column until it ends.",
        "A second paragraph begins on this line and runs to full width,",
        "ending short.",
    ])
    paragraphs = split_paragraphs(text)
    assert len(paragraphs) == 2
    assert paragraphs[0].endswith("until it ends.")
    assert paragraphs[1].endswith("ending short.")


def test_a_paragraph_whose_last_line_fills_the_column_merges_with_the_next():
    """Known limitation, documented rather than papered over.

    Layout gives no signal here: a sentence that happens to end exactly at the
    right margin is indistinguishable from one that wraps. The consequence is a
    double-length paragraph, which the chunker then splits on size anyway, so a
    citation still points at the right page and section — only the paragraph
    boundary is lost. See ADR-006.
    """
    text = "\n".join([
        "This paragraph ends flush with the right margin of the column.",
        "A new paragraph starts here but cannot be detected as separate.",
    ])
    assert len(split_paragraphs(text)) == 1


def test_joins_wrapped_lines_into_one_paragraph():
    text = "The spacecraft was placed into a Sun-synchronous orbit at an\naltitude of 500 kilometres above the surface."
    assert split_paragraphs(text) == [
        "The spacecraft was placed into a Sun-synchronous orbit at an altitude of 500 kilometres above the surface."
    ]


def test_blank_lines_still_separate_paragraphs():
    assert len(split_paragraphs("First part here.\n\nSecond part here.")) == 2


def test_empty_text_yields_no_paragraphs():
    assert split_paragraphs("") == []
    assert split_paragraphs("\n\n  \n") == []


# ---------- section boundaries ----------

def test_a_chunk_never_spans_two_sections():
    lines = ["1. Introduction", sentences(3), "2. Methods", sentences(3)]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    assert len(chunks) >= 2
    sections = {c.section for c in chunks}
    assert sections == {"1. Introduction", "2. Methods"}
    for chunk in chunks:
        other = "2. Methods" if chunk.section == "1. Introduction" else "1. Introduction"
        assert other not in chunk.content


def test_content_before_the_first_heading_is_front_matter():
    lines = ["Authors and affiliations line.", sentences(2), "1. Introduction", sentences(2)]
    chunks = chunk_document(doc([page(1, lines, [2])]), "p1")
    assert chunks[0].section == chunking.FRONT_MATTER
    assert any(c.section == "1. Introduction" for c in chunks)


def test_section_path_records_the_hierarchy():
    lines = ["3. Methodology", sentences(2), "3.1. Atmospheric density", sentences(2)]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    deep = [c for c in chunks if c.section == "3.1. Atmospheric density"]
    assert deep
    assert deep[0].section_path == "3. Methodology > 3.1. Atmospheric density"


def test_a_sibling_section_pops_the_path_stack():
    lines = [
        "3. Methodology", sentences(1),
        "3.1. Density", sentences(1),
        "4. Results", sentences(1),
    ]
    chunks = chunk_document(doc([page(1, lines, [0, 2, 4])]), "p1")
    results = [c for c in chunks if c.section == "4. Results"]
    assert results[0].section_path == "4. Results"


def test_unnumbered_headings_are_all_top_level():
    lines = ["Results", sentences(1), "Discussion", sentences(1)]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    assert {c.section_path for c in chunks} == {"Results", "Discussion"}


def test_a_section_with_no_body_produces_no_chunks():
    lines = ["References", "1. Introduction", sentences(2)]
    chunks = chunk_document(doc([page(1, lines, [0, 1])]), "p1")
    assert all(c.section != "References" for c in chunks)


# ---------- sizing ----------

def test_no_chunk_exceeds_the_hard_cap():
    lines = ["1. Introduction", sentences(400)]
    chunks = chunk_document(doc([page(1, lines, [0])]), "p1")
    assert chunks
    assert max(c.char_count for c in chunks) <= MAX_CHARS


def test_overlap_plus_a_large_paragraph_still_respects_the_cap():
    """Regression: a 1897-char paragraph plus a 200-char carry produced 2097."""
    big = sentences(32)  # ~1900 chars
    lines = ["1. Introduction", sentences(20), big]
    chunks = chunk_document(doc([page(1, lines, [0])]), "p1")
    assert max(c.char_count for c in chunks) <= MAX_CHARS


def test_chunks_land_near_the_target_size():
    lines = ["1. Introduction", sentences(200)]
    chunks = chunk_document(doc([page(1, lines, [0])]), "p1")
    middle = chunks[1:-1]  # first and last are free to be short
    assert middle
    for chunk in middle:
        assert 0.5 * TARGET_CHARS <= chunk.char_count <= MAX_CHARS


def test_consecutive_chunks_in_a_section_overlap():
    lines = ["1. Introduction", sentences(120)]
    chunks = chunk_document(doc([page(1, lines, [0])]), "p1")
    assert len(chunks) >= 2
    tail = chunks[0].content[-60:]
    assert any(word in chunks[1].content for word in tail.split()[:3])


def test_overlap_never_crosses_a_section_boundary():
    """Carrying text across a heading would misattribute a citation."""
    lines = ["1. Introduction", sentences(60), "2. Methods", sentences(60)]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    first_methods = next(c for c in chunks if c.section == "2. Methods")
    assert "Introduction" not in first_methods.content


def test_a_single_long_sentence_is_split_rather_than_dropped():
    """A table row or equation dump has no sentence boundary to cut on."""
    runaway = "value " * 1200  # ~7200 chars, no punctuation
    chunks = chunk_document(doc([page(1, ["1. Data", runaway], [0])]), "p1")
    assert chunks
    assert max(c.char_count for c in chunks) <= MAX_CHARS
    assert sum(c.content.count("value") for c in chunks) >= 1000


def test_rejects_an_impossible_size_configuration():
    document = doc([page(1, ["1. Introduction", sentences(5)], [0])])
    with pytest.raises(ValueError):
        chunk_document(document, "p1", target_chars=0)
    with pytest.raises(ValueError):
        chunk_document(document, "p1", target_chars=2000, max_chars=100)


def test_sizes_are_configurable():
    lines = ["1. Introduction", sentences(60)]
    small = chunk_document(doc([page(1, lines, [0])]), "p1", target_chars=400, max_chars=600, overlap_chars=0)
    large = chunk_document(doc([page(1, lines, [0])]), "p1", target_chars=2000, max_chars=2400, overlap_chars=0)
    assert len(small) > len(large)
    assert max(c.char_count for c in small) <= 600


# ---------- page attribution ----------

def test_page_numbers_follow_the_source_pages():
    pages = [
        page(1, ["1. Introduction", sentences(3)], [0]),
        page(2, [sentences(3)], []),
        page(3, [sentences(3)], []),
    ]
    chunks = chunk_document(doc(pages), "p1")
    assert min(c.page for c in chunks) == 1
    assert max(c.page_end for c in chunks) == 3
    for chunk in chunks:
        assert 1 <= chunk.page <= chunk.page_end <= 3


def test_a_chunk_spanning_a_page_break_reports_both_pages():
    pages = [
        page(1, ["1. Introduction", sentences(4)], [0]),
        page(2, [sentences(4)], []),
    ]
    chunks = chunk_document(doc(pages), "p1", target_chars=2000, max_chars=2400)
    spanning = [c for c in chunks if c.page != c.page_end]
    assert spanning, "expected at least one chunk to cross the page break"
    assert spanning[0].page == 1 and spanning[0].page_end == 2


def test_headings_on_a_later_page_start_a_section_there():
    pages = [
        page(1, ["1. Introduction", sentences(3)], [0]),
        page(2, ["2. Methods", sentences(3)], [0]),
    ]
    chunks = chunk_document(doc(pages), "p1")
    methods = [c for c in chunks if c.section == "2. Methods"]
    assert methods and methods[0].page == 2


# ---------- stubs and indices ----------

def test_a_stub_is_absorbed_into_its_neighbour_in_the_same_section():
    lines = ["1. Introduction", sentences(20), "Fig 2"]
    chunks = chunk_document(doc([page(1, lines, [0])]), "p1")
    assert all(c.char_count >= MIN_CHARS for c in chunks)


def test_a_short_section_is_kept_rather_than_merged_across_a_boundary():
    """"Competing interests" really is a 43-character section in real papers."""
    lines = ["1. Introduction", sentences(20), "Competing interests", "The authors declare none."]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    short = [c for c in chunks if c.section == "Competing interests"]
    assert len(short) == 1
    assert short[0].char_count < MIN_CHARS
    assert "Introduction" not in short[0].content


def test_chunk_indices_are_contiguous_from_zero():
    lines = ["1. Introduction", sentences(50), "2. Methods", sentences(50)]
    chunks = chunk_document(doc([page(1, lines, [0, 2])]), "p1")
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_paper_id_is_carried_on_every_chunk():
    chunks = chunk_document(doc([page(1, ["1. Introduction", sentences(10)], [0])]), "paper-42")
    assert {c.paper_id for c in chunks} == {"paper-42"}


def test_to_dict_exposes_the_citation_metadata():
    chunks = chunk_document(doc([page(1, ["1. Introduction", sentences(10)], [0])]), "p1")
    payload = chunks[0].to_dict()
    for key in ("paper_id", "chunk_index", "content", "page", "page_end", "section", "section_path"):
        assert key in payload


# ---------- stats ----------

def test_stats_report_zero_for_an_empty_document():
    assert chunk_stats([]) == {"count": 0}


def test_stats_summarise_sizes_and_coverage():
    pages = [
        page(1, ["1. Introduction", sentences(30)], [0]),
        page(2, ["2. Methods", sentences(30)], [0]),
    ]
    stats = chunk_stats(chunk_document(doc(pages), "p1"))
    assert stats["count"] > 0
    assert stats["sections"] == 2
    assert stats["pages_covered"] == 2
    assert stats["chars_min"] <= stats["chars_median"] <= stats["chars_max"]
