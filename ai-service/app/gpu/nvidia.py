from __future__ import annotations

import asyncio
import logging
import subprocess
import time

from app.gpu.errors import GpuError

logger = logging.getLogger(__name__)

# qwen3.5:9b in VRAM is ~6+ GB. Windows idle on this box is often >500 MB,
# so used < GPU_FREE_MB_THRESHOLD may never hold. Below this cutoff the LLM
# (or Flux) is treated as still resident.
LLM_RESIDENT_MB = 4096
POLL_TIMEOUT_S = 30.0
POLL_INTERVAL_S = 1.0


def vram_used_mb() -> int | None:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        return int(float(lines[0]))
    except ValueError:
        return None


async def wait_vram_released(threshold_mb: int, timeout_s: float = POLL_TIMEOUT_S) -> int:
    """Wait until used VRAM looks like idle (no LLM/Flux resident)."""
    deadline = time.monotonic() + timeout_s
    last: int | None = None
    while time.monotonic() < deadline:
        used = vram_used_mb()
        if used is None:
            raise GpuError("nvidia-smi is unavailable")
        last = used
        if used < threshold_mb:
            logger.info("vram idle: %s MB (below threshold %s)", used, threshold_mb)
            return used
        if used < LLM_RESIDENT_MB:
            logger.info(
                "vram idle-band: %s MB (threshold %s, Windows idle often higher)",
                used,
                threshold_mb,
            )
            return used
        await asyncio.sleep(POLL_INTERVAL_S)
    raise GpuError(
        f"VRAM still {last} MB after unload (want < {threshold_mb} or < {LLM_RESIDENT_MB})"
    )
