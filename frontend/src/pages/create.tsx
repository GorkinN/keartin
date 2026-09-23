import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/api/client";
import { knowledgeLabel, lengthLabel } from "@/api/labels";
import { IMAGE_STEPS, resolveSize, SIZE_PRESETS, type SizePresetId } from "@/api/sizes";
import type { Book, KnowledgeMode, Post, PostLength, Preset } from "@/api/types";
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
  const [sizePreset, setSizePreset] = useState<SizePresetId>("square");
  const [customWidth, setCustomWidth] = useState("1024");
  const [customHeight, setCustomHeight] = useState("1024");
  const [post, setPost] = useState<Post | null>(null);
  const generation = useGeneration(setPost);

  const books = useQuery({
    queryKey: ["books"],
    queryFn: () => api<Book[]>("/library/books"),
    refetchInterval: (query) => (query.state.data?.some((book) => book.status === "indexing") ? 2000 : false),
  });
  const presets = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<Preset[]>("/presets"),
  });

  const readyBooks = (books.data ?? []).filter((book) => book.status === "ready");
  const size = resolveSize(sizePreset, customWidth, customHeight);
  const sizeError = "error" in size ? size.error : null;
  const formReason = !topic.trim()
    ? "Нужна тема"
    : knowledgeMode === "rag" && bookIds.length === 0
      ? "Для режима «только книги» выберите хотя бы одну готовую книгу"
      : null;
  const blocked = Boolean(formReason) || Boolean(sizeError);

  const toggleBook = (id: string) => {
    setBookIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const generate = () => {
    if (blocked || "error" in size) return;
    setPost(null);
    void generation.run("full", "/generate/posts", {
      topic: topic.trim(),
      tone: tone.trim(),
      length,
      emoji,
      knowledgeMode,
      citations,
      structure: { hooks, body: includeBody, cta },
      bookIds: knowledgeMode === "general" ? [] : bookIds,
      presetId: presetId === "none" ? null : presetId,
      width: size.width,
      height: size.height,
      steps: IMAGE_STEPS,
    });
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
              readyBooks.map((book) => (
                <label key={book.id} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={bookIds.includes(book.id)}
                    onChange={() => toggleBook(book.id)}
                  />
                  <span>{book.filename}</span>
                </label>
              ))
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
            {formReason ? <p className="text-sm text-muted-foreground">{formReason}</p> : null}
            <Button type="button" onClick={generate} disabled={blocked || generation.running !== null}>
              {generation.running === "full" ? "Генерация…" : "Сгенерировать"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      {generation.running || generation.liveText !== null || generation.error || post ? (
        <PostPreview
          post={post}
          liveText={generation.liveText}
          progress={generation.progress}
          running={generation.running}
          error={generation.error}
          onRegenerateText={
            post
              ? () => void generation.run("text", `/posts/${post.id}/regenerate-text`)
              : undefined
          }
          onRegenerateImage={
            post
              ? () => void generation.run("image", `/posts/${post.id}/regenerate-image`)
              : undefined
          }
        />
      ) : null}
    </div>
  );
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
