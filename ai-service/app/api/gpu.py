from __future__ import annotations

from app.gpu.manager import GpuManager
from app.gpu.nvidia import vram_used_mb
from app.gpu.ollama_unload import loaded_names
from app.llm.ollama_client import OllamaClient
from app.settings import get_settings
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/gpu/status")
async def gpu_status(request: Request) -> dict[str, object]:
    gpu: GpuManager = request.app.state.gpu
    settings = get_settings()
    models = await loaded_names(OllamaClient(settings))
    return {
        "locked": gpu.locked,
        "tenant": gpu.tenant,
        "ollama_models": models,
        "vram_used_mb": vram_used_mb(),
    }
