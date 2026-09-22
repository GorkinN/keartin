import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Book } from "@prisma/client";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PythonClient, PythonRequestError } from "../ai/python.client";
import { AppEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { bookMeta, toBookDto, type BookDto } from "./book.dto";

const ALLOWED = new Set(["pdf", "epub", "fb2", "docx", "txt"]);
const INDEX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const POLL_MS = 1000;

export type UploadFile = {
  originalname: string;
  buffer: Buffer;
};

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private readonly stops = new Map<string, () => void>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly python: PythonClient,
    private readonly env: AppEnv,
  ) {}

  async list(): Promise<BookDto[]> {
    const books = await this.prisma.book.findMany({ orderBy: { createdAt: "desc" } });
    return books.map(toBookDto);
  }

  async get(id: string): Promise<BookDto> {
    const book = await this.prisma.book.findUnique({ where: { id } });
    if (!book) throw new NotFoundException("книга не найдена");
    return toBookDto(book);
  }

  async upload(file: UploadFile | undefined): Promise<BookDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException("нужен файл в поле file");
    }
    const filename = displayFilename(file.originalname);
    const format = extensionOf(filename);
    if (!ALLOWED.has(format)) {
      throw new BadRequestException("поддерживаются pdf, epub, fb2, docx, txt");
    }
    const id = randomUUID();
    const storageKey = `library/${id}/source.${format}`;
    await this.storage.putBytes(storageKey, file.buffer);
    const created = await this.prisma.book.create({
      data: {
        id,
        filename,
        format,
        storageKey,
        status: "indexing",
      },
    });
    await this.writeMeta(created);
    try {
      await this.startIndex(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI-сервис недоступен";
      const failed = await this.prisma.book.update({
        where: { id },
        data: { status: "error", error: message },
      });
      await this.writeMeta(failed);
      throw new HttpException({ statusCode: 502, message, book: toBookDto(failed) }, 502);
    }
    const book = await this.prisma.book.findUniqueOrThrow({ where: { id } });
    return toBookDto(book);
  }

  async reindex(id: string): Promise<BookDto> {
    const book = await this.prisma.book.findUnique({ where: { id } });
    if (!book) throw new NotFoundException("книга не найдена");
    if (book.status === "indexing") {
      throw new ConflictException("индексация уже идёт");
    }
    await this.startIndex(id);
    const updated = await this.prisma.book.findUniqueOrThrow({ where: { id } });
    return toBookDto(updated);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const book = await this.prisma.book.findUnique({ where: { id } });
    if (!book) throw new NotFoundException("книга не найдена");
    if (book.status === "indexing") {
      throw new ConflictException("дождитесь конца индексации");
    }
    try {
      await this.python.deleteBook(id);
    } catch (error) {
      throw mapPython(error);
    }
    await this.storage.deletePrefix(`library/${id}`);
    await this.removeStage(id);
    this.stops.get(id)?.();
    this.stops.delete(id);
    await this.prisma.book.delete({ where: { id } });
    return { ok: true };
  }

  private async startIndex(id: string): Promise<void> {
    const book = await this.prisma.book.findUniqueOrThrow({ where: { id } });
    const localPath = await this.localIndexPath(book.storageKey, id);
    const accepted = await this.python.indexBook(localPath, id, book.filename).catch((error: unknown) => {
      throw mapPython(error);
    });
    const indexing = await this.prisma.book.update({
      where: { id },
      data: {
        status: "indexing",
        indexJobId: accepted.job_id,
        error: null,
        chunksDone: 0,
        chunksTotal: 0,
      },
    });
    await this.writeMeta(indexing);
    this.watch(id, accepted.job_id);
  }

  private watch(bookId: string, jobId: string): void {
    this.stops.get(bookId)?.();
    let stopped = false;
    this.stops.set(bookId, () => {
      stopped = true;
    });
    void this.poll(bookId, jobId, () => stopped).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "индексация прервана";
      this.logger.error(`index poll ${bookId}: ${message}`);
    });
  }

  private async poll(bookId: string, jobId: string, stopped: () => boolean): Promise<void> {
    const started = Date.now();
    let misses = 0;
    while (!stopped()) {
      if (Date.now() - started > INDEX_TIMEOUT_MS) {
        await this.finish(bookId, "error", "таймаут индексации", null);
        return;
      }
      await sleep(POLL_MS);
      if (stopped()) return;
      let status;
      try {
        status = await this.python.indexStatus(jobId);
        misses = 0;
      } catch (error) {
        misses += 1;
        this.logger.warn(
          `index status ${jobId}: ${error instanceof Error ? error.message : "error"}`,
        );
        if (misses >= 5) {
          await this.finish(bookId, "error", "AI-сервис недоступен", null);
          return;
        }
        continue;
      }
      if (!status) {
        await this.finish(bookId, "error", "индексация прервана: задача не найдена", null);
        return;
      }
      const book = await this.prisma.book.findUnique({ where: { id: bookId } });
      if (!book || book.indexJobId !== jobId) return;
      if (status.status === "ready") {
        await this.finish(bookId, "ready", null, status);
        await this.removeStage(bookId);
        return;
      }
      if (status.status === "error") {
        await this.finish(bookId, "error", status.error ?? "ошибка индексации", status);
        await this.removeStage(bookId);
        return;
      }
      if (book.chunksDone !== status.chunks_done || book.chunksTotal !== status.chunks_total) {
        await this.prisma.book.update({
          where: { id: bookId },
          data: {
            chunksDone: status.chunks_done,
            chunksTotal: status.chunks_total,
          },
        });
      }
    }
  }

  private async finish(
    bookId: string,
    status: "ready" | "error",
    error: string | null,
    index: { chunks_done: number; chunks_total: number } | null,
  ): Promise<void> {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) return;
    const updated = await this.prisma.book.update({
      where: { id: bookId },
      data: {
        status,
        error,
        chunksDone: index?.chunks_done ?? book.chunksDone,
        chunksTotal: index?.chunks_total ?? book.chunksTotal,
      },
    });
    await this.writeMeta(updated);
    this.stops.delete(bookId);
  }

  private async localIndexPath(storageKey: string, bookId: string): Promise<string> {
    const direct = this.storage.absolutePath(storageKey);
    if (direct) return direct;
    let bytes: Buffer;
    try {
      bytes = await this.storage.getBytes(storageKey);
    } catch {
      throw new BadRequestException("файл книги не найден");
    }
    const dir = join(this.env.repoRoot, "data", "tmp", "index", bookId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, basename(storageKey));
    await writeFile(file, bytes);
    return file;
  }

  private async removeStage(bookId: string): Promise<void> {
    await rm(join(this.env.repoRoot, "data", "tmp", "index", bookId), {
      recursive: true,
      force: true,
    });
  }

  private async writeMeta(book: Book): Promise<void> {
    await this.storage.putText(`library/${book.id}/meta.json`, bookMeta(book));
  }
}

function displayFilename(original: string): string {
  const normalized = normalizeUploadName(original);
  const base = basename(normalized).replace(/[\u0000-\u001f]/g, "").trim();
  const clipped = (base || "book").slice(0, 200);
  return clipped;
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

function normalizeUploadName(name: string): string {
  if (name.includes("Ð") || name.includes("Ã")) {
    return Buffer.from(name, "latin1").toString("utf8");
  }
  return name;
}

function mapPython(error: unknown): HttpException {
  if (error instanceof PythonRequestError) {
    if (error.statusCode === 400) return new BadRequestException(error.message);
    if (error.statusCode === 404) return new NotFoundException(error.message);
    return new HttpException(error.message, 502);
  }
  if (error instanceof HttpException) return error;
  return new HttpException("AI-сервис недоступен", 502);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
