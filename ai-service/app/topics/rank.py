from __future__ import annotations

import json
import re
from typing import Protocol

from app.prompts import load_topics_system_prompt

MIN_TOPICS = 8
MAX_TOPICS = 12
MAX_TITLE_CHARS = 200
MAX_REASON_CHARS = 300
MAX_HEADLINES = 24
MAX_OUTLINE_ITEMS = 80
RANK_FAILED = "Модель не собрала список тем."


class TopicsError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class LlmLock(Protocol):
    async def acquire(self, tenant: str) -> None: ...

    async def release(self) -> None: ...


class ChatClient(Protocol):
    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float | None = None,
    ) -> str: ...


def render_topic_input(*, area: str, headlines: list[str], outline_items: list[str]) -> str:
    parts: list[str] = []
    cleaned_area = " ".join(area.split())
    if cleaned_area:
        parts.append(f"Область: {cleaned_area}")
    heads = _lines(headlines, MAX_HEADLINES)
    if heads:
        parts.append("Заголовки:\n" + "\n".join(f"- {line}" for line in heads))
    points = _lines(outline_items, MAX_OUTLINE_ITEMS)
    if points:
        parts.append("Пункты оглавления:\n" + "\n".join(f"- {line}" for line in points))
    return "\n\n".join(parts)


def parse_topics(raw: str) -> list[dict[str, str]]:
    data = _json_array(_strip_fence(raw.strip()))
    if data is None:
        raise TopicsError(RANK_FAILED)
    topics: list[dict[str, str]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        title = _clip(item.get("title"), MAX_TITLE_CHARS)
        reason = _clip(item.get("reason"), MAX_REASON_CHARS)
        if not title or not reason:
            continue
        topics.append({"title": title, "reason": reason})
        if len(topics) == MAX_TOPICS:
            break
    if len(topics) < MIN_TOPICS:
        raise TopicsError(RANK_FAILED)
    return topics


class TopicRanker:
    """One LLM call under the llm GPU tenant. Callers must not hold GpuManager."""

    def __init__(self, gpu: LlmLock, client: ChatClient) -> None:
        self._gpu = gpu
        self._client = client

    async def __call__(
        self,
        *,
        area: str,
        headlines: list[str],
        outline_items: list[str],
    ) -> list[dict[str, str]]:
        brief = render_topic_input(area=area, headlines=headlines, outline_items=outline_items)
        if not _lines(headlines, MAX_HEADLINES) and not _lines(outline_items, MAX_OUTLINE_ITEMS):
            raise TopicsError(RANK_FAILED)
        await self._gpu.acquire("llm")
        try:
            raw = await self._client.chat(
                messages=[
                    {"role": "system", "content": load_topics_system_prompt()},
                    {"role": "user", "content": brief},
                ],
                temperature=0.3,
            )
        finally:
            await self._gpu.release()
        return parse_topics(raw)


def _lines(values: list[str], limit: int) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        text = " ".join(value.split()).strip()[:MAX_TITLE_CHARS]
        if not text or text in seen:
            continue
        seen.add(text)
        lines.append(text)
        if len(lines) == limit:
            break
    return lines


def _clip(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()[:limit]


def _strip_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _json_array(text: str) -> list[object] | None:
    parsed = _loads(text)
    if isinstance(parsed, list):
        return parsed
    match = re.search(r"\[[\s\S]*\]", text)
    if match is None:
        return None
    parsed = _loads(match.group(0))
    if isinstance(parsed, list):
        return parsed
    return None


def _loads(text: str) -> object | None:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
