from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field, model_validator

from app.gpu.manager import GpuManager
from app.llm.ollama_client import OllamaClient, OllamaError
from app.prompts import load_text_system_prompt
from app.settings import get_settings

router = APIRouter(prefix="/generate")


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
    finally:
        await gpu.release()
