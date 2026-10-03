"""Section-aware chunking for academic papers.

Chunk boundaries are chosen so that a retrieved chunk is something a reader
could be shown and a citation could point at: it belongs to exactly one section,
it starts and ends at a paragraph boundary wherever possible, and it carries the
page it came from.

Sizing is measured, not guessed. Across the five arXiv astro-ph papers used in
Week 5 (401 paragraphs after layout-aware paragraph detection):

    median 509 chars · p75 941 · p90 1565 · p95 2136 · max 4420

so TARGET_CHARS = 1400 holds the median paragraph with surrounding context, or
one p75 paragraph whole, and ~78% of paragraphs are never split at all. See
ADR-006 for the full reasoning and the alternatives rejected.

Paragraph detection cannot rely on blank lines: PDFs almost never emit them
between paragraphs. The usable signal is a line that ends a sentence *and* is
noticeably shorter than the column width — the last line of a paragraph.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

from pdf import Document, Page

# Sizing, in characters. Characters rather than tokens because chunking must not
# depend on a tokenizer that belongs to whichever embedding model is in use;
# ~4 chars/token is the working conversion for English prose.
TARGET_CHARS = 1400
MAX_CHARS = 2000
# ~14%: about one sentence, so a claim spanning a boundary stays retrievable
# from either side.
OVERLAP_CHARS = 200
# Below this a chunk is a stub (a stray caption line); it is merged forward.
MIN_CHARS = 120

# A line is a paragraph's last line if it ends a sentence and is this much
# shorter than the page's typical full line.
SHORT_LINE_RATIO = 0.85

TERMINAL_PUNCTUATION = re.compile(r"[.!?][\"')\]]?$")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[])")
SECTION_NUMBER = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+")

FRONT_MATTER = "Front matter"


@dataclass
class Chunk:
    paper_id: str
    chunk_index: int
    content: str
    # 1-based page the chunk starts on, and the last page it covers.
    page: int
    page_end: int
    # Leaf section heading, e.g. "3.1. Atmospheric density".
    section: str
    # Full path, e.g. "3. Methodology > 3.1. Atmospheric density".
    section_path: str
    section_index: int
    char_count: int = 0

    def __post_init__(self) -> None:
        self.char_count = len(self.content)

    def to_dict(self) -> dict:
        return {
            "paper_id": self.paper_id,
            "chunk_index": self.chunk_index,
            "content": self.content,
            "page": self.page,
            "page_end": self.page_end,
            "section": self.section,
            "section_path": self.section_path,
            "section_index": self.section_index,
            "char_count": self.char_count,
        }


@dataclass
class _Block:
    """A paragraph with the page it appeared on."""

    text: str
    page: int


@dataclass
class _Section:
    heading: str
    path: str
    index: int
    blocks: list[_Block] = field(default_factory=list)


def split_paragraphs(page_text: str) -> list[str]:
    """Join wrapped lines back into paragraphs."""
    lines = [ln.strip() for ln in page_text.splitlines()]
    content = [ln for ln in lines if ln]
    if not content:
        return []
    # The 75th percentile, not the median: paragraph-final lines are short by
    # definition and drag a median below the real column width, which then fails
    # to recognise the very lines it exists to find.
    widths = sorted(len(ln) for ln in content)
    typical = widths[min(int(len(widths) * 0.75), len(widths) - 1)] or 1

    paragraphs: list[str] = []
    buffer: list[str] = []
    for line in lines:
        if not line:
            if buffer:
                paragraphs.append(" ".join(buffer))
                buffer = []
            continue
        buffer.append(line)
        if TERMINAL_PUNCTUATION.search(line) and len(line) < typical * SHORT_LINE_RATIO:
            paragraphs.append(" ".join(buffer))
            buffer = []
    if buffer:
        paragraphs.append(" ".join(buffer))
    return [p for p in paragraphs if p.strip()]


def _section_depth(heading: str) -> int:
    """Depth from the heading's numbering; unnumbered headings are top level."""
    match = SECTION_NUMBER.match(heading)
    if not match:
        return 1
    return len(match.group(1).split("."))


def _build_sections(document: Document) -> list[_Section]:
    """Split the document into sections, preserving the heading hierarchy."""
    sections: list[_Section] = []
    stack: list[str] = []  # headings by depth, for the section path
    current = _Section(heading=FRONT_MATTER, path=FRONT_MATTER, index=0)

    for page in document.pages:
        heading_indices = {index: text for index, text in page.headings}
        lines = page.text.splitlines()
        pending: list[str] = []

        def flush(target: _Section, page_number: int = page.number) -> None:
            if not pending:
                return
            for paragraph in split_paragraphs("\n".join(pending)):
                target.blocks.append(_Block(text=paragraph, page=page_number))
            pending.clear()

        for index, line in enumerate(lines):
            heading = heading_indices.get(index)
            if heading is None:
                pending.append(line)
                continue

            flush(current)
            if current.blocks or current.heading != FRONT_MATTER:
                sections.append(current)

            depth = _section_depth(heading)
            del stack[depth - 1:]
            stack.append(heading)
            current = _Section(
                heading=heading,
                path=" > ".join(stack),
                index=len(sections) + 1,
            )
        flush(current)

    if current.blocks or current.heading != FRONT_MATTER:
        sections.append(current)
    return [s for s in sections if s.blocks]


