from fastapi import FastAPI

from app.api.generate import router as generate_router
from app.api.gpu import router as gpu_router
from app.api.health import router as health_router
from app.gpu.manager import GpuManager
from app.image.flux_pipeline import FluxPipelineHolder
from app.settings import get_settings

settings = get_settings()
gpu = GpuManager(settings)
flux = FluxPipelineHolder(settings)
gpu.attach_flux(flux)

app = FastAPI(title="llm-keartin AI service", version="0.1.0")
app.state.gpu = gpu
app.state.flux = flux
app.include_router(health_router)
app.include_router(gpu_router)
app.include_router(generate_router)
