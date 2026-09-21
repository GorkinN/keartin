# Этап 4. Полный AI-pipeline

**Статус:** выполнен, принят (2026-09-21)  
**Зависимости:** [этап 1](01-text-generation.md), [этап 2](02-image-gpu.md), [этап 3](03-rag.md)  
**Следующий этап:** [05-nestjs.md](05-nestjs.md)

## Отчёт

### Сделано

- `POST /pipeline/stream` — retrieve → русский текст → английский image prompt → `acquire("flux")` (выгрузка Ollama) → PNG.
- `POST /pipeline/text/stream` — только текст, файл `post.txt`. `POST /pipeline/image/stream` — картинка по готовому `text`, `post.txt` не трогает.
- Артефакты: `data/tmp/pipeline/<job_id>/` (`post.txt`, `image_prompt.txt`, `image.png`).
- `rag` без `book_ids` или с 0 хитов — SSE «недостаточно контекста», LLM не вызывается. Контекст в промпт режется по score до 10 000 символов.
- Промпты: `ai-service/app/prompts/post_ru.md`, `image_prompt.md`. Юнит-тесты `ai-service/tests/pipeline/` (вместе с RAG: 25 passed).

### Как проверить

FastAPI на `:8000`, Qdrant и книга `book-txt` уже проиндексированы. В PowerShell `curl` — это `Invoke-WebRequest`; нужен `curl.exe` или httpx.

```powershell
curl.exe -N -X POST http://127.0.0.1:8000/pipeline/stream -H "Content-Type: application/json" -d '{"topic":"цена и спрос","knowledge_mode":"rag","book_ids":["book-txt"],"structure":{"hooks":true,"body":true,"cta":false}}'
```

Приёмка пользователем (2026-09-21): этот запрос (`rag`, `book-txt`, CTA выключен) запустился успешно.

### Не вошло / отложено

- SQLite, StorageProvider, `post.md` / `meta.json`, Nest, UI, CRUD пресетов. Это этап 5.

Факты — в [docs/DECISIONS.md](../../DECISIONS.md) и [docs/ARCHITECTURE.md](../../ARCHITECTURE.md).

---

## Цель

Один SSE-поток полного поста: retrieve → текст → промпт картинки → exclusive Flux → артефакты во временной папке. NestJS ещё нет — проверяем FastAPI напрямую.

## Что делается

- Сборка промпта поста из:
  - режима знаний `rag | rag_plus | general`
  - цитируемости (default off)
  - структуры hooks / body / cta (каждый блок вкл/выкл)
  - темы, тона, длины, эмодзи
  - пресета (описание + few-shot), пока передаётся в теле запроса, не из БД
- Пайплайн с GpuManager:
  1. retrieve (если не `general`)
  2. stream текста
  3. генерация image prompt той же LLM
  4. unload LLM
  5. Flux
  6. unload Flux
- SSE-события: `status`, `token`, `text_done`, `image_prompt`, `gpu_unload_llm`, `image_progress`, `image_done`, `error`.
- Сохранение артефактов в temp pipeline-директории (Nest подхватит на этапе 5).
- Отдельный endpoint повторной картинки по уже готовому тексту (без перегенерации поста).
- Отдельный endpoint повторного текста (без картинки).

## Файлы и модули

- `ai-service/app/pipeline/post_pipeline.py`
- `ai-service/app/prompts/post_ru.md`
- `ai-service/app/prompts/image_prompt.md`
- Pydantic-схемы запроса/событий
- `ai-service/app/api/pipeline.py`

## Решения этапа

- Текст поста — русский.
- Промпт картинки — **английский** (Flux так лучше).
- Если блок выключен — секции в промпте нет, модель не обязана её писать.
- Режим `rag` и пустой retrieval → ошибка «недостаточно контекста», не галлюцинация.
- Режим `rag_plus` — контекст первичен, общие знания можно, без выдуманных цитат.
- Режим `general` — retrieval не вызывается.
- Одна LLM на текст и image prompt.
- Один job id, никакого параллельного Flux.

## Что сознательно не делается

- SQLite / Prisma.
- StorageProvider.
- UI.
- CRUD пресетов в БД (пресет приходит JSON-ом).

## Как проверяется

E2E через curl/httpie:

1. Индексированная книга + тема.
2. В логе видна выгрузка LLM **перед** Flux.
3. На диске: `post.txt` + `image.png` + `image_prompt.txt`.
4. Повтор картинки не меняет текст.
5. Режим `rag` без источников / с пустым поиском — ошибка, не выдуманный пост.
6. Выключенный CTA — в тексте нет явного призыва, либо модель не получает инструкцию его писать.

## Критерий приёмки

Один запрос проходит цепочку RAG → текст → картинка с корректным GPU-эксклюзивом. Повторная генерация картинки работает отдельно.
