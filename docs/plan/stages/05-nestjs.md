# Этап 5. NestJS-бэкенд

**Статус:** не начат  
**Зависимости:** [этап 4](04-pipeline.md)  
**Следующий этап:** [06-frontend.md](06-frontend.md)

## Цель

Продуктовый API для UI. Python остаётся внутренним воркером. Появляются SQLite, StorageProvider, библиотека, посты, пресеты, джобы генерации.

## Что делается

- Prisma-модели: `Book`, `Post`, `StylePreset`, `GenerationJob`.
- REST:
  - library: upload, list, get, delete, reindex
  - posts: list, get, delete, open-folder
  - presets: CRUD
  - `POST /generate/posts` → job
  - `GET /generate/posts/:id/events` → SSE proxy на Python
  - `POST /posts/:id/regenerate-text`
  - `POST /posts/:id/regenerate-image`
- `StorageProvider`:
  - `LocalFsProvider` — `data/posts/YYYY-MM-DD_slug/`, `data/library/<book-id>/`
  - `S3Provider` — MinIO, ключ в SQLite
- В SQLite: полный текст, ключ картинки, мета (тема, тон, длина, режим, presetId, imageSeed, models, sources[], dates).
- Прокси ошибок GPU / Ollama / пустой RAG в понятные HTTP-коды.
- Джобы: статус в БД; висящие после рестарта Nest → `failed`.
- Open folder: `explorer.exe` для локального FS.
- Файл книги копируется в storage **до** вызова индексации Python.

## Файлы и модули

- `backend/prisma/schema.prisma`
- `backend/src/library/`
- `backend/src/posts/`
- `backend/src/presets/`
- `backend/src/generate/`
- `backend/src/storage/storage.provider.ts`
- `backend/src/storage/local-fs.provider.ts`
- `backend/src/storage/s3.provider.ts`
- `backend/src/ai/python.client.ts`

## Решения этапа

- Prisma + SQLite.
- Job в памяти процесса + статус в БД (без Redis).
- `STORAGE_DRIVER=fs|s3`.
- UI не ходит в FastAPI.
- Состав папки поста:
  - `post.md`
  - `post.txt`
  - `image.png`
  - `image_prompt.txt`
  - `meta.json`

## Что сознательно не делается

- Красивый UI (только API).
- Авторизация.
- Редактор поста.

## Как проверяется

REST-клиент без UI:

1. Upload PDF → статус книги доходит до `ready`.
2. Create preset.
3. `POST /generate/posts` → SSE до `image_done`.
4. В SQLite есть пост; на диске папка с пятью файлами.
5. Open-folder открывает Explorer.
6. Delete книги чистит storage и векторы (через Python).
7. `STORAGE_DRIVER=s3` — тот же сценарий, объекты в MinIO.

## Критерий приёмки

Полный цикл библиотека → генерация → файлы + БД работает через Nest. Переключение FS/S3 не ломает контракт API.
