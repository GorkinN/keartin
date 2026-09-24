import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { gpuBusyLabel } from "@/api/seed";
import { formatWhen, postStatusLabel } from "@/api/labels";
import type { GpuStatus, Post } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { PostPreview } from "@/components/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useGeneration } from "@/hooks/useGeneration";

export function HistoryPage() {
  const posts = useQuery({
    queryKey: ["posts"],
    queryFn: () => api<Post[]>("/posts"),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">История</h1>
      <ErrorText message={posts.isError ? errorMessage(posts.error) : null} />
      {posts.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {posts.data && posts.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Постов пока нет.</p>
        </Card>
      ) : null}
      <div className="space-y-3">
        {posts.data?.map((post) => (
          <Link key={post.id} to={`/history/${post.id}`} className="block">
            <Card>
              <p className="font-medium">{post.topic}</p>
              <p className="text-sm text-muted-foreground">
                {postStatusLabel(post.status)} · {formatWhen(post.createdAt)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function HistoryDetailRoute() {
  const { id } = useParams();
  return <HistoryDetailPage key={id} />;
}

export function HistoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const postQuery = useQuery({
    queryKey: ["posts", id],
    queryFn: () => api<Post>(`/posts/${id}`),
    enabled: Boolean(id),
  });
  const generation = useGeneration((next) => {
    queryClient.setQueryData(["posts", id], next);
  });
  const gpu = useQuery({
    queryKey: ["gpu-status"],
    queryFn: () => api<GpuStatus>("/gpu/status"),
    refetchInterval: 2000,
  });
  const gpuLabel = gpuBusyLabel(gpu.data);

  const openFolder = useMutation({
    mutationFn: () => api<{ ok: true }>(`/posts/${id}/open-folder`, { method: "POST" }),
    onSuccess: () => setFolderMessage("Проводник открыт."),
    onError: () => setFolderMessage(null),
  });

  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>(`/posts/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["posts"] });
      navigate("/history");
    },
  });

  const post = postQuery.data ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Пост</h1>
        <Button type="button" variant="ghost" asChild>
          <Link to="/history">К списку</Link>
        </Button>
      </div>
      <ErrorText message={postQuery.isError ? errorMessage(postQuery.error) : null} />
      {postQuery.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {post ? (
        <div className="space-y-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{post.topic}</p>
            <p>
              {postStatusLabel(post.status)} · {formatWhen(post.createdAt)} · {post.width}×{post.height}
            </p>
            <p className="flex items-center gap-2">
              <span>Seed: {post.imageSeed ?? "—"}</span>
              {post.imageSeed !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(String(post.imageSeed)).then(() => {
                      setCopied(true);
                    });
                  }}
                >
                  {copied ? "Скопировано" : "Копировать"}
                </Button>
              ) : null}
            </p>
          </div>
          <PostPreview
            post={post}
            liveText={generation.liveText}
            progress={generation.progress}
            running={generation.running}
            error={generation.error}
            notice={generation.notice}
            gpuLabel={gpuLabel}
            cancelling={generation.cancelling}
            onCancel={() => void generation.cancel()}
            showHistoryLink={false}
            onRegenerateText={() => void generation.run("text", `/posts/${post.id}/regenerate-text`)}
            onRegenerateImage={(nextSeed) =>
              void generation.run(
                "image",
                `/posts/${post.id}/regenerate-image`,
                nextSeed === undefined ? {} : { seed: nextSeed },
              )
            }
          />
          {post.sources.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Источники</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {post.sources.map((source, index) => (
                  <li key={`${source.bookId}-${source.chunkIndex}-${index}`}>
                    {source.sourceName || source.bookId} · фрагмент {source.chunkIndex}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
        title="Удалить пост?"
        description="Текст и картинка будут удалены из базы и хранилища."
        confirmLabel="Удалить"
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : null}
        onOpenChange={setConfirmDelete}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
