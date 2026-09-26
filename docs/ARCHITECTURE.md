# Архитектура

После **этапа 7** (выполнен 2026-09-24, ждёт приёмки). Источник: [plan/01-architecture.md](plan/01-architecture.md). Уточняется каждый этап. GPU: [GPU.md](GPU.md). RAG: [RAG.md](RAG.md).

## Принцип

Браузер говорит **только с NestJS**. Python FastAPI — изолированный AI-воркер с эксклюзивным доступом к GPU. Docker — только Qdrant и MinIO (без GPU). Ollama и Flux живут на хосте Windows.

Прямой вызов UI → FastAPI запрещён. Продуктовый цикл — REST/SSE Nest `:3000`. FastAPI остаётся внутренним воркером.

## Что есть после этапа 7

- Всё из этапов 0–5: health, Ollama text, Flux NF4 + GpuManager, Qdrant, RAG, pipeline, Nest API.
- UI: библиотека, мастер поста, история, пресеты. Vite `:5173` проксирует Nest. Браузер в FastAPI не ходит. Авторизации и редактора поста нет.

Временные файлы пайплайна Python: `data/tmp/pipeline/<job_id>/`. Продуктовые файлы пишет Nest.

## Nest API

Префикса `/api` нет. JSON camelCase. `sources[]` в БД и `meta.json` тоже camelCase; в SSE остаются поля Python (`book_id`, `chunk_index`, `source_name`).

Книга: `indexing | ready | error`. Джоба: `running | succeeded | failed | cancelled`. Пост: `draft | ready | failed`. После рестарта Nest висящие джобы → `failed` («прервано перезапуском»), книги в `indexing` → `error`. Черновик поста при этом тоже `failed`.

| Метод | Путь | Ответ |
|--------|------|--------|
| `POST` | `/library/books` | multipart поле `file` (pdf, epub, fb2, docx, txt, до 200 МБ). `202` и книга, статус `indexing`. Nest копирует файл в storage и только потом вызывает `POST /rag/index` с тем же `book_id`. |
| `GET` | `/library/books`, `/library/books/:id` | список / одна. Прогресс чанков Nest пишет сам, опрашивая Python |
| `POST` | `/library/books/:id/reindex` | `202`. Пока статус `indexing` — `409` |
| `POST` | `/library/books/:id/outline` | книга в `ready`. Собирает оглавление по чанкам заново, без переиндексации. `indexing` — `409`. Успех заменяет `outline`. Ошибка пишет `outlineError` и оставляет прежний список |
| `DELETE` | `/library/books/:id` | векторы через Python, затем storage. Посты не удаляются. `indexing` → `409`. Python недоступен → `502`, книга остаётся |
| `GET/POST/PATCH/DELETE` | `/presets` | `name`, `description` (после trim не короче 10 символов), `examples` (до 5, необязательны). Пустое описание — `400`. Удаление пресета обнуляет `presetId` у постов |
| `GET/POST/PATCH/DELETE` | `/image-presets` | `name`, `prompt` (после trim от 10 до 4000 символов). Стиль картинки, отдельно от пресета текста. Удаление обнуляет `imagePresetId` у постов |
| `GET` | `/posts`, `/posts/:id` | список и карточка, новые сверху |
| `GET` | `/posts/:id/image` | `image/png` по `imageKey` через StorageProvider. Пустой ключ или нет файла — `404` |
| `DELETE` | `/posts/:id` | БД и папка. Пост в очереди или во время генерации — `409` |
| `POST` | `/posts/:id/open-folder` | `200`. `explorer.exe` только при `STORAGE_DRIVER=fs` и Windows. Иначе `400` |
| `POST` | `/generate/posts` | `202 { items: [{ jobId, postId }] }`. Тело как раньше плюс `count` `1..20` (дефолт 1). Столько черновиков встаёт в хвост очереди. Если `seed` задан и `count` > 1, у поста с индексом `i` seed `seed + i` по модулю 2³¹ |
| `GET` | `/generate/queue` | `{ cooldownUntil, items }`. `items`: `queued` и `running` по `createdAt`, с `topic` и `kind`. `cooldownUntil` — ISO-время конца минутной паузы или `null` |
| `DELETE` | `/generate/queue/:jobId` | Только `queued`. Черновик полного поста удаляется вместе с джобой. Иначе `409`, нет джобы — `404` |
| `GET` | `/generate/posts/:id/events` | SSE. Пока джоба `queued`, первым событием `status` `{ phase: "queued" }`, дальше поток Python |
| `POST` | `/posts/:id/regenerate-text` | Новый job в ту же очередь, тот же URL событий. Перезаписывает `post.md` / `post.txt`, картинку не трогает |
| `POST` | `/posts/:id/regenerate-image` | Тело `{ seed?, imagePresetId? }`. Джоба встаёт в очередь. Нет `seed` — случайный. Нет `imagePresetId` — стиль поста как есть; `null` снимает стиль; строка проверяется и пишется на пост до джобы. Пишет `image.png`, `image_prompt.txt` и seed. Текст не трогает |
| `POST` | `/generate/posts/:id/cancel` | `202 { jobId, status: "cancelled" }`. Джоба не `running` — `409`. Нет джобы — `404`. Хвост очереди после отмены продолжается |
| `GET` | `/gpu/status` | прокси FastAPI: `{ locked, tenant, ollama_models, vram_used_mb }`. FastAPI недоступен — `502` |

