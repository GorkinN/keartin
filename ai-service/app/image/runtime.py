from __future__ import annotations

from app.image.flux_pipeline import FluxPipelineHolder
from app.image.qwen_runner import QwenRunner
from app.settings import Settings


class ImageRuntime:
    """One image tenant. Flux stays in this process; Qwen runs in its own venv."""

    def __init__(self, settings: Settings, flux: FluxPipelineHolder) -> None:
        self.flux = flux
        self.qwen = QwenRunner(settings)

    @property
    def loaded(self) -> bool:
        return self.flux.loaded or self.qwen.running

    def unload(self) -> None:
        self.flux.unload()
        self.qwen.running = False
