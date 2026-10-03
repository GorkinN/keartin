"""Place generation weights on the GPU first, then in at most 12 GiB of RAM.

Disk offload is intentionally unsupported: accelerate would page layers through
an offload folder on the SSD, and Windows shared-GPU fallback can do the same
via the page file. Callers must not pass ``offload_folder``.
"""

from __future__ import annotations

import logging
from typing import Any

from app.messages import GENERATION_MEMORY, GENERATION_NO_CUDA

logger = logging.getLogger(__name__)

RAM_BUDGET_BYTES = 12 * 1024**3
# Left free on the GPU for activations. Not a place to store weights.
ACTIVATION_RESERVE_BYTES = 1024**3
# KV cache for the text model, so weight layers are not packed into that space.
LLM_KV_RESERVE_BYTES = 1024**3


class PlacementError(Exception):
    """Weights do not fit in dedicated VRAM plus the 12 GiB RAM budget."""


def placement_order(names: list[str], sizes: dict[str, int]) -> list[str]:
    """Denoiser and VAE take the GPU before larger encoders.

    A text encoder is often the biggest module and runs once. Putting it on the
    GPU first leaves the transformer mmap'd on disk for every diffusion step.
    """
    return sorted(names, key=lambda name: (_component_rank(name), -sizes.get(name, 0)))


def _component_rank(name: str) -> int:
    if name in {"transformer", "unet", "vae"} or name.startswith("transformer"):
        return 0
    return 1


def module_target(
    size: int,
    gpu_left: int,
    ram_left: int,
    *,
    staging_room: int,
) -> str:
    """Where one whole component should live: cuda, ram, split, or refuse.

    ``cuda`` keeps it on the GPU. ``ram`` keeps it in the RAM budget and stages
    it onto the GPU only while it runs (it must fit in the free staging room).
    ``split`` spreads its layers across the GPU and the remaining RAM budget.
    ``refuse`` means the only other accelerate option would be disk.
    """
    if size <= gpu_left:
        return "cuda"
    if size <= ram_left and size <= staging_room:
        return "ram"
    if size <= max(0, gpu_left) + max(0, ram_left):
        return "split"
    return "refuse"


def llm_memory_options(
    model_bytes: int | None,
    free_vram_bytes: int | None,
) -> dict[str, bool]:
    """Ollama options so token generation does not read weights from the SSD.

    Layers stay on the GPU when they fit. A high ``num_gpu`` is not set: on
    Windows that spills into shared GPU memory, which the driver can page out.
    When some layers cannot stay in VRAM, mmap is disabled and the pages are
    locked so the overflow stays in RAM, up to 12 GiB.
    """
    if model_bytes is None or free_vram_bytes is None:
        return {"use_mmap": False, "use_mlock": True}
    gpu_budget = max(0, free_vram_bytes - LLM_KV_RESERVE_BYTES)
    if model_bytes <= gpu_budget:
        return {}
    if model_bytes - gpu_budget > RAM_BUDGET_BYTES:
        raise PlacementError(GENERATION_MEMORY)
    return {"use_mmap": False, "use_mlock": True}


