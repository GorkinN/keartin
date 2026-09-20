# Этап 0. Каркас проекта

**Статус:** выполнен (2026-09-20)  
**Зависимости:** нет  
**Следующий этап:** [01-text-generation.md](01-text-generation.md)

## Отчёт

### Сделано

- Монорепо: `frontend/`, `backend/`, `ai-service/`, `docker/`, `scripts/start-dev.ps1`.
- Корневые `README.md`, `.gitignore`, `.env.example`, `.cursorrules`, `.cursor/rules/project.mdc`, `pnpm-workspace.yaml`.
- `.env`: `HF_HOME=D:/huggingface_cache` (+ hub / transformers). `ai-service/app/bootstrap.py` грузит `.env` при импорте пакета.
- Compose: Qdrant `qdrant/qdrant:v1.13.4` на `:6333`, MinIO `quay.io/minio/minio` на `:9000` / `:9001`.
- NestJS 11: только `GET /health`. Prisma SQLite, схема без бизнес-моделей.
- FastAPI: `GET /health` → `status`, `python`, `cuda`, `ollama`, `qdrant`, `hf_home`. HTTP 200, если процесс жив.
- Vite + React + Tailwind + shadcn: заглушки Библиотека / Создать / История / Пресеты.
- Stub `GpuManager`: `acquire(tenant)` / `release()`, in-memory lock.
- Python 3.12 venv в `ai-service/.venv`. Зависимости только в `pyproject.toml`. Torch не ставили.
- Живые документы: [docs/ARCHITECTURE.md](../../ARCHITECTURE.md), [docs/DECISIONS.md](../../DECISIONS.md).

### Как проверить

```powershell
Copy-Item .env.example .env
.\scripts\start-dev.ps1
```

Три терминала из корня (pnpm через `npx pnpm@9.15.9`): FastAPI `:8000`, Nest `:3000`, Vite `:5173`.

| URL | Факт приёмки 2026-09-20 |
|-----|-------------------------|
| http://127.0.0.1:6333/readyz | `all shards are ready` |
| http://127.0.0.1:8000/health | `200`, `cuda: skipped`, `qdrant: ok`, `hf_home` = `D:\huggingface_cache` |
| http://127.0.0.1:3000/health | `{"status":"ok","service":"backend"}` |
| http://127.0.0.1:5173 | четыре заглушки экранов |
| http://127.0.0.1:9001 | консоль MinIO (`minioadmin` / `minioadmin`) |

`ollama: down` при выключенной Ollama — норма: health всё равно 200.

### Не вошло / отложено

- Ollama generate, Flux, парсеры, Prisma Book/Post, настоящий UI.
- `ai-service` без `llm/`, `image/`, `rag/`, `pipeline/`.
- Nest без модулей library/posts/presets/generate/storage.
- `scripts/check-gpu.ps1` — этап 2.
- `example/` не переносили.

Архитектуру не ломали. Решения этапа 0 (Python 3.12, Nest 11, MinIO с Quay, health 200) — в [docs/DECISIONS.md](../../DECISIONS.md).

---

## Микро-план (зафиксирован до кода)

Ниже — исходный микро-план. Факт реализации — в отчёте выше.

### Цель

Пустой монорепо поднимается локально: Docker (Qdrant, MinIO), NestJS `/health`, FastAPI `/health`, Vite, README и черновик архитектуры. Генерации нет.

### Что сознательно не делается

- Вызовы Ollama generate.
- Загрузка Flux.
- Парсеры книг.
- Prisma-модели Book/Post.
- Реальные экраны UI.
