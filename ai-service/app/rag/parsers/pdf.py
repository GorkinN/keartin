from __future__ import annotations

from pathlib import Path


def parse_pdf(path: Path) -> str:
    import pymupdf

    doc = pymupdf.open(path)
    try:
        pages = [page.get_text("text") or "" for page in doc]
    finally:
        doc.close()
    return "\n\n".join(pages)
