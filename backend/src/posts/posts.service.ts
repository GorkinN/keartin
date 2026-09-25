import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Post } from "@prisma/client";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { PrismaService } from "../prisma/prisma.service";
import { StorageProvider } from "../storage/storage.provider";
import { toPostDto, type PostDto } from "./post.dto";

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
  ) {}

  async list(): Promise<PostDto[]> {
    const posts = await this.prisma.post.findMany({
      orderBy: { createdAt: "desc" },
      include: { jobs: { where: { status: "running" }, take: 1 } },
    });
    return posts.map((post) => toPostDto(post, post.jobs[0]?.id ?? null));
  }

  async get(id: string): Promise<PostDto> {
    const post = await this.find(id);
    return toPostDto(post, await this.activeJobId(id));
  }

  async readImage(id: string): Promise<Buffer> {
    const post = await this.find(id);
    if (!post.imageKey) throw new NotFoundException("картинка ещё не готова");
    try {
      return await this.storage.getBytes(post.imageKey);
    } catch (error) {
      if (isMissingObject(error)) throw new NotFoundException("картинка не найдена");
      throw error;
    }
  }

  async remove(id: string): Promise<{ ok: true }> {
    const post = await this.find(id);
    const active = await this.prisma.generationJob.count({
      where: { postId: id, status: { in: ["queued", "running"] } },
    });
    if (active > 0) throw new ConflictException("нельзя удалить пост, пока он в очереди или генерируется");
    await this.storage.deletePrefix(post.storagePrefix);
    await this.prisma.post.delete({ where: { id } });
    return { ok: true };
  }

  async openFolder(id: string): Promise<{ ok: true; path: string }> {
    if (this.storage.driver !== "fs") {
      throw new BadRequestException("открытие папки доступно только для локального хранилища");
    }
    if (process.platform !== "win32") {
      throw new BadRequestException("открытие папки поддерживается только в Windows");
    }
    const post = await this.find(id);
    const dir = this.storage.absoluteDir(post.storagePrefix);
    if (!dir) {
      throw new BadRequestException("открытие папки доступно только для локального хранилища");
    }
    try {
      await access(dir);
    } catch {
      throw new NotFoundException("папка поста не найдена");
    }
    const child = spawn("explorer.exe", [dir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return { ok: true, path: dir };
  }

  private async find(id: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException("пост не найден");
    return post;
  }

  private async activeJobId(postId: string): Promise<string | null> {
    const job = await this.prisma.generationJob.findFirst({
      where: { postId, status: "running" },
      orderBy: { createdAt: "desc" },
    });
    return job?.id ?? null;
  }
}

function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: number } };
  if (record.code === "ENOENT") return true;
  if (record.name === "NoSuchKey" || record.name === "NotFound") return true;
  return record.$metadata?.httpStatusCode === 404;
}
