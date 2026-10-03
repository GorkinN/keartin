export type Book = {
  id: string;
  filename: string;
  format: string;
  storageKey: string;
  status: string;
  indexJobId: string | null;
  error: string | null;
  chunksTotal: number;
  chunksDone: number;
  phase: string;
  pagesTotal: number;
  pagesDone: number;
  textKey: string | null;
  outline: string[];
  outlineError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceRef = {
  bookId: string;
  chunkIndex: number;
  sourceName: string;
  score: number;
};

export type Post = {
  id: string;
  topic: string;
  tone: string;
  length: string;
  emoji: boolean;
  knowledgeMode: string;
  citations: boolean;
  structure: { hooks: boolean; body: boolean; cta: boolean };
  bookIds: string[];
  topK: number;
  presetId: string | null;
  imagePresetId: string | null;
  temperature: number | null;
  width: number;
  height: number;
  steps: number;
  imageSeed: number | null;
  text: string;
  imagePrompt: string;
  imageKey: string;
  storagePrefix: string;
  slug: string;
  models: { llm: string; flux: string };
  gguf?: string;
  sources: SourceRef[];
  status: string;
  activeJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImagePromptPreset = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

export type TonePreset = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type Preset = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  createdAt: string;
  updatedAt: string;
};

export type QwenGguf = { id: string; label: string };

export type AppConfig = {
  llm: { model: string; num_ctx: number; keep_alive: string; host: string };
  embed: { model: string };
  flux: { model: string; quant: string; path: string };
  qwen: { model: string; python_ready: boolean; path?: string; ggufs?: QwenGguf[] };
  ocr: { model: string; dpi: number; max_patches: number; max_new_tokens: number };
};

export type GpuStatus = {
  locked: boolean;
  tenant: string | null;
  ollama_models: string[];
  vram_used_mb: number | null;
};

export type JobStart = {
  jobId: string;
  postId: string;
};

export type EnqueueResult = {
  items: JobStart[];
};

export type QueueItem = {
  jobId: string;
  postId: string;
  topic: string;
  kind: "full" | "text" | "image";
  status: "queued" | "running";
};

export type GenerateQueue = {
  cooldownUntil: string | null;
  items: QueueItem[];
};

export type KnowledgeMode = "rag" | "rag_plus" | "general";
export type PostLength = "S" | "M" | "L";

export type ImageFile = {
  index: number;
  seed: number;
};

export type ImageBatch = {
  id: string;
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  count: number;
  status: string;
  error: string | null;
  model: string;
  transparent: boolean;
  gguf?: string;
  storagePrefix?: string;
  images: ImageFile[];
  activeJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageQueueItem = {
  jobId: string;
  batchId: string;
  prompt: string;
  count: number;
  status: "queued" | "running";
};

export type ImageQueue = {
  cooldownUntil: string | null;
  items: ImageQueueItem[];
};
