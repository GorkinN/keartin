import type { Book } from "@prisma/client";

export type BookDto = {
  id: string;
  filename: string;
  format: string;
  storageKey: string;
  status: string;
  indexJobId: string | null;
  error: string | null;
  chunksTotal: number;
  chunksDone: number;
  createdAt: string;
  updatedAt: string;
};

export function toBookDto(book: Book): BookDto {
  return {
    id: book.id,
    filename: book.filename,
    format: book.format,
    storageKey: book.storageKey,
    status: book.status,
    indexJobId: book.indexJobId,
    error: book.error,
    chunksTotal: book.chunksTotal,
    chunksDone: book.chunksDone,
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

export function bookMeta(book: Book): string {
  return `${JSON.stringify(
    {
      id: book.id,
      filename: book.filename,
      format: book.format,
      storageKey: book.storageKey,
      status: book.status,
      error: book.error,
      chunksTotal: book.chunksTotal,
      chunksDone: book.chunksDone,
      updatedAt: book.updatedAt.toISOString(),
    },
    null,
    2,
  )}\n`;
}
