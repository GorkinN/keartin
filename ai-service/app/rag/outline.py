from __future__ import annotations

import json
import re

from app.gpu.manager import GpuManager
from app.llm.ollama_client import OllamaClient
from app.prompts import load_outline_system_prompt
from app.rag.errors import RagError

EXCERPT_CHARS = 1200
INPUT_CHARS = 12_000
MAX_ITEMS = 24
MAX_TITLE_CHARS = 200


def sample_excerpts(
    chunks: list[str],
    *,
    excerpt_chars: int = EXCERPT_CHARS,
    budget: int = INPUT_CHARS,
) -> str:
    """Evenly spaced chunk openings. Always keeps the first and last when any text exists."""
    indexed = [(index, _excerpt(chunk, excerpt_chars)) for index, chunk in enumerate(chunks)]
    indexed = [(index, text) for index, text in indexed if text]
    if not indexed:
        return ""
    total = len(chunks)
    available = [index for index, _ in indexed]
    by_index = dict(indexed)

    def render(picks: list[int]) -> str:
        blocks = [
            f"Фрагмент {index + 1} из {total}\n{by_index[index]}" for index in picks
        ]
        return "\n\n".join(blocks)

    full = render(available)
    if len(full) <= budget:
        return full

    best = _evenly(available, min(2, len(available)))
    if len(render(best)) > budget:
        return render(best)[:budget].rstrip()

    low = 2
    high = len(available)
    while low <= high:
        mid = (low + high) // 2
        picks = _evenly(available, mid)
        if len(render(picks)) <= budget:
            best = picks
            low = mid + 1
        else:
            high = mid - 1
    return render(best)


_LABELED = re.compile(r"^\[(\d+)\s*/\s*(\d+)\]\s*:?\s*(.+)$")
_BRACKET = re.compile(r"^\[([^\[\]]+)\]$")
_FRAGMENT = re.compile(r"^Фрагмент\s+\d+\s+из\s+\d+\s*:?\s*(.*)$", re.IGNORECASE)
_NUMBERED = re.compile(r"^\d+[\.)]\s+(.+)$")


def parse_outline(raw: str) -> list[str]:
    text = _strip_fence(raw.strip())
    labeled = _labeled_titles(text)
    if labeled:
        return _clip(labeled)
    headed = _fragment_titles(text)
    if headed:
        return _clip(headed)
    bracketed = _bracket_titles(text)
    if bracketed:
        return _clip(bracketed)
    data = _json_list(text)
    if data is not None:
        titles = [item for item in (_clean_title(value) for value in data) if item]
        if titles:
            return _clip(titles)
    numbered = _numbered_titles(text)
    if numbered:
        return _clip(numbered)
    raise ValueError("no json array")


class OutlineWriter:
    """One LLM call under the llm GPU tenant. Callers must not hold GpuManager."""

    def __init__(self, gpu: GpuManager, client: OllamaClient) -> None:
        self._gpu = gpu
        self._client = client

    async def __call__(self, chunks: list[str]) -> list[str]:
        digest = sample_excerpts(chunks)
        if not digest:
            raise RagError("No chunks produced from document", status_code=400)
        await self._gpu.acquire("llm")
        try:
            raw = await self._client.chat(
                messages=[
                    {"role": "system", "content": load_outline_system_prompt()},
                    {"role": "user", "content": digest},
                ],
                temperature=0.2,
            )
        finally:
            await self._gpu.release()
        try:
            return parse_outline(raw)
        except ValueError as exc:
            raise RagError(f"Outline failed: {exc}", status_code=502) from exc


def _strip_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _json_list(text: str) -> list[object] | None:
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end <= start:
        return None
    body = text[start : end + 1]
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        try:
            data = _quoted_strings(body)
        except ValueError:
            return None
    if not isinstance(data, list):
        return None
    return data


def _labeled_titles(text: str) -> list[str]:
    titles: list[str] = []
    for line in text.splitlines():
        match = _LABELED.match(line.strip())
        if match is None:
            continue
        title = _clean_title(match.group(3))
        if title:
            titles.append(title)
    return titles


def _bracket_titles(text: str) -> list[str]:
    titles: list[str] = []
    for line in text.splitlines():
        match = _BRACKET.match(line.strip())
        if match is None:
            continue
        title = _clean_title(match.group(1))
        if title and '"' not in title:
            titles.append(title)
    return titles


def _fragment_titles(text: str) -> list[str]:
    titles: list[str] = []
    for line in text.splitlines():
        match = _FRAGMENT.match(line.strip())
        if match is None:
            continue
        title = _clean_title(match.group(1))
        if title:
            titles.append(title)
    return titles


def _numbered_titles(text: str) -> list[str]:
    titles: list[str] = []
    for line in text.splitlines():
        match = _NUMBERED.match(line.strip())
        if match is None:
            continue
        title = _clean_title(match.group(1))
        if title:
            titles.append(title)
    return titles


def _clean_title(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip().strip(".")


def _clip(items: list[str]) -> list[str]:
    cleaned = [item[:MAX_TITLE_CHARS] for item in items if item]
    if not cleaned:
        raise ValueError("empty")
    if len(cleaned) <= MAX_ITEMS:
        return cleaned
    return [cleaned[index] for index in _evenly(list(range(len(cleaned))), MAX_ITEMS)]


def _quoted_strings(body: str) -> list[str]:
    found = re.findall(r'"((?:\\.|[^"\\])*)"', body)
    if not found:
        raise ValueError("invalid json")
    return [json.loads(f'"{item}"') for item in found]


def _excerpt(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    return compact[:limit].strip()


def _evenly(items: list[int], count: int) -> list[int]:
    if count >= len(items):
        return list(items)
    if count <= 1:
        return [items[0]]
    last = len(items) - 1
    chosen: list[int] = []
    seen: set[int] = set()
    for step in range(count):
        value = items[round(step * last / (count - 1))]
        if value not in seen:
            seen.add(value)
            chosen.append(value)
    return chosen
