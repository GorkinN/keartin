import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Post } from "@/api/types";
import type { GenerationKind } from "@/hooks/useGeneration";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ErrorText } from "@/components/error-text";

export function PostPreview({
  post,
  liveText,
  progress,
  running,
  error,
  onRegenerateText,
  onRegenerateImage,
  showHistoryLink = true,
}: {
  post: Post | null;
  liveText: string | null;
  progress: { step: number; total: number } | null;
  running: GenerationKind | null;
  error: string | null;
  onRegenerateText?: () => void;
  onRegenerateImage?: () => void;
  showHistoryLink?: boolean;
}) {
  const text = liveText ?? post?.text ?? "";
  const showImage = Boolean(post?.imageKey) && running !== "image";
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [post?.id, post?.updatedAt]);
  const imagePercent = progress && progress.total > 0 ? (progress.step / progress.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <ErrorText message={error} />
      {running === "full" || running === "text" ? (
        <p className="text-sm text-muted-foreground">Текст пишется…</p>
      ) : null}
      {text ? (
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{text}</pre>
      ) : running ? (
        <p className="text-sm text-muted-foreground">Ожидание токенов…</p>
      ) : null}
      {progress && running !== "text" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {progress.total > 0 ? `Картинка ${progress.step}/${progress.total}` : "Картинка готовится…"}
          </p>
          <Progress value={imagePercent} />
        </div>
      ) : null}
      {showImage && post && !imageFailed ? (
        <img
          src={`/posts/${post.id}/image?v=${encodeURIComponent(post.updatedAt)}`}
          alt={post.topic}
          className="max-w-full rounded-md border border-border"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      {imageFailed ? <p className="text-sm text-destructive">Картинка не найдена</p> : null}
      {post && onRegenerateText && onRegenerateImage ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={running !== null || !post.text} onClick={onRegenerateText}>
            Перегенерировать текст
          </Button>
          <Button type="button" variant="outline" disabled={running !== null || !post.text} onClick={onRegenerateImage}>
            Перегенерировать картинку
          </Button>
          {showHistoryLink ? (
            <Button type="button" variant="ghost" asChild>
              <Link to={`/history/${post.id}`}>Открыть в истории</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
