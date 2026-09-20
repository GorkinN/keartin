from __future__ import annotations

import asyncio
from typing import Optional


class GpuManager:
    """Stage 0 stub: exclusive lock only. No Ollama stop, no nvidia-smi."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._tenant: Optional[str] = None

    @property
    def tenant(self) -> Optional[str]:
        return self._tenant

    async def acquire(self, tenant: str) -> None:
        await self._lock.acquire()
        self._tenant = tenant

    async def release(self) -> None:
        self._tenant = None
        if self._lock.locked():
            self._lock.release()
