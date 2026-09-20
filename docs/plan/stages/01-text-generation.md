# Этап 1. Локальная генерация текста

**Статус:** выполнен, принят (2026-09-20)  
**Зависимости:** [этап 0](00-scaffold.md) — выполнен 2026-09-20  
**Следующий этап:** [02-image-gpu.md](02-image-gpu.md)

## Отчёт

### Сделано

- `ai-service/app/llm/ollama_client.py`: `/api/chat` и `/api/generate`, разбор NDJSON, `think: false`.
- `POST /generate/text` — JSON `{ text, model }`.
- `POST /generate/text/stream` — SSE `token` (`{"text"}`) затем `done` (`{"ok": true}`).
- Системный промпт `ai-service/app/prompts/text_system.md`.
- Settings: `LLM_MODEL`, `LLM_NUM_CTX`, `LLM_KEEP_ALIVE`. Тело запроса: `prompt` или `topic`, опционально `temperature`, `keep_alive`.
- Ollama вызывается только внутри `GpuManager.acquire("llm")` / `release()` (lock всё ещё stub).
- Нормализация `OLLAMA_HOST`: системный bind `0.0.0.0` → клиентский `http://127.0.0.1:11434`.
- httpx к localhost с `trust_env=False` (не ходить в HTTP_PROXY).
- NestJS и UI не трогали.

### Как проверить

Ollama запущена, в `ollama list` есть `qwen3.5:9b-16k`. FastAPI на `:8000`.

```powershell
.\ai-service\.venv\Scripts\python -c "import httpx; r=httpx.post('http://127.0.0.1:8000/generate/text/stream', json={'topic':'привычка читать 20 минут','keep_alive':0}, timeout=None, trust_env=False); print(r.status_code); print(r.text[:1500])"
```

| Проверка | Факт 2026-09-20 |
|----------|-----------------|
| `GET /health` | `ollama: ok` после нормализации хоста |
| `POST /generate/text/stream` тема «привычка читать 20 минут» | 200, сотни `token`, затем `done`, русский черновик |
| `ollama ps` во время генерации | `qwen3.5:9b-16k`, CONTEXT 8192, GPU |
| `keep_alive: 0` затем `ollama ps` | пусто |
| `POST /generate/text` короткий prompt + `keep_alive: 0` | `{"text":"...","model":"qwen3.5:9b-16k"}` |
| `{}` без prompt/topic | 422 |

Приёмка пользователем (2026-09-20): `GET /health` → `ollama: ok`; стрим `token` с русским текстом; `ollama ps` пуст после `keep_alive: 0`.

### Не вошло / отложено

- Полный GpuManager (`ollama stop`, poll `nvidia-smi`) — этап 2.
- RAG-промпт, пресеты, Flux, Nest-прокси, UI стрима.
- Отдельный unload-endpoint: хватает `keep_alive: 0` в теле.

Архитектуру не ломали. Новые факты — в [docs/DECISIONS.md](../../DECISIONS.md) (блок этапа 1).

---

## Микро-план (зафиксирован до кода)

Ниже — исходный микро-план. Факт реализации — в отчёте выше.

### Цель

Стрим токенов из Ollama через FastAPI. Без RAG и без картинки.

### Что сознательно не делается

- GpuManager (полный) — только если нужен тонкий вызов keep_alive:0 для проверки выгрузки.
- Сборка RAG-промпта.
- Пресеты стилей.
