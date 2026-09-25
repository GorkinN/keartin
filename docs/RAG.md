# RAG

Факт после этапа 7 (2026-09-24, ждёт приёмки). Векторы книг живут в Qdrant (`library_chunks`). Эмбеды `BAAI/bge-m3` считаются на **CPU** через `sentence-transformers`, не через Ollama и не через GpuManager. Библиотека в UI ходит в Nest `:3000`: загрузка, прогресс `chunksDone/chunksTotal`, удаление. Nest проксирует индекс и удаление векторов в FastAPI.

Ошибки файла на книге короткие и русские: неподдерживаемый формат, не удалось прочитать, нет текста, распознавание скана не нашло текста, модель OCR не скачана, не нарезались фрагменты. Сырой стек в `book.error` не пишется.

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

## Сканы PDF (OCR)

PDF без текстового слоя (только картинки, типичный вывод FineReader) распознаётся локальной `deepseek-community/DeepSeek-OCR-2` (`OCR_MODEL_ID`). Это нативная модель `transformers` (`AutoModelForImageTextToText`), без `trust_remote_code` и без понижения версий. Веса только из HF-кэша: `.\scripts\download-ocr.ps1`.

1. PyMuPDF читает текстовый слой. Текст есть — OCR не запускается.
2. Слоя нет, а рядом лежит `source.txt` — индексируется он, OCR не повторяется.
3. Иначе `GpuManager.acquire("ocr")` на всю книгу. PyMuPDF рендерит страницу (`OCR_DPI`, дефолт 144), модель распознаёт её промптом `Free OCR.` Страницы строго по одной, склейка пустой строкой.
4. Текст UTF-8 пишется рядом с PDF: `library/<id>/source.pdf` → `library/<id>/source.txt`. Дальше обычный чанкинг и CPU-эмбеды.

На S3 Python пишет `source.txt` в staging `data/tmp/index/<id>/`, Nest перед очисткой staging кладёт его в ключ `library/<id>/source.txt`. При переиндексации Nest кладёт сохранённый `source.txt` обратно в staging. В `Book.textKey` — ключ сайдкара, если он есть.

Распознавание не нашло текста → книга `error`. Нет весов → книга `error` «модель не скачана».

## Чанки и поиск

- Цель ~2400 символов (коридор 2000–3200), overlap 400, граница абзаца.
- `lang`: доля кириллицы > 0.3 → `ru`, иначе `en`. RU и EN в одной коллекции.
- Qdrant: Cosine, 1024 dim, payload `book_id`, `chunk_index`, `source_name`, `lang`, `text`.
- Переиндексация: delete by `book_id` + upsert. Point id = UUID5(`book_id:chunk_index`).
- `top_k` default 10. Пустой `book_ids` — поиск по всей коллекции.

## API

`POST /rag/index` — `{ "path", "book_id"?, "source_name"? }` → `202` `{ job_id, book_id, status }`. Файл должен существовать. Нет `book_id` — UUID. Джобы в памяти процесса (рестарт FastAPI их стирает; векторы в Qdrant остаются). Одна книга за раз.

`GET /rag/index/{job_id}` — `queued | indexing | ready | error`, плюс `chunks_done` / `chunks_total`, `phase` (`parse | ocr | embed`) и `pages_done` / `pages_total` для OCR. Nest пишет их в `Book.phase` / `pagesDone` / `pagesTotal`, библиотека показывает «страница N/M».

`POST /rag/search` — `{ "query", "book_ids": [], "top_k"? }` → `{ hits: [{ book_id, chunk_index, source_name, lang, text, score }] }`.

`DELETE /rag/books/{book_id}` — чистит векторы этой книги.

Прогресс только poll, без SSE. Multipart загрузки нет: путь на диске.

## GPU

Эмбеды lock GpuManager не берут: `device="cpu"`. Не гонять индекс параллельно с Flux без нужды (оба трогают torch/RAM).

OCR скана берёт тенант `ocr` на всю книгу (~10 с на страницу). Генерация поста в это время ждёт тот же lock, UI показывает «GPU занят: распознавание скана». Другие книги ждут индексный lock.
