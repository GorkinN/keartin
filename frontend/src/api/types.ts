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

export type Preset = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  createdAt: string;
  updatedAt: string;
};

export type JobStart = {
  jobId: string;
  postId: string;
};

export type KnowledgeMode = "rag" | "rag_plus" | "general";
export type PostLength = "S" | "M" | "L";
