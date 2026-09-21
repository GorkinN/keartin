# Принятые решения

Дата фиксации: 2026-09-20 (этапы 0–2). Приёмка этапа 2: 2026-09-21. Приёмка этапа 3: 2026-09-21. Приёмка этапа 4: 2026-09-21. Источник дефолтов: [plan/03-decisions.md](plan/03-decisions.md).

| # | Решение | Статус |
|---|---------|--------|
| 1 | LLM: `qwen3.5:9b-16k`, `num_ctx=8192`. Fallback `LLM_MODEL` в `.env`, не вторая живая модель | принято |
| 2 | Embeddings: `BAAI/bge-m3` на CPU через sentence-transformers (FlagEmbedding не ставили) | принято |
| 3 | Парсеры: PyMuPDF, ebooklib, lxml (FB2), python-docx, charset-normalizer. Не LangChain, не Unstructured | принято |
| 4 | Flux: NF4 + CPU offload, fallback GGUF. Не Docker, не ComfyUI. Repo id из HF-кэша; `FLUX_MODEL_PATH` опционален | принято |
| 5 | Выгрузка Ollama: `keep_alive: 0` по `ollama ps`, затем `ollama stop`, poll `nvidia-smi`. Не `taskkill` | принято |
| 6 | Векторная БД: Qdrant | принято |
| 7 | Realtime: SSE, не WebSocket | принято |
| 8 | Метаданные: SQLite + Prisma на Nest | принято |
| 9 | Монорепо: pnpm workspaces (`frontend`, `backend`). Python: `ai-service/pyproject.toml` + venv | принято |
| 10 | Сторадж по умолчанию: локальные папки. MinIO в compose с этапа 0, драйвер S3 с этапа 5 | принято |
| 11 | Авторизации нет (localhost, один пользователь) | принято |
| 12 | Соцсеть не фиксируем. Длина S/M/L | принято |
| 13 | Кэш HF: `HF_HOME=D:/huggingface_cache` (+ hub / transformers). Env до импорта HF-библиотек | принято |

## Решения этапа 0

- Python 3.12 для venv (в системе есть 3.12; 3.14 слишком новая для будущего torch).
- NestJS 11.
- Health всегда HTTP 200, если процесс жив; зависимости в JSON (`ok` / `down` / `skipped`).
- Образ MinIO: `quay.io/minio/minio` (Docker Hub `minio/minio` на этой машине недоступен).
- Torch на этапе 0 не ставится → `cuda: skipped`.

## Решения этапа 1

- Chat к Ollama с `"think": false`: иначе qwen3.5 отдаёт reasoning вместо поста.
- `keep_alive` по умолчанию `5m` (`LLM_KEEP_ALIVE`); `0` в теле запроса выгружает модель (`ollama ps` пуст).
- Вызовы Ollama оборачиваются в stub `GpuManager.acquire("llm")`.
- httpx к localhost: `trust_env=False`, чтобы системный `HTTP_PROXY` не ломал Ollama/Qdrant.
- Системный `OLLAMA_HOST=0.0.0.0` (bind-адрес сервиса Ollama) нормализуется в клиентский URL `http://127.0.0.1:11434`. Имя переменной не меняли.

## Решения этапа 2

- Torch в venv: `2.13.0+cu126` с `https://download.pytorch.org/whl/cu126`, не CPU-колесо с PyPI. `GET /health` → `cuda: ok`.
- NF4 + `enable_model_cpu_offload()`. Sequential offload + bitsandbytes на T5: `Cannot copy out of meta tensor`.
- Проверка кэша по `model_index.json` + `transformer/`, не через полный `snapshot_download` (в кэше нет LICENSE/README — веса на месте).
- Idle VRAM Windows ~1.1 ГБ > `GPU_FREE_MB_THRESHOLD=500`. Poll считает idle, если used < 500 **или** < 4096 МБ после выгрузки моделей.
- GGUF-ветка есть (`FLUX_QUANT=gguf` + `FLUX_MODEL_PATH`). NF4 на этой машине прошёл, GGUF-файл не качали.
- Картинка этапа 2: `data/tmp/flux-*.png` + `image_base64`. StorageProvider / Nest / UI — позже.
- Приёмка 2026-09-21: после текста 7574 МБ / `qwen3.5:9b-16k`; 512²/20 → 200; после Flux 1187 МБ, `ollama_models: []`.

## Решения этапа 3

- Эмбеды: `sentence-transformers` + `device="cpu"` + `local_files_only=True`. FlagEmbedding не добавляли.
- В Qdrant payload кроме `book_id` / `chunk_index` / `source_name` / `lang` лежит `text` (иначе search нечего вернуть).
- Джобы индексации — в памяти FastAPI. Рестарт теряет статус; векторы в Qdrant остаются.
- `POST /rag/index` принимает путь на диске, не multipart.
- Скачивание `bge-m3`: `scripts/download-bge-m3.ps1` + Windows `truststore` (certifi ломается на корпоративном SSL). Кэш профиля не создаётся.
- Скан PDF без текстового слоя (книга FineReader, 214 стр. картинок) → джоба `error`. OCR не делаем.
- Прогресс 100+ стр. проверили на текстовом PDF 120 стр. (`data/tmp/rag-long-ru.pdf`): 202 сразу, 120 чанков ~114 с, search по русской фразе → `book-long`.
- Приёмка 2026-09-21: `sample.txt` → `ready 1/1`; search «читать спрос, цену и издержки» → `book-txt`, `lang=ru`, `score≈0.597`.

## Решения этапа 4

- Полный пост: `POST /pipeline/stream`. Повтор текста: `POST /pipeline/text/stream` (только `post.txt`). Повтор картинки: `POST /pipeline/image/stream` по готовому `text`, `post.txt` не трогает.
- Артефакты: `data/tmp/pipeline/<job_id>/`. `post.md` и `meta.json` — этап 5.
- `rag` без `book_ids` или с 0 хитов → SSE «недостаточно контекста», без вызова LLM. `rag_plus` с пустым поиском идёт как общие знания.
- Контекст в промпт: хиты по score, сумма текста ≤ 10 000 символов (`num_ctx=8192`; чанк ~2400 символов).
- `citations: false` не кладёт `source_name` в промпт. Выключенный блок структуры в промпте не упоминается.
- Image prompt — одна английская строка. Flux по-прежнему без negative. Длина S/M/L — около 500 / 1200 / 2500 символов.
- Выгрузка LLM перед Flux — существующий `acquire("flux")`. Отдельного 409 нет: второй запрос ждёт lock.
- Приёмка 2026-09-21: `POST /pipeline/stream`, тема «цена и спрос», `rag`, `book_ids: ["book-txt"]`, CTA выключен — запуск успешен.
