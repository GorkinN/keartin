# Архитектура

Факт по коду на 2026-10-04. Этапы 0–8 плана выполнены (этапы 7 и 8 ждут приёмки). Этапов 9–11 в коде нет. GPU: [GPU.md](GPU.md). RAG: [RAG.md](RAG.md). Исходный эскиз: [plan/01-architecture.md](plan/01-architecture.md).

## Принцип

Браузер говорит **только с NestJS**. Python FastAPI — изолированный AI-воркер с эксклюзивным доступом к GPU. Docker — только Qdrant и MinIO (без GPU). Ollama и Flux живут на хосте Windows.

Прямой вызов UI → FastAPI запрещён. Продуктовый цикл — REST/SSE Nest `:3000`. FastAPI остаётся внутренним воркером.

## Что есть

- Health, Ollama text, Flux NF4 и Qwen-Image-2.1, GpuManager, Qdrant, RAG с OCR сканов и оглавлением, пайплайн поста, Nest API.
- Картинка поста — Flux или Qwen. Пост можно собрать без картинки (`withImage: false`).
- Отдельный экран картинок: пачка до 20 PNG, у Qwen ещё референсы, маска и прозрачный фон.
- UI: библиотека, темы, создание поста, картинки, история (посты и картинки), шаблоны (текст, картинка, тон), конфигурация, тёмная тема. Vite `:5173` проксирует Nest. Браузер в FastAPI не ходит. Авторизации и редактора поста нет.
- Пока GPU занят, формы показывают «GPU занят: …». Кнопки постановки в очередь от этого не гаснут: задание ждёт тот же lock.

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
| `GET/POST/PATCH/DELETE` | `/tone-presets` | `name` (после trim до 120 символов), `text` (после trim от 1 до 200). Это заготовка фразы тона. У поста своего `tonePresetId` нет: в пост пишется строка `tone` |
| `POST` | `/topics` | `{ area?, bookIds? }` → `201` карточка поиска. Область 2–200 символов или 1–5 книг в `ready`. Хотя бы одно из двух. Книга не найдена — `404`, не `ready` — `409` |
| `GET` | `/topics` | `{ items }` — до 30 успешных списков, новые сверху. Повторный заход сеть не трогает |
| `DELETE` | `/topics/:id` | `204`. Нет записи — `404` |
| `GET` | `/config` | прокси `GET /config` FastAPI: llm, embed, flux, qwen (`python_ready`, список GGUF), ocr. Менять модели из UI нельзя. FastAPI недоступен — `502` |
| `POST` | `/images` | multipart: поля формы и файлы `references` (до 10) и `mask` (0 или 1). PNG, JPEG или WebP, файл до 25 МБ. `202 { jobId, batchId }`. Референсы, маска и `transparent` только у `model=qwen`; маске нужен референс; вместе с маской не больше 10 файлов |
| `GET` | `/images`, `/images/:id` | список пачек и одна. У пачки `status`: `queued \| running \| ready \| failed \| cancelled` |
| `GET` | `/images/:id/files/:index` | `image/png` файла пачки |
| `POST` | `/images/:id/open-folder` | как у поста: `explorer.exe` только для `fs` и Windows |
| `DELETE` | `/images/:id` | БД и папка. Пачка в очереди или в генерации — `409` |
| `GET` | `/images/queue` | `{ cooldownUntil, items }`. Та же минутная пауза, что у постов |
| `DELETE` | `/images/queue/:jobId` | Только `queued`. Пачка удаляется вместе с джобой |
| `GET` | `/images/jobs/:jobId/events` | SSE пачки |
| `POST` | `/images/jobs/:jobId/cancel` | `202`. Джоба не `running` — `409` |
| `GET` | `/posts`, `/posts/:id` | список и карточка, новые сверху |
| `GET` | `/posts/:id/image` | `image/png` по `imageKey` через StorageProvider. Пустой ключ или нет файла — `404` |
| `DELETE` | `/posts/:id` | БД и папка. Пост в очереди или во время генерации — `409` |
| `POST` | `/posts/:id/open-folder` | `200`. `explorer.exe` только при `STORAGE_DRIVER=fs` и Windows. Иначе `400` |
| `POST` | `/generate/posts` | `202 { items: [{ jobId, postId }] }`. Плюс `count` `1..20` (дефолт 1), `withImage` (дефолт true), `imageModel` `flux \| qwen` (дефолт flux), `gguf` (имя файла, только у Qwen), `temperature` `0..2` или пусто. `withImage: false` ставит джобу `text`. Если `seed` задан и `count` > 1, у поста с индексом `i` seed `seed + i` по модулю 2³¹ |
| `GET` | `/generate/queue` | `{ cooldownUntil, items }`. `items`: `queued` и `running` по `createdAt`, с `topic` и `kind`. `cooldownUntil` — ISO-время конца минутной паузы или `null` |
| `DELETE` | `/generate/queue/:jobId` | Только `queued`. Черновик полного поста удаляется вместе с джобой. Иначе `409`, нет джобы — `404` |
| `GET` | `/generate/posts/:id/events` | SSE. Пока джоба `queued`, первым событием `status` `{ phase: "queued" }`, дальше поток Python |
| `POST` | `/posts/:id/regenerate-text` | Новый job в ту же очередь, тот же URL событий. Перезаписывает `post.md` / `post.txt`, картинку не трогает |
| `POST` | `/posts/:id/regenerate-image` | Тело `{ seed?, imagePresetId?, imageModel?, gguf? }`. Джоба встаёт в очередь. Нет `seed` — случайный. Нет `imagePresetId` — стиль поста как есть; `null` снимает стиль; строка проверяется и пишется на пост до джобы. `imageModel` меняет repo в `fluxModel` и проверяет, что текущие размер и steps модели подходят. `gguf` только у Qwen. Пишет `image.png`, `image_prompt.txt` и seed. Текст не трогает |
| `POST` | `/generate/posts/:id/cancel` | `202 { jobId, status: "cancelled" }`. Джоба не `running` — `409`. Нет джобы — `404`. Хвост очереди после отмены продолжается |
| `GET` | `/gpu/status` | прокси FastAPI: `{ locked, tenant, ollama_models, vram_used_mb }`. FastAPI недоступен — `502` |

