from fastapi import FastAPI

from app.api.generate import router as generate_router
from app.api.health import router as health_router
from app.gpu.manager import GpuManager

app = FastAPI(title="llm-keartin AI service", version="0.1.0")
app.state.gpu = GpuManager()
app.include_router(health_router)
app.include_router(generate_router)
