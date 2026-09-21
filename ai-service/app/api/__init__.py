from .generate import router as generate_router
from .gpu import router as gpu_router
from .health import router as health_router

__all__ = ["generate_router", "gpu_router", "health_router"]
