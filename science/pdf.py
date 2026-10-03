"""PDF text extraction and cleaning for the paper RAG pipeline.

Two extraction passes, because neither alone is enough (measured on five real
arXiv astro-ph papers, Week 5):

  * `page.get_text()` (plain) gives correctly spaced text. The span-level dict
    loses inter-word spaces in several of these PDFs — joining spans naively
    produces "Prematurere-entryoftheFACSAT-2nanosatellite".
  * `page.get_text("dict")` gives font size and weight, which is by far the
    strongest heading signal. Regex alone cannot tell "II. BACKGROUND" from
    "2. All jobs are released at time 0", and real papers use every heading
    style there is: "I. INTRODUCTION", bare "METHODS", "1. Introduction", and a
    lone "1" on its own line above "Introduction".

So: typography decides WHICH lines are headings, plain text supplies WHAT they
say, matched on a whitespace-stripped key.

Typography alone is still not sufficient. AASTeX papers set section heads at
*body size, not bold* ("2. DATA PIPELINE AND ANALYSIS" in CMR9 among CMR10
body text), so there is no size or weight signal to find. Those are caught by a
second, strictly-shaped textual path: a numbered or roman-numbered line whose
title is short, comma-free, unpunctuated and predominantly capitalised. That
shape excludes the numbered *list items* that break a naive regex ("2. Each job
Ji comprises li operations for i = 1, ..., n, the jth operation ...").

Cleaning removes what every academic PDF adds and no reader wants in a chunk:
running headers/footers repeated on most pages, bare page numbers, the arXiv
stamp, end-of-line hyphenation, and ligature code points.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# PyMuPDF. The package is imported as `pymupdf`; the old `fitz` alias is
# deprecated and slated for removal.
import pymupdf

# A heading is short. Anything longer is a sentence that happens to be bold.
MAX_HEADING_CHARS = 90

# How much larger than body text a line must be to count on size alone.
SIZE_MARGIN_PT = 0.4
BIG_HEADING_MARGIN_PT = 1.5

# A line repeated on at least this fraction of pages is furniture, not content.
RUNNING_LINE_PAGE_FRACTION = 0.5
RUNNING_LINE_MIN_PAGES = 3
# Furniture lives at the top or bottom of the page.
EDGE_LINES = 3

ARXIV_STAMP = re.compile(r"^\s*arXiv:\d{4}\.\d{4,5}(v\d+)?\s*\[[^\]]+\]\s*\d.*$", re.I)
PAGE_NUMBER_ONLY = re.compile(r"^\s*(?:page\s*)?[ivxlcdm]{1,6}|\d{1,4}\s*$", re.I)
CAPTION_PREFIX = re.compile(r"^\s*(?:fig(?:ure)?\.?|table|tab\.|eq(?:uation)?\.?|alg(?:orithm)?\.?|listing|appendix\s+[a-z]\s*[:.])\s*\d*", re.I)

# Section words that are headings even without numbering or a size change.
KNOWN_SECTIONS = (
    "abstract", "introduction", "background", "related work", "motivation",
    "methods", "methodology", "materials and methods", "data", "observations",
    "model", "models", "theory", "analysis", "experiments", "experimental setup",
    "results", "results and discussion", "discussion", "conclusion", "conclusions",
    "conclusions and future work", "summary", "summary and conclusions",
    "acknowledgements", "acknowledgments", "references", "bibliography",
    "appendix", "nomenclature", "keywords", "funding", "data availability",
)

NUMBERED_HEADING = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+(\S.*)$")
ROMAN_HEADING = re.compile(r"^\s*([IVXLC]+)\.\s+(\S.*)$")
LONE_NUMBER = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s*$")


@dataclass
class Page:
    """One page of cleaned text, with the headings that start on it."""

    number: int  # 1-based, matching what a reader sees in a PDF viewer
    text: str
    # Heading lines in reading order, as (line_index_within_text, heading_text).
    headings: list[tuple[int, str]] = field(default_factory=list)


@dataclass
class Document:
    pages: list[Page]
    page_count: int
    title: str | None
    # Diagnostics, surfaced so ingestion failures are visible rather than silent.
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)


class PdfExtractionError(RuntimeError):
    """The file could not be opened or contained no extractable text."""


def _norm_key(s: str) -> str:
    """Whitespace- and punctuation-insensitive key for matching lines."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _normalize_unicode(s: str) -> str:
    """NFKC folds ligatures (ﬁ -> fi) and other compatibility forms."""
    return unicodedata.normalize("NFKC", s)


def _body_font_size(doc: pymupdf.Document) -> float:
    """The most common font size by character count: the body text size."""
    weights: dict[float, int] = {}
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span["text"].strip():
                        size = round(span["size"], 1)
                        weights[size] = weights.get(size, 0) + len(span["text"])
    if not weights:
        return 10.0
    return max(weights.items(), key=lambda kv: kv[1])[0]


