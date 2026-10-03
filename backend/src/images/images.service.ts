import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import type { Response } from "express";
import { PythonClient, PythonRequestError } from "../ai/python.client";
import type { SseEvent } from "../ai/sse";
import { isRecord } from "../common/json";
import { AppEnv } from "../config/env";
import { JobHub } from "../generate/job-hub";
import { PrismaService } from "../prisma/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { asFileText } from "../common/json";
import { nextStoragePrefix } from "../posts/slug";
import { imageMeta, toImageBatchDto, type ImageBatchDto, type ImageQueueItem } from "./image.dto";
import { parseImageBatchInput, type ImageBatchInput } from "./input";
import { imageModelOfRepo, repoForImageModel } from "./limits";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type UploadImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const STORAGE_WRITE_ERROR = "Не удалось записать картинку.";

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonClient,
    private readonly env: AppEnv,
    private readonly storage: StorageProvider,
    private readonly hub: JobHub,
  ) {}

  async enqueue(
    body: unknown,
    files?: { references?: UploadImage[]; mask?: UploadImage[] },
  ): Promise<{ jobId: string; batchId: string }> {
    const input = parseImageBatchInput(body);
    const references = files?.references ?? [];
    const mask = files?.mask?.[0];
    if (input.model !== "qwen" && (references.length > 0 || mask)) {
      throw new BadRequestException("референсы и маска доступны только у Qwen-Image-2.1");
    }
    if (references.length > 10) throw new BadRequestException("не больше 10 референсов");
    if (mask && references.length === 0) throw new BadRequestException("маске нужен референс");
    if (references.length + (mask ? 1 : 0) > 10) {
      throw new BadRequestException("вместе с маской не больше 10 изображений");
    }
    for (const file of [...references, ...(mask ? [mask] : [])]) assertImageFile(file);
    if (!(await this.python.reachable())) {
      throw new BadGatewayException("AI-сервис недоступен");
    }
    const batch = await this.createBatch(input);
    const jobId = batch.job?.id;
    if (!jobId || !batch.storagePrefix) throw new ConflictException("не удалось подобрать имя папки");
    try {
      await this.storage.putText(`${batch.storagePrefix}/prompt.txt`, asFileText(batch.prompt));
      const referenceKeys: string[] = [];
      for (let index = 0; index < references.length; index += 1) {
        const key = `${batch.storagePrefix}/ref-${index}.png`;
        await this.storage.putBytes(key, references[index].buffer);
        referenceKeys.push(key);
      }
      const maskKey = mask ? `${batch.storagePrefix}/mask.png` : "";
      if (mask) await this.storage.putBytes(maskKey, mask.buffer);
      if (referenceKeys.length > 0 || maskKey) {
        await this.prisma.imageBatch.update({
          where: { id: batch.id },
          data: { referenceKeys: JSON.stringify(referenceKeys), maskKey },
        });
      }
    } catch (error) {
      if (batch.storagePrefix) await this.storage.deletePrefix(batch.storagePrefix).catch(() => undefined);
      await this.prisma.imageBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
      throw error;
    }
    this.hub.open(jobId);
    return { jobId, batchId: batch.id };
  }

  async list(): Promise<ImageBatchDto[]> {
    const rows = await this.prisma.imageBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: { images: { orderBy: { index: "asc" } }, job: true },
    });
    return rows.map((row) => toImageBatchDto(row));
  }

  async get(id: string): Promise<ImageBatchDto> {
    const row = await this.prisma.imageBatch.findUnique({
      where: { id },
      include: { images: { orderBy: { index: "asc" } }, job: true },
    });
    if (!row) throw new NotFoundException("пачка не найдена");
    return toImageBatchDto(row);
  }

  async openFolder(id: string): Promise<{ ok: true; path: string }> {
    if (this.storage.driver !== "fs") {
      throw new BadRequestException("открытие папки доступно только для локального хранилища");
    }
    if (process.platform !== "win32") {
      throw new BadRequestException("открытие папки поддерживается только в Windows");
    }
    const batch = await this.prisma.imageBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException("пачка не найдена");
    const prefix = batch.storagePrefix || `images/${batch.id}`;
    const dir = this.storage.absoluteDir(prefix);
    if (!dir) {
      throw new BadRequestException("открытие папки доступно только для локального хранилища");
    }
    try {
      await access(dir);
    } catch {
      throw new NotFoundException("папка картинок не найдена");
    }
    const child = spawn("explorer.exe", [dir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true, path: dir };
  }

  async listQueue(): Promise<ImageQueueItem[]> {
    const jobs = await this.prisma.imageJob.findMany({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
      include: { batch: { select: { prompt: true, count: true } } },
    });
    return jobs.map((job) => ({
      jobId: job.id,
      batchId: job.batchId,
      prompt: job.batch.prompt,
      count: job.batch.count,
      status: job.status === "running" ? "running" : "queued",
    }));
  }

  async removeQueued(jobId: string): Promise<{ ok: true }> {
    const job = await this.prisma.imageJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("джоба не найдена");
    if (job.status !== "queued") throw new ConflictException("задание уже выполняется");
    this.hub.publish(jobId, { event: "cancelled", data: { message: "убрано из очереди" } });
    this.hub.close(jobId);
    const batch = await this.prisma.imageBatch.findUnique({ where: { id: job.batchId } });
    if (batch?.storagePrefix) await this.storage.deletePrefix(batch.storagePrefix);
    await this.prisma.imageBatch.delete({ where: { id: job.batchId } });
    return { ok: true };
  }

  async remove(id: string): Promise<{ ok: true }> {
    const batch = await this.prisma.imageBatch.findUnique({
      where: { id },
      include: { job: true },
    });
    if (!batch) throw new NotFoundException("пачка не найдена");
    if (batch.job && (batch.job.status === "queued" || batch.job.status === "running")) {
      throw new ConflictException("нельзя удалить пачку, пока она в очереди или генерируется");
    }
    await this.storage.deletePrefix(batch.storagePrefix || `images/${batch.id}`);
    await this.prisma.imageBatch.delete({ where: { id: batch.id } });
    return { ok: true };
  }

  async readFile(id: string, rawIndex: string): Promise<Buffer> {
    const index = parseIndex(rawIndex);
    const image = await this.prisma.generatedImage.findUnique({
      where: { batchId_index: { batchId: id, index } },
    });
    if (!image) throw new NotFoundException("картинка не найдена");
    try {
      return await this.storage.getBytes(image.storageKey);
    } catch (error) {
      if (isMissingObject(error)) throw new NotFoundException("картинка не найдена");
      throw error;
    }
  }

  async cancel(jobId: string): Promise<{ jobId: string; status: "cancelled" }> {
    const job = await this.prisma.imageJob.findUnique({ where: { id: jobId } });
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
        const current = await this.prisma.imageJob.findUnique({ where: { id: jobId } });
        if (!current || current.status !== "running") {
          throw new ConflictException("генерация уже завершена");
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
    }
    throw new BadGatewayException("не удалось отменить генерацию");
  }

  async events(id: string, res: Response): Promise<void> {
    const job = await this.prisma.imageJob.findUnique({ where: { id } });
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

  async consume(jobId: string): Promise<void> {
    const job = await this.prisma.imageJob.findUnique({
      where: { id: jobId },
      include: { batch: true },
    });
    if (!job || job.status !== "running") return;
    let finished = false;
    const fail = async (message: string) => {
      if (finished) return;
      finished = true;
      await this.failOnce(jobId, message);
    };
    const referenceKeys = parseKeys(job.batch.referenceKeys);
    const referencePaths: string[] = [];
    for (let index = 0; index < referenceKeys.length; index += 1) {
      referencePaths.push(await this.materialize(referenceKeys[index], `ref-${index}.png`, jobId));
    }
    const maskPath = job.batch.maskKey ? await this.materialize(job.batch.maskKey, "mask.png", jobId) : undefined;
    const body: Record<string, unknown> = {
      prompt: job.batch.prompt,
      model: imageModelOfRepo(job.batch.fluxModel, this.env.qwenImageModelId),
      width: job.batch.width,
      height: job.batch.height,
      steps: job.batch.steps,
      count: job.batch.count,
      job_id: jobId,
      transparent: job.batch.transparent,
      gguf: job.batch.gguf,
      reference_paths: referencePaths,
      ...(maskPath ? { mask_path: maskPath } : {}),
    };
    if (job.batch.seed !== null) body.seed = job.batch.seed;
    try {
      await this.python.stream("/generate/images/stream", body, async (event) => {
        if (finished) return;
        if (event.event === "cancelled") {
          finished = true;
          await this.cancelOnce(jobId, messageOf(event.data));
          return;
        }
        if (event.event === "error") {
          await fail(messageOf(event.data));
          return;
        }
        if (event.event === "image_progress") {
          const progress = progressOf(event.data);
          if (progress) this.hub.publish(jobId, { event: "image_progress", data: progress });
          return;
        }
        if (event.event === "image_done") {
          try {
            const index = indexOf(event.data, job.batch.count);
            const seed = seedOf(event.data);
            await this.persistImage(job.batch, jobId, index, seed);
            this.hub.publish(jobId, { event: "image_done", data: { index, seed } });
          } catch (error) {
            const message = error instanceof Error ? error.message : STORAGE_WRITE_ERROR;
            this.logger.error(`job ${jobId}: ${message}`);
            await fail(message);
            await this.python.cancelPipeline(jobId).catch(() => undefined);
          }
          return;
        }
        if (event.event === "done") {
          const saved = await this.prisma.generatedImage.count({ where: { batchId: job.batchId } });
          if (saved !== job.batch.count) {
            await fail("не все картинки записаны");
            return;
          }
          finished = true;
          await this.prisma.imageJob.update({
            where: { id: jobId },
            data: { status: "succeeded", error: null },
          });
          await this.prisma.imageBatch.update({
            where: { id: job.batchId },
            data: { status: "ready", error: null },
          });
          await this.writeArchive(job.batchId).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : STORAGE_WRITE_ERROR;
            this.logger.error(`job ${jobId}: ${message}`);
          });
          this.hub.publish(jobId, { event: "done", data: { count: saved } });
          return;
        }
        if (event.event === "status") this.hub.publish(jobId, event);
      });
      if (!finished) await fail("поток завершился без результата");
    } catch (error) {
      const message = error instanceof Error ? error.message : "ошибка генерации";
      this.logger.error(`job ${jobId}: ${message}`);
      await fail(message);
    }
  }

  async failOnce(jobId: string, message: string): Promise<void> {
    const job = await this.prisma.imageJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "running") return;
    await this.prisma.imageJob.update({
      where: { id: jobId },
      data: { status: "failed", error: message },
    });
    await this.prisma.imageBatch.updateMany({
      where: { id: job.batchId, status: { in: ["queued", "running"] } },
      data: { status: "failed", error: message },
    });
    this.hub.publish(jobId, { event: "error", data: { message } });
    await this.writeArchive(job.batchId).catch(() => undefined);
  }

  private async cancelOnce(jobId: string, message: string): Promise<void> {
    const job = await this.prisma.imageJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "running") return;
    const text = message.trim() || "отменено";
    await this.prisma.imageJob.update({
      where: { id: jobId },
      data: { status: "cancelled", error: text },
    });
    await this.prisma.imageBatch.updateMany({
      where: { id: job.batchId, status: { in: ["queued", "running"] } },
      data: { status: "cancelled", error: text },
    });
    this.hub.publish(jobId, { event: "cancelled", data: { message: text } });
  }

  private async createBatch(input: ImageBatchInput) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let slot: { storagePrefix: string };
      try {
        slot = await nextStoragePrefix(
          input.prompt,
          async (storagePrefix) => {
            const existing = await this.prisma.imageBatch.findUnique({ where: { storagePrefix } });
            return existing !== null;
          },
          new Date(),
          "images",
        );
      } catch {
        throw new ConflictException("не удалось подобрать имя папки");
      }
      const jobId = randomUUID();
      try {
        return await this.prisma.imageBatch.create({
          data: {
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            steps: input.steps,
            seed: input.seed,
            count: input.count,
            status: "queued",
            transparent: input.transparent,
            gguf: input.model === "qwen" ? input.gguf : "",
            storagePrefix: slot.storagePrefix,
            fluxModel: repoForImageModel(input.model, this.env.fluxModelId, this.env.qwenImageModelId),
            job: { create: { id: jobId, status: "queued" } },
          },
          include: { job: true },
        });
      } catch (error) {
        if (isUnique(error) && attempt < 4) continue;
        throw error;
      }
    }
    throw new ConflictException("не удалось подобрать имя папки");
  }

  private async writeArchive(batchId: string): Promise<void> {
    const batch = await this.prisma.imageBatch.findUnique({
      where: { id: batchId },
      include: { images: { orderBy: { index: "asc" } }, job: true },
    });
    if (!batch?.storagePrefix) return;
    await this.storage.putText(`${batch.storagePrefix}/prompt.txt`, asFileText(batch.prompt));
    await this.storage.putText(`${batch.storagePrefix}/meta.json`, imageMeta(batch));
  }

  private async persistImage(
    batch: { id: string; storagePrefix: string | null },
    jobId: string,
    index: number,
    seed: number,
  ): Promise<void> {
    const png = await this.readPng(jobId, index);
    const prefix = batch.storagePrefix || `images/${batch.id}`;
    const storageKey = `${prefix}/${index}.png`;
    await this.storage.putBytes(storageKey, png);
    await this.prisma.generatedImage.upsert({
      where: { batchId_index: { batchId: batch.id, index } },
      create: { batchId: batch.id, index, seed, storageKey },
      update: { seed, storageKey },
    });
  }

  private async materialize(key: string, name: string, jobId: string): Promise<string> {
    const absolute = this.storage.absolutePath(key);
    if (absolute) return absolute;
    const bytes = await this.storage.getBytes(key);
    const dir = resolve(this.env.repoRoot, "data", "tmp", "images", jobId, "inputs");
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, name);
    if (!file.startsWith(dir + sep)) throw new Error("некорректный путь картинки");
    await writeFile(file, bytes);
    return file;
  }

  private async readPng(jobId: string, index: number): Promise<Buffer> {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(jobId)) throw new Error("некорректный путь картинки");
    const root = resolve(this.env.repoRoot, "data", "tmp", "images", jobId);
    const file = resolve(root, `${index}.png`);
    if (!file.startsWith(root + sep)) throw new Error("некорректный путь картинки");
    try {
      return await readFile(file);
    } catch {
      throw new Error("файл картинки не найден");
    }
  }

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
    const current = await this.prisma.imageJob.findUnique({ where: { id } });
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
}

