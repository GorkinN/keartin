from pathlib import Path

import pytest

from app.image.placement import (
    ACTIVATION_RESERVE_BYTES,
    RAM_BUDGET_BYTES,
    PlacementError,
    llm_memory_options,
    module_target,
)
from app.messages import GENERATION_MEMORY

GIB = 1024**3


def test_denoiser_is_placed_before_the_larger_text_encoder() -> None:
    from app.image.placement import placement_order

    order = placement_order(
        ["text_encoder", "vae", "transformer"],
        {"text_encoder": 16, "vae": 1, "transformer": 4},
    )
    assert order == ["transformer", "vae", "text_encoder"]


def test_qwen_loads_safetensors_without_mmap() -> None:
    root = Path(__file__).resolve().parents[1]
    source = (root / "app" / "image" / "qwen_worker.py").read_text(encoding="utf-8")
    assert "disable_mmap=True" in source
    assert 'subfolder="text_encoder"' in source


def test_module_prefers_gpu_when_it_fits() -> None:
    assert module_target(2 * GIB, gpu_left=8 * GIB, ram_left=RAM_BUDGET_BYTES, staging_room=ACTIVATION_RESERVE_BYTES) == "cuda"


def test_small_overflow_stays_in_ram() -> None:
    assert (
        module_target(
            256 * 1024**2,
            gpu_left=0,
            ram_left=RAM_BUDGET_BYTES,
            staging_room=ACTIVATION_RESERVE_BYTES,
        )
        == "ram"
    )


def test_large_overflow_is_split_across_gpu_and_ram() -> None:
    assert (
        module_target(
            6 * GIB,
            gpu_left=2 * GIB,
            ram_left=RAM_BUDGET_BYTES,
            staging_room=ACTIVATION_RESERVE_BYTES,
        )
        == "split"
    )


def test_module_is_refused_when_it_would_need_disk() -> None:
    assert (
        module_target(
            20 * GIB,
            gpu_left=2 * GIB,
            ram_left=RAM_BUDGET_BYTES,
            staging_room=ACTIVATION_RESERVE_BYTES,
        )
        == "refuse"
    )


def test_llm_stays_on_gpu_without_a_ram_copy() -> None:
    assert llm_memory_options(6 * GIB, 10 * GIB) == {}


def test_llm_overflow_is_locked_in_ram() -> None:
    # 1 GiB of the free VRAM is reserved for the KV cache.
    assert llm_memory_options(8 * GIB, 8 * GIB) == {"use_mmap": False, "use_mlock": True}


def test_llm_refuses_when_overflow_exceeds_12gb() -> None:
    with pytest.raises(PlacementError, match="SSD"):
        llm_memory_options(30 * GIB, 10 * GIB)


def test_unknown_sizes_do_not_mmap_from_disk() -> None:
    assert llm_memory_options(None, None) == {"use_mmap": False, "use_mlock": True}


def test_ram_budget_is_12gb() -> None:
    assert RAM_BUDGET_BYTES == 12 * GIB
    assert "12 ГБ" in GENERATION_MEMORY


def test_generation_code_does_not_offload_to_disk() -> None:
    root = Path(__file__).resolve().parents[1]
    placement = (root / "app" / "image" / "placement.py").read_text(encoding="utf-8")
    flux = (root / "app" / "image" / "flux_pipeline.py").read_text(encoding="utf-8")
    qwen = (root / "app" / "image" / "qwen_worker.py").read_text(encoding="utf-8")
    for source in (placement, flux, qwen):
        assert "offload_folder=" not in source
        assert "offload_dir" not in source
        assert "enable_sequential_cpu_offload" not in source
