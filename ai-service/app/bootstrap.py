from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

HF_ENV_KEYS = ("HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_runtime_env() -> Path:
    """Load root .env and pin HF cache vars before any Hugging Face import."""
    root = repo_root()
    load_dotenv(root / ".env", override=False)
    for key in HF_ENV_KEYS:
        value = os.getenv(key)
        if value:
            os.environ[key] = value
    return root
