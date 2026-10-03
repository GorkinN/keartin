from __future__ import annotations

TRANSPARENT_PREFIX = "This is an RGBA image with transparency. "
TRANSPARENT_SUFFIX = " The image has alpha channel and the background is transparent."
MASK_NOTE = " The last image is a mask: change the white areas and keep the black areas."


def output_resolution(width: int, height: int) -> int:
    """Long side. The pipeline resizes references to this area unless it is set."""
    return max(width, height)


def build_qwen_prompt(prompt: str, *, transparent: bool, has_mask: bool) -> str:
    text = prompt.strip()
    if transparent:
        text = f"{TRANSPARENT_PREFIX}{text}{TRANSPARENT_SUFFIX}"
    if has_mask:
        text = f"{text}{MASK_NOTE}"
    return text
