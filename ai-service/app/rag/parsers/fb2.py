from __future__ import annotations

from pathlib import Path

from lxml import etree

FB_NS = "http://www.gribuser.ru/xml/fictionbook/2.0"
SKIP_TAGS = {"binary", "coverpage", "image", "stylesheet", "annotation"}


def parse_fb2(path: Path) -> str:
    tree = etree.parse(str(path))
    root = tree.getroot()
    parts: list[str] = []

    title_info = root.find(f"{{{FB_NS}}}description/{{{FB_NS}}}title-info")
    if title_info is None:
        title_info = root.find(f".//{{{FB_NS}}}title-info")
    if title_info is not None:
        heading = _title_heading(title_info)
        if heading:
            parts.append(heading)

    for body in root.findall(f"{{{FB_NS}}}body"):
        parts.extend(_walk_text(body))
    return "\n\n".join(p for p in parts if p)


def _title_heading(title_info: etree._Element) -> str:
    bits: list[str] = []
    book_title = title_info.find(f"{{{FB_NS}}}book-title")
    if book_title is not None:
        title = "".join(book_title.itertext()).strip()
        if title:
            bits.append(title)
    authors: list[str] = []
    for author in title_info.findall(f"{{{FB_NS}}}author"):
        name = " ".join(
            part
            for part in (
                _child_text(author, "first-name"),
                _child_text(author, "middle-name"),
                _child_text(author, "last-name"),
            )
            if part
        ).strip()
        if name:
            authors.append(name)
    if authors:
        bits.append(", ".join(authors))
    return "\n".join(bits)


def _child_text(el: etree._Element, tag: str) -> str:
    child = el.find(f"{{{FB_NS}}}{tag}")
    if child is None:
        return ""
    return "".join(child.itertext()).strip()


def _walk_text(el: etree._Element) -> list[str]:
    local = etree.QName(el).localname.lower()
    if local in SKIP_TAGS:
        return []
    if local in {"title", "subtitle", "p", "v", "text-author", "poem"}:
        inner = " ".join(part.strip() for part in el.itertext() if part.strip())
        return [inner] if inner else []
    parts: list[str] = []
    for child in el:
        parts.extend(_walk_text(child))
    return parts
