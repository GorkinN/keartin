from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from app.rag.errors import RagError
from app.settings import Settings

logger = logging.getLogger(__name__)

VECTOR_DIM = 1024


class Embedder:
    """Lazy CPU loader for BAAI/bge-m3. Weights from HF_HOME only."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model: Any = None

    @property
    def model_id(self) -> str:
        return self._settings.embed_model

    @property
    def dim(self) -> int:
        return VECTOR_DIM

    def load(self) -> None:
        if self._model is not None:
            return
        self._assert_cached()
        from sentence_transformers import SentenceTransformer

        logger.info("loading embedder model=%s device=cpu", self.model_id)
        self._model = SentenceTransformer(
            self.model_id,
            device="cpu",
            local_files_only=True,
        )
        logger.info("embedder loaded")

    def encode(self, texts: list[str]) -> list[list[float]]:
        self.load()
        vectors = self._model.encode(
            texts,
            normalize_embeddings=True,
            batch_size=max(1, self._settings.rag_embed_batch),
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return [row.astype(float).tolist() for row in vectors]

    def _assert_cached(self) -> None:
        model_id = self.model_id
        repo_dir = "models--" + model_id.replace("/", "--")
        hub = os.environ.get("HUGGINGFACE_HUB_CACHE") or ""
        if not hub:
            hf_home = os.environ.get("HF_HOME") or ""
            hub = str(Path(hf_home) / "hub") if hf_home else ""
        snapshots = Path(hub) / repo_dir / "snapshots" if hub else Path()
        if snapshots.is_dir():
            for snap in snapshots.iterdir():
                if not snap.is_dir():
                    continue
                if (snap / "config.json").is_file() and (
                    (snap / "modules.json").is_file()
                    or (snap / "model.safetensors").is_file()
                    or (snap / "pytorch_model.bin").is_file()
                ):
                    return
        raise RagError(
            f"Embedding weights for {model_id} are not in HF cache. "
            "Run scripts/download-bge-m3.ps1; refusing to pull into the user profile.",
            status_code=503,
        )