def is_cuda_oom(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "out of memory" in text


def place_pipeline(pipe: Any, *, prefer_full_gpu: bool = True) -> str:
    """Return ``cuda``, ``ram``, or ``split``. Never offloads weights to disk."""
    import torch

    if not torch.cuda.is_available():
        raise PlacementError(GENERATION_NO_CUDA)

    modules = _components(pipe)
    if not modules:
        raise PlacementError(GENERATION_MEMORY)

    available = _limit_process_to_dedicated_vram()
    # After a CUDA OOM the weights did not leave enough room for activations.
    reserve = ACTIVATION_RESERVE_BYTES if prefer_full_gpu else 4 * ACTIVATION_RESERVE_BYTES
    capacity = max(0, available - reserve)
    sizes = {name: _module_bytes(module) for name, module in modules.items()}
    total = sum(sizes.values())
    largest = max(sizes.values())
    bnb = any(_is_bnb(module) for module in modules.values())
    logger.info(
        "generation weights %d MiB, dedicated budget %d MiB, ram cap %d MiB",
        total // (1024**2),
        capacity // (1024**2),
        RAM_BUDGET_BYTES // (1024**2),
    )

    if prefer_full_gpu and total <= capacity:
        pipe.to("cuda")
        logger.info("generation placement: cuda")
        return "cuda"

    park_in_ram = total <= RAM_BUDGET_BYTES and largest <= capacity and (bnb or not prefer_full_gpu)
    if park_in_ram:
        # One component on the GPU at a time. Weights stay in RAM, not on disk.
        # bitsandbytes NF4 cannot be layer-split (meta-tensor errors on T5).
        pipe.enable_model_cpu_offload()
        _copy_cpu_weights(modules)
        logger.info("generation placement: ram")
        return "ram"

    if bnb:
        raise PlacementError(GENERATION_MEMORY)

    mode = _spread_across_gpu_and_ram(pipe, modules, sizes, capacity)
    logger.info("generation placement: %s", mode)
    return mode


def _spread_across_gpu_and_ram(
    pipe: Any,
    modules: dict[str, Any],
    sizes: dict[str, int],
    capacity: int,
) -> str:
    """Largest components take the GPU. The rest may use the 12 GiB RAM cap."""
    gpu_left = capacity
    ram_left = RAM_BUDGET_BYTES
    targets: dict[str, str] = {}

    def _park_ram_weights(_module: Any, args: tuple[Any, ...]) -> tuple[Any, ...]:
        park_staged_weights(pipe)
        return args

    for name in placement_order(list(modules), sizes):
        module = modules[name]
        size = sizes[name]
        target = module_target(
            size,
            gpu_left,
            ram_left,
            staging_room=ACTIVATION_RESERVE_BYTES,
        )
        if target == "refuse" or (target == "split" and _is_bnb(module)):
            raise PlacementError(GENERATION_MEMORY)
        targets[name] = target
        if target == "cuda":
            module.to("cuda")
            # Registered before any accelerate hook so RAM weights leave the GPU first.
            module.register_forward_pre_hook(_park_ram_weights)
            gpu_left -= size
            logger.info("generation %s on GPU (%d MiB)", name, size // (1024**2))
            continue
        if target == "ram":
            ram_left -= size
            logger.info("generation %s in RAM (%d MiB)", name, size // (1024**2))
            continue
        module.register_forward_pre_hook(_park_ram_weights)
        gpu_used, cpu_used, _hole = _dispatch_layers(module, gpu_left, ram_left)
        if gpu_used > gpu_left or cpu_used > ram_left:
            raise PlacementError(GENERATION_MEMORY)
        gpu_left -= gpu_used
        ram_left -= cpu_used
        logger.info(
            "generation %s split GPU %d MiB RAM %d MiB",
            name,
            gpu_used // (1024**2),
            cpu_used // (1024**2),
        )

    if targets and all(target == "cuda" for target in targets.values()):
        return "cuda"
    if targets and all(target == "ram" for target in targets.values()):
        pipe.enable_model_cpu_offload()
        _copy_cpu_weights(modules)
        return "ram"

    # Hooks follow pipeline order so a component returns to RAM before the next one runs.
    ram_hooks: list[Any] = []
    prev_hook: Any = None
    for name in _cpu_order(pipe, list(modules)):
        if targets.get(name) != "ram":
            continue
        prev_hook = _stage_from_ram(modules[name], prev_hook)
        ram_hooks.append(prev_hook)
    pipe._ram_offload_hooks = ram_hooks
    _copy_cpu_weights(modules)
    return "split"


def park_staged_weights(pipe: Any) -> None:
    """Move RAM-staged components back off the GPU. No disk writes."""
    for hook in getattr(pipe, "_ram_offload_hooks", ()) or ():
        hook.offload()


def memory_report(pipe: Any) -> str:
    """Resident weight sizes after placement, for the worker log."""
    parts: list[str] = []
    for name, module in _components(pipe).items():
        gpu = 0
        cpu = 0
        for tensor in list(module.parameters()) + list(module.buffers()):
            size = _tensor_bytes(tensor)
            if getattr(getattr(tensor, "device", None), "type", "") == "cuda":
                gpu += size
            else:
                cpu += size
        parts.append(f"{name} gpu={gpu // (1024**2)}MiB cpu={cpu // (1024**2)}MiB")
    return ", ".join(parts)


def _copy_cpu_weights(modules: dict[str, Any]) -> None:
    """Copy CPU weights out of a safetensors or GGUF file mapping.

    A mmap'd weight reports almost no RAM and is read from the SSD on every
    layer. ``clone`` makes an ordinary allocation, then the file mapping can close.
    """
    for module in modules.values():
        for param in module.parameters():
            if param.device.type != "cpu":
                continue
            param.data = param.data.detach().contiguous().clone()
        for buffer in module.buffers():
            if buffer.device.type != "cpu":
                continue
            buffer.data = buffer.detach().contiguous().clone()


def _keep_overflow_in_ram(module: Any, device_map: dict[str, Any], ram_bytes: int) -> dict[str, Any]:
    if not any(str(device) == "disk" for device in device_map.values()):
        return device_map
    from accelerate.utils import compute_module_sizes

    sizes = compute_module_sizes(module)
    cpu_bytes = 0
    rewritten: dict[str, Any] = {}
    for name, device in device_map.items():
        if str(device) == "disk":
            if name not in sizes:
                raise PlacementError(GENERATION_MEMORY)
            rewritten[name] = "cpu"
            cpu_bytes += int(sizes[name])
        else:
            rewritten[name] = device
            if str(device) == "cpu":
                cpu_bytes += int(sizes.get(name, 0))
    if cpu_bytes > ram_bytes:
        raise PlacementError(GENERATION_MEMORY)
    logger.info("generation moved disk overflow into RAM (%d MiB)", cpu_bytes // (1024**2))
    return rewritten


def _stage_from_ram(module: Any, prev_hook: Any) -> Any:
    import torch
    from accelerate import cpu_offload_with_hook

    _model, hook = cpu_offload_with_hook(
        module,
        torch.device("cuda:0"),
        prev_module_hook=prev_hook,
    )
    return hook


def _dispatch_layers(module: Any, gpu_bytes: int, ram_bytes: int) -> tuple[int, int, int]:
    from accelerate import dispatch_model, infer_auto_device_map

    if gpu_bytes <= 0 or ram_bytes <= 0:
        raise PlacementError(GENERATION_MEMORY)
    device_map = infer_auto_device_map(
        module,
        max_memory={0: gpu_bytes, "cpu": ram_bytes},
        no_split_module_classes=_no_split_names(module),
    )
    device_map = _keep_overflow_in_ram(module, device_map, ram_bytes)
    try:
        dispatch_model(module, device_map=device_map)
    except (ValueError, RuntimeError) as exc:
        if "disk" in str(exc).lower() or "offload" in str(exc).lower():
            raise PlacementError(GENERATION_MEMORY) from exc
        raise
    return _budget_usage(module, device_map)


def _budget_usage(module: Any, device_map: dict[str, Any]) -> tuple[int, int, int]:
    from accelerate.utils import compute_module_sizes

    sizes = compute_module_sizes(module)
    gpu_used = 0
    cpu_used = 0
    hole = 0
    for name, device in device_map.items():
        nbytes = int(sizes.get(name, 0))
        if str(device) == "cpu":
            cpu_used += nbytes
            hole = max(hole, nbytes)
        elif str(device) == "disk":
            raise PlacementError(GENERATION_MEMORY)
        else:
            gpu_used += nbytes
    return gpu_used, cpu_used, hole


def release_vram_cap() -> None:
    """Drop the per-process cap after generation so the next tenant can use VRAM."""
    import torch

    if torch.cuda.is_available():
        torch.cuda.set_per_process_memory_fraction(1.0)


def _limit_process_to_dedicated_vram() -> int:
    """Cap this process at free dedicated VRAM so WDDM cannot page the rest."""
    import torch

    free, total = torch.cuda.mem_get_info()
    reserved = int(torch.cuda.memory_reserved())
    available = min(int(total), int(free) + reserved)
    if total:
        fraction = min(1.0, max(0.05, available / int(total)))
        torch.cuda.set_per_process_memory_fraction(float(fraction))
    return available


def _components(pipe: Any) -> dict[str, Any]:
    import torch

    components = getattr(pipe, "components", {}) or {}
    return {
        name: module
        for name, module in components.items()
        if isinstance(module, torch.nn.Module)
    }


def _cpu_order(pipe: Any, names: list[str]) -> list[str]:
    raw = getattr(pipe, "model_cpu_offload_seq", None) or ""
    seq = [part.strip() for part in str(raw).split("->") if part.strip()]
    ordered = [name for name in seq if name in names]
    ordered.extend(name for name in names if name not in ordered)
    return ordered


def _module_bytes(module: Any) -> int:
    seen: set[int] = set()
    total = 0
    tensors = list(module.parameters()) + list(module.buffers())
    for tensor in tensors:
        ptr = tensor.data_ptr() if hasattr(tensor, "data_ptr") else 0
        if ptr:
            if ptr in seen:
                continue
            seen.add(ptr)
        total += _tensor_bytes(tensor)
    return total


def _tensor_bytes(tensor: Any) -> int:
    nbytes = getattr(tensor, "nbytes", None)
    if isinstance(nbytes, int) and nbytes > 0:
        return nbytes
    numel = getattr(tensor, "numel", None)
    if not callable(numel):
        return 0
    element_size = getattr(tensor, "element_size", lambda: 1)
    return int(numel()) * int(element_size())


def _is_bnb(module: Any) -> bool:
    for tensor in module.parameters():
        if type(tensor).__name__ in {"Params4bit", "Int8Params"}:
            return True
    return bool(getattr(module, "is_loaded_in_4bit", False) or getattr(module, "is_loaded_in_8bit", False))


def _no_split_names(module: Any) -> list[str]:
    names: set[str] = set()
    for child in module.modules():
        if child is module:
            continue
        name = child.__class__.__name__
        if name.endswith("Block"):
            names.add(name)
    return sorted(names)
