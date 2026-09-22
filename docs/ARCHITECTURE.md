# Архитектура

После **этапа 5** (код 2026-09-22, приёмка не закрыта). Источник: [plan/01-architecture.md](plan/01-architecture.md). Уточняется каждый этап. GPU: [GPU.md](GPU.md). RAG: [RAG.md](RAG.md).

## Принцип

Браузер говорит **только с NestJS**. Python FastAPI — изолированный AI-воркер с эксклюзивным доступом к GPU. Docker — только Qdrant и MinIO (без GPU). Ollama и Flux живут на хосте Windows.

Прямой вызов UI → FastAPI запрещён. Продуктовый цикл — REST/SSE Nest `:3000`. FastAPI остаётся внутренним воркером.

## Что есть после этапа 5

- Всё из этапов 0–4: health, Ollama text, Flux NF4 + GpuManager, Qdrant, RAG, pipeline.
- Nest: SQLite (Prisma), библиотека, пресеты, посты, джобы генерации, StorageProvider `fs|s3`.
- UI по-прежнему заглушки и в FastAPI не ходит. Авторизации и редактора поста нет.

Временные файлы пайплайна Python: `data/tmp/pipeline/<job_id>/`. Продуктовые файлы пишет Nest.

## Nest API

Префикса `/api` нет. JSON camelCase. `sources[]` в БД и `meta.json` тоже camelCase; в SSE остаются поля Python (`book_id`, `chunk_index`, `source_name`).

Книга: `indexing | ready | error`. Джоба: `running | succeeded | failed`. Пост: `draft | ready | failed`. После рестарта Nest висящие джобы → `failed` («прервано перезапуском»), книги в `indexing` → `error`. Черновик поста при этом тоже `failed`.

| Метод | Путь | Ответ |
|--------|------|--------|
| `POST` | `/library/books` | multipart поле `file` (pdf, epub, fb2, docx, txt, до 200 МБ). `202` и книга, статус `indexing`. Nest копирует файл в storage и только потом вызывает `POST /rag/index` с тем же `book_id`. |
| `GET` | `/library/books`, `/library/books/:id` | список / одна. Прогресс чанков Nest пишет сам, опрашивая Python |
| `POST` | `/library/books/:id/reindex` | `202`. Пока статус `indexing` — `409` |
| `DELETE` | `/library/books/:id` | векторы через Python, затем storage. Посты не удаляются. `indexing` → `409`. Python недоступен → `502`, книга остаётся |
| `GET/POST/PATCH/DELETE` | `/presets` | `name`, `description`, `examples` (до 5). Удаление пресета обнуляет `presetId` у постов |
| `GET` | `/posts`, `/posts/:id` | список и карточка, новые сверху |
| `DELETE` | `/posts/:id` | БД и папка. Во время генерации этого поста — `409` |
| `POST` | `/posts/:id/open-folder` | `explorer.exe` только при `STORAGE_DRIVER=fs` и Windows. Иначе `400` |
| `POST` | `/generate/posts` | `202 { jobId, postId }`. Тело: `topic`, `tone`, `length` S/M/L, `emoji`, `knowledgeMode`, `citations`, `structure`, `bookIds`, `topK`, `presetId`, `temperature`, `width`, `height`, `steps`, `seed` |
| `GET` | `/generate/posts/:id/events` | SSE, события Python как есть |
| `POST` | `/posts/:id/regenerate-text` | новый job, тот же URL событий. Перезаписывает `post.md` / `post.txt`, картинку не трогает |
| `POST` | `/posts/:id/regenerate-image` | то же для `image.png`, `image_prompt.txt` и seed. Seed в Python не передаётся, чтобы картинка была новой |

`rag` без книг или с книгой не в `ready` — `409` до вызова Python. Неизвестный пресет или книга — `404`. FastAPI недоступен до старта — `502`, строка поста не создаётся. «Недостаточно контекста», Ollama и GPU приходят событием `error`, джоба `failed`. Параллельный generate ждёт lock в Python; отдельный `409` на занятый GPU — этап 7.

Успешный SSE сам записывает пост. `post.md` и `post.txt` — один текст. Папка `data/posts/YYYY-MM-DD_slug/` (транслит темы, при коллизии `-2`). Ключи в SQLite относительные (`posts/.../image.png`), одни и те же для fs и s3. `meta.json` дублирует поля поста. `models.llm` / `models.flux` берутся из `LLM_MODEL` и `FLUX_MODEL_ID`.

`STORAGE_DRIVER=fs` (дефолт) пишет в `data/`. `s3` — бакет `S3_BUCKET` (дефолт `library`) на `MINIO_ENDPOINT`, path-style, ключи те же. Перед индексацией при s3 Nest кладёт файл в `data/tmp/index/<bookId>/`: Python принимает только локальный путь.

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

## Pipeline поста

Один SSE на FastAPI. Ollama только под `acquire("llm")`, Flux только под `acquire("flux")`. `acquire("flux")` выгружает Ollama до загрузки весов. Между release LLM и acquire Flux второй запрос ждёт тот же lock.

- `POST /pipeline/stream` — retrieve (если не `general`) → стрим русского текста → английский image prompt той же LLM (`think: false`) → `gpu_unload_llm` → Flux → файлы джобы.
- `POST /pipeline/text/stream` — тот же текст без Flux. Пишет только `post.txt`.
- `POST /pipeline/image/stream` — `{ "text" }` → image prompt → Flux. `post.txt` не пишет и не меняет.

Тело поста: `topic`, `tone` (пусто → «живой, разговорный»), `length` `S|M|L` (около 500 / 1200 / 2500 символов), `emoji` default false, `knowledge_mode` default `rag`, `citations` default false, `structure` `{hooks, body, cta}` default все true, `book_ids`, `top_k` default 10 (1–20), `preset` `{description, examples}` до 5 примеров. Картинка: `width` / `height` / `steps` / `seed`, дефолт 1024×1024 и 28 steps. `job_id` опционален (`[A-Za-z0-9-]{1,80}`).

SSE: `status` (`start`, `retrieve`, `text`, `image_prompt`, `load_flux`, `generate`, `unload_flux`; в data есть `job_id`), `token` `{"text"}`, `text_done` `{"text","sources"}`, `image_prompt` `{"prompt"}`, `gpu_unload_llm` `{"ok": true}`, `image_progress` `{"step","total"}`, `image_done` `{"path","seed","prompt"}`, `error` `{"message"}`.

Режимы: `general` без retrieval. `rag` без `book_ids` или с 0 хитов — `error` «недостаточно контекста», LLM не вызывается. `rag_plus` с пустым поиском пишет по общим знаниям, без выдуманных цитат. Выключенный блок структуры в промпт не попадает. `citations: false` — в промпт не попадают `source_name`. Хиты режутся по score, пока текст контекста ≤ 10 000 символов. Flux получает одну английскую строку, без negative.
