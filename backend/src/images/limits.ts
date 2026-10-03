import { BadRequestException } from "@nestjs/common";

export type ImageModel = "flux" | "qwen";

export function parseImageModel(value: unknown, fallback: ImageModel = "flux"): ImageModel {
  if (value === undefined || value === null || value === "") return fallback;
  if (value !== "flux" && value !== "qwen") {
    throw new BadRequestException("model должен быть flux или qwen");
  }
  return value;
}

export function imageBounds(model: ImageModel): {
  sideMin: number;
  sideMax: number;
  stepMin: number;
  stepMax: number;
} {
  if (model === "qwen") return { sideMin: 256, sideMax: 2752, stepMin: 20, stepMax: 50 };
  return { sideMin: 256, sideMax: 1024, stepMin: 20, stepMax: 28 };
}

export function assertImageFit(model: ImageModel, width: number, height: number, steps: number): void {
  const bounds = imageBounds(model);
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (value % 16 !== 0) throw new BadRequestException("width и height должны делиться на 16");
    if (value < bounds.sideMin || value > bounds.sideMax) {
      throw new BadRequestException(`${name} вне диапазона ${bounds.sideMin}..${bounds.sideMax}`);
    }
  }
  if (steps < bounds.stepMin || steps > bounds.stepMax) {
    throw new BadRequestException(`steps вне диапазона ${bounds.stepMin}..${bounds.stepMax}`);
  }
}

export function repoForImageModel(model: ImageModel, fluxModelId: string, qwenModelId: string): string {
  return model === "qwen" ? qwenModelId : fluxModelId;
}

export function imageModelOfRepo(repoId: string, qwenModelId: string): ImageModel {
  if (!repoId) return "flux";
  if (repoId === qwenModelId || repoId.toLowerCase().includes("qwen-image")) return "qwen";
  return "flux";
}
