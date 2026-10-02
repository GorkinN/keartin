import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { formatWhen } from "@/api/labels";
import { gpuBusyLabel, parseSeed } from "@/api/seed";
import { IMAGE_STEPS, resolveSize, SIZE_PRESETS, type SizePresetId } from "@/api/sizes";
import type { GpuStatus, ImageBatch, ImageQueue } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorText } from "@/components/error-text";
import { FieldLabel } from "@/components/field-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useImageJob } from "@/hooks/useImageJob";

const STEP_MIN = 20;
const STEP_MAX = 28;

export function ImagesPage() {
  const [prompt, setPrompt] = useState("");
  const [sizePreset, setSizePreset] = useState<SizePresetId>("square");
  const [customWidth, setCustomWidth] = useState("1024");
  const [customHeight, setCustomHeight] = useState("1024");
  const [steps, setSteps] = useState(IMAGE_STEPS);
  const [stepsText, setStepsText] = useState(String(IMAGE_STEPS));
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

  const size = resolveSize(sizePreset, customWidth, customHeight);
  const sizeError = "error" in size ? size.error : null;
  const seed = parseSeed(seedText);
  const selectedSteps = parseSteps(stepsText);
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

  const generate = () => {
    if (blocked || adding || selectedSteps === null || selectedCount === null) return;
    const width = "error" in size ? 1024 : size.width;
    const height = "error" in size ? 1024 : size.height;
    setEnqueueError(null);
    setAdding(true);
    void api<{ jobId: string; batchId: string }>("/images", {
      method: "POST",
      body: JSON.stringify({
        prompt: prompt.trim(),
        width,
        height,
        steps: selectedSteps,
        count: selectedCount,
        ...(seed.value !== undefined ? { seed: seed.value } : {}),
      }),
    })
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
        <div className="space-y-1.5">
          <FieldLabel htmlFor="image-prompt" hint="Текст уходит в Flux как есть. Английский промпт обычно даёт лучший результат.">
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
          <Select value={sizePreset} onValueChange={(value) => setSizePreset(value as SizePresetId)}>
            {SIZE_PRESETS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.width ? `${item.label} · ${item.width}×${item.height}` : item.label}
              </SelectItem>
            ))}
          </Select>
          <p className="text-sm text-muted-foreground">От 256 до 1024, сторона кратна 16.</p>
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
              min={STEP_MIN}
              max={STEP_MAX}
              className="w-20"
              value={stepsText}
              onChange={(event) => {
                const text = event.target.value;
                setStepsText(text);
                const parsed = parseSteps(text);
                if (parsed !== null) setSteps(parsed);
              }}
              onBlur={() => {
                const parsed = parseSteps(stepsText);
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
              min={STEP_MIN}
              max={STEP_MAX}
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
            <p className="text-sm text-muted-foreground">Укажите число от 20 до 28</p>
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
                  {batchStatusLabel(batch.status)} · {formatWhen(batch.createdAt)} · {batch.width}×{batch.height} · {batch.steps} шагов
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
                      className="w-full rounded-md bg-muted"
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

function parseSteps(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  if (value < STEP_MIN || value > STEP_MAX) return null;
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
