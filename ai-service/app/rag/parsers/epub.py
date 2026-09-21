from __future__ import annotations

from pathlib import Path

from lxml import html as lxml_html


def parse_epub(path: Path) -> str:
    from ebooklib import ITEM_DOCUMENT, epub

    book = epub.read_epub(str(path))
    parts: list[str] = []
    title = book.get_metadata("DC", "title")
    if title and title[0] and title[0][0]:
        parts.append(str(title[0][0]).strip())

    for item in book.get_items_of_type(ITEM_DOCUMENT):
        name = (item.get_name() or "").replace("\\", "/").lower()
        if _skip_nav(name):
            continue
        content = item.get_content()
        if not content:
            continue
        text = _html_to_text(content)
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def _skip_nav(name: str) -> bool:
    base = name.rsplit("/", 1)[-1]
    return base in {"nav.xhtml", "nav.html", "toc.xhtml", "toc.html"} or "/nav" in name


def _html_to_text(content: bytes | str) -> str:
    if isinstance(content, bytes):
        raw = content
    else:
        raw = content.encode("utf-8", errors="ignore")
    try:
        doc = lxml_html.fromstring(raw)
    except Exception:
        return ""
    for el in doc.xpath("//script|//style|//img|//nav|//svg"):
        el.drop_tree()
    text = doc.text_content() or ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)