Очередь одна на посты (`full`, `text`, повтор картинки) и на пачки картинок. Воркер берёт более раннюю по `createdAt`. Следующую берёт только после записи файлов текущей. Если хвост не пуст, он зовёт `POST /gpu/settle` (выгрузка Flux/OCR и Ollama, ожидание VRAM; если лок занят — пропуск) и ждёт 60 секунд. Пустой хвост паузу не включает. Снятие всего хвоста прерывает паузу. Ошибка или отмена одного задания хвост не останавливает.

`rag` без книг или с книгой не в `ready` — `409` до вызова Python. Неизвестный пресет или книга — `404`. FastAPI недоступен до старта — `502`, строка поста не создаётся. Пустой RAG, Ollama и GPU приходят событием `error` уже по-русски, джоба `failed`. Запись файлов при сбое диска или MinIO — «Не удалось записать файлы поста.» На одном посте вторая джоба (`queued` или `running`) — `409`. Занятый GPU кнопку очереди не блокирует. Рестарт помечает `running` и их черновики как `failed` («прервано перезапуском»); `queued` и их черновики остаются, воркер продолжает хвост без досиживания паузы.

Отмена не рвёт SSE Nest→Python. Nest зовёт `POST /pipeline/jobs/:id/cancel`. Во время текста httpx-стрим к Ollama закрывается, Flux не стартует. Если Flux уже считает, прогон доходит до конца, PNG в пост не пишется, событие `cancelled` `{ message: "отменено" }`. `gpu.release` остаётся в `finally`. Черновик, который ещё не `ready`, становится `failed`; уже готовый пост остаётся `ready`, старые файлы на месте. Если `text_done` уже записан в SQLite, текст в строке остаётся, папку поста отмена не создаёт.

Успешный SSE сам записывает пост. `post.md` и `post.txt` — один текст. Папка `data/posts/YYYY-MM-DD_slug/` (транслит темы, при коллизии `-2`). Ключи в SQLite относительные (`posts/.../image.png`), одни и те же для fs и s3. `meta.json` дублирует поля поста. `models.llm` берётся из `LLM_MODEL`. `models.flux` — repo id выбранной модели картинки (`FLUX_MODEL_ID` или `QWEN_IMAGE_MODEL_ID`), рядом поле `gguf`.

