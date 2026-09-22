# Этап 5. NestJS-бэкенд

**Статус:** выполнен, принят (2026-09-22)  
**Зависимости:** [этап 4](04-pipeline.md)  
**Следующий этап:** [06-frontend.md](06-frontend.md)

## Отчёт

### Сделано

- Prisma: `Book`, `Post`, `StylePreset`, `GenerationJob`. Миграция `backend/prisma/migrations/20260922180000_stage5`.
- REST библиотеки, пресетов, постов и генерации, как в микро-плане. SSE `GET /generate/posts/:id/events` отдаёт события Python без переименования.
- `StorageProvider`: `LocalFsProvider` и `S3Provider` (`STORAGE_DRIVER=fs|s3`). При s3 файл для `POST /rag/index` сначала пишется в `data/tmp/index/<bookId>/`.
- Успешный полный SSE пишет пять файлов и строку поста. `post.md` и `post.txt` — один текст. Повтор текста не трогает картинку, повтор картинки не передаёт старый seed.
- `POST /posts/:id/open-folder` отвечает `200` и на Windows при `STORAGE_DRIVER=fs` открывает Explorer. При `s3` — `400`.
- Рестарт Nest: висящие джобы `failed`, книги в `indexing` — `error`.
- Контракт — в [docs/ARCHITECTURE.md](../../ARCHITECTURE.md). Решения — в [docs/DECISIONS.md](../../DECISIONS.md).

### Как проверить

Нужны Nest `:3000`, FastAPI `:8000`, Qdrant. Для S3 — запущенный Docker и MinIO. В PowerShell `curl` — это `Invoke-WebRequest`; для тел и SSE нужен `curl.exe`.

```powershell
npx pnpm@9.15.9 --filter backend prisma:deploy
npx pnpm@9.15.9 --filter backend start
```

1. `POST /library/books` с PDF или TXT → `202`, затем `GET /library/books/:id` доходит до `ready`.
2. `POST /presets` с `name`.
3. `POST /generate/posts` (`knowledgeMode: rag`, `bookIds` этой книги) → `202 { jobId, postId }`. `curl.exe -N` на `/generate/posts/:jobId/events` до `image_done`.
4. В SQLite есть пост; на диске `data/posts/YYYY-MM-DD_slug/` с пятью файлами. `post.md` и `post.txt` совпадают.
5. `POST /posts/:id/open-folder` открывает Explorer.
6. `DELETE /library/books/:id` убирает папку и векторы. Пост остаётся.
7. `STORAGE_DRIVER=s3` (и `S3_*` из `.env.example`) — тот же сценарий, объекты в бакете `library`. `open-folder` отвечает `400`.

Приёмка 2026-09-22, TXT «цена и спрос», `rag`, длина S, картинка 512×512 / 20 steps:

- `fs`: upload `202` → `ready 1/1` → SSE до `image_done` (текст 671 символ, seed `976798591`, PNG 391 КБ). Папка `data/posts/2026-09-22_tsena-i-spros`, пять файлов, `post.md` = `post.txt`. `open-folder` → `200`. Удаление книги убрало `data/library/<id>` и векторы; пост остался `ready`.
- `s3`: тот же цикл, объекты в бакете `library` (`posts/2026-09-22_tsena-i-spros-2`, PNG 205 КБ). `open-folder` → `400`. После удаления книги ключей `library/<id>/` нет, хитов в Qdrant 0, пост на месте.

До этого без GPU: CRUD пресета в UTF-8, `400` / `404` / `409`, `502` при выключенном FastAPI (книга остаётся `error`, файл и `meta.json` на диске).

### Не вошло / отложено

- UI, CORS, отмена джобы, `409` на второй параллельный generate. Это этапы 6–7.
- EventSource сам переподключается, когда сервер закрывает поток. Клиент этапа 6 должен закрывать источник на `image_done` и `error`.

---

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
