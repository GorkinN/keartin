from __future__ import annotations

import asyncio
import logging
from typing import Optional, Protocol

from app.gpu.errors import GpuError
from app.gpu.nvidia import wait_vram_released
from app.gpu.ollama_unload import unload_ollama
from app.llm.ollama_client import OllamaClient
from app.settings import Settings

logger = logging.getLogger(__name__)


class FluxHolder(Protocol):
    @property
    def loaded(self) -> bool: ...

    def unload(self) -> None: ...


class GpuManager:
    """Exclusive GPU lock. Tenants: llm | flux. Never taskkill Ollama."""

    def __init__(self, settings: Settings) -> None:
        self._lock = asyncio.Lock()
        self._tenant: Optional[str] = None
        self._settings = settings
        self._flux: FluxHolder | None = None

    def attach_flux(self, flux: FluxHolder) -> None:
        self._flux = flux

    @property
    def tenant(self) -> Optional[str]:
        return self._tenant

    @property
    def locked(self) -> bool:
        return self._lock.locked()

    async def acquire(self, tenant: str) -> None:
        if tenant not in {"llm", "flux"}:
            raise GpuError(f"Unknown GPU tenant: {tenant}", status_code=500)
        await self._lock.acquire()
        try:
            if tenant == "llm":
                await self._ensure_flux_unloaded()
            else:
                logger.info("gpu acquire flux: unload LLM before Flux")
                await unload_ollama(OllamaClient(self._settings))
                await wait_vram_released(self._settings.gpu_free_mb_threshold)
            self._tenant = tenant
            logger.info("gpu acquired tenant=%s", tenant)
        except Exception:
            self._lock.release()
            raise

    async def release(self) -> None:
        error: Exception | None = None
        try:
            if self._tenant == "flux":
                logger.info("gpu release flux: unload Flux")
                await self._ensure_flux_unloaded()
                await wait_vram_released(self._settings.gpu_free_mb_threshold)
        except Exception as exc:
            error = exc
        finally:
            previous = self._tenant
            self._tenant = None
            if self._lock.locked():
                self._lock.release()
            logger.info("gpu released tenant=%s", previous)
        if error:
            raise error

    async def _ensure_flux_unloaded(self) -> None:
        flux = self._flux
        if flux is None or not flux.loaded:
            return
        await asyncio.to_thread(flux.unload)
        await wait_vram_released(self._settings.gpu_free_mb_threshold)