Пачка картинок: `data/images/YYYY-MM-DD_slug/` — `{index}.png`, `prompt.txt`, `meta.json`, у Qwen ещё `ref-0.png` … и `mask.png`. Джоба пачки: `queued | running | succeeded | failed | cancelled`. Сама пачка по успеху становится `ready`.

`STORAGE_DRIVER=fs` (дефолт) пишет в `data/`. `s3` — бакет `S3_BUCKET` (дефолт `library`) на `MINIO_ENDPOINT`, path-style, ключи те же. Перед индексацией при s3 Nest кладёт файл в `data/tmp/index/<bookId>/`: Python принимает только локальный путь.

## Темы поста

Экран `/topics`. Nest не вызывает Ollama.

`POST /topics` с областью качает RSS Google News (`hl=ru`, `gl=RU`, `ceid=RU:ru`). В URL попадает только область после trim. Таймаут 15 с, не больше 24 заголовков. Пустой канал — `502` «По этому запросу заголовков не нашлось.» Сеть или не-RSS — `502` «Не удалось получить заголовки.» Если область задана, пустой RSS не заменяется оглавлением.

Книги читаются из `Book.outline`. Чанки и полный текст наружу не уходят. Области нет и пункты пустые — `400` «В выбранных книгах нет оглавления.», без сети и без LLM.

Дальше Nest зовёт `POST /topics/rank`. Один chat под `acquire("llm")`, `think: false`, temperature `0.3`. Ответ — 8–12 объектов `{ title, reason }` на русском. Меньше 8 или неразобранный текст — `502` «Модель не собрала список тем.» Тот же текст, если FastAPI недоступен. Успех пишется в `TopicSearch` (`area`, `bookIds`, `topics`). Неудача строку не создаёт. Сырые заголовки RSS не хранятся.

Клик по теме или по пункту оглавления открывает `/create?topic=…`. Мастер подставляет строку один раз и сам переключает вкладку «Параметры».

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
- `acquire("llm")` выгружает Flux, если он ещё в процессе FastAPI. Пока идёт Qwen, лок занят тем же тенантом `flux`, и LLM ждёт конца этого процесса. После текста unload Ollama не форсируется.

## Генерация картинки

- `POST /generate/image` и `POST /generate/image/stream` — одна картинка. `POST /generate/images/stream` — пачка, её зовёт Nest для экрана «Картинки».
- Модель: `flux` или `qwen`. Qwen считается в процессе `ai-service/.venv-qwen` (`python -m app.image.qwen_worker`) под тем же тенантом `flux`. Отдельного тенанта у Qwen нет. После выхода процесса родитель ждёт свободную VRAM.
- Flux: сторона 256–1024, steps 20–28. Qwen: сторона 256–2752, steps 20–50. Размер кратен 16. Дефолт поста 1024×1024 и 28 steps у Flux, 40 у Qwen. Дефолт пачки картинок: 20 steps у Flux, 40 у Qwen.
- Референсы, маска и прозрачный фон принимает только Qwen.
- `acquire("flux")` всегда выгружает Ollama до загрузки весов.

Подробности весов и offload: [GPU.md](GPU.md).

## GPU

`ai-service/app/gpu/manager.py`: один `asyncio.Lock`. Тенанты `llm` | `flux` | `ocr`. Qwen-Image занимает тенант `flux` отдельным процессом. Захват `flux` или `ocr` выгружает Ollama и другую torch-модель; release выгружает свою. `POST /gpu/settle` делает то же, когда лок свободен, и возвращает `{ ok, skipped }`. Эмбеды `bge-m3` — CPU, lock для них не нужен.

Любой вызов Ollama в обход GpuManager — баг. Правило в `.cursorrules`.

Подробности выгрузки и NF4: [GPU.md](GPU.md).

## Кэш Hugging Face

Переменные только из `.env`:

```
HF_HOME=D:/huggingface_cache
HUGGINGFACE_HUB_CACHE=D:/huggingface_cache/hub
TRANSFORMERS_CACHE=D:/huggingface_cache/transformers
```

