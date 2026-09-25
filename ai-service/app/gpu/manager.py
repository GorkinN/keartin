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

TENANTS = {"llm", "flux", "ocr"}


class ModelHolder(Protocol):
    @property
    def loaded(self) -> bool: ...

    def unload(self) -> None: ...

class GpuManager:
    """Exclusive GPU lock. Tenants: llm | flux | ocr. Never taskkill Ollama."""

    def __init__(self, settings: Settings) -> None:
        self._lock = asyncio.Lock()
        self._tenant: Optional[str] = None
        self._settings = settings
        self._holders: dict[str, ModelHolder] = {}

    def attach_flux(self, flux: ModelHolder) -> None:
        self._holders["flux"] = flux

    def attach_ocr(self, ocr: ModelHolder) -> None:
        self._holders["ocr"] = ocr

    @property
    def tenant(self) -> Optional[str]:
        return self._tenant

    @property
    def locked(self) -> bool:
        return self._lock.locked()

    async def acquire(self, tenant: str) -> None:
        if tenant not in TENANTS:
            raise GpuError(f"Unknown GPU tenant: {tenant}", status_code=500)
        await self._lock.acquire()
        try:
            for name in self._holders:
                if name != tenant:
                    await self._ensure_unloaded(name)
            if tenant != "llm":
                logger.info("gpu acquire %s: unload LLM first", tenant)
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
            if self._tenant in self._holders:
                logger.info("gpu release %s: unload", self._tenant)
                await self._ensure_unloaded(self._tenant)
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

    async def settle(self) -> bool:
        """Unload leftover models when idle. False if another tenant holds the lock."""
        if self._lock.locked():
            logger.info("gpu settle skipped: lock held")
            return False
        try:
            await asyncio.wait_for(self._lock.acquire(), timeout=0.05)
        except TimeoutError:
            logger.info("gpu settle skipped: lock held")
            return False
        try:
            for name in list(self._holders):
                await self._ensure_unloaded(name)
            logger.info("gpu settle: unload LLM")
            await unload_ollama(OllamaClient(self._settings))
            await wait_vram_released(self._settings.gpu_free_mb_threshold)
            self._tenant = None
            logger.info("gpu settle done")
            return True
        finally:
            if self._lock.locked():
                self._lock.release()

    async def _ensure_unloaded(self, name: str) -> None:
        holder = self._holders.get(name)
        if holder is None or not holder.loaded:
            return
        await asyncio.to_thread(holder.unload)
        await wait_vram_released(self._settings.gpu_free_mb_threshold)
