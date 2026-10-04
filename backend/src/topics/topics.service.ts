import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Book, TopicSearch } from "@prisma/client";
import { PythonClient, PythonRequestError } from "../ai/python.client";
import { isRecord, parseStringArray } from "../common/json";
import { PrismaService } from "../prisma/prisma.service";
import { fetchNewsHeadlines, NewsRssError } from "./news-rss";

const RANK_FAILED = "Модель не собрала список тем.";
const MAX_BOOKS = 5;
const MAX_OUTLINE_ITEMS = 80;

export type TopicItem = {
  title: string;
  reason: string;
};

export type TopicSearchDto = {
  id: string;
  area: string;
  bookIds: string[];
  topics: TopicItem[];
  createdAt: string;
};

@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly python: PythonClient,
  ) {}

  async list(): Promise<{ items: TopicSearchDto[] }> {
    const rows = await this.prisma.topicSearch.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { items: rows.map(toDto) };
  }

  async create(body: unknown): Promise<TopicSearchDto> {
    const input = parseInput(body);
    const books = await this.loadBooks(input.bookIds);
    const outlineItems = outlineOf(books);
    if (!input.area && outlineItems.length === 0) {
      throw new BadRequestException("В выбранных книгах нет оглавления.");
    }
    const headlines = input.area ? await this.headlines(input.area) : [];
    const topics = await this.rank(input.area, headlines, outlineItems);
    const row = await this.prisma.topicSearch.create({
      data: {
        area: input.area,
        bookIds: JSON.stringify(input.bookIds),
        topics: JSON.stringify(topics),
      },
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.topicSearch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("список тем не найден");
    await this.prisma.topicSearch.delete({ where: { id } });
  }

  private async loadBooks(ids: string[]): Promise<Book[]> {
    const books: Book[] = [];
    for (const id of ids) {
      const book = await this.prisma.book.findUnique({ where: { id } });
      if (!book) throw new NotFoundException("книга не найдена");
      if (book.status !== "ready") throw new ConflictException("книга не готова");
      books.push(book);
    }
    return books;
  }

  private async headlines(area: string): Promise<string[]> {
    try {
      return await fetchNewsHeadlines(area);
    } catch (error) {
      if (error instanceof NewsRssError) throw new BadGatewayException(error.message);
      throw new BadGatewayException("Не удалось получить заголовки.");
    }
  }

  private async rank(area: string, headlines: string[], outlineItems: string[]): Promise<TopicItem[]> {
    let body: unknown;
    try {
      body = await this.python.rankTopics({ area, headlines, outline_items: outlineItems });
    } catch (error) {
      const detail = error instanceof PythonRequestError ? error.message : "AI-сервис недоступен";
      this.logger.warn(`topic rank failed: ${detail}`);
      throw new BadGatewayException(RANK_FAILED);
    }
    return parseRanked(body);
  }
}

function outlineOf(books: Book[]): string[] {
  const items: string[] = [];
  for (const book of books) {
    for (const raw of parseStringArray(book.outline)) {
      const title = raw.trim().slice(0, 200);
      if (!title) continue;
      items.push(title);
      if (items.length === MAX_OUTLINE_ITEMS) return items;
    }
  }
  return items;
}

function parseInput(body: unknown): { area: string; bookIds: string[] } {
  if (!isRecord(body)) throw new BadRequestException("ожидается JSON-объект");
  let area = "";
  if (body.area !== undefined && body.area !== null && body.area !== "") {
    if (typeof body.area !== "string") throw new BadRequestException("Область должна быть строкой.");
    area = body.area.trim();
    if (area.length > 0 && (area.length < 2 || area.length > 200)) {
      throw new BadRequestException("Область должна быть от 2 до 200 символов.");
    }
  }
  const bookIds: string[] = [];
  if (body.bookIds !== undefined) {
    if (!Array.isArray(body.bookIds) || body.bookIds.some((id) => typeof id !== "string")) {
      throw new BadRequestException("Список книг составлен неверно.");
    }
    const seen = new Set<string>();
    for (const id of body.bookIds) {
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      bookIds.push(trimmed);
    }
    if (bookIds.length > MAX_BOOKS) throw new BadRequestException("Можно выбрать не больше 5 книг.");
  }
  if (!area && bookIds.length === 0) throw new BadRequestException("Укажите область или книги.");
  return { area, bookIds };
}

function parseRanked(body: unknown): TopicItem[] {
  if (!isRecord(body) || !Array.isArray(body.topics)) throw new BadGatewayException(RANK_FAILED);
  const topics: TopicItem[] = [];
  for (const item of body.topics) {
    if (!isRecord(item) || typeof item.title !== "string" || typeof item.reason !== "string") {
      throw new BadGatewayException(RANK_FAILED);
    }
    const title = item.title.trim();
    const reason = item.reason.trim();
    if (!title || !reason) throw new BadGatewayException(RANK_FAILED);
    topics.push({ title: title.slice(0, 200), reason: reason.slice(0, 300) });
  }
  if (topics.length < 8 || topics.length > 12) throw new BadGatewayException(RANK_FAILED);
  return topics;
}

function toDto(row: TopicSearch): TopicSearchDto {
  return {
    id: row.id,
    area: row.area,
    bookIds: parseStringArray(row.bookIds),
    topics: parseStoredTopics(row.topics),
    createdAt: row.createdAt.toISOString(),
  };
}

function parseStoredTopics(raw: string): TopicItem[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!isRecord(item) || typeof item.title !== "string" || typeof item.reason !== "string") return [];
      return [{ title: item.title, reason: item.reason }];
    });
  } catch {
    return [];
  }
}
