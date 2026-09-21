from __future__ import annotations

from app.rag.chunking import chunk_text, detect_lang, split_paragraphs


def test_detect_lang_ru() -> None:
    assert detect_lang("Менеджер читает спрос и цену товара.") == "ru"


def test_detect_lang_en() -> None:
    assert detect_lang("A manager reads demand and price.") == "en"


def test_chunk_respects_paragraphs_and_overlap() -> None:
    paras = [f"Абзац номер {i:02d}. " + ("слово " * 80) for i in range(12)]
    text = "\n\n".join(paras)
    chunks = chunk_text(text, target=2400, overlap=400)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert 400 < len(chunk) <= 3200
    # overlap: tail of previous appears at start of next
    assert chunks[0][-200:] in chunks[1]


def test_split_paragraphs() -> None:
    assert split_paragraphs("один\n\nдва") == ["один", "два"]
