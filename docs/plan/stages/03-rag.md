# Этап 3. RAG

**Статус:** не начат  
**Зависимости:** [этап 0](00-scaffold.md) выполнен (Qdrant в compose). GPU не обязателен.  
**Следующий этап:** [04-pipeline.md](04-pipeline.md)

## Цель

Книга → чанки → Qdrant → релевантный поиск с фильтром по выбранным источникам. Переиндексация и статусы.

## Что делается

- Парсеры всех форматов, нормализация в плоский текст (+ главы/оглавление, если есть).
- Чанкер: 500–800 токенов ≈ 2000–3200 символов, overlap ~400 символов (~100 токенов), резать по абзацу.
- Embeddings: `BAAI/bge-m3`, 1024 dim, **CPU**. Скачивание и чтение только из `HF_HOME` (`D:/huggingface_cache`), тот же кэш, что у Flux.
- Qdrant-коллекция `library_chunks`.
- Payload: `book_id`, `chunk_index`, `source_name`, `lang`.
- Переиндексация: delete by `book_id` + upsert.
- API FastAPI:
  - `POST /rag/index` → 202 + job id
  - `GET /rag/index/{job_id}` — статус `queued | indexing | ready | error`
  - `POST /rag/search` — query + `book_ids[]` + `top_k`
  - `DELETE /rag/books/{book_id}` — чистка векторов
- Прогресс индексации (батчи чанков / страниц).
- `docs/RAG.md`.
- Тесты на маленьких фикстурах (1–2 страницы каждого формата).

## Файлы и модули

- `ai-service/app/rag/parsers/pdf.py`
- `ai-service/app/rag/parsers/epub.py`
- `ai-service/app/rag/parsers/fb2.py`
- `ai-service/app/rag/parsers/docx.py`
- `ai-service/app/rag/parsers/txt.py`
- `ai-service/app/rag/chunking.py`
- `ai-service/app/rag/embedder.py`
- `ai-service/app/rag/qdrant_store.py`
- `ai-service/app/rag/indexer.py`
- `ai-service/app/rag/retriever.py`
- `ai-service/tests/rag/`
- `docs/RAG.md`

## Решения этапа

- Не LangChain.
- top_k default 10 (диапазон 8–12).
- RU и EN в одной коллекции.
- FB2: брать `body` + `title-info`, выкидывать binary/cover.
- EPUB: собирать spine HTML → text, не картинки, не nav.
- Битый файл → ошибка джоба по этой книге, не падение сервиса.
- Индексация не держит HTTP-воркер: 202 + фон.
- `bge-m3` не должен писать в `%USERPROFILE%\.cache\huggingface`.

## Что сознательно не делается

- Генерация поста.
- NestJS library CRUD (файлы можно класть во временную папку / принимать multipart прямо в FastAPI для проверки).
- GPU-lock, если эмбеды реально на CPU.

## Как проверяется

1. Залить русский TXT и PDF.
2. Дождаться `ready`.
3. `POST /rag/search` с цитатой из книги → чанки с верным `book_id`.
4. Тот же запрос с фильтром другого `book_id` → пусто.
5. EPUB и FB2 — хотя бы по одной фикстуре, текст не пустой.
6. Книга 100+ страниц (если есть под рукой) — прогресс, не таймаут HTTP.
7. Повторный index той же книги — дублей нет (старые чанки удалены).

## Критерий приёмки

Поиск по русскому фрагменту возвращает релевантные чанки. Фильтр по источникам работает. Переиндексация идемпотентна относительно `book_id`.