def _typographic_heading_keys(doc: pymupdf.Document, body_size: float) -> dict[str, float]:
    """Normalized keys of lines that *look* like headings typographically.

    Value is how many points larger than body text the line is, so callers can
    require a bigger jump for lines that have no textual heading cues.
    """
    keys: dict[str, float] = {}
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line.get("spans", []) if s["text"].strip()]
                if not spans:
                    continue
                raw = "".join(s["text"] for s in spans).strip()
                if len(raw) > MAX_HEADING_CHARS:
                    continue
                size = max(s["size"] for s in spans)
                # flag bit 16 is the synthetic/real bold bit in MuPDF.
                bold = any("bold" in s["font"].lower() or (s["flags"] & 16) for s in spans)
                if size > body_size + SIZE_MARGIN_PT or bold:
                    key = _norm_key(raw)
                    if key:
                        keys[key] = max(keys.get(key, 0.0), size - body_size)
    return keys


def _looks_like_heading_text(line: str) -> bool:
    """Textual cues: numbering, roman numerals, or a known section name."""
    stripped = line.strip().rstrip(":")
    if not stripped:
        return False
    lowered = stripped.lower()
    if lowered in KNOWN_SECTIONS:
        return True
    for pattern in (NUMBERED_HEADING, ROMAN_HEADING):
        match = pattern.match(stripped)
        if match and len(match.group(2)) <= MAX_HEADING_CHARS:
            return True
    # "ABSTRACT" / "METHODS" in caps, with at least one real word.
    if stripped.isupper() and 3 <= len(stripped) <= 40 and re.search(r"[A-Z]{3}", stripped):
        return True
    # "Results and discussion" — title case, no terminal punctuation.
    words = stripped.split()
    if 1 <= len(words) <= 8 and not stripped[-1] in ".,;" and lowered.split(" ")[0] in KNOWN_SECTIONS:
        return True
    return False


# A heading's title is short, unpunctuated and mostly capitalised. Numbered
# list items are long, comma-laden sentences; this is what separates them.
MAX_HEADING_TITLE_CHARS = 60
MIN_CAPITALISED_WORD_FRACTION = 0.5


def _mostly_capitalised(title: str) -> bool:
    words = [w for w in re.split(r"[\s/–-]+", title) if w and w[0].isalpha()]
    if not words:
        return False
    if title.isupper():
        return True
    capitalised = sum(1 for w in words if w[0].isupper())
    return capitalised / len(words) >= MIN_CAPITALISED_WORD_FRACTION


def _strong_textual_heading(line: str) -> bool:
    """True for lines that are headings on their text alone, no typography.

    Deliberately narrow: this path runs without any font evidence, so it must
    not admit numbered list items or sentence fragments.
    """
    stripped = line.strip()
    for pattern in (NUMBERED_HEADING, ROMAN_HEADING):
        match = pattern.match(stripped)
        if not match:
            continue
        title = match.group(2).strip()
        if len(title) > MAX_HEADING_TITLE_CHARS or "," in title:
            return False
        if title[-1] in ".,;:" and not title.isupper():
            return False
        return _mostly_capitalised(title)
    # A standalone line that is exactly a section name: "Introduction",
    # "References", "METHODS".
    if stripped.rstrip(":").lower() in KNOWN_SECTIONS:
        return True
    return False


def _is_excluded_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > MAX_HEADING_CHARS:
        return True
    if ARXIV_STAMP.match(stripped) or CAPTION_PREFIX.match(stripped):
        return True
    if stripped.endswith(","):  # author lists, wrapped affiliations
        return True
    if stripped.count(",") >= 2:  # "D. Murtagh6, M. Olberg6, M. Rengel3, ..."
        return True
    # Prose ending in a full stop: figure captions, author bios, body lines that
    # happen to be bold. A numbered or all-caps heading may legitimately end in
    # one ("7. Conclusions." / "INTRODUCTION."), so those are exempt.
    if stripped.endswith(".") and not (
        NUMBERED_HEADING.match(stripped) or ROMAN_HEADING.match(stripped) or stripped.isupper()
    ):
        return True
    letters = sum(c.isalpha() for c in stripped)
    if letters < 3:  # equation fragments, panel labels
        return True
    if letters / len(stripped) < 0.5:  # mostly symbols: math, not a heading
        return True
    if "@" in stripped or stripped.lower().startswith("http"):
        return True
    return False


def _find_running_lines(page_texts: list[str]) -> set[str]:
    """Keys of lines that repeat near the edges of most pages: furniture."""
    if len(page_texts) < RUNNING_LINE_MIN_PAGES:
        return set()
    counts: dict[str, int] = {}
    for text in page_texts:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        edge = lines[:EDGE_LINES] + lines[-EDGE_LINES:]
        for key in {_norm_key(ln) for ln in edge if _norm_key(ln)}:
            counts[key] = counts.get(key, 0) + 1
    threshold = max(RUNNING_LINE_MIN_PAGES, int(len(page_texts) * RUNNING_LINE_PAGE_FRACTION))
    return {key for key, n in counts.items() if n >= threshold}


