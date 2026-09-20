# Структура репозитория

Монорепо **папками без Turborepo**. `pnpm-workspace.yaml` только на `frontend` + `backend`. Python — отдельный venv в `ai-service/.venv`. Turborepo / Nx не используем.

Артефакты генерации **не** в git. Рабочие данные — под `data/` (gitignore). Прототип генерации картинок остаётся в `example/` и **не** является приложением.

Веса Hugging Face **не** в репозитории и не в `data/`. Каталог `D:/huggingface_cache` снаружи git; путь только через env.

## Сейчас (после этапа 1)

```
llm-keartin/
  README.md
  .gitignore
  .cursorrules
  .cursor/rules/project.mdc
  pnpm-workspace.yaml
  package.json
  .env.example
  docs/
    ARCHITECTURE.md          # живой документ
    DECISIONS.md
    plan/                    # этот план
  docker/
    docker-compose.yml       # qdrant + minio (quay.io/minio/minio)
  frontend/
    src/
      pages/                 # library, create, history, presets — заглушки
      components/
        layout.tsx
        ui/                  # button, card
      lib/utils.ts
  backend/
    prisma/schema.prisma     # SQLite, без бизнес-моделей
    src/
      app.module.ts
      main.ts
      health/
  ai-service/
    pyproject.toml
    app/
      main.py
      bootstrap.py           # .env + HF_* до импорта HF
      settings.py
      api/health.py
      api/generate.py
      gpu/manager.py         # stub acquire/release
      llm/ollama_client.py
      prompts/text_system.md
  scripts/
    start-dev.ps1
  example/                   # CLI-прототип Flux, не часть сервиса
  data/                      # gitignore
```

Ещё нет (появятся на своих этапах): `frontend/src/api`, `frontend/src/hooks`, Nest-модули library/posts/presets/generate/storage, Python `image/` `rag/` `pipeline/` `tests/`, `scripts/check-gpu.ps1`, `docs/GPU.md`, `docs/RAG.md`.

## Целевое дерево (к этапу 7)

```
llm-keartin/
  README.md
  .gitignore
  .cursorrules
  pnpm-workspace.yaml
  .env.example
  docs/
    ARCHITECTURE.md
    GPU.md                   # этап 2
    RAG.md                   # этап 3
    DECISIONS.md
    plan/
  docker/
    docker-compose.yml
  frontend/
    src/
      pages/
      components/
      api/
      hooks/
  backend/
    prisma/schema.prisma
    src/
      library/
      posts/
      presets/
      generate/
      storage/
  ai-service/
    pyproject.toml
    app/
      main.py
      api/
      gpu/
        manager.py
        nvidia.py
        ollama_unload.py
      llm/ollama_client.py
      image/flux_pipeline.py
      rag/
      pipeline/post_pipeline.py
      prompts/
    tests/
  scripts/
    start-dev.ps1
    check-gpu.ps1
  data/
    library/
    posts/
    sqlite/app.db
```

## Границы ответственности по папкам

| Папка | Владеет |
|-------|---------|
| `frontend/` | UI, SSE-клиент, никаких прямых вызовов Ollama/Qdrant/FastAPI |
| `backend/` | REST для UI, SQLite, StorageProvider, прокси к Python, джобы |
| `ai-service/` | LLM, Flux, RAG, GpuManager |
| `docker/` | Qdrant, MinIO — без GPU |
| `docs/` | Архитектура и план |
| `data/` | Пользовательские книги и посты |
| `scripts/` | Локальный запуск и диагностика GPU |
| `example/` | Старый CLI; не импортировать в `ai-service` |
