import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.image.qwen_runner import QwenError, QwenRunner, ensure_data_file, gguf_label, resolve_qwen_gguf
from app.settings import Settings


def test_importing_the_worker_does_not_import_diffusers() -> None:
    root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root)
    result = subprocess.run(
        [sys.executable, "-c", "import app.image.qwen_worker, sys; raise SystemExit('diffusers' in sys.modules)"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_missing_python_is_reported(tmp_path) -> None:
    runner = QwenRunner(Settings(qwen_python=str(tmp_path / "missing-python.exe")))
    with pytest.raises(QwenError, match="qwen python is missing"):
        runner.run(
            prompt="fox",
            width=1024,
            height=1024,
            steps=20,
            items=[{"index": 0, "seed": 1, "path": str(tmp_path / "out.png")}],
            image_paths=[],
            mask_path=None,
            transparent=False,
            cancel_path=tmp_path / "cancel",
        )


def test_gguf_choice_is_a_filename(tmp_path) -> None:
    first = tmp_path / "qwen-image-2.1-UC-Q4_K_M.gguf"
    second = tmp_path / "qwen-image-2.1-Q8_0.gguf"
    first.write_bytes(b"a")
    second.write_bytes(b"b")
    settings = Settings(
        qwen_model_path=str(first),
        qwen_model_paths=str(second),
    )
    assert gguf_label(first.name) == "Q4_K_M · uncensored"
    assert gguf_label(second.name) == "Q8_0"
    assert resolve_qwen_gguf(settings, "") == str(first)
    assert resolve_qwen_gguf(settings, second.name) == str(second)
    with pytest.raises(QwenError, match="not configured"):
        resolve_qwen_gguf(settings, "other.gguf")
    with pytest.raises(QwenError, match="not configured"):
        resolve_qwen_gguf(Settings(qwen_model_path="", qwen_model_paths=""), "other.gguf")


def test_paths_must_stay_under_data(tmp_path) -> None:
    with pytest.raises(QwenError, match="outside data"):
        ensure_data_file(str(tmp_path / "ref.png"))
