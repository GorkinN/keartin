from __future__ import annotations

import asyncio
import base64
import logging
import random
import threading
from collections.abc import AsyncIterator
from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field, field_validator, model_validator

from app.bootstrap import repo_root
from app.gpu.errors import GpuError
from app.gpu.manager import GpuManager
from app.image.flux_pipeline import FluxError, FluxPipelineHolder
from app.llm.ollama_client import OllamaClient, OllamaError
from app.messages import CANCELLED, public_message
from app.pipeline.cancel import CancelRegistry
from app.pipeline.post_pipeline import JOB_ID_RE
from app.prompts import load_text_system_prompt
from app.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate")

DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
DEFAULT_STEPS = 28
BATCH_STEPS = 20
SEED_SPAN = 2_147_483_648


class TextGenerateRequest(BaseModel):
    prompt: str | None = None
    topic: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    keep_alive: str | int | None = None

    @model_validator(mode="after")
    def require_prompt_or_topic(self) -> TextGenerateRequest:
        prompt = (self.prompt or "").strip()
        topic = (self.topic or "").strip()
        if not prompt and not topic:
            raise ValueError("Provide prompt or topic")
        self.prompt = prompt or None
        self.topic = topic or None
        return self


class TextGenerateResponse(BaseModel):
    text: str
    model: str


class ImageGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    width: int | None = Field(default=None, ge=256, le=1024)
    height: int | None = Field(default=None, ge=256, le=1024)
    steps: int | None = Field(default=None, ge=20, le=28)
    seed: int | None = None

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("prompt is required")
        return text

    @field_validator("width", "height")
    @classmethod
    def multiple_of_16(cls, value: int | None) -> int | None:
        if value is not None and value % 16 != 0:
            raise ValueError("width and height must be multiples of 16")
        return value


class ImagesGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    width: int | None = Field(default=None, ge=256, le=1024)
    height: int | None = Field(default=None, ge=256, le=1024)
    steps: int | None = Field(default=None, ge=20, le=28)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    count: int = Field(default=1, ge=1, le=20)
    job_id: str

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("prompt is required")
        return text

    @field_validator("width", "height")
    @classmethod
    def multiple_of_16(cls, value: int | None) -> int | None:
        if value is not None and value % 16 != 0:
            raise ValueError("width and height must be multiples of 16")
        return value

    @field_validator("job_id")
    @classmethod
    def valid_job_id(cls, value: str) -> str:
        if not JOB_ID_RE.fullmatch(value) or ".." in value:
            raise ValueError("invalid job_id")
        return value


class ImageGenerateResponse(BaseModel):
    path: str
    seed: int
    width: int
    height: int
    steps: int
    model: str
    image_base64: str


def _user_message(body: TextGenerateRequest) -> str:
    if body.prompt:
        return body.prompt
    return f"Тема поста: {body.topic}"


def _messages(body: TextGenerateRequest) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": load_text_system_prompt()},
        {"role": "user", "content": _user_message(body)},
    ]


def _gpu(request: Request) -> GpuManager:
    return request.app.state.gpu


def _flux(request: Request) -> FluxPipelineHolder:
    return request.app.state.flux


def indexed_seed(seed: int, index: int, count: int) -> int:
    """Match Nest `batchSeed`: a single image keeps `seed`; later images add the index."""
    if count <= 1:
        return seed
    return (seed + index) % SEED_SPAN


def _image_params(body: ImageGenerateRequest) -> tuple[int, int, int, int]:
    width = body.width or DEFAULT_WIDTH
    height = body.height or DEFAULT_HEIGHT
    steps = body.steps or DEFAULT_STEPS
    seed = body.seed if body.seed is not None else random.randint(0, 2**31 - 1)
    return width, height, steps, seed


def _persist_png(image: object, seed: int) -> tuple[str, str]:
    out_dir = repo_root() / "data" / "tmp"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"flux-{stamp}-{seed}.png"
    image.save(path)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return str(path), encoded


def _image_payload(
    *,
    path: str,
    seed: int,
    width: int,
    height: int,
    steps: int,
    model: str,
    image_base64: str,
) -> dict[str, object]:
    return ImageGenerateResponse(
        path=path,
        seed=seed,
        width=width,
        height=height,
        steps=steps,
        model=model,
        image_base64=image_base64,
    ).model_dump()


