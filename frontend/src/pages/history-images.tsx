import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { imageModelLabel } from "@/api/image-model";
import { formatWhen } from "@/api/labels";
import type { ImageBatch } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const historyColumns = "grid grid-cols-[minmax(11rem,0.85fr)_minmax(0,1.4fr)]";

type ImageGroup = {
  prompt: string;
  batches: ImageBatch[];
  newest: number;
};

function promptExcerpt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return "без промпта";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function groupBatches(batches: ImageBatch[]): ImageGroup[] {
  const byPrompt = new Map<string, ImageBatch[]>();
  for (const batch of batches) {
    const prompt = batch.prompt.trim();
    const list = byPrompt.get(prompt);
    if (list) list.push(batch);
    else byPrompt.set(prompt, [batch]);
  }
  const groups = [...byPrompt.entries()].map(([prompt, items]) => {
    const sorted = [...items].sort((a, b) => {
      const byDate = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });
    const newest = sorted.reduce((max, batch) => Math.max(max, Date.parse(batch.createdAt)), 0);
    return { prompt, batches: sorted, newest };
  });
  groups.sort((a, b) => b.newest - a.newest || a.prompt.localeCompare(b.prompt));
  return groups;
}

function statusLabel(status: string): string {
  if (status === "queued") return "в очереди";
  if (status === "running") return "генерация";
  if (status === "ready") return "готово";
  if (status === "failed") return "ошибка";
  if (status === "cancelled") return "отменено";
  return status;
}

export function ImageHistoryList() {
  const [promptQuery, setPromptQuery] = useState("");
  const batches = useQuery({
    queryKey: ["image-batches"],
    queryFn: () => api<ImageBatch[]>("/images"),
  });
  const needle = promptQuery.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = groupBatches(batches.data ?? []);
    if (!needle) return all;
    return all.filter((group) => group.prompt.toLowerCase().includes(needle));
  }, [batches.data, needle]);

  return (
    <div className="space-y-4">
      <ErrorText message={batches.isError ? errorMessage(batches.error) : null} />
      {batches.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {batches.data && batches.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Картинок пока нет.</p>
        </Card>
      ) : null}
      {batches.data && batches.data.length > 0 ? (
        <div className="space-y-4">
          <Input
            value={promptQuery}
            onChange={(event) => setPromptQuery(event.target.value)}
            placeholder="Фильтр по промпту"
            aria-label="Фильтр по промпту"
          />
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className={`${historyColumns} border-b border-border bg-muted/50 text-sm font-medium`}>
                <div className="px-4 py-2">Промпт</div>
                <div className="px-4 py-2">Картинка</div>
              </div>
              {groups.map((group) => (
                <div key={group.prompt} className="divide-y divide-border border-b border-border last:border-b-0">
                  {group.batches.map((batch, index) => {
                    const preview = batch.images[0];
                    return (
                      <div key={batch.id} className={historyColumns}>
                        <div className="px-4 py-3">
                          {index === 0 ? <p className="font-medium">{promptExcerpt(group.prompt)}</p> : null}
                          <p className="text-sm text-muted-foreground">{formatWhen(batch.createdAt)}</p>
                        </div>
                        <Link
                          to={`/history/images/${batch.id}`}
                          className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted"
                        >
                          {preview ? (
                            <img
                              src={`/images/${batch.id}/files/${preview.index}`}
                              alt=""
                              className={`h-16 w-16 shrink-0 rounded-md object-cover ${batch.transparent ? "checkerboard" : "bg-muted"}`}
                            />
                          ) : (
                            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                              нет
                            </span>
                          )}
                          <span>
                            {group.batches.length > 1 ? `${index + 1}. ` : null}
                            {imageModelLabel(batch.model)}
                            {batch.images.length > 1 ? ` · ${batch.images.length} шт.` : ""}
                            {batch.status !== "ready" ? (
                              <span className="text-muted-foreground"> · {statusLabel(batch.status)}</span>
                            ) : null}
                          </span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ImageHistoryDetailRoute() {
  const { id } = useParams();
  return <ImageHistoryDetail key={id} />;
}

function ImageHistoryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const batchQuery = useQuery({
    queryKey: ["image-batches", id],
    queryFn: () => api<ImageBatch>(`/images/${id}`),
    enabled: Boolean(id),
  });
  const openFolder = useMutation({
    mutationFn: () => api<{ ok: true }>(`/images/${id}/open-folder`, { method: "POST" }),
    onSuccess: () => setFolderMessage("Проводник открыт."),
    onError: () => setFolderMessage(null),
  });
  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>(`/images/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["image-batches"] });
      navigate("/history?tab=images");
    },
  });
  const batch = batchQuery.data ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Картинка</h1>
        <Button type="button" variant="ghost" asChild>
          <Link to="/history?tab=images">К списку</Link>
        </Button>
      </div>
      <ErrorText message={batchQuery.isError ? errorMessage(batchQuery.error) : null} />
      {batchQuery.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {batch ? (
        <div className="space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="whitespace-pre-wrap text-foreground">{batch.prompt}</p>
            <p>
              {imageModelLabel(batch.model)}
              {batch.gguf ? ` · ${batch.gguf}` : ""} · {statusLabel(batch.status)} · {formatWhen(batch.createdAt)} ·{" "}
              {batch.width}×{batch.height} · {batch.steps} шагов
              {batch.transparent ? " · прозрачный фон" : ""}
            </p>
          </div>
          {batch.error ? <ErrorText message={batch.error} /> : null}
          {batch.images.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {batch.images.map((image) => (
                <figure key={image.index} className="space-y-1">
                  <img
                    src={`/images/${batch.id}/files/${image.index}`}
                    alt=""
                    className={`w-full rounded-md ${batch.transparent ? "checkerboard" : "bg-muted"}`}
                  />
                  <figcaption className="text-xs text-muted-foreground">seed {image.seed}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Файлов картинок нет.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={openFolder.isPending} onClick={() => openFolder.mutate()}>
              Открыть папку
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
              Удалить
            </Button>
          </div>
          {folderMessage ? <p className="text-sm text-muted-foreground">{folderMessage}</p> : null}
          <ErrorText message={openFolder.isError ? errorMessage(openFolder.error) : null} />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить картинки?"
        description="Файлы будут удалены из базы и хранилища."
        confirmLabel="Удалить"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onOpenChange={setConfirmDelete}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