def _dehyphenate(lines: list[str]) -> list[str]:
    """Join "wavefunc-" + "tions" into one word, as the author wrote it."""
    out: list[str] = []
    carry = ""
    for line in lines:
        current = carry + line
        carry = ""
        match = re.search(r"(\w{2,})-$", current)
        if match:
            carry = current[: match.end() - 1]  # drop the hyphen, keep the stem
            continue
        out.append(current)
    if carry:
        out.append(carry)
    return out


def extract(pdf_bytes: bytes, *, max_pages: int | None = None) -> Document:
    """Extract and clean a PDF into pages with heading positions."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # pragma: no cover - mupdf raises many types
        raise PdfExtractionError(f"Could not open PDF: {exc}") from exc

    warnings: list[str] = []
    try:
        if doc.page_count == 0:
            raise PdfExtractionError("PDF has no pages")
        if doc.is_encrypted:
            raise PdfExtractionError("PDF is encrypted")

        total_pages = doc.page_count
        limit = total_pages if max_pages is None else min(total_pages, max_pages)
        if limit < total_pages:
            warnings.append(f"Only the first {limit} of {total_pages} pages were ingested.")

        body_size = _body_font_size(doc)
        heading_keys = _typographic_heading_keys(doc, body_size)

        raw_pages = [_normalize_unicode(doc[i].get_text()) for i in range(limit)]
        running = _find_running_lines(raw_pages)

        pages: list[Page] = []
        empty_pages = 0
        for index, raw in enumerate(raw_pages):
            lines = [ln.rstrip() for ln in raw.splitlines()]
            kept: list[str] = []
            for position, line in enumerate(lines):
                stripped = line.strip()
                if not stripped:
                    kept.append("")
                    continue
                key = _norm_key(stripped)
                near_edge = position < EDGE_LINES or position >= len(lines) - EDGE_LINES
                if key in running and near_edge:
                    continue
                if ARXIV_STAMP.match(stripped):
                    continue
                if near_edge and PAGE_NUMBER_ONLY.fullmatch(stripped) and not _looks_like_heading_text(stripped):
                    # A lone "1" at the top of page 2 of a paper is the page
                    # number; a lone "1" directly above "Introduction" is a
                    # section number, handled by the merge below.
                    following = next((l.strip() for l in lines[position + 1:position + 2] if l.strip()), "")
                    if not (following and _norm_key(following) in heading_keys):
                        continue
                kept.append(line)

            # _merge_split_headings registers the merged key ("1. Introduction")
            # in heading_keys; the dict layer only knows "1" and "Introduction"
            # separately, so without this the merged line matches nothing.
            merged = _merge_split_headings(kept, heading_keys)
            text_lines = _dehyphenate(merged)
            headings = _detect_headings(text_lines, heading_keys)
            text = "\n".join(text_lines).strip()
            if not text:
                empty_pages += 1
            pages.append(Page(number=index + 1, text=text, headings=headings))

        if empty_pages:
            warnings.append(
                f"{empty_pages} of {limit} pages yielded no text (likely scanned images; OCR is not run)."
            )
        if not any(p.text for p in pages):
            raise PdfExtractionError(
                "No extractable text found — the PDF is probably a scan. OCR is not supported."
            )
        if not any(p.headings for p in pages):
            warnings.append("No section headings were detected; the whole document is one section.")

        meta = doc.metadata or {}
        title = (meta.get("title") or "").strip() or None
        # Many arXiv PDFs carry a LaTeX artefact as the title; prefer the first
        # big line of page 1 in that case.
        if title and (title.endswith(".tex") or title.lower() in {"title", "untitled"}):
            title = None
        return Document(pages=pages, page_count=total_pages, title=title, warnings=warnings)
    finally:
        doc.close()


def _merge_split_headings(lines: list[str], heading_keys: dict[str, float]) -> list[str]:
    """Join a lone section number with the heading on the following line."""
    out: list[str] = []
    skip_next = False
    for i, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
        stripped = line.strip()
        match = LONE_NUMBER.fullmatch(stripped)
        if match and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if nxt and _norm_key(nxt) in heading_keys and _norm_key(stripped) in heading_keys:
                combined = f"{match.group(1)}. {nxt}"
                heading_keys[_norm_key(combined)] = max(
                    heading_keys[_norm_key(stripped)], heading_keys[_norm_key(nxt)]
                )
                out.append(combined)
                skip_next = True
                continue
        out.append(line)
    return out


def _detect_headings(lines: list[str], heading_keys: dict[str, float]) -> list[tuple[int, str]]:
    """Heading lines, by index, combining typography with textual cues."""
    found: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if _is_excluded_heading(stripped):
            continue
        size_jump = heading_keys.get(_norm_key(stripped))
        if size_jump is not None:
            # Typographic candidate: textual cues confirm a modest size/weight
            # change, while a large jump stands on its own (paper titles,
            # unnumbered section names set in bold display type).
            if _looks_like_heading_text(stripped) or size_jump >= BIG_HEADING_MARGIN_PT:
                found.append((index, stripped))
                continue
        # No usable typography (AASTeX sets heads at body size): fall back to the
        # strictly-shaped textual path.
        if _strong_textual_heading(stripped):
            found.append((index, stripped))
    return found