Загрузка: `ai-service/app/bootstrap.py` при импорте пакета + дублирование в `scripts/start-dev.ps1`. Хардкод пути запрещён. Docker этот диск не монтирует. Flux, Qwen-Image, OCR и `bge-m3`: `local_files_only=True`.

## RAG

- `POST /rag/index` — `{ path, book_id?, source_name? }` → `202`. Poll `GET /rag/index/{job_id}`: `queued | indexing | ready | error`.
- `POST /rag/search` — `{ query, book_ids[], top_k? }` default 10. Пустой `book_ids` — вся коллекция.
- `DELETE /rag/books/{book_id}` — только векторы.
- Payload чанка: `book_id`, `chunk_index`, `source_name`, `lang`, `text`. Cosine 1024.
- Эмбеды на CPU, GpuManager не трогаем. Одна индексная джоба за раз (свой lock, не GPU). После чанков фаза `outline`: один вызов LLM под `acquire("llm")` уже без индексного lock. Ошибка оглавления не отменяет `ready`.
- `outline` — JSON-массив коротких пунктов. В поиск и в промпт генерации не входит. Ручной повтор: `POST /library/books/:id/outline`. Пункт в библиотеке открывает мастер поста с этой темой.
- Скан PDF без текстового слоя → OCR DeepSeek-OCR-2 под тенантом `ocr`, текст в `library/<id>/source.txt` рядом с `source.pdf`, дальше обычная индексация. Готовый `source.txt` переиспользуется.

Подробности: [RAG.md](RAG.md).

## Pipeline поста

Один SSE на FastAPI. Ollama только под `acquire("llm")`, картинка только под `acquire("flux")` — и Flux, и процесс Qwen. `acquire("flux")` выгружает Ollama до загрузки весов. Между release LLM и acquire Flux второй запрос ждёт тот же lock. `withImage: false` Nest решает сам и зовёт `POST /pipeline/text/stream`, картинка не стартует.

- `POST /pipeline/stream` — retrieve (если не `general`) → стрим русского текста → английский image prompt той же LLM (`think: false`) → `gpu_unload_llm` → Flux или Qwen → файлы джобы.
- `POST /pipeline/text/stream` — тот же текст без картинки. Пишет только `post.txt`.
- `POST /pipeline/image/stream` — `{ "text", "image_style"? }` → image prompt → Flux или Qwen (`image_model`, `gguf`). `post.txt` не пишет и не меняет. Непустой `image_style` дописывается к тексту поста блоком «Стиль картинки» и уходит только в LLM промпта. Модель картинки получает её английскую строку.

Тело поста: `topic`, `tone` (пусто → «живой, разговорный»), `length` `S|M|L` (около 500 / 1200 / 2500 символов), `emoji` default false, `knowledge_mode` default `rag`, `citations` default false, `structure` `{hooks, body, cta}` default все true, `book_ids`, `top_k` default 10 (1–20), `preset` `{description, examples}` до 5 примеров, `image_style` до 4000 символов, `temperature` или пусто, `image_model` `flux|qwen`, `gguf`. Картинка: `width` / `height` / `steps` / `seed`. `job_id` опционален (`[A-Za-z0-9-]{1,80}`).

SSE: `status` (`start`, `retrieve`, `text`, `image_prompt`, `load_flux`, `generate`, `unload_flux`; в data есть `job_id`), `token` `{"text"}`, `text_done` `{"text","sources"}`, `image_prompt` `{"prompt"}`, `gpu_unload_llm` `{"ok": true}`, `image_progress` `{"step","total"}`, `image_done` `{"path","seed","prompt"}`, `cancelled` `{"message":"отменено"}`, `error` `{"message"}`.

Логи Python и Nest — JSON-строка в stdout: `ts`, `level`, `logger`, `msg`, у пайплайна ещё `job_id`.

Режимы: `general` без retrieval. `rag` без `book_ids` или с 0 хитов — `error` «В выбранных книгах нет подходящих фрагментов.», LLM не вызывается. `rag_plus` с пустым поиском пишет по общим знаниям, без выдуманных цитат. Выключенный блок структуры в промпт не попадает. `citations: false` — в промпт не попадают `source_name`. Хиты режутся по score, пока текст контекста ≤ 10 000 символов. Картинка получает одну английскую строку, без negative.
