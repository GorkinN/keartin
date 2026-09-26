from fastapi import FastAPI

from app.logging_json import configure_logging
from app.pipeline.cancel import CancelRegistry
from app.api.generate import router as generate_router
from app.api.gpu import router as gpu_router
from app.api.health import router as health_router
from app.api.pipeline import router as pipeline_router
from app.api.rag import router as rag_router
from app.gpu.manager import GpuManager
from app.image.flux_pipeline import FluxPipelineHolder
from app.llm.ollama_client import OllamaClient
from app.ocr.deepseek import DeepseekOcrHolder
from app.ocr.runner import ScanOcr
from app.rag.embedder import Embedder
from app.rag.indexer import Indexer
from app.rag.jobs import JobStore
from app.rag.outline import OutlineWriter
from app.rag.qdrant_store import QdrantStore
from app.rag.retriever import Retriever
from app.settings import get_settings

configure_logging()
settings = get_settings()
gpu = GpuManager(settings)
flux = FluxPipelineHolder(settings)
gpu.attach_flux(flux)
ocr = DeepseekOcrHolder(settings)
gpu.attach_ocr(ocr)
embedder = Embedder(settings)
qdrant = QdrantStore(settings)
rag_jobs = JobStore()
outline = OutlineWriter(gpu, OllamaClient(settings))
indexer = Indexer(settings, embedder, qdrant, rag_jobs, ocr=ScanOcr(settings, gpu, ocr), outline=outline)
retriever = Retriever(settings, embedder, qdrant)

app = FastAPI(title="llm-keartin AI service", version="0.1.0")
app.state.gpu = gpu
app.state.flux = flux
app.state.embedder = embedder
app.state.qdrant = qdrant
app.state.rag_jobs = rag_jobs
app.state.indexer = indexer
app.state.outline = outline
app.state.retriever = retriever
app.state.cancels = CancelRegistry()
app.state.rag_tasks = set()
app.include_router(health_router)
app.include_router(gpu_router)
app.include_router(generate_router)
app.include_router(rag_router)
app.include_router(pipeline_router)
