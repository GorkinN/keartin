from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.ocr.pdf_ocr import collapse_repeats, ocr_pdf, sidecar_path
from app.rag.errors import EmptyTextError
from app.rag.indexer import Indexer
from app.rag.jobs import JobStore
from app.settings import Settings
from tests.rag.make_fixtures import write_pdf


def _scan_pdf(path: Path, pages: int) -> Path:
    import pymupdf

    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page()
        page.draw_rect(pymupdf.Rect(50, 50, 200, 120), color=(0, 0, 0), fill=(0, 0, 0))
    doc.save(path)
    doc.close()
    return path


class FakeEngine:
    def __init__(self) -> None:
        self.calls = 0

    def recognize(self, image: Any) -> str:
        self.calls += 1
        assert image.size[0] > 0
        return f"  Страница {self.calls} про спрос и предложение.  "


class FakeEmbedder:
    def encode(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in texts]


class FakeStore:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def delete_by_book(self, book_id: str) -> None:
        self.texts.clear()

    async def upsert_chunks(self, *, book_id: str, source_name: str, items: list[tuple[int, str, str, list[float]]]) -> None:
        self.texts.extend(item[1] for item in items)


class FakeOcr:
    def __init__(self, text: str = "Распознанный текст скана про издержки.") -> None:
        self.calls = 0
        self.text = text

    async def __call__(self, path: Path, on_page: Callable[[int, int], None]) -> str:
        self.calls += 1
        on_page(1, 2)
        on_page(2, 2)
        sidecar_path(path).write_text(self.text, encoding="utf-8")
        return self.text


def _indexer(ocr: FakeOcr | None) -> tuple[Indexer, JobStore, FakeStore]:
    jobs = JobStore()
    store = FakeStore()
    indexer = Indexer(Settings(), FakeEmbedder(), store, jobs, ocr=ocr)  # type: ignore[arg-type]
    return indexer, jobs, store


def test_ocr_pdf_writes_sidecar_next_to_pdf(tmp_path: Path) -> None:
    pdf = _scan_pdf(tmp_path / "source.pdf", pages=2)
    engine = FakeEngine()
    progress: list[tuple[int, int]] = []

    text = ocr_pdf(pdf, engine, dpi=36, on_page=lambda done, total: progress.append((done, total)))

    assert engine.calls == 2
    assert progress == [(1, 2), (2, 2)]
    assert text == "Страница 1 про спрос и предложение.\n\nСтраница 2 про спрос и предложение."
    sidecar = tmp_path / "source.txt"
    assert sidecar.read_text(encoding="utf-8") == text + "\n"
    assert not (tmp_path / "source.txt.part").exists()


def test_scan_pdf_goes_through_ocr(tmp_path: Path) -> None:
    pdf = _scan_pdf(tmp_path / "source.pdf", pages=2)
    ocr = FakeOcr()
    indexer, jobs, store = _indexer(ocr)
    job = jobs.create(book_id="b1", source_name="scan.pdf")

    asyncio.run(indexer.run(job, pdf))

    assert job.status == "ready", job.error
    assert ocr.calls == 1
    assert (job.pages_done, job.pages_total) == (2, 2)
    assert job.phase == "embed"
    assert "издержки" in " ".join(store.texts)
    assert (tmp_path / "source.txt").is_file()


def test_existing_sidecar_skips_ocr(tmp_path: Path) -> None:
    pdf = _scan_pdf(tmp_path / "source.pdf", pages=1)
    (tmp_path / "source.txt").write_text("Уже распознано: маржинальность.", encoding="utf-8")
    ocr = FakeOcr()
    indexer, jobs, store = _indexer(ocr)
    job = jobs.create(book_id="b1", source_name="scan.pdf")

    asyncio.run(indexer.run(job, pdf))

    assert job.status == "ready", job.error
    assert ocr.calls == 0
    assert "маржинальность" in " ".join(store.texts)


def test_text_pdf_does_not_call_ocr(tmp_path: Path) -> None:
    pdf = write_pdf(tmp_path / "source.pdf")
    ocr = FakeOcr()
    indexer, jobs, _ = _indexer(ocr)
    job = jobs.create(book_id="b1", source_name="text.pdf")

    asyncio.run(indexer.run(job, pdf))

    assert job.status == "ready", job.error
    assert ocr.calls == 0
    assert job.pages_total == 0
    assert not (tmp_path / "source.txt").exists()


def test_empty_ocr_result_is_an_error(tmp_path: Path) -> None:
    pdf = _scan_pdf(tmp_path / "source.pdf", pages=1)
    indexer, jobs, _ = _indexer(FakeOcr(text="   "))
    job = jobs.create(book_id="b1", source_name="scan.pdf")

    asyncio.run(indexer.run(job, pdf))

    assert job.status == "error"
    assert job.error == "Распознавание скана не нашло текста."


def test_scan_without_ocr_runner_keeps_empty_error(tmp_path: Path) -> None:
    pdf = _scan_pdf(tmp_path / "source.pdf", pages=1)
    indexer, jobs, _ = _indexer(None)
    job = jobs.create(book_id="b1", source_name="scan.pdf")

    asyncio.run(indexer.run(job, pdf))

    assert job.status == "error"
    assert job.error == "В файле нет текста."


def test_collapse_repeats_drops_looped_tail() -> None:
    loop = "МИНИМАЛЬНАЯ ОТЛИЧАНИЕ\nВ ХОЛОДНОЙ ВОЗМОЖНОСТИ"
    text = "Цена: 0.90\n\n" + "\n\n".join([loop] * 120)
    assert collapse_repeats(text) == f"Цена: 0.90\n\n{loop}"


def test_collapse_repeats_handles_two_block_cycles_and_keeps_normal_text() -> None:
    assert collapse_repeats("a\n\nb\n\nc\n\nb\n\nc\n\nb\n\nc") == "a\n\nb\n\nc"
    assert collapse_repeats("Глава 1.\n\nТекст.\n\nГлава 2.\n\nТекст 2.") == "Глава 1.\n\nТекст.\n\nГлава 2.\n\nТекст 2."


def test_empty_text_error_is_rag_error() -> None:
    from app.rag.errors import RagError

    assert issubclass(EmptyTextError, RagError)
    with pytest.raises(RagError):
        raise EmptyTextError("Parsed text is empty: x.pdf")
