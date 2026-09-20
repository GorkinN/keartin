# Этап 2. Flux + GpuManager

**Статус:** не начат  
**Зависимости:** [этап 1](01-text-generation.md) (умеем выгрузить LLM)  
**Следующий этап:** [03-rag.md](03-rag.md)

## Цель

Сгенерировать картинку Flux.1-dev с **гарантированной** выгрузкой LLM из VRAM до старта и выгрузкой Flux после. Самый опасный этап по железу.

## Что делается

- Полный GpuManager: `ps` → `stop` → poll VRAM → flux → unload → poll.
- Обёртка Flux: repo id `FLUX_MODEL_ID` (дефолт `black-forest-labs/FLUX.1-dev`) из кэша `HF_HOME`. Если снимок уже есть — `local_files_only=True`. `FLUX_MODEL_PATH` — только override (GGUF / каталог вне кэша).
- Стратегия загрузки (порядок fallback):
  1. **Рабочий путь для 12 ГБ:** transformer + T5 в bitsandbytes **NF4** + `enable_sequential_cpu_offload()` (или `enable_model_cpu_offload()`).
  2. Если Windows + bitsandbytes сломается: GGUF Q5_K_S / Q6_K через diffusers, путь в `FLUX_MODEL_PATH`.
  3. FP8 — не первый путь (впритык на 12 ГБ).
- Кэш: веса на `D:/huggingface_cache` / в RAM; в VRAM — только на время `generate`. Не качать в `%USERPROFILE%\.cache\huggingface`.
- `POST /generate/image` + SSE `image_progress`.
- После запроса — принудительный `unload_flux`.
- `GET /gpu/status`: lock, tenant, `ollama ps`, used VRAM MB.
- `scripts/check-gpu.ps1`.
- `docs/GPU.md`.

## Файлы и модули

- `ai-service/app/gpu/manager.py`
- `ai-service/app/gpu/nvidia.py` — парсинг `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits`
- `ai-service/app/gpu/ollama_unload.py`
- `ai-service/app/image/flux_pipeline.py`
- `ai-service/app/api/generate.py` (image router)
- `docs/GPU.md`
- `scripts/check-gpu.ps1`

## Решения этапа

- Размер по умолчанию 1024×1024.
- 20–28 steps.
- Seed возвращается в ответе.
- ComfyUI не тащить.
- Flux не класть в Docker.
- Не гонять FP16/BF16 и BnB8.
- Веса только через `HF_HOME` (и опциональный `FLUX_MODEL_PATH`).

Не влезут в 12 ГБ:

- FP16 сборка ~24–31 ГБ
- BnB 8-bit peak ~24 ГБ
- BnB 4-bit без offload peak ~17 ГБ

## Что сознательно не делается

- Связка «текст поста → промпт картинки» (это этап 4).
- Сохранение в StorageProvider / SQLite.
- UI прогресса.

## Как проверяется

Сценарий:

1. Загрузить LLM текстовым запросом (`ollama ps` не пуст, VRAM занята).
2. `POST /generate/image` с простым английским промптом.
3. В логах: unload LLM **до** загрузки Flux.
4. Во время Flux: `ollama ps` пуст.
5. После ответа: `nvidia-smi` близок к idle (ниже порога).
6. Повторный вызов — VRAM не растёт (нет утечки).
7. Веса взяты из `D:/huggingface_cache`, новый кэш в профиле пользователя не появился.

Команды: `scripts/check-gpu.ps1` до, во время (второй терминал) и после.

## Критерий приёмки

Одна картинка на диске/в ответе. LLM не живёт в VRAM одновременно с Flux. После генерации карта почти свободна. Если NF4 на Windows падает — зафиксировать и включить GGUF-путь в том же этапе, не откладывая.
