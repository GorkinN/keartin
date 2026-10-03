from __future__ import annotations

FLUX_SIDE = (256, 1024)
QWEN_SIDE = (256, 2752)
FLUX_STEPS = (20, 28)
QWEN_STEPS = (20, 50)
FLUX_DEFAULT_STEPS = 28
QWEN_DEFAULT_STEPS = 40
BATCH_FLUX_STEPS = 20
MAX_REFERENCES = 10


def side_bounds(model: str) -> tuple[int, int]:
    if model == "qwen":
        return QWEN_SIDE
    return FLUX_SIDE


def step_bounds(model: str) -> tuple[int, int]:
    if model == "qwen":
        return QWEN_STEPS
    return FLUX_STEPS


def default_steps(model: str, *, batch: bool = False) -> int:
    if model == "qwen":
        return QWEN_DEFAULT_STEPS
    return BATCH_FLUX_STEPS if batch else FLUX_DEFAULT_STEPS


def validate_image_request(
    model: str,
    width: int | None,
    height: int | None,
    steps: int | None,
) -> None:
    if model not in {"flux", "qwen"}:
        raise ValueError("model must be flux or qwen")
    side_min, side_max = side_bounds(model)
    step_min, step_max = step_bounds(model)
    for name, value in (("width", width), ("height", height)):
        if value is None:
            continue
        if value % 16 != 0:
            raise ValueError("width and height must be multiples of 16")
        if value < side_min or value > side_max:
            raise ValueError(f"{name} must be from {side_min} to {side_max}")
    if steps is not None and (steps < step_min or steps > step_max):
        raise ValueError(f"steps must be from {step_min} to {step_max}")
