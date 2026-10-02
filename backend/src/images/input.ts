import { BadRequestException } from "@nestjs/common";
import { isRecord } from "../common/json";

export type ImageBatchInput = {
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  count: number;
};

export function parseImageBatchInput(body: unknown): ImageBatchInput {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new BadRequestException("нужен промпт");
  }
  const prompt = body.prompt.trim();
  if (prompt.length > 4000) throw new BadRequestException("промпт длиннее 4000 символов");
  const width = optionalInt(body.width, 1024, 256, 1024, "width");
  const height = optionalInt(body.height, 1024, 256, 1024, "height");
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new BadRequestException("width и height должны делиться на 16");
  }
  const steps = optionalInt(body.steps, 20, 20, 28, "steps");
  const seed =
    body.seed === undefined || body.seed === null
      ? null
      : optionalInt(body.seed, 0, 0, 2_147_483_647, "seed");
  const count = optionalInt(body.count, 1, 1, 20, "count");
  return { prompt, width, height, steps, seed, count };
}

function optionalInt(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestException(`${name} должен быть целым`);
  }
  if (value < min || value > max) {
    throw new BadRequestException(`${name} вне диапазона ${min}..${max}`);
  }
  return value;
}
