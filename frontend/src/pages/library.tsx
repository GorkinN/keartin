import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { bookStatusLabel } from "@/api/labels";
import type { Book } from "@/api/types";
import { BookOutline } from "@/components/book-outline";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function LibraryPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const books = useQuery({
    queryKey: ["books"],
    queryFn: () => api<Book[]>("/library/books"),
    refetchInterval: (query) => (query.state.data?.some((book) => book.status === "indexing") ? 2000 : false),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api<Book>("/library/books", { method: "POST", body });
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const reindex = useMutation({
    mutationFn: (id: string) => api<Book>(`/library/books/${id}/reindex`, { method: "POST" }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const outline = useMutation({
    mutationFn: (id: string) => api<Book>(`/library/books/${id}/outline`, { method: "POST" }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/library/books/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["books"] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Библиотека</h1>
        <Button type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? "Загрузка…" : "Загрузить"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.epub,.fb2,.docx,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
      </div>
      <ErrorText message={books.isError ? errorMessage(books.error) : actionError} />
      {books.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {books.data && books.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Книг пока нет. Загрузите PDF, EPUB, FB2, DOCX или TXT.</p>
        </Card>
      ) : null}
      <div className="space-y-3">
        {books.data?.map((book) => {
          const ocr = book.status === "indexing" && book.phase === "ocr";
          const outlining = book.status === "indexing" && book.phase === "outline";
          const percent = ocr
            ? book.pagesTotal > 0
              ? (book.pagesDone / book.pagesTotal) * 100
              : 0
            : book.chunksTotal > 0
              ? (book.chunksDone / book.chunksTotal) * 100
              : 0;
          const showProgress =
            book.status === "indexing" && !outlining && (ocr ? book.pagesTotal > 0 : book.chunksTotal > 0);
          const buildingOutline = outline.isPending && outline.variables === book.id;
          return (
            <Card key={book.id}>
              <div className="space-y-1">
                <p className="break-words font-medium">{book.filename}</p>
                <p className="text-sm text-muted-foreground">
                  {book.format} ·{" "}
                  {outlining ? "оглавление" : ocr ? "распознавание скана" : bookStatusLabel(book.status)}
                  {ocr && book.pagesTotal > 0 ? ` · страница ${book.pagesDone}/${book.pagesTotal}` : ""}
                  {!ocr && !outlining && book.chunksTotal > 0 ? ` · ${book.chunksDone}/${book.chunksTotal}` : ""}
                  {book.textKey && !ocr ? " · текст распознан" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {book.status === "ready" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={outline.isPending || reindex.isPending}
                    onClick={() => outline.mutate(book.id)}
                  >
                    {buildingOutline
                      ? "Сбор…"
                      : book.outline.length > 0
                        ? "Собрать заново"
                        : "Собрать оглавление"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={book.status === "indexing" || reindex.isPending || buildingOutline}
                  onClick={() => reindex.mutate(book.id)}
                >
                  Переиндексировать
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={buildingOutline}
                  onClick={() => setDeleteTarget(book)}
                >
                  Удалить
                </Button>
              </div>
              {showProgress ? <Progress value={percent} /> : null}
              {book.status === "ready" && book.outline.length > 0 ? <BookOutline items={book.outline} /> : null}
              {book.outlineError ? <p className="text-sm text-destructive">{book.outlineError}</p> : null}
              {book.error ? <p className="text-sm text-destructive">{book.error}</p> : null}
            </Card>
          );
        })}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить книгу?"
        description={deleteTarget ? `«${deleteTarget.filename}» исчезнет из библиотеки. Посты останутся.` : ""}
        confirmLabel="Удалить"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
