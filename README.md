# llm-keartin

Локальный генератор постов для соцсетей: RAG + Ollama + Flux.1-dev. Браузер говорит только с NestJS; Python FastAPI владеет GPU.

FLUX.1-dev — лицензия non-commercial; для личного локального использования.

**Сейчас:** этап 3 выполнен, принят (2026-09-21). Рабочий UI ещё нет. План: [docs/plan/README.md](docs/plan/README.md).

## Требования

- Windows, Docker Desktop
- Node.js 20+ (скрипты через `npx pnpm`)
- Python 3.11+ (venv собирается на 3.12, если есть `py -3.12`)
- Свободные порты: 3000, 5173, 8000, 6333, 9000, 9001
- Ollama нужна для генерации текста (`qwen3.5:9b-16k`). `/health` без неё всё равно 200 (`ollama: down`)

## Быстрый старт

```powershell
Copy-Item .env.example .env
.\scripts\start-dev.ps1
```

Три терминала из корня репозитория:

```powershell
# 1. AI-сервис
.\ai-service\.venv\Scripts\python -m uvicorn app.main:app --reload --reload-dir ai-service/app --app-dir ai-service --host 127.0.0.1 --port 8000

# 2. NestJS
npx pnpm@9.15.9 --filter backend start:dev

# 3. Frontend
npx pnpm@9.15.9 --filter frontend dev
```

Проверки:

| Сервис | URL |
|--------|-----|
| Qdrant | http://127.0.0.1:6333/readyz |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |
| FastAPI health | http://127.0.0.1:8000/health |
| FastAPI текст | `POST /generate/text` и `POST /generate/text/stream` (curl/httpx, не из UI) |
| FastAPI картинка | `POST /generate/image` и `POST /generate/image/stream`; `GET /gpu/status` |
| FastAPI RAG | `POST /rag/index`, `GET /rag/index/{job_id}`, `POST /rag/search`, `DELETE /rag/books/{book_id}` |
| NestJS | http://127.0.0.1:3000/health |
| Vite | http://127.0.0.1:5173 (заглушки экранов) |

Проверка стрима (Ollama запущена, порт `:8000` свободен или уже занят этим сервисом):

```powershell
.\ai-service\.venv\Scripts\python -c "import httpx; r=httpx.post('http://127.0.0.1:8000/generate/text', json={'topic':'привычка читать 20 минут','keep_alive':0}, timeout=None, trust_env=False); print(r.json()['text'])"
```

`--reload-dir ai-service/app` нужен, чтобы WatchFiles не смотрел весь репозиторий (`node_modules`, `example/`, venv).

Кэш Hugging Face задаётся в `.env` (`HF_HOME=D:/huggingface_cache`). Не используйте дефолтный `%USERPROFILE%\.cache\huggingface`.

## Структура

- `frontend/` — React + Vite + shadcn (заглушки)
- `backend/` — NestJS + Prisma SQLite (пока только health)
- `ai-service/` — FastAPI, GpuManager, Ollama text, Flux image, RAG
- `docker/` — Qdrant и MinIO (`quay.io/minio/minio`; Docker Hub `minio/minio` на этой машине недоступен)
- `docs/plan/` — план разработки
- `docs/GPU.md` — выгрузка Ollama, NF4, порог VRAM
- `docs/RAG.md` — парсеры, bge-m3, Qdrant, API индексации