def _split_long_paragraph(text: str, limit: int) -> list[str]:
    """Split an over-long paragraph on sentence boundaries, never mid-sentence.

    A single sentence longer than the limit (a table row, an equation dump) is
    cut on whitespace as a last resort rather than dropped.
    """
    sentences = SENTENCE_SPLIT.split(text)
    pieces: list[str] = []
    buffer = ""
    for sentence in sentences:
        candidate = f"{buffer} {sentence}".strip() if buffer else sentence
        if len(candidate) <= limit:
            buffer = candidate
            continue
        if buffer:
            pieces.append(buffer)
            buffer = ""
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        buffer = sentence
    if buffer:
        pieces.append(buffer)
    return [p for p in pieces if p]


def _tail_overlap(text: str, size: int) -> str:
    """The last `size` characters of `text`, snapped to a word boundary."""
    if size <= 0 or len(text) <= size:
        return text if size > 0 else ""
    tail = text[-size:]
    space = tail.find(" ")
    return tail[space + 1:] if space != -1 else tail


def chunk_document(
    document: Document,
    paper_id: str,
    *,
    target_chars: int = TARGET_CHARS,
    max_chars: int = MAX_CHARS,
    overlap_chars: int = OVERLAP_CHARS,
    min_chars: int = MIN_CHARS,
) -> list[Chunk]:
    """Chunk a document section by section.

    Guarantees: a chunk never spans two sections; a chunk never exceeds
    `max_chars`; overlap is carried only within a section, because overlapping
    across a heading would attribute one section's text to another's citation.
    """
    if target_chars <= 0 or max_chars < target_chars or overlap_chars < 0:
        raise ValueError("require 0 < target_chars <= max_chars and overlap_chars >= 0")

    chunks: list[Chunk] = []
    for section in _build_sections(document):
        units: list[_Block] = []
        # A unit must leave room for the overlap that will be prepended to it,
        # or the emitted chunk can exceed max_chars (measured: a 1897-char
        # paragraph plus a 200-char carry produced a 2097-char chunk).
        unit_limit = max(max_chars - overlap_chars, target_chars)
        for block in section.blocks:
            if len(block.text) <= unit_limit:
                units.append(block)
                continue
            for piece in _split_long_paragraph(block.text, target_chars):
                units.append(_Block(text=piece, page=block.page))

        buffer: list[_Block] = []
        carry = ""

        def emit() -> None:
            nonlocal buffer, carry
            if not buffer:
                return
            body = " ".join(b.text for b in buffer)
            # Keep only as much overlap as fits under the hard cap.
            room = max_chars - len(body) - 1
            prefix = _tail_overlap(carry, room) if carry and room > 0 else ""
            content = f"{prefix} {body}".strip() if prefix else body
            chunks.append(
                Chunk(
                    paper_id=paper_id,
                    chunk_index=len(chunks),
                    content=content,
                    page=buffer[0].page,
                    page_end=buffer[-1].page,
                    section=section.heading,
                    section_path=section.path,
                    section_index=section.index,
                )
            )
            carry = _tail_overlap(body, overlap_chars)
            buffer = []

        for unit in units:
            projected = sum(len(b.text) + 1 for b in buffer) + len(unit.text) + len(carry)
            if buffer and projected > target_chars:
                emit()
            buffer.append(unit)
            if sum(len(b.text) + 1 for b in buffer) + len(carry) >= target_chars:
                emit()
        emit()

    chunks = _absorb_stubs(chunks, min_chars=min_chars, max_chars=max_chars)
    for position, chunk in enumerate(chunks):
        chunk.chunk_index = position
    return chunks


def _absorb_stubs(chunks: list[Chunk], *, min_chars: int, max_chars: int) -> list[Chunk]:
    """Fold undersized chunks into a neighbour in the same section.

    A stub ("Fig. 3", a stray equation number) retrieves nothing useful on its
    own and dilutes the index. Stubs appear anywhere in a section, not only at
    the end, so this is a pass over all chunks rather than a check on the last
    one. A stub whose section has no room left is kept: dropping text would make
    a citation point at something the reader cannot find.
    """
    result: list[Chunk] = []
    for chunk in chunks:
        if (
            chunk.char_count >= min_chars
            or not result
            or result[-1].section_index != chunk.section_index
            or result[-1].char_count + chunk.char_count + 1 > max_chars
        ):
            result.append(chunk)
            continue
        previous = result[-1]
        result[-1] = Chunk(
            paper_id=previous.paper_id,
            chunk_index=previous.chunk_index,
            content=f"{previous.content} {chunk.content}".strip(),
            page=previous.page,
            page_end=max(previous.page_end, chunk.page_end),
            section=previous.section,
            section_path=previous.section_path,
            section_index=previous.section_index,
        )
    return result


def chunk_stats(chunks: list[Chunk]) -> dict:
    """Summary used by the ingestion response and by ADR-006's measurements."""
    if not chunks:
        return {"count": 0}
    sizes = sorted(c.char_count for c in chunks)
    return {
        "count": len(chunks),
        "sections": len({c.section_index for c in chunks}),
        "chars_min": sizes[0],
        "chars_median": sizes[len(sizes) // 2],
        "chars_mean": round(statistics.mean(sizes), 1),
        "chars_max": sizes[-1],
        "pages_covered": len({c.page for c in chunks}),
    }
