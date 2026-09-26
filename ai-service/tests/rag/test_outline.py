from __future__ import annotations

import asyncio

import pytest

from app.gpu.errors import GpuError
from app.rag.errors import RagError
from app.rag.outline import OutlineWriter, parse_outline, sample_excerpts


def test_sample_keeps_short_book_in_order() -> None:
    text = sample_excerpts(["первый фрагмент", "второй фрагмент"], budget=12_000)
    assert "Фрагмент 1 из 2\nпервый фрагмент" in text
    assert "Фрагмент 2 из 2\nвторой фрагмент" in text
    assert text.index("первый") < text.index("второй")


def test_sample_keeps_ends_inside_budget() -> None:
    chunks = [f"chunk-{index} " + ("слово " * 80) for index in range(40)]
    text = sample_excerpts(chunks, excerpt_chars=280, budget=2_000)
    assert len(text) <= 2_000
    assert "chunk-0" in text
    assert "chunk-39" in text
    assert text.index("chunk-0") < text.index("chunk-39")
    assert "Фрагмент 1 из 40" in text
    assert "Фрагмент 40 из 40" in text


def test_parse_outline_strips_fence_and_caps_items() -> None:
    raw = "```json\n" + '["  Спрос  ", "", 1, "' + ("а" * 250) + '"]\n```'
    items = parse_outline(raw)
    assert items[0] == "Спрос"
    assert len(items) == 2
    assert len(items[1]) == 200


def test_parse_outline_accepts_titles_wrapped_in_braces() -> None:
    items = parse_outline('[{"Спрос и предложение"}, {"Издержки"}]')
    assert items == ["Спрос и предложение", "Издержки"]


def test_parse_outline_accepts_fragment_labels() -> None:
    raw = "\n".join(
        [
            "[1/116] Введение: красота и здоровье волос.",
            "[4/116] Три стадии роста волоса.",
            "[116/116]: Каталог издательства.",
        ]
    )
    assert parse_outline(raw) == [
        "Введение: красота и здоровье волос",
        "Три стадии роста волоса",
        "Каталог издательства",
    ]


def test_parse_outline_accepts_bracketed_lines() -> None:
    raw = "\n".join(
        [
            "[Строение и типы волос]",
            "[Уход за сухими и нормальными волосами]",
            "[Завершающие советы по уходу]",
        ]
    )
    assert parse_outline(raw) == [
        "Строение и типы волос",
        "Уход за сухими и нормальными волосами",
        "Завершающие советы по уходу",
    ]


def test_parse_outline_accepts_fragment_headers() -> None:
    raw = "Фрагмент 1 из 10: Введение\nФрагмент 10 из 10: Заключение"
    assert parse_outline(raw) == ["Введение", "Заключение"]


def test_parse_outline_rejects_prose() -> None:
    with pytest.raises(ValueError):
        parse_outline("Оглавление готово, но это не JSON.")


class _Gpu:
    def __init__(self) -> None:
        self.events: list[str] = []

    async def acquire(self, tenant: str) -> None:
        self.events.append(tenant)

    async def release(self) -> None:
        self.events.append("release")


class _Client:
    def __init__(self, text: str) -> None:
        self.text = text
        self.temperature: float | None = None

    async def chat(self, *, messages: list[dict[str, str]], temperature: float | None = None, **_: object) -> str:
        assert messages[0]["role"] == "system"
        assert messages[1]["content"].startswith("Фрагмент 1 из")
        self.temperature = temperature
        return self.text


def test_writer_returns_titles_under_llm_tenant() -> None:
    gpu = _Gpu()
    client = _Client('["Спрос и предложение", "Издержки"]')
    writer = OutlineWriter(gpu, client)  # type: ignore[arg-type]

    items = asyncio.run(writer(["Текст про спрос.", "Текст про издержки."]))

    assert items == ["Спрос и предложение", "Издержки"]
    assert gpu.events == ["llm", "release"]
    assert client.temperature == 0.2


def test_writer_maps_bad_json_and_still_releases_gpu() -> None:
    gpu = _Gpu()
    writer = OutlineWriter(gpu, _Client("не массив"))  # type: ignore[arg-type]

    with pytest.raises(RagError, match="Outline failed"):
        asyncio.run(writer(["Текст."]))

    assert gpu.events == ["llm", "release"]


def test_writer_releases_gpu_when_chat_fails() -> None:
    class Boom:
        async def chat(self, **_: object) -> str:
            raise GpuError("vram still busy", status_code=503)

    gpu = _Gpu()
    writer = OutlineWriter(gpu, Boom())  # type: ignore[arg-type]
    with pytest.raises(GpuError):
        asyncio.run(writer(["Текст."]))
    assert gpu.events == ["llm", "release"]
