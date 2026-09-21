from __future__ import annotations

import asyncio
import logging
import random
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from fastapi.sse import ServerSentEvent

from app.bootstrap import repo_root
from app.gpu.errors import GpuError
from app.gpu.manager import GpuManager
from app.image.flux_pipeline import FluxError, FluxPipelineHolder
from app.llm.ollama_client import OllamaClient, OllamaError
from app.prompts import load_image_system_prompt, load_post_system_prompt
from app.rag.qdrant_store import SearchHit
from app.rag.retriever import Retriever

logger = logging.getLogger(__name__)

CONTEXT_CHAR_BUDGET = 10_000
LENGTH_CHARS = {"S": 500, "M": 1200, "L": 2500}
DEFAULT_TONE = "живой, разговорный"
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
DEFAULT_STEPS = 28
INSUFFICIENT_CONTEXT = "недостаточно контекста"
JOB_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,80}$")


class PipelineError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class PostSpec:
    topic: str
    tone: str
    length: str
    emoji: bool
    knowledge_mode: str
    citations: bool
    hooks: bool
    body: bool
    cta: bool
    book_ids: tuple[str, ...]
    top_k: int
    preset_description: str
    preset_examples: tuple[str, ...]
    temperature: float | None
    width: int
    height: int
    steps: int
    seed: int | None
    job_id: str | None


@dataclass(frozen=True)
class ImageSpec:
    text: str
    temperature: float | None
    width: int
    height: int
    steps: int
    seed: int | None
    job_id: str | None


def resolve_job_id(job_id: str | None) -> str:
    if not job_id:
        return uuid.uuid4().hex
    if not JOB_ID_RE.fullmatch(job_id) or ".." in job_id:
        raise PipelineError("invalid job_id")
    return job_id


def pipeline_dir(job_id: str) -> Path:
    return repo_root() / "data" / "tmp" / "pipeline" / job_id


def write_post(job_id: str, text: str) -> Path:
    path = pipeline_dir(job_id) / "post.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return path


def write_image_prompt(job_id: str, prompt: str) -> Path:
    path = pipeline_dir(job_id) / "image_prompt.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(prompt.strip() + "\n", encoding="utf-8")
    return path


def save_png(job_id: str, image: object) -> Path:
    path = pipeline_dir(job_id) / "image.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)  # type: ignore[attr-defined]
    return path


def select_hits(
    hits: list[SearchHit],
    budget: int = CONTEXT_CHAR_BUDGET,
) -> list[SearchHit]:
    """Keep score order. Stop before the running text exceeds `budget`."""
    if budget < 1:
        return []
    selected: list[SearchHit] = []
    total = 0
    for hit in hits:
        text = hit.text.strip()
        if not text:
            continue
        room = budget - total
        if room <= 0:
            break
        if len(text) > room:
            if selected:
                break
            text = text[:room]
        selected.append(_hit_with_text(hit, text))
        total += len(text)
    return selected


def build_post_messages(spec: PostSpec, hits: list[SearchHit]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": load_post_system_prompt()},
        {"role": "user", "content": build_post_user_message(spec, hits)},
    ]


def build_post_user_message(spec: PostSpec, hits: list[SearchHit]) -> str:
    tone = spec.tone.strip() or DEFAULT_TONE
    length_n = LENGTH_CHARS.get(spec.length, LENGTH_CHARS["M"])
    parts = [
        f"Тема: {spec.topic.strip()}",
        f"Тон: {tone}",
        f"Длина: около {length_n} символов.",
        "Эмодзи можно, немного." if spec.emoji else "Без эмодзи.",
        _knowledge_instruction(spec.knowledge_mode, hits),
        _citation_instruction(spec.citations),
    ]
    structure = _structure_lines(spec)
    if structure:
        parts.append("Структура:\n" + "\n".join(structure))
    style = _preset_block(spec.preset_description, spec.preset_examples)
    if style:
        parts.append(style)
    context = _context_block(hits, citations=spec.citations)
    if context:
        parts.append(context)
    return "\n\n".join(parts)


def build_image_messages(post_text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": load_image_system_prompt()},
        {"role": "user", "content": post_text.strip()},
    ]


