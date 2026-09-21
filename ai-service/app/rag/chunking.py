from __future__ import annotations

import re

CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")

MIN_CHUNK_CHARS = 2000
MAX_CHUNK_CHARS = 3200


def detect_lang(text: str) -> str:
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return "en"
    cyr = sum(1 for ch in letters if CYRILLIC_RE.match(ch))
    return "ru" if cyr / len(letters) > 0.3 else "en"


def split_paragraphs(text: str) -> list[str]:
    blocks = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if blocks:
        return blocks
    return [line.strip() for line in text.splitlines() if line.strip()]


def chunk_text(
    text: str,
    *,
    target: int = 2400,
    overlap: int = 400,
    min_size: int = MIN_CHUNK_CHARS,
    max_size: int = MAX_CHUNK_CHARS,
) -> list[str]:
    """Pack paragraphs into ~target-char chunks, overlapping by `overlap` chars."""
    del min_size  # packing uses target + max_size; min is documented for callers
    paragraphs = split_paragraphs(text)
    if not paragraphs:
        return []

    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0

    def flush() -> None:
        nonlocal buf, buf_len
        if not buf:
            return
        body = "\n\n".join(buf)
        chunks.append(body)
        if overlap > 0 and len(body) > overlap:
            buf = [body[-overlap:]]
            buf_len = len(buf[0])
        else:
            buf = []
            buf_len = 0

    for para in paragraphs:
        extra = len(para) + (2 if buf else 0)
        if buf and buf_len + extra > max_size:
            flush()
            extra = len(para)
        if len(para) > max_size:
            if buf:
                flush()
            pieces = _hard_wrap(para, max_size, overlap)
            chunks.extend(pieces)
            if pieces and overlap > 0:
                tail = pieces[-1][-overlap:]
                buf = [tail]
                buf_len = len(tail)
            else:
                buf = []
                buf_len = 0
            continue
        buf.append(para)
        buf_len += extra
        if buf_len >= target:
            flush()

    if buf:
        remainder = "\n\n".join(buf)
        if not chunks or len(remainder) > overlap:
            chunks.append(remainder)
    return chunks


def _hard_wrap(text: str, max_size: int, overlap: int) -> list[str]:
    pieces: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + max_size, n)
        if end < n:
            cut = text.rfind(" ", start, end)
            if cut > start + max_size // 2:
                end = cut
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return pieces
