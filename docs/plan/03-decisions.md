# Технические решения

Источник правды после этапа 0: [docs/DECISIONS.md](../DECISIONS.md) (дата 2026-09-20). Текст ниже — исходное обсуждение; пункты чеклиста отмечены.

## Дефолты (приняты)

### 1. Основная LLM

**Решение:** `qwen3.5:9b-16k` + `options.num_ctx=8192`.

- Не `qwen2.5:7b-instruct` как основная: хуже русский и стиль.
- Вторую LLM не грузим: промпт картинки пишет та же 9b.
- `qwen2.5:7b-instruct` — только fallback через `LLM_MODEL` в `.env`, не второй процесс.
- Полные 16k контекста на 9B дают KV-кэш порядка ~4+ ГБ — риск OOM на 12 ГБ.

### 2. Embedding-модель (RU+EN)

**Решение:** `BAAI/bge-m3`, 1024 dim, через `sentence-transformers` / FlagEmbedding **на CPU**. Веса — только из кэша Hugging Face (п. 13), не из профиля пользователя.

Почему не Ollama:

- `nomic-embed-text` слабо работает с русским.
- `bge-m3` в Ollama (~1.2 GB VRAM) плюс 9B плюс KV не влезают в 12 ГБ.
- Индексация больших книг не должна вытеснять LLM.

Альтернатива, если CPU-индексация слишком медленная: Ollama `bge-m3`, но тогда GpuManager обязан выгружать эмбед перед LLM.

### 3. Парсеры

| Формат | Библиотека |
|--------|------------|
| PDF | PyMuPDF (`fitz`) |
| EPUB | ebooklib |
| FB2 | lxml (FB2 = XML; не делать `fb2reader` единственным путём) |
| DOCX | python-docx |
| TXT | charset-normalizer |

Не Unstructured (тяжёлый стек). Не LangChain.

### 4. Flux на 12 ГБ

Порядок fallback:

1. **Основной:** transformer + T5 в bitsandbytes **NF4** + `enable_sequential_cpu_offload()` (или `enable_model_cpu_offload()`).
2. **Если Windows+bnb сломается:** GGUF Q5_K_S / Q6_K через diffusers.
3. FP8 — только если после unload Ollama стабильно ~11 ГБ свободно и T5 тоже FP8. На 12 ГБ впритык, не первый путь.

Не влезут:

- FP16 / BF16 (~24–31 ГБ)
- BnB 8-bit (peak ~24 ГБ)
- BnB 4-bit **без** offload (peak ~17 ГБ)

ComfyUI не вносим. Flux не кладём в Docker.

Основная загрузка: repo id `black-forest-labs/FLUX.1-dev` через кэш Hugging Face (см. п. 13), при уже скачанном снимке — `local_files_only=True`. Если это полный BF16 — на этапе 2 квантуем при загрузке, не гоняем FP16.

`FLUX_MODEL_PATH` — **опциональный** override: GGUF или снимок, который лежит не в hub-кэше. Не блокирует план и не блокирует этап 2, пока жив `HF_HOME`.

### 5. Выгрузка LLM из Ollama

1. `GET /api/ps`
2. Для каждой модели `POST /api/generate {"model", "keep_alive": 0}`
3. Fallback: `ollama stop <name>`
4. Poll `ollama ps` + `nvidia-smi`

Не `taskkill` процесса Ollama.

### 6. Векторная БД

**Qdrant.** Chroma проще, но фильтры и переиндексация слабее. pgvector тащит Postgres без нужды.

Коллекция: `library_chunks`, dim 1024, payload `book_id`, `chunk_index`, `source_name`, `lang`.

### 7. Realtime

**SSE**, не WebSocket. Однонаправленный прогресс, Nest `@Sse` + браузерный `EventSource`.

### 8. Метаданные

**SQLite** на Nest через Prisma. Postgres не нужен.

Полный текст поста в БД — ок (посты короткие). Исходники книг в БД **не** кладём, только мета + storage key.

### 9. Монорепо

Папки + pnpm workspaces на JS. Без Turborepo/Nx. Python — отдельный venv.

Python-зависимости: `requirements.txt` или `pyproject.toml` — выбрать на этапе 0, предпочтение `pyproject.toml` + venv.

### 10. Сторадж

По умолчанию локальные папки (вариант A). MinIO поднимаем в compose с этапа 0, драйвер S3 подключаем на этапе 5. В UI оба сразу не светим.

### 11. Авторизация

Нет. Localhost, один пользователь.

### 12. Целевая соцсеть

Не фиксируем. Длина S / M / L (ориентир 500 / 1200 / 2500 символов) и структура блоков.

### 13. Кэш Hugging Face

**Решение:** все модели Hugging Face (Flux, `bge-m3`, любые следующие) читаются и докачиваются только в существующий кэш на этой машине — как в `example/config.py`:

```
HF_HOME=D:/huggingface_cache
HUGGINGFACE_HUB_CACHE=D:/huggingface_cache/hub
TRANSFORMERS_CACHE=D:/huggingface_cache/transformers
```

- Значения в `.env` / `.env.example`, не хардкод в Python.
- Выставлять до импорта HF-библиотек (`ai-service` + `scripts/start-dev.ps1`).
- `TRANSFORMERS_CACHE` в новых transformers deprecated, но кэш уже разнесён на `hub` и `transformers` — оставляем все три переменные.
- Docker этот диск не монтирует: Flux и эмбеды — хостовый venv.
- Не использовать дефолт `%USERPROFILE%\.cache\huggingface`.

## Чеклист согласования

Отмечено 2026-09-20 (этап 0):

- [x] LLM: `qwen3.5:9b-16k` + ctx 8192
- [x] Embeddings: bge-m3 на CPU
- [x] Парсеры: PyMuPDF / ebooklib / lxml / python-docx
- [x] Flux: NF4 + offload, fallback GGUF
- [x] Qdrant + SSE + SQLite + pnpm folders
- [x] Сторадж по умолчанию: локальные папки
- [x] Кэш HF: `D:/huggingface_cache` (`HF_HOME` + связанные переменные)
- [x] `FLUX_MODEL_PATH` — только если GGUF / снимок вне кэша (не обязателен)
