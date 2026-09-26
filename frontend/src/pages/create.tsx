import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { gpuBusyLabel, parseSeed } from "@/api/seed";
import { knowledgeLabel, lengthLabel } from "@/api/labels";
import { IMAGE_STEPS, resolveSize, SIZE_PRESETS, type SizePresetId } from "@/api/sizes";
import type {
  Book,
  EnqueueResult,
  GenerateQueue,
  GpuStatus,
  ImagePromptPreset,
  KnowledgeMode,
  Post,
  PostLength,
  Preset,
} from "@/api/types";
import { ErrorText } from "@/components/error-text";
import { PostPreview } from "@/components/post-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGeneration } from "@/hooks/useGeneration";

const lengths: PostLength[] = ["S", "M", "L"];
const modes: KnowledgeMode[] = ["rag", "rag_plus", "general"];

export function CreatePage() {
  const [step, setStep] = useState("sources");
  const [bookIds, setBookIds] = useState<string[]>([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [length, setLength] = useState<PostLength>("M");
  const [emoji, setEmoji] = useState(false);
  const [citations, setCitations] = useState(false);
  const [hooks, setHooks] = useState(true);
  const [includeBody, setIncludeBody] = useState(true);
  const [cta, setCta] = useState(true);
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("rag");
  const [presetId, setPresetId] = useState("none");
  const [imagePresetId, setImagePresetId] = useState("none");
  const [sizePreset, setSizePreset] = useState<SizePresetId>("square");
  const [customWidth, setCustomWidth] = useState("1024");
  const [customHeight, setCustomHeight] = useState("1024");
  const [seedText, setSeedText] = useState("");
  const [count, setCount] = useState(1);
  const [countText, setCountText] = useState("1");
  const [post, setPost] = useState<Post | null>(null);
  const [adding, setAdding] = useState(false);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [finished, setFinished] = useState<FinishedRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef(new Map<string, { postId: string; topic: string }>());
  const resolvedRef = useRef(new Set<string>());
  const generation = useGeneration(setPost);
  const queryClient = useQueryClient();

  const books = useQuery({
    queryKey: ["books"],
    queryFn: () => api<Book[]>("/library/books"),
    refetchInterval: (query) => (query.state.data?.some((book) => book.status === "indexing") ? 2000 : false),
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<Preset[]>("/presets"),
  });
  const imagePresets = useQuery({
    queryKey: ["image-presets"],
    queryFn: () => api<ImagePromptPreset[]>("/image-presets"),
  });
  const gpu = useQuery({
    queryKey: ["gpu-status"],
    queryFn: () => api<GpuStatus>("/gpu/status"),
    refetchInterval: 2000,
  });
  const queue = useQuery({
    queryKey: ["generate-queue"],
    queryFn: () => api<GenerateQueue>("/generate/queue"),
    refetchInterval: (query) => (query.state.data?.cooldownUntil ? 1000 : 2000),
  });

  const readyBooks = (books.data ?? []).filter((book) => book.status === "ready");
  const sourceNeedle = sourceQuery.trim().toLowerCase();
  const visibleBooks = sourceNeedle
    ? readyBooks.filter((book) => book.filename.toLowerCase().includes(sourceNeedle))
    : readyBooks;
  const visibleIds = visibleBooks.map((book) => book.id);
  const size = resolveSize(sizePreset, customWidth, customHeight);
  const sizeError = "error" in size ? size.error : null;
  const seed = parseSeed(seedText);
  const gpuLabel = gpuBusyLabel(gpu.data);
  const formReason = !topic.trim()
    ? "Нужна тема"
    : knowledgeMode === "rag" && bookIds.length === 0
      ? "Для режима «только книги» выберите хотя бы одну готовую книгу"
      : null;
  const blocked = Boolean(formReason) || Boolean(sizeError) || Boolean(seed.error);
  const selectedCount = parseCount(countText);
  const cooldownUntil = queue.data?.cooldownUntil ?? null;
  const queueBusy = (queue.data?.items.length ?? 0) > 0 || Boolean(cooldownUntil);
  const cooldownLeft = cooldownUntil ? new Date(cooldownUntil).getTime() - now : 0;

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const runningJobId = queue.data?.items.find((item) => item.status === "running")?.jobId ?? null;
  useEffect(() => {
    const running = queue.data?.items.find((item) => item.status === "running");
    if (!running) return;
    generation.watch(running);
  }, [generation.watch, queue.data?.items, runningJobId]);

  useEffect(() => {
    const items = queue.data?.items ?? [];
    const active = new Set(items.map((item) => item.jobId));
    for (const item of items) {
      seenRef.current.set(item.jobId, { postId: item.postId, topic: item.topic });
    }
    const dropped = [...seenRef.current.keys()].filter(
      (jobId) => !active.has(jobId) && !resolvedRef.current.has(jobId),
    );
    if (dropped.length === 0) return;
    for (const jobId of dropped) resolvedRef.current.add(jobId);
    void (async () => {
      const rows: FinishedRow[] = [];
      for (const jobId of dropped) {
        const known = seenRef.current.get(jobId);
        if (!known) continue;
        try {
          const next = await api<Post>(`/posts/${known.postId}`);
          rows.push({
            jobId,
            postId: known.postId,
            topic: known.topic,
            status: next.status === "ready" ? "ready" : "failed",
          });
        } catch {
          rows.push({ jobId, postId: known.postId, topic: known.topic, status: "cancelled" });
        }
      }
      if (rows.length > 0) setFinished((current) => [...current, ...rows]);
    })();
  }, [queue.data]);

  const toggleBook = (id: string) => {
    setBookIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectVisibleBooks = () => {
    setBookIds((current) => [...new Set([...current, ...visibleIds])]);
  };

  const resetVisibleBooks = () => {
    const visible = new Set(visibleIds);
    setBookIds((current) => current.filter((id) => !visible.has(id)));
  };

  const generate = () => {
    if (blocked || "error" in size || selectedCount === null || adding) return;
    setEnqueueError(null);
    setAdding(true);
    void api<EnqueueResult>("/generate/posts", {
      method: "POST",
      body: JSON.stringify({
        topic: topic.trim(),
        tone: tone.trim(),
        length,
        emoji,
        knowledgeMode,
        citations,
        structure: { hooks, body: includeBody, cta },
        bookIds: knowledgeMode === "general" ? [] : bookIds,
        presetId: presetId === "none" ? null : presetId,
        imagePresetId: imagePresetId === "none" ? null : imagePresetId,
        width: size.width,
        height: size.height,
        steps: IMAGE_STEPS,
        count: selectedCount,
        ...(seed.value !== undefined ? { seed: seed.value } : {}),
      }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["generate-queue"] }))
      .catch((caught: unknown) => setEnqueueError(errorMessage(caught)))
      .finally(() => setAdding(false));
  };

  const removeQueued = (jobId: string) => {
    setRemovingId(jobId);
    setEnqueueError(null);
    void api(`/generate/queue/${jobId}`, { method: "DELETE" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["generate-queue"] }))
      .catch((caught: unknown) => setEnqueueError(errorMessage(caught)))
      .finally(() => setRemovingId(null));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Создать пост</h1>
      <ErrorText message={books.isError ? errorMessage(books.error) : null} />
      <Tabs value={step} onValueChange={setStep}>
        <TabsList>
          <TabsTrigger value="sources">Источники</TabsTrigger>
          <TabsTrigger value="params">Параметры</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <div className="space-y-3">
            {readyBooks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет готовых книг. Загрузите материал в библиотеке и дождитесь статуса «готово».
              </p>
            ) : (
              <>
                <Input
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.target.value)}
                  placeholder="Фильтр по названию"
                  aria-label="Фильтр по названию"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!visibleIds.some((id) => !bookIds.includes(id))}
                    onClick={selectVisibleBooks}
                  >
                    Выбрать всё
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!visibleIds.some((id) => bookIds.includes(id))}
                    onClick={resetVisibleBooks}
                  >
                    Сбросить всё
                  </Button>
                </div>
                {visibleBooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
                ) : (
                  visibleBooks.map((book) => (
                    <label key={book.id} className="flex cursor-pointer items-center gap-3 text-sm">
                      <Switch
                        checked={bookIds.includes(book.id)}
                        onCheckedChange={() => toggleBook(book.id)}
                        aria-label={book.filename}
                      />
                      <span>{book.filename}</span>
                    </label>
                  ))
                )}
              </>
            )}
            <Button type="button" variant="outline" onClick={() => setStep("params")}>
              Далее
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="params">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="topic">Тема</Label>
              <Textarea id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tone">Тон</Label>
              <Input
                id="tone"
                value={tone}
                placeholder="живой, разговорный"
                onChange={(event) => setTone(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Длина</Label>
                <Select value={length} onValueChange={(value) => setLength(value as PostLength)}>
                  {lengths.map((item) => (
                    <SelectItem key={item} value={item}>
                      {lengthLabel(item)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Режим</Label>
                <Select value={knowledgeMode} onValueChange={(value) => setKnowledgeMode(value as KnowledgeMode)}>
                  {modes.map((item) => (
                    <SelectItem key={item} value={item}>
                      {knowledgeLabel(item)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Пресет стиля</Label>
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectItem value="none">Без пресета</SelectItem>
                {(presets.data ?? []).map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </Select>
              {presets.isError ? <ErrorText message={errorMessage(presets.error)} /> : null}
            </div>
            <div className="space-y-1.5">
              <Label>Стиль картинки</Label>
              <Select value={imagePresetId} onValueChange={setImagePresetId}>
                <SelectItem value="none">Без стиля</SelectItem>
                {(imagePresets.data ?? []).map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </Select>
              {imagePresets.isError ? <ErrorText message={errorMessage(imagePresets.error)} /> : null}
            </div>
            <div className="space-y-3">
              <Toggle label="Эмодзи" checked={emoji} onCheckedChange={setEmoji} />
              <Toggle label="Цитируемость" checked={citations} onCheckedChange={setCitations} />
              <Toggle label="Хуки" checked={hooks} onCheckedChange={setHooks} />
              <Toggle label="Тело" checked={includeBody} onCheckedChange={setIncludeBody} />
              <Toggle label="CTA" checked={cta} onCheckedChange={setCta} />
            </div>
            <div className="space-y-1.5">
              <Label>Размер</Label>
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
                    <Label htmlFor="width">Ширина</Label>
                    <Input
                      id="width"
                      inputMode="numeric"
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="height">Высота</Label>
                    <Input
                      id="height"
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
              <Label htmlFor="seed">Seed картинки</Label>
              <Input
                id="seed"
                inputMode="numeric"
                placeholder="пусто — случайный"
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
              />
              <ErrorText message={seed.error} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Количество постов</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="count"
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
                  aria-label="Количество постов"
                  className="h-2 w-full accent-current"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setCount(next);
                    setCountText(String(next));
                  }}
                />
              </div>
              {selectedCount === null ? (
                <p className="text-sm text-muted-foreground">Укажите число от 1 до 20</p>
              ) : null}
            </div>
            {formReason ? <p className="text-sm text-muted-foreground">{formReason}</p> : null}
            {gpuLabel ? <p className="text-sm text-muted-foreground">{gpuLabel}</p> : null}
            <ErrorText message={enqueueError} />
            <Button type="button" onClick={generate} disabled={blocked || selectedCount === null || adding}>
              {adding ? "Добавление…" : queueBusy ? "Добавить в очередь" : "Сгенерировать"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      {cooldownLeft > 0 ? (
        <p className="text-sm text-muted-foreground">Пауза, следующий пост через {formatCooldown(cooldownLeft)}</p>
      ) : null}
      {queue.data || finished.length > 0 ? (
        <QueueList
          items={queue.data?.items ?? []}
          finished={finished}
          removingId={removingId}
          onRemove={removeQueued}
        />
      ) : null}
      <ErrorText message={queue.isError ? errorMessage(queue.error) : null} />
      {generation.running || generation.liveText !== null || generation.error || post ? (
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
          onRegenerateText={
            post
              ? () => void generation.run("text", `/posts/${post.id}/regenerate-text`)
              : undefined
          }
          onRegenerateImage={
            post
              ? (nextSeed, nextImagePresetId) =>
                  void generation.run("image", `/posts/${post.id}/regenerate-image`, {
                    ...(nextSeed === undefined ? {} : { seed: nextSeed }),
                    imagePresetId: nextImagePresetId ?? null,
                  })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

type FinishedRow = {
  jobId: string;
  postId: string;
  topic: string;
  status: "ready" | "failed" | "cancelled";
};

function QueueList({
  items,
  finished,
  removingId,
  onRemove,
}: {
  items: GenerateQueue["items"];
  finished: FinishedRow[];
  removingId: string | null;
  onRemove: (jobId: string) => void;
}) {
  if (items.length === 0 && finished.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Очередь</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={item.jobId} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {index + 1}. {item.topic} · {queueStatusLabel(item.status)}
            </span>
            {item.status === "queued" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={removingId === item.jobId}
                onClick={() => onRemove(item.jobId)}
              >
                Убрать
              </Button>
            ) : null}
          </li>
        ))}
        {finished.map((item) => (
          <li key={item.jobId} className="text-sm text-muted-foreground">
            {item.topic} · {queueStatusLabel(item.status)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function queueStatusLabel(status: string): string {
  if (status === "queued") return "в очереди";
  if (status === "running") return "генерация";
  if (status === "ready") return "готово";
  if (status === "failed") return "ошибка";
  if (status === "cancelled") return "убрано";
  return status;
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

function Toggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
