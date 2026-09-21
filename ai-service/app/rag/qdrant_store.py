from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchAny,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.rag.errors import RagError
from app.settings import Settings

logger = logging.getLogger(__name__)

POINT_NS = uuid.UUID("8f3c1a2e-6b14-4d9a-9e50-7c2a4b8d1f03")


@dataclass(frozen=True)
class SearchHit:
    book_id: str
    chunk_index: int
    source_name: str
    lang: str
    text: str
    score: float


class QdrantStore:
    def __init__(self, settings: Settings) -> None:
        self._collection = settings.qdrant_collection
        self._client = AsyncQdrantClient(
            url=settings.qdrant_url.rstrip("/"),
            timeout=60,
            check_compatibility=False,
            prefer_grpc=False,
            trust_env=False,
        )
        self._ready = False

    async def ensure_collection(self, dim: int) -> None:
        if self._ready:
            return
        exists = await self._client.collection_exists(self._collection)
        if exists:
            info = await self._client.get_collection(self._collection)
            size = _vector_size(info)
            if size is not None and size != dim:
                raise RagError(
                    f"Qdrant collection {self._collection} has dim {size}, expected {dim}",
                    status_code=500,
                )
        else:
            logger.info("creating qdrant collection %s dim=%s", self._collection, dim)
            await self._client.create_collection(
                collection_name=self._collection,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )
        self._ready = True

    async def delete_by_book(self, book_id: str) -> None:
        await self.ensure_collection(1024)
        await self._client.delete(
            collection_name=self._collection,
            points_selector=Filter(
                must=[FieldCondition(key="book_id", match=MatchValue(value=book_id))]
            ),
        )

    async def upsert_chunks(
        self,
        *,
        book_id: str,
        source_name: str,
        items: list[tuple[int, str, str, list[float]]],
    ) -> None:
        if not items:
            return
        await self.ensure_collection(len(items[0][3]))
        points = [
            PointStruct(
                id=str(uuid.uuid5(POINT_NS, f"{book_id}:{chunk_index}")),
                vector=vector,
                payload={
                    "book_id": book_id,
                    "chunk_index": chunk_index,
                    "source_name": source_name,
                    "lang": lang,
                    "text": text,
                },
            )
            for chunk_index, text, lang, vector in items
        ]
        await self._client.upsert(collection_name=self._collection, points=points, wait=True)

    async def search(
        self,
        *,
        vector: list[float],
        book_ids: list[str],
        top_k: int,
    ) -> list[SearchHit]:
        await self.ensure_collection(len(vector))
        query_filter = None
        if book_ids:
            query_filter = Filter(must=[FieldCondition(key="book_id", match=MatchAny(any=book_ids))])
        result = await self._client.query_points(
            collection_name=self._collection,
            query=vector,
            query_filter=query_filter,
            limit=top_k,
            with_payload=True,
        )
        hits: list[SearchHit] = []
        for point in result.points:
            payload: dict[str, Any] = point.payload or {}
            hits.append(
                SearchHit(
                    book_id=str(payload.get("book_id", "")),
                    chunk_index=int(payload.get("chunk_index", 0)),
                    source_name=str(payload.get("source_name", "")),
                    lang=str(payload.get("lang", "en")),
                    text=str(payload.get("text", "")),
                    score=float(point.score or 0.0),
                )
            )
        return hits


def _vector_size(info: Any) -> int | None:
    config = getattr(info, "config", None)
    params = getattr(config, "params", None)
    vectors = getattr(params, "vectors", None)
    size = getattr(vectors, "size", None)
    if isinstance(size, int):
        return size
    if isinstance(vectors, dict):
        first = next(iter(vectors.values()), None)
        return getattr(first, "size", None)
    return None
