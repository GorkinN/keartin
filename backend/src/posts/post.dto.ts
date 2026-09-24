import type { Post } from "@prisma/client";
import { parseSources, type SourceRef } from "../common/json";

export type PostDto = {
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

export function toPostDto(post: Post, activeJobId: string | null): PostDto {
  return {
    id: post.id,
    topic: post.topic,
    tone: post.tone,
    length: post.length,
    emoji: post.emoji,
    knowledgeMode: post.knowledgeMode,
    citations: post.citations,
    structure: { hooks: post.hooks, body: post.body, cta: post.cta },
    bookIds: parseIdList(post.bookIds),
    topK: post.topK,
    presetId: post.presetId,
    imagePresetId: post.imagePresetId,
    temperature: post.temperature,
    width: post.width,
    height: post.height,
    steps: post.steps,
    imageSeed: post.imageSeed,
    text: post.text,
    imagePrompt: post.imagePrompt,
    imageKey: post.imageKey,
    storagePrefix: post.storagePrefix,
    slug: post.slug,
    models: { llm: post.llmModel, flux: post.fluxModel },
    sources: parseSources(post.sources),
    status: post.status,
    activeJobId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function postMeta(post: Post): string {
  const dto = toPostDto(post, null);
  return `${JSON.stringify(
    {
      id: dto.id,
      topic: dto.topic,
      tone: dto.tone,
      length: dto.length,
      emoji: dto.emoji,
      knowledgeMode: dto.knowledgeMode,
      citations: dto.citations,
      structure: dto.structure,
      bookIds: dto.bookIds,
      topK: dto.topK,
      presetId: dto.presetId,
      imagePresetId: dto.imagePresetId,
      imageSeed: dto.imageSeed,
      models: dto.models,
      sources: dto.sources,
      imageKey: dto.imageKey,
      storagePrefix: dto.storagePrefix,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    },
    null,
    2,
  )}\n`;
}

function parseIdList(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
