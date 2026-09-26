from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.messages import public_message
from app.rag.errors import RagError
from app.rag.indexer import Indexer
from app.rag.jobs import JobStore
from app.rag.outline import OutlineWriter
from app.rag.qdrant_store import QdrantStore
from app.rag.retriever import Retriever

router = APIRouter(prefix="/rag")


class IndexRequest(BaseModel):
    path: str = Field(min_length=1)
    book_id: str | None = None
    source_name: str | None = None


class IndexAccepted(BaseModel):
    job_id: str
    book_id: str
    status: str


class IndexStatus(BaseModel):
    job_id: str
    book_id: str
    status: str
    source_name: str
    chunks_total: int
    chunks_done: int
    phase: str
    pages_total: int
    pages_done: int
    error: str | None = None
    outline: list[str] = Field(default_factory=list)
    outline_error: str | None = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    book_ids: list[str] = Field(default_factory=list)
    top_k: int | None = Field(default=None, ge=1, le=50)


class SearchHitOut(BaseModel):
    book_id: str
    chunk_index: int
    source_name: str
    lang: str
    text: str
    score: float


class SearchResponse(BaseModel):
    hits: list[SearchHitOut]


class DeleteResponse(BaseModel):
    ok: bool
    book_id: str


class OutlineResponse(BaseModel):
    items: list[str]
    error: str | None = None


def _jobs(request: Request) -> JobStore:
    return request.app.state.rag_jobs


def _indexer(request: Request) -> Indexer:
    return request.app.state.indexer


def _retriever(request: Request) -> Retriever:
    return request.app.state.retriever


def _store(request: Request) -> QdrantStore:
    return request.app.state.qdrant


def _outline(request: Request) -> OutlineWriter:
    return request.app.state.outline


@router.post("/index", status_code=202, response_model=IndexAccepted)
async def start_index(body: IndexRequest, request: Request) -> IndexAccepted:
    path = Path(body.path)
    if not path.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {body.path}")
    book_id = (body.book_id or "").strip() or str(uuid.uuid4())
    source_name = (body.source_name or "").strip() or path.name
    job = _jobs(request).create(book_id=book_id, source_name=source_name)
    task = asyncio.create_task(_indexer(request).run(job, path))
    tasks: set[asyncio.Task[None]] = request.app.state.rag_tasks
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return IndexAccepted(job_id=job.job_id, book_id=book_id, status=job.status)


@router.get("/index/{job_id}", response_model=IndexStatus)
async def index_status(job_id: str, request: Request) -> IndexStatus:
    job = _jobs(request).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job_id")
    return IndexStatus.model_validate(job.as_dict())


@router.post("/search", response_model=SearchResponse)
async def search(body: SearchRequest, request: Request) -> SearchResponse:
    try:
        hits = await _retriever(request).search(
            query=body.query.strip(),
            book_ids=body.book_ids,
            top_k=body.top_k,
        )
    except RagError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return SearchResponse(hits=[SearchHitOut.model_validate(hit.__dict__) for hit in hits])


@router.delete("/books/{book_id}", response_model=DeleteResponse)
async def delete_book(book_id: str, request: Request) -> DeleteResponse:
    try:
        await _store(request).delete_by_book(book_id)
    except RagError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return DeleteResponse(ok=True, book_id=book_id)


@router.post("/books/{book_id}/outline", response_model=OutlineResponse)
async def build_outline(book_id: str, request: Request) -> OutlineResponse:
    try:
        stored = await _store(request).list_chunks(book_id)
    except RagError as exc:
        return OutlineResponse(items=[], error=public_message(exc))
    chunks = [text for _, text in stored if text.strip()]
    if not chunks:
        raise HTTPException(status_code=400, detail="В книге нет фрагментов для оглавления.")
    try:
        items = await _outline(request)(chunks)
    except Exception as exc:
        return OutlineResponse(items=[], error=public_message(exc))
    if not items:
        return OutlineResponse(items=[], error="Не удалось собрать оглавление.")
    return OutlineResponse(items=items, error=None)