Очередь одна на полный пост, перегенерацию текста и картинки. Воркер Nest берёт следующую `queued` только после записи файлов текущего поста. Если хвост не пуст, он зовёт `POST /gpu/settle` (выгрузка Flux/OCR и Ollama, ожидание VRAM; если лок занят — пропуск) и ждёт 60 секунд. Пустой хвост паузу не включает. Снятие всего хвоста прерывает паузу. Ошибка или отмена одного поста хвост не останавливает.

`rag` без книг или с книгой не в `ready` — `409` до вызова Python. Неизвестный пресет или книга — `404`. FastAPI недоступен до старта — `502`, строка поста не создаётся. Пустой RAG, Ollama и GPU приходят событием `error` уже по-русски, джоба `failed`. Запись файлов при сбое диска или MinIO — «Не удалось записать файлы поста.» На одном посте вторая джоба (`queued` или `running`) — `409`. Занятый GPU кнопку очереди не блокирует. Рестарт помечает `running` и их черновики как `failed` («прервано перезапуском»); `queued` и их черновики остаются, воркер продолжает хвост без досиживания паузы.

Отмена не рвёт SSE Nest→Python. Nest зовёт `POST /pipeline/jobs/:id/cancel`. Во время текста httpx-стрим к Ollama закрывается, Flux не стартует. Если Flux уже считает, прогон доходит до конца, PNG в пост не пишется, событие `cancelled` `{ message: "отменено" }`. `gpu.release` остаётся в `finally`. Черновик, который ещё не `ready`, становится `failed`; уже готовый пост остаётся `ready`, старые файлы на месте. Если `text_done` уже записан в SQLite, текст в строке остаётся, папку поста отмена не создаёт.

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

`ai-service/app/gpu/manager.py`: один `asyncio.Lock`. Тенанты `llm` | `flux` | `ocr`. Захват `flux` или `ocr` выгружает Ollama и другую torch-модель; release выгружает свою. `POST /gpu/settle` делает то же, когда лок свободен, и возвращает `{ ok, skipped }`. Эмбеды `bge-m3` — CPU, lock для них не нужен.

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
- Эмбеды на CPU, GpuManager не трогаем. Одна индексная джоба за раз (свой lock, не GPU). После чанков фаза `outline`: один вызов LLM под `acquire("llm")` уже без индексного lock. Ошибка оглавления не отменяет `ready`.
- `outline` — JSON-массив коротких пунктов, будущие темы поста. В поиск и в промпт генерации не входит. Ручной повтор: `POST /library/books/:id/outline`.
- Скан PDF без текстового слоя → OCR DeepSeek-OCR-2 под тенантом `ocr`, текст в `library/<id>/source.txt` рядом с `source.pdf`, дальше обычная индексация. Готовый `source.txt` переиспользуется.

Подробности: [RAG.md](RAG.md).

## Pipeline поста

Один SSE на FastAPI. Ollama только под `acquire("llm")`, Flux только под `acquire("flux")`. `acquire("flux")` выгружает Ollama до загрузки весов. Между release LLM и acquire Flux второй запрос ждёт тот же lock.

- `POST /pipeline/stream` — retrieve (если не `general`) → стрим русского текста → английский image prompt той же LLM (`think: false`) → `gpu_unload_llm` → Flux → файлы джобы.
- `POST /pipeline/text/stream` — тот же текст без Flux. Пишет только `post.txt`.
- `POST /pipeline/image/stream` — `{ "text", "image_style"? }` → image prompt → Flux. `post.txt` не пишет и не меняет. Непустой `image_style` дописывается к тексту поста блоком «Стиль картинки» и уходит только в LLM промпта. Flux получает её английскую строку.

Тело поста: `topic`, `tone` (пусто → «живой, разговорный»), `length` `S|M|L` (около 500 / 1200 / 2500 символов), `emoji` default false, `knowledge_mode` default `rag`, `citations` default false, `structure` `{hooks, body, cta}` default все true, `book_ids`, `top_k` default 10 (1–20), `preset` `{description, examples}` до 5 примеров, `image_style` до 4000 символов. Картинка: `width` / `height` / `steps` / `seed`, дефолт 1024×1024 и 28 steps. `job_id` опционален (`[A-Za-z0-9-]{1,80}`).

SSE: `status` (`start`, `retrieve`, `text`, `image_prompt`, `load_flux`, `generate`, `unload_flux`; в data есть `job_id`), `token` `{"text"}`, `text_done` `{"text","sources"}`, `image_prompt` `{"prompt"}`, `gpu_unload_llm` `{"ok": true}`, `image_progress` `{"step","total"}`, `image_done` `{"path","seed","prompt"}`, `cancelled` `{"message":"отменено"}`, `error` `{"message"}`.

Логи Python и Nest — JSON-строка в stdout: `ts`, `level`, `logger`, `msg`, у пайплайна ещё `job_id`.

Режимы: `general` без retrieval. `rag` без `book_ids` или с 0 хитов — `error` «В выбранных книгах нет подходящих фрагментов.», LLM не вызывается. `rag_plus` с пустым поиском пишет по общим знаниям, без выдуманных цитат. Выключенный блок структуры в промпт не попадает. `citations: false` — в промпт не попадают `source_name`. Хиты режутся по score, пока текст контекста ≤ 10 000 символов. Flux получает одну английскую строку, без negative.
