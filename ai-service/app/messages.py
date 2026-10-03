from __future__ import annotations


OLLAMA_DOWN = "Ollama недоступна. Запустите её и повторите."
VRAM_BUSY = "Видеопамять не освободилась. Подождите и повторите."
GENERATION_MEMORY = (
    "Модель не помещается в видеопамять и 12 ГБ оперативной памяти. "
    "Выгрузка весов на SSD отключена."
)
GENERATION_OOM = (
    "Не хватило видеопамяти, а лимит оперативной памяти для генерации — 12 ГБ. "
    "Выгрузка на SSD отключена."
)
GENERATION_NO_CUDA = "Для генерации нужна видеокарта CUDA. Запуск с SSD отключён."
EMPTY_RAG = "В выбранных книгах нет подходящих фрагментов."
BAD_FILE = "Не удалось прочитать файл."
EMPTY_FILE = "В файле нет текста."
EMPTY_OCR = "Распознавание скана не нашло текста."
OCR_MISSING = "Модель распознавания сканов не скачана. Запустите scripts/download-ocr.ps1."
QWEN_MISSING = "Модель Qwen-Image-2.1 не скачана. Запустите scripts/download-qwen-image.ps1."
QWEN_GGUF_BASE_MISSING = "GGUF — это только transformer. Текстовый энкодер и VAE всё ещё нужны в кэше Hugging Face. Запустите scripts/download-qwen-image.ps1."
QWEN_PYTHON_MISSING = "Окружение Qwen не найдено. Запустите scripts/setup-qwen-venv.ps1."
QWEN_TORCHVISION_MISSING = "В окружении Qwen нет torchvision. Запустите scripts/setup-qwen-venv.ps1."
QWEN_VENV_WRONG = "Генерация Qwen запустилась не в своём окружении и была остановлена."
QWEN_GGUF_UNKNOWN = "Такого файла GGUF нет в настройках. Проверьте QWEN_MODEL_PATH и QWEN_MODEL_PATHS."
OCR_NO_CUDA = "Для распознавания скана нужна видеокарта CUDA."
BAD_FORMAT = "Формат файла не поддерживается."
NO_CHUNKS = "Из файла не получилось нарезать фрагменты."
INDEX_FAILED = "Не удалось проиндексировать книгу."
OUTLINE_FAILED = "Не удалось собрать оглавление."
CANCELLED = "отменено"


def public_message(exc: BaseException) -> str:
    text = str(exc).strip()
    lowered = text.lower()
    if "ollama is unreachable" in lowered:
        return OLLAMA_DOWN
    if "vram still" in lowered or "ollama still loaded" in lowered:
        return VRAM_BUSY
    if lowered.startswith("nvidia-smi is unavailable"):
        return "Не удалось прочитать видеопамять."
    if "недостаточно контекста" in lowered:
        return EMPTY_RAG
    if lowered.startswith("unsupported format"):
        return BAD_FORMAT
    if lowered.startswith("failed to parse") or lowered.startswith("could not decode"):
        return BAD_FILE
    if lowered.startswith("parsed text is empty"):
        return EMPTY_FILE
    if lowered.startswith("ocr produced no text"):
        return EMPTY_OCR
    if lowered.startswith("ocr weights for"):
        return OCR_MISSING
    if lowered.startswith("qwen weights") and "gguf" in lowered:
        return QWEN_GGUF_BASE_MISSING
    if lowered.startswith("qwen weights"):
        return QWEN_MISSING
    if lowered.startswith("qwen python"):
        return QWEN_PYTHON_MISSING
    if lowered.startswith("qwen torchvision") or "requires the torchvision library" in lowered:
        return QWEN_TORCHVISION_MISSING
    if lowered.startswith("qwen venv"):
        return QWEN_VENV_WRONG
    if lowered.startswith("qwen gguf"):
        return QWEN_GGUF_UNKNOWN
    if lowered.startswith("cuda is unavailable for ocr"):
        return OCR_NO_CUDA
    if lowered.startswith("no chunks"):
        return NO_CHUNKS
    if lowered.startswith("indexing failed"):
        return INDEX_FAILED
    if lowered.startswith("outline failed"):
        return OUTLINE_FAILED
    return text
