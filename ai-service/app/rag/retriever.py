from __future__ import annotations

import asyncio

from app.rag.embedder import Embedder
from app.rag.qdrant_store import QdrantStore, SearchHit
from app.settings import Settings


class Retriever:
    def __init__(self, settings: Settings, embedder: Embedder, store: QdrantStore) -> None:
        self._settings = settings
        self._embedder = embedder
        self._store = store

    async def search(
        self,
        *,
        query: str,
        book_ids: list[str],
        top_k: int | None = None,
    ) -> list[SearchHit]:
        limit = top_k if top_k is not None else self._settings.rag_top_k
        vectors = await asyncio.to_thread(self._embedder.encode, [query])
        return await self._store.search(vector=vectors[0], book_ids=book_ids, top_k=limit)
