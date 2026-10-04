from __future__ import annotations

import asyncio
import json

import pytest

from app.topics.rank import RANK_FAILED, TopicRanker, TopicsError, parse_topics


def _topic(index: int, *, title: str | None = None, reason: str | None = None) -> dict[str, str]:
    return {
        "title": title if title is not None else f"Тема {index}",
        "reason": reason if reason is not None else f"Из этого выйдет пост {index}.",
    }


def _payload(count: int) -> str:
    return json.dumps([_topic(index) for index in range(1, count + 1)], ensure_ascii=False)


class FakeGpu:
    def __init__(self) -> None:
        self.tenants: list[str] = []
        self.released = 0

    async def acquire(self, tenant: str) -> None:
        self.tenants.append(tenant)

    async def release(self) -> None:
        self.released += 1


class FakeChat:
    def __init__(self, text: str, *, fail: bool = False) -> None:
        self.text = text
        self.fail = fail
        self.temperature: float | None = None
        self.messages: list[dict[str, str]] = []

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float | None = None,
    ) -> str:
        self.messages = messages
        self.temperature = temperature
        if self.fail:
            raise RuntimeError("ollama is unreachable")
        return self.text


def test_parse_topics_keeps_eight_to_twelve() -> None:
    topics = parse_topics(_payload(10))
    assert len(topics) == 10
    assert topics[0]["title"] == "Тема 1"

    clipped = parse_topics(_payload(15))
    assert len(clipped) == 12
    assert clipped[-1]["title"] == "Тема 12"


def test_parse_topics_reads_fenced_json_and_clips_fields() -> None:
    long_title = "а" * 250
    long_reason = "б" * 400
    raw = "```json\n" + json.dumps([_topic(index, title=long_title, reason=long_reason) for index in range(8)]) + "\n```"
    topics = parse_topics(raw)
    assert len(topics) == 8
    assert len(topics[0]["title"]) == 200
    assert len(topics[0]["reason"]) == 300


def test_parse_topics_rejects_garbage_and_short_lists() -> None:
    with pytest.raises(TopicsError, match=RANK_FAILED):
        parse_topics("не json")
    with pytest.raises(TopicsError, match=RANK_FAILED):
        parse_topics(_payload(7))


def test_rank_acquires_llm_and_releases() -> None:
    gpu = FakeGpu()
    chat = FakeChat(_payload(8))
    ranker = TopicRanker(gpu, chat)

    async def scenario() -> None:
        topics = await ranker(area="привычки", headlines=["Сон и режим"], outline_items=["Дороги Рима"])
        assert len(topics) == 8

    asyncio.run(scenario())
    assert gpu.tenants == ["llm"]
    assert gpu.released == 1
    assert chat.temperature == 0.3
    user = chat.messages[1]["content"]
    assert "привычки" in user
    assert "Сон и режим" in user
    assert "Дороги Рима" in user
    assert "system" == chat.messages[0]["role"]


def test_rank_releases_when_the_model_fails() -> None:
    gpu = FakeGpu()
    chat = FakeChat("мусор")
    ranker = TopicRanker(gpu, chat)

    async def scenario() -> None:
        with pytest.raises(TopicsError):
            await ranker(area="", headlines=["один"], outline_items=[])

    asyncio.run(scenario())
    assert gpu.tenants == ["llm"]
    assert gpu.released == 1


def test_rank_releases_when_chat_raises() -> None:
    gpu = FakeGpu()
    chat = FakeChat("", fail=True)
    ranker = TopicRanker(gpu, chat)

    async def scenario() -> None:
        with pytest.raises(RuntimeError):
            await ranker(area="рим", headlines=["форум"], outline_items=[])

    asyncio.run(scenario())
    assert gpu.released == 1


def test_rank_does_not_acquire_without_sources() -> None:
    gpu = FakeGpu()
    chat = FakeChat(_payload(8))
    ranker = TopicRanker(gpu, chat)

    async def scenario() -> None:
        with pytest.raises(TopicsError):
            await ranker(area="привычки", headlines=[], outline_items=[])

    asyncio.run(scenario())
    assert gpu.tenants == []
    assert gpu.released == 0
    assert chat.messages == []
