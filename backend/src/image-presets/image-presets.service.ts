import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ImagePromptPreset } from "@prisma/client";
import { isRecord } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";

export type ImagePromptPresetDto = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class ImagePresetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ImagePromptPresetDto[]> {
    const rows = await this.prisma.imagePromptPreset.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toDto);
  }

  async get(id: string): Promise<ImagePromptPresetDto> {
    return toDto(await this.find(id));
  }

  async create(body: unknown): Promise<ImagePromptPresetDto> {
    const input = parsePreset(body, true);
    const row = await this.prisma.imagePromptPreset.create({
      data: {
        name: input.name ?? "",
        prompt: input.prompt ?? "",
      },
    });
    return toDto(row);
  }

  async update(id: string, body: unknown): Promise<ImagePromptPresetDto> {
    await this.find(id);
    const input = parsePreset(body, false);
    if (input.name === undefined && input.prompt === undefined) {
      throw new BadRequestException("нет полей для обновления");
    }
    const row = await this.prisma.imagePromptPreset.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.find(id);
    await this.prisma.imagePromptPreset.delete({ where: { id } });
    return { ok: true };
  }

  private async find(id: string): Promise<ImagePromptPreset> {
    const row = await this.prisma.imagePromptPreset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("пресет картинки не найден");
    return row;
  }
}

function toDto(row: ImagePromptPreset): ImagePromptPresetDto {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parsePreset(body: unknown, creating: boolean): { name?: string; prompt?: string } {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  const result: { name?: string; prompt?: string } = {};
  if (body.name !== undefined || creating) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new BadRequestException("нужно имя пресета");
    }
    const name = body.name.trim();
    if (name.length > 120) throw new BadRequestException("имя пресета длиннее 120 символов");
    result.name = name;
  }
  if (body.prompt !== undefined || creating) {
    if (typeof body.prompt !== "string") {
      throw new BadRequestException("промпт пресета должен быть строкой");
    }
    const prompt = body.prompt.trim();
    if (prompt.length < 10) {
      throw new BadRequestException("промпт пресета короче 10 символов");
    }
    if (prompt.length > 4000) {
      throw new BadRequestException("промпт пресета длиннее 4000 символов");
    }
    result.prompt = prompt;
  }
  return result;
}
