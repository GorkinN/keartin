from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.rag.qdrant_store import scroll_all


def test_scroll_keeps_going_after_an_empty_page() -> None:
    pages = {
        None: ([], "next"),
        "next": ([SimpleNamespace(payload={"chunk_index": 2, "text": "вторая"})], None),
    }

    async def fetch(cursor: object) -> tuple[list[object], object]:
        return pages[cursor]

    records = asyncio.run(scroll_all(fetch))

    assert [point.payload["text"] for point in records] == ["вторая"]


def test_scroll_stops_when_the_cursor_does_not_advance() -> None:
    calls = 0

    async def fetch(cursor: object) -> tuple[list[object], object]:
        nonlocal calls
        calls += 1
        return [], "stuck"

    records = asyncio.run(scroll_all(fetch))

    assert records == []
    assert calls == 2
