import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Post, StylePreset } from "@prisma/client";
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { PythonClient } from "../ai/python.client";
import type { SseEvent } from "../ai/sse";
import { isRecord, parseStringArray, sourcesFromEvent } from "../common/json";
import { AppEnv } from "../config/env";
import { PostFiles } from "../posts/post-files";
import { nextStoragePrefix } from "../posts/slug";
import { PrismaService } from "../prisma/prisma.service";
import { parseGenerateInput, type GenerateInput } from "./input";
import { JobHub } from "./job-hub";

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonClient,
    private readonly env: AppEnv,
    private readonly files: PostFiles,
    private readonly hub: JobHub,
  ) {}

  async start(body: unknown): Promise<{ jobId: string; postId: string }> {
    const input = parseGenerateInput(body);
    await this.assertBooks(input.knowledgeMode, input.bookIds);
    if (input.presetId) await this.requirePreset(input.presetId);
    await this.ensureAi();
    const post = await this.createPost(input);
    return this.launch(post.id, "full");
  }

  async regenerateText(postId: string): Promise<{ jobId: string; postId: string }> {
    const post = await this.requirePost(postId);
    await this.ensureIdle(postId);
    const bookIds = parseStringArray(post.bookIds);
    await this.assertBooks(post.knowledgeMode, bookIds);
    await this.ensureAi();
    return this.launch(post.id, "text");
  }

  async regenerateImage(postId: string): Promise<{ jobId: string; postId: string }> {
    const post = await this.requirePost(postId);
    if (!post.text.trim()) throw new BadRequestException("нет текста поста");
    await this.ensureIdle(postId);
    await this.ensureAi();
    return this.launch(post.id, "image");
  }

  async events(id: string, res: Response): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({ where: { id } });
    if (!job) {
      res.status(404).json({
        statusCode: 404,
        message: "джоба не найдена",
        error: "Not Found",
      });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const write = (event: SseEvent) => {
      if (res.writableEnded) return;
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const end = () => {
      if (!res.writableEnded) res.end();
    };
    if (!this.hub.has(id)) {
      if (job.status === "succeeded") {
        write({ event: "status", data: { phase: "done", job_id: id } });
      } else {
        write({ event: "error", data: { message: job.error ?? "джоба прервана" } });
      }
      end();
      return;
    }
    const unsubscribe = this.hub.subscribe(id, write, end);
    res.on("close", unsubscribe);
  }

  private async launch(postId: string, kind: "full" | "text" | "image") {
    const jobId = randomUUID();
    await this.prisma.generationJob.create({
      data: { id: jobId, postId, kind, status: "running" },
    });
    this.hub.open(jobId);
    void this.run(jobId);
    return { jobId, postId };
  }

  private async run(jobId: string): Promise<void> {
    try {
      await this.consume(jobId);
    } catch (error) {
      if (!isMissingRecord(error)) {
        const message = error instanceof Error ? error.message : "ошибка генерации";
        this.logger.error(`job ${jobId}: ${message}`);
        await this.failOnce(jobId, message);
      }
    } finally {
      this.hub.close(jobId);
    }
  }

  private async consume(jobId: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: { post: true },
    });
    if (!job || job.status !== "running") return;
    const preset = job.post.presetId
      ? await this.prisma.stylePreset.findUnique({ where: { id: job.post.presetId } })
      : null;
    let finished = false;
    const fail = async (message: string) => {
      if (finished) return;
      finished = true;
      await this.failOnce(jobId, message);
    };
    await this.python.stream(
      streamPath(job.kind),
      job.kind === "image" ? imageBody(job.post, jobId) : postBody(job.post, jobId, preset),
      async (event) => {
        if (finished) return;
        if (event.event === "error") {
          await fail(messageOf(event.data));
          return;
        }
        if (event.event === "text_done" && job.kind !== "image") {
          const text = textOf(event.data);
          if (!text) {
            await fail("пустой текст поста");
            return;
          }
          const updated = await this.prisma.post.update({
            where: { id: job.postId },
            data: { text, sources: JSON.stringify(sourcesFromEvent(event.data)) },
          });
          if (job.kind === "text") {
            finished = true;
            const ready = { ...updated, status: "ready" };
            await this.files.writeText(ready);
            await this.markReady(jobId, job.postId);
          }
          this.hub.publish(jobId, event);
          return;
        }
        if (event.event === "image_prompt") {
          const prompt = promptOf(event.data);
          if (prompt) {
            await this.prisma.post.update({
              where: { id: job.postId },
              data: { imagePrompt: prompt },
            });
          }
          this.hub.publish(jobId, event);
          return;
        }
        if (event.event === "image_done" && job.kind !== "text") {
          const current = await this.prisma.post.findUnique({ where: { id: job.postId } });
          if (!current) return;
          const prompt = promptOf(event.data);
          const ready = {
            ...current,
            status: "ready",
            imageSeed: seedOf(event.data),
            imageKey: `${current.storagePrefix}/image.png`,
            imagePrompt: prompt || current.imagePrompt,
          };
          finished = true;
          const png = await this.readPng(jobId);
          if (job.kind === "full") await this.files.writeAll(ready, png);
          else await this.files.writeImage(ready, png);
          await this.prisma.post.update({
            where: { id: current.id },
            data: {
              status: "ready",
              imageSeed: ready.imageSeed,
              imageKey: ready.imageKey,
              imagePrompt: ready.imagePrompt,
            },
          });
          await this.prisma.generationJob.update({
            where: { id: jobId },
            data: { status: "succeeded", error: null },
          });
          this.hub.publish(jobId, event);
          return;
        }
        this.hub.publish(jobId, event);
      },
    );
    if (!finished) await fail("поток завершился без результата");
  }

  private async markReady(jobId: string, postId: string): Promise<void> {
    await this.prisma.post.update({ where: { id: postId }, data: { status: "ready" } });
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "succeeded", error: null },
    });
  }

  private async failOnce(jobId: string, message: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "running") return;
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "failed", error: message },
    });
    const post = await this.prisma.post.findUnique({ where: { id: job.postId } });
    if (post?.status === "draft") {
      await this.prisma.post.update({ where: { id: post.id }, data: { status: "failed" } });
    }
    this.hub.publish(jobId, { event: "error", data: { message } });
  }

  private async createPost(input: GenerateInput): Promise<Post> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let slot: { slug: string; storagePrefix: string };
      try {
        slot = await nextStoragePrefix(input.topic, async (storagePrefix) => {
          const existing = await this.prisma.post.findUnique({ where: { storagePrefix } });
          return existing !== null;
        });
      } catch {
        throw new ConflictException("не удалось подобрать имя папки");
      }
      try {
        return await this.prisma.post.create({
          data: {
            topic: input.topic,
            tone: input.tone,
            length: input.length,
            emoji: input.emoji,
            knowledgeMode: input.knowledgeMode,
            citations: input.citations,
            hooks: input.hooks,
            body: input.body,
            cta: input.cta,
            bookIds: JSON.stringify(input.bookIds),
            topK: input.topK,
            presetId: input.presetId,
            temperature: input.temperature,
            width: input.width,
            height: input.height,
            steps: input.steps,
            imageSeed: input.seed,
            storagePrefix: slot.storagePrefix,
            slug: slot.slug,
            llmModel: this.env.llmModel,
            fluxModel: this.env.fluxModelId,
            status: "draft",
          },
        });
      } catch (error) {
        if (isUnique(error) && attempt < 4) continue;
        throw error;
      }
    }
    throw new ConflictException("не удалось подобрать имя папки");
  }

  private async assertBooks(mode: string, bookIds: string[]): Promise<void> {
    if (mode === "general") return;
    if (mode === "rag" && bookIds.length === 0) {
      throw new ConflictException("для режима rag нужен хотя бы один источник");
    }
    for (const id of bookIds) {
      const book = await this.prisma.book.findUnique({ where: { id } });
      if (!book) throw new NotFoundException("книга не найдена");
      if (book.status !== "ready") {
        throw new ConflictException("книга не готова к генерации");
      }
    }
  }

  private async ensureAi(): Promise<void> {
    if (!(await this.python.reachable())) {
      throw new BadGatewayException("AI-сервис недоступен");
    }
  }

  private async ensureIdle(postId: string): Promise<void> {
    const running = await this.prisma.generationJob.count({
      where: { postId, status: "running" },
    });
    if (running > 0) throw new ConflictException("генерация уже идёт");
  }

  private async requirePost(id: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException("пост не найден");
    return post;
  }

  private async requirePreset(id: string): Promise<StylePreset> {
    const preset = await this.prisma.stylePreset.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException("пресет не найден");
    return preset;
  }

  private async readPng(jobId: string): Promise<Buffer> {
    const root = resolve(this.env.repoRoot, "data", "tmp", "pipeline");
    const file = resolve(root, jobId, "image.png");
    if (!file.startsWith(root + sep)) throw new Error("некорректный путь картинки");
    try {
      return await readFile(file);
    } catch {
      throw new Error("файл картинки не найден");
    }
  }
}

