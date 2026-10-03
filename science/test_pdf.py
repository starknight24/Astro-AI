"""Extraction tests.

Fixture PDFs are *generated* with PyMuPDF inside the tests rather than committed
as binaries: each test then states the exact layout it is about (a running
header, a hyphenated word, an AASTeX body-size heading), the suite stays offline,
and there is no opaque blob to re-generate when behaviour changes.
"""
import pymupdf
import pytest

import pdf

BODY_SIZE = 10.0
HEADING_SIZE = 14.0


def build_pdf(pages: list[list[tuple[str, float, bool]]]) -> bytes:
    """Build a PDF from [[(text, size, bold), ...], ...] — one list per page."""
    doc = pymupdf.open()
    for lines in pages:
        page = doc.new_page(width=595, height=842)  # A4
        y = 60.0
        for text, size, bold in lines:
            font = "Times-Bold" if bold else "Times-Roman"
            page.insert_text((60, y), text, fontsize=size, fontname=font)
            y += size * 1.6
        doc.close() if False else None
    data = doc.tobytes()
    doc.close()
    return data


def body(text: str) -> tuple[str, float, bool]:
    return (text, BODY_SIZE, False)


def heading(text: str, size: float = HEADING_SIZE, bold: bool = True) -> tuple[str, float, bool]:
    return (text, size, bold)


# ---------- basic extraction ----------

def test_extracts_text_and_page_count():
    data = build_pdf([[body("First page text here.")], [body("Second page text here.")]])
    doc = pdf.extract(data)
    assert doc.page_count == 2
    assert "First page text here." in doc.pages[0].text
    assert "Second page text here." in doc.pages[1].text
    assert doc.pages[0].number == 1 and doc.pages[1].number == 2


def test_rejects_a_file_that_is_not_a_pdf():
    with pytest.raises(pdf.PdfExtractionError):
        pdf.extract(b"this is not a pdf at all")


def test_rejects_a_pdf_with_no_extractable_text():
    """An image-only scan: no text layer, so there is nothing to chunk."""
    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    with pytest.raises(pdf.PdfExtractionError) as exc:
        pdf.extract(data)
    assert "scan" in str(exc.value).lower()


def test_max_pages_limits_ingestion_and_warns():
    pages = [[body(f"Page {i} content line.")] for i in range(1, 6)]
    doc = pdf.extract(build_pdf(pages), max_pages=2)
    assert len(doc.pages) == 2
    assert doc.page_count == 5
    assert any("first 2 of 5" in w for w in doc.warnings)


# ---------- heading detection ----------

def test_detects_a_heading_by_size_and_weight():
    data = build_pdf([[
        heading("2. Methodology"),
        body("We describe the approach used in this work."),
    ]])
    doc = pdf.extract(data)
    assert [h for _, h in doc.pages[0].headings] == ["2. Methodology"]


def test_detects_an_unnumbered_section_name():
    data = build_pdf([[heading("Introduction"), body("Orbital mechanics matters.")]])
    doc = pdf.extract(data)
    assert [h for _, h in doc.pages[0].headings] == ["Introduction"]


def test_detects_a_body_size_heading_from_its_text_alone():
    """AASTeX sets section heads at body size, not bold — no typographic signal.

    Measured on arXiv 2609.36042: before this path existed the paper yielded one
    (wrong) heading; after it, thirteen correct ones.
    """
    data = build_pdf([[
        (("2. DATA PIPELINE AND ANALYSIS"), BODY_SIZE, False),
        body("The pipeline is telescope agnostic and uses standard conventions."),
    ]])
    doc = pdf.extract(data)
    assert [h for _, h in doc.pages[0].headings] == ["2. DATA PIPELINE AND ANALYSIS"]


def test_merges_a_lone_section_number_with_its_title():
    """Some layouts put the number on its own line above the heading."""
    data = build_pdf([[
        heading("1"),
        heading("Introduction"),
        body("With the Artemis mission, humanity enters a new era."),
    ]])
    doc = pdf.extract(data)
    assert [h for _, h in doc.pages[0].headings] == ["1. Introduction"]


def test_detects_subsection_hierarchy():
    data = build_pdf([[
        heading("3. Methodology"),
        body("Overview of the method."),
        heading("3.1. Atmospheric density", size=12.0),
        body("We use the NRLMSISE-00 model."),
    ]])
    doc = pdf.extract(data)
    assert [h for _, h in doc.pages[0].headings] == ["3. Methodology", "3.1. Atmospheric density"]


@pytest.mark.parametrize(
    "line",
    [
        "Figure 1. A not-to-scale schematic of the orbital motion",
        "Table 1. Quantities used in the simulation",
        "Eq. 4",
    ],
)
def test_captions_are_not_headings(line):
    """Captions are bold in most templates; they are not sections."""
    data = build_pdf([[heading(line, size=9.0), body("Body text follows the caption.")]])
    doc = pdf.extract(data)
    assert doc.pages[0].headings == []


