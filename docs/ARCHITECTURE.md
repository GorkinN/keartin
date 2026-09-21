# Архитектура

Черновик после **этапа 3** (принят 2026-09-21). Источник: [plan/01-architecture.md](plan/01-architecture.md). Уточняется каждый этап. GPU: [GPU.md](GPU.md). RAG: [RAG.md](RAG.md).

## Принцип

Браузер говорит **только с NestJS**. Python FastAPI — изолированный AI-воркер с эксклюзивным доступом к GPU. Docker — только Qdrant и MinIO (без GPU). Ollama и Flux живут на хосте Windows.

Прямой вызов UI → FastAPI запрещён. Приёмка генерации — curl/httpx к FastAPI. Nest и UI картинку не проксируют.

## Что есть после этапа 3

- Всё из этапов 0–2: health, Ollama text, Flux NF4 + GpuManager, Qdrant в compose.
- FastAPI RAG: `POST /rag/index` (202 + job), `GET /rag/index/{job_id}`, `POST /rag/search`, `DELETE /rag/books/{book_id}`.
- Парсеры PDF/EPUB/FB2/DOCX/TXT, чанкер, `BAAI/bge-m3` на CPU из `HF_HOME`, коллекция Qdrant `library_chunks`.
- `scripts/download-bge-m3.ps1`. Джобы индексации в памяти процесса.

StorageProvider не подключён. Nest и UI генерацию и библиотеку не проксируют. Пайплайн поста — этап 4.

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
- `acquire("llm")` выгружает Flux, если он ещё в памяти. После текста unload Ollama не форсируется.

## Генерация картинки

- `POST /generate/image` — тело `{ "prompt", "width"?, "height"?, "steps"?, "seed"? }`. Ответ: `{ "path", "seed", "width", "height", "steps", "model", "image_base64" }`.
- `POST /generate/image/stream` — SSE: `status` (`unload_llm` | `load_flux` | `generate` | `unload_flux`), `image_progress` (`step`/`total`), `done`, `error`.
- Дефолт: 1024×1024, 28 steps (допустимо 20–28), размер кратен 16.
- `acquire("flux")` всегда выгружает Ollama до загрузки весов.

## GPU

`ai-service/app/gpu/manager.py`: один `asyncio.Lock`. Тенанты `llm` | `flux`. Эмбеды `bge-m3` — CPU, lock для индексации не нужен (этап 3).

Любой вызов Ollama в обход GpuManager — баг. Правило в `.cursorrules`.

Подробности выгрузки и NF4: [GPU.md](GPU.md).

## Кэш Hugging Face

Переменные только из `.env`:

```
HF_HOME=D:/huggingface_cache
HUGGINGFACE_HUB_CACHE=D:/huggingface_cache/hub
TRANSFORMERS_CACHE=D:/huggingface_cache/transformers
```

Загрузка: `ai-service/app/bootstrap.py` при импорте пакета + дублирование в `scripts/start-dev.ps1`. Хардкод пути запрещён. Docker этот диск не монтирует. Flux и `bge-m3`: `local_files_only=True`.

## RAG

- `POST /rag/index` — `{ path, book_id?, source_name? }` → `202`. Poll `GET /rag/index/{job_id}`: `queued | indexing | ready | error`.
- `POST /rag/search` — `{ query, book_ids[], top_k? }` default 10. Пустой `book_ids` — вся коллекция.
- `DELETE /rag/books/{book_id}` — только векторы.
- Payload чанка: `book_id`, `chunk_index`, `source_name`, `lang`, `text`. Cosine 1024.
- Эмбеды на CPU, GpuManager не трогаем. Одна индексная джоба за раз (свой lock, не GPU).
- Скан PDF без текстового слоя → `error` по книге, не падение сервиса.

Подробности: [RAG.md](RAG.md).