@router.post("/text", response_model=TextGenerateResponse)
async def generate_text(body: TextGenerateRequest, request: Request) -> TextGenerateResponse:
    settings = get_settings()
    client = OllamaClient(settings)
    gpu = _gpu(request)
    await gpu.acquire("llm")
    try:
        text = await client.chat(
            messages=_messages(body),
            temperature=body.temperature,
            keep_alive=body.keep_alive,
        )
    except OllamaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except GpuError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await gpu.release()
    return TextGenerateResponse(text=text, model=client.model)


@router.post("/text/stream", response_class=EventSourceResponse)
async def generate_text_stream(
    body: TextGenerateRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    settings = get_settings()
    client = OllamaClient(settings)
    gpu = _gpu(request)
    await gpu.acquire("llm")
    try:
        async for token in client.chat_stream(
            messages=_messages(body),
            temperature=body.temperature,
            keep_alive=body.keep_alive,
        ):
            yield ServerSentEvent(data={"text": token}, event="token")
        yield ServerSentEvent(data={"ok": True}, event="done")
    except OllamaError as exc:
        yield ServerSentEvent(
            data={"message": str(exc), "status_code": exc.status_code},
            event="error",
        )
    except GpuError as exc:
        yield ServerSentEvent(
            data={"message": str(exc), "status_code": exc.status_code},
            event="error",
        )
    finally:
        await gpu.release()


@router.post("/image", response_model=ImageGenerateResponse)
async def generate_image(body: ImageGenerateRequest, request: Request) -> ImageGenerateResponse:
    flux = _flux(request)
    gpu = _gpu(request)
    width, height, steps, seed = _image_params(body)
    await gpu.acquire("flux")
    try:
        image = await asyncio.to_thread(
            flux.generate,
            prompt=body.prompt,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
        )
        path, encoded = await asyncio.to_thread(_persist_png, image, seed)
        return ImageGenerateResponse(
            path=path,
            seed=seed,
            width=width,
            height=height,
            steps=steps,
            model=flux.model_id,
            image_base64=encoded,
        )
    except (GpuError, FluxError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await gpu.release()


@router.post("/image/stream", response_class=EventSourceResponse)
async def generate_image_stream(
    body: ImageGenerateRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    flux = _flux(request)
    gpu = _gpu(request)
    width, height, steps, seed = _image_params(body)
    yield ServerSentEvent(data={"phase": "unload_llm"}, event="status")
    try:
        await gpu.acquire("flux")
    except GpuError as exc:
        yield ServerSentEvent(data={"message": str(exc)}, event="error")
        return
    try:
        yield ServerSentEvent(data={"phase": "load_flux"}, event="status")
        await asyncio.to_thread(flux.load)
        yield ServerSentEvent(data={"phase": "generate"}, event="status")
        async for event in _stream_flux_generate(
            flux,
            prompt=body.prompt,
            width=width,
            height=height,
            steps=steps,
            seed=seed,
        ):
            yield event
        yield ServerSentEvent(data={"phase": "unload_flux"}, event="status")
    except (GpuError, FluxError) as exc:
        yield ServerSentEvent(data={"message": str(exc)}, event="error")
    except Exception as exc:
        logger.exception("image stream failed")
        yield ServerSentEvent(data={"message": str(exc)}, event="error")
    finally:
        try:
            await gpu.release()
        except Exception as exc:
            logger.warning("gpu release after image failed: %s", exc)


async def _stream_flux_generate(
    flux: FluxPipelineHolder,
    *,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
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
            path, encoded = _persist_png(image, seed)
            payload = _image_payload(
                path=path,
                seed=seed,
                width=width,
                height=height,
                steps=steps,
                model=flux.model_id,
                image_base64=encoded,
            )
            loop.call_soon_threadsafe(queue.put_nowait, ("done", payload, None))
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", exc, None))

    future = loop.run_in_executor(None, work)
    while True:
        kind, first, second = await queue.get()
        if kind == "progress":
            yield ServerSentEvent(
                data={"step": first, "total": second},
                event="image_progress",
            )
        elif kind == "done":
            await future
            yield ServerSentEvent(data=first, event="done")
            return
        else:
            await future
            raise first  # type: ignore[misc]


def _cancels(request: Request) -> CancelRegistry:
    return request.app.state.cancels


def _batch_png(job_id: str, index: int, image: object) -> Path:
    directory = repo_root() / "data" / "tmp" / "images" / job_id
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{index}.png"
    image.save(path)  # type: ignore[attr-defined]
    return path


@router.post("/images/stream", response_class=EventSourceResponse)
async def generate_images_stream(
    body: ImagesGenerateRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    flux = _flux(request)
    gpu = _gpu(request)
    width = body.width or DEFAULT_WIDTH
    height = body.height or DEFAULT_HEIGHT
    steps = body.steps or BATCH_STEPS
    stop = _cancels(request).open(body.job_id)
    try:
        async for event in _iter_image_batch(
            flux,
            gpu,
            prompt=body.prompt,
            width=width,
            height=height,
            steps=steps,
            seed=body.seed,
            count=body.count,
            job_id=body.job_id,
            stop=stop,
        ):
            yield event
    finally:
        _cancels(request).close(body.job_id)


async def _iter_image_batch(
    flux: FluxPipelineHolder,
    gpu: GpuManager,
    *,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    seed: int | None,
    count: int,
    job_id: str,
    stop: threading.Event,
) -> AsyncIterator[ServerSentEvent]:
    yield ServerSentEvent(data={"phase": "unload_llm"}, event="status")
    try:
        await gpu.acquire("flux")
    except GpuError as exc:
        yield ServerSentEvent(data={"message": public_message(exc)}, event="error")
        return
    try:
        yield ServerSentEvent(data={"phase": "load_flux"}, event="status")
        await asyncio.to_thread(flux.load)
        for index in range(count):
            if stop.is_set():
                yield ServerSentEvent(data={"message": CANCELLED}, event="cancelled")
                return
            image_seed = random.randint(0, 2**31 - 1) if seed is None else indexed_seed(seed, index, count)
            yield ServerSentEvent(data={"phase": "generate", "index": index}, event="status")
            try:
                async for event in _stream_batch_image(
                    flux,
                    prompt=prompt,
                    width=width,
                    height=height,
                    steps=steps,
                    seed=image_seed,
                    index=index,
                    job_id=job_id,
                ):
                    yield event
            except (GpuError, FluxError) as exc:
                yield ServerSentEvent(data={"message": public_message(exc)}, event="error")
                return
            except Exception as exc:
                logger.exception("image batch failed job=%s index=%s", job_id, index)
                yield ServerSentEvent(data={"message": public_message(exc)}, event="error")
                return
            if stop.is_set():
                yield ServerSentEvent(data={"message": CANCELLED}, event="cancelled")
                return
        yield ServerSentEvent(data={"phase": "unload_flux"}, event="status")
        yield ServerSentEvent(data={"count": count}, event="done")
    except (GpuError, FluxError) as exc:
        yield ServerSentEvent(data={"message": public_message(exc)}, event="error")
    except Exception as exc:
        logger.exception("image batch failed job=%s", job_id)
        yield ServerSentEvent(data={"message": public_message(exc)}, event="error")
    finally:
        try:
            await gpu.release()
        except Exception as exc:
            logger.warning("gpu release after image batch failed: %s", exc)


async def _stream_batch_image(
    flux: FluxPipelineHolder,
    *,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    seed: int,
    index: int,
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
            path = _batch_png(job_id, index, image)
            loop.call_soon_threadsafe(queue.put_nowait, ("done", str(path), None))
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", exc, None))

    future = loop.run_in_executor(None, work)
    while True:
        kind, first, second = await queue.get()
        if kind == "progress":
            yield ServerSentEvent(
                data={"index": index, "step": first, "total": second},
                event="image_progress",
            )
        elif kind == "done":
            await future
            yield ServerSentEvent(
                data={"index": index, "seed": seed, "path": first},
                event="image_done",
            )
            return
        else:
            await future
            raise first  # type: ignore[misc]