def test_author_lists_are_not_headings():
    """Measured false positive: arXiv 2609.27569's author line is bold."""
    data = build_pdf([[
        heading("D. Murtagh6, M. Olberg6, M. Rengel3, H. Sagawa7", size=12.0),
        body("Abstract text."),
    ]])
    doc = pdf.extract(data)
    assert doc.pages[0].headings == []


def test_bold_prose_ending_in_a_full_stop_is_not_a_heading():
    """Measured false positive: a bold run-in line read as a section."""
    data = build_pdf([[
        heading("calibration modes.", size=12.0),
        body("Further body text."),
    ]])
    doc = pdf.extract(data)
    assert doc.pages[0].headings == []


def test_numbered_list_items_are_not_headings():
    """The regex trap: a numbered list item looks like a numbered heading."""
    data = build_pdf([[
        (("2. Each job Ji comprises li operations for i = 1, n, the jth operation"), BODY_SIZE, False),
        (("4. The processing time of the operation Oij on machine Mk is predefined"), BODY_SIZE, False),
    ]])
    doc = pdf.extract(data)
    assert doc.pages[0].headings == []


def test_equation_fragments_are_not_headings():
    data = build_pdf([[heading("d2r", size=12.0), body("where r is the position vector.")]])
    doc = pdf.extract(data)
    assert doc.pages[0].headings == []


def test_warns_when_no_headings_are_found():
    data = build_pdf([[body("Just prose, no structure at all, nothing to see.")]])
    doc = pdf.extract(data)
    assert any("no section headings" in w.lower() for w in doc.warnings)


# ---------- cleaning ----------

def test_removes_running_headers_repeated_across_pages():
    header = "Vargas Dominguez et al.: Premature re-entry of FACSAT-2"
    pages = [[body(header), body(f"Unique body content for page {i}.")] for i in range(1, 6)]
    doc = pdf.extract(build_pdf(pages))
    assert all(header not in page.text for page in doc.pages)
    assert "Unique body content for page 3." in doc.pages[2].text


def test_keeps_a_line_that_repeats_only_twice():
    """Two occurrences is a coincidence, not furniture."""
    repeated = "A sentence that happens to appear twice."
    pages = [
        [body(repeated), body("One.")],
        [body(repeated), body("Two.")],
        [body("Different."), body("Three.")],
        [body("Other."), body("Four.")],
    ]
    doc = pdf.extract(build_pdf(pages))
    assert sum(repeated in p.text for p in doc.pages) == 2


def test_removes_bare_page_numbers():
    pages = [[body(str(i)), body(f"Content of page {i} goes here.")] for i in range(1, 6)]
    doc = pdf.extract(build_pdf(pages))
    assert doc.pages[3].text.strip().startswith("Content of page 4")


def test_removes_the_arxiv_stamp():
    data = build_pdf([[
        body("arXiv:2609.24534v1  [astro-ph.IM]  21 Sep 2026"),
        body("Real content starts here."),
    ]])
    doc = pdf.extract(data)
    assert "arXiv:" not in doc.pages[0].text


def test_rejoins_hyphenated_words_across_line_breaks():
    data = build_pdf([[body("the quantum wavefunc-"), body("tions are orthogonal.")]])
    doc = pdf.extract(data)
    assert "wavefunctions are orthogonal" in doc.pages[0].text


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("the ﬁrst measurement", "the first measurement"),
        ("scandium triﬂuoride", "scandium trifluoride"),
        ("diﬀerent results", "different results"),
    ],
)
def test_normalises_ligatures(raw, expected):
    """NFKC folds the ﬁ/ﬂ/ﬀ code points real PDFs emit (seen in arXiv 1905.09250).

    Asserted against the normaliser directly: the base-14 fonts available for
    building a fixture PDF cannot encode U+FB01, so a generated PDF would
    silently substitute a dot and prove nothing.
    """
    assert pdf._normalize_unicode(raw) == expected


def test_ignores_a_latex_artefact_title():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((60, 60), "Some real content here.", fontsize=BODY_SIZE)
    doc.set_metadata({"title": "plot_qbar_path.raw.tex"})
    data = doc.tobytes()
    doc.close()
    assert pdf.extract(data).title is None


def test_keeps_a_real_metadata_title():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((60, 60), "Some real content here.", fontsize=BODY_SIZE)
    doc.set_metadata({"title": "Designing 3D transfers: application to Earth-Moon"})
    data = doc.tobytes()
    doc.close()
    assert pdf.extract(data).title == "Designing 3D transfers: application to Earth-Moon"


def test_document_text_concatenates_pages():
    data = build_pdf([[body("Alpha content line.")], [body("Beta content line.")]])
    doc = pdf.extract(data)
    assert "Alpha content line." in doc.text and "Beta content line." in doc.text
