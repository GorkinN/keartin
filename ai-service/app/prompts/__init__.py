from pathlib import Path

_TEXT_SYSTEM = Path(__file__).with_name("text_system.md")


def load_text_system_prompt() -> str:
    return _TEXT_SYSTEM.read_text(encoding="utf-8").strip()


__all__ = ["load_text_system_prompt"]
