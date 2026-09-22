import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { StylePreset } from "@prisma/client";
import { isRecord, parseStringArray } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";

export type PresetDto = {
  id: string;
  name: string;
  description: string;
  examples: string[];
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class PresetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PresetDto[]> {
    const rows = await this.prisma.stylePreset.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toPresetDto);
  }

  async get(id: string): Promise<PresetDto> {
    return toPresetDto(await this.find(id));
  }

  async create(body: unknown): Promise<PresetDto> {
    const input = parsePreset(body, true);
    const row = await this.prisma.stylePreset.create({
      data: {
        name: input.name ?? "",
        description: input.description ?? "",
        examples: JSON.stringify(input.examples ?? []),
      },
    });
    return toPresetDto(row);
  }

  async update(id: string, body: unknown): Promise<PresetDto> {
    await this.find(id);
    const input = parsePreset(body, false);
    if (input.name === undefined && input.description === undefined && input.examples === undefined) {
      throw new BadRequestException("нет полей для обновления");
    }
    const row = await this.prisma.stylePreset.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.examples !== undefined ? { examples: JSON.stringify(input.examples) } : {}),
      },
    });
    return toPresetDto(row);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.find(id);
    await this.prisma.stylePreset.delete({ where: { id } });
    return { ok: true };
  }

  private async find(id: string): Promise<StylePreset> {
    const row = await this.prisma.stylePreset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("пресет не найден");
    return row;
  }
}

function toPresetDto(row: StylePreset): PresetDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examples: parseStringArray(row.examples),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parsePreset(
  body: unknown,
  creating: boolean,
): { name?: string; description?: string; examples?: string[] } {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  const result: { name?: string; description?: string; examples?: string[] } = {};
  if (body.name !== undefined || creating) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new BadRequestException("нужно имя пресета");
    }
    const name = body.name.trim();
    if (name.length > 120) throw new BadRequestException("имя пресета длиннее 120 символов");
    result.name = name;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      throw new BadRequestException("description должен быть строкой");
    }
    const description = body.description.trim();
    if (description.length > 4000) {
      throw new BadRequestException("описание пресета длиннее 4000 символов");
    }
    result.description = description;
  }
  if (body.examples !== undefined) {
    result.examples = parseExamples(body.examples);
  }
  return result;
}

function parseExamples(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BadRequestException("examples должен быть массивом строк");
  const examples = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (examples.length > 5) throw new BadRequestException("не больше 5 примеров");
  if (examples.some((item) => item.length > 2000)) {
    throw new BadRequestException("пример длиннее 2000 символов");
  }
  return examples;
}
