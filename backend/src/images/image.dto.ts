import type { GeneratedImage, ImageBatch, ImageJob } from "@prisma/client";

export type ImageFileDto = {
  index: number;
  seed: number;
};

export type ImageBatchDto = {
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
  gguf: string;
  storagePrefix: string;
  images: ImageFileDto[];
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

type BatchRow = ImageBatch & { images: GeneratedImage[]; job: ImageJob | null };

export function toImageBatchDto(batch: BatchRow): ImageBatchDto {
  const active =
    batch.job && (batch.job.status === "queued" || batch.job.status === "running") ? batch.job.id : null;
  return {
    id: batch.id,
    prompt: batch.prompt,
    width: batch.width,
    height: batch.height,
    steps: batch.steps,
    seed: batch.seed,
    count: batch.count,
    status: batch.status,
    error: batch.error,
    model: batch.fluxModel,
    transparent: batch.transparent,
    gguf: batch.gguf,
    storagePrefix: batch.storagePrefix ?? "",
    images: [...batch.images]
      .sort((a, b) => a.index - b.index)
      .map((image) => ({ index: image.index, seed: image.seed })),
    activeJobId: active,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export function imageMeta(batch: BatchRow): string {
  const dto = toImageBatchDto(batch);
  return `${JSON.stringify(
    {
      id: dto.id,
      prompt: dto.prompt,
      width: dto.width,
      height: dto.height,
      steps: dto.steps,
      seed: dto.seed,
      count: dto.count,
      status: dto.status,
      model: dto.model,
      transparent: dto.transparent,
      gguf: dto.gguf,
      storagePrefix: dto.storagePrefix,
      images: dto.images,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    },
    null,
    2,
  )}\n`;
}
