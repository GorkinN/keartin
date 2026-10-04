# llm-keartin

Локальный генератор постов для соцсетей: RAG, Ollama и картинка (Flux.1-dev или Qwen-Image-2.1). Браузер говорит только с NestJS; Python FastAPI владеет GPU.

FLUX.1-dev — лицензия non-commercial; для личного локального использования.

**Сейчас:** этапы 0–7 плана выполнены (этап 7 ждёт приёмки). Поверх них в коде есть отдельная генерация картинок, Qwen-Image-2.1, шаблоны тона и экран конфигурации. Этапы 8–11 (темы из сети, озвучка, музыка, видео) записаны в плане и не начаты. План: [docs/plan/README.md](docs/plan/README.md). Архитектура: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Требования

- Windows, Docker Desktop
- Node.js 20+ (скрипты через `npx pnpm`)
- Python 3.11+ (venv собирается на 3.12, если есть `py -3.12`)
- Свободные порты: 3000, 5173, 8000, 6333, 9000, 9001
- Ollama нужна для генерации текста (`qwen3.5:9b-16k`). `/health` без неё всё равно 200 (`ollama: down`)
- Qwen-Image-2.1 — отдельное окружение `ai-service/.venv-qwen` (`.\scripts\setup-qwen-venv.ps1` и `.\scripts\download-qwen-image.ps1`). Без него Flux и текст работают

## Быстрый старт

```powershell
Copy-Item .env.example .env
.\scripts\start-dev.ps1
```

Скрипт поднимает Qdrant и MinIO, применяет миграции Prisma и открывает три окна: FastAPI `:8000`, Nest `:3000`, Vite `:5173`. Повторный запуск не стартует сервис, если порт уже занят. Ollama нужна отдельно. UI: http://127.0.0.1:5173

Проверки:

| Сервис | URL |
|--------|-----|
| Qdrant | http://127.0.0.1:6333/readyz |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |
| FastAPI health | http://127.0.0.1:8000/health |
| NestJS | http://127.0.0.1:3000/health |
| Vite | http://127.0.0.1:5173 |

Продуктовые запросы идут в Nest `:3000`: библиотека, посты, картинки, шаблоны, `GET /config`, `GET /gpu/status`. FastAPI `:8000` — внутренний воркер (текст, картинка, RAG, пайплайн).

Кэш Hugging Face задаётся в `.env` (`HF_HOME`, `HUGGINGFACE_HUB_CACHE`, `TRANSFORMERS_CACHE`). Путь в коде не зашит.

## Структура

- `frontend/` — React + Vite + shadcn: библиотека, создание поста, картинки, история, шаблоны, конфигурация
- `backend/` — NestJS + Prisma SQLite, очередь постов и картинок, StorageProvider
- `ai-service/` — FastAPI, GpuManager, Ollama, Flux, Qwen-Image (отдельный venv), RAG и OCR
- `docker/` — Qdrant и MinIO (`quay.io/minio/minio`; Docker Hub `minio/minio` на этой машине недоступен)
- `docs/` — архитектура, GPU, RAG, решения и план
- `scripts/` — запуск, проверка GPU, скачивание bge-m3, OCR и Qwen-Image
