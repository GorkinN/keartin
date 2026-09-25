from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        extra="ignore",
    )

    hf_home: str = ""
    huggingface_hub_cache: str = ""
    transformers_cache: str = ""
    ollama_host: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen3.5:9b-16k"
    llm_num_ctx: int = 8192
    llm_keep_alive: str = "5m"
    qdrant_url: str = "http://127.0.0.1:6333"
    qdrant_collection: str = "library_chunks"
    embed_model: str = "BAAI/bge-m3"
    rag_chunk_chars: int = 2400
    rag_chunk_overlap: int = 400
    rag_top_k: int = 10
    rag_embed_batch: int = 8
    gpu_free_mb_threshold: int = 500
    flux_model_id: str = "black-forest-labs/FLUX.1-dev"
    flux_quant: str = "nf4"
    flux_model_path: str = ""
    ocr_model_id: str = "deepseek-community/DeepSeek-OCR-2"
    ocr_dpi: int = 144
    ocr_max_patches: int = 6
    ocr_max_new_tokens: int = 4096

    @field_validator("flux_quant")
    @classmethod
    def normalize_flux_quant(cls, value: str) -> str:
        quant = value.strip().lower() or "nf4"
        if quant not in {"nf4", "gguf"}:
            raise ValueError("FLUX_QUANT must be nf4 or gguf")
        return quant

    @field_validator("ollama_host")
    @classmethod
    def normalize_ollama_host(cls, value: str) -> str:
        """Ollama uses OLLAMA_HOST as a bind address (e.g. 0.0.0.0). Clients need a URL."""
        host = value.strip()
        if not host:
            return "http://127.0.0.1:11434"
        if "://" in host:
            return host.rstrip("/")
        if host in {"0.0.0.0", "::", "[::]"}:
            return "http://127.0.0.1:11434"
        if host.startswith("0.0.0.0:"):
            return f"http://127.0.0.1:{host.split(':', 1)[1]}"
        if ":" not in host.strip("[]"):
            host = f"{host}:11434"
        return f"http://{host}"


def get_settings() -> Settings:
    return Settings()
