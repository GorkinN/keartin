from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path

from app.messages import public_message
from app.ocr.pdf_ocr import page_count, sidecar_path
from app.rag.chunking import chunk_text, detect_lang
from app.rag.embedder import Embedder
from app.rag.errors import EmptyTextError, RagError
from app.rag.jobs import IndexJob, JobStore
from app.rag.parsers import ParsedDocument, normalize_text, parse_file
from app.rag.qdrant_store import QdrantStore
from app.settings import Settings

logger = logging.getLogger(__name__)

OcrRunner = Callable[[Path, Callable[[int, int], None]], Awaitable[str]]


class Indexer:
    def __init__(
        self,
        settings: Settings,
        embedder: Embedder,
        store: QdrantStore,
        jobs: JobStore,
        ocr: OcrRunner | None = None,
    ) -> None:
        self._settings = settings
        self._embedder = embedder
        self._store = store
        self._jobs = jobs
        self._ocr = ocr
        self._lock = asyncio.Lock()

    async def run(self, job: IndexJob, path: Path) -> None:
        async with self._lock:
            job.status = "indexing"
            try:
                await self._index_locked(job, path)
                job.status = "ready"
            except Exception as exc:
                logger.exception("index job %s failed", job.job_id)
                job.status = "error"
                if isinstance(exc, RagError):
                    job.error = public_message(exc)
                else:
                    job.error = public_message(RuntimeError(f"Indexing failed: {exc}"))

    async def _index_locked(self, job: IndexJob, path: Path) -> None:
        job.phase = "parse"
        parsed = await self._parse(job, path)
        job.source_name = job.source_name or parsed.source_name
        job.phase = "embed"
        chunks = chunk_text(
            parsed.text,
            target=self._settings.rag_chunk_chars,
            overlap=self._settings.rag_chunk_overlap,
        )
        if not chunks:
            raise RagError("No chunks produced from document", status_code=400)
        job.chunks_total = len(chunks)
        job.chunks_done = 0
        await self._store.delete_by_book(job.book_id)

        batch_size = max(1, self._settings.rag_embed_batch)
        for start in range(0, len(chunks), batch_size):
            batch = chunks[start : start + batch_size]
            vectors = await asyncio.to_thread(self._embedder.encode, batch)
            items: list[tuple[int, str, str, list[float]]] = []
            for offset, (text, vector) in enumerate(zip(batch, vectors, strict=True)):
                chunk_index = start + offset
                items.append((chunk_index, text, detect_lang(text), vector))
            await self._store.upsert_chunks(
                book_id=job.book_id,
                source_name=job.source_name,
                items=items,
            )
            job.chunks_done = start + len(batch)
        logger.info("indexed book_id=%s chunks=%s", job.book_id, job.chunks_total)

    async def _parse(self, job: IndexJob, path: Path) -> ParsedDocument:
        try:
            return await asyncio.to_thread(parse_file, path)
        except EmptyTextError:
            if path.suffix.lower() != ".pdf":
                raise
        sidecar = sidecar_path(path)
        if sidecar.is_file():
            text = normalize_text(await asyncio.to_thread(sidecar.read_text, encoding="utf-8"))
            if text:
                logger.info("scan pdf book_id=%s: reuse %s", job.book_id, sidecar.name)
                return ParsedDocument(text=text, source_name=path.name)
        if self._ocr is None:
            raise EmptyTextError(f"Parsed text is empty: {path.name}", status_code=400)

        job.phase = "ocr"
        job.pages_total = await asyncio.to_thread(page_count, path)
        job.pages_done = 0

        def on_page(done: int, total: int) -> None:
            job.pages_done = done
            job.pages_total = total

        logger.info("scan pdf book_id=%s: ocr %s pages", job.book_id, job.pages_total)
        text = normalize_text(await self._ocr(path, on_page))
        if not text:
            raise RagError(f"OCR produced no text: {path.name}", status_code=400)
        return ParsedDocument(text=text, source_name=path.name)