function assertImageFile(file: UploadImage): void {
  if (!file.buffer?.length) throw new BadRequestException("пустой файл изображения");
  if (file.size > 25 * 1024 * 1024) throw new BadRequestException("изображение больше 25 МБ");
  if (!IMAGE_TYPES.has(file.mimetype)) throw new BadRequestException("нужен PNG, JPEG или WebP");
}

function parseKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) return [];
    return parsed;
  } catch {
    return [];
  }
}

function parseIndex(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new BadRequestException("некорректный номер картинки");
  const index = Number(raw);
  if (index > 19) throw new BadRequestException("некорректный номер картинки");
  return index;
}

function progressOf(data: unknown): { index: number; step: number; total: number } | null {
  if (!isRecord(data)) return null;
  if (typeof data.index !== "number" || typeof data.step !== "number" || typeof data.total !== "number") {
    return null;
  }
  return { index: data.index, step: data.step, total: data.total };
}

function indexOf(data: unknown, count: number): number {
  if (!isRecord(data) || typeof data.index !== "number" || !Number.isInteger(data.index)) {
    throw new Error("в событии нет номера картинки");
  }
  if (data.index < 0 || data.index >= count) throw new Error("некорректный номер картинки");
  return data.index;
}

function seedOf(data: unknown): number {
  if (isRecord(data) && typeof data.seed === "number" && Number.isFinite(data.seed)) {
    const seed = Math.trunc(data.seed);
    if (seed >= 0 && seed <= 2_147_483_647) return seed;
  }
  throw new Error("в событии image_done нет seed");
}

function messageOf(data: unknown): string {
  if (isRecord(data) && typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }
  return "ошибка генерации";
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: number } };
  if (record.code === "ENOENT") return true;
  if (record.name === "NoSuchKey" || record.name === "NotFound") return true;
  return record.$metadata?.httpStatusCode === 404;
}
