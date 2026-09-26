import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from "@nestjs/common";
import type { Post, StylePreset } from "@prisma/client";
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { PythonClient, PythonRequestError } from "../ai/python.client";
import type { SseEvent } from "../ai/sse";
import { isRecord, parseStringArray, sourcesFromEvent } from "../common/json";
import { AppEnv } from "../config/env";
import { PostFiles } from "../posts/post-files";
import { nextStoragePrefix } from "../posts/slug";
import { PrismaService } from "../prisma/prisma.service";
import { batchSeed, parseGenerateInput, type GenerateInput } from "./input";
import { JobHub } from "./job-hub";

const COOLDOWN_MS = 60_000;

export type QueueItem = {
  jobId: string;
  postId: string;
  topic: string;
  kind: "full" | "text" | "image";
  status: "queued" | "running";
};

@Injectable()
export class GenerateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonClient,
    private readonly env: AppEnv,
    private readonly files: PostFiles,
    private readonly hub: JobHub,
  ) {}

  private pumping = false;
  private cooldownUntil: string | null = null;
  private cooldownAbort: AbortController | null = null;

  onApplicationBootstrap(): void {
    this.kick();
  }

  async start(body: unknown): Promise<{ items: Array<{ jobId: string; postId: string }> }> {
    const input = parseGenerateInput(body);
    await this.assertBooks(input.knowledgeMode, input.bookIds);
    if (input.presetId) await this.requirePreset(input.presetId);
    if (input.imagePresetId) await this.requireImagePreset(input.imagePresetId);
    await this.ensureAi();
    const items: Array<{ jobId: string; postId: string }> = [];
    for (let index = 0; index < input.count; index += 1) {
      const post = await this.createPost({
        ...input,
        seed: batchSeed(input.seed, index, input.count),
      });
      items.push(await this.enqueue(post.id, "full"));
      this.kick();
    }
    return { items };
  }

  async regenerateText(postId: string): Promise<{ jobId: string; postId: string }> {
    const post = await this.requirePost(postId);
    await this.ensureIdle(postId);
    const bookIds = parseStringArray(post.bookIds);
    await this.assertBooks(post.knowledgeMode, bookIds);
    await this.ensureAi();
    const queued = await this.enqueue(post.id, "text");
    this.kick();
    return queued;
  }

  async regenerateImage(postId: string, body: unknown): Promise<{ jobId: string; postId: string }> {
    const post = await this.requirePost(postId);
    if (!post.text.trim()) throw new BadRequestException("нет текста поста");
    await this.ensureIdle(postId);
    const imagePresetId = parseImagePresetUpdate(body);
    if (imagePresetId !== undefined) {
      if (imagePresetId) await this.requireImagePreset(imagePresetId);
      await this.prisma.post.update({ where: { id: post.id }, data: { imagePresetId } });
    }
    await this.ensureAi();
    const queued = await this.enqueue(post.id, "image", parseImageSeed(body));
    this.kick();
    return queued;
  }

  async queue(): Promise<{ cooldownUntil: string | null; items: QueueItem[] }> {
    const jobs = await this.prisma.generationJob.findMany({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
      include: { post: { select: { topic: true } } },
    });
    return {
      cooldownUntil: this.cooldownUntil,
      items: jobs.map((job) => ({
        jobId: job.id,
        postId: job.postId,
        topic: job.post.topic,
        kind: jobKind(job.kind),
        status: job.status === "running" ? "running" : "queued",
      })),
    };
  }

  async removeQueued(jobId: string): Promise<{ ok: true }> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: { post: true },
    });
    if (!job) throw new NotFoundException("джоба не найдена");
    if (job.status !== "queued") throw new ConflictException("задание уже выполняется");
    this.imageSeeds.delete(jobId);
    if (job.post.status === "draft" && job.kind === "full") {
      await this.prisma.post.delete({ where: { id: job.postId } });
    } else {
      await this.prisma.generationJob.delete({ where: { id: jobId } });
    }
    this.hub.publish(jobId, { event: "cancelled", data: { message: "убрано из очереди" } });
    this.hub.close(jobId);
    await this.abortCooldownIfIdle();
    return { ok: true };
  }

  async cancel(jobId: string): Promise<{ jobId: string; status: "cancelled" }> {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("джоба не найдена");
    if (job.status !== "running") throw new ConflictException("генерация уже завершена");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await this.python.cancelPipeline(jobId);
        return { jobId, status: "cancelled" };
      } catch (error) {
        if (!(error instanceof PythonRequestError) || error.statusCode !== 404) {
          const message = error instanceof Error ? error.message : "не удалось отменить";
          throw new BadGatewayException(message);
        }
        const current = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
        if (!current || current.status !== "running") {
          throw new ConflictException("генерация уже завершена");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new BadGatewayException("не удалось отменить генерацию");
  }

  async gpuStatus() {
    try {
      return await this.python.gpuStatus();
    } catch (error) {
      if (error instanceof PythonRequestError) throw new BadGatewayException(error.message);
      throw error;
    }
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
    let joined = false;
    const join = () => {
      if (joined || res.writableEnded) return;
      joined = true;
      const unsubscribe = this.hub.subscribe(id, write, end);
      res.on("close", unsubscribe);
    };
    if (job.status === "queued") {
      write({ event: "status", data: { phase: "queued", job_id: id } });
    }
    if (this.hub.has(id)) {
      join();
      return;
    }
    if (job.status === "succeeded") {
      write({ event: "status", data: { phase: "done", job_id: id } });
      end();
      return;
    }
    if (job.status === "cancelled") {
      write({ event: "cancelled", data: { message: job.error ?? "отменено" } });
      end();
      return;
    }
    if (job.status !== "queued") {
      write({ event: "error", data: { message: job.error ?? "джоба прервана" } });
      end();
      return;
    }
    const timer = setInterval(() => {
      void this.followQueued(id, res, write, end, join, () => clearInterval(timer));
    }, 400);
    res.on("close", () => clearInterval(timer));
  }

  private readonly imageSeeds = new Map<string, number>();

  private async followQueued(
    id: string,
    res: Response,
    write: (event: SseEvent) => void,
    end: () => void,
    join: () => void,
    stop: () => void,
  ): Promise<void> {
    if (res.writableEnded) {
      stop();
      return;
    }
    if (this.hub.has(id)) {
      stop();
      join();
      return;
    }
    const current = await this.prisma.generationJob.findUnique({ where: { id } });
    if (current?.status === "queued" || current?.status === "running") return;
    stop();
    if (!current) {
      write({ event: "cancelled", data: { message: "убрано из очереди" } });
    } else if (current.status === "succeeded") {
      write({ event: "status", data: { phase: "done", job_id: id } });
    } else if (current.status === "cancelled") {
      write({ event: "cancelled", data: { message: current.error ?? "отменено" } });
    } else {
      write({ event: "error", data: { message: current.error ?? "джоба прервана" } });
    }
    end();
  }

  private kick(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const job = await this.claimNext();
        if (!job) return;
        await this.run(job.id);
        await this.pauseIfQueued();
      }
    } finally {
      this.pumping = false;
      const more = await this.prisma.generationJob.count({ where: { status: "queued" } });
      if (more > 0) this.kick();
    }
  }

  private async claimNext(): Promise<{ id: string } | null> {
    for (;;) {
      const job = await this.prisma.generationJob.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      });
      if (!job) return null;
      this.hub.open(job.id);
      const claimed = await this.prisma.generationJob.updateMany({
        where: { id: job.id, status: "queued" },
        data: { status: "running" },
      });
      if (claimed.count === 1) return job;
      this.hub.close(job.id);
    }
  }

  private async enqueue(
    postId: string,
    kind: "full" | "text" | "image",
    imageSeed?: number,
  ): Promise<{ jobId: string; postId: string }> {
    const jobId = randomUUID();
    if (imageSeed !== undefined) this.imageSeeds.set(jobId, imageSeed);
    await this.prisma.generationJob.create({
      data: { id: jobId, postId, kind, status: "queued" },
    });
    this.hub.open(jobId);
    return { jobId, postId };
  }

  private async pauseIfQueued(): Promise<void> {
    const pending = await this.prisma.generationJob.count({ where: { status: "queued" } });
    if (pending === 0) return;
    await this.settleIfFree();
    const still = await this.prisma.generationJob.count({ where: { status: "queued" } });
    if (still === 0) return;
    const until = Date.now() + COOLDOWN_MS;
    this.cooldownUntil = new Date(until).toISOString();
    const abort = new AbortController();
    this.cooldownAbort = abort;
    try {
      while (Date.now() < until) {
        if (abort.signal.aborted) return;
        const left = await this.prisma.generationJob.count({ where: { status: "queued" } });
        if (left === 0) return;
        await delay(Math.min(1000, until - Date.now()), abort.signal);
      }
    } finally {
      this.cooldownUntil = null;
      if (this.cooldownAbort === abort) this.cooldownAbort = null;
    }
  }

  private async abortCooldownIfIdle(): Promise<void> {
    const left = await this.prisma.generationJob.count({ where: { status: "queued" } });
    if (left === 0) this.cooldownAbort?.abort();
  }

  private async settleIfFree(): Promise<void> {
    try {
      const status = await this.python.gpuStatus();
      if (status.locked) {
        this.logger.warn("gpu settle skipped: lock held");
        return;
      }
      const settled = await this.python.settleGpu();
      if (settled.skipped) this.logger.warn("gpu settle skipped by AI service");
    } catch (error) {
      const message = error instanceof Error ? error.message : "gpu settle failed";
      this.logger.warn(`gpu settle failed: ${message}`);
    }
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
      this.imageSeeds.delete(jobId);
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
    const imageStyle = await this.imageStyleOf(job.post.imagePresetId);
    let finished = false;
    const fail = async (message: string) => {
      if (finished) return;
      finished = true;
      await this.failOnce(jobId, message);
    };
    await this.python.stream(
      streamPath(job.kind),
      job.kind === "image"
        ? imageBody(job.post, jobId, imageStyle, this.imageSeeds.get(jobId))
        : postBody(job.post, jobId, preset, imageStyle),
      async (event) => {
        if (finished) return;
        if (event.event === "cancelled") {
          if (finished) return;
          finished = true;
          await this.cancelOnce(jobId, messageOf(event.data));
          return;
        }
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
            try {
              await this.files.writeText(ready);
            } catch (error) {
              this.logger.error(`job ${jobId}: ${error instanceof Error ? error.message : "storage"}`);
              await this.failOnce(jobId, STORAGE_WRITE_ERROR);
              return;
            }
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
          let png: Buffer;
          try {
            png = await this.readPng(jobId);
            if (job.kind === "full") await this.files.writeAll(ready, png);
            else await this.files.writeImage(ready, png);
          } catch (error) {
            this.logger.error(`job ${jobId}: ${error instanceof Error ? error.message : "storage"}`);
            await this.failOnce(jobId, STORAGE_WRITE_ERROR);
            return;
          }
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

  private async cancelOnce(jobId: string, message: string): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "running") return;
    const text = message.trim() || "отменено";
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "cancelled", error: text },
    });
    const post = await this.prisma.post.findUnique({ where: { id: job.postId } });
    if (post?.status === "draft") {
      await this.prisma.post.update({ where: { id: post.id }, data: { status: "failed" } });
    }
    this.hub.publish(jobId, { event: "cancelled", data: { message: text } });
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
            imagePresetId: input.imagePresetId,
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
    const active = await this.prisma.generationJob.count({
      where: { postId, status: { in: ["queued", "running"] } },
    });
    if (active > 0) throw new ConflictException("генерация уже идёт");
  }

  private async requirePost(id: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException("пост не найден");
    return post;
  }

  private async requirePreset(id: string): Promise<StylePreset> {
    const preset = await this.prisma.stylePreset.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException("шаблон не найден");
    return preset;
  }

  private async requireImagePreset(id: string) {
    const preset = await this.prisma.imagePromptPreset.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException("шаблон картинки не найден");
    return preset;
  }

  private async imageStyleOf(id: string | null): Promise<string> {
    if (!id) return "";
    const preset = await this.prisma.imagePromptPreset.findUnique({ where: { id } });
    return preset?.prompt.trim() ?? "";
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

function jobKind(kind: string): "full" | "text" | "image" {
  if (kind === "text" || kind === "image") return kind;
  return "full";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function streamPath(kind: string): string {
  if (kind === "text") return "/pipeline/text/stream";
  if (kind === "image") return "/pipeline/image/stream";
  return "/pipeline/stream";
}

function postBody(
  post: Post,
  jobId: string,
  preset: StylePreset | null,
  imageStyle: string,
): Record<string, unknown> {
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
  return withImageStyle(body, imageStyle);
}

function imageBody(post: Post, jobId: string, imageStyle: string, seed?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: post.text,
    width: post.width,
    height: post.height,
    steps: post.steps,
    job_id: jobId,
  };
  if (post.temperature !== null) body.temperature = post.temperature;
  if (seed !== undefined) body.seed = seed;
  return withImageStyle(body, imageStyle);
}

function withImageStyle(body: Record<string, unknown>, imageStyle: string): Record<string, unknown> {
  const style = imageStyle.trim();
  if (style) body.image_style = style;
  return body;
}

const STORAGE_WRITE_ERROR = "Не удалось записать файлы поста.";

function parseImagePresetUpdate(body: unknown): string | null | undefined {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, "imagePresetId")) return undefined;
  const value = body.imagePresetId;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException("imagePresetId должен быть строкой");
  }
  return value.trim();
}

function parseImageSeed(body: unknown): number | undefined {
  if (body === undefined || body === null || body === "") return undefined;
  if (!isRecord(body) || body.seed === undefined || body.seed === null) return undefined;
  if (typeof body.seed !== "number" || !Number.isInteger(body.seed)) {
    throw new BadRequestException("seed должен быть целым");
  }
  if (body.seed < 0 || body.seed > 2_147_483_647) {
    throw new BadRequestException("seed вне диапазона 0..2147483647");
  }
  return body.seed;
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
