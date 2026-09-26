from __future__ import annotations


OLLAMA_DOWN = "Ollama недоступна. Запустите её и повторите."
VRAM_BUSY = "Видеопамять не освободилась. Подождите и повторите."
EMPTY_RAG = "В выбранных книгах нет подходящих фрагментов."
BAD_FILE = "Не удалось прочитать файл."
EMPTY_FILE = "В файле нет текста."
EMPTY_OCR = "Распознавание скана не нашло текста."
OCR_MISSING = "Модель распознавания сканов не скачана. Запустите scripts/download-ocr.ps1."
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
    if lowered.startswith("cuda is unavailable for ocr"):
        return OCR_NO_CUDA
    if lowered.startswith("no chunks"):
        return NO_CHUNKS
    if lowered.startswith("indexing failed"):
        return INDEX_FAILED
    if lowered.startswith("outline failed"):
        return OUTLINE_FAILED
    return text
