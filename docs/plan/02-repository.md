# Структура репозитория

Монорепо **папками без Turborepo**. `pnpm-workspace.yaml` только на `frontend` + `backend`. Python — отдельный venv в `ai-service/.venv`. Turborepo / Nx не используем.

Артефакты генерации **не** в git. Рабочие данные — под `data/` (gitignore). Прототип генерации картинок остаётся в `example/` и **не** является приложением.

Веса Hugging Face **не** в репозитории и не в `data/`. Каталог `D:/huggingface_cache` снаружи git; путь только через env.

## Сейчас (2026-10-04)

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
    ARCHITECTURE.md
    GPU.md
    RAG.md
    DECISIONS.md
    plan/
  docker/
    docker-compose.yml       # qdrant + minio
  frontend/
    src/
      pages/                 # library, create, images, history, presets, config
      components/            # в том числе reference-board для Qwen
      api/
      hooks/
  backend/
    prisma/schema.prisma     # Book, Post, StylePreset, ImagePromptPreset,
                             # TonePreset, GenerationJob, ImageBatch, ImageJob
    src/
      library/
      posts/
      presets/
      image-presets/
      tone-presets/
      images/
      generate/              # общая очередь постов и картинок
      config/
      storage/               # fs | s3
      ai/python.client.ts
  ai-service/
    pyproject.toml           # extra qwen — второе окружение
    .venv/                   # FastAPI, Flux, RAG, OCR
    .venv-qwen/              # только процесс Qwen-Image, gitignore
    app/
      api/                   # health, generate, gpu, rag, pipeline, config
      gpu/
      image/                 # flux_pipeline, qwen_runner, qwen_worker
      llm/
      ocr/
      rag/
      pipeline/
      prompts/
    tests/
  scripts/
    start-dev.ps1
    check-gpu.ps1
    setup-qwen-venv.ps1
    download-bge-m3.ps1
    download-ocr.ps1
    download-qwen-image.ps1
  example/                   # CLI-прототип Flux, не часть сервиса
  data/                      # gitignore: library, posts, images, sqlite
```

## Границы ответственности по папкам

| Папка | Владеет |
|-------|---------|
| `frontend/` | UI, SSE-клиент, никаких прямых вызовов Ollama/Qdrant/FastAPI |
| `backend/` | REST для UI, SQLite, StorageProvider, прокси к Python, джобы |
| `ai-service/` | LLM, Flux, Qwen-Image, OCR, RAG, GpuManager |
| `docker/` | Qdrant, MinIO — без GPU |
| `docs/` | Архитектура и план |
| `data/` | Книги, посты и пачки картинок |
| `scripts/` | Локальный запуск и диагностика GPU |
| `example/` | Старый CLI; не импортировать в `ai-service` |