def clean_image_prompt(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    text = text.strip().strip('"').strip("'").strip()
    return " ".join(text.split())


async def retrieve_hits(spec: PostSpec, retriever: Retriever) -> list[SearchHit]:
    if spec.knowledge_mode == "general":
        return []
    if spec.knowledge_mode == "rag" and not spec.book_ids:
        raise PipelineError(INSUFFICIENT_CONTEXT)
    hits = await retriever.search(
        query=spec.topic,
        book_ids=list(spec.book_ids),
        top_k=spec.top_k,
    )
    selected = select_hits(hits)
    if spec.knowledge_mode == "rag" and not selected:
        raise PipelineError(INSUFFICIENT_CONTEXT)
    return selected


async def iter_post_events(
    spec: PostSpec,
    *,
    gpu: GpuManager,
    retriever: Retriever,
    flux: FluxPipelineHolder,
    client: OllamaClient,
    include_image: bool,
) -> AsyncIterator[ServerSentEvent]:
    job_id = resolve_job_id(spec.job_id)
    yield _status("start", job_id)
    try:
        await gpu.acquire("llm")
    except GpuError as exc:
        yield _error(str(exc))
        return

    image_prompt = ""
    try:
        if spec.knowledge_mode != "general":
            yield _status("retrieve", job_id)
        hits = await retrieve_hits(spec, retriever)
        yield _status("text", job_id)
        messages = build_post_messages(spec, hits)
        parts: list[str] = []
        async for token in client.chat_stream(
            messages=messages,
            temperature=spec.temperature,
        ):
            parts.append(token)
            yield ServerSentEvent(data={"text": token}, event="token")
        text = "".join(parts).strip()
        if not text:
            raise PipelineError("пустой текст поста")
        write_post(job_id, text)
        yield ServerSentEvent(
            data={"text": text, "sources": _sources(hits)},
            event="text_done",
        )
        if not include_image:
            return
        yield _status("image_prompt", job_id)
        image_prompt = await _image_prompt_from_llm(client, text, spec.temperature)
        write_image_prompt(job_id, image_prompt)
        yield ServerSentEvent(data={"prompt": image_prompt}, event="image_prompt")
    except PipelineError as exc:
        yield _error(str(exc))
        return
    except (OllamaError, GpuError) as exc:
        yield _error(str(exc))
        return
    except Exception as exc:
        logger.exception("pipeline text failed job=%s", job_id)
        yield _error(str(exc))
        return
    finally:
        try:
            await gpu.release()
        except Exception as exc:
            logger.warning("gpu release after pipeline text failed: %s", exc)

    if not image_prompt:
        return

    async for event in _iter_flux_phase(
        flux,
        gpu,
        job_id=job_id,
        prompt=image_prompt,
        width=spec.width,
        height=spec.height,
        steps=spec.steps,
        seed=spec.seed,
    ):
        yield event


async def iter_image_events(
    spec: ImageSpec,
    *,
    gpu: GpuManager,
    flux: FluxPipelineHolder,
    client: OllamaClient,
) -> AsyncIterator[ServerSentEvent]:
    job_id = resolve_job_id(spec.job_id)
    yield _status("start", job_id)
    try:
        await gpu.acquire("llm")
    except GpuError as exc:
        yield _error(str(exc))
        return

    image_prompt = ""
    try:
        yield _status("image_prompt", job_id)
        image_prompt = await _image_prompt_from_llm(client, spec.text, spec.temperature)
        write_image_prompt(job_id, image_prompt)
        yield ServerSentEvent(data={"prompt": image_prompt}, event="image_prompt")
    except PipelineError as exc:
        yield _error(str(exc))
        return
    except (OllamaError, GpuError) as exc:
        yield _error(str(exc))
        return
    except Exception as exc:
        logger.exception("pipeline image prompt failed job=%s", job_id)
        yield _error(str(exc))
        return
    finally:
        try:
            await gpu.release()
        except Exception as exc:
            logger.warning("gpu release after pipeline image prompt failed: %s", exc)

    if not image_prompt:
        return

    async for event in _iter_flux_phase(
        flux,
        gpu,
        job_id=job_id,
        prompt=image_prompt,
        width=spec.width,
        height=spec.height,
        steps=spec.steps,
        seed=spec.seed,
    ):
        yield event


async def _image_prompt_from_llm(
    client: OllamaClient,
    post_text: str,
    temperature: float | None,
) -> str:
    raw = await client.chat(
        messages=build_image_messages(post_text),
        temperature=temperature,
    )
    prompt = clean_image_prompt(raw)
    if not prompt:
        raise PipelineError("пустой промпт картинки")
    return prompt


async def _iter_flux_phase(
    flux: FluxPipelineHolder,
    gpu: GpuManager,
    *,
    job_id: str,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    seed: int | None,
) -> AsyncIterator[ServerSentEvent]:
    resolved_seed = seed if seed is not None else random.randint(0, 2**31 - 1)
    try:
        await gpu.acquire("flux")
    except GpuError as exc:
        yield _error(str(exc))
        return
    try:
        logger.info("pipeline job=%s gpu_unload_llm done, flux tenant held", job_id)
        yield ServerSentEvent(data={"ok": True}, event="gpu_unload_llm")
        yield _status("load_flux", job_id)
        await asyncio.to_thread(flux.load)
        yield _status("generate", job_id)
        async for event in _iter_flux_generate(
            flux,
            prompt=prompt,
            width=width,
            height=height,
            steps=steps,
            seed=resolved_seed,
            job_id=job_id,
        ):
            yield event
        yield _status("unload_flux", job_id)
    except (GpuError, FluxError, PipelineError) as exc:
        yield _error(str(exc))
    except Exception as exc:
        logger.exception("pipeline flux failed job=%s", job_id)
        yield _error(str(exc))
    finally:
        try:
            await gpu.release()
        except Exception as exc:
            logger.warning("gpu release after pipeline flux failed: %s", exc)


async def _iter_flux_generate(
    flux: FluxPipelineHolder,
    *,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
    job_id: str,
) -> AsyncIterator[ServerSentEvent]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, object, object | None]] = asyncio.Queue()

    def on_step(step: int, total: int) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ("progress", step, total))

    def work() -> None:
        try:
            image = flux.generate(
                prompt=prompt,
                width=width,
                height=height,
                steps=steps,
                seed=seed,
                on_step=on_step,
            )
            path = save_png(job_id, image)
            loop.call_soon_threadsafe(queue.put_nowait, ("done", str(path), None))
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", exc, None))

    future = loop.run_in_executor(None, work)
    while True:
        kind, first, _second = await queue.get()
        if kind == "progress":
            yield ServerSentEvent(
                data={"step": first, "total": _second},
                event="image_progress",
            )
        elif kind == "done":
            await future
            yield ServerSentEvent(
                data={"path": first, "seed": seed, "prompt": prompt},
                event="image_done",
            )
            return
        else:
            await future
            raise first  # type: ignore[misc]


