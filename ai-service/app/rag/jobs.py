from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

JobStatus = Literal["queued", "indexing", "ready", "error"]
JobPhase = Literal["parse", "ocr", "embed"]


@dataclass
class IndexJob:
    job_id: str
    book_id: str
    status: JobStatus
    source_name: str
    chunks_total: int = 0
    chunks_done: int = 0
    phase: JobPhase = "parse"
    pages_total: int = 0
    pages_done: int = 0
    error: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "book_id": self.book_id,
            "status": self.status,
            "source_name": self.source_name,
            "chunks_total": self.chunks_total,
            "chunks_done": self.chunks_done,
            "phase": self.phase,
            "pages_total": self.pages_total,
            "pages_done": self.pages_done,
            "error": self.error,
        }


class JobStore:
    """In-memory index jobs. Lost on FastAPI restart."""

    def __init__(self) -> None:
        self._jobs: dict[str, IndexJob] = {}

    def create(self, *, book_id: str, source_name: str) -> IndexJob:
        job = IndexJob(
            job_id=str(uuid.uuid4()),
            book_id=book_id,
            status="queued",
            source_name=source_name,
        )
        self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> IndexJob | None:
        return self._jobs.get(job_id)
