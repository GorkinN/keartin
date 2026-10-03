from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter

from app.image.qwen_runner import gguf_label, qwen_gguf_entries, qwen_python_ready
from app.settings import Settings, get_settings

router = APIRouter()


class LlmConfig(BaseModel):
    model: str
    num_ctx: int
    keep_alive: str
    host: str


class EmbedConfig(BaseModel):
    model: str


class FluxConfig(BaseModel):
    model: str
    quant: str
    path: str


class OcrConfig(BaseModel):
    model: str
    dpi: int
    max_patches: int
    max_new_tokens: int


class QwenGgufFile(BaseModel):
    id: str
    label: str


class QwenConfig(BaseModel):
    model: str
    python_ready: bool
    path: str
    ggufs: list[QwenGgufFile]


class AppConfig(BaseModel):
    llm: LlmConfig
    embed: EmbedConfig
    flux: FluxConfig
    qwen: QwenConfig
    ocr: OcrConfig


def app_config(settings: Settings | None = None) -> AppConfig:
    current = settings or get_settings()
    return AppConfig(
        llm=LlmConfig(
            model=current.llm_model,
            num_ctx=current.llm_num_ctx,
            keep_alive=current.llm_keep_alive,
            host=current.ollama_host,
        ),
        embed=EmbedConfig(model=current.embed_model),
        flux=FluxConfig(
            model=current.flux_model_id,
            quant=current.flux_quant,
            path=current.flux_model_path,
        ),
        qwen=QwenConfig(
            model=current.qwen_image_model_id,
            python_ready=qwen_python_ready(current),
            path=current.qwen_model_path,
            ggufs=[QwenGgufFile(id=name, label=gguf_label(name)) for name, _path in qwen_gguf_entries(current)],
        ),
        ocr=OcrConfig(
            model=current.ocr_model_id,
            dpi=current.ocr_dpi,
            max_patches=current.ocr_max_patches,
            max_new_tokens=current.ocr_max_new_tokens,
        ),
    )


@router.get("/config", response_model=AppConfig)
def read_config() -> AppConfig:
    return app_config()
