import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TonePreset } from "@prisma/client";
import { isRecord } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";

export type TonePresetDto = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class TonePresetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<TonePresetDto[]> {
    const rows = await this.prisma.tonePreset.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toDto);
  }

  async get(id: string): Promise<TonePresetDto> {
    return toDto(await this.find(id));
  }

  async create(body: unknown): Promise<TonePresetDto> {
    const input = parsePreset(body, true);
    const row = await this.prisma.tonePreset.create({
      data: {
        name: input.name ?? "",
        text: input.text ?? "",
      },
    });
    return toDto(row);
  }

  async update(id: string, body: unknown): Promise<TonePresetDto> {
    await this.find(id);
    const input = parsePreset(body, false);
    if (input.name === undefined && input.text === undefined) {
      throw new BadRequestException("нет полей для обновления");
    }
    const row = await this.prisma.tonePreset.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.find(id);
    await this.prisma.tonePreset.delete({ where: { id } });
    return { ok: true };
  }

  private async find(id: string): Promise<TonePreset> {
    const row = await this.prisma.tonePreset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("пресет тона не найден");
    return row;
  }
}

function toDto(row: TonePreset): TonePresetDto {
  return {
    id: row.id,
    name: row.name,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parsePreset(body: unknown, creating: boolean): { name?: string; text?: string } {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  const result: { name?: string; text?: string } = {};
  if (body.name !== undefined || creating) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new BadRequestException("нужно имя пресета");
    }
    const name = body.name.trim();
    if (name.length > 120) throw new BadRequestException("имя пресета длиннее 120 символов");
    result.name = name;
  }
  if (body.text !== undefined || creating) {
    if (typeof body.text !== "string") {
      throw new BadRequestException("текст тона должен быть строкой");
    }
    const text = body.text.trim();
    if (!text) throw new BadRequestException("нужен текст тона");
    if (text.length > 200) throw new BadRequestException("текст тона длиннее 200 символов");
    result.text = text;
  }
  return result;
}
