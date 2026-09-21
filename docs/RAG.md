# RAG

Факт после этапа 3 (принят 2026-09-21). Векторы книг живут в Qdrant (`library_chunks`). Эмбеды `BAAI/bge-m3` считаются на **CPU** через `sentence-transformers`, не через Ollama и не через GpuManager. Nest и UI библиотеку не проксируют: приёмка — curl/httpx к FastAPI.

## Кэш Hugging Face

Веса только из `HF_HOME` / `HUGGINGFACE_HUB_CACHE`. Эмбеддер грузит модель с `local_files_only=True`. Если снимка нет — ошибка «скачай скриптом», без записи в `%USERPROFILE%\.cache\huggingface`.

Скачать:

```powershell
.\scripts\download-bge-m3.ps1
```

Скрипт читает корневой `.env`, ставит `HF_HUB_DISABLE_XET=1` и подключает Windows trust store (`truststore`), потому что certifi на этой машине падает на корпоративной цепочке сертификатов. Пишет в `D:/huggingface_cache/hub/models--BAAI--bge-m3`.

## Парсеры

| Формат | Библиотека | Что берём |
|--------|------------|-----------|
| PDF | PyMuPDF | текстовый слой страниц |
| EPUB | ebooklib + lxml | spine HTML, без nav/картинок |
| FB2 | lxml | `title-info` + `body`, без `binary`/cover |
| DOCX | python-docx | абзацы и таблицы |
| TXT | charset-normalizer | декод в Unicode |

Скан PDF без текстового слоя (только картинки, типичный вывод FineReader) → джоба `error`, сервис жив. OCR на этом этапе нет.

## Чанки и поиск

- Цель ~2400 символов (коридор 2000–3200), overlap 400, граница абзаца.
- `lang`: доля кириллицы > 0.3 → `ru`, иначе `en`. RU и EN в одной коллекции.
- Qdrant: Cosine, 1024 dim, payload `book_id`, `chunk_index`, `source_name`, `lang`, `text`.
- Переиндексация: delete by `book_id` + upsert. Point id = UUID5(`book_id:chunk_index`).
- `top_k` default 10. Пустой `book_ids` — поиск по всей коллекции.

## API

`POST /rag/index` — `{ "path", "book_id"?, "source_name"? }` → `202` `{ job_id, book_id, status }`. Файл должен существовать. Нет `book_id` — UUID. Джобы в памяти процесса (рестарт FastAPI их стирает; векторы в Qdrant остаются). Одна книга за раз.

`GET /rag/index/{job_id}` — `queued | indexing | ready | error`, плюс `chunks_done` / `chunks_total`.

`POST /rag/search` — `{ "query", "book_ids": [], "top_k"? }` → `{ hits: [{ book_id, chunk_index, source_name, lang, text, score }] }`.

`DELETE /rag/books/{book_id}` — чистит векторы этой книги.

Прогресс только poll, без SSE. Multipart загрузки нет: путь на диске.

## GPU

Индексация lock GpuManager не берёт: `device="cpu"`. Не гонять индекс параллельно с Flux без нужды (оба трогают torch/RAM).
