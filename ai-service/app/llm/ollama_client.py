from __future__ import annotations

import json
import threading
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.settings import Settings


class GenerationCancelled(Exception):
    """The pipeline cancel flag fired while Ollama was streaming."""


class OllamaError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class OllamaClient:
    """Ollama HTTP client. Callers must hold GpuManager tenant `llm`."""

    def __init__(self, settings: Settings) -> None:
        self._host = settings.ollama_host.rstrip("/")
        self._model = settings.llm_model
        self._num_ctx = settings.llm_num_ctx
        self._keep_alive = settings.llm_keep_alive

    @property
    def model(self) -> str:
        return self._model

    def _options(self, temperature: float | None) -> dict[str, Any]:
        options: dict[str, Any] = {"num_ctx": self._num_ctx}
        if temperature is not None:
            options["temperature"] = temperature
        return options

    def _resolve_keep_alive(self, keep_alive: str | int | None) -> str | int:
        if keep_alive is None:
            return self._keep_alive
        return keep_alive

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        keep_alive: str | int | None = None,
        stop: threading.Event | None = None,
    ) -> AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": True,
            "keep_alive": self._resolve_keep_alive(keep_alive),
            "options": self._options(temperature),
            "think": False,
        }
        async for chunk in self._ndjson_stream("/api/chat", payload, stop=stop):
            message = chunk.get("message") or {}
            content = message.get("content") or ""
            if content:
                yield content

    async def generate_stream(
        self,
        *,
        prompt: str,
        system: str | None = None,
        temperature: float | None = None,
        keep_alive: str | int | None = None,
    ) -> AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": self._model,
            "prompt": prompt,
            "stream": True,
            "keep_alive": self._resolve_keep_alive(keep_alive),
            "options": self._options(temperature),
            "think": False,
        }
        if system:
            payload["system"] = system
        async for chunk in self._ndjson_stream("/api/generate", payload):
            text = chunk.get("response") or ""
            if text:
                yield text

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        keep_alive: str | int | None = None,
        stop: threading.Event | None = None,
    ) -> str:
        parts: list[str] = []
        async for token in self.chat_stream(
            messages=messages,
            temperature=temperature,
            keep_alive=keep_alive,
            stop=stop,
        ):
            parts.append(token)
        return "".join(parts)

    async def generate(
        self,
        *,
        prompt: str,
        system: str | None = None,
        temperature: float | None = None,
        keep_alive: str | int | None = None,
    ) -> str:
        parts: list[str] = []
        async for token in self.generate_stream(
            prompt=prompt,
            system=system,
            temperature=temperature,
            keep_alive=keep_alive,
        ):
            parts.append(token)
        return "".join(parts)

    async def ps(self) -> list[dict[str, Any]]:
        timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.get(f"{self._host}/api/ps")
        except httpx.HTTPError as exc:
            raise OllamaError(
                f"Ollama is unreachable: {exc}", status_code=503
            ) from exc
        if response.status_code >= 400:
            raise OllamaError(
                _error_message(response.status_code, response.text),
                status_code=_map_status(response.status_code),
            )
        data = response.json()
        models = data.get("models")
        return models if isinstance(models, list) else []

    async def unload_model(self, model: str) -> None:
        """Drop a loaded model from VRAM. Called only from GpuManager."""
        timeout = httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0)
        payload: dict[str, Any] = {
            "model": model,
            "prompt": "",
            "keep_alive": 0,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                response = await client.post(
                    f"{self._host}/api/generate",
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise OllamaError(
                f"Ollama is unreachable: {exc}", status_code=503
            ) from exc
        if response.status_code >= 400:
            raise OllamaError(
                _error_message(response.status_code, response.text),
                status_code=_map_status(response.status_code),
            )

    async def _ndjson_stream(
        self,
        path: str,
        payload: dict[str, Any],
        stop: threading.Event | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        timeout = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)
        url = f"{self._host}{path}"
        try:
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        raise OllamaError(
                            _error_message(response.status_code, body),
                            status_code=_map_status(response.status_code),
                        )
                    async for line in response.aiter_lines():
                        if stop is not None and stop.is_set():
                            raise GenerationCancelled()
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError as exc:
                            raise OllamaError(
                                f"Invalid NDJSON from Ollama: {line[:200]}"
                            ) from exc
                        error = chunk.get("error")
                        if error:
                            raise OllamaError(str(error), status_code=502)
                        yield chunk
        except OllamaError:
            raise
        except httpx.HTTPError as exc:
            raise OllamaError(f"Ollama is unreachable: {exc}", status_code=503) from exc


def _map_status(status_code: int) -> int:
    if status_code == 404:
        return 404
    if status_code in {401, 403}:
        return status_code
    return 502


def _error_message(status_code: int, body: str) -> str:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("error"):
        return str(parsed["error"])
    text = body.strip() or f"Ollama HTTP {status_code}"
    return text[:500]
