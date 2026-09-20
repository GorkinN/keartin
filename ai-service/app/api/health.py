from __future__ import annotations

import asyncio
import sys
from typing import Literal

import httpx
from fastapi import APIRouter

from app.settings import Settings, get_settings

router = APIRouter()

Status = Literal["ok", "down", "skipped"]


async def _ping(url: str) -> Status:
    try:
        async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
            response = await client.get(url)
            return "ok" if response.status_code < 500 else "down"
    except Exception:
        return "down"


def _cuda_status() -> Status:
    try:
        import torch  # type: ignore[import-not-found]

        return "ok" if torch.cuda.is_available() else "down"
    except Exception:
        return "skipped"


@router.get("/health")
async def health() -> dict[str, str]:
    settings = get_settings()
    ollama, qdrant = await asyncio.gather(
        _ping(f"{settings.ollama_host.rstrip('/')}/api/tags"),
        _ping(f"{settings.qdrant_url.rstrip('/')}/readyz"),
    )
    return {
        "status": "ok",
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "cuda": _cuda_status(),
        "ollama": ollama,
        "qdrant": qdrant,
        "hf_home": settings.hf_home or "",
    }
