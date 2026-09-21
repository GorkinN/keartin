from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.gpu.errors import GpuError
from app.gpu.nvidia import POLL_INTERVAL_S, POLL_TIMEOUT_S
from app.llm.ollama_client import OllamaClient, OllamaError

logger = logging.getLogger(__name__)


def model_names(models: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for item in models:
        name = item.get("name") or item.get("model")
        if name:
            names.append(str(name))
    return names


async def loaded_names(client: OllamaClient) -> list[str]:
    try:
        return model_names(await client.ps())
    except OllamaError:
        return []


async def _cli_stop(name: str) -> None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama",
            "stop",
            name,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError:
        logger.warning("ollama CLI not on PATH; skip stop %s", name)
        return
    try:
        await asyncio.wait_for(proc.wait(), timeout=15)
    except TimeoutError:
        proc.kill()
        await proc.wait()


async def unload_ollama(client: OllamaClient, timeout_s: float = POLL_TIMEOUT_S) -> None:
    names = await loaded_names(client)
    if not names:
        logger.info("ollama ps already empty")
        return

    logger.info("unloading ollama models: %s", names)
    for name in names:
        try:
            await client.unload_model(name)
        except OllamaError as exc:
            logger.warning("keep_alive 0 failed for %s: %s", name, exc)

    names = await loaded_names(client)
    if names:
        logger.info("ollama stop fallback for: %s", names)
        for name in names:
            await _cli_stop(name)

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        names = await loaded_names(client)
        if not names:
            logger.info("ollama unloaded")
            return
        for name in names:
            try:
                await client.unload_model(name)
            except OllamaError:
                pass
            await _cli_stop(name)
        await asyncio.sleep(POLL_INTERVAL_S)

    raise GpuError(f"Ollama still loaded after unload: {names}")
