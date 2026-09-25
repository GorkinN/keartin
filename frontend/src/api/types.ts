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

export type Preset = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  createdAt: string;
  updatedAt: string;
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
