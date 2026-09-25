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
  phase: string;
  pagesTotal: number;
  pagesDone: number;
  textKey: string | null;
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
    phase: book.phase,
    pagesTotal: book.pagesTotal,
    pagesDone: book.pagesDone,
    textKey: book.textKey,
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
      textKey: book.textKey,
      status: book.status,
      error: book.error,
      chunksTotal: book.chunksTotal,
      chunksDone: book.chunksDone,
      pagesTotal: book.pagesTotal,
      updatedAt: book.updatedAt.toISOString(),
    },
    null,
    2,
  )}\n`;
}
