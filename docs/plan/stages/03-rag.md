# Этап 3. RAG

**Статус:** выполнен, принят (2026-09-21)  
**Зависимости:** [этап 0](00-scaffold.md) выполнен (Qdrant в compose). GPU не обязателен.  
**Следующий этап:** [04-pipeline.md](04-pipeline.md)

## Отчёт

### Сделано

- Парсеры PDF / EPUB / FB2 / DOCX / TXT, чанкер ~2400 символов + overlap 400.
- `BAAI/bge-m3` на CPU из `HF_HOME`, `local_files_only=True`. Скрипт [`scripts/download-bge-m3.ps1`](../../../scripts/download-bge-m3.ps1) (Windows trust store).
- Qdrant `library_chunks`, Cosine 1024, payload с `text`. Переиндексация delete+upsert по `book_id`.
- FastAPI: `POST /rag/index` → 202 + job; poll статуса; `POST /rag/search`; `DELETE /rag/books/{book_id}`.
- Тесты фикстур: `ai-service/tests/rag/` (11 passed). [docs/RAG.md](../../RAG.md).

### Как проверить

Qdrant в compose. Модель уже в `D:/huggingface_cache`. FastAPI на `:8000`.

```powershell
.\ai-service\.venv\Scripts\python -c "import time, httpx; from pathlib import Path; c=httpx.Client(timeout=None, trust_env=False); p=str(Path('ai-service/tests/rag/fixtures/sample.txt').resolve()); r=c.post('http://127.0.0.1:8000/rag/index', json={'path':p,'book_id':'book-txt'}); print(r.status_code, r.json()); j=r.json()['job_id'];
while True:
    st=c.get(f'http://127.0.0.1:8000/rag/index/{j}').json(); print(st['status'], st['chunks_done'], st['chunks_total']);
    if st['status'] in ('ready','error'): break
    time.sleep(1)
print(c.post('http://127.0.0.1:8000/rag/search', json={'query':'читать спрос, цену и издержки','book_ids':['book-txt']}).json())"
```

| Проверка | Факт 2026-09-21 |
|----------|-----------------|
| `bge-m3` в `HF_HOME` | `hub/models--BAAI--bge-m3/snapshots/5617a9f6...`; профиль `%USERPROFILE%\.cache\huggingface` не создан |
| TXT + PDF фикстуры → `ready` | search цитатой → `book_id=book-txt`, `lang=ru` |
| фильтр `book_ids: ["no-such-book"]` | `hits: []` |
| EPUB / FB2 фикстуры | текст не пустой, index `ready` |
| повторный index `book-txt` | один чанк, без дублей `chunk_index` |
| книга FineReader 214 стр. (скан без текста) | джоба `error`: empty text, сервис жив |
| текстовый PDF 120 стр. | HTTP 202 сразу; прогресс 8…120; `ready` за ~114 с; search → `book-long` |

Приёмка пользователем (2026-09-21): index `sample.txt` → `queued` / `indexing 0 1` / `ready 1 1`; search «читать спрос, цену и издержки» → хит `book-txt`, `lang=ru`, `score≈0.597`.

### Не вошло / отложено

- OCR сканов. Пайплайн поста — этап 4. Nest library CRUD / StorageProvider / UI.
- SSE индексации, multipart upload.

Архитектуру не ломали. Факты — в [docs/DECISIONS.md](../../DECISIONS.md) и [docs/RAG.md](../../RAG.md).

---

## Микро-план (зафиксирован до кода)

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
