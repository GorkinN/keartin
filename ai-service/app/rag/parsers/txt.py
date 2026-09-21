from __future__ import annotations

from pathlib import Path

from charset_normalizer import from_path

from app.rag.errors import RagError


def parse_txt(path: Path) -> str:
    result = from_path(str(path)).best()
    if result is None:
        raise RagError(f"Could not decode text file: {path.name}", status_code=400)
    return str(result)
