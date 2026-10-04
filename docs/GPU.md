# GPU

Факт по коду на 2026-10-04. Владелец GPU — процесс FastAPI. Один `GpuManager`, один `asyncio.Lock`. Тенанты: `llm` | `flux` | `ocr`. Qwen-Image-2.1 считается отдельным процессом под тенантом `flux`. Не `taskkill` Ollama. Flux и Qwen не в Docker и не через ComfyUI.

## OCR

Тенант `ocr` — DeepSeek-OCR-2 (~3B, bf16) для сканов PDF. Acquire: выгрузить Flux, все модели Ollama, дождаться VRAM. Release: `to("cpu")`, `del`, `gc.collect()`, `empty_cache()`, снова ждать VRAM. `acquire("llm")` и `acquire("flux")` выгружают OCR, если она осталась в памяти. Lock держится на всю книгу; UI показывает «GPU занят: распознавание скана».

`GET /gpu/status` (FastAPI и тот же путь на Nest): `locked`, `tenant`, `ollama_models`, `vram_used_mb`. Второй generate не получает `409`: он ждёт этот lock, два Flux сразу не стартуют. UI опрашивает Nest раз в 2 с и выключает кнопки, пока `locked`, с подписью «GPU занят: llm» или «GPU занят: flux».

Отмена джобы не прерывает CUDA-шаг. Если Flux уже в `generate`, текущий прогон дочитывается, PNG в пост не сохраняется, затем `release` в `finally` выгружает модель как обычно.

## Порог VRAM

`GPU_FREE_MB_THRESHOLD` (дефолт 500) — целевой idle used. На этой Windows-машине простой RTX 4070 уже ~1.1 ГБ (рабочий стол / драйвер), поэтому `used < 500` почти никогда не выполняется.

`wait_vram_released` считает карту свободной, если used ниже порога **или** ниже 4096 МБ (нет резидентной LLM/Flux). После выгрузки Ollama used падает с ~7.6 ГБ до ~1.2 ГБ.

## Выгрузка Ollama

Перед Flux:

1. `POST /api/generate` с `keep_alive: 0` по каждой модели из `GET /api/ps`
2. fallback `ollama stop <name>`
3. poll `ollama ps` пустой + `nvidia-smi`

Текстовый `/generate/text` после ответа **не** форсирует unload (как этап 1: `keep_alive` из запроса, дефолт `5m`). Выгрузка — только при `acquire("flux")`.

Слои LLM сначала занимают GPU. `num_gpu` не форсируется: на Windows большое значение уходит в shared-память и может свалиться в файл подкачки. Если веса не влезают в VRAM, но хвост не больше 12 ГБ, запросу ставятся `use_mmap: false` и `use_mlock: true`, чтобы этот хвост жил в RAM, а не читался с диска на каждом токене. Иначе генерация останавливается: выгрузка весов на SSD отключена.

## Flux

- Repo: `FLUX_MODEL_ID=black-forest-labs/FLUX.1-dev` из `HF_HOME`. `local_files_only=True`. Снимок без LICENSE/README всё равно принимается, если есть `model_index.json` и `transformer/`.
- Веса сначала целиком на GPU, если влезают в свободную видеопамять (с запасом ~1 ГБ под активации). Иначе NF4 остаётся в RAM и считается на GPU через `enable_model_cpu_offload()` — sequential offload с bitsandbytes на T5 даёт `Cannot copy out of meta tensor`. Потолок RAM для весов генерации — 12 ГБ. Папка offload на диск не задаётся: слои не пишутся на SSD. Процесс ограничен свободной dedicated VRAM, чтобы Windows не добрала память через shared GPU / файл подкачки.
- `FLUX_QUANT=gguf` + `FLUX_MODEL_PATH` — запасной путь в том же модуле. NF4 на этой машине загрузился.
- Не FP16/BF16 пайплайн, не BnB8, не Flux в Docker.
- После generate: `del pipe`, `gc.collect()`, `torch.cuda.empty_cache()`, `ipc_collect()`.

Дефолт API: 1024×1024, 28 steps, `guidance_scale=3.5`, seed в ответе. PNG в `data/tmp/` + `image_base64`.

## Qwen-Image-2.1

Отдельный интерпретатор `ai-service/.venv-qwen` (`scripts/setup-qwen-venv.ps1`, torch и torchvision с индекса cu126). FastAPI его не импортирует: на время генерации под тенантом `flux` запускается процесс `python -m app.image.qwen_worker` в этом окружении, после картинки процесс завершается и видеопамять освобождается. Веса `Qwen/Qwen-Image-2.1` качаются в `HF_HOME` скриптом `scripts/download-qwen-image.ps1`, `local_files_only=True`.

Safetensors текстового энкодера (~16 ГБ) загружаются с `disable_mmap=True`. Иначе файл остаётся отображённым с SSD: в диспетчере задач RAM и VRAM почти пустые, а каждый слой читается с диска. GGUF transformer (~4 ГБ) и VAE ставятся на GPU раньше энкодера. Хвост энкодера, который не влез в видеопамять, живёт в RAM, не больше 12 ГБ, обычным выделением памяти, не mmap. Если весь объём весов влезает в эти 12 ГБ, а целиком в VRAM нет, включается `enable_model_cpu_offload()`. Повторный CUDA OOM с полного GPU один раз уходит на этот запас RAM. После выхода процесса родитель снова ждёт свободную VRAM.

`QWEN_MODEL_PATH` — первый GGUF только для transformer (как `FLUX_MODEL_PATH`). `QWEN_MODEL_PATHS` — дополнительные файлы через `;`. Форма показывает их по имени файла и не принимает произвольный путь. Текстовый энкодер и VAE всё равно берутся из `Qwen/Qwen-Image-2.1` в `HF_HOME`. Если задан хотя бы один GGUF, `scripts/download-qwen-image.ps1` не качает веса transformer.

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
