from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.rag.errors import EmptyTextError, RagError
from app.rag.parsers.docx import parse_docx
from app.rag.parsers.epub import parse_epub
from app.rag.parsers.fb2 import parse_fb2
from app.rag.parsers.pdf import parse_pdf
from app.rag.parsers.txt import parse_txt

_PARSERS = {
    ".pdf": parse_pdf,
    ".epub": parse_epub,
    ".fb2": parse_fb2,
    ".docx": parse_docx,
    ".txt": parse_txt,
}


@dataclass(frozen=True)
class ParsedDocument:
    text: str
    source_name: str


def parse_file(path: str | Path) -> ParsedDocument:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    parser = _PARSERS.get(suffix)
    if parser is None:
        raise RagError(f"Unsupported format: {suffix or 'none'}", status_code=400)
    try:
        text = parser(file_path)
    except RagError:
        raise
    except Exception as exc:
        raise RagError(f"Failed to parse {file_path.name}: {exc}", status_code=400) from exc
    normalized = normalize_text(text)
    if not normalized:
        raise EmptyTextError(f"Parsed text is empty: {file_path.name}", status_code=400)
    return ParsedDocument(text=normalized, source_name=file_path.name)


def normalize_text(text: str) -> str:
    lines = [line.strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    collapsed: list[str] = []
    blank = False
    for line in lines:
        if not line:
            if collapsed and not blank:
                collapsed.append("")
            blank = True
            continue
        collapsed.append(line)
        blank = False
    return "\n".join(collapsed).strip()
