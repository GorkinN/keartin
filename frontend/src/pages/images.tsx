import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { imageModelLabel, QWEN_SIZE_PRESETS, sideMax, stepBounds, type ImageModelId } from "@/api/image-model";
import { formatWhen } from "@/api/labels";
import { gpuBusyLabel, parseSeed } from "@/api/seed";
import { resolveSize, SIZE_PRESETS } from "@/api/sizes";
import type { AppConfig, GpuStatus, ImageBatch, ImageQueue } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { FieldLabel } from "@/components/field-hint";
import { ImageModelSelect, QwenGgufSelect } from "@/components/image-model-select";
import { ReferenceBoard, type ReferenceBoardHandle } from "@/components/reference-board";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useImageJob } from "@/hooks/useImageJob";

export function ImagesPage() {
  const [imageModel, setImageModel] = useState<ImageModelId>("flux");
  const [gguf, setGguf] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sizePreset, setSizePreset] = useState("square");
  const [customWidth, setCustomWidth] = useState("1024");
  const [customHeight, setCustomHeight] = useState("1024");
  const [steps, setSteps] = useState(stepBounds("flux").fallback);
  const [stepsText, setStepsText] = useState(String(stepBounds("flux").fallback));
  const [transparent, setTransparent] = useState(false);
  const [mask, setMask] = useState<File | null>(null);
  const board = useRef<ReferenceBoardHandle>(null);
  const [seedText, setSeedText] = useState("");
  const [count, setCount] = useState(1);
  const [countText, setCountText] = useState("1");
  const [adding, setAdding] = useState(false);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const job = useImageJob();

  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<AppConfig>("/config"),
  });
  const ggufs = config.data?.qwen.ggufs ?? [];
  const gpu = useQuery({
    queryKey: ["gpu-status"],
    queryFn: () => api<GpuStatus>("/gpu/status"),
    refetchInterval: 2000,
  });
  const queue = useQuery({
    queryKey: ["image-queue"],
    queryFn: () => api<ImageQueue>("/images/queue"),
    refetchInterval: (query) => (query.state.data?.cooldownUntil ? 1000 : 2000),
  });
  const batches = useQuery({
    queryKey: ["image-batches"],
    queryFn: () => api<ImageBatch[]>("/images"),
    refetchInterval: (queue.data?.items.length ?? 0) > 0 ? 2000 : false,
  });

  const bounds = stepBounds(imageModel);
  const presets = imageModel === "qwen" ? QWEN_SIZE_PRESETS : SIZE_PRESETS;
  const size = resolveSize(sizePreset, customWidth, customHeight, presets, sideMax(imageModel));
  const sizeError = "error" in size ? size.error : null;
  const seed = parseSeed(seedText);
  const selectedSteps = parseSteps(stepsText, bounds.min, bounds.max);
  const selectedCount = parseCount(countText);
  const promptReady = prompt.trim().length > 0;
  const blocked = !promptReady || Boolean(sizeError) || Boolean(seed.error) || selectedSteps === null || selectedCount === null;
  const gpuLabel = gpuBusyLabel(gpu.data);
  const cooldownUntil = queue.data?.cooldownUntil ?? null;
  const cooldownLeft = cooldownUntil ? new Date(cooldownUntil).getTime() - now : 0;
  const running = queue.data?.items.find((item) => item.status === "running") ?? null;

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    if (running) job.watch(running.jobId);
  }, [job.watch, running]);

  useEffect(() => {
    if (imageModel !== "qwen" || ggufs.length === 0) return;
    setGguf((current) => (ggufs.some((item) => item.id === current) ? current : ggufs[0].id));
  }, [ggufs, imageModel]);

  const changeModel = (next: ImageModelId) => {
    setImageModel(next);
    setSizePreset("square");
    const nextBounds = stepBounds(next);
    setSteps(nextBounds.fallback);
    setStepsText(String(nextBounds.fallback));
    if (next === "flux") {
      setTransparent(false);
      setMask(null);
    }
  };

  const generate = () => {
    if (blocked || adding || selectedSteps === null || selectedCount === null) return;
    const width = "error" in size ? 1024 : size.width;
    const height = "error" in size ? 1024 : size.height;
    setEnqueueError(null);
    setAdding(true);
    void (async () => {
      const body = new FormData();
      body.set("prompt", prompt.trim());
      body.set("model", imageModel);
      body.set("width", String(width));
      body.set("height", String(height));
      body.set("steps", String(selectedSteps));
      body.set("count", String(selectedCount));
      body.set("transparent", imageModel === "qwen" && transparent ? "true" : "false");
      if (imageModel === "qwen" && gguf) body.set("gguf", gguf);
      if (seed.value !== undefined) body.set("seed", String(seed.value));
      if (imageModel === "qwen" && board.current) {
        for (const file of await board.current.files()) body.append("references", file);
        if (mask) body.append("mask", mask);
      }
      return api<{ jobId: string; batchId: string }>("/images", { method: "POST", body });
    })()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["image-queue"] });
        void queryClient.invalidateQueries({ queryKey: ["image-batches"] });
      })
      .catch((caught: unknown) => setEnqueueError(errorMessage(caught)))
      .finally(() => setAdding(false));
  };

  const removeQueued = (jobId: string) => {
    setRemovingId(jobId);
    setEnqueueError(null);
    void api(`/images/queue/${jobId}`, { method: "DELETE" })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["image-queue"] });
        void queryClient.invalidateQueries({ queryKey: ["image-batches"] });
      })
      .catch((caught: unknown) => setEnqueueError(errorMessage(caught)))
      .finally(() => setRemovingId(null));
  };

  const cancelRunning = () => {
    if (!running) return;
    setCancelling(true);
    setEnqueueError(null);
    void api(`/images/jobs/${running.jobId}/cancel`, { method: "POST" })
      .catch((caught: unknown) => setEnqueueError(errorMessage(caught)))
      .finally(() => setCancelling(false));
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError(null);
    void api(`/images/${deleteId}`, { method: "DELETE" })
      .then(() => {
        setDeleteId(null);
        void queryClient.invalidateQueries({ queryKey: ["image-batches"] });
      })
      .catch((caught: unknown) => setDeleteError(errorMessage(caught)))
      .finally(() => setDeleting(false));
  };

  const progressValue =
    job.progress && job.progress.total > 0 ? Math.round((job.progress.step / job.progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Картинки</h1>
      <div className="space-y-4">
        <ImageModelSelect id="image-model" value={imageModel} onChange={changeModel} />
        {imageModel === "qwen" ? (
          <QwenGgufSelect id="image-gguf" value={gguf} options={ggufs} onChange={setGguf} />
        ) : null}
        <div className="space-y-1.5">
          <FieldLabel htmlFor="image-prompt" hint="Текст уходит в модель как есть. Английский промпт обычно даёт лучший результат.">
            Промпт
          </FieldLabel>
          <Textarea
            id="image-prompt"
            value={prompt}
            maxLength={4000}
            placeholder="A red fox in a snowy forest, cinematic light"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel hint="Размер картинки.">Размер</FieldLabel>
          <Select value={sizePreset} onValueChange={setSizePreset}>
            {presets.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.width ? `${item.label} · ${item.width}×${item.height}` : item.label}
              </SelectItem>
            ))}
          </Select>
          <p className="text-sm text-muted-foreground">
            От 256 до {sideMax(imageModel)}, сторона кратна 16.
            {imageModel === "qwen" ? " Пресеты 2K медленные и могут не влезть в 12 ГБ." : ""}
          </p>
          {sizePreset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="image-width">Ширина</Label>
                <Input
                  id="image-width"
                  inputMode="numeric"
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="image-height">Высота</Label>
                <Input
                  id="image-height"
                  inputMode="numeric"
                  value={customHeight}
                  onChange={(event) => setCustomHeight(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          {sizePreset === "custom" ? <ErrorText message={sizeError} /> : null}
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="image-steps" hint="Больше шагов — дольше и обычно детальнее.">
            Шаги
          </FieldLabel>
          <div className="flex items-center gap-3">
            <Input
              id="image-steps"
              inputMode="numeric"
              min={bounds.min}
              max={bounds.max}
              className="w-20"
              value={stepsText}
              onChange={(event) => {
                const text = event.target.value;
                setStepsText(text);
                const parsed = parseSteps(text, bounds.min, bounds.max);
                if (parsed !== null) setSteps(parsed);
              }}
              onBlur={() => {
                const parsed = parseSteps(stepsText, bounds.min, bounds.max);
                if (parsed !== null) {
                  setSteps(parsed);
                  setStepsText(String(parsed));
                  return;
                }
                setStepsText(String(steps));
              }}
            />
            <input
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={steps}
              aria-label="Шаги"
              className="h-2 w-full accent-current"
              onChange={(event) => {
                const next = Number(event.target.value);
                setSteps(next);
                setStepsText(String(next));
              }}
            />
          </div>
          {selectedSteps === null ? (
            <p className="text-sm text-muted-foreground">Укажите число от {bounds.min} до {bounds.max}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="image-seed" hint="Фиксирует случайность. Пусто — у каждой картинки свой seed. Если задан, следующие картинки получают seed + 1.">
            Seed
          </FieldLabel>
          <Input
            id="image-seed"
            inputMode="numeric"
            placeholder="пусто — случайный"
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
          />
          <ErrorText message={seed.error} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="image-count" hint="Сколько картинок поставить одной пачкой. Модель загружается один раз.">
            Количество
          </FieldLabel>
          <div className="flex items-center gap-3">
            <Input
              id="image-count"
              inputMode="numeric"
              min={1}
              max={20}
              className="w-20"
              value={countText}
              onChange={(event) => {
                const text = event.target.value;
                setCountText(text);
                const parsed = parseCount(text);
                if (parsed !== null) setCount(parsed);
              }}
              onBlur={() => {
                const parsed = parseCount(countText);
                if (parsed !== null) {
                  setCount(parsed);
                  setCountText(String(parsed));
                  return;
                }
                const clamped = clampCount(countText);
                if (clamped !== null) {
                  setCount(clamped);
                  setCountText(String(clamped));
                  return;
                }
                setCountText(String(count));
              }}
            />
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={count}
              aria-label="Количество картинок"
              className="h-2 w-full accent-current"
              onChange={(event) => {
                const next = Number(event.target.value);
                setCount(next);
                setCountText(String(next));
              }}
            />
          </div>
          {selectedCount === null ? <p className="text-sm text-muted-foreground">Укажите число от 1 до 20</p> : null}
        </div>
        {imageModel === "qwen" ? (
          <>
            <ReferenceBoard ref={board} max={mask ? 9 : 10} />
            <div className="space-y-1.5">
              <FieldLabel htmlFor="image-mask" hint="Белые области маски нужно менять, чёрные оставить. Маска уходит вторым изображением после референсов.">
                Маска
              </FieldLabel>
              <Input
                id="image-mask"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setMask(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="image-transparent" checked={transparent} onCheckedChange={setTransparent} aria-label="Прозрачный фон" />
              <Label htmlFor="image-transparent">Прозрачный фон</Label>
            </div>
          </>
        ) : null}
        {!promptReady ? <p className="text-sm text-muted-foreground">Нужен промпт</p> : null}
        {gpuLabel ? <p className="text-sm text-muted-foreground">{gpuLabel}</p> : null}
        <ErrorText message={enqueueError} />
        <ErrorText message={job.error} />
        <Button type="button" onClick={generate} disabled={blocked || adding}>
          {adding ? "Добавление…" : "Сгенерировать"}
        </Button>
      </div>
      {cooldownLeft > 0 ? (
        <p className="text-sm text-muted-foreground">Пауза, следующее задание через {formatCooldown(cooldownLeft)}</p>
      ) : null}
      {job.notice ? <p className="text-sm text-muted-foreground">{job.notice}</p> : null}
      {running && (job.phase || job.progress) ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{phaseLabel(job.phase, job.progress, running.count)}</p>
            <Button type="button" variant="outline" size="sm" disabled={cancelling} onClick={cancelRunning}>
              {cancelling ? "Отмена…" : "Отменить"}
            </Button>
          </div>
          {job.progress ? <Progress value={progressValue} /> : null}
        </div>
      ) : null}
      {queue.data && queue.data.items.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Очередь</p>
          <ul className="space-y-2">
            {queue.data.items.map((item, index) => (
              <li key={item.jobId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {index + 1}. {excerpt(item.prompt)} · {item.count} · {item.status === "running" ? "генерация" : "в очереди"}
                </span>
                {item.status === "queued" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={removingId === item.jobId}
                    onClick={() => removeQueued(item.jobId)}
                  >
                    Убрать
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorText message={queue.isError ? errorMessage(queue.error) : null} />
      <ErrorText message={batches.isError ? errorMessage(batches.error) : null} />
      {batches.isPending ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {batches.data && batches.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Картинок пока нет.</p>
        </Card>
      ) : null}
      <div className="space-y-4">
        {(batches.data ?? []).map((batch) => (
          <Card key={batch.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="whitespace-pre-wrap break-words text-sm">{batch.prompt}</p>
                <p className="text-sm text-muted-foreground">
                  {imageModelLabel(batch.model)}
                  {batch.gguf ? ` · ${ggufs.find((item) => item.id === batch.gguf)?.label ?? batch.gguf}` : ""}
                  {" · "}
                  {batchStatusLabel(batch.status)} · {formatWhen(batch.createdAt)} · {batch.width}×{batch.height} · {batch.steps} шагов
                  {batch.transparent ? " · прозрачный фон" : ""}
                  {batch.seed !== null ? ` · seed ${batch.seed}` : ""}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => { setDeleteError(null); setDeleteId(batch.id); }}>
                Удалить
              </Button>
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
            ) : null}
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={deleteId !== null}
        title="Удалить пачку?"
        description="Картинки будут удалены из хранилища."
        confirmLabel="Удалить"
        pending={deleting}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function phaseLabel(phase: string | null, progress: { index: number; step: number; total: number } | null, count: number): string {
  if (progress) return `Картинка ${progress.index + 1} из ${count}, шаг ${progress.step} из ${progress.total}`;
  if (phase === "unload_llm") return "Освобождение GPU";
  if (phase === "load_flux") return "Загрузка модели";
  if (phase === "generate") return "Генерация";
  if (phase === "unload_flux") return "Выгрузка модели";
  if (phase === "queued") return "В очереди";
  return "Генерация";
}

function batchStatusLabel(status: string): string {
  if (status === "queued") return "в очереди";
  if (status === "running") return "генерация";
  if (status === "ready") return "готово";
  if (status === "failed") return "ошибка";
  if (status === "cancelled") return "отменено";
  return status;
}

function excerpt(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ");
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function parseSteps(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  if (value < min || value > max) return null;
  return value;
}

function parseCount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  if (value < 1 || value > 20) return null;
  return value;
}

function clampCount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  if (value < 1) return 1;
  if (value > 20) return 20;
  return value;
}

function formatCooldown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
