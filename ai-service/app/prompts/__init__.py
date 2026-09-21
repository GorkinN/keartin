from pathlib import Path

_DIR = Path(__file__).parent
_TEXT_SYSTEM = _DIR / "text_system.md"
_POST_RU = _DIR / "post_ru.md"
_IMAGE_PROMPT = _DIR / "image_prompt.md"


def load_text_system_prompt() -> str:
    return _TEXT_SYSTEM.read_text(encoding="utf-8").strip()


def load_post_system_prompt() -> str:
    return _POST_RU.read_text(encoding="utf-8").strip()


def load_image_system_prompt() -> str:
    return _IMAGE_PROMPT.read_text(encoding="utf-8").strip()


__all__ = [
    "load_image_system_prompt",
    "load_post_system_prompt",
    "load_text_system_prompt",
]
