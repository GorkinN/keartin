import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { useGeneration } from "@/hooks/useGeneration";

const PREVIEW_WORDS = 8;
const historyColumns = "grid grid-cols-[minmax(11rem,0.85fr)_minmax(0,1.4fr)]";

type PostGroup = {
  topic: string;
  posts: Post[];
  newest: number;
};

function postExcerpt(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "без текста";
  const preview = words.slice(0, PREVIEW_WORDS).join(" ");
  return words.length > PREVIEW_WORDS ? `${preview}…` : preview;
}

function groupPosts(posts: Post[]): PostGroup[] {
  const byTopic = new Map<string, Post[]>();
  for (const post of posts) {
    const topic = post.topic.trim();
    const list = byTopic.get(topic);
    if (list) list.push(post);
    else byTopic.set(topic, [post]);
  }

  const groups = [...byTopic.entries()].map(([topic, items]) => {
    const sorted = [...items].sort((a, b) => {
      const byDate = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });
    const newest = sorted.reduce((max, post) => Math.max(max, Date.parse(post.createdAt)), 0);
    return { topic, posts: sorted, newest };
  });
  groups.sort((a, b) => b.newest - a.newest || a.topic.localeCompare(b.topic));
  return groups;
}

export function HistoryPage() {
  const [titleQuery, setTitleQuery] = useState("");
  const posts = useQuery({
    queryKey: ["posts"],
    queryFn: () => api<Post[]>("/posts"),
  });
  const needle = titleQuery.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = groupPosts(posts.data ?? []);
    if (!needle) return all;
    return all.filter((group) => group.topic.toLowerCase().includes(needle));
  }, [posts.data, needle]);

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
      {posts.data && posts.data.length > 0 ? (
        <div className="space-y-4">
          <Input
            value={titleQuery}
            onChange={(event) => setTitleQuery(event.target.value)}
            placeholder="Фильтр по названию"
            aria-label="Фильтр по названию"
          />
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className={`${historyColumns} border-b border-border bg-muted/50 text-sm font-medium`}>
                <div className="px-4 py-2">Название</div>
                <div className="px-4 py-2">Пост</div>
              </div>
              {groups.map((group) => (
                <div key={group.topic} className="divide-y divide-border border-b border-border last:border-b-0">
                  {group.posts.map((post, index) => (
                    <div key={post.id} className={historyColumns}>
                      <div className="px-4 py-3">
                        {index === 0 ? <p className="font-medium">{group.topic}</p> : null}
                        <p className="text-sm text-muted-foreground">{formatWhen(post.createdAt)}</p>
                      </div>
                      <Link
                        to={`/history/${post.id}`}
                        className="block self-end px-4 py-3 text-sm hover:bg-muted"
                      >
                        {group.posts.length > 1 ? `${index + 1}. ` : null}
                        {postExcerpt(post.text)}
                        {post.status !== "ready" ? (
                          <span className="text-muted-foreground"> · {postStatusLabel(post.status)}</span>
                        ) : null}
                      </Link>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
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
            queued={generation.queued}
            error={generation.error}
            notice={generation.notice}
            gpuLabel={gpuLabel}
            cancelling={generation.cancelling}
            onCancel={() => void generation.cancel()}
            showHistoryLink={false}
            onRegenerateText={() => void generation.run("text", `/posts/${post.id}/regenerate-text`)}
            onRegenerateImage={(nextSeed, nextImagePresetId) =>
              void generation.run("image", `/posts/${post.id}/regenerate-image`, {
                ...(nextSeed === undefined ? {} : { seed: nextSeed }),
                imagePresetId: nextImagePresetId ?? null,
              })
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
