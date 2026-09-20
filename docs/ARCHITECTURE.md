# Архитектура

Черновик после **этапа 1** (принят 2026-09-20). Источник: [plan/01-architecture.md](plan/01-architecture.md). Уточняется каждый этап.

## Принцип

Браузер говорит **только с NestJS**. Python FastAPI — изолированный AI-воркер с эксклюзивным доступом к GPU. Docker — только Qdrant и MinIO (без GPU). Ollama и Flux живут на хосте Windows.

Прямой вызов UI → FastAPI запрещён. На этапе 1 UI ещё не вызывает генерацию: приёмка — curl к FastAPI.

## Что есть после этапа 1

- Всё из этапа 0: Vite-заглушки, Nest `GET /health`, compose Qdrant+MinIO, stub `GpuManager`, HF-кэш из `.env`.
- FastAPI: `POST /generate/text` (JSON) и `POST /generate/text/stream` (SSE `token` → `done`).
- `ai-service/app/llm/ollama_client.py`: `/api/chat` и `/api/generate`, NDJSON.
- Модель `LLM_MODEL` (дефолт `qwen3.5:9b-16k`), `num_ctx=8192`, `keep_alive` из env или тела запроса.
- Вызовы Ollama только внутри `GpuManager.acquire("llm")` / `release()`. Полной выгрузки через `ollama stop` ещё нет: для проверки достаточно `keep_alive: 0`.

Генерации картинок нет. RAG нет. StorageProvider не подключён. Nest и UI генерацию не проксируют.

## Порты

| Сервис | Порт |
|--------|------|
| Vite | 5173 |
| NestJS | 3000 |
| FastAPI | 8000 |
| Qdrant | 6333 |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| Ollama | 11434 |

## Генерация текста

- `POST /generate/text` — `{ "text", "model" }`. Нужен `prompt` или `topic`.
- `POST /generate/text/stream` — SSE: `event: token` / `data: {"text": "..."}`, затем `event: done` / `data: {"ok": true}`. Ошибка Ollama — `event: error`.
- Системный промпт: `ai-service/app/prompts/text_system.md`.
- Chat с `"think": false` (иначе qwen3.5 льёт reasoning вместо поста).
- `OLLAMA_HOST` в Windows часто равен bind-адресу Ollama (`0.0.0.0`). Settings нормализует это в `http://127.0.0.1:11434`.

## GPU (заготовка)

`ai-service/app/gpu/manager.py`: `acquire(tenant)` / `release()`, in-memory `asyncio.Lock`. Без `ollama stop` и без `nvidia-smi` до этапа 2.

Тенанты позже: `llm` | `flux`. Эмбеды `bge-m3` — CPU, lock для индексации не нужен.

Любой вызов Ollama в обход GpuManager — баг. Правило в `.cursorrules`. Этап 1 держит тенант `llm` на время chat/generate.

## Кэш Hugging Face

Переменные только из `.env`:

```
HF_HOME=D:/huggingface_cache
HUGGINGFACE_HUB_CACHE=D:/huggingface_cache/hub
TRANSFORMERS_CACHE=D:/huggingface_cache/transformers
```

Загрузка: `ai-service/app/bootstrap.py` при импорте пакета + дублирование в `scripts/start-dev.ps1`. Хардкод пути запрещён. Docker этот диск не монтирует.
