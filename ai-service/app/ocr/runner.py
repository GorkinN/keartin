from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

from app.gpu.manager import GpuManager
from app.ocr.deepseek import DeepseekOcrHolder
from app.ocr.pdf_ocr import ocr_pdf
from app.settings import Settings


class ScanOcr:
    """Runs a whole PDF through DeepSeek-OCR while holding GPU tenant `ocr`."""

    def __init__(self, settings: Settings, gpu: GpuManager, holder: DeepseekOcrHolder) -> None:
        self._settings = settings
        self._gpu = gpu
        self._holder = holder

    async def __call__(self, path: Path, on_page: Callable[[int, int], None]) -> str:
        await self._gpu.acquire("ocr")
        try:
            return await asyncio.to_thread(
                ocr_pdf,
                path,
                self._holder,
                dpi=self._settings.ocr_dpi,
                on_page=on_page,
            )
        finally:
            await self._gpu.release()
