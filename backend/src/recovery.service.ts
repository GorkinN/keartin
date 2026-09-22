import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { bookMeta } from "./library/book.dto";
import { PrismaService } from "./prisma/prisma.service";
import { StorageProvider } from "./storage/storage.provider";

const RESTART_JOB = "прервано перезапуском";
const RESTART_INDEX = "индексация прервана перезапуском";

@Injectable()
export class RecoveryService implements OnModuleInit {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { status: "running" },
      data: { status: "failed", error: RESTART_JOB },
    });
    await this.prisma.post.updateMany({
      where: { status: "draft" },
      data: { status: "failed" },
    });
    const pending = await this.prisma.book.findMany({ where: { status: "indexing" } });
    if (pending.length === 0) return;
    await this.prisma.book.updateMany({
      where: { status: "indexing" },
      data: { status: "error", error: RESTART_INDEX },
    });
    for (const book of pending) {
      const updated = await this.prisma.book.findUnique({ where: { id: book.id } });
      if (!updated) continue;
      try {
        await this.storage.putText(`library/${book.id}/meta.json`, bookMeta(updated));
      } catch (error) {
        const message = error instanceof Error ? error.message : "meta write failed";
        this.logger.warn(`book ${book.id}: ${message}`);
      }
    }
  }
}
