"""Qwen-Image-2.1 process. Run with `.venv-qwen` so the FastAPI env stays unchanged.

Stdout is newline-delimited JSON. Logs go to stderr. Hugging Face cache env is
set before diffusers is imported.
"""

from __future__ import annotations

import gc
import json
import sys
from pathlib import Path
from typing import Any


def main() -> None:
    from app.bootstrap import load_runtime_env

    load_runtime_env()
    try:
        job = json.loads(sys.stdin.read() or "{}")
        _assert_this_venv()
        _run(job)
    except Exception as exc:
        _emit({"event": "error", "message": str(exc)})
        raise SystemExit(1) from exc
    finally:
        _release_cuda()


def _run(job: dict[str, Any]) -> None:
    _require_torchvision()
    import torch
    from PIL import Image

    model_id = str(job["model_id"])
    gguf_path = str(job.get("gguf_path") or "")
    _assert_cached(model_id, gguf=bool(gguf_path))
    prompt = str(job["prompt"])
    width = int(job["width"])
    height = int(job["height"])
    steps = int(job["steps"])
    cancel_path = Path(str(job["cancel_path"]))
    images = [Image.open(path) for path in job.get("images") or []]
    mask = job.get("mask")
    if mask:
        images.append(Image.open(str(mask)))
    pipe = _load_pipe(model_id, sequential=False, gguf_path=gguf_path)
    sequential = False
    for spec in job["items"]:
        if _cancelled(cancel_path):
            _emit({"event": "cancelled"})
            return
        index = int(spec["index"])
        seed = int(spec["seed"])
        path = Path(str(spec["path"]))

        def on_step(step: int, total: int, image_index: int = index) -> None:
            _emit({"event": "progress", "index": image_index, "step": step, "total": total})

        try:
            image = _generate(
                pipe,
                prompt=prompt,
                images=[frame.copy() for frame in images],
                width=width,
                height=height,
                steps=steps,
                seed=seed,
                on_step=on_step,
            )
        except RuntimeError as exc:
            if sequential or not _is_oom(exc):
                raise
            _log(f"model cpu offload ran out of memory ({exc}); switching to sequential offload")
            pipe = _reload_sequential(pipe, model_id, gguf_path)
            sequential = True
            image = _generate(
                pipe,
                prompt=prompt,
                images=[frame.copy() for frame in images],
                width=width,
                height=height,
                steps=steps,
                seed=seed,
                on_step=on_step,
            )
        if _cancelled(cancel_path):
            _emit({"event": "cancelled"})
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
        _emit({"event": "image", "index": index, "seed": seed, "path": str(path)})
    _emit({"event": "done"})


def _load_pipe(model_id: str, *, sequential: bool, gguf_path: str = "") -> Any:
    import torch
    from diffusers import QwenImage21Pipeline

    kwargs: dict[str, Any] = {"torch_dtype": torch.bfloat16, "local_files_only": True}
    if gguf_path:
        from diffusers import GGUFQuantizationConfig, QwenImage21Transformer2DModel

        kwargs["transformer"] = QwenImage21Transformer2DModel.from_single_file(
            gguf_path,
            quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
            torch_dtype=torch.bfloat16,
            config=model_id,
            subfolder="transformer",
            local_files_only=True,
        )
        _log(f"qwen transformer: gguf {Path(gguf_path).name}")
    pipe = QwenImage21Pipeline.from_pretrained(model_id, **kwargs)
    pipe.set_progress_bar_config(disable=True)
    if sequential:
        pipe.enable_sequential_cpu_offload()
        _log("qwen offload: sequential_cpu_offload")
    else:
        pipe.enable_model_cpu_offload()
        _log("qwen offload: model_cpu_offload")
    return pipe


def _reload_sequential(pipe: Any, model_id: str, gguf_path: str = "") -> Any:
    import torch

    del pipe
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return _load_pipe(model_id, sequential=True, gguf_path=gguf_path)


def _generate(
    pipe: Any,
    *,
    prompt: str,
    images: list[Any],
    width: int,
    height: int,
    steps: int,
    seed: int,
    on_step: Any,
) -> Any:
    import torch

    from app.image.qwen_prompt import output_resolution

    generator = torch.Generator("cpu").manual_seed(int(seed) % (2**32))
    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "true_cfg_scale": 1.0,
        "output_resolution": output_resolution(width, height),
        "use_kv_cache": True,
        "generator": generator,
    }
    if images:
        kwargs["image"] = images

    def callback(pipe: Any, step_index: int, timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        on_step(int(step_index) + 1, steps)
        return callback_kwargs

    kwargs["callback_on_step_end"] = callback
    kwargs["callback_on_step_end_tensor_inputs"] = ["latents"]
    result = pipe(**kwargs)
    return result.images[0]


def _assert_this_venv() -> None:
    import os

    expected = os.environ.get("QWEN_VENV", "").strip()
    if not expected:
        return
    if Path(sys.prefix).resolve() != Path(expected).resolve():
        raise RuntimeError(f"qwen venv was not activated: {sys.prefix}")


def _require_torchvision() -> None:
    try:
        import torchvision  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("qwen torchvision is missing. Run scripts/setup-qwen-venv.ps1.") from exc


def _release_cuda() -> None:
    try:
        import torch
    except ImportError:
        return
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


def _assert_cached(model_id: str, *, gguf: bool = False) -> None:
    import os

    repo_dir = "models--" + model_id.replace("/", "--")
    hub = os.environ.get("HUGGINGFACE_HUB_CACHE") or ""
    if not hub:
        hf_home = os.environ.get("HF_HOME") or ""
        hub = str(Path(hf_home) / "hub") if hf_home else ""
    snapshots = Path(hub) / repo_dir / "snapshots" if hub else Path()
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            if not (snap / "model_index.json").is_file():
                continue
            if gguf:
                if (snap / "transformer" / "config.json").is_file() and (snap / "text_encoder").is_dir() and (snap / "vae").is_dir():
                    return
            elif (snap / "transformer").is_dir():
                return
    note = " The GGUF file replaces only the transformer." if gguf else ""
    raise RuntimeError(
        f"qwen weights for {model_id} are not in the HF cache.{note} Run scripts/download-qwen-image.ps1."
    )


def _cancelled(path: Path) -> bool:
    try:
        return path.is_file() and path.read_text(encoding="utf-8").strip() == "1"
    except OSError:
        return False


def _is_oom(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "out of memory" in text


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


if __name__ == "__main__":
    main()
