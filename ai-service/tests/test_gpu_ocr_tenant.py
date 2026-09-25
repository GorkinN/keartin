from __future__ import annotations

import asyncio

import pytest

from app.gpu import manager as manager_module
from app.gpu.manager import GpuManager
from app.settings import Settings


class FakeHolder:
    def __init__(self, loaded: bool) -> None:
        self._loaded = loaded
        self.unloads = 0

    @property
    def loaded(self) -> bool:
        return self._loaded

    def unload(self) -> None:
        self._loaded = False
        self.unloads += 1


@pytest.fixture
def ollama_unloads(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls: list[int] = []

    async def fake_unload(client: object) -> None:
        calls.append(1)

    async def fake_wait(threshold: int) -> None:
        return None

    monkeypatch.setattr(manager_module, "unload_ollama", fake_unload)
    monkeypatch.setattr(manager_module, "wait_vram_released", fake_wait)
    return calls


def test_ocr_tenant_evicts_flux_and_llm_then_unloads_itself(ollama_unloads: list[int]) -> None:
    gpu = GpuManager(Settings())
    flux = FakeHolder(loaded=True)
    ocr = FakeHolder(loaded=False)
    gpu.attach_flux(flux)
    gpu.attach_ocr(ocr)

    async def scenario() -> None:
        await gpu.acquire("ocr")
        assert gpu.tenant == "ocr"
        assert flux.unloads == 1
        assert ollama_unloads == [1]
        ocr._loaded = True
        await gpu.release()

    asyncio.run(scenario())
    assert ocr.unloads == 1
    assert gpu.tenant is None
    assert not gpu.locked


def test_llm_tenant_evicts_ocr(ollama_unloads: list[int]) -> None:
    gpu = GpuManager(Settings())
    ocr = FakeHolder(loaded=True)
    gpu.attach_ocr(ocr)

    async def scenario() -> None:
        await gpu.acquire("llm")
        await gpu.release()

    asyncio.run(scenario())
    assert ocr.unloads == 1
    assert ollama_unloads == []
