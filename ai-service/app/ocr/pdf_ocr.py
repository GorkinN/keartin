from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol


class PageRecognizer(Protocol):
    def recognize(self, image: Any) -> str: ...


def sidecar_path(pdf_path: Path) -> Path:
    return pdf_path.with_suffix(".txt")


def page_count(pdf_path: Path) -> int:
    import pymupdf

    doc = pymupdf.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def ocr_pdf(
    pdf_path: Path,
    engine: PageRecognizer,
    *,
    dpi: int,
    on_page: Callable[[int, int], None] | None = None,
) -> str:
    """Recognize every page, then write UTF-8 text next to the PDF (source.pdf -> source.txt)."""
    import pymupdf
    from PIL import Image

    pages: list[str] = []
    doc = pymupdf.open(pdf_path)
    try:
        total = doc.page_count
        for index, page in enumerate(doc):
            pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            pages.append(collapse_repeats(engine.recognize(image)))
            if on_page is not None:
                on_page(index + 1, total)
    finally:
        doc.close()
    text = "\n\n".join(pages).strip()
    write_sidecar(pdf_path, text)
    return text


def collapse_repeats(text: str, max_period: int = 3) -> str:
    """Drop a looped tail: a run of 1..max_period paragraphs repeated back to back is kept once."""
    blocks = [block.strip() for block in text.replace("\r\n", "\n").split("\n\n")]
    blocks = [block for block in blocks if block]
    out: list[str] = []
    for block in blocks:
        out.append(block)
        for period in range(1, max_period + 1):
            if len(out) >= 2 * period and out[-period:] == out[-2 * period : -period]:
                del out[-period:]
                break
    return "\n\n".join(out)


def write_sidecar(pdf_path: Path, text: str) -> Path:
    target = sidecar_path(pdf_path)
    tmp = target.with_name(target.name + ".part")
    tmp.write_text(text + "\n", encoding="utf-8")
    os.replace(tmp, target)
    return target
