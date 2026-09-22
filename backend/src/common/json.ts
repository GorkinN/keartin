export function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export type SourceRef = {
  bookId: string;
  chunkIndex: number;
  sourceName: string;
  score: number;
};

export function parseSources(raw: string): SourceRef[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        bookId: String(row.bookId ?? row.book_id ?? ""),
        chunkIndex: Number(row.chunkIndex ?? row.chunk_index ?? 0),
        sourceName: String(row.sourceName ?? row.source_name ?? ""),
        score: Number(row.score ?? 0),
      };
    });
  } catch {
    return [];
  }
}

export function sourcesFromEvent(data: unknown): SourceRef[] {
  if (!isRecord(data) || !Array.isArray(data.sources)) return [];
  return parseSources(JSON.stringify(data.sources));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asFileText(text: string): string {
  return `${text.replace(/\s+$/u, "")}\n`;
}
