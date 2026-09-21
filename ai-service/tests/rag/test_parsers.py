from __future__ import annotations

from pathlib import Path

from app.rag.parsers import parse_file
from tests.rag.make_fixtures import SAMPLE_RU, write_docx, write_epub, write_fb2, write_pdf, write_txt

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_parse_txt(tmp_path: Path) -> None:
    path = write_txt(tmp_path / "sample.txt")
    parsed = parse_file(path)
    assert "Экономика" in parsed.text
    assert parsed.source_name == "sample.txt"


def test_parse_pdf(tmp_path: Path) -> None:
    path = write_pdf(tmp_path / "sample.pdf")
    parsed = parse_file(path)
    assert "менеджера" in parsed.text


def test_parse_docx(tmp_path: Path) -> None:
    path = write_docx(tmp_path / "sample.docx")
    parsed = parse_file(path)
    assert "Глава 1" in parsed.text
    assert "спрос" in parsed.text


def test_parse_fb2(tmp_path: Path) -> None:
    path = write_fb2(tmp_path / "sample.fb2")
    parsed = parse_file(path)
    assert parsed.text
    assert "Тестовая книга" in parsed.text
    assert "AAAA" not in parsed.text
    assert SAMPLE_RU.split()[0] in parsed.text


def test_parse_committed_txt_and_fb2() -> None:
    txt = parse_file(FIXTURES / "sample.txt")
    assert "Экономика" in txt.text
    fb2 = parse_file(FIXTURES / "sample.fb2")
    assert "Тестовая книга" in fb2.text
    assert "AAAA" not in fb2.text


def test_parse_epub(tmp_path: Path) -> None:
    path = write_epub(tmp_path / "sample.epub")
    parsed = parse_file(path)
    assert parsed.text
    assert "Глава 1" in parsed.text
    assert "издержки" in parsed.text


def test_empty_pdf_raises(tmp_path: Path) -> None:
    import pymupdf
    import pytest

    from app.rag.errors import RagError

    path = tmp_path / "empty.pdf"
    doc = pymupdf.open()
    doc.new_page()
    doc.save(path)
    doc.close()
    with pytest.raises(RagError, match="empty"):
        parse_file(path)