function streamPath(kind: string): string {
  if (kind === "text") return "/pipeline/text/stream";
  if (kind === "image") return "/pipeline/image/stream";
  return "/pipeline/stream";
}

function postBody(post: Post, jobId: string, preset: StylePreset | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    topic: post.topic,
    tone: post.tone,
    length: post.length,
    emoji: post.emoji,
    knowledge_mode: post.knowledgeMode,
    citations: post.citations,
    structure: { hooks: post.hooks, body: post.body, cta: post.cta },
    book_ids: parseStringArray(post.bookIds),
    top_k: post.topK,
    width: post.width,
    height: post.height,
    steps: post.steps,
    job_id: jobId,
  };
  if (post.temperature !== null) body.temperature = post.temperature;
  if (post.imageSeed !== null) body.seed = post.imageSeed;
  if (preset) {
    body.preset = {
      description: preset.description,
      examples: parseStringArray(preset.examples),
    };
  }
  return body;
}

function imageBody(post: Post, jobId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: post.text,
    width: post.width,
    height: post.height,
    steps: post.steps,
    job_id: jobId,
  };
  if (post.temperature !== null) body.temperature = post.temperature;
  return body;
}

function textOf(data: unknown): string {
  if (isRecord(data) && typeof data.text === "string") return data.text.trim();
  return "";
}

function promptOf(data: unknown): string {
  if (isRecord(data) && typeof data.prompt === "string") return data.prompt.trim();
  return "";
}

function messageOf(data: unknown): string {
  if (isRecord(data) && typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return "ошибка генерации";
}

function seedOf(data: unknown): number {
  if (isRecord(data) && typeof data.seed === "number" && Number.isFinite(data.seed)) {
    const seed = Math.trunc(data.seed);
    if (seed >= 0 && seed <= 2_147_483_647) return seed;
  }
  throw new Error("в событии image_done нет seed");
}

function isUnique(error: unknown): boolean {
  return codeOf(error) === "P2002";
}

function isMissingRecord(error: unknown): boolean {
  return codeOf(error) === "P2025";
}

function codeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
