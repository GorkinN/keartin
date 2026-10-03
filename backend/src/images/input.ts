import { BadRequestException } from "@nestjs/common";
import { isRecord } from "../common/json";
import { assertImageFit, imageBounds, parseImageModel, type ImageModel } from "./limits";

export type ImageBatchInput = {
  prompt: string;
  model: ImageModel;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  count: number;
  transparent: boolean;
  gguf: string;
};

export function parseImageBatchInput(body: unknown): ImageBatchInput {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new BadRequestException("нужен промпт");
  }
  const prompt = body.prompt.trim();
  if (prompt.length > 4000) throw new BadRequestException("промпт длиннее 4000 символов");
  const model = parseImageModel(body.model);
  const bounds = imageBounds(model);
  const width = optionalInt(body.width, 1024, bounds.sideMin, bounds.sideMax, "width");
  const height = optionalInt(body.height, 1024, bounds.sideMin, bounds.sideMax, "height");
  const steps = optionalInt(body.steps, model === "qwen" ? 40 : 20, bounds.stepMin, bounds.stepMax, "steps");
  assertImageFit(model, width, height, steps);
  const seed =
    body.seed === undefined || body.seed === null || body.seed === ""
      ? null
      : optionalInt(body.seed, 0, 0, 2_147_483_647, "seed");
  const count = optionalInt(body.count, 1, 1, 20, "count");
  const transparent = optionalBoolean(body.transparent, false);
  if (model !== "qwen" && transparent) {
    throw new BadRequestException("прозрачный фон доступен только у Qwen-Image-2.1");
  }
  const gguf = optionalGguf(body.gguf);
  if (model !== "qwen" && gguf) {
    throw new BadRequestException("выбор GGUF доступен только у Qwen-Image-2.1");
  }
  return { prompt, model, width, height, steps, seed, count, transparent, gguf };
}

function optionalInt(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number)) {
    throw new BadRequestException(`${name} должен быть целым`);
  }
  if (number < min || number > max) {
    throw new BadRequestException(`${name} вне диапазона ${min}..${max}`);
  }
  return number;
}

function optionalGguf(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new BadRequestException("gguf должен быть именем файла");
  const text = value.trim();
  if (text.length > 200 || text.includes("/") || text.includes("\\") || text.includes("..")) {
    throw new BadRequestException("gguf должен быть именем файла");
  }
  return text;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BadRequestException("transparent должен быть boolean");
}
