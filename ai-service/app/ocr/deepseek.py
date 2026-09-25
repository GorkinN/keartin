from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from typing import Any

from app.rag.errors import RagError
from app.settings import Settings

logger = logging.getLogger(__name__)

PROMPT = "<image>\nFree OCR."
NO_REPEAT_NGRAM = 30


class DeepseekOcrHolder:
    """Lazy DeepSeek-OCR-2 loader. Weights from HF_HOME; VRAM only under GPU tenant `ocr`."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: Any = None
        self._processor: Any = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def model_id(self) -> str:
        return self._settings.ocr_model_id

    def load(self) -> None:
        if self._model is not None:
            return
        self._assert_cached()
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        if not torch.cuda.is_available():
            raise RagError("CUDA is unavailable for OCR", status_code=503)
        logger.info("loading ocr model=%s", self.model_id)
        self._processor = AutoProcessor.from_pretrained(self.model_id, local_files_only=True)
        model = AutoModelForImageTextToText.from_pretrained(
            self.model_id,
            dtype=torch.bfloat16,
            local_files_only=True,
            low_cpu_mem_usage=True,
        )
        self._model = model.to("cuda").eval()
        logger.info("ocr loaded")

    def unload(self) -> None:
        if self._model is None:
            return
        logger.info("unloading ocr")
        model = self._model
        self._model = None
        self._processor = None
        try:
            model.to("cpu")
        except Exception:
            pass
        del model
        gc.collect()
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
        logger.info("ocr unloaded")

    def recognize(self, image: Any) -> str:
        self.load()
        import torch

        inputs = self._processor(
            images=image,
            text=PROMPT,
            max_patches=self._settings.ocr_max_patches,
            return_tensors="pt",
        ).to(self._model.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(torch.bfloat16)
        if "pixel_values_local" in inputs and inputs["pixel_values_local"] is not None:
            inputs["pixel_values_local"] = inputs["pixel_values_local"].to(torch.bfloat16)
        with torch.inference_mode():
            output = self._model.generate(
                **inputs,
                do_sample=False,
                max_new_tokens=self._settings.ocr_max_new_tokens,
                # DeepSeek-OCR loops on noisy pages (stickers, covers); its vLLM recipe bans 30-grams too.
                no_repeat_ngram_size=NO_REPEAT_NGRAM,
            )
        prompt_len = inputs["input_ids"].shape[1]
        return self._processor.decode(output[0, prompt_len:], skip_special_tokens=True).strip()

    def _assert_cached(self) -> None:
        repo_dir = "models--" + self.model_id.replace("/", "--")
        hub = os.environ.get("HUGGINGFACE_HUB_CACHE") or ""
        if not hub:
            hf_home = os.environ.get("HF_HOME") or ""
            hub = str(Path(hf_home) / "hub") if hf_home else ""
        snapshots = Path(hub) / repo_dir / "snapshots" if hub else Path()
        if snapshots.is_dir():
            for snap in snapshots.iterdir():
                if (snap / "config.json").is_file() and any(snap.glob("*.safetensors")):
                    return
        raise RagError(
            f"OCR weights for {self.model_id} are not in HF cache. "
            "Run scripts/download-ocr.ps1; refusing to pull into the user profile.",
            status_code=503,
        )
