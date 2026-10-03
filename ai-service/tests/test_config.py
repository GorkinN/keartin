from app.api.config import app_config
from app.settings import Settings


def test_app_config_reports_configured_models() -> None:
    settings = Settings(
        llm_model="demo-llm",
        llm_num_ctx=4096,
        llm_keep_alive="1m",
        ollama_host="http://127.0.0.1:11434",
        embed_model="demo/embed",
        flux_model_id="demo/flux",
        flux_quant="gguf",
        flux_model_path="D:/models/flux",
        qwen_python="D:/missing/qwen-python.exe",
        qwen_model_path="",
        qwen_model_paths="",
        ocr_model_id="demo/ocr",
        ocr_dpi=72,
        ocr_max_patches=2,
        ocr_max_new_tokens=128,
    )

    config = app_config(settings)

    assert config.llm.model == "demo-llm"
    assert config.llm.num_ctx == 4096
    assert config.llm.keep_alive == "1m"
    assert config.llm.host == "http://127.0.0.1:11434"
    assert config.embed.model == "demo/embed"
    assert config.flux.model == "demo/flux"
    assert config.flux.quant == "gguf"
    assert config.flux.path == "D:/models/flux"
    assert config.qwen.model == "Qwen/Qwen-Image-2.1"
    assert config.qwen.python_ready is False
    assert config.qwen.path == ""
    assert config.qwen.ggufs == []
    assert config.ocr.model == "demo/ocr"
    assert config.ocr.dpi == 72
    assert config.ocr.max_patches == 2
    assert config.ocr.max_new_tokens == 128
