from __future__ import annotations


OLLAMA_DOWN = "Ollama недоступна. Запустите её и повторите."
VRAM_BUSY = "Видеопамять не освободилась. Подождите и повторите."
EMPTY_RAG = "В выбранных книгах нет подходящих фрагментов."
BAD_FILE = "Не удалось прочитать файл."
EMPTY_FILE = "В файле нет текста. Сканы без текстового слоя не поддерживаются."
BAD_FORMAT = "Формат файла не поддерживается."
NO_CHUNKS = "Из файла не получилось нарезать фрагменты."
INDEX_FAILED = "Не удалось проиндексировать книгу."
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
    if lowered.startswith("no chunks"):
        return NO_CHUNKS
    if lowered.startswith("indexing failed"):
        return INDEX_FAILED
    return text
