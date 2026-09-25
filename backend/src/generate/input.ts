import { BadRequestException } from "@nestjs/common";
import { isRecord } from "../common/json";

export type KnowledgeMode = "rag" | "rag_plus" | "general";
export type PostLength = "S" | "M" | "L";

export type GenerateInput = {
  topic: string;
  tone: string;
  length: PostLength;
  emoji: boolean;
  knowledgeMode: KnowledgeMode;
  citations: boolean;
  hooks: boolean;
  body: boolean;
  cta: boolean;
  bookIds: string[];
  topK: number;
  presetId: string | null;
  imagePresetId: string | null;
  temperature: number | null;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  count: number;
};

const SEED_SPAN = 2_147_483_648;

/** First post keeps `seed`. Later posts use `seed + index`, wrapped into int32. */
export function batchSeed(seed: number | null, index: number, count: number): number | null {
  if (seed === null || count <= 1) return seed;
  return (seed + index) % SEED_SPAN;
}

export function parseGenerateInput(body: unknown): GenerateInput {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  if (typeof body.topic !== "string" || !body.topic.trim()) {
    throw new BadRequestException("нужна тема");
  }
  const topic = body.topic.trim();
  if (topic.length > 2000) throw new BadRequestException("тема длиннее 2000 символов");
  const tone = optionalString(body.tone, "tone", 200) ?? "";
  const length = optionalEnum(body.length, ["S", "M", "L"] as const, "M", "length");
  const emoji = optionalBoolean(body.emoji, false, "emoji");
  const knowledgeMode = optionalEnum(
    body.knowledgeMode,
    ["rag", "rag_plus", "general"] as const,
    "rag",
    "knowledgeMode",
  );
  const citations = optionalBoolean(body.citations, false, "citations");
  const structure = parseStructure(body.structure);
  const bookIds = parseBookIds(body.bookIds);
  const topK = optionalInt(body.topK, 10, 1, 20, "topK");
  const presetId = parseOptionalId(body.presetId, "presetId");
  const imagePresetId = parseOptionalId(body.imagePresetId, "imagePresetId");
  const temperature =
    body.temperature === undefined || body.temperature === null
      ? null
      : optionalNumber(body.temperature, 0, 2, "temperature");
  const width = optionalInt(body.width, 1024, 256, 1024, "width");
  const height = optionalInt(body.height, 1024, 256, 1024, "height");
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new BadRequestException("width и height должны делиться на 16");
  }
  const steps = optionalInt(body.steps, 28, 20, 28, "steps");
  const seed =
    body.seed === undefined || body.seed === null
      ? null
      : optionalInt(body.seed, 0, 0, 2_147_483_647, "seed");
  const count = optionalInt(body.count, 1, 1, 20, "count");
  return {
    topic,
    tone,
    length,
    emoji,
    knowledgeMode,
    citations,
    hooks: structure.hooks,
    body: structure.body,
    cta: structure.cta,
    bookIds,
    topK,
    presetId,
    imagePresetId,
    temperature,
    width,
    height,
    steps,
    seed,
    count,
  };
}

function parseStructure(value: unknown): { hooks: boolean; body: boolean; cta: boolean } {
  if (value === undefined) return { hooks: true, body: true, cta: true };
  if (!isRecord(value)) throw new BadRequestException("structure должен быть объектом");
  return {
    hooks: optionalBoolean(value.hooks, true, "structure.hooks"),
    body: optionalBoolean(value.body, true, "structure.body"),
    cta: optionalBoolean(value.cta, true, "structure.cta"),
  };
}

function parseBookIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BadRequestException("bookIds должен быть массивом");
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new BadRequestException("bookIds должен содержать строки");
    }
    const id = item.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function parseOptionalId(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${name} должен быть строкой`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new BadRequestException(`${name} должен быть строкой`);
  const text = value.trim();
  if (text.length > max) throw new BadRequestException(`${name} длиннее ${max} символов`);
  return text;
}

function optionalBoolean(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new BadRequestException(`${name} должен быть boolean`);
  return value;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BadRequestException(`${name} должен быть одним из: ${allowed.join(", ")}`);
  }
  return value as T;
}

function optionalInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  return boundedNumber(value, min, max, name, true);
}

function optionalNumber(value: unknown, min: number, max: number, name: string): number {
  return boundedNumber(value, min, max, name, false);
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number,
  name: string,
  integer: boolean,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${name} должен быть числом`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new BadRequestException(`${name} должен быть целым`);
  }
  if (value < min || value > max) {
    throw new BadRequestException(`${name} вне диапазона ${min}..${max}`);
  }
  return value;
}
