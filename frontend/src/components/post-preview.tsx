import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import type { ImagePromptPreset, Post } from "@/api/types";
import type { GenerationKind } from "@/hooks/useGeneration";
import { FieldLabel } from "@/components/field-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectItem } from "@/components/ui/select";
import { ErrorText } from "@/components/error-text";
import { parseSeed } from "@/api/seed";

export function PostPreview({
  post,
  liveText,
  progress,
  running,
  queued = false,
  error,
  notice,
  gpuLabel,
  cancelling,
  onCancel,
  onRegenerateText,
  onRegenerateImage,
  showHistoryLink = true,
}: {
  post: Post | null;
  liveText: string | null;
  progress: { step: number; total: number } | null;
  running: GenerationKind | null;
  queued?: boolean;
  error: string | null;
  notice?: string | null;
  gpuLabel?: string | null;
  cancelling?: boolean;
  onCancel?: () => void;
  onRegenerateText?: () => void;
  onRegenerateImage?: (seed?: number, imagePresetId?: string | null) => void;
  showHistoryLink?: boolean;
}) {
  const text = liveText ?? post?.text ?? "";
  const showImage = Boolean(post?.imageKey) && running !== "image";
  const [imageFailed, setImageFailed] = useState(false);
  const [seedText, setSeedText] = useState("");
  const [imagePresetId, setImagePresetId] = useState(post?.imagePresetId ?? "none");
  const seed = parseSeed(seedText);
  const imagePresets = useQuery({
    queryKey: ["image-presets"],
    queryFn: () => api<ImagePromptPreset[]>("/image-presets"),
    enabled: Boolean(post && onRegenerateImage),
  });
  useEffect(() => {
    setImageFailed(false);
  }, [post?.id, post?.updatedAt]);
  useEffect(() => {
    setImagePresetId(post?.imagePresetId ?? "none");
  }, [post?.id, post?.imagePresetId]);
  const imagePercent = progress && progress.total > 0 ? (progress.step / progress.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <ErrorText message={error} />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {gpuLabel ? <p className="text-sm text-muted-foreground">{gpuLabel}</p> : null}
      {cancelling && progress ? (
        <p className="text-sm text-muted-foreground">Отмена применится после текущего прогона картинки</p>
      ) : null}
      {!queued && (running === "full" || running === "text") ? (
        <p className="text-sm text-muted-foreground">Текст пишется…</p>
      ) : null}
      {text ? (
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{text}</pre>
      ) : !queued && running ? (
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
      {running && onCancel ? (
        <Button type="button" variant="outline" disabled={cancelling} onClick={onCancel}>
          {cancelling ? "Отмена…" : "Отменить"}
        </Button>
      ) : null}
      {post && onRegenerateText && onRegenerateImage ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel href="/presets?tab=image" hint="Текст стиля учитывается при описании картинки.">
              Стиль картинки
            </FieldLabel>
            <div className="max-w-xs">
              <Select value={imagePresetId} onValueChange={setImagePresetId}>
                <SelectItem value="none">Без стиля</SelectItem>
                {(imagePresets.data ?? []).map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
            {imagePresets.isError ? <ErrorText message={errorMessage(imagePresets.error)} /> : null}
          </div>
          <div className="max-w-xs space-y-1.5">
            <FieldLabel htmlFor="regen-seed" hint="Фиксирует случайность картинки. Пусто — каждый раз новая.">
              Seed картинки
            </FieldLabel>
            <Input
              id="regen-seed"
              inputMode="numeric"
              placeholder="пусто — новый"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
            />
            {seed.error ? <ErrorText message={seed.error} /> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={running !== null || !post.text}
              onClick={onRegenerateText}
            >
              Перегенерировать текст
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={running !== null || !post.text || Boolean(seed.error)}
              onClick={() => onRegenerateImage(seed.value, imagePresetId === "none" ? null : imagePresetId)}
            >
              {post.imageKey ? "Перегенерировать картинку" : "Сгенерировать картинку"}
            </Button>
            {showHistoryLink ? (
              <Button type="button" variant="ghost" asChild>
                <Link to={`/history/${post.id}`}>Открыть в истории</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
