from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field, field_validator

from app.gpu.manager import GpuManager
from app.image.flux_pipeline import FluxPipelineHolder
from app.llm.ollama_client import OllamaClient
from app.pipeline.cancel import CancelRegistry
from app.pipeline.post_pipeline import (
    JOB_ID_RE,
    ImageSpec,
    PostSpec,
    iter_image_events,
    iter_post_events,
    resolve_job_id,
)
from app.rag.retriever import Retriever
from app.settings import get_settings

router = APIRouter(prefix="/pipeline")


def _clean_image_style(value: str) -> str:
    text = value.strip()
    if len(text) > 4000:
        raise ValueError("image_style is longer than 4000 characters")
    return text


class StructureIn(BaseModel):
    hooks: bool = True
    body: bool = True
    cta: bool = True


class PresetIn(BaseModel):
    description: str = ""
    examples: list[str] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("examples")
    @classmethod
    def strip_examples(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if len(cleaned) > 5:
            raise ValueError("at most 5 preset examples")
        return cleaned


class PostPipelineRequest(BaseModel):
    topic: str = Field(min_length=1)
    tone: str = ""
    length: Literal["S", "M", "L"] = "M"
    emoji: bool = False
    knowledge_mode: Literal["rag", "rag_plus", "general"] = "rag"
    citations: bool = False
    structure: StructureIn = Field(default_factory=StructureIn)
    book_ids: list[str] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=1, le=20)
    preset: PresetIn | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    width: int | None = Field(default=None, ge=256, le=1024)
    height: int | None = Field(default=None, ge=256, le=1024)
    steps: int | None = Field(default=None, ge=20, le=28)
    seed: int | None = None
    job_id: str | None = None
    image_style: str = ""

    @field_validator("topic", "tone")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("topic")
    @classmethod
    def topic_required(cls, value: str) -> str:
        if not value:
            raise ValueError("topic is required")
        return value

    @field_validator("book_ids")
    @classmethod
    def clean_book_ids(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            book_id = item.strip()
            if book_id and book_id not in seen:
                seen.append(book_id)
        return seen

    @field_validator("width", "height")
    @classmethod
    def multiple_of_16(cls, value: int | None) -> int | None:
        if value is not None and value % 16 != 0:
            raise ValueError("width and height must be multiples of 16")
        return value

    @field_validator("job_id")
    @classmethod
    def valid_job_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        job_id = value.strip()
        if not job_id:
            return None
        if not JOB_ID_RE.fullmatch(job_id):
            raise ValueError("invalid job_id")
        return job_id

    @field_validator("image_style")
    @classmethod
    def strip_image_style(cls, value: str) -> str:
        return _clean_image_style(value)

    def to_spec(self) -> PostSpec:
        preset = self.preset or PresetIn()
        return PostSpec(
            topic=self.topic,
            tone=self.tone,
            length=self.length,
            emoji=self.emoji,
            knowledge_mode=self.knowledge_mode,
            citations=self.citations,
            hooks=self.structure.hooks,
            body=self.structure.body,
            cta=self.structure.cta,
            book_ids=tuple(self.book_ids),
            top_k=self.top_k,
            preset_description=preset.description,
            preset_examples=tuple(preset.examples),
            temperature=self.temperature,
            width=self.width or 1024,
            height=self.height or 1024,
            steps=self.steps or 28,
            seed=self.seed,
            job_id=self.job_id,
            image_style=self.image_style,
        )


class ImagePipelineRequest(BaseModel):
    text: str = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    width: int | None = Field(default=None, ge=256, le=1024)
    height: int | None = Field(default=None, ge=256, le=1024)
    steps: int | None = Field(default=None, ge=20, le=28)
    seed: int | None = None
    job_id: str | None = None
    image_style: str = ""

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("text is required")
        return text

    @field_validator("width", "height")
    @classmethod
    def multiple_of_16(cls, value: int | None) -> int | None:
        if value is not None and value % 16 != 0:
            raise ValueError("width and height must be multiples of 16")
        return value

    @field_validator("job_id")
    @classmethod
    def valid_job_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        job_id = value.strip()
        if not job_id:
            return None
        if not JOB_ID_RE.fullmatch(job_id):
            raise ValueError("invalid job_id")
        return job_id

    @field_validator("image_style")
    @classmethod
    def strip_image_style(cls, value: str) -> str:
        return _clean_image_style(value)

    def to_spec(self) -> ImageSpec:
        return ImageSpec(
            text=self.text,
            temperature=self.temperature,
            width=self.width or 1024,
            height=self.height or 1024,
            steps=self.steps or 28,
            seed=self.seed,
            job_id=self.job_id,
            image_style=self.image_style,
        )


def _gpu(request: Request) -> GpuManager:
    return request.app.state.gpu


def _flux(request: Request) -> FluxPipelineHolder:
    return request.app.state.flux


def _retriever(request: Request) -> Retriever:
    return request.app.state.retriever


def _cancels(request: Request) -> CancelRegistry:
    return request.app.state.cancels


def _opened_post(body: PostPipelineRequest, request: Request) -> PostSpec:
    spec = replace(body.to_spec(), job_id=resolve_job_id(body.job_id))
    _cancels(request).open(spec.job_id or "")
    return spec


@router.post("/jobs/{job_id}/cancel", status_code=202)
async def cancel_pipeline_job(job_id: str, request: Request) -> dict[str, str]:
    if not JOB_ID_RE.fullmatch(job_id) or not _cancels(request).cancel(job_id):
        raise HTTPException(status_code=404, detail="джоба не найдена")
    return {"jobId": job_id, "status": "cancelled"}


@router.post("/stream", response_class=EventSourceResponse)
async def pipeline_stream(
    body: PostPipelineRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    spec = _opened_post(body, request)
    async for event in iter_post_events(
        spec,
        gpu=_gpu(request),
        retriever=_retriever(request),
        flux=_flux(request),
        client=OllamaClient(get_settings()),
        include_image=True,
        cancels=_cancels(request),
    ):
        yield event


@router.post("/text/stream", response_class=EventSourceResponse)
async def pipeline_text_stream(
    body: PostPipelineRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    spec = _opened_post(body, request)
    async for event in iter_post_events(
        spec,
        gpu=_gpu(request),
        retriever=_retriever(request),
        flux=_flux(request),
        client=OllamaClient(get_settings()),
        include_image=False,
        cancels=_cancels(request),
    ):
        yield event


@router.post("/image/stream", response_class=EventSourceResponse)
async def pipeline_image_stream(
    body: ImagePipelineRequest,
    request: Request,
) -> AsyncIterator[ServerSentEvent]:
    spec = replace(body.to_spec(), job_id=resolve_job_id(body.job_id))
    _cancels(request).open(spec.job_id or "")
    async for event in iter_image_events(
        spec,
        gpu=_gpu(request),
        flux=_flux(request),
        client=OllamaClient(get_settings()),
        cancels=_cancels(request),
    ):
        yield event
