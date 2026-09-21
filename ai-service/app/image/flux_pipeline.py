from __future__ import annotations

import gc
import logging
from collections.abc import Callable
from typing import Any

from app.settings import Settings

logger = logging.getLogger(__name__)

GUIDANCE_SCALE = 3.5


class FluxError(Exception):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


class FluxPipelineHolder:
    """Lazy Flux.1-dev loader. Weights from HF_HOME; VRAM only while generating."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pipe: Any = None

    @property
    def loaded(self) -> bool:
        return self._pipe is not None

    @property
    def model_id(self) -> str:
        return self._settings.flux_model_id

    def load(self) -> None:
        if self._pipe is not None:
            return
        quant = self._settings.flux_quant
        logger.info("loading flux quant=%s model=%s", quant, self._settings.flux_model_id)
        if quant == "gguf":
            self._pipe = self._load_gguf()
        else:
            try:
                self._pipe = self._load_nf4()
            except Exception as exc:
                raise FluxError(
                    f"NF4 Flux load failed: {exc}. "
                    "Set FLUX_QUANT=gguf and FLUX_MODEL_PATH to a GGUF transformer."
                ) from exc
        self._pipe.set_progress_bar_config(disable=True)
        logger.info("flux loaded")

    def unload(self) -> None:
        if self._pipe is None:
            return
        logger.info("unloading flux")
        pipe = self._pipe
        self._pipe = None
        try:
            pipe.to("cpu")
        except Exception:
            pass
        del pipe
        gc.collect()
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
        logger.info("flux unloaded")

    def generate(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        steps: int,
        seed: int,
        on_step: Callable[[int, int], None] | None = None,
    ) -> Any:
        self.load()
        import torch

        generator = torch.Generator("cpu").manual_seed(int(seed) % (2**32))
        kwargs: dict[str, Any] = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_inference_steps": steps,
            "guidance_scale": GUIDANCE_SCALE,
            "max_sequence_length": 512 if width >= 1024 else 256,
            "generator": generator,
        }
        if on_step is not None:

            def callback(pipe: Any, step_index: int, timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
                on_step(int(step_index) + 1, steps)
                return callback_kwargs

            kwargs["callback_on_step_end"] = callback
            kwargs["callback_on_step_end_tensor_inputs"] = ["latents"]

        result = self._pipe(**kwargs)
        return result.images[0]

    def _local_kwargs(self) -> dict[str, Any]:
        import torch

        return {"torch_dtype": torch.bfloat16, "local_files_only": True}

    def _assert_cached(self) -> None:
        import os
        from pathlib import Path

        model_id = self._settings.flux_model_id
        repo_dir = "models--" + model_id.replace("/", "--")
        hub = os.environ.get("HUGGINGFACE_HUB_CACHE") or ""
        if not hub:
            hf_home = os.environ.get("HF_HOME") or ""
            hub = str(Path(hf_home) / "hub") if hf_home else ""
        snapshots = Path(hub) / repo_dir / "snapshots" if hub else Path()
        if snapshots.is_dir():
            for snap in snapshots.iterdir():
                if (snap / "model_index.json").is_file() and (snap / "transformer").is_dir():
                    return
        raise FluxError(
            f"FLUX weights for {model_id} are not in HF cache. "
            "Download into HF_HOME first; refusing to pull into the user profile."
        )

    def _load_nf4(self) -> Any:
        import torch
        from diffusers import FluxPipeline
        from diffusers.quantizers import PipelineQuantizationConfig

        self._assert_cached()
        dtype = torch.bfloat16
        quant = PipelineQuantizationConfig(
            quant_backend="bitsandbytes_4bit",
            quant_kwargs={
                "load_in_4bit": True,
                "bnb_4bit_quant_type": "nf4",
                "bnb_4bit_compute_dtype": dtype,
            },
            components_to_quantize=["transformer", "text_encoder_2"],
        )
        try:
            pipe = FluxPipeline.from_pretrained(
                self._settings.flux_model_id,
                quantization_config=quant,
                **self._local_kwargs(),
            )
        except Exception as exc:
            logger.warning("pipeline NF4 quant failed (%s); trying component-wise", exc)
            pipe = self._load_nf4_components()
        # sequential_cpu_offload + bitsandbytes hits meta-tensor errors on T5.
        _enable_offload(pipe, prefer_sequential=False)
        return pipe

    def _load_nf4_components(self) -> Any:
        import torch
        from diffusers import BitsAndBytesConfig as DiffusersBitsAndBytesConfig
        from diffusers import FluxPipeline, FluxTransformer2DModel
        from transformers import BitsAndBytesConfig as TransformersBitsAndBytesConfig
        from transformers import T5EncoderModel

        self._assert_cached()
        dtype = torch.bfloat16
        local = self._local_kwargs()
        transformer = FluxTransformer2DModel.from_pretrained(
            self._settings.flux_model_id,
            subfolder="transformer",
            quantization_config=DiffusersBitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=dtype,
            ),
            **local,
        )
        text_encoder_2 = T5EncoderModel.from_pretrained(
            self._settings.flux_model_id,
            subfolder="text_encoder_2",
            quantization_config=TransformersBitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=dtype,
            ),
            **local,
        )
        return FluxPipeline.from_pretrained(
            self._settings.flux_model_id,
            transformer=transformer,
            text_encoder_2=text_encoder_2,
            **local,
        )

    def _load_gguf(self) -> Any:
        from pathlib import Path

        import torch
        from diffusers import FluxPipeline, FluxTransformer2DModel, GGUFQuantizationConfig

        path = (self._settings.flux_model_path or "").strip()
        if not path:
            raise FluxError("FLUX_QUANT=gguf requires FLUX_MODEL_PATH", status_code=500)
        if not Path(path).is_file():
            raise FluxError(f"FLUX_MODEL_PATH is not a file: {path}", status_code=500)
        self._assert_cached()
        transformer = FluxTransformer2DModel.from_single_file(
            path,
            quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
            torch_dtype=torch.bfloat16,
        )
        pipe = FluxPipeline.from_pretrained(
            self._settings.flux_model_id,
            transformer=transformer,
            **self._local_kwargs(),
        )
        _enable_offload(pipe, prefer_sequential=False)
        return pipe


def _enable_offload(pipe: Any, *, prefer_sequential: bool = True) -> None:
    if prefer_sequential:
        try:
            pipe.enable_sequential_cpu_offload()
            logger.info("flux offload: sequential_cpu_offload")
            return
        except Exception as exc:
            logger.warning("sequential_cpu_offload failed (%s); trying model_cpu_offload", exc)
        pipe.enable_model_cpu_offload()
        logger.info("flux offload: model_cpu_offload")
        return
    try:
        pipe.enable_model_cpu_offload()
        logger.info("flux offload: model_cpu_offload")
        return
    except Exception as exc:
        logger.warning("model_cpu_offload failed (%s); trying sequential_cpu_offload", exc)
    pipe.enable_sequential_cpu_offload()
    logger.info("flux offload: sequential_cpu_offload")
