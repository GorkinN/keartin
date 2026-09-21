# GPU

Факт после этапа 2 (принят 2026-09-21). Владелец GPU — процесс FastAPI. Один `GpuManager`, один `asyncio.Lock`. Тенанты: `llm` | `flux`. Не `taskkill` Ollama. Flux не в Docker и не через ComfyUI.

## Порог VRAM

`GPU_FREE_MB_THRESHOLD` (дефолт 500) — целевой idle used. На этой Windows-машине простой RTX 4070 уже ~1.1 ГБ (рабочий стол / драйвер), поэтому `used < 500` почти никогда не выполняется.

`wait_vram_released` считает карту свободной, если used ниже порога **или** ниже 4096 МБ (нет резидентной LLM/Flux). После выгрузки Ollama used падает с ~7.6 ГБ до ~1.2 ГБ.

## Выгрузка Ollama

Перед Flux:

1. `POST /api/generate` с `keep_alive: 0` по каждой модели из `GET /api/ps`
2. fallback `ollama stop <name>`
3. poll `ollama ps` пустой + `nvidia-smi`

Текстовый `/generate/text` после ответа **не** форсирует unload (как этап 1: `keep_alive` из запроса, дефолт `5m`). Выгрузка — только при `acquire("flux")`.

## Flux

- Repo: `FLUX_MODEL_ID=black-forest-labs/FLUX.1-dev` из `HF_HOME`. `local_files_only=True`. Снимок без LICENSE/README всё равно принимается, если есть `model_index.json` и `transformer/`.
- **NF4** (transformer + T5) + `enable_model_cpu_offload()`. `enable_sequential_cpu_offload()` с bitsandbytes на T5 даёт `Cannot copy out of meta tensor`.
- `FLUX_QUANT=gguf` + `FLUX_MODEL_PATH` — запасной путь в том же модуле. NF4 на этой машине загрузился.
- Не FP16/BF16 пайплайн, не BnB8, не Flux в Docker.
- После generate: `del pipe`, `gc.collect()`, `torch.cuda.empty_cache()`, `ipc_collect()`.

Дефолт API: 1024×1024, 28 steps, `guidance_scale=3.5`, seed в ответе. PNG в `data/tmp/` + `image_base64`.

## Torch CUDA

Колесо не с PyPI (там CPU). В venv:

```powershell
.\ai-service\.venv\Scripts\python -m pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu126
.\ai-service\.venv\Scripts\python -m pip install -e .\ai-service --extra-index-url https://download.pytorch.org/whl/cu126
```

Проверка: `GET /health` → `cuda: ok`.

## Проверка

```powershell
.\scripts\check-gpu.ps1
```

Сценарий: загрузить LLM (`keep_alive` 5m) → `POST /generate/image` → во время Flux `ollama ps` пуст → после ответа used ~idle.
