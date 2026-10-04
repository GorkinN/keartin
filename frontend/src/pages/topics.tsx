import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { gpuBusyLabel } from "@/api/seed";
import type { Book, GpuStatus, TopicSearch } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { FieldLabel } from "@/components/field-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function TopicsPage() {
  const queryClient = useQueryClient();
  const [area, setArea] = useState("");
  const [bookIds, setBookIds] = useState<string[]>([]);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const searches = useQuery({
    queryKey: ["topics"],
    queryFn: () => api<{ items: TopicSearch[] }>("/topics"),
  });
  const books = useQuery({
    queryKey: ["books"],
    queryFn: () => api<Book[]>("/library/books"),
  });
  const gpu = useQuery({
    queryKey: ["gpu-status"],
    queryFn: () => api<GpuStatus>("/gpu/status"),
    refetchInterval: 2000,
  });
  const search = useMutation({
    mutationFn: () => {
      const trimmed = area.trim();
      return api<TopicSearch>("/topics", {
        method: "POST",
        body: JSON.stringify({
          ...(trimmed ? { area: trimmed } : {}),
          ...(bookIds.length > 0 ? { bookIds } : {}),
        }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["topics"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/topics/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ["topics"] });
    },
  });

  const readyBooks = (books.data ?? []).filter((book) => book.status === "ready");
  const areaTrim = area.trim();
  const areaError =
    areaTrim.length > 0 && (areaTrim.length < 2 || areaTrim.length > 200)
      ? "Область должна быть от 2 до 200 символов."
      : null;
  const formReason = areaError ?? (!areaTrim && bookIds.length === 0 ? "Укажите область или книги." : null);
  const gpuLabel = gpuBusyLabel(gpu.data);
  const names = new Map((books.data ?? []).map((book) => [book.id, book.filename]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Темы</h1>
      <Card>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="topic-area" hint="В интернет уходит только эта фраза, не текст книг.">
            Область
          </FieldLabel>
          <Textarea
            id="topic-area"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="привычки, история Рима"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Книги</p>
          {readyBooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет готовых книг. Можно искать только по области.</p>
          ) : (
            readyBooks.map((book) => (
              <label key={book.id} className="flex cursor-pointer items-center gap-3 text-sm">
                <Switch
                  checked={bookIds.includes(book.id)}
                  onCheckedChange={(checked) => {
                    setBookIds((current) => {
                      if (!checked) return current.filter((id) => id !== book.id);
                      if (current.includes(book.id)) return current;
                      if (current.length >= 5) {
                        setLimitMessage("Можно выбрать не больше 5 книг.");
                        return current;
                      }
                      setLimitMessage(null);
                      return [...current, book.id];
                    });
                  }}
                  aria-label={book.filename}
                />
                <span>{book.filename}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={search.isPending || Boolean(formReason)} onClick={() => search.mutate()}>
            {search.isPending ? "Ищем темы…" : "Найти темы"}
          </Button>
          {formReason ? <p className="text-sm text-muted-foreground">{formReason}</p> : null}
          {limitMessage ? <p className="text-sm text-muted-foreground">{limitMessage}</p> : null}
        </div>
        {gpuLabel ? <p className="text-sm text-muted-foreground">{gpuLabel}</p> : null}
        <ErrorText message={search.isError ? errorMessage(search.error) : null} />
      </Card>
      <ErrorText message={searches.isError ? errorMessage(searches.error) : null} />
      {searches.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {searches.data && searches.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Сохранённых тем пока нет.</p>
      ) : null}
      <div className="space-y-3">
        {searches.data?.items.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium">{searchLabel(item, names)}</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteId(item.id)}>
                Удалить
              </Button>
            </div>
            <ol className="list-decimal space-y-3 pl-5">
              {item.topics.map((topic) => (
                <li key={`${item.id}-${topic.title}`}>
                  <Link
                    to={`/create?topic=${encodeURIComponent(topic.title)}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {topic.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">{topic.reason}</p>
                </li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={deleteId !== null}
        title="Удалить список тем?"
        description="Поиск можно будет повторить. Посты не изменятся."
        confirmLabel="Удалить"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={() => {
          if (deleteId) remove.mutate(deleteId);
        }}
      />
    </div>
  );
}

function searchLabel(item: TopicSearch, names: Map<string, string>): string {
  const books = item.bookIds.map((id) => names.get(id) ?? "книга удалена");
  const parts = [item.area, books.join(", ")].filter((part) => part.trim().length > 0);
  return parts.join(" · ") || "Темы";
}
