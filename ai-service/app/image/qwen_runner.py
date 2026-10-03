from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.bootstrap import repo_root
from app.image.flux_pipeline import FluxError
from app.image.qwen_prompt import build_qwen_prompt
from app.settings import Settings

logger = logging.getLogger(__name__)


class QwenError(FluxError):
    pass


def qwen_python_path(settings: Settings) -> Path:
    raw = (settings.qwen_python or "").strip()
    if raw:
        return Path(raw)
    return repo_root() / "ai-service" / ".venv-qwen" / "Scripts" / "python.exe"


def qwen_python_ready(settings: Settings) -> bool:
    return qwen_python_path(settings).is_file()


def qwen_gguf_entries(settings: Settings) -> list[tuple[str, Path]]:
    """Configured transformer files. The id is the file name, never a client path."""
    raw: list[str] = []
    primary = (settings.qwen_model_path or "").strip()
    if primary:
        raw.append(primary)
    extra = (settings.qwen_model_paths or "").strip()
    if extra:
        raw.extend(part.strip() for part in extra.split(";") if part.strip())
    seen: set[str] = set()
    entries: list[tuple[str, Path]] = []
    for item in raw:
        path = Path(item)
        key = path.name.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        entries.append((path.name, path))
    return entries


def gguf_label(filename: str) -> str:
    stem = Path(filename).stem
    upper = stem.upper()
    quant = ""
    for token in ("Q8_0", "Q6_K", "Q5_K_M", "Q5_0", "Q4_K_M", "Q4_0", "Q3_K", "Q2_K", "BF16", "FP8"):
        if token in upper:
            quant = token
            break
    uncensored = "-UC-" in upper or upper.endswith("-UC") or any(part == "UC" for part in upper.split("-"))
    if quant and uncensored:
        return f"{quant} · uncensored"
    if quant:
        return quant
    return stem


def resolve_qwen_gguf(settings: Settings, name: str | None) -> str:
    entries = qwen_gguf_entries(settings)
    wanted = (name or "").strip()
    if not entries:
        if wanted:
            raise QwenError(f"qwen gguf is not configured: {wanted}")
        return ""
    if not wanted:
        path = entries[0][1]
    else:
        path = next((item for file_name, item in entries if file_name == wanted), None)
        if path is None:
            raise QwenError(f"qwen gguf is not configured: {wanted}")
    if not path.is_file():
        raise QwenError(f"qwen gguf file is missing: {path.name}")
    return str(path)


class QwenRunner:
    """Runs Qwen-Image-2.1 in `.venv-qwen`. This process does not import diffusers."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.running = False

    def run(
        self,
        *,
        prompt: str,
        width: int,
        height: int,
        steps: int,
        items: list[dict[str, Any]],
        image_paths: list[str],
        mask_path: str | None,
        transparent: bool,
        cancel_path: Path,
        on_progress: Callable[[int, int, int], None] | None = None,
        on_image: Callable[[int, int, str], None] | None = None,
        gguf: str | None = None,
        stop: threading.Event | None = None,
    ) -> str:
        python = qwen_python_path(self._settings)
        if not python.is_file():
            raise QwenError("qwen python is missing. Run scripts/setup-qwen-venv.ps1.")
        images = [ensure_data_file(path) for path in image_paths]
        mask = ensure_data_file(mask_path) if mask_path else None
        if mask and not images:
            raise QwenError("mask requires a reference image")
        if len(images) + (1 if mask else 0) > 10:
            raise QwenError("at most 10 condition images, including the mask")
        for item in items:
            ensure_data_parent(str(item["path"]))
        gguf_path = resolve_qwen_gguf(self._settings, gguf)
        payload = {
            "model_id": self._settings.qwen_image_model_id,
            "gguf_path": gguf_path,
            "prompt": build_qwen_prompt(prompt, transparent=transparent, has_mask=mask is not None),
            "width": width,
            "height": height,
            "steps": steps,
            "images": images,
            "mask": mask,
            "cancel_path": str(cancel_path),
            "items": items,
        }
        cancel_path.parent.mkdir(parents=True, exist_ok=True)
        cancel_path.write_text("", encoding="utf-8")
        watcher = _CancelWatcher(stop, cancel_path)
        watcher.start()
        env = os.environ.copy()
        for key in ("HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE"):
            value = getattr(self._settings, key.lower(), "") or env.get(key, "")
            if value:
                env[key] = value
        env["PYTHONPATH"] = str(repo_root() / "ai-service")
        self.running = True
        stderr_tail: list[str] = []
        try:
            process = subprocess.Popen(
                [str(python), "-m", "app.image.qwen_worker"],
                cwd=str(repo_root() / "ai-service"),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            assert process.stdin is not None
            assert process.stdout is not None
            assert process.stderr is not None
            drain = threading.Thread(target=_collect_stderr, args=(process.stderr, stderr_tail), daemon=True)
            drain.start()
            process.stdin.write(json.dumps(payload).encode("utf-8"))
            process.stdin.close()
            status = "done"
            for raw in process.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise QwenError("qwen worker sent a broken event") from exc
                kind = event.get("event")
                if kind == "progress" and on_progress is not None:
                    on_progress(int(event["index"]), int(event["step"]), int(event["total"]))
                elif kind == "image" and on_image is not None:
                    on_image(int(event["index"]), int(event["seed"]), str(event["path"]))
                elif kind == "cancelled":
                    status = "cancelled"
                elif kind == "error":
                    raise QwenError(str(event.get("message") or "qwen worker failed"))
                elif kind == "done":
                    status = "done"
            code = process.wait()
            drain.join(timeout=2)
            if status == "cancelled":
                return "cancelled"
            if code != 0:
                detail = stderr_tail[-1] if stderr_tail else f"exit {code}"
                raise QwenError(f"qwen worker failed: {detail}")
            return status
        finally:
            watcher.stop()
            self.running = False


def ensure_data_file(path: str) -> str:
    resolved = _under_data(path)
    if not resolved.is_file():
        raise QwenError(f"image file is missing: {resolved.name}")
    return str(resolved)


def ensure_data_parent(path: str) -> str:
    resolved = _under_data(path)
    return str(resolved)


def _under_data(path: str) -> Path:
    root = (repo_root() / "data").resolve()
    resolved = Path(path).resolve()
    if resolved != root and root not in resolved.parents:
        raise QwenError("image path is outside data/")
    return resolved


class _CancelWatcher:
    def __init__(self, stop: threading.Event | None, path: Path) -> None:
        self._stop = stop
        self._path = path
        self._thread: threading.Thread | None = None
        self._done = threading.Event()

    def start(self) -> None:
        if self._stop is None:
            return
        self._thread = threading.Thread(target=self._watch, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
        if self._thread is not None:
            self._thread.join(timeout=1)

    def _watch(self) -> None:
        assert self._stop is not None
        while not self._done.is_set():
            if self._stop.is_set():
                self._path.write_text("1", encoding="utf-8")
                return
            self._done.wait(0.2)


def _collect_stderr(pipe: Any, tail: list[str]) -> None:
    for raw in pipe:
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        logger.info("qwen worker: %s", text)
        tail.append(text)
        if len(tail) > 20:
            del tail[0]
