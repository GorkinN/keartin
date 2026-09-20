# config.py
import os

# Пути к кэшу HuggingFace
HF_HOME = 'D:/huggingface_cache'
HUGGINGFACE_HUB_CACHE = 'D:/huggingface_cache/hub'
TRANSFORMERS_CACHE = 'D:/huggingface_cache/transformers'

# Соответствие типов генерации и окружений
ENVIRONMENTS = {
    'image': 'flux_cuda',
    'sfx': 'stable_audio_env',
    'music': 'musicgen_env',
    'pixel': 'pixel_env',
    'controlnet': 'controlnet_env',
    'transcribe': 'transcribe_env',
}

# Названия папок со скриптами
SCRIPT_FOLDERS = {
    'image': 'image-gen',
    'sfx': 'sfx-gen',
    'music': 'music-gen',
    'pixel': 'pixel-gen',
    'controlnet': 'controlnet-gen',
    'transcribe': 'transcribe-gen',
}

def setup_environment():
    """Устанавливает переменные окружения для HuggingFace"""
    os.environ['HF_HOME'] = HF_HOME
    os.environ['HUGGINGFACE_HUB_CACHE'] = HUGGINGFACE_HUB_CACHE
    os.environ['TRANSFORMERS_CACHE'] = TRANSFORMERS_CACHE
    
    # Создание папок, если их нет
    for path in [HF_HOME, HUGGINGFACE_HUB_CACHE, TRANSFORMERS_CACHE]:
        os.makedirs(path, exist_ok=True)

# Автоматически вызываем при импорте
setup_environment()