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

  async remove(id: string): Promise<{ ok: true }> {
    const post = await this.find(id);
    const running = await this.prisma.generationJob.count({
      where: { postId: id, status: "running" },
    });
    if (running > 0) throw new ConflictException("нельзя удалить пост во время генерации");
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
