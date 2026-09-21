# Этап 2. Flux + GpuManager

**Статус:** выполнен, принят (2026-09-21)  
**Зависимости:** [этап 1](01-text-generation.md) (умеем выгрузить LLM)  
**Следующий этап:** [03-rag.md](03-rag.md)

## Отчёт

### Сделано

- CUDA torch `2.13.0+cu126` + diffusers/bitsandbytes в `ai-service/pyproject.toml` и venv. `GET /health` → `cuda: ok`.
- `GpuManager`: `acquire("llm"|"flux")` / `release()`. Перед Flux — unload Ollama (`keep_alive: 0` по `ps`, затем `ollama stop`), poll VRAM. Перед LLM — unload Flux, если загружен.
- `POST /generate/image` (JSON) и `POST /generate/image/stream` (SSE `status` / `image_progress` / `done`).
- Flux.1-dev NF4 + `enable_model_cpu_offload()` из `HF_HOME`, `local_files_only=True`. Ветка GGUF в том же модуле.
- PNG в `data/tmp/` + `image_base64`, seed в ответе.
- `GET /gpu/status`, `scripts/check-gpu.ps1`, [docs/GPU.md](../../GPU.md).

### Как проверить

Ollama запущена. FastAPI на `:8000`.

```powershell
.\scripts\check-gpu.ps1
.\ai-service\.venv\Scripts\python -c "import httpx; c=httpx.Client(timeout=None, trust_env=False); c.post('http://127.0.0.1:8000/generate/text', json={'prompt':'ok','keep_alive':'5m'}); print(c.get('http://127.0.0.1:8000/gpu/status').json()); r=c.post('http://127.0.0.1:8000/generate/image', json={'prompt':'a cat holding a sign that says hello world','width':512,'height':512,'steps':20}); print(r.status_code, {k:r.json()[k] for k in r.json() if k!='image_base64'}); print(c.get('http://127.0.0.1:8000/gpu/status').json())"
```

| Проверка | Факт 2026-09-20 | Приёмка 2026-09-21 |
|----------|-----------------|-------------------|
| `GET /health` | `cuda: ok`, `hf_home` = `D:\huggingface_cache` | — |
| После текста `keep_alive: 5m` | `ollama_models: [qwen3.5:9b-16k]`, VRAM ~7670 МБ | `qwen3.5:9b-16k`, 7574 МБ |
| `POST /generate/image` 512² / 20 steps | 200, PNG в `data/tmp/`, seed в ответе | 200, `data/tmp/flux-20260921_212818-652960761.png`, seed `652960761` |
| После картинки | `ollama_models: []`, VRAM ~1208 МБ | `[]`, 1187 МБ |
| Кэш профиля | `%USERPROFILE%\.cache\huggingface` не создан | — |

### Не вошло / отложено

- Промпт картинки из текста поста — этап 4.
- Nest-прокси, UI, StorageProvider / SQLite.
- Генерация 1024×1024/28 steps в приёмке не гоняли (тот же путь, дольше). Smoke: 512×512/20.
- GGUF-файл не скачивали: NF4 сработал.

Архитектуру не ломали. Факты — в [docs/DECISIONS.md](../../DECISIONS.md) и [docs/GPU.md](../../GPU.md).

---

## Микро-план (зафиксирован до кода)

Цель: одна картинка Flux с выгрузкой LLM до старта и Flux после. `example/image-gen/generate.py` (BF16) не копируем.

### Файлы

Создать: `gpu/nvidia.py`, `gpu/ollama_unload.py`, `image/flux_pipeline.py`, `api/gpu.py`, `docs/GPU.md`, `scripts/check-gpu.ps1`.

Изменить: `gpu/manager.py`, `api/generate.py`, `settings.py`, `ollama_client.py`, `pyproject.toml`, `ARCHITECTURE.md`, `DECISIONS.md`.

### GpuManager

- `acquire("llm")`: lock → unload Flux если был → tenant=`llm`. После текста unload Ollama не форсировать.
- `acquire("flux")`: lock → unload Ollama → poll `ps` пуст и VRAM idle → tenant=`flux`.
- `release()` при `flux`: unload Flux + poll. При `llm`: только lock.
- Не `taskkill` Ollama.

### Flux

- NF4 + CPU offload из `HF_HOME`. GGUF — ветка `FLUX_QUANT=gguf`.
- Дефолт 1024×1024, 28 steps, seed в ответе.
- PNG в `data/tmp/` + base64.

### Контракты

`POST /generate/image` — `{ prompt, width?, height?, steps?, seed? }` → `{ path, seed, width, height, steps, model, image_base64 }`.

`POST /generate/image/stream` — SSE `status`, `image_progress`, `done`, `error`.

`GET /gpu/status` — `{ locked, tenant, ollama_models, vram_used_mb }`.

### Сознательно не делается

Промпт из текста поста, RAG, Nest, UI, StorageProvider, прогрев LLM после Flux.

---

## Цель (исходная)

Сгенерировать картинку Flux.1-dev с **гарантированной** выгрузкой LLM из VRAM до старта и выгрузкой Flux после. Самый опасный этап по железу.

## Что сознательно не делается

- Связка «текст поста → промпт картинки» (это этап 4).
- Сохранение в StorageProvider / SQLite.
- UI прогресса.

## Критерий приёмки

Одна картинка на диске/в ответе. LLM не живёт в VRAM одновременно с Flux. После генерации карта почти свободна. Если NF4 на Windows падает — зафиксировать и включить GGUF-путь в том же этапе, не откладывая.