def _status(phase: str, job_id: str) -> ServerSentEvent:
    logger.info("pipeline job=%s phase=%s", job_id, phase)
    return ServerSentEvent(data={"phase": phase, "job_id": job_id}, event="status")


def _error(message: str) -> ServerSentEvent:
    return ServerSentEvent(data={"message": message}, event="error")


def _sources(hits: list[SearchHit]) -> list[dict[str, object]]:
    return [
        {
            "book_id": hit.book_id,
            "chunk_index": hit.chunk_index,
            "source_name": hit.source_name,
            "score": hit.score,
        }
        for hit in hits
    ]


def _hit_with_text(hit: SearchHit, text: str) -> SearchHit:
    if hit.text == text:
        return hit
    return SearchHit(
        book_id=hit.book_id,
        chunk_index=hit.chunk_index,
        source_name=hit.source_name,
        lang=hit.lang,
        text=text,
        score=hit.score,
    )


def _knowledge_instruction(mode: str, hits: list[SearchHit]) -> str:
    if mode == "general":
        return "Опирайся на общие знания. Не выдумывай цитаты."
    if mode == "rag":
        return (
            "Используй только фрагменты из блока «Контекст». "
            "Не добавляй факты, которых там нет."
        )
    if hits:
        return (
            "Сначала опирайся на блок «Контекст». "
            "Общие знания допустимы, чтобы связать мысль. "
            "Не выдумывай цитаты и не приписывай источникам то, чего в контексте нет."
        )
    return "Релевантных фрагментов нет. Пиши по общим знаниям, без выдуманных цитат."


def _citation_instruction(citations: bool) -> str:
    if citations:
        return "Можно называть источники только из контекста. Не выдумывай названия."
    return "Не указывай названия источников."


def _structure_lines(spec: PostSpec) -> list[str]:
    lines: list[str] = []
    if spec.hooks:
        lines.append("- Хук: первая фраза цепляет внимание.")
    if spec.body:
        lines.append("- Основной текст: раскрой тему.")
    if spec.cta:
        lines.append("- Призыв к действию: заверши конкретным призывом.")
    return lines


def _preset_block(description: str, examples: tuple[str, ...]) -> str:
    description = description.strip()
    samples = [item.strip() for item in examples if item.strip()]
    if not description and not samples:
        return ""
    chunks: list[str] = []
    if description:
        chunks.append(f"Стиль:\n{description}")
    if samples:
        numbered = "\n".join(f"{index}. {sample}" for index, sample in enumerate(samples, start=1))
        chunks.append(f"Примеры:\n{numbered}")
    return "\n\n".join(chunks)


def _context_block(hits: list[SearchHit], *, citations: bool) -> str:
    if not hits:
        return ""
    blocks: list[str] = []
    for index, hit in enumerate(hits, start=1):
        if citations and hit.source_name.strip():
            blocks.append(f"[{index}] {hit.source_name.strip()}\n{hit.text.strip()}")
        else:
            blocks.append(f"[{index}]\n{hit.text.strip()}")
    return "Контекст:\n" + "\n\n".join(blocks)
